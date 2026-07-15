# LUT timing and HDR normalization implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-image LUT timing switch and HDR input normalization controls so LUTs can be sampled before the tonemapper.

**Architecture:** Extend the shared `Adjustments` model and the Rust `GlobalAdjustments` mirror with five new fields. In the existing `post_tone` WGSL shader, branch on `lut_timing` to either keep the current post-tone LUT application or apply LUT to HDR-linear data before tonemapping. Add a `prepare_lut_input` helper for clamp/linear/log normalization plus shoulder. Surface the controls in `LUTControl`.

**Tech stack:** TypeScript/React, Tailwind, WGSL, Rust (`bytemuck`/`wgpu`), Tauri commands.

---

## File map

| File                                     | Responsibility                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `src/utils/adjustments.ts`               | New adjustment keys, interface, defaults, copy/paste groups, section visibility.     |
| `src/i18n/locales/en.json`               | English UI labels.                                                                   |
| `src/i18n/locales/ru.json`               | Russian UI labels.                                                                   |
| `src-tauri/src/image_processing.rs`      | Rust `GlobalAdjustments` fields + JSON parsing.                                      |
| `src-tauri/src/shaders/shader.wgsl`      | Uniforms, `prepare_lut_input`, conditional LUT before tonemapper.                    |
| `src/components/ui/LUTControl.tsx`       | Timing dropdown, normalization dropdown, range/offset/shoulder sliders.              |
| `src/components/adjustments/Effects.tsx` | Wire new props from `adjustments` into `LUTControl`.                                 |
| `src-tauri/src/export_processing.rs`     | Verify no extra export wiring is needed (export reuses the same adjustments struct). |

---

## Task 1: Extend the adjustments data model

**Files:**

- Modify: `src/utils/adjustments.ts`

### Step 1.1: Add enum keys

In the `Effect` enum (around line 74), insert the new keys after `LutSize`:

```ts
export enum Effect {
  GrainAmount = 'grainAmount',
  GrainRoughness = 'grainRoughness',
  GrainSize = 'grainSize',
  LutData = 'lutData',
  LutIntensity = 'lutIntensity',
  LutName = 'lutName',
  LutPath = 'lutPath',
  LutSize = 'lutSize',
  LutTiming = 'lutTiming',
  LutNormalizeMode = 'lutNormalizeMode',
  LutInputRange = 'lutInputRange',
  LutInputOffset = 'lutInputOffset',
  LutShoulder = 'lutShoulder',
  VignetteAmount = 'vignetteAmount',
  VignetteFeather = 'vignetteFeather',
  VignetteMidpoint = 'vignetteMidpoint',
  VignetteRoundness = 'vignetteRoundness',
}
```

### Step 1.2: Add fields to the `Adjustments` interface

In `export interface Adjustments` (around line 336), add after `lutSize?: number;`:

```ts
  lutTiming?: 'after' | 'before';
  lutNormalizeMode?: 'clamp' | 'linear' | 'log';
  lutInputRange?: number;
  lutInputOffset?: number;
  lutShoulder?: number;
```

### Step 1.3: Add defaults to `INITIAL_ADJUSTMENTS`

After `lutSize: 0,` (around line 860), add:

```ts
  lutTiming: 'after',
  lutNormalizeMode: 'clamp',
  lutInputRange: 6,
  lutInputOffset: 0,
  lutShoulder: 0,
```

### Step 1.4: Include new keys in the LUT copy/paste group

In `ADJUSTMENT_GROUPS.effects` (around line 1169), update the `lut` group:

```ts
    {
      label: 'modals.copyPaste.groups.lut',
      keys: [
        Effect.LutIntensity,
        Effect.LutName,
        Effect.LutPath,
        Effect.LutSize,
        Effect.LutData,
        Effect.LutTiming,
        Effect.LutNormalizeMode,
        Effect.LutInputRange,
        Effect.LutInputOffset,
        Effect.LutShoulder,
      ],
    },
```

### Step 1.5: Add to `ADJUSTMENT_SECTIONS.effects`

In `ADJUSTMENT_SECTIONS.effects` (around line 1328), after `Effect.LutSize,` add:

