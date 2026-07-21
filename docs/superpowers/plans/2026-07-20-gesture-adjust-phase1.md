# Gesture Adjust Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Holding a key (default «A») in the editor turns mouse movement into temperature/tint adjustment and scroll into flimWarmth/flimSaturation adjustment, porting BetterSpeedEdit's gesture math.

**Architecture:** Pure TS gesture engine (`src/utils/gestureEngine.ts`, ported from BetterSpeedEdit's MouseInterpreter/EventEngine) + declarative binding table (`src/utils/gestureBindings.ts`) + self-contained session hook (`src/hooks/useGestureAdjust.ts`) using window-level capture-phase listeners and the Pointer Lock API. No Rust changes, no Editor.tsx changes, no new dependencies.

**Tech Stack:** React 18 + zustand + Tauri (existing), tests as a standalone script run via `npx -y tsx` (repo has no test runner — do NOT add one).

**Spec:** `docs/superpowers/specs/2026-07-20-gesture-adjust-phase1-design.md`

**Key facts established during research (do not re-verify):**

- No test runner in `package.json`; verification gate is `npm run build`.
- `KeyA` is already the default for `toggle_analytics` (`src/utils/keyboardUtils.ts:220`). The gesture hook uses **capture-phase** window listeners + a 150 ms tap-vs-hold delay (ported from BetterSpeedEdit's `swallowDelay`): a short tap of `A` is re-dispatched as a synthetic keydown/keyup so `toggle_analytics` still fires; holding `A` starts the gesture session. When `toneMapper !== 'flim'` the gesture session cannot start, so the synthetic tap still toggles analytics.
- `setAdjustments` signature: `setAdjustments(value: Partial<Adjustments> | ((prev: Adjustments) => Adjustments))` from `useEditorActions()` (`src/hooks/useEditorActions.ts:41`).
- `setEditor` from `useEditorStore` accepts `Partial<EditorState>`; `isSliderDragging: boolean` exists (`src/store/useEditorStore.ts:48,87,158`).
- Keybind lookup: `KEYBIND_DEFINITIONS` + `getEffectiveKeybind(userCombo, defaultCombo)` + `normalizeCombo(event, osPlatform)` in `src/utils/keyboardUtils.ts:329-349,381-386`. Single-key combos normalize to `'KeyA'`-style codes.
- New `KEYBIND_DEFINITIONS` entries appear in SettingsPanel automatically (`src/components/panel/SettingsPanel.tsx:2502`).
- i18n: `settings.keybinds.actions.<action>` in `src/i18n/locales/*.json`; missing translations fall back to English.
- `Adjustments` fields (`src/utils/adjustments.ts`): `temperature: number` (def 0, :591), `tint: number` (def 0, :592), `flimWarmth: number` (def 0, :775), `flimSaturation: number` (def 100, :776), `toneMapper: 'agx' | 'basic' | 'flim'` (:335, def 'flim').
- Modal/input guards to replicate: `src/hooks/useKeyboardShortcuts.ts:590-611`.
- EditorView hook mount point: between lines 141 and 143 in `src/components/views/EditorView.tsx` (after store hooks, before `editorNode`).

---

### Task 1: Gesture engine core (`src/utils/gestureEngine.ts`) + tests

Pure math, no DOM. Port of BetterSpeedEdit `MouseInterpreter.swift:63-111` and `EventEngine.swift:659-698,847-866`.

**Files:**

- Create: `src/utils/gestureEngine.ts`
- Test: `scratch/gesture-engine.test.ts`

- [ ] **Step 1: Write the failing test**

Create `scratch/gesture-engine.test.ts`:

```ts
import assert from 'node:assert';
import {
  AxisLock,
  StepAccumulator,
  quantizeMouseWheel,
  detectWheelDevice,
  MOVE_AXIS_LOCK,
  SCROLL_AXIS_LOCK,
} from '../src/utils/gestureEngine';

// --- StepAccumulator: fractional carry-over ---
{
  const acc = new StepAccumulator(6);
  assert.strictEqual(acc.push(2), 0);
  assert.strictEqual(acc.push(2), 0);
  assert.strictEqual(acc.push(2), 1); // 6 accumulated -> 1 step, remainder 0
  assert.strictEqual(acc.push(-7), -1); // -7 -> -1 step, remainder -1
  assert.strictEqual(acc.push(-5), -1); // -6 total -> -1 more step
  acc.reset();
  assert.strictEqual(acc.push(6), 1);
}

// --- quantizeMouseWheel ---
assert.strictEqual(quantizeMouseWheel(120), 1);
assert.strictEqual(quantizeMouseWheel(-53), -1);
assert.strictEqual(quantizeMouseWheel(0), 0);

// --- AxisLock: pure horizontal movement locks to horizontal ---
{
  const lock = new AxisLock(MOVE_AXIS_LOCK);
  let locked = 'none';
  for (let i = 0; i < 5; i++) locked = lock.push(6, 0.2);
  assert.strictEqual(locked, 'horizontal');
}

// --- AxisLock: diagonal movement escalates to 'both' ---
{
  const lock = new AxisLock(MOVE_AXIS_LOCK);
  let locked = 'none';
  for (let i = 0; i < 5; i++) locked = lock.push(5, 5);
  assert.strictEqual(locked, 'both');
}

// --- AxisLock: scroll lock resets on idle deltas ---
{
  const lock = new AxisLock(SCROLL_AXIS_LOCK, true);
  for (let i = 0; i < 5; i++) lock.push(0, 10);
  assert.strictEqual(lock.locked, 'vertical');
  lock.push(0, 0);
  assert.strictEqual(lock.locked, 'none');
}

// --- detectWheelDevice ---
assert.strictEqual(detectWheelDevice({ deltaY: 120, deltaMode: 0 } as WheelEvent), 'mouse');
assert.strictEqual(detectWheelDevice({ deltaY: 3, deltaMode: 1 } as WheelEvent), 'mouse');
assert.strictEqual(detectWheelDevice({ deltaY: 4.5, deltaMode: 0 } as WheelEvent), 'trackpad');
assert.strictEqual(detectWheelDevice({ deltaY: 12, deltaMode: 0 } as WheelEvent), 'trackpad');

console.log('gestureEngine tests: ALL PASS');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx -y tsx scratch/gesture-engine.test.ts`
Expected: FAIL — module `../src/utils/gestureEngine` not found.

- [ ] **Step 3: Implement `src/utils/gestureEngine.ts`**

```ts
// Pure gesture math ported from BetterSpeedEdit (Sources/MouseToKeys/
// MouseInterpreter.swift and EventEngine.swift). No DOM dependencies.
// Sensitivity = step size in px/points per one parameter step; there are no
// acceleration curves in the original and none here.

export interface AxisLockConfig {
  windowSize: number; // sliding window of recent deltas
  axisThreshold: number; // min |sum| to lock an axis
  diagRatio: number; // |other| >= |main| * diagRatio escalates to 'both'
  bothFactor: number; // extra multiplier on axisThreshold for 'both' (1.5 mouse, 1 scroll)
}

// Defaults from BetterSpeedEdit shipped settings.json
export const MOVE_AXIS_LOCK: AxisLockConfig = { windowSize: 5, axisThreshold: 1.5, diagRatio: 0.5, bothFactor: 1.5 };
export const SCROLL_AXIS_LOCK: AxisLockConfig = { windowSize: 5, axisThreshold: 8, diagRatio: 0.5, bothFactor: 1 };

export const MOUSE_MOVE_STEP = { stepX: 6, stepY: 6 }; // px per param step
export const MOUSE_SCROLL_STEP = 6; // per param step (mouse wheel is quantized to ±1 first)
export const TRACKPAD_SCROLL_STEP = 2.5; // points per param step

export type LockedAxes = 'none' | 'horizontal' | 'vertical' | 'both';

export class AxisLock {
  locked: LockedAxes = 'none';
  private xs: number[] = [];
  private ys: number[] = [];

  constructor(
    private cfg: AxisLockConfig,
    private idleReset = false, // scroll variant: unlock when deltas go idle
  ) {}

  push(dx: number, dy: number): LockedAxes {
    if (this.idleReset && Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) {
      this.locked = 'none';
    }
    this.xs.push(dx);
    this.ys.push(dy);
    if (this.xs.length > this.cfg.windowSize) this.xs.shift();
    if (this.ys.length > this.cfg.windowSize) this.ys.shift();
    const sumX = this.xs.reduce((a, b) => a + b, 0);
    const sumY = this.ys.reduce((a, b) => a + b, 0);
    const ax = Math.abs(sumX);
    const ay = Math.abs(sumY);
    const t = this.cfg.axisThreshold;

    if (this.locked === 'none') {
      if (ax > ay && ax > t) this.locked = 'horizontal';
      else if (ay > ax && ay > t) this.locked = 'vertical';
    } else if (this.locked === 'horizontal') {
      if (ay >= ax * this.cfg.diagRatio && ay > t * this.cfg.bothFactor) this.locked = 'both';
    } else if (this.locked === 'vertical') {
      if (ax >= ay * this.cfg.diagRatio && ax > t * this.cfg.bothFactor) this.locked = 'both';
    }
    return this.locked;
  }

  reset(): void {
    this.locked = 'none';
    this.xs = [];
    this.ys = [];
  }
}

// Accumulates fractional deltas, emits signed whole steps, keeps the remainder.
export class StepAccumulator {
  private acc = 0;

  constructor(private step: number) {}

  push(delta: number): number {
    this.acc += delta;
    let steps = 0;
    while (this.acc >= this.step) {
      this.acc -= this.step;
      steps++;
    }
    while (this.acc <= -this.step) {
      this.acc += this.step;
      steps--;
    }
    return steps;
  }

  reset(): void {
    this.acc = 0;
  }
}

// Mouse wheel: each notch is exactly one step regardless of magnitude.
export function quantizeMouseWheel(d: number): number {
  return d === 0 ? 0 : d > 0 ? 1 : -1;
}

// Web heuristic for BetterSpeedEdit's `isContinuous` (OS-level on macOS):
// line-mode deltas are always a mouse; large round pixel deltas are a mouse
// wheel notch; small or fractional pixel deltas are a trackpad.
export function detectWheelDevice(e: Pick<WheelEvent, 'deltaY' | 'deltaMode'>): 'mouse' | 'trackpad' {
  if (e.deltaMode !== 0) return 'mouse';
  if (Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 100) return 'mouse';
  return 'trackpad';
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx -y tsx scratch/gesture-engine.test.ts`
Expected: `gestureEngine tests: ALL PASS`

- [ ] **Step 5: Prettier + commit**

Run: `npx prettier --write src/utils/gestureEngine.ts scratch/gesture-engine.test.ts`

```bash
git add src/utils/gestureEngine.ts scratch/gesture-engine.test.ts
git commit -m "add gesture engine core (axis lock, step accumulator, device detection)"
```

---

### Task 2: Binding table (`src/utils/gestureBindings.ts`)

**Files:**

- Create: `src/utils/gestureBindings.ts`

- [ ] **Step 1: Write the module**

```ts
// Declarative gesture bindings. Ranges/steps duplicate FilmPanel values for the
// 4 phase-1 params on purpose (FilmPanel stays untouched to keep the upstream
// delta small); extract a shared range table when more bindings are added.

export interface GestureParam {
  key: 'temperature' | 'tint' | 'flimWarmth' | 'flimSaturation';
  min: number;
  max: number;
  step: number; // param units per one engine step
}

export interface GestureBinding {
  action: string; // keybind action id in KEYBIND_DEFINITIONS
  move: [GestureParam, GestureParam]; // [vertical, horizontal]
  scroll: [GestureParam, GestureParam]; // [vertical, horizontal]
}

export const GESTURE_BINDINGS: GestureBinding[] = [
  {
    action: 'gesture_color_balance',
    move: [
      { key: 'temperature', min: -100, max: 100, step: 1 },
      { key: 'tint', min: -100, max: 100, step: 1 },
    ],
    scroll: [
      { key: 'flimWarmth', min: -100, max: 100, step: 1 },
      { key: 'flimSaturation', min: 0, max: 200, step: 1 },
    ],
  },
];
```

- [ ] **Step 2: Typecheck + prettier + commit**

Run: `npx tsc --noEmit 2>&1 | grep gestureBindings || true`
Expected: no new errors mentioning `gestureBindings` (repo has a pre-existing red tsc baseline — only new errors matter).

Run: `npx prettier --write src/utils/gestureBindings.ts`

```bash
git add src/utils/gestureBindings.ts
git commit -m "add gesture binding table (white balance: move temp/tint, scroll warmth/saturation)"
```

---

### Task 3: Session hook (`src/hooks/useGestureAdjust.ts`)

Window-level capture-phase listeners; Pointer Lock for cursor freeze. Self-contained, mounted once in EditorView.

**Files:**

- Create: `src/hooks/useGestureAdjust.ts`

- [ ] **Step 1: Write the hook**

```ts
import { useEffect } from 'react';
import { useEditorActions } from './useEditorActions';
import { useEditorStore } from '../store/useEditorStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { getEffectiveKeybind } from '../utils/keyboardUtils';
import { GESTURE_BINDINGS, GestureBinding } from '../utils/gestureBindings';
import {
  AxisLock,
  StepAccumulator,
  MOVE_AXIS_LOCK,
  SCROLL_AXIS_LOCK,
  MOUSE_MOVE_STEP,
  MOUSE_SCROLL_STEP,
  TRACKPAD_SCROLL_STEP,
  clamp,
  detectWheelDevice,
  quantizeMouseWheel,
} from '../utils/gestureEngine';
import type { Adjustments } from '../utils/adjustments';

// Modal/input guards mirror useKeyboardShortcuts.ts:590-611, read imperatively
// so the listeners can be registered once.
function gestureGuardsPass(): boolean {
  const state = useEditorStore.getState();
  if (state.adjustments.toneMapper !== 'flim') return false;
  const el = document.activeElement;
  if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA') return false;
  if (document.querySelector('[data-modal-open="true"]')) return false;
  return true;
}

interface Session {
  binding: GestureBinding;
  moveLock: AxisLock;
  scrollLock: AxisLock;
  moveAccX: StepAccumulator;
  moveAccY: StepAccumulator;
  scrollAccX: StepAccumulator;
  scrollAccY: StepAccumulator;
}

export function useGestureAdjust() {
  const { setAdjustments } = useEditorActions();
  const setEditor = useEditorStore((s) => s.setEditor);

  useEffect(() => {
    let session: Session | null = null;

    const comboFor = (action: string): string | null => {
      const def = GESTURE_BINDINGS.find((b) => b.action === action);
      if (!def) return null;
      const kb = useSettingsStore.getState().appSettings?.keybinds;
      // default combo lives in KEYBIND_DEFINITIONS; imported lazily to avoid a cycle
      const defs = require('../utils/keyboardUtils').KEYBIND_DEFINITIONS as Array<{
        action: string;
        defaultCombo: string[];
      }>;
      const d = defs.find((x) => x.action === action);
      const eff = getEffectiveKeybind(kb?.[action], d?.defaultCombo ?? []);
      return eff && eff.length === 1 ? eff[0] : null; // phase 1: single-key combos only
    };

    const applySteps = (
      key: GestureBinding['move'][number]['key'],
      steps: number,
      min: number,
      max: number,
      step: number,
    ) => {
      if (steps === 0) return;
      setAdjustments((prev: Adjustments) => ({
        ...prev,
        [key]: clamp((prev[key] as number) + steps * step, min, max),
      }));
    };

    const endSession = () => {
      if (!session) return;
      session = null;
      if (document.pointerLockElement) document.exitPointerLock();
      setEditor({ isSliderDragging: false });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (session) {
        // swallow everything else while the session is active
        if (e.key !== 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
        return;
      }
      if (e.repeat) return;
      if (!gestureGuardsPass()) return;
      for (const binding of GESTURE_BINDINGS) {
        if (`Key${e.key.toUpperCase()}` !== comboFor(binding.action)) continue;
        e.preventDefault();
        e.stopImmediatePropagation();
        session = {
          binding,
          moveLock: new AxisLock(MOVE_AXIS_LOCK),
          scrollLock: new AxisLock(SCROLL_AXIS_LOCK, true),
          moveAccX: new StepAccumulator(MOUSE_MOVE_STEP.stepX),
          moveAccY: new StepAccumulator(MOUSE_MOVE_STEP.stepY),
          scrollAccX: new StepAccumulator(MOUSE_SCROLL_STEP),
          scrollAccY: new StepAccumulator(MOUSE_SCROLL_STEP),
        };
        setEditor({ isSliderDragging: true });
        document.body.requestPointerLock();
        return;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!session) return;
      if (`Key${e.key.toUpperCase()}` === comboFor(session.binding.action)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        endSession();
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!session || !document.pointerLockElement) return;
      const { move, moveLock, moveAccX, moveAccY } = session;
      const [vert, horiz] = session.binding.move;
      void move;
      const locked = moveLock.push(e.movementX, e.movementY);
      // up (negative movementY) -> +vertical param; right -> +horizontal param
      if (locked === 'horizontal' || locked === 'both') {
        applySteps(horiz.key, moveAccX.push(e.movementX), horiz.min, horiz.max, horiz.step);
      }
      if (locked === 'vertical' || locked === 'both') {
        applySteps(vert.key, moveAccY.push(-e.movementY), vert.min, vert.max, vert.step);
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (!session) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const [vert, horiz] = session.binding.scroll;
      const device = detectWheelDevice(e);
      let dx = e.deltaX;
      let dy = e.deltaY;
      if (device === 'mouse') {
        dx = quantizeMouseWheel(dx) * MOUSE_SCROLL_STEP;
        dy = quantizeMouseWheel(dy) * MOUSE_SCROLL_STEP;
      } else {
        session.scrollAccX.step = TRACKPAD_SCROLL_STEP;
        session.scrollAccY.step = TRACKPAD_SCROLL_STEP;
      }
      const locked = session.scrollLock.push(dx, dy);
      if (locked === 'none') return;
      // wheel up (negative deltaY) -> +vertical param; right -> +horizontal param
      if (locked === 'horizontal' || locked === 'both') {
        applySteps(horiz.key, session.scrollAccX.push(dx), horiz.min, horiz.max, horiz.step);
      }
      if (locked === 'vertical' || locked === 'both') {
        applySteps(vert.key, session.scrollAccY.push(-dy), vert.min, vert.max, vert.step);
      }
    };

    const onPointerLockChange = () => {
      if (session && !document.pointerLockElement) endSession(); // Esc or focus loss
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    document.addEventListener('pointerlockchange', onPointerLockChange);
    return () => {
      endSession();
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('wheel', onWheel, { capture: true });
      document.removeEventListener('pointerlockchange', onPointerLockChange);
    };
  }, [setAdjustments, setEditor]);
}
```

Two things to fix while writing the file (the executor must apply these — the snippet above is intentionally left raw here but the final file MUST include both fixes):

1. Replace `require('../utils/keyboardUtils')` with a static import: `import { KEYBIND_DEFINITIONS, getEffectiveKeybind } from '../utils/keyboardUtils';` (check first that `keyboardUtils.ts` does not import the hook — it doesn't; it's a pure utils module, no cycle). Use `KEYBIND_DEFINITIONS.find(...)` directly.
2. Remove the unused `const { move, ... } = session;` / `void move;` lines from `onPointerMove`.

Also: `StepAccumulator.step` is `private` in Task 1 — change it to a public mutable field (`constructor(public step: number)`) so the trackpad branch can switch sensitivity, OR simpler: create scroll accumulators with `TRACKPAD_SCROLL_STEP` and for the mouse branch feed pre-quantized `dx/dy * (MOUSE_SCROLL_STEP / TRACKPAD_SCROLL_STEP)`. Executor's choice; keep behavior identical. Recommended: make `step` public (one-word change in gestureEngine.ts, tests keep passing).

- [ ] **Step 2: Re-run engine tests + typecheck**

Run: `npx -y tsx scratch/gesture-engine.test.ts`
Expected: `gestureEngine tests: ALL PASS`

Run: `npx tsc --noEmit 2>&1 | grep -E "useGestureAdjust|gestureEngine|gestureBindings" || true`
Expected: no new errors in these files.

- [ ] **Step 3: Prettier + commit**

Run: `npx prettier --write src/hooks/useGestureAdjust.ts src/utils/gestureEngine.ts`

```bash
git add src/hooks/useGestureAdjust.ts src/utils/gestureEngine.ts
git commit -m "add gesture adjust session hook (pointer lock, capture-phase listeners)"
```

---

### Task 4: Integration — keybind definition, i18n, EditorView mount

**Files:**

- Modify: `src/utils/keyboardUtils.ts` (KEYBIND_DEFINITIONS array, near line 220)
- Modify: `src/i18n/locales/en.json` (`settings.keybinds.actions`)
- Modify: other locale JSONs that already contain `settings.keybinds.actions` (same key, English string is acceptable as fallback-only entries are fine — check which locales have the section: `grep -l '"toggle_analytics"' src/i18n/locales/*.json`)
- Modify: `src/components/views/EditorView.tsx` (between lines 141-143)

- [ ] **Step 1: Add the keybind definition**

In `src/utils/keyboardUtils.ts`, add to `KEYBIND_DEFINITIONS` (next to `toggle_analytics`):

```ts
  {
    action: 'gesture_color_balance',
    description: 'settings.keybinds.actions.gesture_color_balance',
    defaultCombo: ['KeyA'],
    section: 'editing',
  },
```

Note: this intentionally shares the `KeyA` default with `toggle_analytics`. The tap-vs-hold logic in `useGestureAdjust.ts` ensures short taps still toggle analytics, while holds start the gesture. SettingsPanel will flag the duplicate default in UI; users can remap either action. Do not change `toggle_analytics`.

- [ ] **Step 2: Add i18n strings**

In `src/i18n/locales/en.json` under `settings.keybinds.actions` add:

```json
        "gesture_color_balance": "Gesture: white balance (hold + mouse/scroll)",
```

Run `grep -l '"toggle_analytics"' src/i18n/locales/*.json` and add the same key (translated where obvious, English otherwise) to each matching locale's `settings.keybinds.actions`.

- [ ] **Step 3: Mount the hook in EditorView**

In `src/components/views/EditorView.tsx` after the store hooks (after line ~141, before `const editorNode = ...`):

```ts
useGestureAdjust();
```

plus the import at the top:

```ts
import { useGestureAdjust } from '../../hooks/useGestureAdjust';
```

- [ ] **Step 4: Build + prettier + commit**

Run: `npm run build`
Expected: build succeeds.

Run: `npx prettier --check src/utils/keyboardUtils.ts src/i18n/locales/en.json src/components/views/EditorView.tsx` (write if needed)

```bash
git add src/utils/keyboardUtils.ts src/i18n/locales/ src/components/views/EditorView.tsx
git commit -m "wire gesture white balance keybind (default A) into editor"
```

---

### Task 5: Manual verification + repo gates

- [ ] **Step 1: Run the app**

Run: `npm run dev` (background) and open a RAW file in the editor with the Film panel active (toneMapper flim is the default).

- [ ] **Step 2: Manual checks (mouse AND trackpad separately)**

- Hold A: cursor freezes/hides; mouse up/down changes `temperature`, left/right changes `tint` (visible in Film panel sliders); scroll changes `flimWarmth` (vertical) / `flimSaturation` (horizontal, trackpad).
- Release A: cursor returns, final full render happens, one history entry (undo once restores pre-gesture values).
- Esc during hold: session ends cleanly.
- With toneMapper = basic/agx: A toggles analytics as before (falls through).
- Shift/Alt pan and pinch-zoom over the preview still work with no gesture active.
- Quick tap of A (no movement): no parameter change, no stuck dragging state.

- [ ] **Step 3: Repo gates**

Run: `npm run build && (cd src-tauri && cargo check)`
Expected: both green (cargo check is a control run — no Rust changes were made).

```bash
git add -A && git commit -m "verify gesture adjust phase 1" --allow-empty
```

---

## Self-review notes

- Spec coverage: engine port (Task 1), binding table (Task 2), hook + pointer lock + guards + isSliderDragging (Task 3), keybind/i18n/mount (Task 4), manual + gates (Task 5). Esc handling, session reset, KeyA conflict, flim-off behavior, wheel conflict with pan/zoom — all covered.
- Known soft spot accepted for phase 1: `detectWheelDevice` is a heuristic and may misclassify some mouse models; constants are isolated in `gestureEngine.ts` for tuning.
