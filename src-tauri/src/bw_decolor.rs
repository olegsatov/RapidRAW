//! RTCP - Real-time Contrast Preserving Decolorization
//! Lu, Xu, Jia. "Real-time contrast preserving decolorization",
//! SIGGRAPH Asia 2012 Technical Briefs, Article 34.
//!
//! Rust port of the validated numpy reference at scratch/rtcp_test/rtcp.py.
//!
//! Idea: gray = w . rgb, sum(w) = 1. Find w that best preserves color
//! contrast: for sampled pixel pairs (i, j), the gray difference should match
//! the color distance d_ij = ||c_i - c_j|| up to sign (bimodal constraint):
//!
//! ```text
//! E(w) = mean_pairs  min_{s in {-1,+1}} ( w.(c_i - c_j) - s * d_ij )^2
//! ```
//!
//! Optimization: discrete-continuous iteration
//!   E-step: s_ij = sign(w . (c_i - c_j))
//!   M-step: constrained least squares for w (sum(w) = 1) via a 4x4 KKT system
//! Pair sampling on a coarse grid -> O(1) w.r.t. image resolution.

use image::DynamicImage;

const REC709: [f64; 3] = [0.2126, 0.7152, 0.0722];
const GRID: u32 = 100;
const ITERS: usize = 15;
const SHRINK_AFTER: usize = 4;
const KEEP_FRAC: f64 = 0.9;

/// Pairs sampled on a coarse grid: RGB deltas and their Euclidean distances.
struct Pairs {
    deltas: Vec<[f64; 3]>,
    distances: Vec<f64>,
}

/// Sample horizontal + vertical neighbor pairs on a ~grid x grid lattice.
/// Identical colors carry no information and are dropped.
fn build_pairs(img: &DynamicImage, grid: u32) -> Pairs {
    let rgb = img.to_rgb32f();
    let (width, height) = rgb.dimensions();
    if width < 2 && height < 2 {
        return Pairs {
            deltas: Vec::new(),
            distances: Vec::new(),
        };
    }

    let sw = (width / grid).max(1);
    let sh = (height / grid).max(1);
    let xs: Vec<u32> = (0..width).step_by(sw as usize).collect();
    let ys: Vec<u32> = (0..height).step_by(sh as usize).collect();
    let gw = xs.len();
    let gh = ys.len();

    let mut grid_vals = Vec::with_capacity(gw * gh);
    for &y in &ys {
        for &x in &xs {
            let p = rgb.get_pixel(x, y);
            grid_vals.push([p[0] as f64, p[1] as f64, p[2] as f64]);
        }
    }

    let mut deltas = Vec::with_capacity(gw * gh * 2);
    let mut distances = Vec::with_capacity(gw * gh * 2);
    let mut push_pair = |a: [f64; 3], b: [f64; 3]| {
        let d = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
        let dist = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
        if dist > 1e-6 {
            deltas.push(d);
            distances.push(dist);
        }
    };
    for iy in 0..gh {
        for ix in 0..gw {
            let cur = grid_vals[iy * gw + ix];
            if ix + 1 < gw {
                push_pair(cur, grid_vals[iy * gw + ix + 1]);
            }
            if iy + 1 < gh {
                push_pair(cur, grid_vals[(iy + 1) * gw + ix]);
            }
        }
    }

    Pairs { deltas, distances }
}

/// E(w) = mean over pairs of min((w.d - d)^2, (w.d + d)^2).
fn energy(w: &[f64; 3], pairs: &Pairs) -> f64 {
    if pairs.deltas.is_empty() {
        return f64::MAX;
    }
    let mut sum = 0.0;
    for (d, dist) in pairs.deltas.iter().zip(&pairs.distances) {
        let proj = w[0] * d[0] + w[1] * d[1] + w[2] * d[2];
        let near = proj - dist;
        let far = proj + dist;
        sum += (near * near).min(far * far);
    }
    sum / pairs.deltas.len() as f64
}

/// Color Contrast Preserving ratio (Lu et al.): mean over pairs of
/// min(|gray_diff| / color_diff, 1). Higher = better.
#[cfg(test)]
fn ccp_ratio(w: &[f64; 3], pairs: &Pairs) -> f64 {
    if pairs.deltas.is_empty() {
        return 0.0;
    }
    let mut sum = 0.0;
    for (d, dist) in pairs.deltas.iter().zip(&pairs.distances) {
        let proj = (w[0] * d[0] + w[1] * d[1] + w[2] * d[2]).abs();
        sum += (proj / dist).min(1.0);
    }
    sum / pairs.deltas.len() as f64
}