```ts
    Effect.LutTiming,
    Effect.LutNormalizeMode,
    Effect.LutInputRange,
    Effect.LutInputOffset,
    Effect.LutShoulder,
```

### Step 1.6: Verify no missing enum cases

Run:

```bash
cd /Users/someone/Coding/RAW && npx tsc --noEmit --project tsconfig.json 2>&1 | head -40
```

Expected: only pre-existing `tsc` errors; no new errors caused by these edits.

### Step 1.7: Commit

```bash
git add src/utils/adjustments.ts
git commit -m "add lut timing and hdr normalization adjustment keys"
```

---

## Task 2: Add UI strings

**Files:**

- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/ru.json`

### Step 2.1: English labels

In `src/i18n/locales/en.json`, inside `"ui": { ... "lut": { ... } }` (around line 1898), add the new keys:

```json
    "lut": {
      "clearLut": "Clear LUT",
      "empty": "No LUTs yet — import some",
      "filterLabel": "LUT Files",
      "import": "Import profiles",
      "importFailed": "Failed to import LUTs",
      "intensity": "Intensity",
      "label": "LUT",
      "removeLut": "Remove LUT",
      "select": "Select",
      "selectLutFile": "Select a LUT file",
      "unsupportedFormat": "Unsupported file format(s) detected: .{{ext}}",
      "timing": "LUT timing",
      "timingAfter": "After tone mapper",
      "timingBefore": "Before tone mapper",
      "normalizeMode": "Input normalization",
      "normalizeClamp": "Clamp",
      "normalizeLinear": "Linear",
      "normalizeLog": "Log",
      "inputRange": "Input range",
      "inputOffset": "Input offset",
      "shoulder": "Shoulder"
    },
```

### Step 2.2: Russian labels

In `src/i18n/locales/ru.json`, inside `"ui": { ... "lut": { ... } }` (around line 1897), add:

```json
    "lut": {
      "clearLut": "Удалить LUT",
      "empty": "Пока нет LUT — импортируйте их",
      "filterLabel": "Файлы LUT",
      "import": "Импорт профилей",
      "importFailed": "Не удалось импортировать LUT",
      "intensity": "Интенсивность",
      "label": "LUT",
      "removeLut": "Удалить LUT",
      "select": "Выбрать",
      "selectLutFile": "Выберите файл таблицы цветов LUT",
      "unsupportedFormat": "Обнаружены неподдерживаемые форматы файлов: .{{ext}}",
      "timing": "Применение LUT",
      "timingAfter": "После тонмаппера",
      "timingBefore": "До тонмаппера",
      "normalizeMode": "Нормализация входа",
      "normalizeClamp": "Клип",
      "normalizeLinear": "Линейная",
      "normalizeLog": "Логарифмическая",
      "inputRange": "Диапазон входа",
      "inputOffset": "Смещение входа",
      "shoulder": "Плечо"
    },
```

### Step 2.3: Commit

```bash
git add src/i18n/locales/en.json src/i18n/locales/ru.json
git commit -m "add lut timing and normalization i18n strings"
```

---

## Task 3: Rust `GlobalAdjustments` and JSON parsing

**Files:**

- Modify: `src-tauri/src/image_processing.rs`

### Step 3.1: Add fields to `GlobalAdjustments`

At the end of the `GlobalAdjustments` struct (after `_pad_flim_sh: f32,` around line 1575), add:

```rust
    pub lut_timing: u32,
    pub lut_normalize_mode: u32,
    pub lut_input_range: f32,
    pub lut_input_offset: f32,
    pub lut_shoulder: f32,
