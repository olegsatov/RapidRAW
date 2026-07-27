import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

import { DodgeBurnRenderer } from '../../../utils/dodgeBurnRenderer';
import { RenderSize } from '../../../hooks/useImageRenderSize';

export interface DodgeBurnLayerRef {
  paintBrush(x: number, y: number, size: number, feather: number, flow: number, mode: 'add' | 'erase'): void;
  commitMask(targetSize?: { width: number; height: number }): Promise<string | null>;
  loadMask(maskBitmap: string | null): Promise<void>;
  setOverlayVisible(visible: boolean): void;
  resetBrush(): void;
  getCanvas(): HTMLCanvasElement | null;
}

interface DodgeBurnLayerProps {
  baseUrl: string;
  effectUrl: string | null;
  maskBitmap: string | null;
  showOverlay: boolean;
  isActive: boolean;
  opacity?: number;
  imageRenderSize: RenderSize;
  originalSize?: { width: number; height: number };
}

const DodgeBurnLayer = forwardRef<DodgeBurnLayerRef, DodgeBurnLayerProps>(
  ({ baseUrl, effectUrl, maskBitmap, showOverlay, opacity = 1, imageRenderSize, originalSize }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rendererRef = useRef<DodgeBurnRenderer | null>(null);
    const initInFlightRef = useRef<Promise<void> | null>(null);
    const [rendererGeneration, setRendererGeneration] = useState(0);

    useImperativeHandle(
      ref,
      () => ({
        paintBrush: (x, y, size, feather, flow, mode) => {
          const renderer = rendererRef.current;
          if (!renderer) return;
          renderer.paintBrush(x, y, size, feather, flow, mode);
        },
        commitMask: async (targetSize) => {
          const renderer = rendererRef.current;
          if (!renderer) return null;
          const t0 = performance.now();
          const blob = await renderer.getMaskBlob(targetSize ?? originalSize);
          console.log('[perf] commitMask getMaskBlob total:', (performance.now() - t0).toFixed(1), 'ms');
          return new Promise<string | null>((resolve, reject) => {
            const reader = new FileReader();
            const t1 = performance.now();
            reader.onload = () => {
              console.log('[perf] commitMask FileReader readAsDataURL:', (performance.now() - t1).toFixed(1), 'ms');
              resolve(reader.result as string);
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
        },
        loadMask: async (maskBitmap) => {
          const renderer = rendererRef.current;
          if (!renderer) return;
          await renderer.loadMaskTexture(maskBitmap);
          renderer.render();
        },
        setOverlayVisible: (visible) => {
          const renderer = rendererRef.current;
          if (!renderer) return;
          renderer.setOverlayVisible(visible);
          renderer.render();
        },
        resetBrush: () => {
          const renderer = rendererRef.current;
          if (!renderer) return;
          renderer.resetBrushPosition();
        },
        getCanvas: () => canvasRef.current,
      }),
      [],
    );

    const prevBaseUrlRef = useRef(baseUrl);
    const prevEffectUrlRef = useRef(effectUrl);

    useEffect(() => {
      if (!canvasRef.current) return;

      let cancelled = false;

      const init = async () => {
        const renderer = new DodgeBurnRenderer(canvasRef.current!, baseUrl, effectUrl, null);
        await renderer.init();
        if (cancelled) {
          renderer.destroy();
          return;
        }
        renderer.resize(imageRenderSize.width, imageRenderSize.height);
        renderer.setOverlayVisible(showOverlay);
        renderer.render();
        rendererRef.current = renderer;
        setRendererGeneration((g) => g + 1);
        prevBaseUrlRef.current = baseUrl;
        prevEffectUrlRef.current = effectUrl;
      };

      const update = async () => {
        const renderer = rendererRef.current;
        if (!renderer) return;
        const updates: Promise<void>[] = [];
        if (baseUrl !== prevBaseUrlRef.current) {
          updates.push(renderer.updateBaseTexture(baseUrl));
        }
        if (effectUrl !== prevEffectUrlRef.current) {
          updates.push(renderer.updateEffectTexture(effectUrl));
        }
        if (updates.length > 0) {
          await Promise.all(updates);
          if (!cancelled) {
            renderer.render();
          }
        }
        prevBaseUrlRef.current = baseUrl;
        prevEffectUrlRef.current = effectUrl;
      };

      const promise = (rendererRef.current ? update() : init()).catch((error) => {
        console.error('[DodgeBurnLayer] WebGL update failed', error);
      });

      initInFlightRef.current = promise;

      return () => {
        cancelled = true;
      };
    }, [baseUrl, effectUrl]);

    useEffect(() => {
      const apply = async () => {
        if (initInFlightRef.current) {
          await initInFlightRef.current;
        }
        const renderer = rendererRef.current;
        if (!renderer) return;
        await renderer.loadMaskTexture(maskBitmap);
        renderer.render();
      };
      apply().catch((error) => {
        console.error('[DodgeBurnLayer] Failed to load mask texture', error);
      });
    }, [maskBitmap, rendererGeneration]);

    useEffect(() => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      renderer.setOverlayVisible(showOverlay);
      renderer.render();
    }, [showOverlay]);

    useEffect(() => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      renderer.setOpacity(opacity);
      renderer.render();
    }, [opacity]);

    useEffect(() => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      renderer.resize(imageRenderSize.width, imageRenderSize.height);
      renderer.render();
    }, [imageRenderSize.width, imageRenderSize.height]);

    useEffect(() => {
      return () => {
        rendererRef.current?.destroy();
        rendererRef.current = null;
        initInFlightRef.current = null;
      };
    }, []);

    if (!effectUrl) {
      return null;
    }

    return (
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          left: `${imageRenderSize.offsetX}px`,
          top: `${imageRenderSize.offsetY}px`,
          width: `${imageRenderSize.width}px`,
          height: `${imageRenderSize.height}px`,
          pointerEvents: 'none',
          touchAction: 'none',
          zIndex: 9,
        }}
      />
    );
  },
);

DodgeBurnLayer.displayName = 'DodgeBurnLayer';

export default DodgeBurnLayer;
