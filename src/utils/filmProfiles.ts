// Film stock profiles — ported from the Krea WebGL2 film PoC
// (krea-web/client/src/film-poc). Curves are 5-knot control points (x,y in
// [0,1]) expanded to 256-entry LUTs with a natural cubic spline.
//
// Selecting a profile writes BOTH the dedicated film-sim params (curves, base
// fog, shadow tint, bleed, rolloff, contrast, saturation, emulsion blur,
// chromatic aberration) and the native grain/halation/vignette dials, since
// those are part of the stock's look.

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
  chroma: number; // 0..0.5 (radial chromatic aberration)
  // Film grain (Krea PoC grain, separate from the native Effects grain):
  grainAmount: number; // PoC 0..0.15
  grainSize: number; // PoC 0.5..3
  // Native RapidRAW dials driven by the stock look:
  halationStrength: number; // 0..1
  vignette: number; // 0..1 (darkening)
}

export const FILM_PROFILES: Record<string, FilmProfile> = {
  'Kodak Portra 400': {
    curves: {
      R: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.27, 0.53, 0.77, 1] },
      G: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.25, 0.5, 0.75, 1] },
      B: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.23, 0.47, 0.73, 1] },
    },
    contrast: 1.05,
    saturation: 0.9,
    baseColor: [255, 250, 245],
    shadowTint: [10, 5, 0],
    highlightRolloff: 0,
    colorBleed: 0,
    blur: 0.2,
    chroma: 0.05,
    grainAmount: 0.02,
    grainSize: 1,
    halationStrength: 0,
    vignette: 0.1,
  },
  'Fuji Velvia 50': {
    curves: {
      R: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.22, 0.5, 0.78, 1] },
      G: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.2, 0.48, 0.76, 1] },
      B: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.18, 0.45, 0.74, 1] },
    },
    contrast: 1.2,
    saturation: 1.25,
    baseColor: [255, 255, 255],
    shadowTint: [0, 0, 0],
    highlightRolloff: 0,
    colorBleed: 0,
    blur: 0,
    chroma: 0,
    grainAmount: 0.015,
    grainSize: 1,
    halationStrength: 0,
    vignette: 0.05,
  },
  'Ilford HP5 Plus': {
    curves: {
      R: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.3, 0.55, 0.78, 1] },
      G: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.28, 0.53, 0.77, 1] },
      B: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.26, 0.51, 0.75, 1] },
    },
    contrast: 1.15,
    saturation: 0,
    baseColor: [240, 240, 240],
    shadowTint: [5, 5, 5],
    highlightRolloff: 0,
    colorBleed: 0,
    blur: 0.3,
    chroma: 0,
    grainAmount: 0.05,
    grainSize: 1.5,
    halationStrength: 0,
    vignette: 0.15,
  },
  'Kodak Ektar 100': {
    curves: {
      R: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.24, 0.52, 0.79, 1] },
      G: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.22, 0.49, 0.76, 1] },
      B: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.2, 0.46, 0.73, 1] },
    },
    contrast: 1.15,
    saturation: 1.15,
    baseColor: [255, 248, 240],
    shadowTint: [0, 0, 0],
    highlightRolloff: 0,
    colorBleed: 0,
    blur: 0,
    chroma: 0.03,
    grainAmount: 0.01,
    grainSize: 1,
    halationStrength: 0,
    vignette: 0.05,
  },
  'Kodak Tri-X 400': {
    curves: {
      R: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.32, 0.58, 0.8, 1] },
      G: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.3, 0.55, 0.78, 1] },
      B: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.28, 0.53, 0.76, 1] },
    },
    contrast: 1.25,
    saturation: 0,
    baseColor: [235, 235, 235],
    shadowTint: [8, 8, 8],
    highlightRolloff: 0,
    colorBleed: 0,
    blur: 0.4,
    chroma: 0,
    grainAmount: 0.06,
    grainSize: 1.8,
    halationStrength: 0,
    vignette: 0.2,
  },
  'CineStill 800T': {
    curves: {
      R: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.28, 0.54, 0.76, 1] },
      G: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.25, 0.5, 0.74, 1] },
      B: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.22, 0.46, 0.72, 1] },
    },
    contrast: 1.1,
    saturation: 1.05,
    baseColor: [255, 245, 235],
    shadowTint: [15, 5, 0],
    highlightRolloff: 0,
    colorBleed: 0,
    blur: 0.2,
    chroma: 0.08,
    grainAmount: 0.035,
    grainSize: 1.2,
    halationStrength: 0.25,
    vignette: 0.12,
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
// blur: PoC sigma 0..3 -> UI 0..100; chroma: PoC 0..0.5 -> UI 0..100; film
// grain amount x1000 (PoC 0.06 -> UI 60, shader 0.06); film grain size x50
// (UI 50 == shader 1.0); halation x100; vignette negative (darkening) x100.
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
    filmChroma: Math.round((p.chroma / 0.5) * 100),
    filmBaseColor: [...p.baseColor],
    filmShadowTint: [...p.shadowTint],
    filmCurves: buildFilmCurveLut(p.curves),
    filmGrainAmount: Math.round(p.grainAmount * 1000),
    filmGrainSize: Math.round(p.grainSize * 50),
    halationAmount: Math.round(p.halationStrength * 100),
    vignetteAmount: -Math.round(p.vignette * 100),
  };
}
