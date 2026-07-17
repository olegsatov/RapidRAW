import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import clsx from 'clsx';
import Slider from '../ui/Slider';
import Text from '../ui/Text';
import { TextVariants } from '../../types/typography';
import { Adjustments, FilmAdjustment } from '../../utils/adjustments';
import Switch from '../ui/Switch';
import Button from '../ui/Button';
import { useEditorStore } from '../../store/useEditorStore';
import { useSettingsStore } from '../../store/useSettingsStore';

interface GrainPanelProps {
  adjustments: Adjustments;
  setAdjustments(adjustments: Partial<Adjustments>): any;
  onDragStateChange?: (isDragging: boolean) => void;
}

// The two physical grain engines (IPOL 2017 and Pierre crystal grain). A
// per-image mode toggle selects which engine is configured and exported;
// only the Pierre engine has a realtime baked-field canvas preview. Both
// engines render offline into a file via their buttons. Native RapidRAW
// grain stays in the Effects section.
export default function GrainPanel({ adjustments, setAdjustments, onDragStateChange }: GrainPanelProps) {
  const { t } = useTranslation();
  const selectedImage = useEditorStore((s: any) => s.selectedImage);
  const [grainRendering, setGrainRendering] = useState(false);
  const [grainProgress, setGrainProgress] = useState('');
  const [grainPreview, setGrainPreview] = useState<string | null>(null);
  const [xtalRendering, setXtalRendering] = useState(false);
  const [xtalProgress, setXtalProgress] = useState('');
  const [xtalPreview, setXtalPreview] = useState<string | null>(null);

  const grainEngine = adjustments.grainEngine === 'ipol' ? 'ipol' : 'pierre';
  const grainVisible = adjustments.sectionVisibility?.grain !== false;

  // Preview-only grain display mode (global app setting, not per-image — the
  // export always renders full quality regardless). Switching it must
  // re-render the canvas: bump the store's renderGeneration (same trick as
  // the crystal-grain-baked listener — no undo-history pollution).
  const appSettings = useSettingsStore((s) => s.appSettings);
  const handleSettingsChange = useSettingsStore((s) => s.handleSettingsChange);
  const grainPreviewMode = appSettings?.grainPreviewMode ?? 'crisp';
  const handleGrainPreviewModeChange = (mode: 'crisp' | 'balanced' | 'accurate') => {
    if (!appSettings) return;
    handleSettingsChange({ ...appSettings, grainPreviewMode: mode });
    useEditorStore.getState().setEditor((s: any) => ({ renderGeneration: s.renderGeneration + 1 }));
  };

  // Grain engine parameters live in the adjustments (persisted to the sidecar)
  // so the export pipeline can reproduce them without the editor being open.
  const grainOpts = {
    muR: adjustments.ipolGrainMuR,
    sigmaR: adjustments.ipolGrainSigmaR,
    sigmaFilter: adjustments.ipolGrainSigmaFilter,
    nMonteCarlo: adjustments.ipolGrainMonteCarlo,
  };
  const xtalOpts = {
    filling: adjustments.crystalGrainFilling,
    size: adjustments.crystalGrainSize,
    layers: adjustments.crystalGrainLayers,
    std: adjustments.crystalGrainStd,
  };

  useEffect(() => {
    const unProgress = listen<string>('film-grain-progress', (e) => setGrainProgress(e.payload));
    const unPreview = listen<string>('film-grain-preview', (e) => setGrainPreview(e.payload));
    const unComplete = listen<string>('film-grain-complete', () => {
      setGrainRendering(false);
      setGrainProgress('');
    });
    return () => {
      unProgress.then((f) => f());
      unPreview.then((f) => f());
      unComplete.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const unProgress = listen<string>('crystal-grain-progress', (e) => setXtalProgress(e.payload));
    const unPreview = listen<string>('crystal-grain-preview', (e) => setXtalPreview(e.payload));
    const unComplete = listen<string>('crystal-grain-complete', () => {
      setXtalRendering(false);
      setXtalProgress('');
    });
    return () => {
      unProgress.then((f) => f());
      unPreview.then((f) => f());
      unComplete.then((f) => f());
    };
  }, []);

  // Realtime preview: rebake the grain field (debounced) whenever the crystal
  // parameters change — only while the Pierre engine is selected and the
  // section is enabled (IPOL has no GPU preview). The field is a flat-field
  // render of the model, so the mono flag and strength don't affect it (they
  // are shader-side). The `crystal-grain-baked` listener in useTauriListeners
  // bumps the store's renderGeneration, which re-renders the image with the
  // fresh texture.
  useEffect(() => {
    if (grainEngine !== 'pierre' || !grainVisible) {
      return;
    }
    const timer = setTimeout(() => {
      invoke('bake_crystal_grain_field', {
        options: { ...xtalOpts, seed: 1 },
      }).catch((e) => console.warn('Crystal grain bake failed:', e));
    }, 400);
    return () => clearTimeout(timer);
  }, [grainEngine, grainVisible, xtalOpts.filling, xtalOpts.size, xtalOpts.layers, xtalOpts.std]);

  const handleAdjustmentChange = (key: string, value: string) => {
    const numericValue = parseInt(value, 10);
    setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, [key]: numericValue }));
  };

  const handleRenderGrain = async (preview: boolean) => {
    if (!selectedImage?.path || grainRendering) return;
    setGrainRendering(true);
    try {
      await invoke('render_film_grain', {
        path: selectedImage.path,
        adjustments,
        options: { ...grainOpts, monochrome: !!adjustments.crystalGrainMono, seed: 1 },
        preview,
      });
    } catch (e) {
      const msg = String(e);
      setGrainProgress(msg.includes('grain_cancelled') ? t('adjustments.effects.grainCancelled') : msg);
      setGrainRendering(false);
    }
  };

  const handleCancelGrain = () => {
    invoke('cancel_grain_render').catch((e) => console.warn('Grain cancel failed:', e));
  };

  const handleGrainOptChange = (key: string, value: number | string) => {
    const map: Record<string, string> = {
      muR: 'ipolGrainMuR',
      sigmaR: 'ipolGrainSigmaR',
      sigmaFilter: 'ipolGrainSigmaFilter',
      nMonteCarlo: 'ipolGrainMonteCarlo',
    };
    setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, [map[key]]: parseFloat(String(value)) }));
  };

  const handleRenderXtal = async (preview: boolean) => {
    if (!selectedImage?.path || xtalRendering) return;
    setXtalRendering(true);
    try {
      // Export honors the realtime amount slider, so the saved file matches
      // the preview. Slider at 0 means "realtime preview off" — fall back to
      // the full-strength export (Rust default) instead of a clean image.
      const amount = ((adjustments.crystalGrainAmount as number) ?? 0) / 100;
      await invoke('render_crystal_grain', {
        path: selectedImage.path,
        adjustments,
        options: {
          ...xtalOpts,
          seed: 1,
          monochrome: !!adjustments.crystalGrainMono,
          ...(amount > 0 ? { amount } : {}),
        },
        preview,
      });
    } catch (e) {
      const msg = String(e);
      setXtalProgress(msg.includes('grain_cancelled') ? t('adjustments.effects.grainCancelled') : msg);
      setXtalRendering(false);
    }
  };

  const handleXtalOptChange = (key: string, value: number | string) => {
    const map: Record<string, string> = {
      filling: 'crystalGrainFilling',
      size: 'crystalGrainSize',
      layers: 'crystalGrainLayers',
      std: 'crystalGrainStd',
    };
    setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, [map[key]]: parseFloat(String(value)) }));
  };

  return (
    <div className="space-y-4">
      <div className="p-2 bg-bg-tertiary rounded-md">
        <Text variant={TextVariants.heading} className="mb-2">
          {t('adjustments.effects.grainMode')}
        </Text>
        <div className="flex gap-1 mb-2">
          {(['pierre', 'ipol'] as const).map((mode) => (
            <button
              key={mode}
              className={clsx(
                'flex-1 px-2 py-1 text-sm font-medium rounded-md transition-colors',
                grainEngine === mode
                  ? 'bg-accent text-button-text'
                  : 'bg-card-active text-text-secondary hover:bg-surface',
              )}
              onClick={() => setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, grainEngine: mode }))}
            >
              {t(`adjustments.effects.grainModes.${mode}`)}
            </button>
          ))}
        </div>
        <Text variant={TextVariants.heading} className="mb-2 mt-3">
          {t('adjustments.effects.grainParameters')}
        </Text>
        <Slider
          label={t('adjustments.effects.amount')}
          max={100}
          min={0}
          onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.CrystalGrainAmount, e.target.value)}
          step={1}
          value={adjustments.crystalGrainAmount}
          onDragStateChange={onDragStateChange}
        />
        <p className="text-xs text-text-secondary mt-1">
          {grainEngine === 'pierre'
            ? t('adjustments.effects.grainAmountPierreHint')
            : t('adjustments.effects.grainAmountIpolHint')}
        </p>
        {grainEngine === 'pierre' && (
          <>
            <Text variant={TextVariants.heading} className="mb-2 mt-3">
              {t('adjustments.effects.grainPreviewLook')}
            </Text>
            <div className="flex gap-1">
              {(['crisp', 'balanced', 'accurate'] as const).map((mode) => (
                <button
                  key={mode}
                  className={clsx(
                    'flex-1 px-2 py-1 text-sm font-medium rounded-md transition-colors',
                    grainPreviewMode === mode
                      ? 'bg-accent text-button-text'
                      : 'bg-card-active text-text-secondary hover:bg-surface',
                  )}
                  onClick={() => handleGrainPreviewModeChange(mode)}
                >
                  {t(`adjustments.effects.grainPreviewLooks.${mode}`)}
                </button>
              ))}
            </div>
            <p className="text-xs text-text-secondary mt-1">
              {t(`adjustments.effects.grainPreviewLookHints.${grainPreviewMode}`)}
            </p>
          </>
        )}
      </div>

      {grainEngine === 'ipol' ? (
        <div className="p-2 bg-bg-tertiary rounded-md">
          <Text variant={TextVariants.heading} className="mb-2">
            {t('adjustments.effects.filmPhysicalGrain')}
          </Text>
          <Slider
            defaultValue={0.1}
            label={t('adjustments.effects.filmGrainRadius')}
            max={2}
            min={0.05}
            onChange={(e: any) => handleGrainOptChange('muR', e.target.value)}
            step={0.05}
            value={grainOpts.muR}
          />
          <Slider
            defaultValue={0}
            label={t('adjustments.effects.filmGrainRadiusVar')}
            max={1}
            min={0}
            onChange={(e: any) => handleGrainOptChange('sigmaR', e.target.value)}
            step={0.05}
            value={grainOpts.sigmaR}
          />
          <Slider
            defaultValue={0.8}
            label={t('adjustments.effects.filmGrainFilter')}
            max={2}
            min={0}
            onChange={(e: any) => handleGrainOptChange('sigmaFilter', e.target.value)}
            step={0.1}
            value={grainOpts.sigmaFilter}
          />
          <Slider
            defaultValue={100}
            label={t('adjustments.effects.filmGrainMonteCarlo')}
            max={800}
            min={25}
            onChange={(e: any) => handleGrainOptChange('nMonteCarlo', e.target.value)}
            step={25}
            value={grainOpts.nMonteCarlo}
          />
          <Switch
            id="switch-grain-mono-ipol"
            label={t('adjustments.effects.grainMonochrome')}
            checked={!!adjustments.crystalGrainMono}
            onChange={(v: boolean) =>
              setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, crystalGrainMono: v ? 1 : 0 }))
            }
          />
          {grainRendering ? (
            <Button onClick={handleCancelGrain} className="w-full bg-surface">
              {t('adjustments.effects.grainCancel')}
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button
                onClick={() => handleRenderGrain(true)}
                disabled={grainRendering || !selectedImage?.path}
                className="flex-1 bg-surface"
              >
                {t('adjustments.effects.filmGrainPreview')}
              </Button>
              <Button
                onClick={() => handleRenderGrain(false)}
                disabled={grainRendering || !selectedImage?.path}
                className="flex-1 bg-surface"
              >
                {t('adjustments.effects.filmRenderGrain')}
              </Button>
            </div>
          )}
          {grainProgress && <p className="text-xs text-text-secondary mt-2">{grainProgress}</p>}
          {grainPreview && (
            <img src={grainPreview} alt="Grain preview" className="mt-2 w-full rounded-sm border border-card-active" />
          )}
          <p className="text-xs text-text-secondary mt-2">{t('adjustments.effects.filmRenderGrainDesc')}</p>
        </div>
      ) : (
        <div className="p-2 bg-bg-tertiary rounded-md">
          <Text variant={TextVariants.heading} className="mb-2">
            {t('adjustments.effects.filmCrystalGrain')}
          </Text>
          <Slider
            defaultValue={0.25}
            label={t('adjustments.effects.xtalFilling')}
            max={0.8}
            min={0.05}
            onChange={(e: any) => handleXtalOptChange('filling', e.target.value)}
            step={0.05}
            value={xtalOpts.filling}
          />
          <Slider
            defaultValue={5}
            label={t('adjustments.effects.xtalSize')}
            max={15}
            min={1}
            onChange={(e: any) => handleXtalOptChange('size', e.target.value)}
            step={1}
            value={xtalOpts.size}
          />
          <Slider
            defaultValue={30}
            label={t('adjustments.effects.xtalLayers')}
            max={60}
            min={5}
            onChange={(e: any) => handleXtalOptChange('layers', e.target.value)}
            step={5}
            value={xtalOpts.layers}
          />
          <Slider
            defaultValue={0.5}
            label={t('adjustments.effects.xtalStd')}
            max={2}
            min={0}
            onChange={(e: any) => handleXtalOptChange('std', e.target.value)}
            step={0.05}
            value={xtalOpts.std}
          />
          <Switch
            id="switch-grain-mono-xtal"
            label={t('adjustments.effects.grainMonochrome')}
            checked={!!adjustments.crystalGrainMono}
            onChange={(v: boolean) =>
              setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, crystalGrainMono: v ? 1 : 0 }))
            }
          />
          {xtalRendering ? (
            <Button onClick={handleCancelGrain} className="w-full bg-surface">
              {t('adjustments.effects.grainCancel')}
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button
                onClick={() => handleRenderXtal(true)}
                disabled={xtalRendering || !selectedImage?.path}
                className="flex-1 bg-surface"
              >
                {t('adjustments.effects.filmGrainPreview')}
              </Button>
              <Button
                onClick={() => handleRenderXtal(false)}
                disabled={xtalRendering || !selectedImage?.path}
                className="flex-1 bg-surface"
              >
                {t('adjustments.effects.filmRenderGrain')}
              </Button>
            </div>
          )}
          {xtalProgress && <p className="text-xs text-text-secondary mt-2">{xtalProgress}</p>}
          {xtalPreview && (
            <img
              src={xtalPreview}
              alt="Crystal grain preview"
              className="mt-2 w-full rounded-sm border border-card-active"
            />
          )}
          <p className="text-xs text-text-secondary mt-2">{t('adjustments.effects.xtalRenderDesc')}</p>
        </div>
      )}
    </div>
  );
}
