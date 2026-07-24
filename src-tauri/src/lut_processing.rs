use crate::android_integration::is_android_content_uri;
#[cfg(target_os = "android")]
use crate::android_integration::{
    get_android_cached_lut_path, read_android_content_uri, resolve_android_content_uri_name,
};
use anyhow::anyhow;
use image::{DynamicImage, GenericImageView, Rgb, Rgb32FImage};
use serde::Serialize;
use std::fs::{File, copy, create_dir_all, read_dir};
use std::io::{BufRead, BufReader, Cursor};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use base64::{Engine as _, engine::general_purpose};
use mozjpeg_rs::{Encoder, Preset};
use tauri::{AppHandle, Manager, State};

use crate::AppState;
use crate::app_settings::LutFileSettings;
use crate::cache_utils::calculate_transform_hash;
use crate::image_processing::{
    RenderRequest, get_all_adjustments_from_json, process_and_get_dynamic_image,
    resolve_tonemapper_override_from_handle,
};
use std::collections::HashMap;

const HDR_LUT_TOTAL_RANGE: f32 = 32.0;
const HDR_LUT_SIZE: u32 = 65;

#[derive(Debug, Clone)]
pub struct Lut {
    pub size: u32,
    pub data: Vec<f32>,
    pub hdr_size: u32,
    pub hdr_data: Vec<f32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LutEntry {
    pub name: String,
    pub path: String,
}

#[derive(Serialize)]
pub struct LutRenameResult {
    pub old_path: String,
    pub new_path: String,
    pub name: String,
}

#[derive(Serialize)]
pub struct LutParseResult {
    pub size: u32,
}

#[derive(Serialize)]
pub struct LutPreview {
    pub path: String,
    pub thumb: Option<String>,
}

pub fn get_luts_dir(app_data_dir: &Path) -> anyhow::Result<PathBuf> {
    let luts_dir = app_data_dir.join("luts");
    if !luts_dir.exists() {
        create_dir_all(&luts_dir)?;
    }
    Ok(luts_dir)
}

pub fn list_luts_in_dir(dir: &Path) -> anyhow::Result<Vec<LutEntry>> {
    let mut entries: Vec<LutEntry> = Vec::new();
    if !dir.exists() {
        return Ok(entries);
    }
    for entry in read_dir(dir)? {
        let path = entry?.path();
        let extension = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        if extension == "cube" || extension == "3dl" {
            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("LUT")
                .to_string();
            entries.push(LutEntry {
                name,
                path: path.to_string_lossy().into_owned(),
            });
        }
    }
    entries.sort_by_key(|a| a.name.to_lowercase());
    Ok(entries)
}

fn unique_lut_destination(dir: &Path, stem: &str, extension: &str) -> PathBuf {
    let mut candidate = dir.join(format!("{}.{}", stem, extension));
    let mut suffix = 1;
    while candidate.exists() && suffix < 1000 {
        candidate = dir.join(format!("{} ({}).{}", stem, suffix, extension));
        suffix += 1;
    }
    candidate
}

pub fn import_luts_to_dir(dir: &Path, source_paths: &[String]) -> anyhow::Result<Vec<LutEntry>> {
    for source in source_paths {
        let source_path = Path::new(source);
        let extension = source_path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();

        // HALD image formats: extract .cube LUT instead of copying raw image
        if extension == "tiff" || extension == "tif" || extension == "png" {
            match import_hald_to_lut_dir(dir, source) {
                Ok(()) => continue,
                Err(error) => {
                    log::warn!("Skipping invalid HALD image '{}': {}", source, error);
                    continue;
                }
            }
        }

        if let Err(error) = parse_lut_file(source) {
            log::warn!("Skipping invalid LUT '{}': {}", source, error);
            continue;
        }

        #[cfg(target_os = "android")]
        if is_android_content_uri(source) {
            if let Err(error) = import_android_lut(source) {
                log::error!("Failed to import LUT from '{}': {}", source, error);
            }
            continue;
        }

        let stem = source_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("LUT");
        let destination = unique_lut_destination(dir, stem, &extension);
        if let Err(error) = copy(source_path, &destination) {
            log::error!("Failed to copy LUT '{}': {}", source, error);
        }
    }
    list_luts_in_dir(dir)
}

/// Import a standard square HALD image (TIFF/PNG) by extracting a .cube 3D LUT.
///
/// Uses the standard HALD layout: pixel at scanline index i = y*width + x
/// encodes the output colour for input (i/N², (i/N)%N, i%N).
/// The resulting .cube uses R-fastest (innermost) order, matching the Python
/// reference in hald_extract.py.
fn import_hald_to_lut_dir(dir: &Path, source: &str) -> anyhow::Result<()> {
    let img = image::open(source).map_err(|e| anyhow!("Failed to open HALD image: {}", e))?;
    let (width, height) = img.dimensions();

    if width == 0 || height == 0 {
        return Err(anyhow!("Empty HALD image"));
    }

    let total = (width as usize).saturating_mul(height as usize);

    // Find the largest cube N³ that fits (same algorithm as hald_extract.py)
    let n = {
        let cbrt = (total as f64).cbrt();
        let mut n = cbrt.floor() as usize;
        while (n + 1).saturating_pow(3) <= total {
            n += 1;
        }
        n
    };
    let used = n.saturating_pow(3);

    if n < 2 {
        return Err(anyhow!(
            "HALD image too small: {width}×{height} pixels, need at least a 2³ cube"
        ));
    }

    let rgb = img.to_rgb8();
    let raw = rgb.as_raw();
    let n_sq = n * n;

    let stem = Path::new(source)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("HALD LUT");

    let mut out = String::with_capacity(used * 30); // ~30 bytes per line
    out.push_str(&format!("TITLE \"{stem}\"\n"));
    out.push_str(&format!("LUT_3D_SIZE {n}\n"));
    out.push_str("DOMAIN_MIN 0.0 0.0 0.0\n");
    out.push_str("DOMAIN_MAX 1.0 1.0 1.0\n\n");

    let max_pixel_idx = raw.len().saturating_sub(3);

    // Write .cube in R-fastest order: for B→G→R, look up HALD pixel at
    // index R*N² + G*N + B (inverse of the standard HALD encoding where
    // pixel index = R_in * N² + G_in * N + B_in).
    for b in 0..n {
        for g in 0..n {
            for r in 0..n {
                let hald_idx = r * n_sq + g * n + b;
                let px = hald_idx * 3;
                if px <= max_pixel_idx {
                    let ro = raw[px] as f32 / 255.0;
                    let go = raw[px + 1] as f32 / 255.0;
                    let bo = raw[px + 2] as f32 / 255.0;
                    out.push_str(&format!("{ro:.6} {go:.6} {bo:.6}\n"));
                } else {
                    // Padding: identity fallback for pixels beyond image bounds
                    let ro = r as f32 / (n - 1) as f32;
                    let go = g as f32 / (n - 1) as f32;
                    let bo = b as f32 / (n - 1) as f32;
                    out.push_str(&format!("{ro:.6} {go:.6} {bo:.6}\n"));
                }
            }
        }
    }

    let destination = unique_lut_destination(dir, stem, "cube");
    std::fs::write(&destination, out.as_bytes())?;
    log::info!(
        "Extracted {n}³ LUT from HALD image ({width}×{height}) → {}",
        destination.display()
    );
    Ok(())
}

#[cfg(target_os = "android")]
fn import_android_lut(source: &str) -> anyhow::Result<()> {
    let resolved_name = resolve_android_content_uri_name(source)
        .map_err(|e| anyhow!("Failed to resolve content URI: {}", e))?;
    let stem = Path::new(&resolved_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("LUT")
        .to_string();
    let extension = Path::new(&resolved_name)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("cube")
        .to_lowercase();
    let bytes = read_android_content_uri(source)
        .map_err(|e| anyhow!("Failed to read content URI: {}", e))?;

    let cache_path = get_android_cached_lut_path(source, &extension)?;
    let cache_dir = cache_path
        .parent()
        .ok_or_else(|| anyhow!("Invalid cache path"))?
        .to_path_buf();
    let destination = unique_lut_destination(&cache_dir, &stem, &extension);
    std::fs::write(&destination, &bytes)?;
    Ok(())
}

fn build_hdr_lut(original: &Lut) -> (u32, Vec<f32>) {
    let size = HDR_LUT_SIZE as usize;
    let orig_size = original.size as usize;
    let mut data = Vec::with_capacity(size * size * size * 3);

    fn sample_trilinear(data: &[f32], size: usize, u: f32, v: f32, w: f32) -> [f32; 3] {
        let max = (size - 1) as f32;
        let x = u.clamp(0.0, 1.0) * max;
        let y = v.clamp(0.0, 1.0) * max;
        let z = w.clamp(0.0, 1.0) * max;
        let x0 = x.floor() as usize;
        let y0 = y.floor() as usize;
        let z0 = z.floor() as usize;
        let x1 = (x0 + 1).min(size - 1);
        let y1 = (y0 + 1).min(size - 1);
        let z1 = (z0 + 1).min(size - 1);
        let fx = x - x0 as f32;
        let fy = y - y0 as f32;
        let fz = z - z0 as f32;

        let idx = |x, y, z| ((z * size + y) * size + x) * 3;

        let mut out = [0.0f32; 3];
        for c in 0..3 {
            let c000 = data[idx(x0, y0, z0) + c];
            let c001 = data[idx(x0, y0, z1) + c];
            let c010 = data[idx(x0, y1, z0) + c];
            let c011 = data[idx(x0, y1, z1) + c];
            let c100 = data[idx(x1, y0, z0) + c];
            let c101 = data[idx(x1, y0, z1) + c];
            let c110 = data[idx(x1, y1, z0) + c];
            let c111 = data[idx(x1, y1, z1) + c];

            let c00 = c000 * (1.0 - fz) + c001 * fz;
            let c01 = c010 * (1.0 - fz) + c011 * fz;
            let c10 = c100 * (1.0 - fz) + c101 * fz;
            let c11 = c110 * (1.0 - fz) + c111 * fz;

            let c0 = c00 * (1.0 - fy) + c01 * fy;
            let c1 = c10 * (1.0 - fy) + c11 * fy;

            out[c] = c0 * (1.0 - fx) + c1 * fx;
        }
        out
    }

    for b in 0..size {
        let w = b as f32 / (size - 1) as f32;
        for g in 0..size {
            let v = g as f32 / (size - 1) as f32;
            for r in 0..size {
                let u = r as f32 / (size - 1) as f32;
                let rgb = sample_trilinear(&original.data, orig_size, u, v, w);
                for c in 0..3 {
                    let log_y = (rgb[c] - 0.5) * HDR_LUT_TOTAL_RANGE;
                    data.push(2.0f32.powf(log_y));
                }
            }
        }
    }
    (HDR_LUT_SIZE, data)
}

fn parse_cube(reader: impl BufRead) -> anyhow::Result<Lut> {
    let mut size: Option<u32> = None;
    let mut data: Vec<f32> = Vec::new();
    let mut line_num = 0;

    for line in reader.lines() {
        line_num += 1;
        let line = line?;
        let trimmed = line.trim();

        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }

        match parts[0].to_uppercase().as_str() {
            "TITLE" | "DOMAIN_MIN" | "DOMAIN_MAX" => continue,

            "LUT_3D_SIZE" => {
                if parts.len() < 2 {
                    return Err(anyhow!(
                        "Malformed LUT_3D_SIZE on line {}: '{}'",
                        line_num,
                        line
                    ));
                }
                size = Some(parts[1].parse().map_err(|e| {
                    anyhow!(
                        "Failed to parse LUT_3D_SIZE on line {}: '{}'. Error: {}",
                        line_num,
                        line,
                        e
                    )
                })?);
            }
            _ => {
                if size.is_some() {
                    if parts.len() < 3 {
                        return Err(anyhow!(
                            "Invalid data line on line {}: '{}'. Expected 3 float values, found {}",
                            line_num,
                            line,
                            parts.len()
                        ));
                    }
                    let r: f32 = parts[0].parse().map_err(|e| {
                        anyhow!(
                            "Failed to parse R value on line {}: '{}'. Error: {}",
                            line_num,
                            line,
                            e
                        )
                    })?;
                    let g: f32 = parts[1].parse().map_err(|e| {
                        anyhow!(
                            "Failed to parse G value on line {}: '{}'. Error: {}",
                            line_num,
                            line,
                            e
                        )
                    })?;
                    let b: f32 = parts[2].parse().map_err(|e| {
                        anyhow!(
                            "Failed to parse B value on line {}: '{}'. Error: {}",
                            line_num,
                            line,
                            e
                        )
                    })?;
                    data.push(r);
                    data.push(g);
                    data.push(b);
                }
            }
        }
    }

    let lut_size = size.ok_or(anyhow!("LUT_3D_SIZE not found in .cube file"))?;
    let expected_len = (lut_size * lut_size * lut_size * 3) as usize;
    if data.len() != expected_len {
        return Err(anyhow!(
            "LUT data size mismatch. Expected {} float values (for size {}), but found {}. The file may be corrupt or incomplete.",
            expected_len,
            lut_size,
            data.len()
        ));
    }

    let lut = Lut {
        size: lut_size,
        data,
        hdr_size: 0,
        hdr_data: Vec::new(),
    };
    let (hdr_size, hdr_data) = build_hdr_lut(&lut);
    Ok(Lut {
        size: lut_size,
        data: lut.data,
        hdr_size,
        hdr_data,
    })
}

fn parse_3dl(reader: impl BufRead) -> anyhow::Result<Lut> {
    let mut data: Vec<f32> = Vec::new();

    for line in reader.lines() {
        let line = line?;
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() == 3 {
            let r: f32 = parts[0].parse()?;
            let g: f32 = parts[1].parse()?;
            let b: f32 = parts[2].parse()?;
            data.push(r);
            data.push(g);
            data.push(b);
        }
    }

    let total_values = data.len();
    if total_values == 0 {
        return Err(anyhow!("No data found in 3DL file"));
    }
    let num_entries = total_values / 3;
    let size = (num_entries as f64).cbrt().round() as u32;

    if size * size * size != num_entries as u32 {
        return Err(anyhow!(
            "Invalid 3DL LUT data size: the number of entries ({}) is not a perfect cube.",
            num_entries
        ));
    }

    let lut = Lut {
        size,
        data,
        hdr_size: 0,
        hdr_data: Vec::new(),
    };
    let (hdr_size, hdr_data) = build_hdr_lut(&lut);
    Ok(Lut {
        size,
        data: lut.data,
        hdr_size,
        hdr_data,
    })
}

fn parse_hald(image: DynamicImage) -> anyhow::Result<Lut> {
    let (width, height) = image.dimensions();
    if width != height {
        return Err(anyhow!(
            "HALD image must be square, but dimensions are {}x{}",
            width,
            height
        ));
    }

    let total_pixels = width * height;
    let size = (total_pixels as f64).cbrt().round() as u32;

    if size * size * size != total_pixels {
        return Err(anyhow!(
            "Invalid HALD image dimensions: total pixels ({}) is not a perfect cube.",
            total_pixels
        ));
    }

    let mut data = Vec::with_capacity((total_pixels * 3) as usize);
    let rgb_image = image.to_rgb8();

    for pixel in rgb_image.pixels() {
        data.push(pixel[0] as f32 / 255.0);
        data.push(pixel[1] as f32 / 255.0);
        data.push(pixel[2] as f32 / 255.0);
    }

    let lut = Lut {
        size,
        data,
        hdr_size: 0,
        hdr_data: Vec::new(),
    };
    let (hdr_size, hdr_data) = build_hdr_lut(&lut);
    Ok(Lut {
        size,
        data: lut.data,
        hdr_size,
        hdr_data,
    })
}

pub fn parse_lut_file(path_str: &str) -> anyhow::Result<Lut> {
    let (extension, bytes): (String, Option<Vec<u8>>) =
        if cfg!(target_os = "android") && is_android_content_uri(path_str) {
            #[cfg(target_os = "android")]
            {
                let resolved_name = resolve_android_content_uri_name(path_str)
                    .unwrap_or_else(|_| path_str.to_string());
                let ext = Path::new(&resolved_name)
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("cube")
                    .to_lowercase();
                let uri_bytes = read_android_content_uri(path_str).map_err(|e| anyhow!("{}", e))?;
                (ext, Some(uri_bytes))
            }
            #[cfg(not(target_os = "android"))]
            {
                (String::new(), None)
            }
        } else {
            let ext = Path::new(path_str)
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            (ext, None)
        };

    match extension.as_str() {
        "cube" => {
            if let Some(b) = bytes {
                parse_cube(BufReader::new(Cursor::new(b)))
            } else {
                let file = File::open(path_str)?;
                parse_cube(BufReader::new(file))
            }
        }
        "3dl" => {
            if let Some(b) = bytes {
                parse_3dl(BufReader::new(Cursor::new(b)))
            } else {
                let file = File::open(path_str)?;
                parse_3dl(BufReader::new(file))
            }
        }
        "png" | "jpg" | "jpeg" | "tiff" => {
            let img = if let Some(b) = bytes {
                image::load_from_memory(&b)?
            } else {
                image::open(path_str)?
            };
            parse_hald(img)
        }
        _ => Err(anyhow!("Unsupported LUT file format: {}", extension)),
    }
}

pub fn generate_identity_lut_image(size: u32) -> DynamicImage {
    let width = size;
    let height = size * size;
    let mut img = Rgb32FImage::new(width, height);

    for z in 0..size {
        for y in 0..size {
            for x in 0..size {
                let r = x as f32 / (size - 1) as f32;
                let g = y as f32 / (size - 1) as f32;
                let b = z as f32 / (size - 1) as f32;

                img.put_pixel(x, z * size + y, Rgb([r, g, b]));
            }
        }
    }

    DynamicImage::ImageRgb32F(img)
}

pub fn convert_image_to_cube_lut(image: &DynamicImage, size: u32) -> Result<Vec<u8>, String> {
    let f32_image = image.to_rgb32f();
    let mut out = String::new();

    out.push_str(&format!("LUT_3D_SIZE {}\n", size));
    out.push_str("DOMAIN_MIN 0.0 0.0 0.0\n");
    out.push_str("DOMAIN_MAX 1.0 1.0 1.0\n");

    for z in 0..size {
        for y in 0..size {
            for x in 0..size {
                let pixel = f32_image.get_pixel(x, z * size + y);
                out.push_str(&format!(
                    "{:.6} {:.6} {:.6}\n",
                    pixel[0].clamp(0.0, 1.0),
                    pixel[1].clamp(0.0, 1.0),
                    pixel[2].clamp(0.0, 1.0)
                ));
            }
        }
    }

    Ok(out.into_bytes())
}

pub fn get_or_load_lut(state: &State<AppState>, path: &str) -> Result<Arc<Lut>, String> {
    let mut cache = state.lut_cache.lock().unwrap();
    if let Some(lut) = cache.get(path) {
        return Ok(lut.clone());
    }

    let lut = parse_lut_file(path).map_err(|e| e.to_string())?;
    let arc_lut = Arc::new(lut);
    cache.insert(path.to_string(), arc_lut.clone());
    Ok(arc_lut)
}

#[tauri::command]
pub fn list_luts(app_handle: AppHandle) -> Result<Vec<LutEntry>, String> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let luts_dir = get_luts_dir(&data_dir).map_err(|e| e.to_string())?;

