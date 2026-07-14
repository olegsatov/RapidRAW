# Grain Mode Toggle (Pierre/IPOL) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Repo rule (AGENTS.md): do NOT run `git commit`/`git push` during execution.** The user commits explicitly. Where a generic plan would say "commit", stop at a checkpoint instead. Also: no cosmetic edits to upstream code, keep the diff surgical.

**Goal:** Replace the two stacked grain engine cards in the Film tab's Grain section with a persisted `Pierre | IPOL` mode toggle, add an on/off visibility toggle to the Grain section, and link both to the export panel (export grain disabled when the section is off; export grain mode follows the editor engine).

**Architecture:** `grainEngine` and `sectionVisibility.grain` are new per-image adjustment keys (sidecar-persisted). The editor renders only the selected engine's card; the shared `crystalGrainAmount` slider moves to a header area. Rust gates the GPU realtime grain by section visibility and engine (IPOL = no canvas grain). Export fast/CPU grain paths read the raw amount honoring the section toggle; the export panel disables its grain switch when grain is unavailable and syncs its mode from the image's `grainEngine`.

**Tech Stack:** React + TypeScript (Vite), Tauri v2, Rust (wgpu), i18next. Verification: `npm run build`, `cargo check` + `cargo test` in `src-tauri/`, `npx prettier --check`.

**Spec:** `docs/superpowers/specs/2026-07-13-grain-mode-toggle-design.md`

---

## File Structure

- `src/utils/adjustments.ts` — adjustment keys, defaults, sidecar merge, copy/paste groups (modify)
- `src/i18n/locales/en.json`, `src/i18n/locales/ru.json` — new strings (modify)
- `src-tauri/src/image_processing.rs` — global adjustment gating + tests (modify)
- `src-tauri/src/export_processing.rs` — export grain routing + tests (modify)
- `src/components/adjustments/Grain.tsx` — mode toggle UI, conditional cards (rewrite)
- `src/components/panel/right/FilmPanel.tsx` — grain section visibility toggle (modify)
- `src/components/panel/right/ExportPanel.tsx` — disabled state + mode sync (modify)
- `src/hooks/useExportSettings.ts` — default grain mode (modify)
- `AGENTS.md` — delta map update (modify)

---

### Task 1: Data model — `grainEngine` + `SectionVisibility.grain`

**Files:**
- Modify: `src/utils/adjustments.ts`

- [ ] **Step 1: Add the enum member**

In the `FilmAdjustment` enum, after `IpolGrainMonteCarlo = 'ipolGrainMonteCarlo',` (line 118) add:

```ts
  GrainEngine = 'grainEngine',
```

- [ ] **Step 2: Add to the `Adjustments` interface**

After `ipolGrainMonteCarlo: number;` (line 252) add:

```ts
  grainEngine: string;
```

- [ ] **Step 3: Extend `SectionVisibility`**

In the `SectionVisibility` interface (lines 470-479), after `film: boolean;` add:

```ts
  grain: boolean;
```

- [ ] **Step 4: Add defaults in both sectionVisibility initializers**

In `INITIAL_MASK_ADJUSTMENTS.sectionVisibility` (line 578 block) and `INITIAL_ADJUSTMENTS.sectionVisibility` (line 841 block), after `film: true,` add:

```ts
    grain: true,
```

(The mask initializer needs it only for type completeness — the grain section is never queried for masks.)

- [ ] **Step 5: Add the `grainEngine` default**

In `INITIAL_ADJUSTMENTS`, after `ipolGrainMonteCarlo: 100,` (line 781) add:

```ts
  grainEngine: 'pierre',
```

- [ ] **Step 6: Add to the sidecar load merge**

In the load-merge block, after `ipolGrainMonteCarlo: loadedAdjustments.ipolGrainMonteCarlo ?? INITIAL_ADJUSTMENTS.ipolGrainMonteCarlo,` (line 997) add:

```ts
    grainEngine: loadedAdjustments.grainEngine ?? INITIAL_ADJUSTMENTS.grainEngine,
```

Old sidecars without the key fall back to `'pierre'`; the `sectionVisibility` merge (line 1054) is spread-based, so `grain: true` from INITIAL applies automatically.

- [ ] **Step 7: Add grain keys to the film copy/paste group**

