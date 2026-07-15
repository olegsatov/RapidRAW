struct Point {
    x: f32,
    y: f32,
    _pad1: f32,
    _pad2: f32,
}

struct HslColor {
    hue: f32,
    saturation: f32,
    luminance: f32,
    _pad: f32,
}

struct ColorGradeSettings {
    hue: f32,
    saturation: f32,
    luminance: f32,
    _pad: f32,
}

struct ColorCalibrationSettings {
    shadows_tint: f32,
    red_hue: f32,
    red_saturation: f32,
    green_hue: f32,
    green_saturation: f32,
    blue_hue: f32,
    blue_saturation: f32,
    _pad1: f32,
}

struct GlobalAdjustments {
    exposure: f32,
    brightness: f32,
    contrast: f32,
    highlights: f32,
    shadows: f32,
    whites: f32,
    blacks: f32,
    saturation: f32,
    temperature: f32,
    tint: f32,
    vibrance: f32,
    hue: f32,
    _pad_color1: f32,
    _pad_color2: f32,
    _pad_color3: f32,

    sharpness: f32,
    luma_noise_reduction: f32,
    color_noise_reduction: f32,
    clarity: f32,
    dehaze: f32,
    structure: f32,
    centre: f32,
    vignette_amount: f32,
    vignette_midpoint: f32,
    vignette_roundness: f32,
    vignette_feather: f32,
    grain_amount: f32,
    grain_size: f32,
    grain_roughness: f32,

    chromatic_aberration_red_cyan: f32,
    chromatic_aberration_blue_yellow: f32,
    show_clipping: u32,
    is_raw_image: u32,
    _pad_ca1: f32,

    has_lut: u32,
    lut_intensity: f32,
    tonemapper_mode: u32,
    _pad_lut2: f32,
    _pad_lut3: f32,
    _pad_lut4: f32,
    _pad_lut5: f32,

    _pad_agx1: f32,
    _pad_agx2: f32,
    _pad_agx3: f32,
    agx_pipe_to_rendering_matrix: mat3x3<f32>,
    agx_rendering_to_pipe_matrix: mat3x3<f32>,

    _pad_cg1: f32,
    _pad_cg2: f32,
    _pad_cg3: f32,
    _pad_cg4: f32,
    color_grading_shadows: ColorGradeSettings,
    color_grading_midtones: ColorGradeSettings,
    color_grading_highlights: ColorGradeSettings,
    color_grading_global: ColorGradeSettings,
    color_grading_blending: f32,
    color_grading_balance: f32,
    _pad2: f32,
    _pad3: f32,

    color_calibration: ColorCalibrationSettings,

    hsl: array<HslColor, 8>,
    luma_curve: array<Point, 16>,
    red_curve: array<Point, 16>,
    green_curve: array<Point, 16>,
    blue_curve: array<Point, 16>,
    luma_curve_count: u32,
    red_curve_count: u32,
    green_curve_count: u32,
    blue_curve_count: u32,
    _pad_end1: f32,
    _pad_end2: f32,
    _pad_end3: f32,
    _pad_end4: f32,

    glow_amount: f32,
    halation_amount: f32,
    flare_amount: f32,
    sharpness_threshold: f32,

    // Film simulation (Krea port). film_curves is chunked 16x16 to keep the
    // Rust mirror Pod/Default-friendly (fixed arrays > 32 lack Default).
    film_strength: f32,
    film_contrast: f32,
    film_saturation: f32,
    film_rolloff: f32,
    film_bleed: f32,
    film_cross: f32,
    _pad_film1: f32,
    _pad_film2: f32,
    film_base_color: vec3<f32>,
    _pad_film3: f32,
    film_shadow_tint: vec3<f32>,
    _pad_film4: f32,
    film_curves: array<array<vec3<f32>, 16>, 16>,

    // Film simulation — extended dials (Krea PoC "Film look" group).
    // shadows/highlights are applied per-pixel in apply_film_look; blur is
    // spatial and drives the film post-pass (film_post.wgsl).
    film_shadows: f32,    // -100..100
    film_highlights: f32, // -100..100
    film_blur: f32,                      // 0..1 (emulsion blur, sigma = film_blur * 3 px)
    film_blur_pre_amount: f32,            // 0..1 pre-tone diffusion strength
    film_blur_pre_radius: f32,            // 0.5..4 px (pre-tone blur radius)
    film_blur_pre_compensation: f32,      // 0..1 luma-preservation for diffusion
    film_blur_pre_soft_amount: f32,       // 0..1 pre-tone soft blur mix
    film_blur_pre_soft_radius: f32,       // 0.5..4 px (pre-tone soft blur radius)

    // Black & white conversion: weighted channel mix, weights normalized at
    // use. xyz = weights, w = enabled flag (vec3+pad idiom, see film_base_color).
    bw_weights: vec3<f32>,
    bw_enabled: f32,

    // Crystal grain (Pierre) realtime preview: baked coverage field sampled
    // in the film post-pass. x = amount 0..1, y = mono flag, zw = pad.
    crystal_grain: vec4<f32>,

    // flim (Filmic Color Transform) port — github.com/bean-mhm/flim (AGPLv3).
    // All preset-derived constants are baked on the CPU at adjustment-parse
    // time; this struct only carries the results. Layout MUST match the Rust
    // mirror in image_processing.rs.
    flim_extend_mat: mat3x3<f32>,
    flim_extend_mat_inv: mat3x3<f32>,
    flim_backlight: vec3<f32>,      // print backlight in the extended gamut
    flim_black_cap_luma: f32,       // auto: luma of developed black / white cap; else preset black point / 1000
    flim_white_cap: vec3<f32>,      // negative_and_print([1e7, 1e7, 1e7])
    flim_sigmoid_log2_max: f32,     // log2_min is hardcoded to -10
    flim_pre_filter: vec3<f32>,
    flim_pre_filter_strength: f32,
    flim_post_filter: vec3<f32>,
    flim_post_filter_strength: f32,
    flim_neg_exposure: f32,
    flim_neg_density: f32,
    flim_print_exposure: f32,
    flim_print_density: f32,
    flim_midtone_saturation: f32,
    flim_ev: f32,                   // preset pre-exposure + user EV offset
    flim_strength: f32,             // 0..1 mix against the non-AgX base look
    _pad_flim_end: f32,
    flim_warmth: vec3<f32>,         // per-channel gain along the daylight locus (pre-sigmoid)
    flim_adjacency: f32,            // log-domain unsharp (developer diffusion approx)
    flim_hi_tint: vec3<f32>,        // split-tone highlight tint (baked from slider, + = warm)
    _pad_flim_hi: f32,
    flim_sh_tint: vec3<f32>,        // split-tone shadow tint (baked from slider, + = warm)
    _pad_flim_sh: f32,

    lut_timing: u32,
    lut_normalize_mode: u32,
    lut_input_range: f32,
    lut_input_offset: f32,
    lut_shoulder: f32,
}

struct MaskAdjustments {
    exposure: f32,
    brightness: f32,
    contrast: f32,
    highlights: f32,
    shadows: f32,
    whites: f32,
    blacks: f32,
    saturation: f32,
    temperature: f32,
    tint: f32,
    vibrance: f32,

    sharpness: f32,
    luma_noise_reduction: f32,
    color_noise_reduction: f32,
    clarity: f32,
    dehaze: f32,
    structure: f32,

    glow_amount: f32,
    halation_amount: f32,
    flare_amount: f32,
    sharpness_threshold: f32,

    hue: f32,
    _pad_cg1: f32,
    _pad_cg2: f32,
    color_grading_shadows: ColorGradeSettings,
    color_grading_midtones: ColorGradeSettings,
    color_grading_highlights: ColorGradeSettings,
    color_grading_global: ColorGradeSettings,
    color_grading_blending: f32,
    color_grading_balance: f32,
    _pad5: f32,
    _pad6: f32,

    hsl: array<HslColor, 8>,
    luma_curve: array<Point, 16>,
    red_curve: array<Point, 16>,
    green_curve: array<Point, 16>,
    blue_curve: array<Point, 16>,
    luma_curve_count: u32,
    red_curve_count: u32,
    green_curve_count: u32,
    blue_curve_count: u32,
    _pad_end4: f32,
    _pad_end5: f32,
    _pad_end6: f32,
    _pad_end7: f32,
}

struct AllAdjustments {
    global: GlobalAdjustments,
    mask_adjustments: array<MaskAdjustments, 32>,
    mask_count: u32,
    tile_offset_x: u32,
    tile_offset_y: u32,
    mask_atlas_cols: u32,
}

struct HslRange {
    center: f32,
    width: f32,
}

const HSL_RANGES: array<HslRange, 8> = array<HslRange, 8>(
    HslRange(358.0, 35.0),  // Red
    HslRange(25.0, 45.0),   // Orange
    HslRange(60.0, 40.0),   // Yellow
    HslRange(115.0, 90.0),  // Green
    HslRange(180.0, 60.0),  // Aqua
    HslRange(225.0, 60.0),  // Blue
    HslRange(280.0, 55.0),  // Purple
    HslRange(330.0, 50.0)   // Magenta
);

@group(0) @binding(0) var pre_blur_texture: texture_2d<f32>;
@group(0) @binding(1) var output_texture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var pre_tone_linear_texture: texture_2d<f32>;
@group(0) @binding(3) var pre_soft_blur_texture: texture_2d<f32>;

@group(1) @binding(0) var<storage, read> adjustments: AllAdjustments;

@group(1) @binding(1) var mask_textures: texture_2d_array<f32>;

@group(1) @binding(2) var lut_texture: texture_3d<f32>;
@group(1) @binding(3) var lut_sampler: sampler;

@group(1) @binding(4) var sharpness_blur_texture: texture_2d<f32>;
@group(1) @binding(5) var tonal_blur_texture: texture_2d<f32>;
@group(1) @binding(6) var clarity_blur_texture: texture_2d<f32>;
@group(1) @binding(7) var structure_blur_texture: texture_2d<f32>;

@group(1) @binding(8) var flare_texture: texture_2d<f32>;
@group(1) @binding(9) var flare_sampler: sampler;

