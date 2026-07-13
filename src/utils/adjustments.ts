import { Crop } from 'react-image-crop';
import { v4 as uuidv4 } from 'uuid';
import { SubMask, SubMaskMode } from '../components/panel/right/Masks';

export enum ActiveChannel {
  Blue = 'blue',
  Green = 'green',
  Luma = 'luma',
  Red = 'red',
}

export enum DisplayMode {
  Luma = 'luma',
  Rgb = 'rgb',
  Parade = 'parade',
  Vectorscope = 'vectorscope',
  Histogram = 'histogram',
}

export enum PasteMode {
  Merge = 'merge',
  Replace = 'replace',
}

export interface CopyPasteSettings {
  mode: PasteMode;
  includedAdjustments: Array<string>;
  knownAdjustments: Array<string>;
}

export enum BasicAdjustment {
  Blacks = 'blacks',
  Brightness = 'brightness',
  Contrast = 'contrast',
  Exposure = 'exposure',
  Highlights = 'highlights',
  Shadows = 'shadows',
  Whites = 'whites',
}

export enum ColorAdjustment {
  ColorGrading = 'colorGrading',
  Hsl = 'hsl',
  Hue = 'hue',
  Luminance = 'luminance',
  Saturation = 'saturation',
  Temperature = 'temperature',
  Tint = 'tint',
  Vibrance = 'vibrance',
}

export enum ColorGrading {
  Balance = 'balance',
  Blending = 'blending',
  Global = 'global',
  Highlights = 'highlights',
  Midtones = 'midtones',
  Shadows = 'shadows',
}

export enum DetailsAdjustment {
  Clarity = 'clarity',
  Dehaze = 'dehaze',
  Structure = 'structure',
  Centré = 'centré',
  ColorNoiseReduction = 'colorNoiseReduction',
  LumaNoiseReduction = 'lumaNoiseReduction',
  Sharpness = 'sharpness',
  SharpnessThreshold = 'sharpnessThreshold',
  ChromaticAberrationRedCyan = 'chromaticAberrationRedCyan',
  ChromaticAberrationBlueYellow = 'chromaticAberrationBlueYellow',
}

export enum Effect {
  GrainAmount = 'grainAmount',
  GrainRoughness = 'grainRoughness',
  GrainSize = 'grainSize',
  LutData = 'lutData',
  LutIntensity = 'lutIntensity',
  LutName = 'lutName',
  LutPath = 'lutPath',
  LutSize = 'lutSize',
  VignetteAmount = 'vignetteAmount',
  VignetteFeather = 'vignetteFeather',
  VignetteMidpoint = 'vignetteMidpoint',
  VignetteRoundness = 'vignetteRoundness',
}

export enum CreativeAdjustment {
  GlowAmount = 'glowAmount',
  HalationAmount = 'halationAmount',
  FlareAmount = 'flareAmount',
}

export enum FilmAdjustment {
  FilmProfile = 'filmProfile',
  FilmStrength = 'filmStrength',
  FilmContrast = 'filmContrast',
  FilmSaturation = 'filmSaturation',
  FilmRolloff = 'filmRolloff',
  FilmBleed = 'filmBleed',
  FilmCross = 'filmCross',
  FilmBaseColor = 'filmBaseColor',
  FilmShadowTint = 'filmShadowTint',
  FilmCurves = 'filmCurves',
  FilmShadows = 'filmShadows',
  FilmHighlights = 'filmHighlights',
  FilmBlur = 'filmBlur',
  CrystalGrainAmount = 'crystalGrainAmount',
  CrystalGrainMono = 'crystalGrainMono',
  CrystalGrainFilling = 'crystalGrainFilling',
  CrystalGrainSize = 'crystalGrainSize',
  CrystalGrainLayers = 'crystalGrainLayers',
  CrystalGrainStd = 'crystalGrainStd',
  IpolGrainMuR = 'ipolGrainMuR',
  IpolGrainSigmaR = 'ipolGrainSigmaR',
  IpolGrainSigmaFilter = 'ipolGrainSigmaFilter',
  IpolGrainMonteCarlo = 'ipolGrainMonteCarlo',
  GrainEngine = 'grainEngine',
  FlimPreset = 'flimPreset',
  FlimEv = 'flimEv',
  FlimStrength = 'flimStrength',
  FlimContrast = 'flimContrast',
  FlimShoulder = 'flimShoulder',
  FlimToe = 'flimToe',
  FlimSaturation = 'flimSaturation',
  FlimWarmth = 'flimWarmth',
  FlimAdjacency = 'flimAdjacency',
  FlimHiTint = 'flimHiTint',
  FlimShTint = 'flimShTint',
  // Advanced panel: absolute flim preset parameters (see FLIM_BUILTIN_PRESETS).
  FlimAdvPreExposure = 'flimAdvPreExposure',
  FlimAdvNegExposure = 'flimAdvNegExposure',
  FlimAdvNegDensity = 'flimAdvNegDensity',
  FlimAdvPrintExposure = 'flimAdvPrintExposure',
  FlimAdvPrintDensity = 'flimAdvPrintDensity',
  FlimAdvLog2Max = 'flimAdvLog2Max',
  FlimAdvBacklightR = 'flimAdvBacklightR',
  FlimAdvBacklightG = 'flimAdvBacklightG',
  FlimAdvBacklightB = 'flimAdvBacklightB',
  FlimAdvSaturation = 'flimAdvSaturation',
  FlimAdvBlackAuto = 'flimAdvBlackAuto',
  FlimAdvBlackPoint = 'flimAdvBlackPoint',
  FlimAdvPreFilterHue = 'flimAdvPreFilterHue',
  FlimAdvPreFilterStrength = 'flimAdvPreFilterStrength',
  FlimAdvPostFilterHue = 'flimAdvPostFilterHue',
  FlimAdvPostFilterStrength = 'flimAdvPostFilterStrength',
  FlimAdvGamutExpand = 'flimAdvGamutExpand',
  FlimAdvPaletteRotate = 'flimAdvPaletteRotate',
  FlimAdvPushR = 'flimAdvPushR',
  FlimAdvPushB = 'flimAdvPushB',
}

export enum BwAdjustment {
  BwRed = 'bwRed',
  BwGreen = 'bwGreen',
  BwBlue = 'bwBlue',
}

export enum TransformAdjustment {
  TransformDistortion = 'transformDistortion',
  TransformVertical = 'transformVertical',
  TransformHorizontal = 'transformHorizontal',
  TransformRotate = 'transformRotate',
  TransformAspect = 'transformAspect',
  TransformScale = 'transformScale',
  TransformXOffset = 'transformXOffset',
  TransformYOffset = 'transformYOffset',
}