In the `film:` copy/paste group (starts line 1144), after `FilmAdjustment.FilmBlur,` (line 1160) add the grain keys so a copied film look carries its grain setup (the group previously had no grain keys at all — adding only `grainEngine` would paste a mode without its params):

```ts
        FilmAdjustment.GrainEngine,
        FilmAdjustment.CrystalGrainAmount,
        FilmAdjustment.CrystalGrainMono,
        FilmAdjustment.CrystalGrainFilling,
        FilmAdjustment.CrystalGrainSize,
        FilmAdjustment.CrystalGrainLayers,
        FilmAdjustment.CrystalGrainStd,
        FilmAdjustment.IpolGrainMuR,
        FilmAdjustment.IpolGrainSigmaR,
        FilmAdjustment.IpolGrainSigmaFilter,
        FilmAdjustment.IpolGrainMonteCarlo,
```

- [ ] **Step 8: Verify the build**

Run: `npm run build`
Expected: build succeeds; no NEW TypeScript errors mentioning `grainEngine` or `SectionVisibility` (the repo has a pre-existing red `tsc` baseline — judge only new errors).

- [ ] **Checkpoint** — report to user. No commit (repo rule).

---

### Task 2: i18n strings (en + ru)

**Files:**
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/ru.json`

- [ ] **Step 1: en.json — Grain panel keys**

In `adjustments.effects` (around line 143, after `"xtalRealtime": "Realtime Preview",`) add:

```json
      "grainModes": {
        "pierre": "Pierre",
        "ipol": "IPOL"
      },
      "grainAmountPierreHint": "Realtime preview strength; also applied at export.",
      "grainAmountIpolHint": "Applied at export — this engine has no realtime preview.",
```

- [ ] **Step 2: en.json — export disabled hint**

In `export.grain` (after `"mono": "B&W noise (shared grain field)",`, line 913) add:

```json
      "disabledHint": "Enable the flim panel and the Grain section in the Film tab to add grain at export.",
```

- [ ] **Step 3: ru.json — Grain panel keys**

Same position as Step 1 in `src/i18n/locales/ru.json`:

```json
      "grainModes": {
        "pierre": "Pierre",
        "ipol": "IPOL"
      },
      "grainAmountPierreHint": "Сила зерна в живом превью; также применяется при экспорте.",
      "grainAmountIpolHint": "Применяется при экспорте — у этого движка нет живого превью.",
```

- [ ] **Step 4: ru.json — export disabled hint**

Same position as Step 2 in `src/i18n/locales/ru.json`:

```json
      "disabledHint": "Включите панель flim и секцию Grain во вкладке Film, чтобы добавить зерно при экспорте.",
```

- [ ] **Step 5: Verify formatting**

Run: `npx prettier --check src/i18n/locales/en.json src/i18n/locales/ru.json`
Expected: no warnings (fix with `npx prettier --write` on those two files if it complains).

- [ ] **Checkpoint** — report to user. No commit.

---

### Task 3: Rust gating in `get_global_adjustments_from_json` (TDD)

**Files:**
- Modify: `src-tauri/src/image_processing.rs` (gating at lines 2543-2551 and 2936-2937; tests module at the bottom)

- [ ] **Step 1: Write the failing test**

Add this test to the `#[cfg(test)] mod tests` block at the bottom of `src-tauri/src/image_processing.rs` (next to `film_tab_modules_follow_panel_toggle`):