    #[cfg(target_os = "android")]
    {
        combined_lut_list(&luts_dir).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        list_luts_in_dir(&luts_dir).map_err(|e| e.to_string())
    }
}

#[cfg(target_os = "android")]
fn get_lut_cache_dir() -> anyhow::Result<PathBuf> {
    let cache_path = get_android_cached_lut_path("_", "tmp")?;
    cache_path
        .parent()
        .ok_or_else(|| anyhow!("Invalid cache path"))
        .map(|p| p.to_path_buf())
}

#[cfg(target_os = "android")]
fn list_luts_in_cache() -> anyhow::Result<Vec<LutEntry>> {
    let cache_dir = get_lut_cache_dir()?;

    if !cache_dir.exists() {
        return Ok(Vec::new());
    }

    let mut entries: Vec<LutEntry> = Vec::new();
    for entry in read_dir(&cache_dir)? {
        let path = entry?.path();
        let extension = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        if extension == "cube" || extension == "3dl" {
            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("LUT")
                .to_string();
            entries.push(LutEntry {
                name,
                path: path.to_string_lossy().into_owned(),
            });
        }
    }
    entries.sort_by_key(|a| a.name.to_lowercase());
    Ok(entries)
}

#[cfg(target_os = "android")]
fn combined_lut_list(luts_dir: &Path) -> anyhow::Result<Vec<LutEntry>> {
    let mut entries = list_luts_in_dir(luts_dir)?;
    if let Ok(cached) = list_luts_in_cache() {
        entries.extend(cached);
    }
    Ok(entries)
}