export enum LensAdjustment {
  LensCorrectionMode = 'lensCorrectionMode',
  LensMaker = 'lensMaker',
  LensModel = 'lensModel',
  LensDistortionAmount = 'lensDistortionAmount',
  LensVignetteAmount = 'lensVignetteAmount',
  LensTcaAmount = 'lensTcaAmount',
  LensDistortionParams = 'lensDistortionParams',
  LensDistortionEnabled = 'lensDistortionEnabled',
  LensTcaEnabled = 'lensTcaEnabled',
  LensVignetteEnabled = 'lensVignetteEnabled',
}

export interface ColorCalibration {
  shadowsTint: number;
  redHue: number;
  redSaturation: number;
  greenHue: number;
  greenSaturation: number;
  blueHue: number;
  blueSaturation: number;
}

export interface ParametricCurveSettings {
  darks: number;
  shadows: number;
  highlights: number;
  lights: number;
  whiteLevel: number;
  blackLevel: number;
  split1: number;
  split2: number;
  split3: number;
}

export interface ParametricCurve {
  [index: string]: ParametricCurveSettings;
  blue: ParametricCurveSettings;
  green: ParametricCurveSettings;
  luma: ParametricCurveSettings;
  red: ParametricCurveSettings;
}

export interface Adjustments {
  [index: string]: any;
  aiPatches: Array<AiPatch>;
  aspectRatio: number | null;
  blacks: number;
  brightness: number;
  bwBlue: number;
  bwGreen: number;
  bwRed: number;
  centré: number;
  clarity: number;
  chromaticAberrationBlueYellow: number;
  chromaticAberrationRedCyan: number;
  colorCalibration: ColorCalibration;
  colorGrading: ColorGradingProps;
  colorNoiseReduction: number;
  contrast: number;
  curves: Curves;
  pointCurves?: Curves;
  parametricCurve?: ParametricCurve;
  curveMode?: 'point' | 'parametric';
  crop: Crop | null;
  dehaze: number;
  exposure: number;
  filmBaseColor: Array<number>;
  filmBleed: number;
  filmBlur: number;
  filmContrast: number;
  filmCross: boolean;
  filmCurves: Array<number>;
  crystalGrainAmount: number;
  crystalGrainMono: number;
  crystalGrainFilling: number;
  crystalGrainSize: number;
  crystalGrainLayers: number;
  crystalGrainStd: number;
  ipolGrainMuR: number;
  ipolGrainSigmaR: number;
  ipolGrainSigmaFilter: number;
  ipolGrainMonteCarlo: number;
  grainEngine: string;
  filmHighlights: number;
  filmProfile: string | null;
  filmRolloff: number;
  filmSaturation: number;
  filmShadows: number;
  filmShadowTint: Array<number>;
  filmStrength: number;
  flimPreset: number;
  flimEv: number;
  flimStrength: number;
  flimContrast: number;
  flimShoulder: number;
  flimToe: number;
  flimSaturation: number;
  flimWarmth: number;
  flimAdjacency: number;
  flimHiTint: number;
  flimShTint: number;
  // Advanced panel: absolute flim preset parameters.
  flimAdvPreExposure: number;
  flimAdvNegExposure: number;
  flimAdvNegDensity: number;
  flimAdvPrintExposure: number;
  flimAdvPrintDensity: number;
  flimAdvLog2Max: number;
  flimAdvBacklightR: number;
  flimAdvBacklightG: number;
  flimAdvBacklightB: number;
  flimAdvSaturation: number;
  flimAdvBlackAuto: number;
  flimAdvBlackPoint: number;
  flimAdvPreFilterHue: number;
  flimAdvPreFilterStrength: number;
  flimAdvPostFilterHue: number;
  flimAdvPostFilterStrength: number;
  flimAdvGamutExpand: number;
  flimAdvPaletteRotate: number;
  flimAdvPushR: number;
  flimAdvPushB: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
  flareAmount: number;
  glowAmount: number;
  grainAmount: number;
  grainRoughness: number;
  grainSize: number;
  halationAmount: number;
  highlights: number;
  hsl: Hsl;
  hue: number;
  lensCorrectionMode: 'auto' | 'manual';
  lensDistortionAmount: number;
  lensVignetteAmount: number;
  lensTcaAmount: number;
  lensDistortionEnabled: boolean;
  lensTcaEnabled: boolean;
  lensVignetteEnabled: boolean;
  lensDistortionParams: {
    k1: number;
    k2: number;
    k3: number;
    model: number;
    tca_vr: number;
    tca_vb: number;
    vig_k1: number;
    vig_k2: number;
    vig_k3: number;
  } | null;
  lensMaker: string | null;
  lensModel: string | null;
  lumaNoiseReduction: number;
  lutData?: string | null;
  lutIntensity?: number;
  lutName?: string | null;
  lutPath?: string | null;
  lutSize?: number;
  masks: Array<MaskContainer>;
  orientationSteps: number;
  rotation: number;
  saturation: number;
  sectionVisibility: SectionVisibility;
  shadows: number;
  sharpness: number;
  sharpnessThreshold: number;
  showClipping: boolean;
  structure: number;
  temperature: number;
  tint: number;
  toneMapper: 'agx' | 'basic' | 'flim';
  transformDistortion: number;
  transformVertical: number;
  transformHorizontal: number;
  transformRotate: number;
  transformAspect: number;
  transformScale: number;
  transformXOffset: number;
  transformYOffset: number;
  vibrance: number;
  vignetteAmount: number;
  vignetteFeather: number;
  vignetteMidpoint: number;
  vignetteRoundness: number;
  whites: number;
}

export interface AiPatch {
  id: string;
  isLoading: boolean;
  invert: boolean;
  name: string;
  patchData: any | null;
  prompt: string;
  subMasks: Array<SubMask>;
  visible: boolean;
}

export interface Color {
  color: string;
  name: string;
}

interface ColorGradingProps {
  [index: string]: number | HueSatLum;
  balance: number;
  blending: number;
  global: HueSatLum;
  highlights: HueSatLum;
  midtones: HueSatLum;
  shadows: HueSatLum;
}

export interface Coord {
  x: number;
  y: number;
}

export interface Curves {
  [index: string]: Array<Coord>;
  blue: Array<Coord>;
  green: Array<Coord>;
  luma: Array<Coord>;
  red: Array<Coord>;
}

export interface HueSatLum {
  hue: number;
  saturation: number;
  luminance: number;
}

interface Hsl {
  [index: string]: HueSatLum;
  aquas: HueSatLum;
  blues: HueSatLum;
  greens: HueSatLum;
  magentas: HueSatLum;
  oranges: HueSatLum;
  purples: HueSatLum;
  reds: HueSatLum;
  yellows: HueSatLum;
}

