import clsx from 'clsx';
import { useGestureStore } from '../../store/useGestureStore';

const PANEL_SIZE = 70;

export default function GestureOverlay() {
  const { isActive, params } = useGestureStore();

  if (!isActive || params.length === 0) return null;

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-wrap items-end justify-center gap-2 pointer-events-none z-40 max-w-full">
      {params.map((panel, index) => {
        const [vertical, horizontal] = panel.values;
        const [minV, minH] = panel.min;
        const [maxV, maxH] = panel.max;
        const [invertV, invertH] = panel.invert ?? [false, false];

        const leftRaw = maxH === minH ? 50 : ((horizontal - minH) / (maxH - minH)) * 100;
        const topRaw = maxV === minV ? 50 : 100 - ((vertical - minV) / (maxV - minV)) * 100;
        const left = invertH ? 100 - leftRaw : leftRaw;
        const top = invertV ? 100 - topRaw : topRaw;

        return (
          <div
            key={index}
            className="bg-bg-secondary/25 backdrop-blur-sm rounded-lg p-2 shadow-lg border border-surface/40"
          >
            <div
              className="relative bg-bg-primary/40 rounded border border-surface/40"
              style={{ width: PANEL_SIZE, height: PANEL_SIZE }}
            >
              {/* crosshair */}
              {panel.orientation !== 'vertical' && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-full h-px bg-text-secondary/20" />
                </div>
              )}
              {panel.orientation !== 'horizontal' && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="h-full w-px bg-text-secondary/20" />
                </div>
              )}

              {/* knob */}
              <div
                className="absolute w-3 h-3 rounded-full bg-accent border-2 border-white shadow-md"
                style={{ left: `${left}%`, top: `${top}%`, transform: 'translate(-50%, -50%)' }}
              />
            </div>
            <div className="text-text-primary/40 text-[10px] font-medium text-center mt-2">{panel.label}</div>
          </div>
        );
      })}
    </div>
  );
}
