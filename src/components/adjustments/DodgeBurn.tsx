// This panel intentionally mirrors FilmPanel.tsx without grain, B&W, LUT, or advanced
// film controls so the dodge/burn mask workflow stays separate and upstream merges
// for FilmPanel.tsx don't collide with our mask-specific adjustments.

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Slider from '../ui/Slider';
import Text from '../ui/Text';
import CollapsibleSection from '../ui/CollapsibleSection';
import FilmDetailsPanel from './FilmDetails';
import CurveGraph, { type ChannelConfig } from './Curves';
import {
  BasicAdjustment,
  ColorAdjustment,
  CreativeAdjustment,
  DetailsAdjustment,
  Effect,
  FilmAdjustment,
  type Adjustments,
} from '../../utils/adjustments';
import { type DodgeBurnAdjustments, type ScalarDodgeBurnKey } from '../../types/dodgeBurn';
import { TextVariants } from '../../types/typography';

type CurvesDodgeBurnUpdates = Partial<
  Pick<DodgeBurnAdjustments, 'curves' | 'pointCurves' | 'parametricCurve' | 'curveMode'>
>;

interface DodgeBurnPanelProps {
  adjustments: DodgeBurnAdjustments;
  histogram?: ChannelConfig | null;
  onScalarChange(key: ScalarDodgeBurnKey, value: number): void;
  onCurvesChange(updates: CurvesDodgeBurnUpdates): void;
  onDetailsChange(updates: Partial<DodgeBurnAdjustments>): void;
  onDragStateChange?(isDragging: boolean): void;
  theme?: string;
}