/// Solve a 4x4 linear system by Gaussian elimination with partial pivoting.
/// Returns None if the system is (numerically) singular.
fn solve_4x4(a: &[[f64; 4]; 4], b: &[f64; 4]) -> Option<[f64; 4]> {
    let mut m = [[0.0f64; 5]; 4];
    for i in 0..4 {
        m[i][..4].copy_from_slice(&a[i]);
        m[i][4] = b[i];
    }
    for col in 0..4 {
        let mut pivot = col;
        let mut best = m[col][col].abs();
        for row in (col + 1)..4 {
            if m[row][col].abs() > best {
                best = m[row][col].abs();
                pivot = row;
            }
        }
        if best < 1e-12 {
            return None;
        }
        m.swap(col, pivot);
        for row in (col + 1)..4 {
            let factor = m[row][col] / m[col][col];
            for k in col..5 {
                m[row][k] -= factor * m[col][k];
            }
        }
    }
    let mut x = [0.0f64; 4];
    for i in (0..4).rev() {
        let mut s = m[i][4];
        for k in (i + 1)..4 {
            s -= m[i][k] * x[k];
        }
        x[i] = s / m[i][i];
    }
    Some(x)
}

/// Linear-interpolated quantile (numpy default method). Sorts `values`.
fn quantile(values: &mut [f64], q: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let pos = q * (values.len() - 1) as f64;
    let lo = pos.floor() as usize;
    let hi = pos.ceil() as usize;
    if lo == hi {
        values[lo]
    } else {
        let frac = pos - lo as f64;
        values[lo] * (1.0 - frac) + values[hi] * frac
    }
}

/// Iterative bimodal optimization from `init`, with light P-shrinking.
fn solve_weights(pairs: &Pairs, init: &[f64; 3]) -> [f64; 3] {
    let mut w = *init;
    let n = pairs.deltas.len();
    let mut active = vec![true; n];

    for it in 0..ITERS {
        // E-step: s = sign(w . delta); accumulate the normal equations over
        // the active pairs: A = sum(delta delta^T), b = sum(s * d * delta).
        let mut a = [[0.0f64; 3]; 3];
        let mut b = [0.0f64; 3];
        for i in 0..n {
            if !active[i] {
                continue;
            }
            let d = &pairs.deltas[i];
            let proj = w[0] * d[0] + w[1] * d[1] + w[2] * d[2];
            let s = if proj >= 0.0 { 1.0 } else { -1.0 };
            let sd = s * pairs.distances[i];
            for r in 0..3 {
                b[r] += sd * d[r];
                for c in 0..3 {
                    a[r][c] += d[r] * d[c];
                }
            }
        }

        // M-step: constrained least squares with sum(w) = 1 via the KKT
        // system [A 1; 1' 0] [w; lambda] = [b; 1].
        let k = [
            [a[0][0], a[0][1], a[0][2], 1.0],
            [a[1][0], a[1][1], a[1][2], 1.0],
            [a[2][0], a[2][1], a[2][2], 1.0],
            [1.0, 1.0, 1.0, 0.0],
        ];
        let rhs = [b[0], b[1], b[2], 1.0];
        let Some(sol) = solve_4x4(&k, &rhs) else {
            break;
        };

        // Project tiny negatives away, keep sum(w) = 1.
        let mut w_new = [sol[0].max(0.0), sol[1].max(0.0), sol[2].max(0.0)];
        let sum = w_new[0] + w_new[1] + w_new[2];
        if sum > 1e-9 {
            w_new = [w_new[0] / sum, w_new[1] / sum, w_new[2] / sum];
        }

        let diff = (w_new[0] - w[0])
            .abs()
            .max((w_new[1] - w[1]).abs())
            .max((w_new[2] - w[2]).abs());
        w = w_new;
        if diff < 1e-6 && it > 1 {
            break;
        }

        if it == SHRINK_AFTER {
            // P-shrinking: drop the worst pairs (above the keep_frac residual
            // quantile) so outliers stop pulling the solution.
            let mut residuals: Vec<f64> = pairs
                .deltas
                .iter()
                .zip(&pairs.distances)
                .map(|(d, dist)| {
                    let proj = w[0] * d[0] + w[1] * d[1] + w[2] * d[2];
                    (proj.abs() - dist).abs()
                })
                .collect();
            let thr = quantile(&mut residuals, KEEP_FRAC);
            for (i, res) in residuals.iter().enumerate() {
                active[i] = *res <= thr;
            }
        }
    }

    w
}

