// Film stock profiles — curves and parameters ported 1:1 from the upstream
// film-simulation project (https://github.com/sinanonur/film-simulation,
// 12-film-profiles.json), MIT License, Copyright (c) 2024 sinanonur.
// Only film grain is zeroed out (RapidRAW has its own grain engine).
// Wire format matches the Krea WebGL2 film PoC (krea-web/client/src/film-poc):
// curves are 5-knot control points (x,y in [0,1]) expanded to 256-entry LUTs
// with a natural cubic spline.
//
// Selecting a profile writes BOTH the dedicated film-sim params (curves, base
// fog, shadow tint, bleed, rolloff, contrast, saturation, emulsion blur) and
// the native halation dial, since it is part of the stock's look.

import { Adjustments } from './adjustments';

export interface FilmCurveKnots {
  x: Array<number>;
  y: Array<number>;
}

export interface FilmProfile {
  curves: { R: FilmCurveKnots; G: FilmCurveKnots; B: FilmCurveKnots };
  contrast: number; // 1.0 = neutral
  saturation: number; // 1.0 = neutral
  baseColor: [number, number, number]; // 0..255
  shadowTint: [number, number, number]; // 0..255
  highlightRolloff: number; // 0..1
  colorBleed: number; // 0..1
  blur: number; // 0..3 (emulsion blur sigma, px)
  // Legacy fields — dead data (the corresponding dials were removed from the
  // film module; kept only because the upstream profile JSON carries them):
  chroma: number; // PoC 0..0.5 (radial chromatic aberration)
  vignette: number; // 0..1 (native vignette dial, darkening)
  // Legacy PoC film grain fields — dead data (PoC grain removed; kept only
  // because the upstream profile JSON carries them):
  grainAmount: number; // PoC 0..0.15
  grainSize: number; // PoC 0.5..3
  // Native RapidRAW dial driven by the stock look:
  halationStrength: number; // 0..1
}