const LUMA_COEFF = vec3<f32>(0.2126, 0.7152, 0.0722);

fn get_luma(c: vec3<f32>) -> f32 {
    return dot(c, LUMA_COEFF);
}

fn srgb_to_linear(c: vec3<f32>) -> vec3<f32> {
    let cutoff = vec3<f32>(0.04045);
    let a = vec3<f32>(0.055);
    let higher = pow((c + a) / (1.0 + a), vec3<f32>(2.4));
    let lower = c / 12.92;
    return select(higher, lower, c <= cutoff);
}

fn linear_to_srgb(c: vec3<f32>) -> vec3<f32> {
    let c_clamped = clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
    let cutoff = vec3<f32>(0.0031308);
    let a = vec3<f32>(0.055);
    let higher = (1.0 + a) * pow(c_clamped, vec3<f32>(1.0 / 2.4)) - a;
    let lower = c_clamped * 12.92;
    return select(higher, lower, c_clamped <= cutoff);
}

fn linear_to_srgb_extended(c: vec3<f32>) -> vec3<f32> {
    let safe_c = max(c, vec3<f32>(0.0));
    let cutoff = vec3<f32>(0.0031308);
    let a = vec3<f32>(0.055);
    let higher = (1.0 + a) * pow(safe_c, vec3<f32>(1.0 / 2.4)) - a;
    let lower = safe_c * 12.92;
    return select(higher, lower, safe_c <= cutoff);
}

fn rgb_to_hsv(c: vec3<f32>) -> vec3<f32> {
    let c_max = max(c.r, max(c.g, c.b));
    let c_min = min(c.r, min(c.g, c.b));
    let delta = c_max - c_min;
    var h: f32 = 0.0;
    if (delta > 0.0) {
        if (c_max == c.r) { h = 60.0 * (((c.g - c.b) / delta) % 6.0); }
        else if (c_max == c.g) { h = 60.0 * (((c.b - c.r) / delta) + 2.0); }
        else { h = 60.0 * (((c.r - c.g) / delta) + 4.0); }
    }
    if (h < 0.0) { h += 360.0; }
    let s = select(0.0, delta / c_max, c_max > 0.0);
    return vec3<f32>(h, s, c_max);
}

fn hsv_to_rgb(c: vec3<f32>) -> vec3<f32> {
    let h = c.x; let s = c.y; let v = c.z;
    let C = v * s;
    let X = C * (1.0 - abs((h / 60.0) % 2.0 - 1.0));
    let m = v - C;
    var rgb_prime: vec3<f32>;
    if (h < 60.0) { rgb_prime = vec3<f32>(C, X, 0.0); }
    else if (h < 120.0) { rgb_prime = vec3<f32>(X, C, 0.0); }
    else if (h < 180.0) { rgb_prime = vec3<f32>(0.0, C, X); }
    else if (h < 240.0) { rgb_prime = vec3<f32>(0.0, X, C); }
    else if (h < 300.0) { rgb_prime = vec3<f32>(X, 0.0, C); }
    else { rgb_prime = vec3<f32>(C, 0.0, X); }
    return rgb_prime + vec3<f32>(m, m, m);
}

fn apply_hue_shift(color: vec3<f32>, shift_degrees: f32) -> vec3<f32> {
    if (abs(shift_degrees) < 0.01) {
        return color;
    }
    let srgb_color = linear_to_srgb_extended(color);
    let hsv = rgb_to_hsv(srgb_color);
    var shifted_h = hsv.x + shift_degrees;
    shifted_h = (shifted_h + 360.0) % 360.0;
    let shifted_srgb = hsv_to_rgb(vec3<f32>(shifted_h, hsv.y, hsv.z));
    return srgb_to_linear(shifted_srgb);
}

fn get_raw_hsl_influence(hue: f32, center: f32, width: f32) -> f32 {
    let dist = min(abs(hue - center), 360.0 - abs(hue - center));
    const sharpness = 1.5;
    let falloff = dist / (width * 0.5);
    return exp(-sharpness * falloff * falloff);
}