```

Because the struct derives `Default`, these fields default to `0` when omitted, which matches the safe fallback (`after`, `clamp`, zero range/offset/shoulder).

### Step 3.2: Parse the new fields in `get_all_adjustments_from_json`

Find the block that parses LUT settings (around line 2720). Replace the existing `has_lut`/`lut_intensity` extraction with:

```rust
    let (has_lut, lut_intensity) = if is_visible("effects") {
        (
            js_adjustments["lutPath"].is_string() as u32,
            js_adjustments["lutIntensity"].as_f64().unwrap_or(100.0) as f32 / 100.0,
        )
    } else {
        (0, 0.0)
    };

    let lut_timing = js_adjustments["lutTiming"].as_str().map_or(0u32, |v| {
        if v == "before" { 1 } else { 0 }
    });
    let lut_normalize_mode = js_adjustments["lutNormalizeMode"].as_str().map_or(0u32, |v| {
        match v {
            "linear" => 1,
            "log" => 2,
            _ => 0,
        }
    });
    let lut_input_range = js_adjustments["lutInputRange"].as_f64().unwrap_or(6.0) as f32;
    let lut_input_offset = js_adjustments["lutInputOffset"].as_f64().unwrap_or(0.0) as f32;
    let lut_shoulder = js_adjustments["lutShoulder"].as_f64().unwrap_or(0.0) as f32 / 100.0;
```

### Step 3.3: Forward fields in the returned `GlobalAdjustments`

In the `GlobalAdjustments { ... }` construction (around line 2815), add after the existing `lut_intensity`/`has_lut` lines:

```rust
        has_lut,
        lut_intensity,
        lut_timing,
        lut_normalize_mode,
        lut_input_range,
        lut_input_offset,
        lut_shoulder,
```

### Step 3.4: Check Rust compilation

Run:

```bash
cd /Users/someone/Coding/RAW/src-tauri && cargo check 2>&1 | tail -30
```

Expected: `error: could not compile` only if a typo; otherwise clean.

### Step 3.5: Commit

```bash
git add src-tauri/src/image_processing.rs
git commit -m "add lut timing and normalization fields to rust adjustments"
```

---

## Task 4: WGSL uniforms and conditional LUT

**Files:**

- Modify: `src-tauri/src/shaders/shader.wgsl`

### Step 4.1: Add uniforms to `GlobalAdjustments`

At the end of the `GlobalAdjustments` struct (after `_pad_flim_sh: f32,` around line 183), add:

```wgsl
    lut_timing: u32,
    lut_normalize_mode: u32,
    lut_input_range: f32,
    lut_input_offset: f32,
    lut_shoulder: f32,
