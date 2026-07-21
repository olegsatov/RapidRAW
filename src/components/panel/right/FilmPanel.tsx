import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import clsx from 'clsx';
import Dropdown from '../../ui/Dropdown';
import Slider from '../../ui/Slider';
import Text from '../../ui/Text';
import CollapsibleSection from '../../ui/CollapsibleSection';
import BlackAndWhitePanel from '../../adjustments/BlackAndWhite';
import GrainPanel from '../../adjustments/Grain';
import CurveGraph from '../../adjustments/Curves';
import FilmDetailsPanel from '../../adjustments/FilmDetails';
import LUTControl from '../../ui/LUTControl';
import { TextVariants } from '../../../types/typography';
import {
  Adjustments,
  BasicAdjustment,
  ColorAdjustment,
  CreativeAdjustment,
  Effect,
  FilmAdjustment,
  FLIM_ADV_KEYS,
  FLIM_BUILTIN_PRESETS,
  FlimPresetParams,
  INITIAL_ADJUSTMENTS,
  SectionVisibility,
} from '../../../utils/adjustments';
import { useEditorStore } from '../../../store/useEditorStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { useUIStore } from '../../../store/useUIStore';
import { useEditorActions } from '../../../hooks/useEditorActions';
import { saveLutParams } from '../../../utils/lutSettings';
import { Invokes } from '../../ui/AppProperties';

// Film tab: drives the flim tonemapper mode (github.com/bean-mhm/flim,
// AGPLv3 port). The header toggle is the single owner of toneMapper: ON
// writes 'flim', OFF falls back to 'basic' (the Adjust tab default). While
// OFF, every control in the tab is disabled.
//
// Presets are defined by their absolute flimAdv* parameters: selecting a
// preset writes its params into the adjustments, and the dropdown simply
// reflects which preset (if any) the current params match. User presets are
// stored by the backend in flim_presets.json.

interface FlimUserPreset {
  id: string;
  name: string;
  params: FlimPresetParams;
}

const paramsFromAdjustments = (a: Partial<Adjustments>): FlimPresetParams => {
  const params = {} as FlimPresetParams;
  for (const key of FLIM_ADV_KEYS) {
    params[key] = (a[key] as number | undefined) ?? INITIAL_ADJUSTMENTS[key];
  }
  return params;
};

const paramsEqual = (a: FlimPresetParams, b: FlimPresetParams): boolean =>
  FLIM_ADV_KEYS.every((key) => Math.abs(a[key] - b[key]) < 1e-6);

// Advanced panel sliders; labels are i18n keys under editor.film.adv.*.
type AdvLabel =
  | 'preExposure'
  | 'negExposure'
  | 'negDensity'
  | 'printExposure'
  | 'printDensity'
  | 'shoulderBase'
  | 'backlightR'
  | 'backlightG'
  | 'backlightB'
  | 'midtoneSat'
  | 'preFilterHue'
  | 'preFilterStrength'
  | 'postFilterHue'
  | 'postFilterStrength'
  | 'gamutExpand'
  | 'paletteRotate'
  | 'pushR'
  | 'pushB';

