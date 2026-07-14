"""

Apply baked flim 3D LUTs (.spi3d) to sRGB images and build comparison grids.

The full OCIO path, replicated manually:
  sRGB image -> linearize (sRGB EOTF) -> optional EV gain
  -> log2 compression [-10, +10] with 2**-10 offset
  -> trilinear sample of the 80^3 LUT -> sRGB out

Usage:
  python apply_luts.py --luts <dir-with-spi3d> --images <img1> [img2 ...] --out <dir> [--ev 0.0]

"""

import argparse
import os

import numpy as np
import colour
from PIL import Image, ImageDraw

LOG2_MIN = -10.0
LOG2_MAX = 10.0
OFFSET = 2.0 ** LOG2_MIN


def sample_lut_trilinear(table, coords):
    """table: (N,N,N,3) indexed [r][g][b]; coords: (...,3) in [0,1]."""
    n = table.shape[0]
    p = coords * (n - 1)
    i0 = np.floor(p).astype(np.int64)
    i1 = np.minimum(i0 + 1, n - 1)
    f = (p - i0)[..., None]  # (...,3,1) -> per-channel frac, keep for lerp

    r0, g0, b0 = i0[..., 0], i0[..., 1], i0[..., 2]
    r1, g1, b1 = i1[..., 0], i1[..., 1], i1[..., 2]
    fr, fg, fb = f[..., 0, :], f[..., 1, :], f[..., 2, :]

    def at(r, g, b):
        return table[r, g, b]  # (...,3)

    c000 = at(r0, g0, b0)
    c001 = at(r0, g0, b1)
    c010 = at(r0, g1, b0)
    c011 = at(r0, g1, b1)
    c100 = at(r1, g0, b0)
    c101 = at(r1, g0, b1)
    c110 = at(r1, g1, b0)
    c111 = at(r1, g1, b1)

    c00 = c000 + (c001 - c000) * fb
    c01 = c010 + (c011 - c010) * fb
    c10 = c100 + (c101 - c100) * fb
    c11 = c110 + (c111 - c110) * fb
    c0 = c00 + (c01 - c00) * fg
    c1 = c10 + (c11 - c10) * fg
    return c0 + (c1 - c0) * fr


def load_spi3d(path):
    lut = colour.io.read_LUT_SonySPI3D(path)
    # colour stores table indexed [r][g][b], domain [0,1] for linear_table
    return np.asarray(lut.table, dtype=np.float32)


def process_image(path, luts, ev):
    img = Image.open(path).convert('RGB')
    arr = np.asarray(img, dtype=np.float32) / 255.0

    # sRGB -> Linear BT.709
    lin = colour.models.eotf_sRGB(arr)
    lin = np.maximum(lin, 0.0) * (2.0 ** ev)

    # log2 compression
    c = np.log2(lin + OFFSET)
    c = np.clip((c - LOG2_MIN) / (LOG2_MAX - LOG2_MIN), 0.0, 1.0)

    results = {'original': arr}
    for name, table in luts.items():
        out = sample_lut_trilinear(table, c)
        results[name] = np.clip(out, 0.0, 1.0)
    return results


def make_grid(results, cell_w=512):
    names = list(results.keys())
    n = len(names)
    cols = 2 if n <= 4 else 3
    rows = (n + cols - 1) // cols

    # resize all to cell_w width
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
    ap.add_argument('--luts', required=True, help='dir containing flim_*.spi3d')
    ap.add_argument('--images', nargs='+', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--ev', type=float, default=0.0)
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
        print(f'processing {stem}...')
        results = process_image(path, luts, args.ev)
        grid = make_grid(results)
        out_path = os.path.join(args.out, f'{stem}_flim_grid.png')
        grid.save(out_path)
        print(f'  -> {out_path}')


if __name__ == '__main__':
    main()
