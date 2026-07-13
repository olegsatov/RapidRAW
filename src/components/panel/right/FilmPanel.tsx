import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import Dropdown from '../../ui/Dropdown';
import Slider from '../../ui/Slider';
import Text from '../../ui/Text';
import { TextVariants } from '../../../types/typography';
import { Adjustments, CreativeAdjustment, FilmAdjustment } from '../../../utils/adjustments';
import { useEditorStore } from '../../../store/useEditorStore';
import { useEditorActions } from '../../../hooks/useEditorActions';

// Film tab: drives the flim tonemapper mode (github.com/bean-mhm/flim,
// AGPLv3 port). The tonemapper selector writes the existing toneMapper
// adjustment ('basic' | 'agx' | 'flim'); preset/EV/strength map to the
// ungated flim* keys parsed in image_processing.rs.
export default function FilmPanel() {
  const { t } = useTranslation();
  const adjustments = useEditorStore((s) => s.adjustments);
  const setEditor = useEditorStore((s) => s.setEditor);
  const { setAdjustments } = useEditorActions();

  const onDragStateChange = useCallback(
    (isDragging: boolean) => setEditor({ isSliderDragging: isDragging }),
    [setEditor],
  );

  const handleAdjustmentChange = (key: FilmAdjustment | CreativeAdjustment, value: string | number) => {
    // Moving any flim control activates the flim tonemapper so the effect is
    // immediately visible.
    setAdjustments((prev: Partial<Adjustments>) => ({
      ...prev,
      [key]: parseFloat(String(value)),
      toneMapper: 'flim',
    }));
  };

  const tonemapperOptions = [
    { label: t('editor.film.mappers.basic'), value: 'basic' },
    { label: t('editor.film.mappers.agx'), value: 'agx' },
    { label: t('editor.film.mappers.flim'), value: 'flim' },
  ];

  const presetOptions = [
    { label: t('editor.film.presets.default'), value: 0 },
    { label: t('editor.film.presets.nostalgia'), value: 1 },
    { label: t('editor.film.presets.silver'), value: 2 },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 flex justify-between items-center shrink-0 border-b border-surface">
        <Text variant={TextVariants.title}>{t('editor.film.title')}</Text>
      </div>

      <div className="grow overflow-y-auto p-4 space-y-4">
        <div className="p-2 bg-bg-tertiary rounded-md">
          <Text variant={TextVariants.heading} className="mb-2">
            {t('editor.film.tonemapper')}
          </Text>
          <Dropdown
            options={tonemapperOptions}
            value={adjustments.toneMapper || 'basic'}
            onChange={(mapper: string) =>
              setAdjustments((prev: Partial<Adjustments>) => ({
                ...prev,
                toneMapper: mapper as Adjustments['toneMapper'],
              }))
            }
          />
        </div>

        <div className="p-2 bg-bg-tertiary rounded-md">
          <Text variant={TextVariants.heading} className="mb-2">
            {t('editor.film.preset')}
          </Text>
          <Dropdown
            options={presetOptions}
            value={adjustments.flimPreset ?? 0}
            onChange={(preset: number) => handleAdjustmentChange(FilmAdjustment.FlimPreset, preset)}
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
      </div>
    </div>
  );
}