const ADV_SLIDERS: Array<{
  key: keyof FlimPresetParams;
  label: AdvLabel;
  min: number;
  max: number;
  step: number;
}> = [
  { key: 'flimAdvPreExposure', label: 'preExposure', min: 0, max: 8, step: 0.1 },
  { key: 'flimAdvNegExposure', label: 'negExposure', min: 0, max: 12, step: 0.1 },
  { key: 'flimAdvNegDensity', label: 'negDensity', min: 0, max: 15, step: 0.1 },
  { key: 'flimAdvPrintExposure', label: 'printExposure', min: 0, max: 12, step: 0.1 },
  { key: 'flimAdvPrintDensity', label: 'printDensity', min: 0, max: 60, step: 0.5 },
  { key: 'flimAdvLog2Max', label: 'shoulderBase', min: 14, max: 30, step: 0.5 },
  { key: 'flimAdvBacklightR', label: 'backlightR', min: 0.5, max: 1.5, step: 0.01 },
  { key: 'flimAdvBacklightG', label: 'backlightG', min: 0.5, max: 1.5, step: 0.01 },
  { key: 'flimAdvBacklightB', label: 'backlightB', min: 0.5, max: 1.5, step: 0.01 },
  { key: 'flimAdvSaturation', label: 'midtoneSat', min: 0, max: 2, step: 0.01 },
  { key: 'flimAdvPreFilterHue', label: 'preFilterHue', min: 0, max: 360, step: 1 },
  { key: 'flimAdvPreFilterStrength', label: 'preFilterStrength', min: 0, max: 0.3, step: 0.01 },
  { key: 'flimAdvPostFilterHue', label: 'postFilterHue', min: 0, max: 360, step: 1 },
  { key: 'flimAdvPostFilterStrength', label: 'postFilterStrength', min: 0, max: 0.3, step: 0.01 },
  { key: 'flimAdvGamutExpand', label: 'gamutExpand', min: 50, max: 200, step: 1 },
  { key: 'flimAdvPaletteRotate', label: 'paletteRotate', min: -10, max: 10, step: 0.1 },
  { key: 'flimAdvPushR', label: 'pushR', min: 0.5, max: 1.5, step: 0.01 },
  { key: 'flimAdvPushB', label: 'pushB', min: 0.5, max: 1.5, step: 0.01 },
];

