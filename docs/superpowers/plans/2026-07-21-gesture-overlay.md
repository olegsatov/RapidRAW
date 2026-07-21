# Gesture Overlay для жестовой настройки (клавиша A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить встроенный визуальный оверлей под изображением, который появляется при удержании клавиши **A** и показывает два перекрестия: баланс белого (`temperature`/`tint`) и теплота/насыщенность (`flimWarmth`/`flimSaturation`).

**Architecture:** Новый Zustand-стор `useGestureStore` хранит состояние активной сессии оверлея. Хук `useGestureAdjust` заполняет и обновляет это состояние при старте/изменении/завершении жеста. Компонент `GestureOverlay` читает стор и рисует панели поверх канваса в `Editor.tsx`.

**Tech Stack:** React, TypeScript, Tailwind CSS, Zustand, clsx.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/store/useGestureStore.ts` | Новый стор: состояние оверлея + actions для старта/обновления/сброса. |
| `src/hooks/useGestureAdjust.ts` | Модифицируется: заполняет стор при старте сессии, обновляет значения при `applyDelta`, сбрасывает при `endSession`. |
| `src/components/ui/GestureOverlay.tsx` | Новый компонент: отрисовывает две панели с перекрестиями и ползунками. |
| `src/components/panel/Editor.tsx` | Модифицируется: встраивает `<GestureOverlay />` внутрь контейнера изображения. |

---

### Task 1: Create `useGestureStore.ts`

**Files:**
- Create: `src/store/useGestureStore.ts`

- [ ] **Step 1: Write the store**

```ts
import { create } from 'zustand';

export interface GestureOverlayParam {
  label: string;
  axisLabels: [string, string];
  values: [number, number];
  min: [number, number];
  max: [number, number];
}

interface GestureOverlayState {
  action: string | null;
  isActive: boolean;
  params: GestureOverlayParam[];
}

interface GestureOverlayActions {
  startOverlay: (action: string, params: GestureOverlayParam[]) => void;
  setParams: (params: GestureOverlayParam[]) => void;
  endOverlay: () => void;
}

export const useGestureStore = create<GestureOverlayState & GestureOverlayActions>((set) => ({
  action: null,
  isActive: false,
  params: [],

  startOverlay: (action, params) => set({ action, isActive: true, params }),

  setParams: (params) => set({ params }),

  endOverlay: () => set({ action: null, isActive: false, params: [] }),
}));
```

- [ ] **Step 2: Verify TypeScript compiles for the new file**

Run: `npx tsc --noEmit src/store/useGestureStore.ts`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/store/useGestureStore.ts
git commit -m "add gesture overlay store"
```

---

### Task 2: Update `useGestureAdjust.ts` to drive the overlay

**Files:**
- Modify: `src/hooks/useGestureAdjust.ts`

- [ ] **Step 1: Import the store and `Adjustments` type**

Add at the top of `src/hooks/useGestureAdjust.ts`:

```ts
import { useGestureStore, GestureOverlayParam } from '../store/useGestureStore';
import { Adjustments } from '../utils/adjustments';
```

- [ ] **Step 2: Extend `GestureSession` with overlay params**

Add one field to the existing `GestureSession` interface:

```ts
interface GestureSession {
  binding: GestureBinding;
  moveLock: AxisLock;
  moveAccX: ContinuousAccumulator;
  moveAccY: ContinuousAccumulator;
  scrollLock: AxisLock;
  trackpadScrollLock: AxisLock;
  scrollStepAccX: StepAccumulator;
  scrollStepAccY: StepAccumulator;
  scrollContAccX: ContinuousAccumulator;
  scrollContAccY: ContinuousAccumulator;
  gestureKey: string;
  overlayParams: GestureOverlayParam[]; // NEW
}
```

- [ ] **Step 3: Build overlay params in `startSession`**

Inside `startSession`, after creating the session object and before `setEditor({ isSliderDragging: true })`, add:

```ts
const adjustments = useEditorStore.getState().adjustments;

const buildOverlayParams = (): GestureOverlayParam[] => {
  if (action === 'gesture_color_balance') {
    return [
      {
        label: 'Color Balance',
        axisLabels: ['temperature', 'tint'],
        values: [adjustments.temperature, adjustments.tint],
        min: [binding.move[0].min, binding.move[1].min],
        max: [binding.move[0].max, binding.move[1].max],
      },
      {
        label: 'Warmth / Saturation',
        axisLabels: ['flimWarmth', 'flimSaturation'],
        values: [adjustments.flimWarmth, adjustments.flimSaturation],
        min: [binding.scroll[0].min, binding.scroll[1].min],
        max: [binding.scroll[0].max, binding.scroll[1].max],
      },
    ];
  }
  return [];
};

const overlayParams = buildOverlayParams();
useGestureStore.getState().startOverlay(action, overlayParams);
```

Also set `overlayParams` on the session object:

```ts
sessionRef.current = {
  binding,
  moveLock: new AxisLock(MOVE_AXIS_LOCK),
  moveAccX: new ContinuousAccumulator(MOUSE_MOVE_STEP.stepX / binding.move[1].step, 0.4, binding.move[1].step),
  moveAccY: new ContinuousAccumulator(MOUSE_MOVE_STEP.stepY / binding.move[0].step, 0.4, binding.move[0].step),
  scrollLock: new AxisLock(SCROLL_AXIS_LOCK, true),
  trackpadScrollLock: new AxisLock(TRACKPAD_SCROLL_AXIS_LOCK),
  scrollStepAccX: new StepAccumulator(MOUSE_SCROLL_STEP),
  scrollStepAccY: new StepAccumulator(MOUSE_SCROLL_STEP),
  scrollContAccX: new ContinuousAccumulator(
    TRACKPAD_SCROLL_STEP / binding.scroll[1].step,
    0.6,
    binding.scroll[1].step,
  ),
  scrollContAccY: new ContinuousAccumulator(
    TRACKPAD_SCROLL_STEP / binding.scroll[0].step,
    0.6,
    binding.scroll[0].step,
  ),
  gestureKey,
  overlayParams, // NEW
};
```

