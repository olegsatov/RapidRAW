import clsx from 'clsx';
import { Loader2, ImageOff } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useGestureStore } from '../../store/useGestureStore';

const THUMB_SIZE = 150;

const SCROLL_DURATION_MS = 350;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export default function LutStripOverlay() {
  const { lutStrip } = useGestureStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!containerRef.current || !lutStrip) return;
    const container = containerRef.current;
    const thumbTotal = THUMB_SIZE + 8; // thumb + gap
    const selectedTop = lutStrip.selectedIndex * thumbTotal;
    const selectedBottom = selectedTop + THUMB_SIZE;
    const padding = 20;

    let target = container.scrollTop;
    if (selectedTop < target + padding) {
      target = selectedTop - padding;
    } else if (selectedBottom > target + container.clientHeight - padding) {
      target = selectedBottom - container.clientHeight + padding;
    }

    const maxScroll = container.scrollHeight - container.clientHeight;
    target = Math.max(0, Math.min(target, maxScroll));

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }

    const startScroll = container.scrollTop;
    const startTime = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / SCROLL_DURATION_MS, 1);
      const eased = easeInOutCubic(progress);
      container.scrollTop = startScroll + (target - startScroll) * eased;
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [lutStrip?.selectedIndex, lutStrip?.entries.length]);

  if (!lutStrip || lutStrip.entries.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="absolute left-4 top-1/2 -translate-y-1/2 z-40 pointer-events-none flex flex-col gap-2 p-2 max-h-[calc(100%-48px)] overflow-y-auto bg-bg-secondary/25 backdrop-blur-sm rounded-lg shadow-lg border border-surface/40"
      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
    >
      {lutStrip.entries.map((entry, index) => {
        const isSelected = index === lutStrip.selectedIndex;
        const hasThumb = entry.thumb !== null;
        return (
          <div
            key={entry.path || '__no_lut__'}
            className={clsx(
              'relative shrink-0 rounded-md overflow-hidden bg-bg-tertiary border-2 transition-colors',
              isSelected ? 'border-accent' : 'border-transparent',
            )}
            style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
          >
            <div
              className={clsx(
                'absolute inset-0 flex items-center justify-center',
                !isSelected && hasThumb && 'opacity-60',
              )}
            >
              {lutStrip.isLoading && !hasThumb ? (
                <div className="w-full h-full flex items-center justify-center bg-surface">
                  <Loader2 size={24} className="animate-spin text-text-secondary" />
                </div>
              ) : hasThumb ? (
                <img src={entry.thumb!} alt={entry.name} className="w-full h-full object-cover" draggable={false} />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-text-secondary">
                  <ImageOff size={24} />
                </div>
              )}
            </div>

            <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-black/60 text-white text-[10px] font-medium text-center truncate">
              {entry.name}
            </div>
          </div>
        );
      })}
    </div>
  );
}
