import { Curves, ParametricCurve, getDefaultCurves, getDefaultParametricCurve } from '../utils/adjustments';

export interface DodgeBurnAdjustments {
  blacks: number;
  chromaticAberrationBlueYellow: number;
  chromaticAberrationRedCyan: number;
  clarity: number;
  colorNoiseReduction: number;
  curveMode: 'point' | 'parametric';
  curves: Curves;
  dehaze: number;
  filmBlurPreAmount: number;
  filmBlurPreCompensation: number;
  filmBlurPreRadius: number;
  filmBlurPreSoftAmount: number;
  filmBlurPreSoftRadius: number;
  flimAdjacency: number;
  flimContrast: number;
  flimEv: number;
  flimHiTint: number;
  flimSaturation: number;
  flimShoulder: number;
  flimShTint: number;
  flimToe: number;
  flimWarmth: number;
  glowAmount: number;
  halationAmount: number;
  highlights: number;
  lumaNoiseReduction: number;
  parametricCurve: ParametricCurve;
  pointCurves: Curves;
  saturation: number;
  shadows: number;
  sharpness: number;
  sharpnessThreshold: number;
  structure: number;
  temperature: number;
  tint: number;
  vibrance: number;
  vignetteAmount: number;
  vignetteFeather: number;
  vignetteMidpoint: number;
  vignetteRoundness: number;
  whites: number;
  centré: number;
}

export interface DodgeBurnMaskParameters {
  adjustments: DodgeBurnAdjustments;
  flow: number;
  maskBitmap: string | null;
}

export type ScalarDodgeBurnKey = {
  [K in keyof DodgeBurnAdjustments]: DodgeBurnAdjustments[K] extends number ? K : never;
}[keyof DodgeBurnAdjustments];

export const getDefaultDodgeBurnAdjustments = (): DodgeBurnAdjustments => ({
  blacks: 0,
  chromaticAberrationBlueYellow: 0,
  chromaticAberrationRedCyan: 0,
  clarity: 0,
  colorNoiseReduction: 0,
  curveMode: 'point',
  curves: getDefaultCurves(),
  dehaze: 0,
  filmBlurPreAmount: 0,
  filmBlurPreCompensation: 0,
  filmBlurPreRadius: 0.5,
  filmBlurPreSoftAmount: 0,
  filmBlurPreSoftRadius: 0.5,
  flimAdjacency: 0,
  flimContrast: 100,
  flimEv: 0,
  flimHiTint: 0,
  flimSaturation: 100,
  flimShoulder: 0,
  flimShTint: 0,
  flimToe: 0,
  flimWarmth: 0,
  glowAmount: 0,
  halationAmount: 0,
  highlights: 0,
  lumaNoiseReduction: 0,
  parametricCurve: getDefaultParametricCurve(),
  pointCurves: getDefaultCurves(),
  saturation: 0,
  shadows: 0,
  sharpness: 0,
  sharpnessThreshold: 15,
  structure: 0,
  temperature: 0,
  tint: 0,
  vibrance: 0,
  vignetteAmount: 0,
  vignetteFeather: 50,
  vignetteMidpoint: 50,
  vignetteRoundness: 0,
  whites: 0,
  centré: 0,
});

/*
 * Manual test plan: dodge & burn mask persistence and undo
 *
 * 1. Create a dodge & burn mask, paint a few strokes, then save the sidecar.
 * 2. Reload the image and confirm:
 *    - the dodge & burn sub-mask is present in the mask list,
 *    - its parameters (flow, adjustments, maskBitmap) are restored,
 *    - the painted effect is visible on the image.
 * 3. Press undo and confirm the last painted stroke disappears.
 *    Press redo and confirm the stroke reappears.
 * 4. Switch to another tool and back; the mask and its effect must remain.
 */
