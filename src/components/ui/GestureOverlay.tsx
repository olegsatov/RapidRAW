import clsx from 'clsx';
import { useGestureStore } from '../../store/useGestureStore';

const PANEL_SIZE = 140;

export default function GestureOverlay() {
  const { isActive, params } = useGestureStore();

  if (!isActive || params.length === 0) return null;

  return (
    <div
      className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-end gap-3 pointer-events-none z-40"
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
            className="bg-bg-secondary/90 backdrop-blur-sm rounded-lg p-3 shadow-lg border border-surface/50"
          >
            <div className="text-text-primary text-xs font-medium text-center mb-2">{panel.label}</div>
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
            <div className="flex justify-between mt-2 text-[10px] text-text-secondary tabular-nums">
              <span>
                {panel.axisLabels[0]}: {vertical.toFixed(vertical % 1 === 0 ? 0 : 1)}
              </span>
              <span>
                {panel.axisLabels[1]}: {horizontal.toFixed(horizontal % 1 === 0 ? 0 : 1)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
