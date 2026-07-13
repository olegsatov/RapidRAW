struct BlurParams {
    radius: u32,
    tile_offset_x: u32,
    tile_offset_y: u32,
    input_width: u32,
    input_height: u32,
    // Horizontal sample clamp (max x in source-texture coords). u32::MAX = use
    // the source texture width (input blurs read the full image). The film
    // emulsion blur reads a tile-local texture whose content is smaller than
    // the texture, so it clamps to the content width explicitly.
    clamp_x_max: u32,
    _pad2: u32,
    _pad3: u32,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var output_texture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> params: BlurParams;

const F16_MAX = 65504.0;

fn gaussian(x: f32, sigma: f32) -> f32 {
    return exp(-(x * x) / (2.0 * sigma * sigma));
}

@compute @workgroup_size(256, 1, 1)
fn horizontal_blur(@builtin(global_invocation_id) id: vec3<u32>) {
    let dims = vec2<i32>(textureDimensions(output_texture));
    if (id.x >= u32(dims.x)) {
        return;
    }

    let radius = i32(params.radius);
    let sigma = f32(radius) / 2.0;

    let absolute_coord = vec2<u32>(id.x + params.tile_offset_x, id.y + params.tile_offset_y);
    let full_dims = vec2<i32>(textureDimensions(input_texture));
    // NOTE: compare in u32 space. clamp_x_max may be u32::MAX ("use texture
    // width"), and i32(u32::MAX) == -1 would make clamp(x, 0, -1) indeterminate
    // (on Metal it pins every sample to column 0 — full-width streaks).
    let max_x = min(u32(full_dims.x - 1), params.clamp_x_max);

    let center_color = clamp(textureLoad(input_texture, absolute_coord, 0).rgb, vec3(0.0), vec3(F16_MAX));

    var total_color = vec3<f32>(0.0);
    var total_weight = 0.0;

    for (var offset = -radius; offset <= radius; offset = offset + 1) {
        let sample_x = clamp(i32(absolute_coord.x) + offset, 0, i32(max_x));
        let sample_coord = vec2<i32>(sample_x, i32(absolute_coord.y));

        let sample_color = clamp(textureLoad(input_texture, vec2<u32>(sample_coord), 0).rgb, vec3(0.0), vec3(F16_MAX));
        let weight = gaussian(f32(offset), sigma);

        total_color += sample_color * weight;
        total_weight += weight;
    }

    let final_color = total_color / total_weight;
    textureStore(output_texture, id.xy, vec4<f32>(final_color, 1.0));
}

@compute @workgroup_size(1, 256, 1)
fn vertical_blur(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.y >= params.input_height) {
        return;
    }

    let radius = i32(params.radius);
    let sigma = f32(radius) / 2.0;

    let local_coord = vec2<i32>(id.xy);
    let max_y = i32(params.input_height) - 1;

    var total_color = vec3<f32>(0.0);
    var total_weight = 0.0;

    for (var offset = -radius; offset <= radius; offset = offset + 1) {
        let sample_y = clamp(local_coord.y + offset, 0, max_y);
        let sample_coord = vec2<i32>(local_coord.x, sample_y);

        let sample_color = clamp(textureLoad(input_texture, vec2<u32>(sample_coord), 0).rgb, vec3(0.0), vec3(F16_MAX));
        let weight = gaussian(f32(offset), sigma);

        total_color += sample_color * weight;
        total_weight += weight;
    }

    let final_color = total_color / total_weight;
    textureStore(output_texture, id.xy, vec4<f32>(final_color, 1.0));
}
