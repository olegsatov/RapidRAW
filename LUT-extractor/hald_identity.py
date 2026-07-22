#!/usr/bin/env python3
"""
Generate standard identity HALD CLUT image (Resolve/3DLUT-Creator format).

Standard layout for 512x512:
  Each pixel position (x,y) maps to a unique (R,G,B) via:
    index = y * 512 + x           (0 .. 262143 = 64³-1)
    R = index / (64*64) / 63
    G = (index / 64) % 64 / 63
    B = index % 64 / 63

For 1024x1024 (approximate 101³):
    index = y * 1024 + x
    R = index / (101*101) / 100
    G = (index / 101) % 101 / 100
    B = index % 101 / 100
"""

import struct
import sys
import math
import os


def cube_size_for_image(w, h=None):
    """Find the largest cube N³ that fits in w*h pixels."""
    if h is None:
        h = w
    total = w * h
    n = int(total ** (1 / 3))
    while n**3 <= total:
        n += 1
    n -= 1
    return n, n**3


def generate_hald(path, width, height, n=None):
    """
    Generate identity HALD as PPM P6.
    
    Standard layout: i = y * width + x
      R = i // (n*n) / (n-1)
      G = (i // n) % n / (n-1)
      B = i % n / (n-1)
    """
    if n is None:
        n, used = cube_size_for_image(width, height)
    else:
        used = n**3
    
    assert used <= width * height, f"Cube {n}³={used} doesn't fit in {width}×{height}={width*height}"
    
    maxval = 255
    
    with open(path, 'wb') as f:
        f.write(f"P6\n{width} {height}\n{maxval}\n".encode())
        
        for y in range(height):
            row = bytearray()
            for x in range(width):
                i = y * width + x
                
                if i < used:
                    ri = i // (n * n)
                    gi = (i // n) % n
                    bi = i % n
                    r = int(ri * maxval / (n - 1))
                    g = int(gi * maxval / (n - 1))
                    b = int(bi * maxval / (n - 1))
                else:
                    # Padding pixels: black
                    r = g = b = 0
                
                row.extend([r, g, b])
            f.write(bytes(row))
    
    print(f"Generated {path}: {width}×{height}, cube {n}³ ({used:,} entries, {width*height - used} pad)")


if __name__ == '__main__':
    out_dir = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
    
    # 512x512 = perfect 64³
    path_512 = os.path.join(out_dir, 'hald_identity_512.ppm')
    generate_hald(path_512, 512, 512)
    
    # 1024x1024: auto-detect cube size
    path_1024 = os.path.join(out_dir, 'hald_identity_1024.ppm')
    n, _ = cube_size_for_image(1024, 1024)
    generate_hald(path_1024, 1024, 1024, n=n)
