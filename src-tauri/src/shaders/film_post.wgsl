// Film post-pass (Krea PoC port): radial chromatic aberration on the graded
// image + conversion to rgba8. Runs per-tile after the main pass when the film
// blur and/or chroma dials are active. With chroma == 0 it is a straight copy
// (used to convert the rgba16f emulsion-blur result back to rgba8).
//
// Textures are tile-local: content lives at 0..input dims, so sampling uses
// local coords; only the radial center is given in tile-local coords too.

struct FilmPostParams {
    chroma: f32,   // pixel-space shift factor (PoC chroma * 0.02)
    center_x: f32, // image center in tile-local coords
    center_y: f32,
    clamp_w: f32,  // content width - 1 (source textures are tile-local)
    clamp_h: f32,  // content height - 1
    _pad1: f32,
    _pad2: f32,
    _pad3: f32,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var output_texture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params: FilmPostParams;

@compute @workgroup_size(8, 8, 1)
fn film_post(@builtin(global_invocation_id) id: vec3<u32>) {
    let out_dims = vec2<u32>(textureDimensions(output_texture));
    if (id.x >= out_dims.x || id.y >= out_dims.y) {
        return;
    }

    let coord = vec2<f32>(id.xy);
    let d = coord - vec2<f32>(params.center_x, params.center_y);
    let off = d * params.chroma;

    let max_c = vec2<f32>(params.clamp_w, params.clamp_h);
    let rp = vec2<u32>(clamp(coord + off, vec2<f32>(0.0), max_c));
    let cp = vec2<u32>(clamp(coord, vec2<f32>(0.0), max_c));
    let bp = vec2<u32>(clamp(coord - off, vec2<f32>(0.0), max_c));

    let r = textureLoad(input_texture, rp, 0).r;
    let g = textureLoad(input_texture, cp, 0).g;
    let b = textureLoad(input_texture, bp, 0).b;
    let a = textureLoad(input_texture, cp, 0).a;

    textureStore(output_texture, id.xy, vec4<f32>(r, g, b, a));
}