```

### Step 4.2: Add `prepare_lut_input` helper

After the `sample_lut_tetrahedral` function (around line 1245), insert:

```wgsl
fn prepare_lut_input(hdr: vec3<f32>) -> vec3<f32> {
    if (adjustments.global.lut_normalize_mode == 0u) {
        return clamp(hdr, vec3(0.0), vec3(1.0));
    }

    let offset_lin = pow(2.0, adjustments.global.lut_input_offset);
    let range_lin = pow(2.0, adjustments.global.lut_input_range);
    var t = hdr * offset_lin / range_lin;

    if (adjustments.global.lut_shoulder > 0.0) {
        let s = adjustments.global.lut_shoulder;
        t = t * (1.0 + s) / (1.0 + s * t);
    }

    if (adjustments.global.lut_normalize_mode == 1u) {
        return clamp(t, vec3(0.0), vec3(1.0));
    }

    // log mode
    return clamp(log2(max(t, vec3(1e-6))) / adjustments.global.lut_input_range + vec3(1.0),
                 vec3(0.0), vec3(1.0));
}
```

### Step 4.3: Apply LUT before tonemapper when requested

In the main compute function, find the block that starts with:

```wgsl
    var base_srgb: vec3<f32>;
    if (adjustments.global.tonemapper_mode == 1u) {
```

Immediately **before** that block (around line 1530), insert:

```wgsl
    if (adjustments.global.lut_timing == 1u && adjustments.global.has_lut == 1u) {
        let lut_in = prepare_lut_input(composite_rgb_linear);
        let lut_color = sample_lut_tetrahedral(lut_in);
        composite_rgb_linear = mix(composite_rgb_linear, lut_color,
                                   adjustments.global.lut_intensity);
    }
```

### Step 4.4: Make the post-tone LUT application conditional

Find the existing LUT block:

```wgsl
    if (adjustments.global.has_lut == 1u) {
        let lut_color = sample_lut_tetrahedral(final_rgb);
        final_rgb = mix(final_rgb, lut_color, adjustments.global.lut_intensity);
    }
```

Change it to:

```wgsl
    if (adjustments.global.lut_timing == 0u && adjustments.global.has_lut == 1u) {
        let lut_color = sample_lut_tetrahedral(final_rgb);
        final_rgb = mix(final_rgb, lut_color, adjustments.global.lut_intensity);
    }
```

### Step 4.5: Check Rust compilation again

Run:

```bash
cd /Users/someone/Coding/RAW/src-tauri && cargo check 2>&1 | tail -30
```

Expected: clean (no new errors). WGSL syntax is validated at pipeline creation time, not compile time, but `cargo check` catches struct field mismatches.

### Step 4.6: Commit

```bash
git add src-tauri/src/shaders/shader.wgsl
git commit -m "add conditional pre-tonemap lut with hdr normalization in shader"
```

---

## Task 5: LUT panel UI controls

**Files:**

- Modify: `src/components/ui/LUTControl.tsx`

### Step 5.1: Update props interface and imports

Add `Dropdown` import:

```ts
import Dropdown from './Dropdown';
```

Extend `LUTControlProps` (around line 23):

```ts
interface LUTControlProps {
  lutPath: string | null;
  lutName: string | null;
  lutIntensity: number;
  lutTiming?: 'after' | 'before';
  lutNormalizeMode?: 'clamp' | 'linear' | 'log';
  lutInputRange?: number;
  lutInputOffset?: number;
  lutShoulder?: number;
  onLutSelect: (path: string) => void;
  onLutHover?: (path: string | null) => void;
  onIntensityChange: (intensity: number) => void;
  onTimingChange?: (timing: 'after' | 'before') => void;
  onNormalizeModeChange?: (mode: 'clamp' | 'linear' | 'log') => void;
  onInputRangeChange?: (range: number) => void;
  onInputOffsetChange?: (offset: number) => void;
  onShoulderChange?: (shoulder: number) => void;
  onClear: () => void;
  onDragStateChange?: (isDragging: boolean) => void;
}
```

### Step 5.2: Destructure new props

In the function signature, add defaults:

```ts
export default function LUTControl({
  lutPath,
  lutName,
  lutIntensity,
  lutTiming = 'after',
  lutNormalizeMode = 'clamp',
  lutInputRange = 6,
  lutInputOffset = 0,
  lutShoulder = 0,
  onLutSelect,
  onLutHover,
  onIntensityChange,
  onTimingChange,
  onNormalizeModeChange,
  onInputRangeChange,
  onInputOffsetChange,
  onShoulderChange,
  onClear,
  onDragStateChange,
}: LUTControlProps) {
```

### Step 5.3: Add control markup below the Intensity slider

Inside the second `AnimatePresence` block that renders when `lutName` is present (around line 284), replace the inner `div` that currently holds only the Intensity slider with:

```tsx
<div className="mt-2 space-y-3">
  <Slider
    label={t('ui.lut.intensity')}
    min={0}
    max={100}
    step={1}
    value={lutIntensity}
    defaultValue={100}
    onChange={(e) => onIntensityChange(parseInt(e.target.value, 10))}
    onDragStateChange={onDragStateChange}
    fillOrigin="min"
  />

  <div className="space-y-1">
    <span className="text-sm font-medium text-text-secondary select-none">{t('ui.lut.timing')}</span>
    <Dropdown
      value={lutTiming}
      options={[
        { label: t('ui.lut.timingAfter'), value: 'after' },
        { label: t('ui.lut.timingBefore'), value: 'before' },
      ]}
      onChange={(value) => onTimingChange?.(value)}
    />
  </div>

  <div className="space-y-1">
    <span className="text-sm font-medium text-text-secondary select-none">{t('ui.lut.normalizeMode')}</span>
    <Dropdown
      value={lutNormalizeMode}
      options={[
        { label: t('ui.lut.normalizeClamp'), value: 'clamp' },
        { label: t('ui.lut.normalizeLinear'), value: 'linear' },
        { label: t('ui.lut.normalizeLog'), value: 'log' },
      ]}
      onChange={(value) => onNormalizeModeChange?.(value)}
    />
  </div>

  <Slider
    label={t('ui.lut.inputRange')}
    min={0}
    max={32}
    step={0.5}
    value={lutInputRange}
    defaultValue={6}
    onChange={(e) => onInputRangeChange?.(parseFloat(e.target.value))}
    onDragStateChange={onDragStateChange}
    fillOrigin="min"
    disabled={lutNormalizeMode === 'clamp'}
  />
  <Slider
    label={t('ui.lut.inputOffset')}
    min={-16}
    max={16}
    step={0.5}
    value={lutInputOffset}
    defaultValue={0}
    onChange={(e) => onInputOffsetChange?.(parseFloat(e.target.value))}
    onDragStateChange={onDragStateChange}
    fillOrigin="min"
    disabled={lutNormalizeMode === 'clamp'}
  />
  <Slider
    label={t('ui.lut.shoulder')}
    min={0}
    max={400}
    step={1}
    value={lutShoulder}
    defaultValue={0}
    onChange={(e) => onShoulderChange?.(parseInt(e.target.value, 10))}
    onDragStateChange={onDragStateChange}
    fillOrigin="min"
    disabled={lutNormalizeMode === 'clamp'}
  />
</div>
```

Note: If the project `Slider` does not accept a `disabled` prop, wrap each slider in a `<div className={lutNormalizeMode === 'clamp' ? 'opacity-50 pointer-events-none' : ''}>` instead.

### Step 5.4: Check TypeScript compilation

Run:

```bash
cd /Users/someone/Coding/RAW && npx tsc --noEmit --project tsconfig.json 2>&1 | head -40
```

Expected: only pre-existing errors.

### Step 5.5: Commit

```bash
git add src/components/ui/LUTControl.tsx
git commit -m "add lut timing and normalization controls to LUT panel"
```

---

## Task 6: Wire controls in `EffectsPanel`

**Files:**

- Modify: `src/components/adjustments/Effects.tsx`

### Step 6.1: Add handlers

After `handleLutIntensityChange` (around line 35), add:

```ts
const handleLutTimingChange = (timing: 'after' | 'before') => {
  setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, lutTiming: timing }));
};

