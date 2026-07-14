#!/usr/bin/env python3
"""
RTCP - Real-time Contrast Preserving Decolorization
Lu, Xu, Jia. "Real-time contrast preserving decolorization",
SIGGRAPH Asia 2012 Technical Briefs, Article 34.

Standalone test implementation (numpy/PIL), not integrated into RapidRAW.

Idea:
  gray = w . rgb,  sum(w) = 1
  Find w that best preserves color contrast: for sampled pixel pairs (i, j),
  the gray difference should match the color difference d_ij = ||c_i - c_j||
  up to sign (bimodal / weak order constraint):

      E(w) = sum_pairs  min_{s in {-1,+1}} ( w.(c_i - c_j) - s * d_ij )^2

  Optimization: discrete-continuous iteration
    E-step: s_ij = sign(w . (c_i - c_j))
    M-step: constrained least squares for w (sum(w) = 1) via KKT system
  Pair sampling on a coarse grid -> O(1) w.r.t. image resolution.
"""

import sys
import time
import numpy as np
from PIL import Image, ImageDraw

REC709 = np.array([0.2126, 0.7152, 0.0722], dtype=np.float64)


def srgb_to_lab(img):
    """sRGB [0,1] -> CIELAB (D65), L in [0,100], a/b unbounded."""
    lin = np.where(img > 0.04045, ((img + 0.055) / 1.055) ** 2.4, img / 12.92)
    M = np.array([[0.4124564, 0.3575761, 0.1804375],
                  [0.2126729, 0.7151522, 0.0721750],
                  [0.0193339, 0.1191920, 0.9503041]])
    xyz = lin @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16.0 / 116.0)
    L = 116.0 * f[..., 1] - 16.0
    a = 500.0 * (f[..., 0] - f[..., 1])
    b = 200.0 * (f[..., 1] - f[..., 2])
    return np.stack([L, a, b], axis=-1)