export interface MaskAdjustments {
  [index: string]: any;
  blacks: number;
  brightness: number;
  clarity: number;
  colorGrading: ColorGradingProps;
  colorNoiseReduction: number;
  contrast: number;
  curves: Curves;
  pointCurves?: Curves;
  parametricCurve?: ParametricCurve;
  curveMode?: 'point' | 'parametric';
  dehaze: number;
  exposure: number;
  flareAmount: number;
  glowAmount: number;
  halationAmount: number;
  highlights: number;
  hsl: Hsl;
  hue: number;
  id?: string;
  lumaNoiseReduction: number;
  saturation: number;
  sectionVisibility: SectionVisibility;
  shadows: number;
  sharpness: number;
  sharpnessThreshold: number;
  structure: number;
  temperature: number;
  tint: number;
  vibrance: number;
  whites: number;
}

export interface MaskContainer {
  adjustments: MaskAdjustments;
  id?: any;
  invert: boolean;
  name: string;
  opacity: number;
  subMasks: Array<SubMask>;
  visible: boolean;
}

export interface Sections {
  [index: string]: Array<string>;
  basic: Array<string>;
  curves: Array<string>;
  color: Array<string>;
  details: Array<string>;
  effects: Array<string>;
  blackAndWhite: Array<string>;
  film: Array<string>;
}

export interface SectionVisibility {
  [index: string]: boolean;
  basic: boolean;
  curves: boolean;
  color: boolean;
  details: boolean;
  effects: boolean;
  blackAndWhite: boolean;
  film: boolean;
  grain: boolean;
}

export const COLOR_LABELS: Array<Color> = [
  { name: 'red', color: '#ef4444' },
  { name: 'yellow', color: '#facc15' },
  { name: 'green', color: '#4ade80' },
  { name: 'blue', color: '#60a5fa' },
  { name: 'purple', color: '#a78bfa' },
];

const INITIAL_COLOR_GRADING: ColorGradingProps = {
  balance: 0,
  blending: 50,
  global: { hue: 0, saturation: 0, luminance: 0 },
  highlights: { hue: 0, saturation: 0, luminance: 0 },
  midtones: { hue: 0, saturation: 0, luminance: 0 },
  shadows: { hue: 0, saturation: 0, luminance: 0 },
};

const INITIAL_COLOR_CALIBRATION: ColorCalibration = {
  shadowsTint: 0,
  redHue: 0,
  redSaturation: 0,
  greenHue: 0,
  greenSaturation: 0,
  blueHue: 0,
  blueSaturation: 0,
};

export const DEFAULT_PARAMETRIC_CURVE_SETTINGS: ParametricCurveSettings = {
  darks: 0,
  shadows: 0,
  highlights: 0,
  lights: 0,
  whiteLevel: 0,
  blackLevel: 0,
  split1: 25,
  split2: 50,
  split3: 75,
};

export const getDefaultParametricCurve = (): ParametricCurve => ({
  luma: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS },
  red: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS },
  green: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS },
  blue: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS },
});