```rust
    #[test]
    fn crystal_grain_follows_grain_section_and_engine() {
        let base = serde_json::json!({
            "toneMapper": "flim",
            "sectionVisibility": { "grain": true },
            "crystalGrainAmount": 50,
            "crystalGrainMono": 1
        });
        // Section visible + default (Pierre) engine: values pass through.
        let on = get_global_adjustments_from_json(&base, true, None);
        assert!((on.crystal_grain_amount - 0.5).abs() < 1e-6);
        assert_eq!(on.crystal_grain_mono, 1.0);

        // Grain section off: zeroed.
        let mut off_json = base.clone();
        off_json["sectionVisibility"] = serde_json::json!({ "grain": false });
        let off = get_global_adjustments_from_json(&off_json, true, None);
        assert_eq!(off.crystal_grain_amount, 0.0, "grain section off must zero amount");
        assert_eq!(off.crystal_grain_mono, 0.0, "grain section off must zero mono");

        // IPOL engine: no GPU grain on the canvas (CPU-only engine).
        let mut ipol_json = base.clone();
        ipol_json["grainEngine"] = serde_json::json!("ipol");
        let ipol = get_global_adjustments_from_json(&ipol_json, true, None);
        assert_eq!(ipol.crystal_grain_amount, 0.0, "ipol engine must have no GPU grain");

        // Flim panel off gates grain too (grain lives in the Film tab).
        let mut panel_off = base.clone();
        panel_off["toneMapper"] = serde_json::json!("basic");
        let gated = get_global_adjustments_from_json(&panel_off, true, None);
        assert_eq!(gated.crystal_grain_amount, 0.0, "flim panel off must gate grain");
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src-tauri && cargo test crystal_grain_follows_grain_section_and_engine`
Expected: FAIL — the first assertion after the engine/section changes fails (currently grain keys are read via `get_val("film", ...)` and `grainEngine` is ignored).

- [ ] **Step 3: Add `"grain"` to the flim-panel gating list**

In `get_global_adjustments_from_json`, change the `is_visible` closure (line 2544):

```rust
        if !flim_panel_on && matches!(section, "film" | "blackAndWhite" | "grain") {
            return false;
        }
```

- [ ] **Step 4: Read `grainEngine` and gate the crystal grain fields**

Replace lines 2934-2937:

```rust
        // Crystal grain (Pierre) realtime preview: amount 0..100 -> 0..1
        // (strength mix in the film post-pass), mono as a 0/1 flag.
        crystal_grain_amount: get_val("film", "crystalGrainAmount", 100.0, None),
        crystal_grain_mono: get_val("film", "crystalGrainMono", 1.0, Some(0.0)),
```

with:

```rust
        // Crystal grain (Pierre) realtime preview: amount 0..100 -> 0..1
        // (strength mix in the film post-pass), mono as a 0/1 flag. Gated by
        // the Grain section toggle; the IPOL engine is CPU-only and gets no
        // GPU preview grain at all.
        crystal_grain_amount: if js_adjustments["grainEngine"].as_str() == Some("ipol") {
            0.0
        } else {
            get_val("grain", "crystalGrainAmount", 100.0, None)
        },
        crystal_grain_mono: get_val("grain", "crystalGrainMono", 1.0, Some(0.0)),
```

- [ ] **Step 5: Run the new test to verify it passes**

Run: `cd src-tauri && cargo test crystal_grain_follows_grain_section_and_engine`
Expected: PASS.

- [ ] **Step 6: Run the full test suite to check for regressions**

Run: `cd src-tauri && cargo test`
Expected: all tests pass, including the pre-existing `film_tab_modules_follow_panel_toggle` (its JSON has no `grain` visibility key, which defaults to visible).

- [ ] **Checkpoint** — report to user. No commit.

---

### Task 4: Export grain routing (TDD)

**Files:**
- Modify: `src-tauri/src/export_processing.rs` (grain routing at lines 355-372; `apply_export_grain_cpu` at line 644)

- [ ] **Step 1: Write the failing test**

