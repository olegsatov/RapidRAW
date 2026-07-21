import clsx from 'clsx';
import { useGestureStore } from '../../store/useGestureStore';

const PANEL_SIZE = 70;

export default function GestureOverlay() {
  const { isActive, params } = useGestureStore();

  if (!isActive || params.length === 0) return null;

  return (
    <div
      className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-end gap-2 pointer-events-none z-40"
      style={{ maxWidth: '100%' }}
    >
      {params.map((panel, index) => {
        const [vertical, horizontal] = panel.values;
        const [minV, minH] = panel.min;
        const [maxV, maxH] = panel.max;

        const left = maxH === minH ? 50 : ((horizontal - minH) / (maxH - minH)) * 100;
        const bottom = maxV === minV ? 50 : ((vertical - minV) / (maxV - minV)) * 100;

        return (
          <div
            key={index}
            className="bg-bg-secondary/70 backdrop-blur-sm rounded-lg p-2 shadow-lg border border-surface/50"
          >
            <div
              className="relative bg-bg-primary/50 rounded border border-surface/50"
              style={{ width: PANEL_SIZE, height: PANEL_SIZE }}
            >
              {/* crosshair */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-full h-px bg-text-secondary/30" />
              </div>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-full w-px bg-text-secondary/30" />
              </div>

              {/* knob */}
              <div
                className={clsx(
                  'absolute w-3 h-3 rounded-full bg-accent border-2 border-white shadow-md',
                  'transform -translate-x-1/2 -translate-y-1/2',
                )}
                style={{ left: `${left}%`, bottom: `${bottom}%` }}
              />
            </div>
            <div className="text-text-primary text-[10px] font-medium text-center mt-2">{panel.label}</div>
          </div>
        );
      })}
    </div>
  );
}
