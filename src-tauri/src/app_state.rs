use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Condvar, Mutex};

use image::{DynamicImage, GenericImageView, GrayImage};
use serde::{Deserialize, Serialize};
use tauri::async_runtime::JoinHandle as AsyncJoinHandle;
use tokio::sync::Mutex as TokioMutex;
use tokio::task::JoinHandle;
use wgpu::{Texture, TextureView};

use crate::ai_processing::AiState;
use crate::cache_utils::DecodedImageCache;
use crate::gpu_processing::GpuProcessor;
use crate::image_processing::GpuContext;
use crate::lens_correction::LensDatabase;
use crate::lut_processing::Lut;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExternalEditSession {
    pub source: String,
    pub output: String,
    pub format: String,
    pub jpeg_quality: u8,
}

#[derive(Serialize, Deserialize)]
pub struct WindowState {
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub maximized: bool,
    pub fullscreen: bool,
}

#[derive(Clone)]
pub struct LoadedImage {
    pub path: String,
    pub image: Arc<DynamicImage>,
    pub is_raw: bool,
}

#[derive(Clone)]
pub struct CachedPreview {
    pub image: Arc<DynamicImage>,
    pub small_image: Arc<DynamicImage>,
    pub transform_hash: u64,
    pub scale: f32,
    pub unscaled_crop_offset: (f32, f32),
    pub preview_dim: u32,
    pub interactive_divisor: f32,
}

pub struct GpuImageCache {
    pub texture: Texture,
    pub texture_view: TextureView,
    pub width: u32,
    pub height: u32,
    pub transform_hash: u64,
}

pub struct GpuProcessorState {
    pub processor: GpuProcessor,
    pub width: u32,
    pub height: u32,
}

pub struct PreviewJob {
    pub adjustments: serde_json::Value,
    pub is_interactive: bool,
    pub target_resolution: Option<u32>,
    /// Explicit grain mip level from the frontend (screen-space zoom aware).
    /// None = derive from the render downscale (legacy behavior).
    pub grain_mip_level: Option<f32>,
    pub roi: Option<(f32, f32, f32, f32)>,
    pub compute_waveform: bool,
    pub active_waveform_channel: Option<String>,
    pub responder: tokio::sync::oneshot::Sender<Vec<u8>>,
}

pub struct AnalyticsJob {
    pub path: String,
    pub image: Arc<DynamicImage>,
    pub compute_waveform: bool,
    pub active_waveform_channel: Option<String>,
}

pub struct AnalyticsConfig {
    pub path: String,
    pub compute_waveform: bool,
    pub active_waveform_channel: Option<String>,
    pub sender: Sender<AnalyticsJob>,
}

pub struct ThumbnailProgressTracker {
    pub total: usize,
    pub completed: usize,
}

pub struct ThumbnailManager {
    pub queue: Mutex<VecDeque<String>>,
    pub cvar: Condvar,
    pub processing_now: Mutex<HashSet<String>>,
}

impl ThumbnailManager {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            queue: Mutex::new(VecDeque::new()),
            cvar: Condvar::new(),
            processing_now: Mutex::new(HashSet::new()),
        })
    }
}

pub struct PendingMetadata {
    pub virtual_path: String,
    pub image_path: PathBuf,
    pub sidecar_path: PathBuf,
}

pub struct MetadataManager {
    pub queue: Mutex<VecDeque<PendingMetadata>>,
    pub cvar: Condvar,
    pub pending: Mutex<HashSet<PathBuf>>,
}

impl MetadataManager {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            queue: Mutex::new(VecDeque::new()),
            cvar: Condvar::new(),
            pending: Mutex::new(HashSet::new()),
        })
    }
}

pub type TransformedImageCache = (u64, Arc<DynamicImage>, (f32, f32));

pub struct FolderImportHandle {
    pub cancel: Arc<AtomicBool>,
    pub handle: AsyncJoinHandle<()>,
    /// Number of files processed by the scan phase; used when the job is
    /// cancelled so the frontend can show how far it got.
    pub processed: Arc<AtomicUsize>,
}