/// Run the solver from several inits and keep the lowest-energy candidate.
/// The hard-assignment iterations can wander, so the raw inits also compete.
fn solve_weights_multistart(pairs: &Pairs) -> [f64; 3] {
    let inits: [[f64; 3]; 5] = [
        REC709,
        [1.0 / 3.0, 1.0 / 3.0, 1.0 / 3.0],
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
    ];

    let mut best = inits[0];
    let mut best_e = f64::MAX;
    let mut consider = |w: [f64; 3]| {
        let e = energy(&w, pairs);
        if e < best_e {
            best_e = e;
            best = w;
        }
    };
    for init in &inits {
        consider(*init);
    }
    for init in &inits {
        consider(solve_weights(pairs, init));
    }
    best
}

/// Compute contrast-preserving grayscale weights (r, g, b; summing to 1) for
/// the given image. Expects a preview-sized input: the sole caller passes a
/// <=512px 8-bit graded preview. The optimizer itself is O(1) in resolution
/// (pairs are sampled on a ~100x100 grid), but `build_pairs` materializes the
/// whole image as f32 (`to_rgb32f`), which dominates the cost at full res.
/// Falls back to Rec.709 luma for degenerate (e.g. empty) inputs.
pub fn compute_weights(img: &DynamicImage) -> (f64, f64, f64) {
    let pairs = build_pairs(img, GRID);
    let w = solve_weights_multistart(&pairs);
    (w[0], w[1], w[2])
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb};

    /// Isoluminant (Rec.709) red/blue halves: the classic failure case for
    /// plain luminance — both halves map to nearly the same gray.
    fn isoluminant_test_image() -> DynamicImage {
        let w = 256;
        let h = 128;
        let mut img = ImageBuffer::<Rgb<f32>, Vec<f32>>::new(w, h);
        for y in 0..h {
            for x in 0..w {
                let px = if x < w / 2 {
                    [0.30f32, 0.0, 0.0]
                } else {
                    [0.0, 0.0, 0.883]
                };
                img.put_pixel(x, y, Rgb(px));
            }
        }
        DynamicImage::ImageRgb32F(img)
    }

    #[test]
    fn preserves_contrast_better_than_luminance() {
        let img = isoluminant_test_image();
        let pairs = build_pairs(&img, GRID);
        assert!(!pairs.deltas.is_empty(), "synthetic image must yield pairs");

        let w = solve_weights_multistart(&pairs);
        let rec709_ccp = ccp_ratio(&REC709, &pairs);
        let rtcp_ccp = ccp_ratio(&w, &pairs);

        assert!(
            rtcp_ccp > rec709_ccp + 0.05,
            "RTCP CCP {rtcp_ccp:.4} should clearly beat Rec.709 {rec709_ccp:.4} (w = {w:?})"
        );
        // The solution must not collapse to plain luminance on this
        // isoluminant input.
        let drift = (w[0] - REC709[0]).abs() + (w[1] - REC709[1]).abs() + (w[2] - REC709[2]).abs();
        assert!(drift > 0.1, "weights {w:?} collapsed to Rec.709 luminance");
        // Weights stay a valid convex combination.
        let sum: f64 = w.iter().sum();
        assert!(
            w.iter().all(|c| *c >= 0.0) && (sum - 1.0).abs() < 1e-6,
            "weights {w:?} are not a normalized convex combination"
        );
    }

    #[test]
    fn empty_image_falls_back_to_rec709() {
        let img = DynamicImage::new_rgb8(4, 4);
        let (r, g, b) = compute_weights(&img);
        assert_eq!([r, g, b], REC709);
    }

    /// Golden: on the isoluminant red/blue-halves image the optimizer picks
    /// the pure-blue vertex exactly (it maximizes |w.delta| over the simplex).
    #[test]
    fn golden_weights_on_isoluminant_image() {
        let img = isoluminant_test_image();
        let (r, g, b) = compute_weights(&img);
        assert_eq!([r, g, b], [0.0, 0.0, 1.0]);
    }

    #[test]
    fn gray_image_keeps_luminance_like_weights() {
        // A pure grayscale gradient carries no color contrast: any weights
        // summing to 1 give the same gray, so energy is minimal everywhere;
        // the result just has to stay a valid convex combination.
        let mut img = ImageBuffer::<Rgb<f32>, Vec<f32>>::new(64, 64);
        for y in 0..64 {
            for x in 0..64 {
                let v = (x + y) as f32 / 126.0;
                img.put_pixel(x, y, Rgb([v, v, v]));
            }
        }
        let (r, g, b) = compute_weights(&DynamicImage::ImageRgb32F(img));
        let sum = r + g + b;
        assert!(
            r >= 0.0 && g >= 0.0 && b >= 0.0 && (sum - 1.0).abs() < 1e-6,
            "weights ({r}, {g}, {b}) are not a normalized convex combination"
        );
    }
}