export default function FilmPanel() {
  const { t } = useTranslation();
  const adjustments = useEditorStore((s) => s.adjustments);
  const histogram = useEditorStore((s) => s.histogram);
  const selectedImage = useEditorStore((s) => s.selectedImage);
  const setEditor = useEditorStore((s) => s.setEditor);
  const { setAdjustments, handleLutSelect, setLutPreviewOverride } = useEditorActions();
  const theme = useSettingsStore((s) => s.theme);
  const appSettings = useSettingsStore((s) => s.appSettings);
  const collapsibleSectionsState = useUIStore((s) => s.collapsibleSectionsState);
  const setUI = useUIStore((s) => s.setUI);

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [basicOpen, setBasicOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [curvesOpen, setCurvesOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [filmEffectsOpen, setFilmEffectsOpen] = useState(false);
  const [grainOpen, setGrainOpen] = useState(false);
  const [userPresets, setUserPresets] = useState<Array<FlimUserPreset>>([]);
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState('');

  useEffect(() => {
    invoke(Invokes.LoadFlimPresets)
      .then((presets) => setUserPresets(presets as Array<FlimUserPreset>))
      .catch((err) => console.error('Failed to load flim presets:', err));
  }, []);

  const onDragStateChange = useCallback(
    (isDragging: boolean) => setEditor({ isSliderDragging: isDragging }),
    [setEditor],
  );

  const handleAdjustmentChange = (key: string, value: string | number) => {
    setAdjustments((prev: Partial<Adjustments>) => ({
      ...prev,
      [key]: parseFloat(String(value)),
    }));
  };

  const handleAdvChange = (key: keyof FlimPresetParams, value: string | number) => {
    setAdjustments((prev: Partial<Adjustments>) => ({
      ...prev,
      [key]: parseFloat(String(value)),
    }));
  };

  const handlePresetSelect = (value: number | string) => {
    if (value === 'custom') {
      return;
    }
    if (typeof value === 'number') {
      setAdjustments((prev: Partial<Adjustments>) => ({
        ...prev,
        ...FLIM_BUILTIN_PRESETS[value],
        flimPreset: value,
      }));
      return;
    }
    const user = userPresets.find((p) => `u:${p.id}` === value);
    if (user) {
      setAdjustments((prev: Partial<Adjustments>) => ({
        ...prev,
        ...user.params,
        flimPreset: -1,
      }));
    }
  };

  // Reset every adjustment to factory defaults, keeping the framing and the
  // panel on/off state (the header toggle owns toneMapper).
  const handleResetImage = () => {
    setAdjustments((prev: Partial<Adjustments>) => ({
      ...INITIAL_ADJUSTMENTS,
      toneMapper: prev.toneMapper ?? INITIAL_ADJUSTMENTS.toneMapper,
      crop: prev.crop ?? null,
      aspectRatio: prev.aspectRatio,
      rotation: prev.rotation ?? 0,
      flipHorizontal: prev.flipHorizontal ?? false,
      flipVertical: prev.flipVertical ?? false,
    }));
  };

  const handleSavePreset = async () => {
    const name = presetName.trim();
    if (!name) {
      return;
    }
    const next: Array<FlimUserPreset> = [
      ...userPresets,
      { id: crypto.randomUUID(), name, params: paramsFromAdjustments(adjustments) },
    ];
    setUserPresets(next);
    setSavingPreset(false);
    setPresetName('');
    try {
      await invoke(Invokes.SaveFlimPresets, { presets: next });
    } catch (err) {
      console.error('Failed to save flim presets:', err);
    }
  };

  // The film/B&W/grain sections moved here from the Adjust tab; film and B&W
  // keep their visibility toggles (they gate the render) and their shared
  // open-state keys.
  const handleToggleSection = (section: string) => {
    setUI((state: any) => ({
      collapsibleSectionsState: {
        ...state.collapsibleSectionsState,
        [section]: !state.collapsibleSectionsState[section],
      },
    }));
  };

  const handleToggleVisibility = (sectionName: string) => {
    setAdjustments((prev: Partial<Adjustments>) => {
      const current: SectionVisibility = prev.sectionVisibility || INITIAL_ADJUSTMENTS.sectionVisibility;
      return {
        ...prev,
        sectionVisibility: {
          ...current,
          [sectionName]: !current[sectionName as keyof SectionVisibility],
        },
      };
    });
  };

  // The dropdown reflects which preset the current absolute params match;
  // editing any advanced slider falls back to "Custom".
  const currentParams = paramsFromAdjustments(adjustments);
  const builtinIdx = FLIM_BUILTIN_PRESETS.findIndex((p) => paramsEqual(currentParams, p));
  const userMatch = userPresets.find((p) => paramsEqual(currentParams, p.params));
  const resolvedPreset: number | string = builtinIdx >= 0 ? builtinIdx : userMatch ? `u:${userMatch.id}` : 'custom';

  const presetOptions: Array<{ label: string; value: number | string }> = [
    { label: t('editor.film.presets.default'), value: 0 },
    { label: t('editor.film.presets.nostalgia'), value: 1 },
    { label: t('editor.film.presets.silver'), value: 2 },
    ...userPresets.map((p) => ({ label: p.name, value: `u:${p.id}` })),
    { label: t('editor.film.presets.custom'), value: 'custom' },
  ];

  const blackAuto = (adjustments.flimAdvBlackAuto ?? 1) >= 0.5;
  const sectionVisibility: SectionVisibility = adjustments.sectionVisibility || INITIAL_ADJUSTMENTS.sectionVisibility;
  const flimEnabled = adjustments.toneMapper === 'flim';

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 flex justify-between items-center shrink-0 border-b border-surface">
        <Text variant={TextVariants.title}>{t('editor.film.title')}</Text>
        <div className="flex items-center gap-2">
          <button
            className="p-2 rounded-full hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            disabled={!selectedImage}
            onClick={handleResetImage}
            data-tooltip={t('editor.adjustments.tooltips.resetAdjustments')}
          >
            <RotateCcw size={18} />
          </button>
          <button
            className={clsx(
              'px-3 py-1 text-sm font-medium rounded-md transition-colors',
              flimEnabled ? 'bg-accent text-button-text' : 'bg-card-active text-text-secondary hover:bg-surface',
            )}
            onClick={() =>
              setAdjustments((prev: Partial<Adjustments>) => ({
                ...prev,
                toneMapper: flimEnabled ? 'basic' : 'flim',
              }))
            }
            data-tooltip={t('editor.film.toggleTooltip')}
          >
            {flimEnabled ? t('editor.film.toggleOn') : t('editor.film.toggleOff')}
          </button>
        </div>
      </div>

      <div
        className={clsx(
          'grow overflow-y-auto p-4 space-y-4',
          !flimEnabled && 'opacity-40 pointer-events-none select-none',
        )}
      >
        <div className="p-2 bg-bg-tertiary rounded-md">
          <Text variant={TextVariants.heading} className="mb-2">
            {t('editor.film.preset')}
          </Text>
          <Dropdown
            options={presetOptions}
            value={resolvedPreset}
            onChange={(value: number | string) => handlePresetSelect(value)}
          />
          <div className="mt-2">
            <Slider
              label={t('editor.film.ev')}
              max={3}
              min={-3}
              onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FlimEv, e.target.value)}
              step={0.05}
              value={adjustments.flimEv ?? 0}
              onDragStateChange={onDragStateChange}
            />
          </div>
          <div className="flex gap-2 mt-2">
            <div className="w-1/2">
              <Slider
                label={t('adjustments.color.temperature')}
                max={100}
                min={-100}
                onChange={(e: any) => handleAdjustmentChange(ColorAdjustment.Temperature, e.target.value)}
                step={1}
                value={adjustments.temperature ?? 0}
                trackClassName="temperature-gradient-track"
                onDragStateChange={onDragStateChange}
              />
            </div>
            <div className="w-1/2">
              <Slider
                label={t('adjustments.color.tint')}
                max={100}
                min={-100}
                onChange={(e: any) => handleAdjustmentChange(ColorAdjustment.Tint, e.target.value)}
                step={1}
                value={adjustments.tint ?? 0}
                trackClassName="tint-gradient-track"
                onDragStateChange={onDragStateChange}
              />
            </div>
          </div>
        </div>

        <div className="p-2 bg-bg-tertiary rounded-md">
          <Slider
            defaultValue={100}
            label={t('editor.film.contrast')}
            max={150}
            min={50}
            onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FlimContrast, e.target.value)}
            step={1}
            value={adjustments.flimContrast ?? 100}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            defaultValue={0}
            label={t('editor.film.lights')}
            max={100}
            min={-100}
            onChange={(e: any) =>
              handleAdjustmentChange(FilmAdjustment.FlimShoulder, String(-parseFloat(e.target.value)))
            }
            step={1}
            value={-(adjustments.flimShoulder ?? 0)}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            defaultValue={0}
            label={t('adjustments.basic.shadows')}
            max={100}
            min={-100}
            onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FlimToe, String(-parseFloat(e.target.value)))}
            step={1}
            value={-(adjustments.flimToe ?? 0)}
            onDragStateChange={onDragStateChange}
          />
        </div>

        <CollapsibleSection
          canToggleVisibility={false}
          isContentVisible={true}
          isOpen={colorOpen}
          onToggle={() => setColorOpen((v) => !v)}
          title={t('editor.adjustments.sections.color')}
        >
          <div className="p-2 bg-bg-tertiary rounded-md mb-3">
            <Text variant={TextVariants.heading} className="mb-2">
              {t('adjustments.basic.toneMapper')}
            </Text>
            <Slider
              defaultValue={100}
              label={t('editor.film.saturation')}
              max={200}
              min={0}
              onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FlimSaturation, e.target.value)}
              step={1}
              value={adjustments.flimSaturation ?? 100}
              onDragStateChange={onDragStateChange}
            />
            <Slider
              defaultValue={0}
              label={t('editor.film.warmth')}
              max={100}
              min={-100}
              onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FlimWarmth, e.target.value)}
              step={1}
              value={adjustments.flimWarmth ?? 0}
              onDragStateChange={onDragStateChange}
            />
            <Slider
              defaultValue={0}
              label={t('editor.film.hiTint')}
              max={100}
              min={-100}
              onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FlimHiTint, e.target.value)}
              step={1}
              value={adjustments.flimHiTint ?? 0}
              onDragStateChange={onDragStateChange}
            />
            <Slider
              defaultValue={0}
              label={t('editor.film.shTint')}
              max={100}
              min={-100}
              onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FlimShTint, e.target.value)}
              step={1}
              value={adjustments.flimShTint ?? 0}
              onDragStateChange={onDragStateChange}
            />
          </div>

          <div className="p-2 bg-bg-tertiary rounded-md">
            <Text variant={TextVariants.heading} className="mb-2">
              {t('editor.film.classic')}
            </Text>
            <Slider
              label={t('adjustments.color.vibrance')}
              max={100}
              min={-100}
              onChange={(e: any) => handleAdjustmentChange(ColorAdjustment.Vibrance, e.target.value)}
              step={1}
              value={adjustments.vibrance ?? 0}
              onDragStateChange={onDragStateChange}
            />
            <Slider
              label={t('adjustments.color.saturation')}
              max={100}
              min={-100}
              onChange={(e: any) => handleAdjustmentChange(ColorAdjustment.Saturation, e.target.value)}
              step={1}
              value={adjustments.saturation ?? 0}
              onDragStateChange={onDragStateChange}
            />
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          canToggleVisibility={false}
          isContentVisible={true}
          isOpen={basicOpen}
          onToggle={() => setBasicOpen((v) => !v)}
          title={t('editor.film.hwsb')}
        >
          <div className="p-2 bg-bg-tertiary rounded-md mb-3">
            <Text variant={TextVariants.heading} className="mb-2">
              {t('adjustments.effects.tone')}
            </Text>
            <Slider
              label={t('adjustments.basic.highlights')}
              max={100}
              min={-100}
              onChange={(e: any) => handleAdjustmentChange(BasicAdjustment.Highlights, e.target.value)}
              step={1}
              value={adjustments.highlights ?? 0}
              onDragStateChange={onDragStateChange}
            />
            <Slider
              label={t('adjustments.basic.whites')}
              max={100}
              min={-100}
              onChange={(e: any) => handleAdjustmentChange(BasicAdjustment.Whites, e.target.value)}
              step={1}
              value={adjustments.whites ?? 0}
              onDragStateChange={onDragStateChange}
            />
            <Slider
              label={t('adjustments.basic.shadows')}
              max={100}
              min={-100}
              onChange={(e: any) => handleAdjustmentChange(BasicAdjustment.Shadows, e.target.value)}
              step={1}
              value={adjustments.shadows ?? 0}
              onDragStateChange={onDragStateChange}
            />
            <Slider
              label={t('adjustments.basic.blacks')}
              max={100}
              min={-100}
              onChange={(e: any) => handleAdjustmentChange(BasicAdjustment.Blacks, e.target.value)}
              step={1}
              value={adjustments.blacks ?? 0}
              onDragStateChange={onDragStateChange}
            />
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          canToggleVisibility={false}
          isContentVisible={true}
          isOpen={detailsOpen}
          onToggle={() => setDetailsOpen((v) => !v)}
          title={t('editor.adjustments.sections.details')}
        >
          <FilmDetailsPanel
            adjustments={adjustments}
            setAdjustments={setAdjustments}
            appSettings={appSettings}
            onDragStateChange={onDragStateChange}
          />
        </CollapsibleSection>

        <CollapsibleSection
          isContentVisible={sectionVisibility.lut}
          isOpen={!!collapsibleSectionsState.lut}
          onToggle={() => handleToggleSection('lut')}
          onToggleVisibility={() => handleToggleVisibility('lut')}
          title={t('editor.film.lut')}
        >
          <div className="p-2 bg-bg-tertiary rounded-md">
            <LUTControl
              lutPath={adjustments.lutPath || null}
              lutName={adjustments.lutName || null}
              lutIntensity={adjustments.lutIntensity || 100}
              lutTiming={adjustments.lutTiming || 'before'}
              lutInputRange={adjustments.lutInputRange ?? 6}
              lutInputOffset={adjustments.lutInputOffset ?? 0}
              lutOffsetCompensation={adjustments.lutOffsetCompensation ?? false}
              onLutSelect={handleLutSelect}
              onLutHover={setLutPreviewOverride}
              onIntensityChange={(intensity: number) => {
                setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, lutIntensity: intensity }));
                saveLutParams(adjustments.lutPath, { intensity });
              }}
              onTimingChange={(timing: 'after' | 'before') => {
                setAdjustments((prev: Partial<Adjustments>) => ({
                  ...prev,
                  lutTiming: timing,
                  lutNormalizeMode: timing === 'before' ? 'hdr' : 'clamp',
                }));
                saveLutParams(adjustments.lutPath, { timing });
              }}
              onInputRangeChange={(range: number) => {
                setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, lutInputRange: range }));
                saveLutParams(adjustments.lutPath, { inputRange: range });
              }}
              onInputOffsetChange={(offset: number) => {
                setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, lutInputOffset: offset }));
                saveLutParams(adjustments.lutPath, { inputOffset: offset });
              }}
              onOffsetCompensationChange={(enabled: boolean) => {
                setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, lutOffsetCompensation: enabled }));
                saveLutParams(adjustments.lutPath, { offsetCompensation: enabled });
              }}
              onClear={() =>
                setAdjustments((prev: Partial<Adjustments>) => ({
                  ...prev,
                  lutPath: null,
                  lutName: null,
                  lutData: null,
                  lutSize: 0,
                  lutIntensity: 100,
                  lutTiming: 'before',
                  lutNormalizeMode: 'hdr',
                  lutInputRange: 6,
                  lutInputOffset: 0,
                  lutOffsetCompensation: false,
                }))
              }
              onDragStateChange={onDragStateChange}
            />
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          isContentVisible={sectionVisibility.filmEffects}
          isOpen={filmEffectsOpen}
          onToggle={() => setFilmEffectsOpen((v) => !v)}
          onToggleVisibility={() => handleToggleVisibility('filmEffects')}
          title={t('editor.film.effects')}
        >
          <div className="p-2 bg-bg-tertiary rounded-md mb-3">
            <Text variant={TextVariants.heading} className="mb-2">
              {t('adjustments.effects.creative')}
            </Text>
            <Slider
              defaultValue={0}
              label={t('editor.film.halation')}
              max={200}
              min={0}
              onChange={(e: any) => handleAdjustmentChange(CreativeAdjustment.HalationAmount, e.target.value)}
              step={1}
              value={adjustments.halationAmount ?? 0}
              onDragStateChange={onDragStateChange}
            />
            <Slider
              label={t('adjustments.details.centre')}
              max={100}
              min={-100}
              onChange={(e: any) => handleAdjustmentChange('centré', e.target.value)}
              step={1}
              value={adjustments.centré ?? 0}
              onDragStateChange={onDragStateChange}
            />
            <Slider
              defaultValue={0}
              label={t('adjustments.effects.glow')}
              max={100}
              min={0}
              onChange={(e: any) => handleAdjustmentChange(CreativeAdjustment.GlowAmount, e.target.value)}
              step={1}
              value={adjustments.glowAmount ?? 0}
              onDragStateChange={onDragStateChange}
            />
            <Slider
              defaultValue={0}
              label={t('editor.film.adjacency')}
              max={100}
              min={0}
              onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FlimAdjacency, e.target.value)}
              step={1}
              value={adjustments.flimAdjacency ?? 0}
              onDragStateChange={onDragStateChange}
            />
            <div className="flex gap-2">
              <div className="flex-1">
                <Slider
                  defaultValue={0}
                  label={t('editor.film.preToneDiffusionAmount')}
                  max={100}
                  min={0}
                  onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FilmBlurPreAmount, e.target.value)}
                  step={1}
                  value={adjustments.filmBlurPreAmount ?? 0}
                  onDragStateChange={onDragStateChange}
                />
              </div>
              <div className="flex-1">
                <Slider
                  defaultValue={0}
                  label={t('editor.film.preToneDiffusionCompensation')}
                  max={100}
                  min={0}
                  onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FilmBlurPreCompensation, e.target.value)}
                  step={1}
                  value={adjustments.filmBlurPreCompensation ?? 0}
                  onDragStateChange={onDragStateChange}
                />
              </div>
              <div className="flex-1">
                <Slider
                  defaultValue={0.5}
                  label={t('editor.film.preToneDiffusionRadius')}
                  max={4}
                  min={0.5}
                  onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FilmBlurPreRadius, e.target.value)}
                  step={0.1}
                  value={adjustments.filmBlurPreRadius ?? 0.5}
                  onDragStateChange={onDragStateChange}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <div className="w-2/3">
                <Slider
                  defaultValue={0}
                  label={t('editor.film.preToneSoftBlurAmount')}
                  max={100}
                  min={0}
                  onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FilmBlurPreSoftAmount, e.target.value)}
                  step={1}
                  value={adjustments.filmBlurPreSoftAmount ?? 0}
                  onDragStateChange={onDragStateChange}
                />
              </div>
              <div className="w-1/3">
                <Slider
                  defaultValue={0.5}
                  label={t('editor.film.preToneSoftBlurRadius')}
                  max={4}
                  min={0.5}
                  onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FilmBlurPreSoftRadius, e.target.value)}
                  step={0.1}
                  value={adjustments.filmBlurPreSoftRadius ?? 0.5}
                  onDragStateChange={onDragStateChange}
                />
              </div>
            </div>
          </div>

          <div className="p-2 bg-bg-tertiary rounded-md">
            <Text variant={TextVariants.heading} className="mb-2">
              {t('adjustments.effects.vignette')}
            </Text>
            <Slider
              defaultValue={0}
              label={t('adjustments.effects.amount')}
              max={100}
              min={-100}
              onChange={(e: any) => handleAdjustmentChange(Effect.VignetteAmount, e.target.value)}
              step={1}
              value={adjustments.vignetteAmount ?? 0}
              onDragStateChange={onDragStateChange}
            />
            <Slider
              defaultValue={50}
              label={t('adjustments.effects.midpoint')}
              max={100}
              min={0}
              onChange={(e: any) => handleAdjustmentChange(Effect.VignetteMidpoint, e.target.value)}
              step={1}
              value={adjustments.vignetteMidpoint ?? 50}
              onDragStateChange={onDragStateChange}
              fillOrigin="min"
            />
            <Slider
              defaultValue={0}
              label={t('adjustments.effects.roundness')}
              max={100}
              min={-100}
              onChange={(e: any) => handleAdjustmentChange(Effect.VignetteRoundness, e.target.value)}
              step={1}
              value={adjustments.vignetteRoundness ?? 0}
              onDragStateChange={onDragStateChange}
            />
            <Slider
              defaultValue={50}
              label={t('adjustments.effects.feather')}
              max={100}
              min={0}
              onChange={(e: any) => handleAdjustmentChange(Effect.VignetteFeather, e.target.value)}
              step={1}
              value={adjustments.vignetteFeather ?? 50}
              onDragStateChange={onDragStateChange}
              fillOrigin="min"
            />
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          isContentVisible={sectionVisibility.blackAndWhite}
          isOpen={!!collapsibleSectionsState.blackAndWhite}
          onToggle={() => handleToggleSection('blackAndWhite')}
          onToggleVisibility={() => handleToggleVisibility('blackAndWhite')}
          title={t('editor.adjustments.sections.blackAndWhite')}
        >
          <BlackAndWhitePanel
            adjustments={adjustments}
            setAdjustments={setAdjustments}
            onDragStateChange={onDragStateChange}
          />
        </CollapsibleSection>

        <CollapsibleSection
          isContentVisible={sectionVisibility.grain}
          isOpen={grainOpen}
          onToggle={() => setGrainOpen((v) => !v)}
          onToggleVisibility={() => handleToggleVisibility('grain')}
          title={t('adjustments.effects.grain')}
        >
          <GrainPanel adjustments={adjustments} setAdjustments={setAdjustments} onDragStateChange={onDragStateChange} />
        </CollapsibleSection>

        <CollapsibleSection
          canToggleVisibility={false}
          isContentVisible={true}
          isOpen={curvesOpen}
          onToggle={() => setCurvesOpen((v) => !v)}
          title={t('editor.adjustments.sections.curves')}
        >
          <CurveGraph
            adjustments={adjustments}
            setAdjustments={setAdjustments}
            histogram={histogram}
            theme={theme}
            onDragStateChange={onDragStateChange}
          />
        </CollapsibleSection>

        <CollapsibleSection
          canToggleVisibility={false}
          isContentVisible={true}
          isOpen={advancedOpen}
          onToggle={() => setAdvancedOpen((v) => !v)}
          title={t('editor.film.advanced')}
        >
          {ADV_SLIDERS.slice(0, 10).map(({ key, label, min, max, step }) => (
            <Slider
              key={key}
              defaultValue={INITIAL_ADJUSTMENTS[key]}
              label={t(`editor.film.adv.${label}`)}
              max={max}
              min={min}
              onChange={(e: any) => handleAdvChange(key, e.target.value)}
              step={step}
              value={adjustments[key] ?? INITIAL_ADJUSTMENTS[key]}
              onDragStateChange={onDragStateChange}
            />
          ))}

          <label className="flex items-center gap-2 mb-2 text-sm text-text-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              className="accent-accent"
              checked={blackAuto}
              onChange={(e) => handleAdvChange('flimAdvBlackAuto', e.target.checked ? 1 : 0)}
            />
            {t('editor.film.adv.blackAuto')}
          </label>
          <div className={blackAuto ? 'opacity-40 pointer-events-none' : ''}>
            <Slider
              defaultValue={INITIAL_ADJUSTMENTS.flimAdvBlackPoint}
              label={t('editor.film.adv.blackPoint')}
              max={10}
              min={-10}
              onChange={(e: any) => handleAdvChange('flimAdvBlackPoint', e.target.value)}
              step={0.1}
              value={adjustments.flimAdvBlackPoint ?? 0}
              onDragStateChange={onDragStateChange}
            />
          </div>

          {ADV_SLIDERS.slice(10).map(({ key, label, min, max, step }) => (
            <Slider
              key={key}
              defaultValue={INITIAL_ADJUSTMENTS[key]}
              label={t(`editor.film.adv.${label}`)}
              max={max}
              min={min}
              onChange={(e: any) => handleAdvChange(key, e.target.value)}
              step={step}
              value={adjustments[key] ?? INITIAL_ADJUSTMENTS[key]}
              onDragStateChange={onDragStateChange}
            />
          ))}

          {savingPreset ? (
            <div className="flex items-center gap-2 mt-3">
              <input
                type="text"
                autoFocus
                className="grow text-sm bg-card-active border border-gray-500 rounded-sm px-2 py-1 outline-none focus:ring-1 focus:ring-blue-500 text-text-primary"
                placeholder={t('editor.film.presetNamePlaceholder')}
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSavePreset();
                  } else if (e.key === 'Escape') {
                    setSavingPreset(false);
                    setPresetName('');
                  }
                }}
              />
              <button
                className="shrink-0 px-2 py-1 text-sm rounded-md bg-accent text-white disabled:opacity-40"
                disabled={!presetName.trim()}
                onClick={handleSavePreset}
              >
                {t('editor.film.savePresetConfirm')}
              </button>
            </div>
          ) : (
            <button
              className="w-full mt-3 py-1.5 text-sm rounded-md bg-card-active hover:bg-surface text-text-primary"
              onClick={() => setSavingPreset(true)}
            >
              {t('editor.film.savePreset')}
            </button>
          )}
        </CollapsibleSection>
      </div>
    </div>
  );
}
