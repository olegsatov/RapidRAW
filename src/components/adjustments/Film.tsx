import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import Slider from '../ui/Slider';
import Text from '../ui/Text';
import { TextVariants } from '../../types/typography';
import { Adjustments, CreativeAdjustment, Effect, FilmAdjustment } from '../../utils/adjustments';
import { FILM_PROFILE_NAMES, filmProfilePatch } from '../../utils/filmProfiles';
import Dropdown from '../ui/Dropdown';
import Switch from '../ui/Switch';
import Button from '../ui/Button';
import { useEditorStore } from '../../store/useEditorStore';

interface FilmPanelProps {
  adjustments: Adjustments;
  setAdjustments(adjustments: Partial<Adjustments>): any;
  onDragStateChange?: (isDragging: boolean) => void;
}

// Film simulation section (port of the Krea WebGL2 film PoC "Film look"
// group). Per-pixel dials (temp/tint/contrast/saturation/shadows/highlights/
// rolloff/bleed/cross) live in the WGSL film block; blur and chroma drive a
// dedicated post-pass; grain comes from the crystal/IPOL engines below (the
// PoC's procedural grain was removed to avoid double grain with the native
// Effects grain); halation/vignette are the native RapidRAW dials, mirrored
// here because they are part of a stock's look.
export default function FilmPanel({ adjustments, setAdjustments, onDragStateChange }: FilmPanelProps) {
  const { t } = useTranslation();
  const selectedImage = useEditorStore((s: any) => s.selectedImage);
  const [grainRendering, setGrainRendering] = useState(false);
  const [grainProgress, setGrainProgress] = useState('');
  const [grainPreview, setGrainPreview] = useState<string | null>(null);
  const [grainOpts, setGrainOpts] = useState({
    muR: 0.1,
    sigmaR: 0,
    sigmaFilter: 0.8,
    nMonteCarlo: 100,
    monochrome: false,
  });
  const [xtalRendering, setXtalRendering] = useState(false);
  const [xtalProgress, setXtalProgress] = useState('');
  const [xtalPreview, setXtalPreview] = useState<string | null>(null);
  const [xtalOpts, setXtalOpts] = useState({
    filling: 0.25,
    size: 5,
    layers: 30,
    std: 0.5,
  });

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
  // parameters change. The field is a flat-field render of the model, so the
  // mono flag and strength don't affect it (they are shader-side). The
  // `crystal-grain-baked` listener in useTauriListeners bumps the store's
  // renderGeneration, which re-renders the image with the fresh texture.
  useEffect(() => {
    const timer = setTimeout(() => {
      invoke('bake_crystal_grain_field', {
        options: { filling: xtalOpts.filling, size: xtalOpts.size, layers: xtalOpts.layers, std: xtalOpts.std, seed: 1 },
      }).catch((e) => console.warn('Crystal grain bake failed:', e));
    }, 400);
    return () => clearTimeout(timer);
  }, [xtalOpts.filling, xtalOpts.size, xtalOpts.layers, xtalOpts.std]);

  const handleAdjustmentChange = (key: string, value: string) => {
    const numericValue = parseInt(value, 10);
    setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, [key]: numericValue }));
  };

  const handleFilmProfileSelect = (profileId: string) => {
    setAdjustments((prev: Partial<Adjustments>) => ({
      ...prev,
      ...filmProfilePatch(profileId === 'off' ? null : profileId),
    }));
  };

  const handleRenderGrain = async (preview: boolean) => {
    if (!selectedImage?.path || grainRendering) return;
    setGrainRendering(true);
    try {
      await invoke('render_film_grain', {
        path: selectedImage.path,
        adjustments,
        options: { ...grainOpts, seed: 1 },
        preview,
      });
    } catch (e) {
      setGrainProgress(String(e));
      setGrainRendering(false);
    }
  };

  const handleGrainOptChange = (key: string, value: number | string) => {
    setGrainOpts((prev) => ({ ...prev, [key]: parseFloat(String(value)) }));
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
      setXtalProgress(String(e));
      setXtalRendering(false);
    }
  };

  const handleXtalOptChange = (key: string, value: number | string) => {
    setXtalOpts((prev) => ({ ...prev, [key]: parseFloat(String(value)) }));
  };

  return (
    <div className="space-y-4">
      <div className="p-2 bg-bg-tertiary rounded-md">
        <div className="mb-2">
          <Dropdown
            options={[
              { label: t('adjustments.effects.filmOff'), value: 'off' },
              ...FILM_PROFILE_NAMES.map((n) => ({ label: n, value: n })),
            ]}
            value={adjustments.filmProfile || 'off'}
            onChange={handleFilmProfileSelect}
          />
        </div>
        <Slider
          label={t('adjustments.effects.filmStrength')}
          max={100}
          min={0}
          onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FilmStrength, e.target.value)}
          step={1}
          value={adjustments.filmStrength}
          onDragStateChange={onDragStateChange}
        />
        <Slider
          defaultValue={100}
          label={t('adjustments.effects.filmContrast')}
          max={150}
          min={50}
          onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FilmContrast, e.target.value)}
          step={1}
          value={adjustments.filmContrast}
          onDragStateChange={onDragStateChange}
        />
        <Slider
          defaultValue={100}
          label={t('adjustments.effects.filmSaturation')}
          max={200}
          min={0}
          onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FilmSaturation, e.target.value)}
          step={1}
          value={adjustments.filmSaturation}
          onDragStateChange={onDragStateChange}
        />
        <Slider
          label={t('adjustments.effects.filmRolloff')}
          max={100}
          min={0}
          onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FilmRolloff, e.target.value)}
          step={1}
          value={adjustments.filmRolloff}
          onDragStateChange={onDragStateChange}
        />
        <Slider
          label={t('adjustments.effects.filmBleed')}
          max={100}
          min={0}
          onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FilmBleed, e.target.value)}
          step={1}
          value={adjustments.filmBleed}
          onDragStateChange={onDragStateChange}
        />
        <Switch
          label={t('adjustments.effects.filmCross')}
          checked={!!adjustments.filmCross}
          onChange={(v: boolean) => setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, filmCross: v }))}
        />
      </div>

      <div className="p-2 bg-bg-tertiary rounded-md">
        <Text variant={TextVariants.heading} className="mb-2">
          {t('adjustments.effects.whiteBalance')}
        </Text>
        <Slider
          defaultValue={6500}
          label={t('adjustments.color.temperature')}
          max={10000}
          min={3000}
          onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FilmTemp, e.target.value)}
          step={50}
          value={adjustments.filmTemp}
          onDragStateChange={onDragStateChange}
        />
        <Slider
          label={t('adjustments.color.tint')}
          max={100}
          min={-100}
          onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FilmTint, e.target.value)}
          step={1}
          value={adjustments.filmTint}
          onDragStateChange={onDragStateChange}
        />
      </div>

      <div className="p-2 bg-bg-tertiary rounded-md">
        <Text variant={TextVariants.heading} className="mb-2">
          {t('adjustments.effects.tone')}
        </Text>
        <Slider
          label={t('adjustments.basic.shadows')}
          max={100}
          min={-100}
          onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FilmShadows, e.target.value)}
          step={1}
          value={adjustments.filmShadows}
          onDragStateChange={onDragStateChange}
        />
        <Slider
          label={t('adjustments.basic.highlights')}
          max={100}
          min={-100}
          onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FilmHighlights, e.target.value)}
          step={1}
          value={adjustments.filmHighlights}
          onDragStateChange={onDragStateChange}
        />
      </div>

      <div className="p-2 bg-bg-tertiary rounded-md">
        <Text variant={TextVariants.heading} className="mb-2">
          {t('adjustments.effects.halation')}
        </Text>
        <Slider
          label={t('adjustments.effects.amount')}
          max={100}
          min={0}
          onChange={(e: any) => handleAdjustmentChange(CreativeAdjustment.HalationAmount, e.target.value)}
          step={1}
          value={adjustments.halationAmount}
          onDragStateChange={onDragStateChange}
        />
      </div>

      <div className="p-2 bg-bg-tertiary rounded-md">
        <Text variant={TextVariants.heading} className="mb-2">
          {t('adjustments.effects.vignette')}
        </Text>
        <Slider
          label={t('adjustments.effects.amount')}
          max={100}
          min={-100}
          onChange={(e: any) => handleAdjustmentChange(Effect.VignetteAmount, e.target.value)}
          step={1}
          value={adjustments.vignetteAmount}
          onDragStateChange={onDragStateChange}
        />
      </div>

      <div className="p-2 bg-bg-tertiary rounded-md">
        <Text variant={TextVariants.heading} className="mb-2">
          {t('adjustments.effects.filmEmulsion')}
        </Text>
        <Slider
          label={t('adjustments.effects.filmBlur')}
          max={100}
          min={0}
          onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FilmBlur, e.target.value)}
          step={1}
          value={adjustments.filmBlur}
          onDragStateChange={onDragStateChange}
        />
        <Slider
          label={t('adjustments.details.chromaticAberration')}
          max={100}
          min={0}
          onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FilmChroma, e.target.value)}
          step={1}
          value={adjustments.filmChroma}
          onDragStateChange={onDragStateChange}
        />
      </div>

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
          checked={grainOpts.monochrome}
          onChange={(v: boolean) => setGrainOpts((prev) => ({ ...prev, monochrome: v }))}
        />
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
        {grainProgress && <p className="text-xs text-text-secondary mt-2">{grainProgress}</p>}
        {grainPreview && (
          <img
            src={grainPreview}
            alt="Grain preview"
            className="mt-2 w-full rounded-sm border border-card-active"
          />
        )}
        <p className="text-xs text-text-secondary mt-2">{t('adjustments.effects.filmRenderGrainDesc')}</p>
      </div>

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
        <div className="my-2 border-t border-card-active pt-2">
          <Text variant={TextVariants.label} className="mb-1 text-text-secondary">
            {t('adjustments.effects.xtalRealtime')}
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
        </div>
        <Switch
          id="switch-grain-mono-xtal"
          label={t('adjustments.effects.grainMonochrome')}
          checked={!!adjustments.crystalGrainMono}
          onChange={(v: boolean) =>
            setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, crystalGrainMono: v ? 1 : 0 }))
          }
        />
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
    </div>
  );
}