Append a tests module at the end of `src-tauri/src/export_processing.rs` (if one already exists, add the test inside it instead):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grain_section_visibility_defaults_and_override() {
        // Missing key (old sidecars) defaults to visible.
        assert!(grain_section_visible(&serde_json::json!({})));
        assert!(grain_section_visible(&serde_json::json!({
            "sectionVisibility": { "grain": true }
        })));
        assert!(!grain_section_visible(&serde_json::json!({
            "sectionVisibility": { "grain": false }
        })));
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src-tauri && cargo test grain_section_visibility_defaults_and_override`
Expected: FAIL — `grain_section_visible` is not defined.

- [ ] **Step 3: Add the visibility helpers**

Add near `apply_export_grain_cpu` in `src-tauri/src/export_processing.rs`:

```rust
/// Grain section visibility (the Film-tab Grain section eye toggle).
/// Missing key means an old sidecar — default to visible.
fn grain_section_visible(js_adjustments: &Value) -> bool {
    js_adjustments
        .get("sectionVisibility")
        .and_then(|v| v.get("grain"))
        .and_then(|s| s.as_bool())
        .unwrap_or(true)
}

/// Grain modules live in the Film tab and run only while the flim
/// tonemapper panel is on.
fn flim_panel_on(js_adjustments: &Value) -> bool {
    js_adjustments.get("toneMapper").and_then(|v| v.as_str()) == Some("flim")
}
```

- [ ] **Step 4: Fix the fast-path amount read**

Replace the `ExportGrainMode::Fast` match arm (lines 360-368):

```rust
        ExportGrainMode::Fast => {
            if grain_mono {
                all_adjustments.global.crystal_grain_mono = 1.0;
            }
            if all_adjustments.global.crystal_grain_amount > 0.0 {
                let opts = crate::crystal_grain::options_from_adjustments(js_adjustments);
                grain_view = Some(get_export_grain_view(context, state, &opts)?);
            }
        }
```

with:

```rust
        ExportGrainMode::Fast => {
            if grain_mono {
                all_adjustments.global.crystal_grain_mono = 1.0;
            }
            // The editor engine mode zeroes the GPU-gated global amount (IPOL
            // gets no canvas grain), but `fast` is an explicit export choice:
            // read the raw slider value, still honoring the grain section
            // toggle and the flim panel master switch.
            let amount = if grain_section_visible(js_adjustments) && flim_panel_on(js_adjustments) {
                js_adjustments
                    .get("crystalGrainAmount")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0) as f32
                    / 100.0
            } else {
                0.0
            };
            all_adjustments.global.crystal_grain_amount = amount;
            if amount > 0.0 {
                let opts = crate::crystal_grain::options_from_adjustments(js_adjustments);
                grain_view = Some(get_export_grain_view(context, state, &opts)?);
            }
        }
```

- [ ] **Step 5: Add the defensive check to the CPU path**

In `apply_export_grain_cpu`, insert before the existing amount computation (before the `let amount = js_adjustments...` at line 655):

```rust
    // Grain section toggled off in the editor: the file stays clean even if
    // a stale export preset asks for grain.
    if !grain_section_visible(js_adjustments) {
        return Ok(image);
    }
```

- [ ] **Step 6: Run the tests**

Run: `cd src-tauri && cargo test grain_section_visibility_defaults_and_override && cargo check`
Expected: test PASS, check clean.

- [ ] **Checkpoint** — report to user. No commit.

---

### Task 5: Grain panel UI rewrite

**Files:**
- Rewrite: `src/components/adjustments/Grain.tsx`

- [ ] **Step 1: Replace the whole file**

Replace `src/components/adjustments/Grain.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import clsx from 'clsx';
import Slider from '../ui/Slider';
import Text from '../ui/Text';
import { TextVariants } from '../../types/typography';
import { Adjustments, FilmAdjustment } from '../../utils/adjustments';
import Switch from '../ui/Switch';
import Button from '../ui/Button';
import { useEditorStore } from '../../store/useEditorStore';

interface GrainPanelProps {
  adjustments: Adjustments;
  setAdjustments(adjustments: Partial<Adjustments>): any;
  onDragStateChange?: (isDragging: boolean) => void;
}