const handleLutNormalizeModeChange = (mode: 'clamp' | 'linear' | 'log') => {
  setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, lutNormalizeMode: mode }));
};

const handleLutInputRangeChange = (range: number) => {
  setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, lutInputRange: range }));
};

const handleLutInputOffsetChange = (offset: number) => {
  setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, lutInputOffset: offset }));
};

const handleLutShoulderChange = (shoulder: number) => {
  setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, lutShoulder: shoulder }));
};
```

### Step 6.2: Pass new props to `LUTControl`

Update the `<LUTControl ... />` call (around line 98):

```tsx
<LUTControl
  lutPath={adjustments.lutPath || null}
  lutName={adjustments.lutName || null}
  lutIntensity={adjustments.lutIntensity || 100}
  lutTiming={adjustments.lutTiming || 'after'}
  lutNormalizeMode={adjustments.lutNormalizeMode || 'clamp'}
  lutInputRange={adjustments.lutInputRange ?? 6}
  lutInputOffset={adjustments.lutInputOffset ?? 0}
  lutShoulder={adjustments.lutShoulder ?? 0}
  onLutSelect={handleLutSelect}
  onLutHover={onLutHover}
  onIntensityChange={handleLutIntensityChange}
  onTimingChange={handleLutTimingChange}
  onNormalizeModeChange={handleLutNormalizeModeChange}
  onInputRangeChange={handleLutInputRangeChange}
  onInputOffsetChange={handleLutInputOffsetChange}
  onShoulderChange={handleLutShoulderChange}
  onClear={handleLutClear}
  onDragStateChange={onDragStateChange}