export const FILM_PROFILES: Record<string, FilmProfile> = {
  'Kodak Portra 400': {
    curves: {
      R: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.27, 0.53, 0.77, 1] },
      G: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.25, 0.5, 0.75, 1] },
      B: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.23, 0.47, 0.73, 1] },
    },
    contrast: 1.1,
    saturation: 0.9,
    baseColor: [255, 250, 245],
    shadowTint: [5, 3, 8],
    highlightRolloff: 0.25,
    colorBleed: 0.15,
    blur: 0.1,
    chroma: 0.2,
    grainAmount: 0,
    grainSize: 1,
    halationStrength: 0.15,
    vignette: 0.2,
  },
  'Fuji Superia 400': {
    curves: {
      R: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.28, 0.55, 0.78, 1] },
      G: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.26, 0.52, 0.76, 1] },
      B: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.24, 0.49, 0.74, 1] },
    },
    contrast: 1.2,
    saturation: 1.1,
    baseColor: [250, 255, 255],
    shadowTint: [3, 5, 10],
    highlightRolloff: 0.2,
    colorBleed: 0.2,
    blur: 0.2,
    chroma: 0.3,
    grainAmount: 0,
    grainSize: 2,
    halationStrength: 0.2,
    vignette: 0.25,
  },
  'Kodak Ektar 100': {
    curves: {
      R: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.3, 0.6, 0.85, 1] },
      G: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.25, 0.5, 0.75, 1] },
      B: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.2, 0.4, 0.65, 1] },
    },
    contrast: 1.3,
    saturation: 1.2,
    baseColor: [255, 253, 248],
    shadowTint: [8, 5, 3],
    highlightRolloff: 0.3,
    colorBleed: 0.12,
    blur: 0.05,
    chroma: 0.1,
    grainAmount: 0,
    grainSize: 1,
    halationStrength: 0.25,
    vignette: 0.15,
  },
  'Fuji Velvia 50': {
    curves: {
      R: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.3, 0.65, 0.9, 1] },
      G: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.25, 0.55, 0.8, 1] },
      B: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.2, 0.45, 0.7, 1] },
    },
    contrast: 1.4,
    saturation: 1.5,
    baseColor: [255, 250, 250],
    shadowTint: [8, 3, 5],
    highlightRolloff: 0.35,
    colorBleed: 0.18,
    blur: 0.05,
    chroma: 0.15,
    grainAmount: 0,
    grainSize: 1,
    halationStrength: 0.3,
    vignette: 0.3,
  },
  'Ilford HP5 Plus': {
    curves: {
      R: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.23, 0.47, 0.73, 1] },
      G: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.23, 0.47, 0.73, 1] },
      B: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.23, 0.47, 0.73, 1] },
    },
    contrast: 1.2,
    saturation: 0,
    baseColor: [255, 255, 255],
    shadowTint: [0, 0, 0],
    highlightRolloff: 0.22,
    colorBleed: 0,
    blur: 0.1,
    chroma: 0.2,
    grainAmount: 0,
    grainSize: 2,
    halationStrength: 0.1,
    vignette: 0.35,
  },
  'Kodak Tri-X 400': {
    curves: {
      R: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.22, 0.45, 0.7, 1] },
      G: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.22, 0.45, 0.7, 1] },
      B: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.22, 0.45, 0.7, 1] },
    },
    contrast: 1.3,
    saturation: 0,
    baseColor: [255, 255, 255],
    shadowTint: [0, 0, 0],
    highlightRolloff: 0.25,
    colorBleed: 0,
    blur: 0.15,
    chroma: 0.25,
    grainAmount: 0,
    grainSize: 3,
    halationStrength: 0.12,
    vignette: 0.4,
  },
  'Fuji Pro 400H': {
    curves: {
      R: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.26, 0.52, 0.76, 1] },
      G: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.25, 0.5, 0.75, 1] },
      B: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.24, 0.48, 0.74, 1] },
    },
    contrast: 1.1,
    saturation: 0.95,
    baseColor: [252, 255, 255],
    shadowTint: [2, 8, 12],
    highlightRolloff: 0.28,
    colorBleed: 0.16,
    blur: 0.1,
    chroma: 0.2,
    grainAmount: 0,
    grainSize: 2,
    halationStrength: 0.18,
    vignette: 0.22,
  },
  'Kodak Gold 200': {
    curves: {
      R: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.28, 0.56, 0.8, 1] },
      G: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.26, 0.52, 0.76, 1] },
      B: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.24, 0.48, 0.72, 1] },
    },
    contrast: 1.2,
    saturation: 1.1,
    baseColor: [255, 248, 240],
    shadowTint: [10, 5, 2],
    highlightRolloff: 0.24,
    colorBleed: 0.19,
    blur: 0.15,
    chroma: 0.3,
    grainAmount: 0,
    grainSize: 2,
    halationStrength: 0.22,
    vignette: 0.28,
  },
  'Fuji Provia 100F': {
    curves: {
      R: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.26, 0.52, 0.77, 1] },
      G: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.25, 0.5, 0.75, 1] },
      B: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.24, 0.48, 0.73, 1] },
    },
    contrast: 1.2,
    saturation: 1.1,
    baseColor: [253, 255, 255],
    shadowTint: [5, 3, 8],
    highlightRolloff: 0.28,
    colorBleed: 0.14,
    blur: 0.05,
    chroma: 0.1,
    grainAmount: 0,
    grainSize: 1,
    halationStrength: 0.2,
    vignette: 0.18,
  },
  'Kodak Ektachrome E100': {
    curves: {
      R: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.27, 0.54, 0.79, 1] },
      G: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.26, 0.52, 0.77, 1] },
      B: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.25, 0.5, 0.75, 1] },
    },
    contrast: 1.25,
    saturation: 1.15,
    baseColor: [254, 255, 255],
    shadowTint: [6, 4, 8],
    highlightRolloff: 0.3,
    colorBleed: 0.15,
    blur: 0.075,
    chroma: 0.15,
    grainAmount: 0,
    grainSize: 1,
    halationStrength: 0.23,
    vignette: 0.2,
  },
  'Lomography Color Negative 400': {
    curves: {
      R: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.3, 0.6, 0.85, 1] },
      G: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.28, 0.56, 0.8, 1] },
      B: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.26, 0.52, 0.75, 1] },
    },
    contrast: 1.3,
    saturation: 1.2,
    baseColor: [255, 245, 240],
    shadowTint: [12, 8, 5],
    highlightRolloff: 0.2,
    colorBleed: 0.25,
    blur: 0.2,
    chroma: 0.4,
    grainAmount: 0,
    grainSize: 3,
    halationStrength: 0.35,
    vignette: 0.45,
  },
  'CineStill 800T': {
    curves: {
      R: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.24, 0.48, 0.74, 1] },
      G: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.26, 0.52, 0.76, 1] },
      B: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.28, 0.56, 0.8, 1] },
    },
    contrast: 1.1,
    saturation: 0.95,
    baseColor: [240, 250, 255],
    shadowTint: [5, 10, 15],
    highlightRolloff: 0.18,
    colorBleed: 0.22,
    blur: 0.15,
    chroma: 0.3,
    grainAmount: 0,
    grainSize: 2,
    halationStrength: 0.4,
    vignette: 0.25,
  },
};