export const getDefaultCurves = (): Curves => ({
  blue: [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
  green: [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
  luma: [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
  red: [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
});

export const DEFAULT_PARAMETRIC_CURVE = getDefaultParametricCurve();

export const INITIAL_MASK_ADJUSTMENTS: MaskAdjustments = {
  blacks: 0,
  brightness: 0,
  clarity: 0,
  colorGrading: { ...INITIAL_COLOR_GRADING },
  colorNoiseReduction: 0,
  contrast: 0,
  curves: getDefaultCurves(),
  pointCurves: getDefaultCurves(),
  parametricCurve: getDefaultParametricCurve(),
  curveMode: 'point',
  dehaze: 0,
  exposure: 0,
  flareAmount: 0,
  glowAmount: 0,
  halationAmount: 0,
  highlights: 0,
  hsl: {
    aquas: { hue: 0, saturation: 0, luminance: 0 },
    blues: { hue: 0, saturation: 0, luminance: 0 },
    greens: { hue: 0, saturation: 0, luminance: 0 },
    magentas: { hue: 0, saturation: 0, luminance: 0 },
    oranges: { hue: 0, saturation: 0, luminance: 0 },
    purples: { hue: 0, saturation: 0, luminance: 0 },
    reds: { hue: 0, saturation: 0, luminance: 0 },
    yellows: { hue: 0, saturation: 0, luminance: 0 },
  },
  hue: 0,
  lumaNoiseReduction: 0,
  saturation: 0,
  sectionVisibility: {
    basic: true,
    curves: true,
    color: true,
    details: true,
    effects: true,
    blackAndWhite: false,
    film: true,
    grain: true,
  },
  shadows: 0,
  sharpness: 0,
  sharpnessThreshold: 15,
  structure: 0,
  temperature: 0,
  tint: 0,
  vibrance: 0,
  whites: 0,
};

export const INITIAL_MASK_CONTAINER: MaskContainer = {
  adjustments: INITIAL_MASK_ADJUSTMENTS,
  invert: false,
  name: 'New Mask',
  opacity: 100,
  subMasks: [],
  visible: true,
};

// Identity film curves (r=g=b=i/255, flat 768) — local copy to avoid a circular
// import with filmProfiles.ts. Wire format must match Rust parse_film_curves.
const buildIdentityFilmCurves = (): Array<number> => {
  const out = new Array<number>(768);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    out[i * 3] = v;
    out[i * 3 + 1] = v;
    out[i * 3 + 2] = v;
  }
  return out;
};

// Absolute flim preset parameters, mirroring FLIM_PRESETS in
// src-tauri/src/image_processing.rs (parity is enforced by the
// flim_advanced_keys_match_builtin_presets test there). Selecting a preset
// writes these into the flimAdv* keys; the advanced panel edits them directly.
// Filters are hue + strength: a white filter at any strength equals strength 0,
// so default/nostalgia (white @ 1.0 in the reference) are stored as strength 0.
export interface FlimPresetParams {
  flimAdvPreExposure: number;
  flimAdvNegExposure: number;
  flimAdvNegDensity: number;
  flimAdvPrintExposure: number;
  flimAdvPrintDensity: number;
  flimAdvLog2Max: number;
  flimAdvBacklightR: number;
  flimAdvBacklightG: number;
  flimAdvBacklightB: number;
  flimAdvSaturation: number;
  flimAdvBlackAuto: number;
  flimAdvBlackPoint: number;
  flimAdvPreFilterHue: number;
  flimAdvPreFilterStrength: number;
  flimAdvPostFilterHue: number;
  flimAdvPostFilterStrength: number;
  flimAdvGamutExpand: number;
  flimAdvPaletteRotate: number;
  flimAdvPushR: number;
  flimAdvPushB: number;
}

export const FLIM_ADV_KEYS = [
  'flimAdvPreExposure',
  'flimAdvNegExposure',
  'flimAdvNegDensity',
  'flimAdvPrintExposure',
  'flimAdvPrintDensity',
  'flimAdvLog2Max',
  'flimAdvBacklightR',
  'flimAdvBacklightG',
  'flimAdvBacklightB',
  'flimAdvSaturation',
  'flimAdvBlackAuto',
  'flimAdvBlackPoint',
  'flimAdvPreFilterHue',
  'flimAdvPreFilterStrength',
  'flimAdvPostFilterHue',
  'flimAdvPostFilterStrength',
  'flimAdvGamutExpand',
  'flimAdvPaletteRotate',
  'flimAdvPushR',
  'flimAdvPushB',
] as const;

export const FLIM_BUILTIN_PRESETS: FlimPresetParams[] = [
  {
    // default
    flimAdvPreExposure: 4.3,
    flimAdvNegExposure: 6,
    flimAdvNegDensity: 5,
    flimAdvPrintExposure: 6,
    flimAdvPrintDensity: 27.5,
    flimAdvLog2Max: 22,
    flimAdvBacklightR: 1,
    flimAdvBacklightG: 1,
    flimAdvBacklightB: 1,
    flimAdvSaturation: 1.02,
    flimAdvBlackAuto: 1,
    flimAdvBlackPoint: 0,
    flimAdvPreFilterHue: 0,
    flimAdvPreFilterStrength: 0,
    flimAdvPostFilterHue: 0,
    flimAdvPostFilterStrength: 0,
    flimAdvGamutExpand: 100,
    flimAdvPaletteRotate: 0,
    flimAdvPushR: 1,
    flimAdvPushB: 1,
  },
  {
    // nostalgia
    flimAdvPreExposure: 5.563035,
    flimAdvNegExposure: 5.8,
    flimAdvNegDensity: 5,
    flimAdvPrintExposure: 6,
    flimAdvPrintDensity: 40,
    flimAdvLog2Max: 23,
    flimAdvBacklightR: 0.99,
    flimAdvBacklightG: 1.1,
    flimAdvBacklightB: 1.035989,
    flimAdvSaturation: 1.1,
    flimAdvBlackAuto: 0,
    flimAdvBlackPoint: -5,
    flimAdvPreFilterHue: 0,
    flimAdvPreFilterStrength: 0,
    flimAdvPostFilterHue: 0,
    flimAdvPostFilterStrength: 0,
    flimAdvGamutExpand: 100,
    flimAdvPaletteRotate: 0,
    flimAdvPushR: 1.1,
    flimAdvPushB: 1.2,
  },
  {
    // silver
    flimAdvPreExposure: 3.9,
    flimAdvNegExposure: 4.7,
    flimAdvNegDensity: 7,
    flimAdvPrintExposure: 4.7,
    flimAdvPrintDensity: 30,
    flimAdvLog2Max: 22,
    flimAdvBacklightR: 0.9992,
    flimAdvBacklightG: 0.99,
    flimAdvBacklightB: 1,
    flimAdvSaturation: 1,
    flimAdvBlackAuto: 0,
    flimAdvBlackPoint: 0.5,
    flimAdvPreFilterHue: 210,
    flimAdvPreFilterStrength: 0.05,
    flimAdvPostFilterHue: 60,
    flimAdvPostFilterStrength: 0.04,
    flimAdvGamutExpand: 100,
    flimAdvPaletteRotate: 0,
    flimAdvPushR: 1,
    flimAdvPushB: 1.06,
  },
];

export const INITIAL_ADJUSTMENTS: Adjustments = {
  aiPatches: [],
  aspectRatio: null,
  blacks: 0,
  brightness: 0,
  bwBlue: 7,
  bwGreen: 72,
  bwRed: 21,
  centré: 0,
  clarity: 0,
  chromaticAberrationBlueYellow: 0,
  chromaticAberrationRedCyan: 0,
  colorCalibration: { ...INITIAL_COLOR_CALIBRATION },
  colorGrading: { ...INITIAL_COLOR_GRADING },
  colorNoiseReduction: 0,
  contrast: 0,
  crop: null,
  curves: getDefaultCurves(),
  pointCurves: getDefaultCurves(),
  parametricCurve: getDefaultParametricCurve(),
  curveMode: 'point',
  dehaze: 0,
  exposure: 0,
  filmBaseColor: [255, 255, 255],
  filmBleed: 0,
  filmBlur: 0,
  filmContrast: 100,
  filmCross: false,
  filmCurves: buildIdentityFilmCurves(),
  crystalGrainAmount: 0,
  crystalGrainMono: 0,
  crystalGrainFilling: 0.25,
  crystalGrainSize: 5,
  crystalGrainLayers: 30,
  crystalGrainStd: 0.5,
  ipolGrainMuR: 0.1,
  ipolGrainSigmaR: 0,
  ipolGrainSigmaFilter: 0.8,
  ipolGrainMonteCarlo: 100,
  grainEngine: 'pierre',
  filmHighlights: 0,
  filmProfile: null,
  filmRolloff: 0,
  filmSaturation: 100,
  filmShadows: 0,
  filmShadowTint: [0, 0, 0],
  filmStrength: 0,
  flimPreset: 0,
  flimEv: 0,
  flimStrength: 100,
  flimContrast: 100,
  flimShoulder: 0,
  flimToe: 0,
  flimSaturation: 100,
  flimWarmth: 0,
  flimAdjacency: 0,
  flimHiTint: 0,
  flimShTint: 0,
  ...FLIM_BUILTIN_PRESETS[0],
  flipHorizontal: false,
  flipVertical: false,
  flareAmount: 0,
  glowAmount: 0,
  grainAmount: 0,
  grainRoughness: 50,
  grainSize: 25,
  halationAmount: 0,
  highlights: 0,
  hsl: {
    aquas: { hue: 0, saturation: 0, luminance: 0 },
    blues: { hue: 0, saturation: 0, luminance: 0 },
    greens: { hue: 0, saturation: 0, luminance: 0 },
    magentas: { hue: 0, saturation: 0, luminance: 0 },
    oranges: { hue: 0, saturation: 0, luminance: 0 },
    purples: { hue: 0, saturation: 0, luminance: 0 },
    reds: { hue: 0, saturation: 0, luminance: 0 },
    yellows: { hue: 0, saturation: 0, luminance: 0 },
  },
  hue: 0,
  lensCorrectionMode: 'manual',
  lensDistortionAmount: 100,
  lensVignetteAmount: 100,
  lensTcaAmount: 100,
  lensDistortionEnabled: true,
  lensTcaEnabled: true,
  lensVignetteEnabled: true,
  lensDistortionParams: null,
  lensMaker: null,
  lensModel: null,
  lumaNoiseReduction: 0,
  lutData: null,
  lutIntensity: 100,
  lutName: null,
  lutPath: null,
  lutSize: 0,
  masks: [],
  orientationSteps: 0,
  rotation: 0,
  saturation: 0,
  sectionVisibility: {
    basic: true,
    curves: true,
    color: true,
    details: true,
    effects: true,
    blackAndWhite: false,
    film: true,
    grain: true,
  },
  shadows: 0,
  sharpness: 0,
  sharpnessThreshold: 15,
  showClipping: false,
  structure: 0,
  temperature: 0,
  tint: 0,
  toneMapper: 'flim',
  transformDistortion: 0,
  transformVertical: 0,
  transformHorizontal: 0,
  transformRotate: 0,
  transformAspect: 0,
  transformScale: 100,
  transformXOffset: 0,
  transformYOffset: 0,
  vibrance: 0,
  vignetteAmount: 0,
  vignetteFeather: 50,
  vignetteMidpoint: 50,
  vignetteRoundness: 0,
  whites: 0,
};

const deepCloneCurves = (curves: any): Curves => ({
  blue: curves?.blue?.map((p: Coord) => ({ ...p })) || [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
  green: curves?.green?.map((p: Coord) => ({ ...p })) || [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
  luma: curves?.luma?.map((p: Coord) => ({ ...p })) || [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
  red: curves?.red?.map((p: Coord) => ({ ...p })) || [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
});

const deepCloneParametric = (pCurve: any): ParametricCurve => ({
  luma: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS, ...(pCurve?.luma || {}) },
  red: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS, ...(pCurve?.red || {}) },
  green: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS, ...(pCurve?.green || {}) },
  blue: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS, ...(pCurve?.blue || {}) },
});

// Advanced flim keys are always present after normalization. Old sidecars
// (no flimAdv* keys) derive them from the stored builtin preset index so the
// picture does not change on load; afterwards the absolute keys are the
// single source of truth for the flim preset.
const normalizeFlimAdv = (loaded: Partial<Adjustments>): FlimPresetParams => {
  const presetIdx = Math.min(Math.max(loaded.flimPreset ?? 0, 0), FLIM_BUILTIN_PRESETS.length - 1);
  const source: Partial<Adjustments> =
    loaded.flimAdvPreExposure !== undefined ? loaded : FLIM_BUILTIN_PRESETS[presetIdx];
  const result = {} as FlimPresetParams;
  for (const key of FLIM_ADV_KEYS) {
    result[key] = (source[key] as number | undefined) ?? INITIAL_ADJUSTMENTS[key];
  }
  return result;
};

export const normalizeLoadedAdjustments = (loadedAdjustments: Adjustments): any => {
  if (!loadedAdjustments) {
    return INITIAL_ADJUSTMENTS;
  }

  const normalizeSubMasks = (subMasks: any[]) => {
    return (subMasks || []).map((subMask: Partial<SubMask>) => ({
      visible: true,
      mode: SubMaskMode.Additive,
      invert: false,
      opacity: 100,
      ...subMask,
    }));
  };

  const normalizedMasks = (loadedAdjustments.masks || []).map((maskContainer: MaskContainer) => {
    const containerAdjustments = maskContainer.adjustments || {};
    const normalizedSubMasks = normalizeSubMasks(maskContainer.subMasks);

    return {
      ...INITIAL_MASK_CONTAINER,
      id: maskContainer.id || uuidv4(),
      ...maskContainer,
      adjustments: {
        ...INITIAL_MASK_ADJUSTMENTS,
        ...containerAdjustments,
        flareAmount: containerAdjustments.flareAmount ?? INITIAL_MASK_ADJUSTMENTS.flareAmount,
        glowAmount: containerAdjustments.glowAmount ?? INITIAL_MASK_ADJUSTMENTS.glowAmount,
        halationAmount: containerAdjustments.halationAmount ?? INITIAL_MASK_ADJUSTMENTS.halationAmount,
        hue: containerAdjustments.hue ?? INITIAL_MASK_ADJUSTMENTS.hue,
        colorGrading: { ...INITIAL_MASK_ADJUSTMENTS.colorGrading, ...(containerAdjustments.colorGrading || {}) },
        hsl: { ...INITIAL_MASK_ADJUSTMENTS.hsl, ...(containerAdjustments.hsl || {}) },
        curves: containerAdjustments.curves ? deepCloneCurves(containerAdjustments.curves) : getDefaultCurves(),
        pointCurves: containerAdjustments.pointCurves
          ? deepCloneCurves(containerAdjustments.pointCurves)
          : getDefaultCurves(),
        parametricCurve: containerAdjustments.parametricCurve
          ? deepCloneParametric(containerAdjustments.parametricCurve)
          : getDefaultParametricCurve(),
        curveMode: containerAdjustments.curveMode || INITIAL_MASK_ADJUSTMENTS.curveMode,
        sectionVisibility: {
          ...INITIAL_MASK_ADJUSTMENTS.sectionVisibility,
          ...(containerAdjustments.sectionVisibility || {}),
        },
        sharpnessThreshold: containerAdjustments.sharpnessThreshold ?? INITIAL_MASK_ADJUSTMENTS.sharpnessThreshold,
      },
      subMasks: normalizedSubMasks,
    };
  });

  const normalizedAiPatches = (loadedAdjustments.aiPatches || []).map((patch: any) => ({
    visible: true,
    ...patch,
    subMasks: normalizeSubMasks(patch.subMasks),
  }));

  return {
    ...INITIAL_ADJUSTMENTS,
    ...loadedAdjustments,
    flareAmount: loadedAdjustments.flareAmount ?? INITIAL_ADJUSTMENTS.flareAmount,
    glowAmount: loadedAdjustments.glowAmount ?? INITIAL_ADJUSTMENTS.glowAmount,
    halationAmount: loadedAdjustments.halationAmount ?? INITIAL_ADJUSTMENTS.halationAmount,
    bwRed: loadedAdjustments.bwRed ?? INITIAL_ADJUSTMENTS.bwRed,
    bwGreen: loadedAdjustments.bwGreen ?? INITIAL_ADJUSTMENTS.bwGreen,
    bwBlue: loadedAdjustments.bwBlue ?? INITIAL_ADJUSTMENTS.bwBlue,
    filmProfile: loadedAdjustments.filmProfile ?? INITIAL_ADJUSTMENTS.filmProfile,
    filmStrength: loadedAdjustments.filmStrength ?? INITIAL_ADJUSTMENTS.filmStrength,
    filmContrast: loadedAdjustments.filmContrast ?? INITIAL_ADJUSTMENTS.filmContrast,
    filmSaturation: loadedAdjustments.filmSaturation ?? INITIAL_ADJUSTMENTS.filmSaturation,
    filmRolloff: loadedAdjustments.filmRolloff ?? INITIAL_ADJUSTMENTS.filmRolloff,
    filmBleed: loadedAdjustments.filmBleed ?? INITIAL_ADJUSTMENTS.filmBleed,
    filmCross: loadedAdjustments.filmCross ?? INITIAL_ADJUSTMENTS.filmCross,
    filmShadows: loadedAdjustments.filmShadows ?? INITIAL_ADJUSTMENTS.filmShadows,
    filmHighlights: loadedAdjustments.filmHighlights ?? INITIAL_ADJUSTMENTS.filmHighlights,
    filmBlur: loadedAdjustments.filmBlur ?? INITIAL_ADJUSTMENTS.filmBlur,
    crystalGrainFilling: loadedAdjustments.crystalGrainFilling ?? INITIAL_ADJUSTMENTS.crystalGrainFilling,
    crystalGrainSize: loadedAdjustments.crystalGrainSize ?? INITIAL_ADJUSTMENTS.crystalGrainSize,
    crystalGrainLayers: loadedAdjustments.crystalGrainLayers ?? INITIAL_ADJUSTMENTS.crystalGrainLayers,
    crystalGrainStd: loadedAdjustments.crystalGrainStd ?? INITIAL_ADJUSTMENTS.crystalGrainStd,
    ipolGrainMuR: loadedAdjustments.ipolGrainMuR ?? INITIAL_ADJUSTMENTS.ipolGrainMuR,
    ipolGrainSigmaR: loadedAdjustments.ipolGrainSigmaR ?? INITIAL_ADJUSTMENTS.ipolGrainSigmaR,
    ipolGrainSigmaFilter: loadedAdjustments.ipolGrainSigmaFilter ?? INITIAL_ADJUSTMENTS.ipolGrainSigmaFilter,
    ipolGrainMonteCarlo: loadedAdjustments.ipolGrainMonteCarlo ?? INITIAL_ADJUSTMENTS.ipolGrainMonteCarlo,
    grainEngine: loadedAdjustments.grainEngine ?? INITIAL_ADJUSTMENTS.grainEngine,
    crystalGrainAmount: loadedAdjustments.crystalGrainAmount ?? INITIAL_ADJUSTMENTS.crystalGrainAmount,
    crystalGrainMono: loadedAdjustments.crystalGrainMono ?? INITIAL_ADJUSTMENTS.crystalGrainMono,
    flimPreset: loadedAdjustments.flimPreset ?? INITIAL_ADJUSTMENTS.flimPreset,
    flimEv: loadedAdjustments.flimEv ?? INITIAL_ADJUSTMENTS.flimEv,
    flimStrength: loadedAdjustments.flimStrength ?? INITIAL_ADJUSTMENTS.flimStrength,
    flimContrast: loadedAdjustments.flimContrast ?? INITIAL_ADJUSTMENTS.flimContrast,
    flimShoulder: loadedAdjustments.flimShoulder ?? INITIAL_ADJUSTMENTS.flimShoulder,
    flimToe: loadedAdjustments.flimToe ?? INITIAL_ADJUSTMENTS.flimToe,
    flimSaturation: loadedAdjustments.flimSaturation ?? INITIAL_ADJUSTMENTS.flimSaturation,
    flimWarmth: loadedAdjustments.flimWarmth ?? INITIAL_ADJUSTMENTS.flimWarmth,
    flimAdjacency: loadedAdjustments.flimAdjacency ?? INITIAL_ADJUSTMENTS.flimAdjacency,
    flimHiTint: loadedAdjustments.flimHiTint ?? INITIAL_ADJUSTMENTS.flimHiTint,
    flimShTint: loadedAdjustments.flimShTint ?? INITIAL_ADJUSTMENTS.flimShTint,
    ...normalizeFlimAdv(loadedAdjustments),
    filmBaseColor:
      loadedAdjustments.filmBaseColor?.length === 3
        ? loadedAdjustments.filmBaseColor
        : INITIAL_ADJUSTMENTS.filmBaseColor,
    filmShadowTint:
      loadedAdjustments.filmShadowTint?.length === 3
        ? loadedAdjustments.filmShadowTint
        : INITIAL_ADJUSTMENTS.filmShadowTint,
    filmCurves:
      loadedAdjustments.filmCurves?.length === 768
        ? loadedAdjustments.filmCurves
        : INITIAL_ADJUSTMENTS.filmCurves,
    toneMapper: loadedAdjustments.toneMapper ?? INITIAL_ADJUSTMENTS.toneMapper,
    lensCorrectionMode: loadedAdjustments.lensCorrectionMode || 'manual',
    lensMaker: loadedAdjustments.lensMaker ?? INITIAL_ADJUSTMENTS.lensMaker,
    lensModel: loadedAdjustments.lensModel ?? INITIAL_ADJUSTMENTS.lensModel,
    lensDistortionAmount: loadedAdjustments.lensDistortionAmount ?? INITIAL_ADJUSTMENTS.lensDistortionAmount,
    lensVignetteAmount: loadedAdjustments.lensVignetteAmount ?? INITIAL_ADJUSTMENTS.lensVignetteAmount,
    lensTcaAmount: loadedAdjustments.lensTcaAmount ?? INITIAL_ADJUSTMENTS.lensTcaAmount,
    lensDistortionEnabled: loadedAdjustments.lensDistortionEnabled ?? INITIAL_ADJUSTMENTS.lensDistortionEnabled,
    lensTcaEnabled: loadedAdjustments.lensTcaEnabled ?? INITIAL_ADJUSTMENTS.lensTcaEnabled,
    lensVignetteEnabled: loadedAdjustments.lensVignetteEnabled ?? INITIAL_ADJUSTMENTS.lensVignetteEnabled,
    lensDistortionParams: loadedAdjustments.lensDistortionParams ?? INITIAL_ADJUSTMENTS.lensDistortionParams,
    transformDistortion: loadedAdjustments.transformDistortion ?? INITIAL_ADJUSTMENTS.transformDistortion,
    transformVertical: loadedAdjustments.transformVertical ?? INITIAL_ADJUSTMENTS.transformVertical,
    transformHorizontal: loadedAdjustments.transformHorizontal ?? INITIAL_ADJUSTMENTS.transformHorizontal,
    transformRotate: loadedAdjustments.transformRotate ?? INITIAL_ADJUSTMENTS.transformRotate,
    transformAspect: loadedAdjustments.transformAspect ?? INITIAL_ADJUSTMENTS.transformAspect,
    transformScale: loadedAdjustments.transformScale ?? INITIAL_ADJUSTMENTS.transformScale,
    transformXOffset: loadedAdjustments.transformXOffset ?? INITIAL_ADJUSTMENTS.transformXOffset,
    transformYOffset: loadedAdjustments.transformYOffset ?? INITIAL_ADJUSTMENTS.transformYOffset,
    colorCalibration: { ...INITIAL_ADJUSTMENTS.colorCalibration, ...(loadedAdjustments.colorCalibration || {}) },
    colorGrading: { ...INITIAL_ADJUSTMENTS.colorGrading, ...(loadedAdjustments.colorGrading || {}) },
    hsl: { ...INITIAL_ADJUSTMENTS.hsl, ...(loadedAdjustments.hsl || {}) },
    curves: loadedAdjustments.curves ? deepCloneCurves(loadedAdjustments.curves) : getDefaultCurves(),
    pointCurves: loadedAdjustments.pointCurves ? deepCloneCurves(loadedAdjustments.pointCurves) : getDefaultCurves(),
    parametricCurve: loadedAdjustments.parametricCurve
      ? deepCloneParametric(loadedAdjustments.parametricCurve)
      : getDefaultParametricCurve(),
    curveMode: loadedAdjustments.curveMode || INITIAL_ADJUSTMENTS.curveMode,
    masks: normalizedMasks,
    aiPatches: normalizedAiPatches,
    sectionVisibility: {
      ...INITIAL_ADJUSTMENTS.sectionVisibility,
      ...(loadedAdjustments.sectionVisibility || {}),
    },
    sharpnessThreshold: loadedAdjustments.sharpnessThreshold ?? INITIAL_ADJUSTMENTS.sharpnessThreshold,
  };
};

export interface AdjustmentGroup {
  label: string;
  keys: string[];
}

export const ADJUSTMENT_GROUPS: Record<string, AdjustmentGroup[]> = {
  basic: [
    {
      label: 'modals.copyPaste.groups.exposureToneMapper',
      keys: [BasicAdjustment.Exposure, 'toneMapper'],
    },
    {
      label: 'modals.copyPaste.groups.tone',
      keys: [
        BasicAdjustment.Brightness,
        BasicAdjustment.Contrast,
        BasicAdjustment.Highlights,
        BasicAdjustment.Shadows,
        BasicAdjustment.Whites,
        BasicAdjustment.Blacks,
      ],
    },
    {
      label: 'modals.copyPaste.groups.curves',
      keys: ['curves', 'pointCurves', 'parametricCurve', 'curveMode'],
    },
  ],
  color: [
    { label: 'modals.copyPaste.groups.whiteBalance', keys: [ColorAdjustment.Temperature, ColorAdjustment.Tint] },
    { label: 'modals.copyPaste.groups.presence', keys: [ColorAdjustment.Saturation, ColorAdjustment.Vibrance] },
    {
      label: 'modals.copyPaste.groups.hueShift',
      keys: [ColorAdjustment.Hue],
    },
    { label: 'modals.copyPaste.groups.colorGrading', keys: [ColorAdjustment.ColorGrading] },
    { label: 'modals.copyPaste.groups.colorMixer', keys: [ColorAdjustment.Hsl] },
    { label: 'modals.copyPaste.groups.colorCalibration', keys: ['colorCalibration'] },
  ],
  details: [
    {
      label: 'modals.copyPaste.groups.clarityDehaze',
      keys: [
        DetailsAdjustment.Clarity,
        DetailsAdjustment.Structure,
        DetailsAdjustment.Dehaze,
        DetailsAdjustment.Centré,
      ],
    },
    {
      label: 'modals.copyPaste.groups.sharpness',
      keys: [DetailsAdjustment.Sharpness, DetailsAdjustment.SharpnessThreshold],
    },
    {
      label: 'modals.copyPaste.groups.noiseReduction',
      keys: [DetailsAdjustment.LumaNoiseReduction, DetailsAdjustment.ColorNoiseReduction],
    },
    {
      label: 'modals.copyPaste.groups.chromaticAberration',
      keys: [DetailsAdjustment.ChromaticAberrationRedCyan, DetailsAdjustment.ChromaticAberrationBlueYellow],
    },
  ],
  effects: [
    {
      label: 'modals.copyPaste.groups.vignette',
      keys: [Effect.VignetteAmount, Effect.VignetteFeather, Effect.VignetteMidpoint, Effect.VignetteRoundness],
    },
    { label: 'modals.copyPaste.groups.grain', keys: [Effect.GrainAmount, Effect.GrainRoughness, Effect.GrainSize] },
    {
      label: 'modals.copyPaste.groups.halationGlow',
      keys: [CreativeAdjustment.GlowAmount, CreativeAdjustment.HalationAmount, CreativeAdjustment.FlareAmount],
    },
    {
      label: 'modals.copyPaste.groups.lut',
      keys: [Effect.LutIntensity, Effect.LutName, Effect.LutPath, Effect.LutSize, Effect.LutData],
    },
  ],
  blackAndWhite: [
    {
      label: 'modals.copyPaste.groups.blackAndWhite',
      keys: [BwAdjustment.BwRed, BwAdjustment.BwGreen, BwAdjustment.BwBlue],
    },
  ],
  film: [
    {
      label: 'modals.copyPaste.groups.film',
      keys: [
        FilmAdjustment.FilmProfile,
        FilmAdjustment.FilmStrength,
        FilmAdjustment.FilmContrast,
        FilmAdjustment.FilmSaturation,
        FilmAdjustment.FilmRolloff,
        FilmAdjustment.FilmBleed,
        FilmAdjustment.FilmCross,
        FilmAdjustment.FilmBaseColor,
        FilmAdjustment.FilmShadowTint,
        FilmAdjustment.FilmCurves,
        FilmAdjustment.FilmShadows,
        FilmAdjustment.FilmHighlights,
        FilmAdjustment.FilmBlur,
        FilmAdjustment.GrainEngine,
        FilmAdjustment.CrystalGrainAmount,
        FilmAdjustment.CrystalGrainMono,
        FilmAdjustment.CrystalGrainFilling,
        FilmAdjustment.CrystalGrainSize,
        FilmAdjustment.CrystalGrainLayers,
        FilmAdjustment.CrystalGrainStd,
        FilmAdjustment.IpolGrainMuR,
        FilmAdjustment.IpolGrainSigmaR,
        FilmAdjustment.IpolGrainSigmaFilter,
        FilmAdjustment.IpolGrainMonteCarlo,
        FilmAdjustment.FlimPreset,
        FilmAdjustment.FlimEv,
        FilmAdjustment.FlimStrength,
        FilmAdjustment.FlimContrast,
        FilmAdjustment.FlimShoulder,
        FilmAdjustment.FlimToe,
        FilmAdjustment.FlimSaturation,
        FilmAdjustment.FlimWarmth,
        FilmAdjustment.FlimAdjacency,
        FilmAdjustment.FlimHiTint,
        FilmAdjustment.FlimShTint,
        FilmAdjustment.FlimAdvPreExposure,
        FilmAdjustment.FlimAdvNegExposure,
        FilmAdjustment.FlimAdvNegDensity,
        FilmAdjustment.FlimAdvPrintExposure,
        FilmAdjustment.FlimAdvPrintDensity,
        FilmAdjustment.FlimAdvLog2Max,
        FilmAdjustment.FlimAdvBacklightR,
        FilmAdjustment.FlimAdvBacklightG,
        FilmAdjustment.FlimAdvBacklightB,
        FilmAdjustment.FlimAdvSaturation,
        FilmAdjustment.FlimAdvBlackAuto,
        FilmAdjustment.FlimAdvBlackPoint,
        FilmAdjustment.FlimAdvPreFilterHue,
        FilmAdjustment.FlimAdvPreFilterStrength,
        FilmAdjustment.FlimAdvPostFilterHue,
        FilmAdjustment.FlimAdvPostFilterStrength,
        FilmAdjustment.FlimAdvGamutExpand,
        FilmAdjustment.FlimAdvPaletteRotate,
        FilmAdjustment.FlimAdvPushR,
        FilmAdjustment.FlimAdvPushB,
      ],
    },
  ],
  geometry: [
    { label: 'modals.copyPaste.groups.cropAspectRatio', keys: ['crop', 'aspectRatio'] },
    {
      label: 'modals.copyPaste.groups.transformRotation',
      keys: [
        'rotation',
        'flipHorizontal',
        'flipVertical',
        'orientationSteps',
        TransformAdjustment.TransformDistortion,
        TransformAdjustment.TransformVertical,
        TransformAdjustment.TransformHorizontal,
        TransformAdjustment.TransformRotate,
        TransformAdjustment.TransformAspect,
        TransformAdjustment.TransformScale,
        TransformAdjustment.TransformXOffset,
        TransformAdjustment.TransformYOffset,
      ],
    },
    {
      label: 'modals.copyPaste.groups.lensCorrection',
      keys: [
        LensAdjustment.LensCorrectionMode,
        LensAdjustment.LensMaker,
        LensAdjustment.LensModel,
        LensAdjustment.LensDistortionAmount,
        LensAdjustment.LensVignetteAmount,
        LensAdjustment.LensTcaAmount,
        LensAdjustment.LensDistortionEnabled,
        LensAdjustment.LensTcaEnabled,
        LensAdjustment.LensVignetteEnabled,
      ],
    },
  ],
  masks: [{ label: 'modals.copyPaste.groups.masks', keys: ['masks'] }],
};

export const COPYABLE_ADJUSTMENT_KEYS: string[] = Object.values(ADJUSTMENT_GROUPS)
  .flat()
  .flatMap((group) => group.keys);

export const ADJUSTMENT_SECTIONS: Sections = {
  basic: [
    BasicAdjustment.Brightness,
    BasicAdjustment.Contrast,
    BasicAdjustment.Highlights,
    BasicAdjustment.Shadows,
    BasicAdjustment.Whites,
    BasicAdjustment.Blacks,
    BasicAdjustment.Exposure,
    'toneMapper',
  ],
  curves: ['curves', 'pointCurves', 'parametricCurve', 'curveMode'],
  color: [
    ColorAdjustment.Saturation,
    ColorAdjustment.Temperature,
    ColorAdjustment.Tint,
    ColorAdjustment.Vibrance,
    ColorAdjustment.Hsl,
    ColorAdjustment.ColorGrading,
    'colorCalibration',
    ColorAdjustment.Hue,
  ],
  details: [
    DetailsAdjustment.Clarity,
    DetailsAdjustment.Dehaze,
    DetailsAdjustment.Structure,
    DetailsAdjustment.Centré,
    DetailsAdjustment.Sharpness,
    DetailsAdjustment.SharpnessThreshold,
    DetailsAdjustment.LumaNoiseReduction,
    DetailsAdjustment.ColorNoiseReduction,
    DetailsAdjustment.ChromaticAberrationRedCyan,
    DetailsAdjustment.ChromaticAberrationBlueYellow,
  ],
  effects: [
    CreativeAdjustment.GlowAmount,
    CreativeAdjustment.HalationAmount,
    CreativeAdjustment.FlareAmount,
    Effect.GrainAmount,
    Effect.GrainRoughness,
    Effect.GrainSize,
    Effect.LutIntensity,
    Effect.LutName,
    Effect.LutPath,
    Effect.LutSize,
    Effect.VignetteAmount,
    Effect.VignetteFeather,
    Effect.VignetteMidpoint,
    Effect.VignetteRoundness,
  ],
  blackAndWhite: [BwAdjustment.BwRed, BwAdjustment.BwGreen, BwAdjustment.BwBlue],
  film: [
    FilmAdjustment.FilmProfile,
    FilmAdjustment.FilmStrength,
    FilmAdjustment.FilmContrast,
    FilmAdjustment.FilmSaturation,
    FilmAdjustment.FilmRolloff,
    FilmAdjustment.FilmBleed,
    FilmAdjustment.FilmCross,
    FilmAdjustment.FilmBaseColor,
    FilmAdjustment.FilmShadowTint,
    FilmAdjustment.FilmCurves,
    FilmAdjustment.FilmShadows,
    FilmAdjustment.FilmHighlights,
    FilmAdjustment.FilmBlur,
    FilmAdjustment.FlimPreset,
    FilmAdjustment.FlimEv,
    FilmAdjustment.FlimStrength,
    FilmAdjustment.FlimContrast,
    FilmAdjustment.FlimShoulder,
    FilmAdjustment.FlimToe,
    FilmAdjustment.FlimSaturation,
    FilmAdjustment.FlimWarmth,
    FilmAdjustment.FlimAdjacency,
    FilmAdjustment.FlimHiTint,
    FilmAdjustment.FlimShTint,
    FilmAdjustment.FlimAdvPreExposure,
    FilmAdjustment.FlimAdvNegExposure,
    FilmAdjustment.FlimAdvNegDensity,
    FilmAdjustment.FlimAdvPrintExposure,
    FilmAdjustment.FlimAdvPrintDensity,
    FilmAdjustment.FlimAdvLog2Max,
    FilmAdjustment.FlimAdvBacklightR,
    FilmAdjustment.FlimAdvBacklightG,
    FilmAdjustment.FlimAdvBacklightB,
    FilmAdjustment.FlimAdvSaturation,
    FilmAdjustment.FlimAdvBlackAuto,
    FilmAdjustment.FlimAdvBlackPoint,
    FilmAdjustment.FlimAdvPreFilterHue,
    FilmAdjustment.FlimAdvPreFilterStrength,
    FilmAdjustment.FlimAdvPostFilterHue,
    FilmAdjustment.FlimAdvPostFilterStrength,
    FilmAdjustment.FlimAdvGamutExpand,
    FilmAdjustment.FlimAdvPaletteRotate,
    FilmAdjustment.FlimAdvPushR,
    FilmAdjustment.FlimAdvPushB,
  ],
};