/>
```

### Step 6.3: Type-check

Run:

```bash
cd /Users/someone/Coding/RAW && npx tsc --noEmit --project tsconfig.json 2>&1 | head -40
```

Expected: only pre-existing errors.

### Step 6.4: Commit

```bash
git add src/components/adjustments/Effects.tsx
git commit -m "wire lut timing and normalization props from effects panel"
```

---

## Task 7: Verify export path needs no extra work

**Files:**

- Read-only: `src-tauri/src/export_processing.rs`

### Step 7.1: Confirm export uses `get_all_adjustments_from_json`

Run:

```bash
cd /Users/someone/Coding/RAW && grep -n "get_all_adjustments_from_json" src-tauri/src/export_processing.rs
```

Expected: multiple hits (e.g. lines 352, 475, 867, 962, 1465, 1606).

### Step 7.2: Confirm `GlobalAdjustments` is forwarded to the GPU export pipeline

The export code builds `RenderRequest { adjustments: all_adjustments, ... }` and passes it to `process_and_get_dynamic_image`. No separate CPU tonemapper fallback handles LUT in the export path.

If a CPU fallback is found during review, file a follow-up task. Otherwise, no code change is required.

### Step 7.3: Commit (only if a change is needed)

If no change is needed, skip the commit.

---

## Task 8: Final verification and formatting

### Step 8.1: Prettier check

Run:

```bash
cd /Users/someone/Coding/RAW && npx prettier --check \
  src/utils/adjustments.ts \
  src/components/ui/LUTControl.tsx \
  src/components/adjustments/Effects.tsx \
  src/i18n/locales/en.json \
  src/i18n/locales/ru.json \
  src-tauri/src/image_processing.rs \
  src-tauri/src/shaders/shader.wgsl
```

Expected: all files pass. If any fail, run `npx prettier --write <file>` and re-check.

### Step 8.2: Rust check

Run:

```bash
cd /Users/someone/Coding/RAW/src-tauri && cargo check 2>&1 | tail -30
```

Expected: clean.

### Step 8.3: Frontend build

Run:

```bash
cd /Users/someone/Coding/RAW && npm run build 2>&1 | tail -40
```

Expected: build succeeds (ignore pre-existing `tsc` baseline errors).

### Step 8.4: Commit formatting fixes

```bash
git add -u
git commit -m "format lut timing and normalization changes"
```

---

## Task 9: Manual smoke test

### Step 9.1: Launch the app

Run the Tauri dev build:

```bash
cd /Users/someone/Coding/RAW && npm run tauri dev
```

### Step 9.2: Test scenarios

1. Load any RAW or non-RAW image.
2. Open **Effects → LUT**, import a LOG/creative LUT, set Intensity to `100`.
3. With default **After tone mapper** + **Clamp**, note the look.
4. Switch to **Before tone mapper** → image should change.
5. Switch Normalize to **Linear**, raise **Input range** to `8` → clipped highlights should soften.
6. Switch to **Log**, tweak **Input offset** → shadows/midtones should shift.
7. Raise **Shoulder** → highlight compression before LUT should increase.
8. Switch back to **After tone mapper** → image must match the original look from step 3.
9. Save the project and reload — settings restore.

### Step 9.3: Regression check

1. Disable LUT → image returns to no-LUT look.
2. Change **Input normalization** to **Clamp** while in **Before** mode → sliders disable.
3. Apply a preset that includes LUT settings → timing and normalization travel with the preset.

---

## Self-review checklist

- **Spec coverage:**
  - Timing toggle → Task 5 + Task 6 + WGSL conditional → covered.
  - Normalization modes → `prepare_lut_input` → covered.
  - Manual sliders → Task 5 → covered.
  - Backward compatibility → defaults in `INITIAL_ADJUSTMENTS` and Rust `Default` → covered.
  - Export path → Task 7 → covered.
- **Placeholder scan:** no TBD/TODO; all code shown.
- **Type consistency:**
  - TS: `'after' | 'before'`, `'clamp' | 'linear' | 'log'`, `number`.
  - Rust: `u32` for enums, `f32` for numeric parameters, shoulder pre-divided by 100.
  - WGSL: matching `u32`/`f32` fields at the end of `GlobalAdjustments`.
- **Alignment safety:** new WGSL fields are appended at the end of `GlobalAdjustments`, so they cannot shift existing members and break mat3x3 alignment.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-15-lut-timing-and-hdr-normalization-plan.md`.**

**Two execution options:**

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach would you like?