export default function DodgeBurnPanel({
  adjustments,
  histogram,
  onScalarChange,
  onCurvesChange,
  onDetailsChange,
  onDragStateChange,
  theme,
}: DodgeBurnPanelProps) {
  const { t } = useTranslation();
  const [basicOpen, setBasicOpen] = useState(true);
  const [colorOpen, setColorOpen] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [effectsOpen, setEffectsOpen] = useState(true);
  const [vignetteOpen, setVignetteOpen] = useState(true);
  const [curvesOpen, setCurvesOpen] = useState(false);

  const setDetailsAdjustments = useCallback(
    (updates: Partial<Adjustments>) => {
      onDetailsChange(updates as Partial<DodgeBurnAdjustments>);
    },
    [onDetailsChange],
  );

  const setCurveAdjustments = useCallback(
    (updater: CurvesDodgeBurnUpdates | ((prev: DodgeBurnAdjustments) => CurvesDodgeBurnUpdates)) => {
      const updates = typeof updater === 'function' ? updater(adjustments) : updater;
      onCurvesChange(updates);
    },
    [adjustments, onCurvesChange],
  );

  return (
    <div className="space-y-4">
      <div className="p-2 bg-bg-tertiary rounded-md">
        <Text variant={TextVariants.heading} className="mb-2">
          {t('editor.film.response')}
        </Text>
        <Slider
          label={t('editor.film.ev')}
          max={3}
          min={-3}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            onScalarChange(FilmAdjustment.FlimEv, Number(e.target.value))
          }
          step={0.05}
          value={adjustments.flimEv ?? 0}
          onDragStateChange={onDragStateChange}
        />
        <Slider
          defaultValue={100}
          label={t('editor.film.contrast')}
          max={150}
          min={50}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            onScalarChange(FilmAdjustment.FlimContrast, Number(e.target.value))
          }
          step={1}
          value={adjustments.flimContrast ?? 100}
          onDragStateChange={onDragStateChange}
        />
        <Slider
          defaultValue={0}
          label={t('editor.film.lights')}
          max={100}
          min={-100}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            onScalarChange(FilmAdjustment.FlimShoulder, -Number(e.target.value))
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
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            onScalarChange(FilmAdjustment.FlimToe, -Number(e.target.value))
          }
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
        title={t('editor.film.color')}
      >
        <div className="p-2 bg-bg-tertiary rounded-md mb-3">
          <div className="flex gap-2">
            <div className="w-1/2">
              <Slider
                label={t('adjustments.color.temperature')}
                max={100}
                min={-100}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  onScalarChange(ColorAdjustment.Temperature, Number(e.target.value))
                }
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
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  onScalarChange(ColorAdjustment.Tint, Number(e.target.value))
                }
                step={1}
                value={adjustments.tint ?? 0}
                trackClassName="tint-gradient-track"
                onDragStateChange={onDragStateChange}
              />
            </div>
          </div>
          <Slider
            defaultValue={0}
            label={t('editor.film.warmth')}
            max={100}
            min={-100}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onScalarChange(FilmAdjustment.FlimWarmth, Number(e.target.value))
            }
            step={1}
            value={adjustments.flimWarmth ?? 0}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            defaultValue={100}
            label={t('editor.film.saturation')}
            max={200}
            min={0}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onScalarChange(FilmAdjustment.FlimSaturation, Number(e.target.value))
            }
            step={1}
            value={adjustments.flimSaturation ?? 100}
            onDragStateChange={onDragStateChange}
          />
        </div>

        <div className="p-2 bg-bg-tertiary rounded-md mb-3">
          <Text variant={TextVariants.heading} className="mb-2">
            {t('adjustments.basic.toneMapper')}
          </Text>
          <Slider
            defaultValue={0}
            label={t('editor.film.hiTint')}
            max={100}
            min={-100}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onScalarChange(FilmAdjustment.FlimHiTint, Number(e.target.value))
            }
            step={1}
            value={adjustments.flimHiTint ?? 0}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            defaultValue={0}
            label={t('editor.film.shTint')}
            max={100}
            min={-100}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onScalarChange(FilmAdjustment.FlimShTint, Number(e.target.value))
            }
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
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onScalarChange(ColorAdjustment.Vibrance, Number(e.target.value))
            }
            step={1}
            value={adjustments.vibrance ?? 0}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            label={t('adjustments.color.saturation')}
            max={100}
            min={-100}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onScalarChange(ColorAdjustment.Saturation, Number(e.target.value))
            }
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
        <div className="p-2 bg-bg-tertiary rounded-md">
          <Text variant={TextVariants.heading} className="mb-2">
            {t('adjustments.effects.tone')}
          </Text>
          <Slider
            label={t('adjustments.basic.highlights')}
            max={100}
            min={-100}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onScalarChange(BasicAdjustment.Highlights, Number(e.target.value))
            }
            step={1}
            value={adjustments.highlights ?? 0}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            label={t('adjustments.basic.whites')}
            max={100}
            min={-100}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onScalarChange(BasicAdjustment.Whites, Number(e.target.value))
            }
            step={1}
            value={adjustments.whites ?? 0}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            label={t('adjustments.basic.shadows')}
            max={100}
            min={-100}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onScalarChange(BasicAdjustment.Shadows, Number(e.target.value))
            }
            step={1}
            value={adjustments.shadows ?? 0}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            label={t('adjustments.basic.blacks')}
            max={100}
            min={-100}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onScalarChange(BasicAdjustment.Blacks, Number(e.target.value))
            }
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
          adjustments={adjustments as Adjustments}
          setAdjustments={setDetailsAdjustments}
          appSettings={null}
          onDragStateChange={onDragStateChange}
        />
      </CollapsibleSection>

      <CollapsibleSection
        canToggleVisibility={false}
        isContentVisible={true}
        isOpen={effectsOpen}
        onToggle={() => setEffectsOpen((v) => !v)}
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
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onScalarChange(CreativeAdjustment.HalationAmount, Number(e.target.value))
            }
            step={1}
            value={adjustments.halationAmount ?? 0}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            label={t('adjustments.details.centre')}
            max={100}
            min={-100}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onScalarChange(DetailsAdjustment.Centré, Number(e.target.value))
            }
            step={1}
            value={adjustments.centré ?? 0}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            defaultValue={0}
            label={t('adjustments.effects.glow')}
            max={100}
            min={0}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onScalarChange(CreativeAdjustment.GlowAmount, Number(e.target.value))
            }
            step={1}
            value={adjustments.glowAmount ?? 0}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            defaultValue={0}
            label={t('editor.film.adjacency')}
            max={100}
            min={0}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onScalarChange(FilmAdjustment.FlimAdjacency, Number(e.target.value))
            }
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
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  onScalarChange(FilmAdjustment.FilmBlurPreAmount, Number(e.target.value))
                }
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
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  onScalarChange(FilmAdjustment.FilmBlurPreCompensation, Number(e.target.value))
                }
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
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  onScalarChange(FilmAdjustment.FilmBlurPreRadius, Number(e.target.value))
                }
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
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  onScalarChange(FilmAdjustment.FilmBlurPreSoftAmount, Number(e.target.value))
                }
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
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  onScalarChange(FilmAdjustment.FilmBlurPreSoftRadius, Number(e.target.value))
                }
                step={0.1}
                value={adjustments.filmBlurPreSoftRadius ?? 0.5}
                onDragStateChange={onDragStateChange}
              />
            </div>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        canToggleVisibility={false}
        isContentVisible={true}
        isOpen={vignetteOpen}
        onToggle={() => setVignetteOpen((v) => !v)}
        title={t('adjustments.effects.vignette')}
      >
        <div className="p-2 bg-bg-tertiary rounded-md">
          <Slider
            defaultValue={0}
            label={t('adjustments.effects.amount')}
            max={100}
            min={-100}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onScalarChange(Effect.VignetteAmount, Number(e.target.value))
            }
            step={1}
            value={adjustments.vignetteAmount ?? 0}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            defaultValue={50}
            label={t('adjustments.effects.midpoint')}
            max={100}
            min={0}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onScalarChange(Effect.VignetteMidpoint, Number(e.target.value))
            }
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
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onScalarChange(Effect.VignetteRoundness, Number(e.target.value))
            }
            step={1}
            value={adjustments.vignetteRoundness ?? 0}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            defaultValue={50}
            label={t('adjustments.effects.feather')}
            max={100}
            min={0}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onScalarChange(Effect.VignetteFeather, Number(e.target.value))
            }
            step={1}
            value={adjustments.vignetteFeather ?? 50}
            onDragStateChange={onDragStateChange}
            fillOrigin="min"
          />
        </div>
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
          setAdjustments={setCurveAdjustments}
          histogram={histogram ?? null}
          theme={theme ?? 'dark'}
          onDragStateChange={onDragStateChange}
        />
      </CollapsibleSection>
    </div>
  );
}