// The two physical grain engines (IPOL 2017 and Pierre crystal grain). A
// per-image mode toggle selects which engine is configured and exported;
// only the Pierre engine has a realtime baked-field canvas preview. Both
// engines render offline into a file via their buttons. Native RapidRAW
// grain stays in the Effects section.
export default function GrainPanel({ adjustments, setAdjustments, onDragStateChange }: GrainPanelProps) {
  const { t } = useTranslation();
  const selectedImage = useEditorStore((s: any) => s.selectedImage);
  const [grainRendering, setGrainRendering] = useState(false);
  const [grainProgress, setGrainProgress] = useState('');
  const [grainPreview, setGrainPreview] = useState<string | null>(null);
  const [ipolMono, setIpolMono] = useState(false);
  const [xtalRendering, setXtalRendering] = useState(false);
  const [xtalProgress, setXtalProgress] = useState('');
  const [xtalPreview, setXtalPreview] = useState<string | null>(null);

  const grainEngine = adjustments.grainEngine === 'ipol' ? 'ipol' : 'pierre';
  const grainVisible = adjustments.sectionVisibility?.grain !== false;

  // Grain engine parameters live in the adjustments (persisted to the sidecar)
  // so the export pipeline can reproduce them without the editor being open.
  const grainOpts = {
    muR: adjustments.ipolGrainMuR,
    sigmaR: adjustments.ipolGrainSigmaR,
    sigmaFilter: adjustments.ipolGrainSigmaFilter,
    nMonteCarlo: adjustments.ipolGrainMonteCarlo,
  };
  const xtalOpts = {
    filling: adjustments.crystalGrainFilling,
    size: adjustments.crystalGrainSize,
    layers: adjustments.crystalGrainLayers,
    std: adjustments.crystalGrainStd,
  };

  useEffect(() => {
    const unProgress = listen<string>('film-grain-progress', (e) => setGrainProgress(e.payload));
    const unPreview = listen<string>('film-grain-preview', (e) => setGrainPreview(e.payload));
    const unComplete = listen<string>('film-grain-complete', () => {
      setGrainRendering(false);
      setGrainProgress('');
    });
    return () => {
      unProgress.then((f) => f());
      unPreview.then((f) => f());
      unComplete.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const unProgress = listen<string>('crystal-grain-progress', (e) => setXtalProgress(e.payload));
    const unPreview = listen<string>('crystal-grain-preview', (e) => setXtalPreview(e.payload));
    const unComplete = listen<string>('crystal-grain-complete', () => {
      setXtalRendering(false);
      setXtalProgress('');
    });
    return () => {
      unProgress.then((f) => f());
      unPreview.then((f) => f());
      unComplete.then((f) => f());
    };
  }, []);

  // Realtime preview: rebake the grain field (debounced) whenever the crystal
  // parameters change — only while the Pierre engine is selected and the
  // section is enabled (IPOL has no GPU preview). The field is a flat-field
  // render of the model, so the mono flag and strength don't affect it (they
  // are shader-side). The `crystal-grain-baked` listener in useTauriListeners
  // bumps the store's renderGeneration, which re-renders the image with the
  // fresh texture.
  useEffect(() => {
    if (grainEngine !== 'pierre' || !grainVisible) {
      return;
    }
    const timer = setTimeout(() => {
      invoke('bake_crystal_grain_field', {
        options: { ...xtalOpts, seed: 1 },
      }).catch((e) => console.warn('Crystal grain bake failed:', e));
    }, 400);
    return () => clearTimeout(timer);
  }, [grainEngine, grainVisible, xtalOpts.filling, xtalOpts.size, xtalOpts.layers, xtalOpts.std]);

  const handleAdjustmentChange = (key: string, value: string) => {
    const numericValue = parseInt(value, 10);
    setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, [key]: numericValue }));
  };

  const handleRenderGrain = async (preview: boolean) => {
    if (!selectedImage?.path || grainRendering) return;
    setGrainRendering(true);
    try {
      await invoke('render_film_grain', {
        path: selectedImage.path,
        adjustments,
        options: { ...grainOpts, monochrome: ipolMono, seed: 1 },
        preview,
      });
    } catch (e) {
      setGrainProgress(String(e));
      setGrainRendering(false);
    }
  };

  const handleGrainOptChange = (key: string, value: number | string) => {
    const map: Record<string, string> = {
      muR: 'ipolGrainMuR',
      sigmaR: 'ipolGrainSigmaR',
      sigmaFilter: 'ipolGrainSigmaFilter',
      nMonteCarlo: 'ipolGrainMonteCarlo',
    };
    setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, [map[key]]: parseFloat(String(value)) }));
  };

  const handleRenderXtal = async (preview: boolean) => {
    if (!selectedImage?.path || xtalRendering) return;
    setXtalRendering(true);
    try {
      // Export honors the realtime amount slider, so the saved file matches
      // the preview. Slider at 0 means "realtime preview off" — fall back to
      // the full-strength export (Rust default) instead of a clean image.
      const amount = ((adjustments.crystalGrainAmount as number) ?? 0) / 100;
      await invoke('render_crystal_grain', {
        path: selectedImage.path,
        adjustments,
        options: {
          ...xtalOpts,
          seed: 1,
          monochrome: !!adjustments.crystalGrainMono,
          ...(amount > 0 ? { amount } : {}),
        },
        preview,
      });
    } catch (e) {
      setXtalProgress(String(e));
      setXtalRendering(false);
    }
  };

  const handleXtalOptChange = (key: string, value: number | string) => {
    const map: Record<string, string> = {
      filling: 'crystalGrainFilling',
      size: 'crystalGrainSize',
      layers: 'crystalGrainLayers',
      std: 'crystalGrainStd',
    };
    setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, [map[key]]: parseFloat(String(value)) }));
  };

  return (
    <div className="space-y-4">
      <div className="p-2 bg-bg-tertiary rounded-md">
        <div className="flex gap-1 mb-2">
          {(['pierre', 'ipol'] as const).map((mode) => (
            <button
              key={mode}
              className={clsx(
                'flex-1 px-2 py-1 text-sm font-medium rounded-md transition-colors',
                grainEngine === mode
                  ? 'bg-accent text-button-text'
                  : 'bg-card-active text-text-secondary hover:bg-surface',
              )}
              onClick={() => setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, grainEngine: mode }))}
            >
              {t(`adjustments.effects.grainModes.${mode}`)}
            </button>
          ))}
        </div>
        <Slider
          label={t('adjustments.effects.amount')}
          max={100}
          min={0}
          onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.CrystalGrainAmount, e.target.value)}
          step={1}
          value={adjustments.crystalGrainAmount}
          onDragStateChange={onDragStateChange}
        />
        <p className="text-xs text-text-secondary mt-1">
          {grainEngine === 'pierre'
            ? t('adjustments.effects.grainAmountPierreHint')
            : t('adjustments.effects.grainAmountIpolHint')}
        </p>
      </div>

      {grainEngine === 'ipol' ? (
        <div className="p-2 bg-bg-tertiary rounded-md">
          <Text variant={TextVariants.heading} className="mb-2">
            {t('adjustments.effects.filmPhysicalGrain')}
          </Text>
          <Slider
            defaultValue={0.1}
            label={t('adjustments.effects.filmGrainRadius')}
            max={2}
            min={0.05}
            onChange={(e: any) => handleGrainOptChange('muR', e.target.value)}
            step={0.05}
            value={grainOpts.muR}
          />
          <Slider
            defaultValue={0}
            label={t('adjustments.effects.filmGrainRadiusVar')}
            max={1}
            min={0}
            onChange={(e: any) => handleGrainOptChange('sigmaR', e.target.value)}
            step={0.05}
            value={grainOpts.sigmaR}
          />
          <Slider
            defaultValue={0.8}
            label={t('adjustments.effects.filmGrainFilter')}
            max={2}
            min={0}
            onChange={(e: any) => handleGrainOptChange('sigmaFilter', e.target.value)}
            step={0.1}
            value={grainOpts.sigmaFilter}
          />
          <Slider
            defaultValue={100}
            label={t('adjustments.effects.filmGrainMonteCarlo')}
            max={800}
            min={25}
            onChange={(e: any) => handleGrainOptChange('nMonteCarlo', e.target.value)}
            step={25}
            value={grainOpts.nMonteCarlo}
          />
          <Switch
            id="switch-grain-mono-ipol"
            label={t('adjustments.effects.grainMonochrome')}
            checked={ipolMono}
            onChange={setIpolMono}
          />
          <div className="flex gap-2">
            <Button
              onClick={() => handleRenderGrain(true)}
              disabled={grainRendering || !selectedImage?.path}
              className="flex-1 bg-surface"
            >
              {t('adjustments.effects.filmGrainPreview')}
            </Button>
            <Button
              onClick={() => handleRenderGrain(false)}
              disabled={grainRendering || !selectedImage?.path}
              className="flex-1 bg-surface"
            >
              {t('adjustments.effects.filmRenderGrain')}
            </Button>
          </div>
          {grainProgress && <p className="text-xs text-text-secondary mt-2">{grainProgress}</p>}
          {grainPreview && (
            <img
              src={grainPreview}
              alt="Grain preview"
              className="mt-2 w-full rounded-sm border border-card-active"
            />
          )}
          <p className="text-xs text-text-secondary mt-2">{t('adjustments.effects.filmRenderGrainDesc')}</p>
        </div>
      ) : (
        <div className="p-2 bg-bg-tertiary rounded-md">
          <Text variant={TextVariants.heading} className="mb-2">
            {t('adjustments.effects.filmCrystalGrain')}
          </Text>
          <Slider
            defaultValue={0.25}
            label={t('adjustments.effects.xtalFilling')}
            max={0.8}
            min={0.05}
            onChange={(e: any) => handleXtalOptChange('filling', e.target.value)}
            step={0.05}
            value={xtalOpts.filling}
          />
          <Slider
            defaultValue={5}
            label={t('adjustments.effects.xtalSize')}
            max={15}
            min={1}
            onChange={(e: any) => handleXtalOptChange('size', e.target.value)}
            step={1}
            value={xtalOpts.size}
          />
          <Slider
            defaultValue={30}
            label={t('adjustments.effects.xtalLayers')}
            max={60}
            min={5}
            onChange={(e: any) => handleXtalOptChange('layers', e.target.value)}
            step={5}
            value={xtalOpts.layers}
          />
          <Slider
            defaultValue={0.5}
            label={t('adjustments.effects.xtalStd')}
            max={2}
            min={0}
            onChange={(e: any) => handleXtalOptChange('std', e.target.value)}
            step={0.05}
            value={xtalOpts.std}
          />
          <Switch
            id="switch-grain-mono-xtal"
            label={t('adjustments.effects.grainMonochrome')}
            checked={!!adjustments.crystalGrainMono}
            onChange={(v: boolean) =>
              setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, crystalGrainMono: v ? 1 : 0 }))
            }
          />
          <div className="flex gap-2">
            <Button
              onClick={() => handleRenderXtal(true)}
              disabled={xtalRendering || !selectedImage?.path}
              className="flex-1 bg-surface"
            >
              {t('adjustments.effects.filmGrainPreview')}
            </Button>
            <Button
              onClick={() => handleRenderXtal(false)}
              disabled={xtalRendering || !selectedImage?.path}
              className="flex-1 bg-surface"
            >
              {t('adjustments.effects.filmRenderGrain')}
            </Button>
          </div>
          {xtalProgress && <p className="text-xs text-text-secondary mt-2">{xtalProgress}</p>}
          {xtalPreview && (
            <img
              src={xtalPreview}
              alt="Crystal grain preview"
              className="mt-2 w-full rounded-sm border border-card-active"
            />
          )}
          <p className="text-xs text-text-secondary mt-2">{t('adjustments.effects.xtalRenderDesc')}</p>
        </div>
      )}
    </div>
  );
}
```

Changes vs. the old file: new `clsx` import; `grainEngine`/`grainVisible` derived values; mode segmented control + shared Amount slider + contextual hint in a new header card; the Amount sub-block (with the `xtalRealtime` label) removed from the Pierre card; IPOL and Pierre cards rendered conditionally; the bake effect early-returns unless Pierre + visible.

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: succeeds; no new TS errors in `Grain.tsx`.

- [ ] **Checkpoint** — report to user. No commit.

---

### Task 6: Grain section visibility toggle in the Film tab

**Files:**
- Modify: `src/components/panel/right/FilmPanel.tsx` (grain CollapsibleSection at lines 515-527)

- [ ] **Step 1: Wire the eye toggle**

Replace:

```tsx
        <CollapsibleSection
          canToggleVisibility={false}
          isContentVisible={true}
          isOpen={grainOpen}
          onToggle={() => setGrainOpen((v) => !v)}
          title={t('adjustments.effects.grain')}
        >