fn hash(p: vec2<f32>) -> f32 {
    var p3  = fract(vec3<f32>(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn gradient_noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

    let ga = vec2<f32>(hash(i + vec2(0.0, 0.0)), hash(i + vec2(0.0, 0.0) + vec2(11.0, 37.0))) * 2.0 - 1.0;
    let gb = vec2<f32>(hash(i + vec2(1.0, 0.0)), hash(i + vec2(1.0, 0.0) + vec2(11.0, 37.0))) * 2.0 - 1.0;
    let gc = vec2<f32>(hash(i + vec2(0.0, 1.0)), hash(i + vec2(0.0, 1.0) + vec2(11.0, 37.0))) * 2.0 - 1.0;
    let gd = vec2<f32>(hash(i + vec2(1.0, 1.0)), hash(i + vec2(1.0, 1.0) + vec2(11.0, 37.0))) * 2.0 - 1.0;

    let dot_00 = dot(ga, f - vec2(0.0, 0.0));
    let dot_10 = dot(gb, f - vec2(1.0, 0.0));
    let dot_01 = dot(gc, f - vec2(0.0, 1.0));
    let dot_11 = dot(gd, f - vec2(1.0, 1.0));

    let bottom_interp = mix(dot_00, dot_10, u.x);
    let top_interp = mix(dot_01, dot_11, u.x);

    return mix(bottom_interp, top_interp, u.y);
}

fn dither(coords: vec2<u32>) -> f32 {
    let p = vec2<f32>(coords);
    return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453) - 0.5;
}

fn interpolate_cubic_hermite(x: f32, p1: Point, p2: Point, m1: f32, m2: f32) -> f32 {
    let dx = p2.x - p1.x;
    if (dx <= 0.0) { return p1.y; }
    let t = (x - p1.x) / dx;
    let t2 = t * t;
    let t3 = t2 * t;
    let h00 = 2.0 * t3 - 3.0 * t2 + 1.0;
    let h10 = t3 - 2.0 * t2 + t;
    let h01 = -2.0 * t3 + 3.0 * t2;
    let h11 = t3 - t2;
    return h00 * p1.y + h10 * m1 * dx + h01 * p2.y + h11 * m2 * dx;
}

fn apply_curve(val: f32, points: array<Point, 16>, count: u32) -> f32 {
    if (count < 2u) { return val; }
    var local_points = points;
    let x = val * 255.0;
    if (x <= local_points[0].x) { return local_points[0].y / 255.0; }
    if (x >= local_points[count - 1u].x) { return local_points[count - 1u].y / 255.0; }
    for (var i = 0u; i < 15u; i = i + 1u) {
        if (i >= count - 1u) { break; }
        let p1 = local_points[i];
        let p2 = local_points[i + 1u];
        if (x <= p2.x) {
            let p0 = local_points[max(0u, i - 1u)];
            let p3 = local_points[min(count - 1u, i + 2u)];
            let delta_before = (p1.y - p0.y) / max(0.001, p1.x - p0.x);
            let delta_current = (p2.y - p1.y) / max(0.001, p2.x - p1.x);
            let delta_after = (p3.y - p2.y) / max(0.001, p3.x - p2.x);
            var tangent_at_p1: f32;
            var tangent_at_p2: f32;
            if (i == 0u) { tangent_at_p1 = delta_current; } else {
                if (delta_before * delta_current <= 0.0) { tangent_at_p1 = 0.0; } else { tangent_at_p1 = (delta_before + delta_current) / 2.0; }
            }
            if (i + 1u == count - 1u) { tangent_at_p2 = delta_current; } else {
                if (delta_current * delta_after <= 0.0) { tangent_at_p2 = 0.0; } else { tangent_at_p2 = (delta_current + delta_after) / 2.0; }
            }
            if (delta_current != 0.0) {
                let alpha = tangent_at_p1 / delta_current;
                let beta = tangent_at_p2 / delta_current;
                if (alpha * alpha + beta * beta > 9.0) {
                    let tau = 3.0 / sqrt(alpha * alpha + beta * beta);
                    tangent_at_p1 = tangent_at_p1 * tau;
                    tangent_at_p2 = tangent_at_p2 * tau;
                }
            }
            let result_y = interpolate_cubic_hermite(x, p1, p2, tangent_at_p1, tangent_at_p2);
            return clamp(result_y / 255.0, 0.0, 1.0);
        }
    }
    return local_points[count - 1u].y / 255.0;
}

fn apply_tonal_adjustments(
    color: vec3<f32>,
    blurred_color_input_space: vec3<f32>,
    is_raw: u32,
    con: f32,
    sh: f32,
    wh: f32,
    bl: f32
) -> vec3<f32> {
    var rgb = color;

    var blurred_linear: vec3<f32>;
    if (is_raw == 1u) {
        blurred_linear = blurred_color_input_space;
    } else {
        blurred_linear = srgb_to_linear(blurred_color_input_space);
    }

    if (wh != 0.0) {
        let white_level = 1.0 - wh * 0.25;
        let w_mult = 1.0 / max(white_level, 0.01);
        rgb *= w_mult;
        blurred_linear *= w_mult;
    }

    let pixel_luma = get_luma(max(rgb, vec3<f32>(0.0)));
    let blurred_luma = get_luma(max(blurred_linear, vec3<f32>(0.0)));

    let safe_pixel_luma = max(pixel_luma, 0.0001);
    let safe_blurred_luma = max(blurred_luma, 0.0001);

    if (sh != 0.0 || bl != 0.0) {
        let t_pixel = pow(safe_pixel_luma, 0.4545);
        let t_blurred = pow(safe_blurred_luma, 0.4545);

        let shadow_lift = sh * t_pixel * pow(max(1.0 - t_pixel, 0.0), 4.5);
        let black_lift = bl * t_pixel * pow(max(1.0 - t_pixel, 0.0), 12.0);
        let lift_amount = max(shadow_lift + black_lift, 0.0);

        let t_pixel_curved = max(t_pixel + shadow_lift + black_lift, 0.0);

        let shadow_pivot = 0.2;
        let stretch_factor = 1.0 + (lift_amount * 1.3);
        let contrasted_t = shadow_pivot + (t_pixel_curved - shadow_pivot) * stretch_factor;

        let final_t = max(mix(t_pixel_curved, contrasted_t, 0.85), 0.0);
        let curved_luma = pow(final_t, 2.2);

        let luma_ratio = curved_luma / safe_pixel_luma;
        rgb *= luma_ratio;

        let detail = t_pixel / max(t_blurred, 0.0001);
        let safe_detail = clamp(detail, 0.8, 1.25);

        let noise_protection = smoothstep(0.0, 0.1, t_blurred);

        let detail_amp = 1.0 + (lift_amount * 1.2 * noise_protection);

        let enhanced_detail = pow(safe_detail, detail_amp);
        let detail_correction = enhanced_detail / safe_detail;

        let linear_correction = pow(detail_correction, 2.2);
        rgb *= linear_correction;

        if (luma_ratio > 1.0) {
            let recovered_luma = get_luma(rgb);
            let boost_amount = clamp((luma_ratio - 1.0) * 0.15, 0.0, 0.4);
            rgb = mix(rgb, vec3<f32>(recovered_luma), boost_amount);
        }
    }

    if (con != 0.0) {
        let safe_rgb = max(rgb, vec3<f32>(0.0));
        let g = 2.2;
        let perceptual = pow(safe_rgb, vec3<f32>(1.0 / g));
        let clamped_perceptual = clamp(perceptual, vec3<f32>(0.0), vec3<f32>(1.0));
        let strength = pow(2.0, con * 1.25);
        let condition = clamped_perceptual < vec3<f32>(0.5);
        let high_part = 1.0 - 0.5 * pow(2.0 * (1.0 - clamped_perceptual), vec3<f32>(strength));
        let low_part = 0.5 * pow(2.0 * clamped_perceptual, vec3<f32>(strength));
        let curved_perceptual = select(high_part, low_part, condition);
        let contrast_adjusted_rgb = pow(curved_perceptual, vec3<f32>(g));
        let mix_factor = smoothstep(vec3<f32>(1.0), vec3<f32>(1.01), safe_rgb);
        rgb = mix(contrast_adjusted_rgb, rgb, mix_factor);
    }
    return rgb;
}

fn apply_highlights_adjustment(
    color_in: vec3<f32>,
    blurred_color_input_space: vec3<f32>,
    is_raw: u32,
    highlights_adj: f32
) -> vec3<f32> {
    if (highlights_adj == 0.0) { return color_in; }

    let pixel_luma = get_luma(max(color_in, vec3<f32>(0.0)));
    let safe_pixel_luma = max(pixel_luma, 0.0001);

    let pixel_mask_input = tanh(safe_pixel_luma * 1.5);
    let highlight_mask = smoothstep(0.3, 0.95, pixel_mask_input);

    if (highlight_mask < 0.001) {
        return color_in;
    }

    let luma = pixel_luma;
    var final_adjusted_color: vec3<f32>;

    if (highlights_adj < 0.0) {
        var new_luma: f32;
        if (luma <= 1.0) {
            let gamma = 1.0 - highlights_adj * 1.75;
            new_luma = pow(luma, gamma);
        } else {
            let luma_excess = luma - 1.0;
            let compression_strength = -highlights_adj * 6.0;
            let compressed_excess = luma_excess / (1.0 + luma_excess * compression_strength);
            new_luma = 1.0 + compressed_excess;
        }
        let tonally_adjusted_color = color_in * (new_luma / max(luma, 0.0001));
        let desaturation_amount = smoothstep(1.0, 10.0, luma);
        let white_point = vec3<f32>(new_luma);
        final_adjusted_color = mix(tonally_adjusted_color, white_point, desaturation_amount);
    } else {
        let adjustment = highlights_adj * 1.75;
        let factor = pow(2.0, adjustment);
        final_adjusted_color = color_in * factor;
    }

    return mix(color_in, final_adjusted_color, highlight_mask);
}

fn apply_linear_exposure(color_in: vec3<f32>, exposure_adj: f32) -> vec3<f32> {
    if (exposure_adj == 0.0) {
        return color_in;
    }
    return color_in * pow(2.0, exposure_adj);
}

fn apply_filmic_exposure(color_in: vec3<f32>, brightness_adj: f32) -> vec3<f32> {
    if (brightness_adj == 0.0) {
        return color_in;
    }
    const RATIONAL_CURVE_MIX: f32 = 0.95;
    const MIDTONE_STRENGTH: f32 = 1.2;
    const TOP_ANCHOR: f32 = 1.06;
    let original_luma = get_luma(color_in);
    if (abs(original_luma) < 0.00001) {
        return color_in;
    }
    let direct_adj = brightness_adj * (1.0 - RATIONAL_CURVE_MIX);
    let rational_adj = brightness_adj * RATIONAL_CURVE_MIX;
    let scale = pow(2.0, direct_adj);
    let k = pow(2.0, -rational_adj * MIDTONE_STRENGTH);
    let luma_abs = abs(original_luma);
    let luma_floor = floor(luma_abs / TOP_ANCHOR) * TOP_ANCHOR;
    let luma_norm = (luma_abs - luma_floor) / TOP_ANCHOR;
    let shaped_norm = luma_norm / (luma_norm + (1.0 - luma_norm) * k);
    let shaped_luma_abs = luma_floor + (shaped_norm * TOP_ANCHOR);
    let new_luma = sign(original_luma) * shaped_luma_abs * scale;
    let chroma = color_in - vec3<f32>(original_luma);
    let total_luma_scale = new_luma / original_luma;
    let luma_weight = clamp(new_luma, 0.0, 2.0) * 0.5;
    let dynamic_exp = mix(0.95, 0.65, luma_weight);
    let base_chroma_scale = pow(total_luma_scale, dynamic_exp);
    let highlight_rolloff = 1.0 / (1.0 + max(0.0, new_luma - 0.9) * 2.0);
    let chroma_scale = base_chroma_scale * highlight_rolloff;
    return vec3<f32>(new_luma) + chroma * chroma_scale;
}

fn apply_color_calibration(color: vec3<f32>, cal: ColorCalibrationSettings) -> vec3<f32> {
    let h_r = cal.red_hue;
    let h_g = cal.green_hue;
    let h_b = cal.blue_hue;
    let r_prime = vec3<f32>(1.0 - abs(h_r), max(0.0, h_r), max(0.0, -h_r));
    let g_prime = vec3<f32>(max(0.0, -h_g), 1.0 - abs(h_g), max(0.0, h_g));
    let b_prime = vec3<f32>(max(0.0, h_b), max(0.0, -h_b), 1.0 - abs(h_b));
    let hue_matrix = mat3x3<f32>(r_prime, g_prime, b_prime);
    var c = hue_matrix * color;

    let luma = get_luma(max(vec3(0.0), c));
    let desaturated_color = vec3<f32>(luma);
    let sat_vector = c - desaturated_color;

    let color_sum = c.r + c.g + c.b;
    var masks = vec3<f32>(0.0);
    if (color_sum > 0.001) {
        masks = c / color_sum;
    }

    let total_sat_adjustment =
        masks.r * cal.red_saturation +
        masks.g * cal.green_saturation +
        masks.b * cal.blue_saturation;

    c += sat_vector * total_sat_adjustment;

    let st = cal.shadows_tint;
    if (abs(st) > 0.001) {
        let shadow_luma = get_luma(max(vec3(0.0), c));
        let mask = 1.0 - smoothstep(0.0, 0.3, shadow_luma);
        let tint_mult = vec3<f32>(1.0 + st * 0.25, 1.0 - st * 0.25, 1.0 + st * 0.25);
        c = mix(c, c * tint_mult, mask);
    }

    return c;
}

fn apply_white_balance(color: vec3<f32>, temp: f32, tnt: f32) -> vec3<f32> {
    var rgb = color;
    let temp_kelvin_mult = vec3<f32>(1.0 + temp * 0.2, 1.0 + temp * 0.05, 1.0 - temp * 0.2);
    let tint_mult = vec3<f32>(1.0 + tnt * 0.25, 1.0 - tnt * 0.25, 1.0 + tnt * 0.25);
    rgb *= temp_kelvin_mult * tint_mult;
    return rgb;
}

fn apply_creative_color(color: vec3<f32>, sat: f32, vib: f32) -> vec3<f32> {
    var processed = color;
    let luma = get_luma(processed);

    if (sat != 0.0) {
        processed = mix(vec3<f32>(luma), processed, 1.0 + sat);
    }
    if (vib == 0.0) { return processed; }
    let c_max = max(processed.r, max(processed.g, processed.b));
    let c_min = min(processed.r, min(processed.g, processed.b));
    let delta = c_max - c_min;
    if (delta < 0.02) {
        return processed;
    }
    let current_sat = delta / max(c_max, 0.001);
    if (vib > 0.0) {
        let sat_mask = 1.0 - smoothstep(0.4, 0.9, current_sat);
        let hsv = rgb_to_hsv(processed);
        let hue = hsv.x;
        let skin_center = 25.0;
        let hue_dist = min(abs(hue - skin_center), 360.0 - abs(hue - skin_center));
        let is_skin = smoothstep(35.0, 10.0, hue_dist);
        let skin_dampener = mix(1.0, 0.6, is_skin);
        let amount = vib * sat_mask * skin_dampener * 3.0;
        processed = mix(vec3<f32>(luma), processed, 1.0 + amount);
    } else {
        let desat_mask = 1.0 - smoothstep(0.2, 0.8, current_sat);
        let amount = vib * desat_mask;
        processed = mix(vec3<f32>(luma), processed, 1.0 + amount);
    }
    return processed;
}

fn apply_hsl_panel(color: vec3<f32>, hsl_adjustments: array<HslColor, 8>, coords_i: vec2<i32>) -> vec3<f32> {
    let safe_color = max(color, vec3<f32>(0.0));
    if (distance(safe_color.r, safe_color.g) < 0.001 && distance(safe_color.g, safe_color.b) < 0.001) {
        return safe_color;
    }
    let original_hsv = rgb_to_hsv(safe_color);
    let original_luma = get_luma(safe_color);

    let saturation_mask = smoothstep(0.05, 0.20, original_hsv.y);
    let luminance_weight = smoothstep(0.0, 1.0, original_hsv.y);

    if (saturation_mask < 0.001 && luminance_weight < 0.001) {
        return safe_color;
    }

    let original_hue = original_hsv.x;

    var raw_influences: array<f32, 8>;
    var total_raw_influence: f32 = 0.0;
    for (var i = 0u; i < 8u; i = i + 1u) {
        let range = HSL_RANGES[i];
        let influence = get_raw_hsl_influence(original_hue, range.center, range.width);
        raw_influences[i] = influence;
        total_raw_influence += influence;
    }

    var total_hue_shift: f32 = 0.0;
    var total_sat_multiplier: f32 = 0.0;
    var total_lum_adjust: f32 = 0.0;

    for (var i = 0u; i < 8u; i = i + 1u) {
        let normalized_influence = raw_influences[i] / total_raw_influence;

        let hue_sat_influence = normalized_influence * saturation_mask;
        let luma_influence = normalized_influence * luminance_weight;

        total_hue_shift += hsl_adjustments[i].hue * 2.0 * hue_sat_influence;
        total_sat_multiplier += hsl_adjustments[i].saturation * hue_sat_influence;
        total_lum_adjust += hsl_adjustments[i].luminance * luma_influence;
    }

    if (original_hsv.y * (1.0 + total_sat_multiplier) < 0.0001) {
        let final_luma = original_luma * (1.0 + total_lum_adjust);
        return vec3<f32>(final_luma);
    }
    var hsv = original_hsv;
    hsv.x = (hsv.x + total_hue_shift + 360.0) % 360.0;
    hsv.y = clamp(hsv.y * (1.0 + total_sat_multiplier), 0.0, 1.0);
    let hs_shifted_rgb = hsv_to_rgb(vec3<f32>(hsv.x, hsv.y, original_hsv.z));
    let new_luma = get_luma(hs_shifted_rgb);
    let target_luma = original_luma * (1.0 + total_lum_adjust);
    if (new_luma < 0.0001) {
        return vec3<f32>(max(0.0, target_luma));
    }
    let final_color = hs_shifted_rgb * (target_luma / new_luma);
    return final_color;
}

fn apply_color_grading(color: vec3<f32>, shadows: ColorGradeSettings, midtones: ColorGradeSettings, highlights: ColorGradeSettings, global: ColorGradeSettings, blending: f32, balance: f32) -> vec3<f32> {
    let luma = get_luma(max(vec3(0.0), color));
    let base_shadow_crossover = 0.1;
    let base_highlight_crossover = 0.5;
    let balance_range = 0.5;
    let shadow_crossover = base_shadow_crossover + max(0.0, -balance) * balance_range;
    let highlight_crossover = base_highlight_crossover - max(0.0, balance) * balance_range;
    let feather = 0.2 * blending;
    let final_shadow_crossover = min(shadow_crossover, highlight_crossover - 0.01);
    let shadow_mask = 1.0 - smoothstep(final_shadow_crossover - feather, final_shadow_crossover + feather, luma);
    let highlight_mask = smoothstep(highlight_crossover - feather, highlight_crossover + feather, luma);
    let midtone_mask = max(0.0, 1.0 - shadow_mask - highlight_mask);
    let global_mask = 1.0;
    var graded_color = color;
    let shadow_sat_strength = 0.3;
    let shadow_lum_strength = 0.5;
    let midtone_sat_strength = 0.6;
    let midtone_lum_strength = 0.8;
    let highlight_sat_strength = 0.8;
    let highlight_lum_strength = 1.0;
    let global_sat_strength = 1.0;
    let global_lum_strength = 1.0;
    if (shadows.saturation > 0.001) { let tint_rgb = hsv_to_rgb(vec3<f32>(shadows.hue, 1.0, 1.0)); graded_color += (tint_rgb - 0.5) * shadows.saturation * shadow_mask * shadow_sat_strength; }
    graded_color += shadows.luminance * shadow_mask * shadow_lum_strength;
    if (midtones.saturation > 0.001) { let tint_rgb = hsv_to_rgb(vec3<f32>(midtones.hue, 1.0, 1.0)); graded_color += (tint_rgb - 0.5) * midtones.saturation * midtone_mask * midtone_sat_strength; }
    graded_color += midtones.luminance * midtone_mask * midtone_lum_strength;
    if (highlights.saturation > 0.001) { let tint_rgb = hsv_to_rgb(vec3<f32>(highlights.hue, 1.0, 1.0)); graded_color += (tint_rgb - 0.5) * highlights.saturation * highlight_mask * highlight_sat_strength; }
    graded_color += highlights.luminance * highlight_mask * highlight_lum_strength;
    if (global.saturation > 0.001) { let tint_rgb = hsv_to_rgb(vec3<f32>(global.hue, 1.0, 1.0)); graded_color += (tint_rgb - 0.5) * global.saturation * global_mask * global_sat_strength; }
    graded_color += global.luminance * global_mask * global_lum_strength;
    return graded_color;
}

fn apply_local_contrast(
    processed_color_linear: vec3<f32>,
    blurred_color_input_space: vec3<f32>,
    amount: f32,
    is_raw: u32,
    mode: u32,
    threshold: f32
) -> vec3<f32> {
    if (amount == 0.0) {
        return processed_color_linear;
    }

    var blurred_color_linear: vec3<f32>;
    if (is_raw == 1u) {
        blurred_color_linear = blurred_color_input_space;
    } else {
        blurred_color_linear = srgb_to_linear(blurred_color_input_space);
    }

    if (amount < 0.0) {
        var blur_amount = -amount;
        if (mode == 0u) {
            blur_amount = blur_amount * 0.5;
        }
        return mix(processed_color_linear, blurred_color_linear, blur_amount);
    }

    let center_luma = get_luma(processed_color_linear);

    let shadow_threshold = select(0.03, 0.1, is_raw == 1u);
    let shadow_protection = smoothstep(0.0, shadow_threshold, center_luma);
    let highlight_protection = 1.0 - smoothstep(0.9, 1.0, center_luma);
    let midtone_mask = shadow_protection * highlight_protection;

    if (midtone_mask < 0.001) {
        return processed_color_linear;
    }

    let blurred_luma = get_luma(blurred_color_linear);
    let safe_center_luma = max(center_luma, 0.0001);
    let safe_blurred_luma = max(blurred_luma, 0.0001);

    let log_ratio = log2(safe_center_luma / safe_blurred_luma);
    var effective_amount = amount;

    if (mode == 0u) {
        let edge_magnitude = abs(log_ratio);
        let normalized_edge = clamp(edge_magnitude / 3.0, 0.0, 1.0);
        let edge_dampener = 1.0 - pow(normalized_edge, 0.5);
        let edge_mask = smoothstep(threshold * 0.5, threshold * 1.5, edge_magnitude);
        effective_amount = amount * edge_dampener * edge_mask * 0.8;
    } else {
        effective_amount = amount;
    }

    let contrast_factor = exp2(log_ratio * effective_amount);
    let final_color = processed_color_linear * contrast_factor;

    return mix(processed_color_linear, final_color, midtone_mask);
}

fn apply_dehaze(color: vec3<f32>, blurred_color_input_space: vec3<f32>, is_raw: u32, amount: f32) -> vec3<f32> {
    if (amount == 0.0) { return color; }

    var blurred_linear: vec3<f32>;
    if (is_raw == 1u) {
        blurred_linear = blurred_color_input_space;
    } else {
        blurred_linear = srgb_to_linear(blurred_color_input_space);
    }

    let atmospheric_light = vec3<f32>(0.95, 0.97, 1.0);

    if (amount > 0.0) {
        let pixel_dark = min(color.r, min(color.g, color.b));
        let regional_dark = min(blurred_linear.r, min(blurred_linear.g, blurred_linear.b));
        let pixel_luma = get_luma(max(color, vec3<f32>(0.0)));
        let blurred_luma = get_luma(max(blurred_linear, vec3<f32>(0.0)));
        let edge_diff = abs(pow(pixel_luma, 0.5) - pow(blurred_luma, 0.5));
        let halo_protection = smoothstep(0.02, 0.15, edge_diff);
        let spatial_dark = mix(regional_dark, pixel_dark, halo_protection);
        let safe_dark = max(spatial_dark - 0.02, 0.0);
        let mapped_haze = safe_dark / (safe_dark + 0.2);
        let t = max(1.0 - amount * mapped_haze * 0.85, 0.15);
        var recovered = (color - atmospheric_light) / t + atmospheric_light;
        let rec_luma = get_luma(max(recovered, vec3<f32>(0.0)));
        let shadow_lift = smoothstep(0.1, 0.0, rec_luma) * (1.0 - t) * 0.15;
        recovered += shadow_lift;
        let haze_removed = 1.0 - t;
        let sat_boost = haze_removed * 0.5;
        let final_luma = get_luma(max(recovered, vec3<f32>(0.0)));
        recovered = mix(vec3<f32>(final_luma), recovered, 1.0 + sat_boost);
        return max(recovered, vec3<f32>(0.0));
    } else {
        let regional_dark = min(blurred_linear.r, min(blurred_linear.g, blurred_linear.b));
        let safe_dark = max(regional_dark - 0.02, 0.0);
        let mapped_depth = safe_dark / (safe_dark + 0.2);
        let depth_factor = mix(0.4, 1.0, mapped_depth);
        return mix(color, atmospheric_light, abs(amount) * 0.7 * depth_factor);
    }
}

const AGX_EPSILON: f32 = 1.0e-6;
const AGX_MIN_EV: f32 = -15.2;
const AGX_MAX_EV: f32 = 5.0;
const AGX_RANGE_EV: f32 = AGX_MAX_EV - AGX_MIN_EV;
const AGX_GAMMA: f32 = 2.4;
const AGX_SLOPE: f32 = 2.3843;
const AGX_TOE_POWER: f32 = 1.5;
const AGX_SHOULDER_POWER: f32 = 1.5;
const AGX_TOE_TRANSITION_X: f32 = 0.6060606;
const AGX_TOE_TRANSITION_Y: f32 = 0.43446;
const AGX_SHOULDER_TRANSITION_X: f32 = 0.6060606;
const AGX_SHOULDER_TRANSITION_Y: f32 = 0.43446;
const AGX_INTERCEPT: f32 = -1.0112;
const AGX_TOE_SCALE: f32 = -1.0359;
const AGX_SHOULDER_SCALE: f32 = 1.3475;
const AGX_TARGET_BLACK_PRE_GAMMA: f32 = 0.0;
const AGX_TARGET_WHITE_PRE_GAMMA: f32 = 1.0;

fn agx_sigmoid(x: f32, power: f32) -> f32 {
    return x / pow(1.0 + pow(x, power), 1.0 / power);
}

fn agx_scaled_sigmoid(x: f32, scale: f32, slope: f32, power: f32, transition_x: f32, transition_y: f32) -> f32 {
    return scale * agx_sigmoid(slope * (x - transition_x) / scale, power) + transition_y;
}

fn agx_apply_curve_channel(x: f32) -> f32 {
    var result: f32 = 0.0;
    if (x < AGX_TOE_TRANSITION_X) {
        result = agx_scaled_sigmoid(x, AGX_TOE_SCALE, AGX_SLOPE, AGX_TOE_POWER, AGX_TOE_TRANSITION_X, AGX_TOE_TRANSITION_Y);
    } else if (x <= AGX_SHOULDER_TRANSITION_X) {
        result = AGX_SLOPE * x + AGX_INTERCEPT;
    } else {
        result = agx_scaled_sigmoid(x, AGX_SHOULDER_SCALE, AGX_SLOPE, AGX_SHOULDER_POWER, AGX_SHOULDER_TRANSITION_X, AGX_SHOULDER_TRANSITION_Y);
    }
    return clamp(result, AGX_TARGET_BLACK_PRE_GAMMA, AGX_TARGET_WHITE_PRE_GAMMA);
}

fn agx_compress_gamut(c: vec3<f32>) -> vec3<f32> {
    let min_c = min(c.r, min(c.g, c.b));
    if (min_c < 0.0) {
        return c - min_c;
    }
    return c;
}

fn agx_tonemap(c: vec3<f32>) -> vec3<f32> {
    let x_relative = max(c / 0.18, vec3<f32>(AGX_EPSILON));
    let log_encoded = (log2(x_relative) - AGX_MIN_EV) / AGX_RANGE_EV;
    let mapped = clamp(log_encoded, vec3<f32>(0.0), vec3<f32>(1.0));

    var curved: vec3<f32>;
    curved.r = agx_apply_curve_channel(mapped.r);
    curved.g = agx_apply_curve_channel(mapped.g);
    curved.b = agx_apply_curve_channel(mapped.b);

    let final_color = pow(max(curved, vec3<f32>(0.0)), vec3<f32>(AGX_GAMMA));

    return final_color;
}

fn agx_full_transform(color_in: vec3<f32>) -> vec3<f32> {
    let compressed_color = agx_compress_gamut(color_in);
    let color_in_agx_space = adjustments.global.agx_pipe_to_rendering_matrix * compressed_color;
    let tonemapped_agx = agx_tonemap(color_in_agx_space);
    let final_color = adjustments.global.agx_rendering_to_pipe_matrix * tonemapped_agx;
    return final_color;
}

// flim — Filmic Color Transform, ported from github.com/bean-mhm/flim
// (AGPLv3). Input is scene-referred linear BT.709, output is display-referred
// linear (the caller applies linear_to_srgb). It replaces the tonemapper.
// All preset-derived constants arrive as uniforms (flim_* fields); the sigmoid
// shape and log2_min are shared by all presets and hardcoded here.
const FLIM_TOE: vec2<f32> = vec2<f32>(0.44, 0.28);
const FLIM_SHOULDER: vec2<f32> = vec2<f32>(0.591, 0.779);
const FLIM_LOG2_MIN: f32 = -10.0;
const FLIM_LUMA: vec3<f32> = vec3<f32>(0.3, 0.5, 0.2);

fn flim_super_sigmoid(x_in: f32) -> f32 {
    let x = clamp(x_in, 0.0, 1.0);
    let slope = (FLIM_SHOULDER.y - FLIM_TOE.y) / (FLIM_SHOULDER.x - FLIM_TOE.x);
    if (x < FLIM_TOE.x) {
        let toe_pow = slope * FLIM_TOE.x / FLIM_TOE.y;
        return FLIM_TOE.y * pow(x / FLIM_TOE.x, toe_pow);
    }
    if (x < FLIM_SHOULDER.x) {
        return slope * x + (FLIM_TOE.y - slope * FLIM_TOE.x);
    }
    let shoulder_pow = -slope / (((FLIM_SHOULDER.x - 1.0) / ((1.0 - FLIM_SHOULDER.x) * (1.0 - FLIM_SHOULDER.x))) * (1.0 - FLIM_SHOULDER.y));
    return (1.0 - pow(1.0 - (x - FLIM_SHOULDER.x) / (1.0 - FLIM_SHOULDER.x), shoulder_pow)) * (1.0 - FLIM_SHOULDER.y) + FLIM_SHOULDER.y;
}

fn flim_dye_mix(mono: f32, log2_max: f32, max_density: f32) -> f32 {
    // max() keeps log2 off non-positive extended-gamut values; the reference
    // gets -inf there, which the clamp maps to 0 either way.
    let fac = clamp((log2(max(mono + exp2(FLIM_LOG2_MIN), 1e-9)) - FLIM_LOG2_MIN) / (log2_max - FLIM_LOG2_MIN), 0.0, 1.0);
    return clamp(exp2(-flim_super_sigmoid(fac) * max_density), 0.0, 1.0);
}

fn flim_develop(inp_in: vec3<f32>, exposure: f32, log2_max: f32, density: f32) -> vec3<f32> {
    let inp = inp_in * exp2(exposure);
    let white = vec3<f32>(1.0);
    // blue-sensitive layer forms the yellow dye, green -> magenta, red -> cyan.
    var out = mix(vec3<f32>(1.0, 1.0, 0.0), white, flim_dye_mix(inp.b, log2_max, density));
    out *= mix(vec3<f32>(1.0, 0.0, 1.0), white, flim_dye_mix(inp.g, log2_max, density));
    out *= mix(vec3<f32>(0.0, 1.0, 1.0), white, flim_dye_mix(inp.r, log2_max, density));
    return out;
}

fn flim_negative_and_print(inp: vec3<f32>) -> vec3<f32> {
    let g = adjustments.global;
    let negative = flim_develop(inp, g.flim_neg_exposure, g.flim_sigmoid_log2_max, g.flim_neg_density);
    return flim_develop(negative * g.flim_backlight, g.flim_print_exposure, g.flim_sigmoid_log2_max, g.flim_print_density);
}

fn flim_rgb_to_hsv(inp: vec3<f32>) -> vec3<f32> {
    let cmax = max(inp.r, max(inp.g, inp.b));
    let cmin = min(inp.r, min(inp.g, inp.b));
    let cdelta = cmax - cmin;
    var h = 0.0;
    var s = 0.0;
    if (cmax != 0.0) {
        s = cdelta / cmax;
    }
    if (s != 0.0) {
        let c = (vec3<f32>(cmax) - inp) / cdelta;
        if (inp.r == cmax) {
            h = c.b - c.g;
        } else if (inp.g == cmax) {
            h = 2.0 + c.r - c.b;
        } else {
            h = 4.0 + c.g - c.r;
        }
        h = h / 6.0;
        if (h < 0.0) {
            h += 1.0;
        }
    }
    return vec3<f32>(h, s, cmax);
}

fn flim_hsv_to_rgb(inp: vec3<f32>) -> vec3<f32> {
    var h = inp.x;
    let s = inp.y;
    let v = inp.z;
    if (s == 0.0) {
        return vec3<f32>(v);
    }
    if (h == 1.0) {
        h = 0.0;
    }
    let h6 = h * 6.0;
    let i = floor(h6);
    let f = h6 - i;
    let p = v * (1.0 - s);
    let q = v * (1.0 - s * f);
    let t = v * (1.0 - s * (1.0 - f));
    if (i == 0.0) { return vec3<f32>(v, t, p); }
    if (i == 1.0) { return vec3<f32>(q, v, p); }
    if (i == 2.0) { return vec3<f32>(p, v, t); }
    if (i == 3.0) { return vec3<f32>(p, q, v); }
    if (i == 4.0) { return vec3<f32>(t, p, v); }
    return vec3<f32>(v, p, q);
}

fn flim_transform(color_in: vec3<f32>, blur_in: vec3<f32>, exp: f32, bright: f32, is_raw: u32) -> vec3<f32> {
    let g = adjustments.global;
    let white = vec3<f32>(1.0);
    // exposure pivot (preset pre-exposure folded with the user EV at parse time)
    var inp = color_in * exp2(g.flim_ev);
    // pre-formation filter
    inp = inp * mix(white, g.flim_pre_filter, g.flim_pre_filter_strength);
    // warmth — per-channel gain along the daylight locus (pre-sigmoid, can't clip)
    inp = inp * g.flim_warmth;
    // adjacency: steady-state approximation of Filmulator's developer
    // depletion + diffusion (CarVac, GPLv3 — model only). Developer flows from
    // low-development (dark) areas into high-development (bright) ones, so the
    // bright side of an edge develops harder: an unsharp mask in the log2
    // domain with weight growing toward highlights reproduces that.
    if (g.flim_adjacency > 0.0) {
        var blur_lin = blur_in;
        if (is_raw == 0u) { blur_lin = srgb_to_linear(blur_lin); }
        blur_lin = apply_filmic_exposure(apply_linear_exposure(blur_lin, exp), bright);
        blur_lin = blur_lin * exp2(g.flim_ev) * mix(white, g.flim_pre_filter, g.flim_pre_filter_strength) * g.flim_warmth;
        let log_hi = log2(max(inp, vec3<f32>(1e-6)));
        let log_lo = log2(max(blur_lin, vec3<f32>(1e-6)));
        let w = clamp(log_hi * 0.3 + 1.2, vec3<f32>(0.2), vec3<f32>(2.0));
        inp = exp2(log_hi + (log_hi - log_lo) * g.flim_adjacency * 0.5 * w);
    }
    // extended gamut
    inp = g.flim_extend_mat * inp;
    // develop negative and print
    inp = flim_negative_and_print(inp);
    // white cap
    inp = inp / g.flim_white_cap;
    // black-cap offset (rgb_uniform_offset with white_point = 0)
    let mono_bc = dot(inp, FLIM_LUMA);
    if (abs(mono_bc) >= 0.0001) {
        let bp = min(g.flim_black_cap_luma, 0.999);
        inp = inp * (clamp((mono_bc - bp) / (1.0 - bp), 0.0, 1.0) / mono_bc);
    }
    // back from the extended gamut
    inp = g.flim_extend_mat_inv * inp;
    inp = max(inp, vec3<f32>(0.0));
    // post-formation filter
    inp = inp * mix(white, g.flim_post_filter, g.flim_post_filter_strength);
    // split-tone: tone-keyed warm/cool tinting (tints baked at parse time)
    let mono_st = dot(inp, FLIM_LUMA);
    inp = inp * mix(white, g.flim_hi_tint, smoothstep(0.5, 0.9, mono_st));
    inp = inp * mix(white, g.flim_sh_tint, 1.0 - smoothstep(0.1, 0.5, mono_st));
    inp = clamp(inp, vec3<f32>(0.0), vec3<f32>(1.0));
    // midtone-keyed saturation (flim's hue offset +0.5 + 0.5 is a no-op)
    let mono = dot(inp, FLIM_LUMA);
    let midtone_fac = max(1.0 - abs(mono - 0.5) / 0.45, 0.0);
    var hsv = flim_rgb_to_hsv(inp);
    hsv.y = clamp(hsv.y * g.flim_midtone_saturation, 0.0, 1.0);
    inp = mix(inp, flim_hsv_to_rgb(hsv), midtone_fac);
    return clamp(inp, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn legacy_tonemap(c: vec3<f32>) -> vec3<f32> {
    const a: f32 = 2.51;
    const b: f32 = 0.03;
    const c_const: f32 = 2.43;
    const d: f32 = 0.59;
    const e: f32 = 0.14;

    let x = max(c, vec3<f32>(0.0));

    let numerator = x * (a * x + b);
    let denominator = x * (c_const * x + d) + e;

    let tonemapped = select(vec3<f32>(0.0), numerator / denominator, denominator > vec3<f32>(0.00001));

    return clamp(tonemapped, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn no_tonemap(c: vec3<f32>) -> vec3<f32> {
    return c;
}

fn is_default_curve(points: array<Point, 16>, count: u32) -> bool {
    if (count < 2u) {
        return false;
    }

    var is_identity = true;
    for (var i = 0u; i < count; i = i + 1u) {
        if (abs(points[i].x - points[i].y) > 0.5) {
            is_identity = false;
            break;
        }
    }

    let p0 = points[0];
    let p_last = points[count - 1u];
    let p0_is_origin = abs(p0.x - 0.0) < 0.1 && abs(p0.y - 0.0) < 0.1;
    let p_last_is_end = abs(p_last.x - 255.0) < 0.1 && abs(p_last.y - 255.0) < 0.1;

    return is_identity && p0_is_origin && p_last_is_end;
}

fn apply_all_curves(color: vec3<f32>, luma_curve: array<Point, 16>, luma_curve_count: u32, red_curve: array<Point, 16>, red_curve_count: u32, green_curve: array<Point, 16>, green_curve_count: u32, blue_curve: array<Point, 16>, blue_curve_count: u32) -> vec3<f32> {
    let red_is_default = is_default_curve(red_curve, red_curve_count);
    let green_is_default = is_default_curve(green_curve, green_curve_count);
    let blue_is_default = is_default_curve(blue_curve, blue_curve_count);
    let rgb_curves_are_active = !red_is_default || !green_is_default || !blue_is_default;

    if (rgb_curves_are_active) {
        let color_graded = vec3<f32>(apply_curve(color.r, red_curve, red_curve_count), apply_curve(color.g, green_curve, green_curve_count), apply_curve(color.b, blue_curve, blue_curve_count));
        let luma_initial = get_luma(color);
        let luma_target = apply_curve(luma_initial, luma_curve, luma_curve_count);
        let luma_graded = get_luma(color_graded);
        var final_color: vec3<f32>;
        if (luma_graded > 0.001) { final_color = color_graded * (luma_target / luma_graded); } else { final_color = vec3<f32>(luma_target); }
        let max_comp = max(final_color.r, max(final_color.g, final_color.b));
        if (max_comp > 1.0) { final_color = final_color / max_comp; }
        return final_color;
    } else {
        return vec3<f32>(apply_curve(color.r, luma_curve, luma_curve_count), apply_curve(color.g, luma_curve, luma_curve_count), apply_curve(color.b, luma_curve, luma_curve_count));
    }
}

fn get_mask_influence(mask_index: u32, coords: vec2<u32>) -> f32 {
    return textureLoad(mask_textures, vec2<i32>(coords), i32(mask_index), 0).r;
}

fn sample_lut_tetrahedral(uv: vec3<f32>) -> vec3<f32> {
    let dims = vec3<f32>(textureDimensions(lut_texture));
    let size = dims - vec3<f32>(1.0);
    let scaled = clamp(uv, vec3<f32>(0.0), vec3<f32>(1.0)) * size;
    let i_base = floor(scaled);
    let f = scaled - i_base;
    let coord0 = vec3<i32>(i_base);
    let coord1 = min(coord0 + vec3<i32>(1), vec3<i32>(dims) - vec3<i32>(1));
    let c000 = textureLoad(lut_texture, coord0, 0).rgb;
    let c111 = textureLoad(lut_texture, coord1, 0).rgb;

    var res = vec3<f32>(0.0);

    if (f.r > f.g) {
        if (f.g > f.b) {
            let c100 = textureLoad(lut_texture, vec3<i32>(coord1.x, coord0.y, coord0.z), 0).rgb;
            let c110 = textureLoad(lut_texture, vec3<i32>(coord1.x, coord1.y, coord0.z), 0).rgb;

            res = c000 * (1.0 - f.r) +
                  c100 * (f.r - f.g) +
                  c110 * (f.g - f.b) +
                  c111 * (f.b);
        } else if (f.r > f.b) {
            let c100 = textureLoad(lut_texture, vec3<i32>(coord1.x, coord0.y, coord0.z), 0).rgb;
            let c101 = textureLoad(lut_texture, vec3<i32>(coord1.x, coord0.y, coord1.z), 0).rgb;

            res = c000 * (1.0 - f.r) +
                  c100 * (f.r - f.b) +
                  c101 * (f.b - f.g) +
                  c111 * (f.g);
        } else {
            let c001 = textureLoad(lut_texture, vec3<i32>(coord0.x, coord0.y, coord1.z), 0).rgb;
            let c101 = textureLoad(lut_texture, vec3<i32>(coord1.x, coord0.y, coord1.z), 0).rgb;

            res = c000 * (1.0 - f.b) +
                  c001 * (f.b - f.r) +
                  c101 * (f.r - f.g) +
                  c111 * (f.g);
        }
    } else {
        if (f.b > f.g) {
            let c001 = textureLoad(lut_texture, vec3<i32>(coord0.x, coord0.y, coord1.z), 0).rgb;
            let c011 = textureLoad(lut_texture, vec3<i32>(coord0.x, coord1.y, coord1.z), 0).rgb;

            res = c000 * (1.0 - f.b) +
                  c001 * (f.b - f.g) +
                  c011 * (f.g - f.r) +
                  c111 * (f.r);
        } else if (f.b > f.r) {
            let c010 = textureLoad(lut_texture, vec3<i32>(coord0.x, coord1.y, coord0.z), 0).rgb;
            let c011 = textureLoad(lut_texture, vec3<i32>(coord0.x, coord1.y, coord1.z), 0).rgb;

            res = c000 * (1.0 - f.g) +
                  c010 * (f.g - f.b) +
                  c011 * (f.b - f.r) +
                  c111 * (f.r);
        } else {
            let c010 = textureLoad(lut_texture, vec3<i32>(coord0.x, coord1.y, coord0.z), 0).rgb;
            let c110 = textureLoad(lut_texture, vec3<i32>(coord1.x, coord1.y, coord0.z), 0).rgb;

            res = c000 * (1.0 - f.g) +
                  c010 * (f.g - f.r) +
                  c110 * (f.r - f.b) +
                  c111 * (f.b);
        }
    }

    return res;
}

fn prepare_lut_input(hdr: vec3<f32>) -> vec3<f32> {
    if (adjustments.global.lut_normalize_mode == 0u) {
        return clamp(hdr, vec3(0.0), vec3(1.0));
    }

    let offset_lin = pow(2.0, adjustments.global.lut_input_offset);
    let range_lin  = pow(2.0, adjustments.global.lut_input_range);
    var t = hdr * offset_lin / range_lin;

    if (adjustments.global.lut_shoulder > 0.0) {
        let s = adjustments.global.lut_shoulder;
        t = t * (1.0 + s) / (1.0 + s * t);
    }

    if (adjustments.global.lut_normalize_mode == 1u) {
        return clamp(t, vec3(0.0), vec3(1.0));
    }

    // log mode
    return clamp(log2(max(t, vec3(1e-6))) / adjustments.global.lut_input_range + vec3(1.0),
                 vec3(0.0), vec3(1.0));
}

const HDR_LUT_TOTAL_RANGE: f32 = 32.0;

// Sample the HDR-extrapolated LUT. The texture stores scene-linear values mapped
// from a log-symmetric domain [-16..+16] stops (total 32 stops). The input
// range/offset sliders control which sub-range of that domain is used.
fn sample_hdr_lut_tetrahedral(hdr: vec3<f32>) -> vec3<f32> {
    let range = max(adjustments.global.lut_input_range, 0.5);
    let scale = HDR_LUT_TOTAL_RANGE / range;

    var log_rgb = log2(max(hdr, vec3(1e-6)));
    log_rgb += vec3(adjustments.global.lut_input_offset);
    log_rgb *= vec3(scale);

    let uvw = clamp(log_rgb / HDR_LUT_TOTAL_RANGE + vec3(0.5), vec3(0.0), vec3(1.0));
    let lut_hdr = sample_lut_tetrahedral(uvw);

    var log_out = log2(max(lut_hdr, vec3(1e-6)));
    log_out /= vec3(scale);
    return pow(vec3(2.0), log_out);
}

fn apply_glow_bloom(
    color: vec3<f32>,
    blurred_color_input_space: vec3<f32>,
    amount: f32,
    is_raw: u32,
    exp: f32, bright: f32, con: f32, wh: f32
) -> vec3<f32> {
    if (amount <= 0.0) {
        return color;
    }

    var blurred_linear: vec3<f32>;
    if (is_raw == 1u) {
        blurred_linear = blurred_color_input_space;
    } else {
        blurred_linear = srgb_to_linear(blurred_color_input_space);
    }

    blurred_linear = apply_linear_exposure(blurred_linear, exp);
    blurred_linear = apply_filmic_exposure(blurred_linear, bright);
    blurred_linear = apply_tonal_adjustments(blurred_linear, blurred_color_input_space, is_raw, 0.0, 0.0, wh, 0.0);

    let linear_luma = get_luma(max(blurred_linear, vec3<f32>(0.0)));

    var perceptual_luma: f32;
    if (linear_luma <= 1.0) {
        perceptual_luma = pow(max(linear_luma, 0.0), 1.0 / 2.2);
    } else {
        perceptual_luma = 1.0 + pow(linear_luma - 1.0, 1.0 / 2.2);
    }

    let luma_cutoff = mix(0.75, 0.08, clamp(amount, 0.0, 1.0));

    let cutoff_fade = smoothstep(
        luma_cutoff,
        luma_cutoff + 0.15,
        perceptual_luma
    );

    let excess = max(perceptual_luma - luma_cutoff, 0.0);

    let falloff_range = 5.5;
    let normalized = excess / falloff_range;

    let bloom_intensity =
        pow(smoothstep(0.0, 1.0, normalized), 0.45);

    var bloom_color: vec3<f32>;
    if (linear_luma > 0.01) {
        let color_ratio = blurred_linear / linear_luma;
        let warm_tint = vec3<f32>(1.03, 1.0, 0.97);
        bloom_color = color_ratio * warm_tint;
    } else {
        bloom_color = vec3<f32>(1.0, 0.99, 0.98);
    }

    let luma_factor = pow(linear_luma, 0.6);

    let black_gate_width = 0.5;
    let black_gate_raw = smoothstep(0.0, black_gate_width, linear_luma);
    let black_gate = pow(black_gate_raw, 0.5);

    bloom_color *= bloom_intensity * luma_factor * cutoff_fade * black_gate;

    let current_luma = get_luma(max(color, vec3<f32>(0.0)));
    let protection = 1.0 - smoothstep(1.0, 2.2, current_luma);

    return color + bloom_color * amount * 3.8 * protection;
}

// Halation: light scattered through the film base re-exposes the red-sensitive
// layer, forming a red-orange halo around highlights. Two-component PSF
// approximation: sharp core (clarity blur, r≈8) + long tail (structure blur,
// r≈40); threshold in stops above middle grey (prior art: halation-dctl,
// realbloom — idea only).
fn apply_halation(
    color: vec3<f32>,
    blurred_core_input_space: vec3<f32>,
    blurred_tail_input_space: vec3<f32>,
    amount: f32,
    is_raw: u32,
    exp: f32, bright: f32
) -> vec3<f32> {
    if (amount <= 0.0) { return color; }

    // The blur textures are computed on the pre-grade input; approximate the
    // graded linear space by re-applying the exposure adjustments.
    var core_lin = blurred_core_input_space;
    var tail_lin = blurred_tail_input_space;
    if (is_raw == 0u) {
        core_lin = srgb_to_linear(core_lin);
        tail_lin = srgb_to_linear(tail_lin);
    }
    core_lin = apply_filmic_exposure(apply_linear_exposure(core_lin, exp), bright);
    tail_lin = apply_filmic_exposure(apply_linear_exposure(tail_lin, exp), bright);

    // Threshold in stops above middle grey (0.18 scene-referred convention):
    // the core reacts only to strong highlights, the tail reaches further down.
    let core_stops = log2(max(get_luma(max(core_lin, vec3<f32>(0.0))), 1e-6) / 0.18);
    let tail_stops = log2(max(get_luma(max(tail_lin, vec3<f32>(0.0))), 1e-6) / 0.18);
    let core_w = smoothstep(2.5, 4.0, core_stops);
    let tail_w = smoothstep(1.5, 3.5, tail_stops);

    // The core keeps part of the source hue; the tail is deep red-orange.
    let core_glow = core_lin * mix(vec3<f32>(1.0), vec3<f32>(1.0, 0.45, 0.25), 0.6) * core_w;
    let tail_glow = tail_lin * vec3<f32>(1.0, 0.20, 0.06) * tail_w;

    return color + (core_glow * 0.8 + tail_glow * 0.5) * amount * 2.0;
}

// --- Film simulation (ported from the Krea WebGL2 film PoC) ---
// sRGB in -> sRGB out. Chain: sRGB->linear -> highlight rolloff -> per-channel
// dye curves -> shadow tint (base fog) -> color bleed -> linear->sRGB ->
// contrast/saturation -> base blend -> optional cross-process -> strength blend
// against the untouched input. Inserted right after the tonemapper, so user
// curves/LUT/grain apply on top of the film look.
fn film_curve_lookup(idx: u32) -> vec3<f32> {
    return adjustments.global.film_curves[idx >> 4u][idx & 15u];
}

fn apply_film_look(color_in: vec3<f32>) -> vec3<f32> {
    let strength = adjustments.global.film_strength;
    if (strength <= 0.0) {
        return color_in;
    }

    var c = srgb_to_linear(clamp(color_in, vec3<f32>(0.0), vec3<f32>(1.0)));

    // Highlight rolloff: per-channel soft shoulder above 0.6.
    let rolloff = adjustments.global.film_rolloff;
    if (rolloff > 0.0) {
        let hm = clamp((c - vec3<f32>(0.6)) / 0.4, vec3<f32>(0.0), vec3<f32>(1.0));
        let d = max(c - vec3<f32>(0.6), vec3<f32>(0.0));
        let comp = vec3<f32>(0.6) + vec3<f32>(0.4) * (vec3<f32>(1.0) - exp(-5.0 * d * (1.0 - rolloff)));
        c = mix(c, comp, hm);
    }

    // Dye response curves: 256-entry LUT per channel, manual linear interp.
    let t = clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)) * 255.0;
    let fl = floor(t);
    let f = t - fl;
    let i = vec3<u32>(fl);
    let j = min(i + vec3<u32>(1u), vec3<u32>(255u));
    let cr0 = film_curve_lookup(i.x);
    let cr1 = film_curve_lookup(j.x);
    let cg0 = film_curve_lookup(i.y);
    let cg1 = film_curve_lookup(j.y);
    let cb0 = film_curve_lookup(i.z);
    let cb1 = film_curve_lookup(j.z);
    c = vec3<f32>(mix(cr0.x, cr1.x, f.x), mix(cg0.y, cg1.y, f.y), mix(cb0.z, cb1.z, f.z));

    // Shadow tint (film base fog), fixed strength 0.2 as in the PoC.
    let st = adjustments.global.film_shadow_tint;
    if (max(st.x, max(st.y, st.z)) > 0.0) {
        let lt = dot(c, vec3<f32>(0.299, 0.587, 0.114));
        var sm = clamp(1.0 - lt * 2.0, 0.0, 1.0);
        sm = pow(sm, 1.5);
        c = clamp(c + sm * 0.2 * st, vec3<f32>(0.0), vec3<f32>(1.0));
    }

    // Color bleed (dye crosstalk), computed from the pre-bleed value.
    let bleed = adjustments.global.film_bleed;
    if (bleed > 0.0) {
        let o = c;
        c = clamp(vec3<f32>(
            o.x + o.z * bleed * 0.15,
            o.y + (o.x + o.z) * bleed * 0.05,
            o.z + o.x * bleed * 0.10,
        ), vec3<f32>(0.0), vec3<f32>(1.0));
    }

    // Back to sRGB: contrast (pivot 0.5) + saturation.
    c = linear_to_srgb(c);
    c = (c - vec3<f32>(0.5)) * adjustments.global.film_contrast + vec3<f32>(0.5);
    let ld = dot(c, vec3<f32>(0.299, 0.587, 0.114));
    c = clamp(mix(vec3<f32>(ld), c, adjustments.global.film_saturation), vec3<f32>(0.0), vec3<f32>(1.0));

    // Base fog blend.
    c = mix(c, adjustments.global.film_base_color, 0.03);

    // Optional cross-process.
    if (adjustments.global.film_cross > 0.5) {
        c = (c - vec3<f32>(0.5)) * 1.5 + vec3<f32>(0.5);
        c = vec3<f32>(min(1.0, c.x * 1.2), c.y * 0.9, min(1.0, c.z * 1.1));
        let lx = dot(c, vec3<f32>(0.299, 0.587, 0.114));
        c = mix(vec3<f32>(lx), c, 1.3);
    }

    // Film shadows / highlights (sRGB, luma-masked, same math as the PoC).
    let fsh = adjustments.global.film_shadows;
    let fhi = adjustments.global.film_highlights;
    if (fsh != 0.0 || fhi != 0.0) {
        let lf = dot(c, LUMA_COEFF);
        if (fsh != 0.0) {
            let s = fsh / 100.0;
            var sm = clamp(1.0 - lf * 2.0, 0.0, 1.0);
            sm = sm * sm;
            if (s < 0.0) {
                c = c * (1.0 - (-s) * sm);
            } else {
                c = c + s * sm * (vec3<f32>(1.0) - c);
            }
        }
        if (fhi != 0.0) {
            let h = fhi / 100.0;
            var hm = clamp((lf - 0.5) * 2.0, 0.0, 1.0);
            hm = hm * hm;
            if (h < 0.0) {
                c = c - (-h) * hm * clamp(c - vec3<f32>(0.5), vec3<f32>(0.0), vec3<f32>(1.0));
            } else {
                c = c + h * hm * (vec3<f32>(1.0) - c);
            }
        }
    }

    return mix(color_in, clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)), clamp(strength, 0.0, 1.0));
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let out_dims = vec2<u32>(textureDimensions(output_texture));
    if (id.x >= out_dims.x || id.y >= out_dims.y) { return; }

    const REFERENCE_DIMENSION: f32 = 1080.0;
    let full_dims = vec2<f32>(textureDimensions(pre_blur_texture));
    let current_ref_dim = min(full_dims.x, full_dims.y);
    let scale = max(0.1, current_ref_dim / REFERENCE_DIMENSION);

    let absolute_coord = id.xy + vec2<u32>(adjustments.tile_offset_x, adjustments.tile_offset_y);
    let absolute_coord_i = vec2<i32>(absolute_coord);

    let is_raw = adjustments.global.is_raw_image;

    let pre_blur_sample = textureLoad(pre_blur_texture, id.xy, 0);
    let original_alpha = pre_blur_sample.a;
    let sharp = textureLoad(pre_tone_linear_texture, id.xy, 0).rgb;
    var composite_rgb_linear = sharp;

    // Reconstruct masked exposure/brightness for the FLIM transform.
    var t_exposure = adjustments.global.exposure;
    var t_brightness = adjustments.global.brightness;
    for (var i = 0u; i < adjustments.mask_count; i = i + 1u) {
        let influence = get_mask_influence(i, absolute_coord);
        if (influence > 0.001) {
            let m = adjustments.mask_adjustments[i];
            t_exposure += m.exposure * influence;
            t_brightness += m.brightness * influence;
        }
    }

    let clarity_blurred = textureLoad(clarity_blur_texture, id.xy, 0).rgb;

    // Pre-tone soft blur: linear mix between the sharp linear image and a
    // separately-blurred copy, performed before tonemapping. Values stay HDR.
    let pre_soft_amount = adjustments.global.film_blur_pre_soft_amount;
    if (pre_soft_amount > 0.0) {
        let soft_blurred = textureLoad(pre_soft_blur_texture, id.xy, 0).rgb;
        composite_rgb_linear = mix(composite_rgb_linear, soft_blurred, pre_soft_amount);
    }

    // Pre-tone emulsion diffusion: screen-blend the sharp linear tile with its
    // blurred copy. Amount is 0..1; radius was baked into the pre-blur pass.
    // Applied after soft blur so both effects remain visible.
    let pre_amount = adjustments.global.film_blur_pre_amount;
    let pre_compensation = adjustments.global.film_blur_pre_compensation;
    if (pre_amount > 0.0) {
        let blurred = clamp(pre_blur_sample.rgb, vec3<f32>(0.0), vec3<f32>(1.0));
        let s = clamp(sharp, vec3<f32>(0.0), vec3<f32>(1.0));
        let screen = 1.0 - (1.0 - s) * (1.0 - blurred * pre_amount);
        if (pre_compensation > 0.0) {
            let luma_in = dot(s, FLIM_LUMA);
            let luma_screen = dot(screen, FLIM_LUMA);
            let target_luma = mix(luma_screen, luma_in, pre_compensation);
            let scale = target_luma / max(luma_screen, 1e-6);
            composite_rgb_linear = screen * scale;
        } else {
            composite_rgb_linear = screen;
        }
    }

    if (adjustments.global.lut_timing == 1u && adjustments.global.has_lut == 1u) {
        var lut_color: vec3<f32>;
        if (adjustments.global.lut_normalize_mode == 3u) {
            lut_color = sample_hdr_lut_tetrahedral(composite_rgb_linear);
        } else {
            let lut_in = prepare_lut_input(composite_rgb_linear);
            lut_color = sample_lut_tetrahedral(lut_in);
        }
        composite_rgb_linear = mix(composite_rgb_linear, lut_color,
                                   adjustments.global.lut_intensity);
    }

    var base_srgb: vec3<f32>;
    if (adjustments.global.tonemapper_mode == 1u) {
        base_srgb = agx_full_transform(composite_rgb_linear);
    } else if (adjustments.global.tonemapper_mode == 2u) {
        // flim replaces the tonemapper: scene-referred linear in, sRGB out.
        // flim_strength mixes against the look the non-AgX branch would have
        // produced (replicated here as the 0% fallback).
        var flim_base: vec3<f32>;
        if (is_raw == 1u) {
            var srgb_emulated = linear_to_srgb(composite_rgb_linear);
            const FLIM_BRIGHTNESS_GAMMA: f32 = 1.1;
            srgb_emulated = pow(srgb_emulated, vec3<f32>(1.0 / FLIM_BRIGHTNESS_GAMMA));
            const FLIM_CONTRAST_MIX: f32 = 0.75;
            let contrast_curve = srgb_emulated * srgb_emulated * (3.0 - 2.0 * srgb_emulated);
            flim_base = mix(srgb_emulated, contrast_curve, FLIM_CONTRAST_MIX);
        } else {
            flim_base = linear_to_srgb(composite_rgb_linear);
        }
        let flim_srgb = linear_to_srgb(flim_transform(composite_rgb_linear, clarity_blurred, t_exposure, t_brightness, is_raw));
        base_srgb = mix(flim_base, flim_srgb, adjustments.global.flim_strength);
    } else if (is_raw == 1u) {
        var srgb_emulated = linear_to_srgb(composite_rgb_linear);
        const BRIGHTNESS_GAMMA: f32 = 1.1;
        srgb_emulated = pow(srgb_emulated, vec3<f32>(1.0 / BRIGHTNESS_GAMMA));
        const CONTRAST_MIX: f32 = 0.75;
        let contrast_curve = srgb_emulated * srgb_emulated * (3.0 - 2.0 * srgb_emulated);
        base_srgb = mix(srgb_emulated, contrast_curve, CONTRAST_MIX);
    } else {
        base_srgb = linear_to_srgb(composite_rgb_linear);
    }

    // Black & white conversion: applied to the tonemapped sRGB image, before
    // the film look so film grading still shapes the gray result. Falls back
    // to Rec.709 luma when the weights sum to ~0.
    if (adjustments.global.bw_enabled > 0.5) {
        let bw_w = adjustments.global.bw_weights;
        let bw_s = bw_w.r + bw_w.g + bw_w.b;
        let bw_wn = select(LUMA_COEFF, bw_w / bw_s, bw_s > 0.0001);
        base_srgb = vec3<f32>(dot(base_srgb, bw_wn));
    }

    // Film simulation (Krea): applied to the tonemapped sRGB image, before the
    // user's curves/LUT/grain so they stack on top of the film look.
    base_srgb = apply_film_look(base_srgb);

    var final_rgb = apply_all_curves(base_srgb,
        adjustments.global.luma_curve, adjustments.global.luma_curve_count,
        adjustments.global.red_curve, adjustments.global.red_curve_count,
        adjustments.global.green_curve, adjustments.global.green_curve_count,
        adjustments.global.blue_curve, adjustments.global.blue_curve_count
    );

    for (var i = 0u; i < adjustments.mask_count; i = i + 1u) {
        let influence = get_mask_influence(i, absolute_coord);
        if (influence > 0.001) {
            let m = adjustments.mask_adjustments[i];
            let mask_curved_srgb = apply_all_curves(final_rgb,
                m.luma_curve, m.luma_curve_count,
                m.red_curve, m.red_curve_count,
                m.green_curve, m.green_curve_count,
                m.blue_curve, m.blue_curve_count
            );
            final_rgb = mix(final_rgb, mask_curved_srgb, influence);
        }
    }

    if (adjustments.global.lut_timing == 0u && adjustments.global.has_lut == 1u) {
        let lut_color = sample_lut_tetrahedral(final_rgb);
        final_rgb = mix(final_rgb, lut_color, adjustments.global.lut_intensity);
    }

    if (adjustments.global.grain_amount > 0.0) {
        let coord = vec2<f32>(absolute_coord_i);
        let amount = adjustments.global.grain_amount * 0.5;
        let grain_frequency = (1.0 / max(adjustments.global.grain_size, 0.1)) / scale;
        let roughness = adjustments.global.grain_roughness;
        let luma = max(0.0, get_luma(final_rgb));
        let luma_mask = smoothstep(0.0, 0.15, luma) * (1.0 - smoothstep(0.6, 1.0, luma));
        let base_coord = coord * grain_frequency;
        let rough_coord = coord * grain_frequency * 0.6;
        let noise_base = gradient_noise(base_coord);
        let noise_rough = gradient_noise(rough_coord + vec2<f32>(5.2, 1.3));
        let noise_val = mix(noise_base, noise_rough, roughness);
        final_rgb += vec3<f32>(noise_val) * amount * luma_mask;
    }

    if (adjustments.global.show_clipping == 1u) {
        let HIGHLIGHT_WARNING_COLOR = vec3<f32>(1.0, 0.0, 0.0);
        let SHADOW_WARNING_COLOR = vec3<f32>(0.0, 0.0, 1.0);
        let HIGHLIGHT_CLIP_THRESHOLD = 0.998;
        let SHADOW_CLIP_THRESHOLD = 0.002;
        if (any(final_rgb > vec3<f32>(HIGHLIGHT_CLIP_THRESHOLD))) {
            final_rgb = HIGHLIGHT_WARNING_COLOR;
        } else if (any(final_rgb < vec3<f32>(SHADOW_CLIP_THRESHOLD))) {
            final_rgb = SHADOW_WARNING_COLOR;
        }
    }

    let dither_amount = 1.0 / 255.0;
    final_rgb += dither(id.xy) * dither_amount;

    textureStore(output_texture, id.xy, vec4<f32>(clamp(final_rgb, vec3<f32>(0.0), vec3<f32>(1.0)), original_alpha));
}
