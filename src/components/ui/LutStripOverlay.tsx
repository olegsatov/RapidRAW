import clsx from 'clsx';
import { Loader2, ImageOff } from 'lucide-react';
import { useGestureStore } from '../../store/useGestureStore';

const THUMB_SIZE = 200;

export default function LutStripOverlay() {
  const { lutStrip } = useGestureStore();

  if (!lutStrip || lutStrip.entries.length === 0) return null;

  return (
    <div className="absolute left-4 top-1/2 -translate-y-1/2 z-40 pointer-events-none max-h-[calc(100%-48px)] overflow-y-hidden">
      <div className="flex flex-col gap-2">
        {lutStrip.entries.map((entry, index) => {
          const isSelected = index === lutStrip.selectedIndex;
          return (
            <div
              key={entry.path}
              className={clsx(
                'relative shrink-0 rounded-md overflow-hidden bg-bg-tertiary border-2 transition-colors',
                isSelected ? 'border-accent' : 'border-transparent opacity-60',
              )}
              style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
            >
              {lutStrip.isLoading && entry.thumb === null ? (
                <div className="w-full h-full flex items-center justify-center bg-surface">
                  <Loader2 size={24} className="animate-spin text-text-secondary" />
                </div>
              ) : entry.thumb ? (
                <img src={entry.thumb} alt={entry.name} className="w-full h-full object-cover" draggable={false} />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-text-secondary gap-1">
                  <ImageOff size={24} />
                  <span className="text-[10px] px-2 text-center leading-tight">{entry.name}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