```

with:

```tsx
        <CollapsibleSection
          isContentVisible={sectionVisibility.grain}
          isOpen={grainOpen}
          onToggle={() => setGrainOpen((v) => !v)}
          onToggleVisibility={() => handleToggleVisibility('grain')}
          title={t('adjustments.effects.grain')}
        >
```

`sectionVisibility` and `handleToggleVisibility` already exist in this component (used by the Film and B&W sections); `SectionVisibility` has an index signature, so `'grain'` needs no further plumbing. `canToggleVisibility` defaults to `true`.

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: succeeds; no new TS errors in `FilmPanel.tsx`.

- [ ] **Checkpoint** — report to user. No commit.

---

### Task 7: Export panel linkage

**Files:**
- Modify: `src/components/panel/right/ExportPanel.tsx`
- Modify: `src/hooks/useExportSettings.ts`

- [ ] **Step 1: Change the default export grain mode**

In `src/hooks/useExportSettings.ts` line 24, change the default to match the editor's default engine:

```ts
  const [grainMode, setGrainMode] = useState<'fast' | 'pierre' | 'ipol'>('pierre');
```

- [ ] **Step 2: Compute grain availability and sync the mode**

In `src/components/panel/right/ExportPanel.tsx`, right after the `const { adjustments } = useEditorStore(...)` block (line 246), add:

```tsx
  // Grain is configured per image in the Film tab; export can only add grain
  // when the flim panel and the Grain section are both on for this image.
  const grainAvailable =
    adjustments?.toneMapper === 'flim' && adjustments?.sectionVisibility?.grain !== false;
