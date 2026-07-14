"""Print flim derived constants per preset, using the reference implementation.

Compare against the Rust port (compute_flim_uniforms in image_processing.rs).
"""

import numpy as np
import sys

sys.path.insert(0, '/Users/someone/Coding/RAW/scratch/flim')

from utils import gamut_extension_mat
from flim import negative_and_print

PRESETS = {
    'default': dict(
        pre_exposure=4.3,
        red_scale=1.05, green_scale=1.12, blue_scale=1.045,
        red_rot=.5, green_rot=2., blue_rot=.1,
        red_mul=1., green_mul=1., blue_mul=1.,
        log2_min=-10., log2_max=22.,
        neg_exp=6., neg_den=5.,
        backlight=np.array([1., 1., 1.]),
        print_exp=6., print_den=27.5,
        black_point='auto',
    ),
    'nostalgia': dict(
        pre_exposure=5.563035,
        red_scale=1.05, green_scale=1.12, blue_scale=1.045,
        red_rot=.5, green_rot=2., blue_rot=.1,
        red_mul=1.1, green_mul=1., blue_mul=1.2,
        log2_min=-10., log2_max=23.,
        neg_exp=5.8, neg_den=5.,
        backlight=np.array([.99, 1.1, 1.035989]),
        print_exp=6., print_den=40.,
        black_point=-5.,
    ),
    'silver': dict(
        pre_exposure=3.9,
        red_scale=1.05, green_scale=1.12, blue_scale=1.045,
        red_rot=.5, green_rot=2., blue_rot=.1,
        red_mul=1., green_mul=1., blue_mul=1.06,
        log2_min=-10., log2_max=22.,
        neg_exp=4.7, neg_den=7.,
        backlight=np.array([.9992, .99, 1.]),
        print_exp=4.7, print_den=30.,
        black_point=.5,
    ),
}

# keys expected by negative_and_print
for name, p in PRESETS.items():
    preset = {
        'sigmoid_log2_min': p['log2_min'],
        'sigmoid_log2_max': p['log2_max'],
        'sigmoid_toe_x': .44,
        'sigmoid_toe_y': .28,
        'sigmoid_shoulder_x': .591,
        'sigmoid_shoulder_y': .779,
        'negative_film_exposure': p['neg_exp'],
        'negative_film_density': p['neg_den'],
        'print_film_exposure': p['print_exp'],
        'print_film_density': p['print_den'],
    }
    extend_mat = gamut_extension_mat(
        p['red_scale'], p['green_scale'], p['blue_scale'],
        p['red_rot'], p['green_rot'], p['blue_rot'],
        p['red_mul'], p['green_mul'], p['blue_mul'],
    )
    inv = np.linalg.inv(extend_mat)
    backlight_ext = np.matmul(extend_mat, p['backlight'])
    white_cap = negative_and_print(np.array([1e7, 1e7, 1e7]), preset, backlight_ext)
    black_cap = negative_and_print(np.array([0., 0., 0.]), preset, backlight_ext) / white_cap
    if p['black_point'] == 'auto':
        bp = float(np.dot(black_cap, np.array([.3, .5, .2])))
    else:
        bp = p['black_point'] / 1000.

    np.set_printoptions(precision=8, suppress=False)
    print(f'=== {name} ===')
    print('extend_mat rows:')
    for r in extend_mat:
        print('   ', r)
    print('extend_mat_inv rows:')
    for r in inv:
        print('   ', r)
    print('backlight_ext:', backlight_ext)
    print('white_cap:   ', white_cap)
    print('black_cap_luma:', bp)