- [ ] **Step 4: Update overlay values after each delta**

Replace the existing `applyDelta` function with:

```ts
const applyDelta = (param: GestureParam, rawDelta: number) => {
  if (rawDelta === 0) return;
  setAdjustments((prev) => {
    const next = { ...prev, [param.key]: clamp(prev[param.key] + rawDelta, param.min, param.max) };
    updateOverlayValues(next);
    return next;
  });
};

const updateOverlayValues = (adjustments: Adjustments) => {
  const session = sessionRef.current;
  if (!session || session.overlayParams.length === 0) return;

  useGestureStore.getState().setParams(
    session.overlayParams.map((panel) => ({
      ...panel,
      values: [
        clamp(adjustments[panel.axisLabels[0]], panel.min[0], panel.max[0]),
        clamp(adjustments[panel.axisLabels[1]], panel.min[1], panel.max[1]),
      ] as [number, number],
    })),
  );
};
```

- [ ] **Step 5: Reset overlay on session end**

Inside `endSession`, before or after the existing reset logic, add:

```ts
useGestureStore.getState().endOverlay();
```

- [ ] **Step 6: Verify TypeScript**

Run: `npx tsc --noEmit src/hooks/useGestureAdjust.ts`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useGestureAdjust.ts
git commit -m "drive gesture overlay state from useGestureAdjust"
```

---

### Task 3: Create `GestureOverlay.tsx`

**Files:**
- Create: `src/components/ui/GestureOverlay.tsx`

- [ ] **Step 1: Implement the component**

```tsx
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
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit src/components/ui/GestureOverlay.tsx`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/GestureOverlay.tsx
git commit -m "add gesture overlay component"
```

---

### Task 4: Embed `GestureOverlay` into `Editor.tsx`

**Files:**
- Modify: `src/components/panel/Editor.tsx`

- [ ] **Step 1: Import the component**

Add near the other imports at the top of `src/components/panel/Editor.tsx`:

```ts
import GestureOverlay from '../ui/GestureOverlay';
```

- [ ] **Step 2: Place the overlay inside the image container**

Find the `imageContainerRef` div (around line 2069). Inside it, after the closing `</div>` of `contentRef` / `ImageCanvas` (around line 2162), add:

```tsx
        <GestureOverlay />
```

The surrounding structure should look like:

```tsx
      <div
        className={clsx(
          'flex-1 relative overflow-hidden touch-none',
          ...
        )}
        ...
      >
        {showSpinner && (...)}

        <div ref={contentRef} ...>
          <ImageCanvas ... />
        </div>

        <GestureOverlay />
      </div>
```

- [ ] **Step 3: Verify TypeScript**

Run: `npx tsc --noEmit src/components/panel/Editor.tsx`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/components/panel/Editor.tsx
git commit -m "embed gesture overlay into editor canvas area"
```

---

### Task 5: Run verification checks

**Files:**
- All modified files.

- [ ] **Step 1: Check formatting**

Run: `npx prettier --check src/store/useGestureStore.ts src/hooks/useGestureAdjust.ts src/components/ui/GestureOverlay.tsx src/components/panel/Editor.tsx`
Expected: `All matched files use Prettier code style!`

If failures appear, run:
```bash
npx prettier --write src/store/useGestureStore.ts src/hooks/useGestureAdjust.ts src/components/ui/GestureOverlay.tsx src/components/panel/Editor.tsx
```

- [ ] **Step 2: Build the frontend**

Run: `npm run build`
Expected: completes without new TypeScript errors (the repo has a pre-existing `tsc` baseline; ignore only pre-existing errors).

- [ ] **Step 3: Check Rust side**

Run in `src-tauri/`:
```bash
cargo check
```
Expected: no new errors.

- [ ] **Step 4: Commit any formatting fixes**

```bash
git add -A
git commit -m "format gesture overlay changes"
```

---

### Task 6: Manual smoke test checklist

**Files:**
- Application runtime.

- [ ] **Step 1: Open an image in the editor and switch tone mapper to `flim`**

- [ ] **Step 2: Hold `A` for >150 ms**

Expected: overlay appears centered below the image with two panels.

- [ ] **Step 3: Move mouse horizontally / vertically**

Expected: left panel knob moves, numbers update in real time, image preview changes.

- [ ] **Step 4: Scroll with two fingers**

Expected: right panel knob moves, `flimWarmth` / `flimSaturation` numbers update.

- [ ] **Step 5: Release `A`**

Expected: overlay disappears immediately.

- [ ] **Step 6: Short tap `A`**

Expected: overlay does NOT appear; default keybind behavior works.

---

## Self-Review

- **Spec coverage:** каждый пункт спецификации (отдельный стор, обновления из `useGestureAdjust`, компонент, встраивание, стили, поведение, тестирование) покрыт отдельной задачей.
- **Placeholder scan:** нет `TBD`, `TODO`, отложенных деталей.
- **Type consistency:** `GestureOverlayParam` определён один раз в `useGestureStore.ts` и используется в `useGestureAdjust.ts`; имена полей (`axisLabels`, `values`, `min`, `max`) совпадают.
- **Upstream delta:** изменения в `useGestureAdjust.ts` и `Editor.tsx` минимальны и не затрагивают существующую логику, кроме необходимых hook-ins.
