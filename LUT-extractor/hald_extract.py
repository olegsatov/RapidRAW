#!/usr/bin/env python3
"""
Extract .cube 3D LUT from standard HALD CLUT image.

Standard HALD layout (Resolve format):
  Pixel (x,y) → index = y * width + x
  R_in = index // (N*N) / (N-1)
  G_in = (index // N) % N / (N-1)
  B_in = index % N / (N-1)

For 512×512 → perfect 64³ LUT.
For 1024×1024 → use --cube-size to specify (default auto-detect).

Usage:
  python3 hald_extract.py processed.png -n "Kodak Portra 400" -o portra400.cube
"""

import struct
import zlib
import os
import sys
import math
import argparse
from pathlib import Path


def read_png(path):
    """Read PNG → (width, height, pixel_bytes_RGB)."""
    with open(path, 'rb') as f:
        sig = f.read(8)
        if sig != b'\x89PNG\r\n\x1a\n':
            raise ValueError("Not PNG")
        
        width = height = None
        idat_chunks = []
        
        while True:
            lb = f.read(4)
            if len(lb) < 4:
                break
            length = struct.unpack('>I', lb)[0]
            ctype = f.read(4).decode('ascii', errors='replace')
            data = f.read(length)
            f.read(4)  # CRC
            
            if ctype == 'IHDR':
                width, height = struct.unpack('>II', data[:8])
                bd, ct = data[8], data[9]
                if bd != 8 or ct not in (2, 6):
                    raise ValueError(f"Need 8-bit RGB/RGBA PNG, got {bd}-bit type {ct}")
            elif ctype == 'IDAT':
                idat_chunks.append(data)
            elif ctype == 'IEND':
                break
        
        raw = zlib.decompress(b''.join(idat_chunks))
        
        # PNG may be RGB (3) or RGBA (4) channels
        if ct == 6:  # RGBA
            row_width = width * 4 + 1
            ch = 4
        else:
            row_width = width * 3 + 1
            ch = 3
        
        pixels = bytearray()
        prev_row = bytearray(width * ch)
        
        for y in range(height):
            start = y * row_width
            filt = raw[start]
            row_data = bytearray(raw[start + 1 : start + row_width])
            
            # Unfilter
            if filt == 1:  # Sub
                for i in range(ch, width * ch):
                    row_data[i] = (row_data[i] + row_data[i - ch]) & 0xFF
            elif filt == 2:  # Up
                for i in range(width * ch):
                    row_data[i] = (row_data[i] + prev_row[i]) & 0xFF
            elif filt == 3:  # Average
                for i in range(width * ch):
                    a = row_data[i - ch] if i >= ch else 0
                    b = prev_row[i]
                    row_data[i] = (row_data[i] + ((a + b) // 2)) & 0xFF
            elif filt == 4:  # Paeth
                for i in range(width * ch):
                    a = row_data[i - ch] if i >= ch else 0
                    b = prev_row[i]
                    c = prev_row[i - ch] if i >= ch else 0
                    p = a + b - c
                    pa = abs(p - a)
                    pb = abs(p - b)
                    pc = abs(p - c)
                    pr = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                    row_data[i] = (row_data[i] + pr) & 0xFF
            
            # Extract RGB (skip alpha if present)
            for i in range(width):
                pixels.extend(row_data[i*ch : i*ch + 3])
            
            prev_row = row_data
        
        return width, height, bytes(pixels)


def read_ppm(path):
    """Read P6 PPM → (width, height, pixel_bytes_RGB)."""
    with open(path, 'rb') as f:
        hdr = f.readline().decode().strip()
        if hdr != 'P6':
            raise ValueError(f"Need P6 PPM, got {hdr}")
        line = f.readline().decode().strip()
        while line.startswith('#'):
            line = f.readline().decode().strip()
        w, h = map(int, line.split())
        maxval = int(f.readline().decode().strip())
        return w, h, f.read()


def read_tiff_via_sips(path):
    """Read TIFF by converting to PNG with sips, then reading PNG."""
    import subprocess, tempfile
    png_path = tempfile.mktemp(suffix='.png')
    try:
        subprocess.run(['sips', '-s', 'format', 'png', path, '--out', png_path],
                      capture_output=True, check=True)
        return read_png(png_path)
    finally:
        if os.path.exists(png_path):
            os.remove(png_path)


def read_image(path):
    """Read PNG/PPM/TIFF → (width, height, pixel_bytes)."""
    ext = Path(path).suffix.lower()
    if ext == '.png':
        return read_png(path)
    elif ext == '.ppm':
        return read_ppm(path)
    elif ext in ('.tiff', '.tif'):
        return read_tiff_via_sips(path)
    raise ValueError(f"Unsupported: {ext}")


def detect_cube_size(w, h):
    """Find largest cube N³ ≤ w*h."""
    total = w * h
    n = int(total ** (1/3))
    while (n+1)**3 <= total:
        n += 1
    return n


def extract_lut(path, n_request=None):
    """Extract N³ LUT from HALD image. Reads at native cube size, then optionally resamples."""
    w, h, pixels = read_image(path)
    print(f"Image: {w}×{h}, {len(pixels)} bytes RGB")
    
    # Native cube size derived from image dimensions
    n_native = detect_cube_size(w, h)
    native_total = n_native ** 3
    used = min(native_total, w * h)
    
    print(f"Native cube: {n_native}³ = {native_total:,} entries (using {used:,} pixels)")
    
    # Read all native LUT entries
    native_lut = {}
    idx = 0
    for y in range(h):
        for x in range(w):
            i = y * w + x
            if i >= used:
                break
            
            ri = i // (n_native * n_native)
            gi = (i // n_native) % n_native
            bi = i % n_native
            
            pixel_idx = (y * w + x) * 3
            r_out = pixels[pixel_idx] / 255.0
            g_out = pixels[pixel_idx+1] / 255.0
            b_out = pixels[pixel_idx+2] / 255.0
            
            native_lut[(ri, gi, bi)] = (r_out, g_out, b_out)
            idx += 1
    
    print(f"Read {idx:,} entries from image")
    
    # Resample to requested size (nearest-neighbor)
    if n_request is not None and n_request != n_native:
        ratio = (n_native - 1) / (n_request - 1)
        lut = {}
        for ri in range(n_request):
            r_native = min(int(round(ri * ratio)), n_native - 1)
            for gi in range(n_request):
                g_native = min(int(round(gi * ratio)), n_native - 1)
                for bi in range(n_request):
                    b_native = min(int(round(bi * ratio)), n_native - 1)
                    key = (r_native, g_native, b_native)
                    lut[(ri, gi, bi)] = native_lut.get(key, (
                        ri / (n_request - 1),
                        gi / (n_request - 1),
                        bi / (n_request - 1)
                    ))
        print(f"Resampled to {n_request}³")
        return lut, n_request
    
    return native_lut, n_native


def write_cube(path, lut, n, title="Extracted LUT"):
    """Write .cube 3D LUT file (standard R-fastest order)."""
    with open(path, 'w') as f:
        f.write(f'TITLE "{title}"\n')
        f.write(f'LUT_3D_SIZE {n}\n')
        f.write('DOMAIN_MIN 0.0 0.0 0.0\n')
        f.write('DOMAIN_MAX 1.0 1.0 1.0\n')
        f.write('\n')
        
        # Standard .cube: R fastest (innermost), G middle, B slowest (outermost)
        count = 0
        for bi in range(n):
            for gi in range(n):
                for ri in range(n):
                    key = (ri, gi, bi)
                    if key in lut:
                        r, g, b = lut[key]
                    else:
                        r = ri / (n - 1)
                        g = gi / (n - 1)
                        b = bi / (n - 1)
                    f.write(f'{r:.6f} {g:.6f} {b:.6f}\n')
                    count += 1
    
    size_kb = os.path.getsize(path) / 1024
    print(f"Written: {path}")
    print(f"  {n}³ = {count:,} entries, {size_kb:.0f} KB")


def main():
    parser = argparse.ArgumentParser(description='Extract .cube LUT from HALD image')
    parser.add_argument('input', help='Processed HALD image')
    parser.add_argument('--name', '-n', default='Extracted LUT', help='LUT title')
    parser.add_argument('--output', '-o', help='Output .cube path')
    parser.add_argument('--cube-size', '-s', type=int, help='LUT cube size (auto-detect if omitted)')
    args = parser.parse_args()
    
    if not args.output:
        args.output = str(Path(args.input).with_suffix('.cube'))
    
    print(f"Reading {args.input}...")
    lut, n = extract_lut(args.input, args.cube_size)
    write_cube(args.output, lut, n, args.name)


if __name__ == '__main__':
    main()
