// Film post-pass (Krea PoC port): radial chromatic aberration on the graded
// image + crystal grain (Pierre) realtime preview + conversion to rgba8.
// Runs per-tile after the main pass when the film blur, chroma and/or
// crystal grain dials are active. With all of them at 0 the pass is skipped.
//
// Textures are tile-local: content lives at 0..input dims, so sampling uses
// local coords; only the radial center is given in tile-local coords too.
// The grain field is sampled in full-image coords (tile origin + local id)
// with mirrored wrap, so it stays seamless across tiles.

struct FilmPostParams {
    chroma: f32,   // pixel-space shift factor (PoC chroma * 0.02)
    center_x: f32, // image center in tile-local coords
    center_y: f32,
    clamp_w: f32,  // content width - 1 (source textures are tile-local)
    clamp_h: f32,  // content height - 1
    origin_x: f32, // tile origin in full-image coords (for grain sampling)
    origin_y: f32,
    grain_amount: f32, // crystal grain strength mix 0..1 (0 = off)
    grain_tile: f32,   // baked grain field tile size (px)
    grain_mono: f32,   // 1 = single shared field (B&W), 0 = per-channel
    _pad1: f32,
    _pad2: f32,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var output_texture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params: FilmPostParams;
@group(0) @binding(3) var grain_texture: texture_2d<f32>;

// Mirrored wrap (numpy 'symm'): d c b a | a b c d | d c b a — the baked
// grain field is a stationary random texture, so mirroring is seamless.
fn mirror_idx(i: i32, n: i32) -> i32 {
    let period = 2 * n;
    var m = i % period;
    if (m < 0) {
        m = m + period;
    }
    if (m >= n) {
        m = period - 1 - m;
    }
    return m;
}

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

    var r = textureLoad(input_texture, rp, 0).r;
    var g = textureLoad(input_texture, cp, 0).g;
    var b = textureLoad(input_texture, bp, 0).b;
    let a = textureLoad(input_texture, cp, 0).a;

    // Crystal grain (Pierre): the baked field G is the mean-normalized
    // coverage fraction of the crystal-stack model rendered on a flat
    // field. In the model's linear range the output for local intensity
    // u is out = u² + (u − u²)·G — multiplicative grain with the printing
    // model built in (no grain in fully white areas).
    if (params.grain_amount > 0.0) {
        let tile = i32(params.grain_tile);
        let gx = mirror_idx(i32(params.origin_x) + i32(id.x), tile);
        let gy = mirror_idx(i32(params.origin_y) + i32(id.y), tile);
        let G = textureLoad(grain_texture, vec2<i32>(gx, gy), 0);

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