#[tauri::command]
pub fn import_luts(
    app_handle: AppHandle,
    source_paths: Vec<String>,
) -> Result<Vec<LutEntry>, String> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let luts_dir = get_luts_dir(&data_dir).map_err(|e| e.to_string())?;
    import_luts_to_dir(&luts_dir, &source_paths).map_err(|e| e.to_string())?;

    #[cfg(target_os = "android")]
    {
        combined_lut_list(&luts_dir).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        list_luts_in_dir(&luts_dir).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn remove_lut(app_handle: AppHandle, path: String) -> Result<Vec<LutEntry>, String> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let luts_dir = get_luts_dir(&data_dir).map_err(|e| e.to_string())?;
    let target_path = PathBuf::from(&path);

    #[cfg(target_os = "android")]
    {
        let cache_dir = get_lut_cache_dir().map_err(|e| e.to_string())?;
        if !target_path.starts_with(&luts_dir) && !target_path.starts_with(&cache_dir) {
            return Err(
                "Access denied: Cannot remove files outside the user LUT directory".to_string(),
            );
        }
    }
    #[cfg(not(target_os = "android"))]
    if !target_path.starts_with(&luts_dir) {
        return Err(
            "Access denied: Cannot remove files outside the user LUT directory".to_string(),
        );
    }

    if target_path.exists() {
        std::fs::remove_file(&target_path).map_err(|e| e.to_string())?;
    } else {
        return Err("LUT file not found".to_string());
    }

    #[cfg(target_os = "android")]
    {
        combined_lut_list(&luts_dir).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        list_luts_in_dir(&luts_dir).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn rename_lut(
    app_handle: AppHandle,
    path: String,
    new_name: String,
) -> Result<LutRenameResult, String> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let luts_dir = get_luts_dir(&data_dir).map_err(|e| e.to_string())?;
    let old_path = PathBuf::from(&path);

    #[cfg(target_os = "android")]
    {
        let cache_dir = get_lut_cache_dir().map_err(|e| e.to_string())?;
        if !old_path.starts_with(&luts_dir) && !old_path.starts_with(&cache_dir) {
            return Err(
                "Access denied: Cannot rename files outside the user LUT directory".to_string(),
            );
        }
    }
    #[cfg(not(target_os = "android"))]
    if !old_path.starts_with(&luts_dir) {
        return Err(
            "Access denied: Cannot rename files outside the user LUT directory".to_string(),
        );
    }

    if !old_path.exists() {
        return Err("LUT file not found".to_string());
    }

    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err("New name cannot be empty".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("New name cannot contain path separators".to_string());
    }

    let extension = old_path.extension().and_then(|s| s.to_str()).unwrap_or("");
    let mut final_name = trimmed.to_string();
    let new_has_ext = Path::new(&final_name).extension().is_some();
    if !new_has_ext && !extension.is_empty() {
        final_name.push('.');
        final_name.push_str(extension);
    }

    let new_path = luts_dir.join(&final_name);
    if new_path.exists() {
        return Err("A LUT with that name already exists".to_string());
    }

    std::fs::rename(&old_path, &new_path).map_err(|e| e.to_string())?;

    let name = new_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("LUT")
        .to_string();

    Ok(LutRenameResult {
        old_path: path,
        new_path: new_path.to_string_lossy().into_owned(),
        name,
    })
}

fn render_lut_swatch(
    context: &crate::image_processing::GpuContext,
    state: &State<AppState>,
    base_image: &DynamicImage,
    transform_hash: u64,
    adjustments: crate::image_processing::AllAdjustments,
    lut_path: Option<&str>,
) -> Option<String> {
    let lut = lut_path.and_then(|p| get_or_load_lut(state, p).ok());
    let processed = process_and_get_dynamic_image(
        context,
        state,
        base_image,
        transform_hash,
        RenderRequest {
            adjustments,
            mask_bitmaps: &[],
            lut,
            roi: None,
            grain_mip_level: 0.0,
            grain_coord_scale: 1.0,
            grain_boost: 1.0,
            grain_view: None,
        },
        "generate_lut_previews",
    )
    .ok()?;

    let rgb = processed.to_rgb8();
    let (width, height) = rgb.dimensions();
    let bytes = Encoder::new(Preset::BaselineFastest)
        .quality(80)
        .encode_rgb(&rgb.into_vec(), width, height)
        .ok()?;
    Some(format!(
        "data:image/jpeg;base64,{}",
        general_purpose::STANDARD.encode(&bytes)
    ))
}

#[tauri::command]
pub fn generate_lut_previews(
    lut_paths: Vec<String>,
    size: u32,
    lut_params: Option<HashMap<String, LutFileSettings>>,
    adjustments: Option<serde_json::Value>,
    state: State<AppState>,
    app_handle: AppHandle,
) -> Result<Vec<LutPreview>, String> {
    let context = crate::image_processing::get_or_init_gpu_context(&state, &app_handle)?;
    let loaded_image = state
        .original_image
        .lock()
        .unwrap()
        .clone()
        .ok_or("No original image loaded for LUT previews")?;
    let is_raw = loaded_image.is_raw;

    let mut base_json = adjustments.unwrap_or_else(|| serde_json::json!({}));
    let norm_factor = state.get_lut_input_norm_factor(&loaded_image);
    base_json["lutInputNormFactor"] = serde_json::json!(norm_factor);
    let (base_image, _scale, _offset) =
        crate::generate_transformed_preview(&state, &loaded_image, &base_json, size)?;

    let tm_override = resolve_tonemapper_override_from_handle(&app_handle, is_raw);
    let transform_hash = calculate_transform_hash(&base_json);

    // Swatches render with the user's current adjustments as a base, then each
    // LUT's saved parameters override the LUT-specific fields so the thumbnail
    // matches what selecting that LUT will apply.
    let previews = lut_paths
        .into_iter()
        .map(|path| {
            // The empty path is a sentinel for the "no LUT" preview used by the
            // gesture strip: it shows the current grade without any LUT applied.
            if path.is_empty() {
                let mut merged_json = base_json.clone();
                if let Some(obj) = merged_json.as_object_mut() {
                    obj.remove("lutPath");
                    obj.remove("lutName");
                    obj.remove("lutData");
                    obj.remove("lutSize");
                    obj.insert("lutIntensity".to_string(), serde_json::json!(100));
                    obj.insert("lutTiming".to_string(), serde_json::json!("before"));
                    obj.insert("lutNormalizeMode".to_string(), serde_json::json!("hdr"));
                    obj.insert("lutInputRange".to_string(), serde_json::json!(6.0));
                    obj.insert("lutInputOffset".to_string(), serde_json::json!(0.0));
                    obj.insert(
                        "lutOffsetCompensation".to_string(),
                        serde_json::json!(false),
                    );
                    obj.insert("lutWbTemperatureShift".to_string(), serde_json::json!(0.0));
                    obj.insert("lutWbTintShift".to_string(), serde_json::json!(0.0));
                    obj.insert("lutFlimContrast".to_string(), serde_json::json!(0.0));
                    obj.insert("lutFlimLights".to_string(), serde_json::json!(0.0));
                    obj.insert("lutFlimShadows".to_string(), serde_json::json!(0.0));
                    obj.insert("lutSaturation".to_string(), serde_json::json!(0.0));
                    obj.insert("lutVibrance".to_string(), serde_json::json!(0.0));
                    let section_visibility = obj
                        .entry("sectionVisibility")
                        .or_insert_with(|| serde_json::json!({}));
                    if let Some(sec) = section_visibility.as_object_mut() {
                        sec.insert("effects".to_string(), serde_json::json!(true));
                        sec.insert("lut".to_string(), serde_json::json!(true));
                    } else {
                        *section_visibility = serde_json::json!({ "effects": true, "lut": true });
                    }
                }
                let adjustments = get_all_adjustments_from_json(&merged_json, is_raw, tm_override);
                let thumb = render_lut_swatch(
                    &context,
                    &state,
                    &base_image,
                    transform_hash,
                    adjustments,
                    None,
                );
                return LutPreview { path, thumb };
            }

            let params = lut_params.as_ref().and_then(|map| map.get(&path));
            let lut_name = Path::new(&path)
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| "LUT".to_string());
            let intensity = params.and_then(|p| p.intensity).unwrap_or(100);
            let timing = params.and_then(|p| p.timing.as_deref()).unwrap_or("before");
            let normalize_mode = if timing == "after" { "clamp" } else { "hdr" };
            let input_range = params.and_then(|p| p.input_range).unwrap_or(6.0);
            let input_offset = params.and_then(|p| p.input_offset).unwrap_or(0.0);
            let offset_compensation = params.and_then(|p| p.offset_compensation).unwrap_or(false);
            let wb_temperature_shift = params.and_then(|p| p.wb_temperature_shift).unwrap_or(0.0);
            let wb_tint_shift = params.and_then(|p| p.wb_tint_shift).unwrap_or(0.0);
            let flim_contrast = params.and_then(|p| p.flim_contrast).unwrap_or(0.0);
            let flim_lights = params.and_then(|p| p.flim_lights).unwrap_or(0.0);
            let flim_shadows = params.and_then(|p| p.flim_shadows).unwrap_or(0.0);
            let saturation = params.and_then(|p| p.saturation).unwrap_or(0.0);
            let vibrance = params.and_then(|p| p.vibrance).unwrap_or(0.0);

            let mut merged_json = base_json.clone();
            if let Some(obj) = merged_json.as_object_mut() {
                obj.insert("lutPath".to_string(), serde_json::json!(path));
                obj.insert("lutName".to_string(), serde_json::json!(lut_name));
                obj.insert("lutIntensity".to_string(), serde_json::json!(intensity));
                obj.insert("lutTiming".to_string(), serde_json::json!(timing));
                obj.insert(
                    "lutNormalizeMode".to_string(),
                    serde_json::json!(normalize_mode),
                );
                obj.insert("lutInputRange".to_string(), serde_json::json!(input_range));
                obj.insert(
                    "lutInputOffset".to_string(),
                    serde_json::json!(input_offset),
                );
                obj.insert(
                    "lutOffsetCompensation".to_string(),
                    serde_json::json!(offset_compensation),
                );
                obj.insert(
                    "lutWbTemperatureShift".to_string(),
                    serde_json::json!(wb_temperature_shift),
                );
                obj.insert(
                    "lutWbTintShift".to_string(),
                    serde_json::json!(wb_tint_shift),
                );
                obj.insert(
                    "lutFlimContrast".to_string(),
                    serde_json::json!(flim_contrast),
                );
                obj.insert(
                    "lutFlimLights".to_string(),
                    serde_json::json!(flim_lights),
                );
                obj.insert(
                    "lutFlimShadows".to_string(),
                    serde_json::json!(flim_shadows),
                );
                obj.insert(
                    "lutSaturation".to_string(),
                    serde_json::json!(saturation),
                );
                obj.insert(
                    "lutVibrance".to_string(),
                    serde_json::json!(vibrance),
                );
                let section_visibility = obj
                    .entry("sectionVisibility")
                    .or_insert_with(|| serde_json::json!({}));
                if let Some(sec) = section_visibility.as_object_mut() {
                    sec.insert("effects".to_string(), serde_json::json!(true));
                    sec.insert("lut".to_string(), serde_json::json!(true));
                } else {
                    *section_visibility = serde_json::json!({ "effects": true, "lut": true });
                }
            }

            let adjustments = get_all_adjustments_from_json(&merged_json, is_raw, tm_override);
            let thumb = render_lut_swatch(
                &context,
                &state,
                &base_image,
                transform_hash,
                adjustments,
                Some(&path),
            );
            LutPreview { path, thumb }
        })
        .collect();

    Ok(previews)
}

#[tauri::command]
pub fn load_and_parse_lut(path: String, state: State<AppState>) -> Result<LutParseResult, String> {
    let lut = parse_lut_file(&path).map_err(|e| e.to_string())?;
    let lut_size = lut.size;

    let mut cache = state.lut_cache.lock().unwrap();
    cache.insert(path, Arc::new(lut));

    Ok(LutParseResult { size: lut_size })
}
