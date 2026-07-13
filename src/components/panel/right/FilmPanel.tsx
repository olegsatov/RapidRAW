import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import Dropdown from '../../ui/Dropdown';
import Slider from '../../ui/Slider';
import Text from '../../ui/Text';
import CollapsibleSection from '../../ui/CollapsibleSection';
import FilmLookPanel from '../../adjustments/Film';
import BlackAndWhitePanel from '../../adjustments/BlackAndWhite';
import GrainPanel from '../../adjustments/Grain';
import { TextVariants } from '../../../types/typography';
import {
  Adjustments,
  CreativeAdjustment,
  FilmAdjustment,
  FLIM_ADV_KEYS,
  FLIM_BUILTIN_PRESETS,
  FlimPresetParams,
  INITIAL_ADJUSTMENTS,
  SectionVisibility,
} from '../../../utils/adjustments';
import { useEditorStore } from '../../../store/useEditorStore';
import { useUIStore } from '../../../store/useUIStore';
import { useEditorActions } from '../../../hooks/useEditorActions';
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
const ADV_SLIDERS: Array<{
  key: keyof FlimPresetParams;
  label: string;
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
  const setEditor = useEditorStore((s) => s.setEditor);
  const { setAdjustments } = useEditorActions();
  const collapsibleSectionsState = useUIStore((s) => s.collapsibleSectionsState);
  const setUI = useUIStore((s) => s.setUI);

  const [advancedOpen, setAdvancedOpen] = useState(false);
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

  const handleAdjustmentChange = (key: FilmAdjustment | CreativeAdjustment, value: string | number) => {
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
  const resolvedPreset: number | string =
    builtinIdx >= 0 ? builtinIdx : userMatch ? `u:${userMatch.id}` : 'custom';

  const presetOptions: Array<{ label: string; value: number | string }> = [
    { label: t('editor.film.presets.default'), value: 0 },
    { label: t('editor.film.presets.nostalgia'), value: 1 },
    { label: t('editor.film.presets.silver'), value: 2 },
    ...userPresets.map((p) => ({ label: p.name, value: `u:${p.id}` })),
    { label: t('editor.film.presets.custom'), value: 'custom' },
  ];

  const blackAuto = (adjustments.flimAdvBlackAuto ?? 1) >= 0.5;
  const sectionVisibility: SectionVisibility =
    adjustments.sectionVisibility || INITIAL_ADJUSTMENTS.sectionVisibility;
  const flimEnabled = adjustments.toneMapper === 'flim';

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 flex justify-between items-center shrink-0 border-b border-surface">
        <Text variant={TextVariants.title}>{t('editor.film.title')}</Text>
        <button
          className={clsx(
            'px-3 py-1 text-sm font-medium rounded-md transition-colors',
            flimEnabled
              ? 'bg-accent text-button-text'
              : 'bg-card-active text-text-secondary hover:bg-surface',
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
              step={0.1}
              value={adjustments.flimEv ?? 0}
              onDragStateChange={onDragStateChange}
            />
            <Slider
              defaultValue={100}
              label={t('editor.film.strength')}
              max={100}
              min={0}
              onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FlimStrength, e.target.value)}
              step={1}
              value={adjustments.flimStrength ?? 100}
              onDragStateChange={onDragStateChange}
            />
          </div>
        </div>

        <div className="p-2 bg-bg-tertiary rounded-md">
          <Text variant={TextVariants.heading} className="mb-2">
            {t('editor.film.look')}
          </Text>
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
            label={t('editor.film.shoulder')}
            max={100}
            min={-100}
            onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FlimShoulder, e.target.value)}
            step={1}
            value={adjustments.flimShoulder ?? 0}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            defaultValue={0}
            label={t('editor.film.toe')}
            max={100}
            min={-100}
            onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FlimToe, e.target.value)}
            step={1}
            value={adjustments.flimToe ?? 0}
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
            label={t('editor.film.halation')}
            max={200}
            min={0}
            onChange={(e: any) => handleAdjustmentChange(CreativeAdjustment.HalationAmount, e.target.value)}
            step={1}
            value={adjustments.halationAmount ?? 0}
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
          <button
            className="flex items-center justify-between w-full text-text-secondary hover:text-text-primary"
            onClick={() => setAdvancedOpen((v) => !v)}
          >
            <Text variant={TextVariants.heading}>{t('editor.film.advanced')}</Text>
            {advancedOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>

          {advancedOpen && (
            <div className="mt-2">
              <button
                className="w-full mb-3 py-1.5 text-sm rounded-md bg-card-active hover:bg-surface text-text-primary"
                onClick={handleResetImage}
              >
                {t('editor.film.resetImage')}
              </button>

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
            </div>
          )}
        </div>

        <CollapsibleSection
          isContentVisible={sectionVisibility.film}
          isOpen={!!collapsibleSectionsState.film}
          onToggle={() => handleToggleSection('film')}
          onToggleVisibility={() => handleToggleVisibility('film')}
          title={t('editor.adjustments.sections.film')}
        >
          <FilmLookPanel
            adjustments={adjustments}
            setAdjustments={setAdjustments}
            onDragStateChange={onDragStateChange}
          />
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
          canToggleVisibility={false}
          isContentVisible={true}
          isOpen={grainOpen}
          onToggle={() => setGrainOpen((v) => !v)}
          title={t('adjustments.effects.grain')}
        >
          <GrainPanel
            adjustments={adjustments}
            setAdjustments={setAdjustments}
            onDragStateChange={onDragStateChange}
          />
        </CollapsibleSection>
      </div>
    </div>
  );
}
