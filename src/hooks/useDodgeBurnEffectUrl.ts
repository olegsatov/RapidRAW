import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import debounce from 'lodash.debounce';

import { useEditorStore } from '../store/useEditorStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { Invokes } from '../components/ui/AppProperties';
import { Mask, SubMask } from '../components/panel/right/Masks';
import { Adjustments } from '../utils/adjustments';
import { DodgeBurnAdjustments, ScalarDodgeBurnKey, getDefaultDodgeBurnAdjustments } from '../types/dodgeBurn';

const CURVE_KEYS: Array<keyof DodgeBurnAdjustments> = ['curves', 'pointCurves', 'parametricCurve', 'curveMode'];

function buildEffectAdjustments(global: Adjustments, delta: DodgeBurnAdjustments): Adjustments {
  const result = structuredClone(global) as Adjustments;
  const defaults = getDefaultDodgeBurnAdjustments();

  const scalarKeys = (Object.keys(defaults) as Array<keyof DodgeBurnAdjustments>).filter((key) => {
    const value = defaults[key];
    return typeof value === 'number' && !CURVE_KEYS.includes(key);
  }) as ScalarDodgeBurnKey[];

  const typedGlobal = global as unknown as DodgeBurnAdjustments;
  const typedResult = result as unknown as DodgeBurnAdjustments;
  const scalarResult = typedResult as Record<ScalarDodgeBurnKey, number>;

  for (const key of scalarKeys) {
    const globalValue = typedGlobal[key] ?? defaults[key];
    const deltaValue = delta[key] ?? defaults[key];
    let effectValue: number;

    if (key === 'flimContrast' || key === 'flimSaturation') {
      // Percentage-centered keys: 100 is the neutral point.
      effectValue = (globalValue as number) * ((deltaValue as number) / 100);
    } else {
      // Treat the stored value as an absolute mask value; apply the offset from default.
      effectValue = (globalValue as number) + ((deltaValue as number) - (defaults[key] as number));
    }

    scalarResult[key] = effectValue;
  }

  const curveResult = typedResult as Record<(typeof CURVE_KEYS)[number], unknown>;

  for (const key of CURVE_KEYS) {
    const deltaValue = delta[key];
    if (deltaValue !== undefined && JSON.stringify(deltaValue) !== JSON.stringify(defaults[key])) {
      curveResult[key] = structuredClone(deltaValue);
    }
  }

  return result;
}

/**
 * The dodge/burn effect plane must be a full-frame render of the image with the
 * tool's adjustments applied everywhere. If the target sub-mask is left visible
 * in the payload, the backend would modulate the same adjustment by the brush
 * mask while rendering the plane; the compositor then applies the mask again,
 * doubling the effect compared to the Film tab.
 */
function hideTargetDodgeBurnMask(source: Adjustments, targetId: string | undefined): Adjustments {
  if (!targetId || !source.masks) return source;
  const cloned = structuredClone(source) as Adjustments;
  for (const container of cloned.masks) {
    if (!container.subMasks) continue;
    const idx = container.subMasks.findIndex((sm: SubMask) => sm.id === targetId && sm.type === Mask.DodgeBurn);
    if (idx !== -1) {
      // Hidden while rendering the effect plane: maskBitmap/opacity are consumed
      // by the overlay compositor, not by the backend render of the plane.
      container.subMasks[idx] = {
        ...container.subMasks[idx],
        visible: false,
        opacity: 0,
        parameters: { ...container.subMasks[idx].parameters, maskBitmap: null },
      };
      break;
    }
  }
  return cloned;
}

export function useDodgeBurnEffectUrl(activeSubMask: SubMask | null, adjustments: Adjustments) {
  const [effectUrl, setEffectUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const selectedImage = useEditorStore((s) => s.selectedImage);
  const previewResolution = useSettingsStore((s) => s.appSettings?.editorPreviewResolution) ?? 1920;

  const requestIdRef = useRef(0);
  const currentUrlRef = useRef<string | null>(null);

  const isActive = activeSubMask?.type === Mask.DodgeBurn;
  const delta = activeSubMask?.parameters?.adjustments as DodgeBurnAdjustments | undefined;
  const lastPayloadSigRef = useRef<string | null>(null);

  const effectAdjustments = useMemo(() => {
    if (!isActive || !delta) return null;
    const sourceAdjustments = hideTargetDodgeBurnMask(adjustments, activeSubMask?.id);
    return buildEffectAdjustments(sourceAdjustments, delta);
  }, [isActive, delta, adjustments, activeSubMask?.id]);

  const generate = useMemo(
    () =>
      debounce(async (payload: Adjustments, targetRes: number, sig: string) => {
        if (!selectedImage?.isReady) return;
        if (sig === lastPayloadSigRef.current) return;
        lastPayloadSigRef.current = sig;

        const requestId = ++requestIdRef.current;
        setIsLoading(true);

        try {
          const buffer: ArrayBuffer = await invoke(Invokes.ApplyAdjustments, {
            jsAdjustments: payload,
            isInteractive: false,
            targetResolution: targetRes,
            roi: null,
            grainMipLevel: null,
            computeWaveform: false,
            activeWaveformChannel: null,
            forceSoftwareRender: true,
          });

          if (requestId !== requestIdRef.current) return;

          if (buffer && buffer.byteLength > 0) {
            const prefix = new TextDecoder().decode(buffer.slice(0, 11));
            if (prefix === 'WGPU_RENDER') return;

            const blob = new Blob([buffer], { type: 'image/jpeg' });
            const url = URL.createObjectURL(blob);
            const prevUrl = currentUrlRef.current;
            currentUrlRef.current = url;
            if (prevUrl) URL.revokeObjectURL(prevUrl);
            setEffectUrl(url);
          }
        } catch (err) {
          if (err !== 'Superseded or worker failed') {
            console.error('[useDodgeBurnEffectUrl] Failed to render effect plane:', err);
          }
        } finally {
          if (requestId === requestIdRef.current) {
            setIsLoading(false);
          }
        }
      }, 150),
    [selectedImage?.isReady],
  );

  useEffect(() => {
    if (!effectAdjustments) {
      if (currentUrlRef.current) {
        URL.revokeObjectURL(currentUrlRef.current);
        currentUrlRef.current = null;
      }
      setEffectUrl(null);
      setIsLoading(false);
      return;
    }

    const payloadSig = JSON.stringify(effectAdjustments);
    generate(effectAdjustments, previewResolution, payloadSig);

    return () => {
      generate.cancel();
    };
  }, [effectAdjustments, previewResolution, generate]);

  useEffect(() => {
    return () => {
      if (currentUrlRef.current) {
        URL.revokeObjectURL(currentUrlRef.current);
        currentUrlRef.current = null;
      }
    };
  }, []);

  return { effectUrl, isLoading };
}

export default useDodgeBurnEffectUrl;