pub struct AppState {
    pub window_setup_complete: AtomicBool,
    pub gpu_crash_flag_path: Mutex<Option<PathBuf>>,
    pub original_image: Mutex<Option<LoadedImage>>,
    pub cached_preview: Mutex<Option<CachedPreview>>,
    pub gpu_context: Mutex<Option<GpuContext>>,
    pub gpu_image_cache: Mutex<Option<GpuImageCache>>,
    pub gpu_processor: Mutex<Option<GpuProcessorState>>,
    pub ai_state: Mutex<Option<AiState>>,
    pub ai_init_lock: TokioMutex<()>,
    pub export_task_handle: Mutex<Option<JoinHandle<()>>>,
    pub folder_import_jobs: Arc<Mutex<HashMap<String, FolderImportHandle>>>,
    pub hdr_result: Arc<Mutex<Option<DynamicImage>>>,
    pub panorama_result: Arc<Mutex<Option<DynamicImage>>>,
    pub denoise_result: Arc<Mutex<Option<DynamicImage>>>,
    pub indexing_task_handle: Mutex<Option<JoinHandle<()>>>,
    pub lut_cache: Mutex<HashMap<String, Arc<Lut>>>,
    pub initial_file_path: Mutex<Option<String>>,
    pub pending_edit_session: Mutex<Option<ExternalEditSession>>,
    pub thumbnail_cancellation_token: Arc<AtomicBool>,
    pub thumbnail_progress: Mutex<ThumbnailProgressTracker>,
    pub preview_worker_tx: Mutex<Option<Sender<PreviewJob>>>,
    pub analytics_worker_tx: Mutex<Option<Sender<AnalyticsJob>>>,
    pub mask_cache: Mutex<HashMap<u64, GrayImage>>,
    pub patch_cache: Mutex<HashMap<String, serde_json::Value>>,
    pub geometry_cache: Mutex<HashMap<u64, DynamicImage>>,
    pub thumbnail_geometry_cache: Mutex<HashMap<String, (u64, DynamicImage, f32)>>,
    pub lens_db: Mutex<Option<Arc<LensDatabase>>>,
    pub load_image_generation: Arc<AtomicUsize>,
    pub full_warped_cache: Mutex<Option<(u64, Arc<DynamicImage>)>>,
    pub full_transformed_cache: Mutex<Option<TransformedImageCache>>,
    /// Cached mean-luminance normalization factor for the currently loaded
    /// image, keyed by `load_image_generation` so it is recomputed on reload.
    pub lut_input_norm_cache: Mutex<Option<(usize, f32)>>,
    /// Cache of the last grain field baked for export, keyed by
    /// `crystal_grain::bake_cache_key`. Parallel export jobs with identical
    /// grain parameters share the texture; each job creates its own view.
    pub grain_bake_cache: Mutex<Option<(u64, Arc<wgpu::Texture>)>>,
    /// Serializes the CPU grain renderers (Pierre/IPOL) during export —
    /// they already saturate all cores via rayon, so concurrent renders
    /// would only thrash.
    pub grain_render_lock: Mutex<()>,
    /// Set by the `cancel_grain_render` command; the CPU grain renderers
    /// (Pierre/IPOL) poll it per row/layer and abort early.
    pub grain_cancel: AtomicBool,
    pub decoded_image_cache: Mutex<DecodedImageCache>,
    pub thumbnail_manager: Arc<ThumbnailManager>,
    pub metadata_manager: Arc<MetadataManager>,
}

impl AppState {
    /// Return the cached LUT input normalization factor for the loaded image,
    /// computing it on first access for each `load_image_generation`.
    pub fn get_lut_input_norm_factor(&self, loaded_image: &LoadedImage) -> f32 {
        let current_gen = self
            .load_image_generation
            .load(std::sync::atomic::Ordering::SeqCst);
        {
            let cache = self.lut_input_norm_cache.lock().unwrap();
            if let Some((cached_gen, factor)) = *cache {
                if cached_gen == current_gen {
                    return factor;
                }
            }
        }

        let factor = compute_lut_input_norm_factor(&loaded_image.image);
        let mut cache = self.lut_input_norm_cache.lock().unwrap();
        *cache = Some((current_gen, factor));
        factor
    }
}

/// Compute a scene-linear mean-luminance normalization factor for LUT input.
///
/// The image is downscaled to at most 256 px on the long side, then the
/// arithmetic mean of Rec. 709 linear luminance is returned, clamped to a
/// sane range so near-black or extremely bright images do not destabilize
/// the LUT math.
pub fn compute_lut_input_norm_factor(image: &DynamicImage) -> f32 {
    let (width, height) = image.dimensions();
    let max_dim = width.max(height);
    let ratio = if max_dim > 256 {
        256.0 / max_dim as f32
    } else {
        1.0
    };
    let new_w = (width as f32 * ratio).round() as u32;
    let new_h = (height as f32 * ratio).round() as u32;

    let downscaled = crate::image_processing::downscale_f32_image(image, new_w, new_h);
    let rgb = downscaled.to_rgb32f();
    let raw = rgb.as_raw();
    if raw.len() < 3 {
        return 1.0;
    }

    let mut sum = 0.0f64;
    for chunk in raw.chunks_exact(3) {
        let luma = 0.2126 * chunk[0].max(0.0) as f64
            + 0.7152 * chunk[1].max(0.0) as f64
            + 0.0722 * chunk[2].max(0.0) as f64;
        sum += luma;
    }
    let mean = sum / (raw.len() / 3) as f64;
    (mean as f32).clamp(1e-4, 1e4)
}