export const FILM_PROFILE_NAMES = Object.keys(FILM_PROFILES);

// --- Natural cubic spline (same construction as the PoC's curves.js) ---

interface Spline {
  x: Array<number>;
  a: Array<number>;
  b: Array<number>;
  c: Array<number>;
  d: Array<number>;
}

function naturalSpline(x: Array<number>, y: Array<number>): Spline {
  const n = x.length;
  const h = new Array(n - 1);
  for (let i = 1; i < n - 1; i++) h[i] = x[i + 1] - x[i];

  const alpha = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    alpha[i] = 3 * ((y[i + 1] - y[i]) / h[i] - (y[i] - y[i - 1]) / h[i - 1]);
  }

  const l = new Array(n).fill(1);
  const mu = new Array(n).fill(0);
  const z = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    l[i] = 2 * (x[i + 1] - x[i - 1]) - h[i - 1] * mu[i - 1];
    mu[i] = (x[i + 1] - x[i - 1]) / h[i - 1];
    z[i] = (alpha[i] - h[i - 1] * z[i - 1]) / l[i];
  }
  const c = new Array(n).fill(0);
  const b = new Array(n).fill(0);
  const d = new Array(n).fill(0);
  for (let j = n - 2; j >= 0; j--) {
    c[j] = z[j] - mu[j] * c[j + 1];
    b[j] = (y[j + 1] - y[j]) / h[j] - (h[j] * (c[j + 1] + 2 * c[j])) / 3;
    d[j] = (c[j] - z[j]) / (3 * h[j]);
  }
  return { x, a: y.slice(), b, c, d };
}

function evalSpline(sp: Spline, t: number): number {
  const { x, a, b, c, d } = sp;
  const n = x.length;
  if (t <= x[0]) return a[0];
  if (t >= x[n - 1]) return a[n - 1];
  let j = 0;
  for (let i = 1; i < n - 1; i++) {
    if (t >= x[i] && t <= x[i + 1]) { j = i; break; }
  }
  const dx = t - x[j];
  return a[j] + b[j] * dx + c[j] * dx * dx + d[j] * dx * dx * dx;
}

// Flat 768-entry LUT (r,g,b interleaved, 0..1) — the exact wire format the
// Rust parser (parse_film_curves) and the WGSL film_curves array expect.
export function buildFilmCurveLut(curves: FilmProfile['curves']): Array<number> {
  const out = new Array<number>(768);
  const channels = [curves.R, curves.G, curves.B];
  for (let ch = 0; ch < 3; ch++) {
    const sp = naturalSpline(channels[ch].x, channels[ch].y);
    for (let i = 0; i < 256; i++) out[i * 3 + ch] = evalSpline(sp, i / 255);
  }
  return out;
}

export function buildIdentityFilmCurves(): Array<number> {
  const out = new Array<number>(768);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    out[i * 3] = v;
    out[i * 3 + 1] = v;
    out[i * 3 + 2] = v;
  }
  return out;
}

// Adjustments patch for selecting a stock (or null to disable). Dial mappings:
// blur: PoC sigma 0..3 -> UI 0..100; chroma: PoC 0..0.5 -> UI 0..100;
// halation x100; vignette negative (darkening) x100. (The legacy grainAmount/
// grainSize profile fields are dead data — the PoC grain was removed.)
export function filmProfilePatch(profileId: string | null): Partial<Adjustments> {
  if (!profileId || !FILM_PROFILES[profileId]) {
    return { filmProfile: null, filmStrength: 0 };
  }
  const p = FILM_PROFILES[profileId];
  return {
    filmProfile: profileId,
    filmStrength: 100,
    filmContrast: Math.round(p.contrast * 100),
    filmSaturation: Math.round(p.saturation * 100),
    filmRolloff: Math.round(p.highlightRolloff * 100),
    filmBleed: Math.round(p.colorBleed * 100),
    filmBlur: Math.round((p.blur / 3) * 100),
    filmBaseColor: [...p.baseColor],
    filmShadowTint: [...p.shadowTint],
    filmCurves: buildFilmCurveLut(p.curves),
    halationAmount: Math.round(p.halationStrength * 100),
  };
}
