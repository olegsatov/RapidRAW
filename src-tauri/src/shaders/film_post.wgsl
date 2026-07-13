// Film post-pass: crystal grain (Pierre) realtime preview + conversion to
// rgba8. Runs per-tile after the main pass when the film blur and/or crystal
// grain dials are active. With both at 0 the pass is skipped.
//
// Textures are tile-local: content lives at 0..input dims, so sampling uses
// local coords. The grain field is sampled in full-image coords (tile origin
// + local id) with mirrored wrap, so it stays seamless across tiles.

struct FilmPostParams {
    clamp_w: f32,  // content width - 1 (source textures are tile-local)
    clamp_h: f32,  // content height - 1
    origin_x: f32, // tile origin in full-image coords (for grain sampling)
    origin_y: f32,
    grain_amount: f32, // crystal grain strength mix 0..1 (0 = off)
    grain_tile: f32,   // baked grain field tile size (px)
    grain_mono: f32,   // 1 = single shared field (B&W), 0 = per-channel
    grain_level: f32,  // mip level matching the render downscale (log2(full/processed))
    grain_coord_scale: f32, // full-res px per processed px (grain sampled in full-image coords)
    _pad3: f32,
    _pad4: f32,
    _pad5: f32,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var output_texture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params: FilmPostParams;
@group(0) @binding(3) var grain_texture: texture_2d<f32>;
@group(0) @binding(4) var grain_sampler: sampler;

@compute @workgroup_size(8, 8, 1)
fn film_post(@builtin(global_invocation_id) id: vec3<u32>) {
    let out_dims = vec2<u32>(textureDimensions(output_texture));
    if (id.x >= out_dims.x || id.y >= out_dims.y) {
        return;
    }

    let coord = vec2<f32>(id.xy);
    let max_c = vec2<f32>(params.clamp_w, params.clamp_h);
    let px = vec2<u32>(clamp(coord, vec2<f32>(0.0), max_c));

    let src = textureLoad(input_texture, px, 0);
    var r = src.r;
    var g = src.g;
    var b = src.b;
    let a = src.a;

    // Crystal grain (Pierre): the baked field G is the mean-normalized
    // coverage fraction of the crystal-stack model rendered on a flat
    // field. In the model's linear range the output for local intensity
    // u is out = u² + (u − u²)·G — multiplicative grain with the printing
    // model built in (no grain in fully white areas). The mip level is
    // chosen by the caller to match the render downscale: a box mip is
    // exactly the averaging that downscaling applies to real grain, so a
    // zoomed-out preview shows grain as the export looks at the same size.
    if (params.grain_amount > 0.0) {
        // Full-image coords in FULL-RES pixel units (the baked field is
        // authored at full-res scale — the export samples it 1:1). Without
        // grain_coord_scale the pattern would stretch with the preview
        // downscale and mip averaging would smear it into blotches.
        // The sampler's mirror-repeat wrap keeps the tile seamless.
        let uv = (vec2<f32>(params.origin_x, params.origin_y) + coord + 0.5) * params.grain_coord_scale / params.grain_tile;
        let G = textureSampleLevel(grain_texture, grain_sampler, uv, params.grain_level);

        var grained = vec3<f32>(r, g, b);
        if (params.grain_mono > 0.5) {
            // Single shared field (B&W film): apply to luma as a
            // hue-preserving gain.
            let luma = dot(grained, vec3<f32>(0.2126, 0.7152, 0.0722));
            let out_l = luma * luma + (luma - luma * luma) * G.r;
            grained = grained * (out_l / max(luma, 1e-4));
        } else {
            // Three decorrelated fields (three emulsion layers).
            grained = grained * grained + (grained - grained * grained) * G.rgb;
        }
        let mixed = mix(
            vec3<f32>(r, g, b),
            clamp(grained, vec3<f32>(0.0), vec3<f32>(1.0)),
            params.grain_amount,
        );
        r = mixed.r;
        g = mixed.g;
        b = mixed.b;
    }

    textureStore(output_texture, id.xy, vec4<f32>(r, g, b, a));
}
