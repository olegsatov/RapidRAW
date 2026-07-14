"""

Apply baked flim 3D LUTs to Sony ARW files (scene-referred path).

ARW -> rawpy (linear sRGB/BT.709, camera WB, no auto-bright)
-> auto EV anchor (mean luma -> 0.18) -> log2 compression [-10,+10]
-> trilinear LUT sample -> comparison grid (neutral / default / nostalgia / silver)

Usage:
  python apply_luts_raw.py --luts <dir> --out <dir> img1.ARW [img2.ARW ...]

"""

import argparse
import os
import sys

import numpy as np
import colour
import rawpy
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply_luts import load_spi3d, sample_lut_trilinear, LOG2_MIN, LOG2_MAX, OFFSET

LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def load_raw_linear(path, stride=3):
    with rawpy.imread(path) as raw:
        img = raw.postprocess(
            gamma=(1, 1), no_auto_bright=True, use_camera_wb=True,
            output_color=rawpy.ColorSpace.sRGB, output_bps=16, half_size=True,
        )
        sat = float(np.mean(img >= 65530))
    lin = img[1::stride, 1::stride].astype(np.float32) / 65535.0
    return lin, sat


def auto_ev(lin, target=0.18, lo=-2.0, hi=2.5):
    luma = lin @ LUMA
    mean = float(np.mean(luma)) + 1e-6
    ev = float(np.clip(np.log2(target / mean), lo, hi))
    return ev


def process(path, luts):
    lin, sat = load_raw_linear(path)
    ev = auto_ev(lin)
    lin_ev = np.maximum(lin * (2.0 ** ev), 0.0)

    c = np.log2(lin_ev + OFFSET)
    c = np.clip((c - LOG2_MIN) / (LOG2_MAX - LOG2_MIN), 0.0, 1.0)

    results = {'neutral': colour.models.eotf_inverse_sRGB(np.clip(lin_ev, 0, 1))}
    for name, table in luts.items():
        results[name] = np.clip(sample_lut_trilinear(table, c), 0.0, 1.0)
    return results, ev, sat


def make_grid(results, cell_w=560):
    names = list(results.keys())
    cols = 2
    rows = (len(names) + 1) // 2
    cells = []
    for name in names:
        arr = results[name]
        h, w = arr.shape[:2]
        ch = round(cell_w * h / w)
        im = Image.fromarray((arr * 255).astype(np.uint8)).resize(
            (cell_w, ch), Image.LANCZOS)
        cells.append((name, im))
    cell_h = max(im.height for _, im in cells)
    label_h = 22
    grid = Image.new('RGB', (cols * cell_w, rows * (cell_h + label_h)), (20, 20, 20))
    draw = ImageDraw.Draw(grid)
    for i, (name, im) in enumerate(cells):
        x = (i % cols) * cell_w
        y = (i // cols) * (cell_h + label_h)
        grid.paste(im, (x, y + label_h))
        draw.text((x + 6, y + 5), name, fill=(255, 255, 0))
    return grid


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--luts', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('images', nargs='+')
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    luts = {}
    for fn in sorted(os.listdir(args.luts)):
        if fn.endswith('.spi3d'):
            name = fn.replace('flim_', '').replace('.spi3d', '')
            print(f'loading LUT {name}...')
            luts[name] = load_spi3d(os.path.join(args.luts, fn))

    for path in args.images:
        stem = os.path.splitext(os.path.basename(path))[0]
        print(f'processing {stem}...', flush=True)
        results, ev, sat = process(path, luts)
        grid = make_grid(results)
        out_path = os.path.join(args.out, f'{stem}_flim_grid.png')
        grid.save(out_path)
        print(f'  -> {out_path}  (auto_ev={ev:+.2f}, sensor_clipped={sat*100:.2f}%)')


if __name__ == '__main__':
    main()