def build_pairs(img, grid=100, delta_mode="rgb"):
    """Sample pixel pairs on a coarse grid: horizontal + vertical neighbors.
    Returns RGB deltas (N,3) and color distances d (N,).
    delta_mode: 'rgb' (Euclidean RGB, per the RTCP brief) or 'lab' (CIELAB
    Delta-E rescaled to RGB-difference units, closer to the ICCP paper)."""
    h, w, _ = img.shape
    sh = max(1, h // grid)
    sw = max(1, w // grid)
    g = img[::sh, ::sw]  # (gh, gw, 3)
    right = g[:, :-1] - g[:, 1:]      # (gh, gw-1, 3)
    down = g[:-1, :] - g[1:, :]       # (gh-1, gw, 3)
    deltas = np.concatenate([right.reshape(-1, 3), down.reshape(-1, 3)], axis=0)
    d_rgb = np.linalg.norm(deltas, axis=1)
    if delta_mode == "lab":
        gl = srgb_to_lab(g)
        dl = np.concatenate([
            np.linalg.norm(gl[:, :-1] - gl[:, 1:], axis=2).ravel(),
            np.linalg.norm(gl[:-1, :] - gl[1:, :], axis=2).ravel(),
        ])
        keep = dl > 1e-6
        d = dl[keep] * (d_rgb[keep].mean() / dl[keep].mean())  # rescale to RGB units
        return deltas[keep].astype(np.float64), d.astype(np.float64)
    keep = d_rgb > 1e-6                 # identical colors carry no information
    return deltas[keep].astype(np.float64), d_rgb[keep].astype(np.float64)


def solve_weights(deltas, d, iters=15, shrink_after=4, keep_frac=0.9, init=None):
    """Iterative bimodal optimization with light P-shrinking."""
    w = REC709.copy() if init is None else np.asarray(init, dtype=np.float64)
    active = np.ones(len(d), dtype=bool)
    for it in range(iters):
        D, dd = deltas[active], d[active]
        proj = D @ w
        s = np.where(proj >= 0.0, 1.0, -1.0)          # E-step: pick nearer mode
        A = D.T @ D
        b = D.T @ (s * dd)
        # KKT for sum(w)=1:  [A 1; 1' 0] [w; lam] = [b; 1]
        K = np.block([[A, np.ones((3, 1))], [np.ones((1, 3)), np.zeros((1, 1))]])
        rhs = np.concatenate([b, [1.0]])
        try:
            w_new = np.linalg.solve(K, rhs)[:3]
        except np.linalg.LinAlgError:
            break
        # project tiny negatives, keep sum=1
        w_new = np.clip(w_new, 0.0, None)
        if w_new.sum() > 1e-9:
            w_new /= w_new.sum()
        if np.max(np.abs(w_new - w)) < 1e-6 and it > 1:
            w = w_new
            break
        w = w_new
        if it == shrink_after:                         # P-shrinking: drop worst pairs
            res = np.abs(np.abs(deltas @ w) - d)
            thr = np.quantile(res, keep_frac)
            active = res <= thr
    return w


def srgb_to_lab_L(img):
    """L* channel of CIELAB (D65), normalized to [0,1]. sRGB input in [0,1]."""
    lin = np.where(img > 0.04045, ((img + 0.055) / 1.055) ** 2.4, img / 12.92)
    M = np.array([[0.4124564, 0.3575761, 0.1804375],
                  [0.2126729, 0.7151522, 0.0721750],
                  [0.0193339, 0.1191920, 0.9503041]])
    xyz = lin @ M.T
    xyz = xyz / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16.0 / 116.0)
    L = 116.0 * f[..., 1] - 16.0
    return np.clip(L / 100.0, 0.0, 1.0)


def energy(w, deltas, d):
    proj = deltas @ w
    return np.minimum((proj - d) ** 2, (proj + d) ** 2).mean()


def ccp_ratio(w, deltas, d):
    """Color Contrast Preserving ratio (Lu et al.): mean over pairs of
    min(|gray_diff| / color_diff, 1). Higher = better."""
    return np.minimum(np.abs(deltas @ w) / d, 1.0).mean()


def solve_weights_multistart(deltas, d):
    inits = [REC709, [1/3, 1/3, 1/3], [1, 0, 0], [0, 1, 0], [0, 0, 1]]
    # hard-assignment iterations can wander, so the raw inits also compete
    cands = [np.asarray(i, dtype=np.float64) for i in inits]
    cands += [solve_weights(deltas, d, init=i) for i in inits]
    es = [energy(w, deltas, d) for w in cands]
    return cands[int(np.argmin(es))]


def rtcp(img, delta_mode="rgb"):
    t0 = time.perf_counter()
    deltas, d = build_pairs(img, delta_mode=delta_mode)
    t1 = time.perf_counter()
    w = solve_weights_multistart(deltas, d)
    t2 = time.perf_counter()
    gray = np.clip(img @ w, 0.0, 1.0)
    return gray, w, (t1 - t0, t2 - t1), (deltas, d)


def gray_to_rgb(g):
    return (np.clip(g, 0, 1) * 255).astype(np.uint8)[..., None].repeat(3, axis=2)


def make_comparison(img, path, delta_mode="rgb"):
    gray709 = img @ REC709
    lab_L = srgb_to_lab_L(img)
    gray_rtcp, w, (t_pairs, t_solve), (deltas, d) = rtcp(img, delta_mode=delta_mode)

    panels = [
        ((img * 255).astype(np.uint8), "original"),
        (gray_to_rgb(gray709), "Rec.709 luminance"),
        (gray_to_rgb(lab_L), "CIELAB L*"),
        (gray_to_rgb(gray_rtcp), f"RTCP w=({w[0]:.3f},{w[1]:.3f},{w[2]:.3f})"),
    ]
    h, wd = img.shape[:2]
    pad, lab_h = 8, 22
    canvas = np.full(((h + lab_h + pad) * 2 + pad, (wd + pad) * 2 + pad, 3), 40, np.uint8)
    out = Image.fromarray(canvas)
    dr = ImageDraw.Draw(out)
    for i, (arr, label) in enumerate(panels):
        r, c = divmod(i, 2)
        x = pad + c * (wd + pad)
        y = pad + r * (h + lab_h + pad)
        out.paste(Image.fromarray(arr), (x, y))
        dr.text((x + 4, y + h + 4), label, fill=(255, 255, 255))
    out.save(path)
    print(f"[{path}]")
    print(f"  RTCP weights: R={w[0]:.4f} G={w[1]:.4f} B={w[2]:.4f}")
    print(f"  pair-build {t_pairs*1000:.1f} ms, solve {t_solve*1000:.2f} ms")
    print(f"  mean gray: Rec709={gray709.mean():.3f}  LabL={lab_L.mean():.3f}  RTCP={gray_rtcp.mean():.3f}")
    print(f"  CCP ratio: Rec709={ccp_ratio(REC709, deltas, d):.4f}  RTCP={ccp_ratio(w, deltas, d):.4f}")
    cands = {"Rec709": REC709, "R": [1, 0, 0], "G": [0, 1, 0], "B": [0, 0, 1], "RTCP": w}
    es = "  ".join(f"{k}={energy(np.asarray(v, float), deltas, d):.5f}" for k, v in cands.items())
    print(f"  energy({delta_mode}): {es}")
    return w


def make_synthetic():
    """Isoluminant (Rec.709) red/blue + colorful stripes: classic failure case
    for plain luminance."""
    h, w = 256, 512
    img = np.zeros((h, w, 3), np.float64)
    # left: red (0.30,0,0) vs blue (0,0,0.883)  -> equal Rec.709 luminance 0.0638
    img[:, :w // 4] = (0.30, 0.0, 0.0)
    img[:, w // 4:w // 2] = (0.0, 0.0, 0.883)
    # right: saturated stripes with near-equal luminance
    cols = [(0.9, 0.1, 0.1), (0.1, 0.35, 0.1), (0.2, 0.2, 0.95), (0.7, 0.45, 0.05)]
    for k, col in enumerate(cols):
        img[:, w // 2 + k * (w // 8): w // 2 + (k + 1) * (w // 8)] = col
    return img


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    delta_mode = "lab" if "--lab" in sys.argv else "rgb"
    if "--synthetic" in sys.argv:
        img = make_synthetic()
        Image.fromarray((img * 255).astype(np.uint8)).save("scratch/rtcp_test/synthetic.png")
        make_comparison(img, f"scratch/rtcp_test/cmp_synthetic_{delta_mode}.png", delta_mode)
        sys.exit(0)
    for p in args:
        img = np.asarray(Image.open(p).convert("RGB"), dtype=np.float64) / 255.0
        name = p.rsplit("/", 1)[-1].rsplit(".", 1)[0]
        make_comparison(img, f"scratch/rtcp_test/cmp_{name}_{delta_mode}.png", delta_mode)
