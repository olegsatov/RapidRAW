import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import Slider from '../ui/Slider';
import Text from '../ui/Text';
import { TextVariants } from '../../types/typography';
import Button from '../ui/Button';
import { Adjustments, BwAdjustment, INITIAL_ADJUSTMENTS } from '../../utils/adjustments';
import { Invokes } from '../ui/AppProperties';
import { useEditorStore } from '../../store/useEditorStore';

interface BlackAndWhitePanelProps {
  adjustments: Adjustments;
  setAdjustments(adjustments: Partial<Adjustments>): any;
  onDragStateChange?: (isDragging: boolean) => void;
}

// Black & white conversion via per-channel luminance weights (channel mixer).
// Defaults are Rec.709 (21/72/7); the Auto button asks the backend for
// image-derived weights.
export default function BlackAndWhitePanel({
  adjustments,
  setAdjustments,
  onDragStateChange,
}: BlackAndWhitePanelProps) {
  const { t } = useTranslation();
  const selectedImage = useEditorStore((s: any) => s.selectedImage);
  const [autoLoading, setAutoLoading] = useState(false);

  const handleAdjustmentChange = (key: string, value: string) => {
    const numericValue = parseInt(value, 10);
    setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, [key]: numericValue }));
  };

  const handleAuto = async () => {
    if (!selectedImage?.isReady || autoLoading) return;
    setAutoLoading(true);
    try {
      const weights = await invoke<{ bwRed: number; bwGreen: number; bwBlue: number }>(Invokes.ComputeBwWeights, {
        jsAdjustments: adjustments,
      });
      setAdjustments((prev: Partial<Adjustments>) => ({
        ...prev,
        bwRed: Math.round(weights.bwRed ?? INITIAL_ADJUSTMENTS.bwRed),
        bwGreen: Math.round(weights.bwGreen ?? INITIAL_ADJUSTMENTS.bwGreen),
        bwBlue: Math.round(weights.bwBlue ?? INITIAL_ADJUSTMENTS.bwBlue),
      }));
    } catch (e) {
      console.error('compute_bw_weights failed:', e);
    } finally {
      setAutoLoading(false);
    }
  };

  return (
    <div className="p-2 bg-bg-tertiary rounded-md">
      <Text variant={TextVariants.heading} className="mb-2">
        {t('adjustments.blackAndWhite.mixer')}
      </Text>
      <Slider
        defaultValue={21}
        label={t('adjustments.blackAndWhite.red')}
        max={100}
        min={0}
        onChange={(e: any) => handleAdjustmentChange(BwAdjustment.BwRed, e.target.value)}
        step={1}
        value={adjustments.bwRed}
        onDragStateChange={onDragStateChange}
        fillOrigin="min"
      />
      <Slider
        defaultValue={72}
        label={t('adjustments.blackAndWhite.green')}
        max={100}
        min={0}
        onChange={(e: any) => handleAdjustmentChange(BwAdjustment.BwGreen, e.target.value)}
        step={1}
        value={adjustments.bwGreen}
        onDragStateChange={onDragStateChange}
        fillOrigin="min"
      />
      <Slider
        defaultValue={7}
        label={t('adjustments.blackAndWhite.blue')}
        max={100}
        min={0}
        onChange={(e: any) => handleAdjustmentChange(BwAdjustment.BwBlue, e.target.value)}
        step={1}
        value={adjustments.bwBlue}
        onDragStateChange={onDragStateChange}
        fillOrigin="min"
      />
      <Button onClick={handleAuto} disabled={autoLoading || !selectedImage?.isReady} className="w-full bg-surface mt-2">
        {t('adjustments.blackAndWhite.auto')}
      </Button>
    </div>
  );
}