```

Then add a sync effect next to the existing `useEffect` that tracks `selectedImage` (after line 318). `setGrainMode` is already destructured from `useExportSettings` (line 239):

```tsx
  // Export grain mode follows the engine selected in the editor; the user
  // can still override it via the dropdown until the image or engine changes.
  useEffect(() => {
    setGrainMode(adjustments?.grainEngine === 'ipol' ? 'ipol' : 'pierre');
  }, [selectedImage?.path, adjustments?.grainEngine]);
```

- [ ] **Step 3: Disable the grain switch when unavailable**

In the grain `Section` (line 787), replace the switch block (lines 788-795):

```tsx
                  <Switch
                    label={t('export.grain.addGrain')}
                    checked={grainEnabled}
                    onChange={setGrainEnabled}
                    disabled={isExporting}
                    trackClassName="bg-surface"
                  />
                  {grainEnabled && (
```

with:

```tsx
                  <Switch
                    label={t('export.grain.addGrain')}
                    checked={grainEnabled && grainAvailable}
                    onChange={setGrainEnabled}
                    disabled={isExporting || !grainAvailable}
                    trackClassName="bg-surface"
                  />
                  {!grainAvailable && (
                    <Text variant={TextVariants.small} color={TextColors.secondary}>
                      {t('export.grain.disabledHint')}
                    </Text>
                  )}
                  {grainEnabled && grainAvailable && (
```

`Text`, `TextVariants`, and `TextColors` are already imported in this file (used at line 815).

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: succeeds; no new TS errors in `ExportPanel.tsx` / `useExportSettings.ts`.

- [ ] **Checkpoint** — report to user. No commit.

---

### Task 8: Delta map + final verification

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Update the "What's ours (delta map)" list**

In `AGENTS.md`, extend the film simulation & grain bullet to cover the files this feature touches, so future upstream syncs treat them as ours:

```markdown
- Film simulation & grain: `src/components/adjustments/Film.tsx`,
  `src/components/adjustments/Grain.tsx`,
  `src/components/panel/right/FilmPanel.tsx`, `src/utils/filmProfiles.ts`,
  `src/hooks/useExportSettings.ts`, grain parts of
  `src/components/panel/right/ExportPanel.tsx`,
  `src-tauri/src/shaders/film_post.wgsl`, film/grain parts of
  `src-tauri/src/gpu_processing.rs` / `image_processing.rs` /
  `export_processing.rs` (`crystal_grain.rs`, `film_grain.rs`).
```

- [ ] **Step 2: Full verification**

Run:
```bash
npm run build
cd src-tauri && cargo check && cargo test
npx prettier --check src/utils/adjustments.ts src/components/adjustments/Grain.tsx src/components/panel/right/FilmPanel.tsx src/components/panel/right/ExportPanel.tsx src/hooks/useExportSettings.ts src/i18n/locales/en.json src/i18n/locales/ru.json AGENTS.md
```
Expected: build succeeds (no new TS errors), all Rust tests pass, prettier clean.

- [ ] **Step 3: Manual smoke test**

Run the app (`npm run tauri dev`) and verify:
1. Film tab → Grain section: eye toggle appears; toggling it off dims the content.
2. Segmented `Pierre | IPOL` toggle switches cards; switching back keeps each engine's params.
3. Amount slider visible in both modes; canvas shows grain only in Pierre mode with Amount > 0 (IPOL: canvas stays clean).
4. Close and reopen the image: the selected mode persists (sidecar).
5. Export panel: with grain section off (or flim panel off) the "Add film grain" switch is disabled with the hint; with grain on, the mode dropdown matches the editor engine; overriding the dropdown works until the image changes.
6. Export one image per mode (fast / pierre / ipol) and confirm grain appears in the output.

- [ ] **Checkpoint** — report to user; ask whether to commit.
