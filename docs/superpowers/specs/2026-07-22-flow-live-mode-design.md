# Flow live mode toggle

## Problem

The **Flow** mask brush applies its adjustment effect only after the mouse button
is released. While drawing, the user sees nothing (especially with the mask
overlay hidden), so it's hard to judge the result in real time.

## Goal

Add an optional **live mode** for the Flow mask tool. When enabled, the
adjustment effect is applied continuously while the stroke is being drawn, so
the user can see the result immediately.

## Non-goals

- Changing the default behavior of Flow.
- Enabling live mode for Brush, Clone, or Heal.
- Adding throttling/debouncing in the first iteration.
- Modifying the Rust/GPU processing pipeline itself.

## Design

### 1. Data model

Add a new optional boolean field to the `SubMask` interface:

```ts
// src/components/panel/right/Masks.tsx
export interface SubMask {
  id: string;
  invert: boolean;
  liveMode?: boolean; // NEW
  mode: SubMaskMode;
  name?: string;
  opacity: number;
  parameters?: any;
  showOverlay?: boolean;
  type: Mask;
  visible: boolean;
}
```

- `liveMode` is **per sub-mask**.
- Default is `false` (overlay hidden, effect applied on mouse-up).

Update `createSubMask` in `src/utils/maskUtils.ts` to set `liveMode: false`
for every mask type.

### 2. UI toggle

Location: `src/components/panel/right/MasksPanel.tsx`, inside the
"Mask/Component Properties" collapsible section, **next to** the existing
`showOverlay` switch.

```tsx
{activeSubMask?.type === Mask.Flow && (
  <Switch
    checked={!!activeSubMask.liveMode}
    label={t('editor.masks.settings.liveMode')}
    onChange={(v) => updateSubMask(activeSubMask.id, { liveMode: v })}
  />
)}
```

- The toggle is shown only when the selected sub-mask is `Mask.Flow`.
- New locale key: `editor.masks.settings.liveMode`.

### 3. Live drawing behavior

In `src/components/panel/editor/ImageCanvas.tsx`:

#### On mouse down

When starting a Flow stroke and `liveMode` is enabled, reserve the stroke index:

```ts
activeStrokeIndex.current = activeSubMask.parameters?.lines?.length ?? 0;
```

This mirrors the behavior already used by Clone/Heal.

#### On mouse move

When `activeSubMask.type === Mask.Flow && activeSubMask.liveMode`:

1. Build the current image-space line from `currentLine.current`.
2. Replace the line at `activeStrokeIndex.current` instead of appending a new
   one.
3. Call `updateSubMask(activeId, { parameters: { ...activeSubMask.parameters, lines: updatedLines } })`.
4. Skip `onLiveMaskPreview` — the full image processing will already render the
   effect, so the red overlay is redundant and would double the backend work.

#### On mouse up

The existing `handleUp` logic already replaces the line at
`activeStrokeIndex.current` when it is not `null`. The final line is therefore
already correct; the existing code simply finalizes the stroke and clears
`currentLine`.

### 4. Cursor and overlay

- The dashed Flow cursor ring remains visible regardless of `liveMode`.
- The `showOverlay` toggle remains independent. With `liveMode` on, the user
  will see the actual adjustment effect live, so overlay can stay off.

## Files touched

- `src/components/panel/right/Masks.tsx` — add `liveMode` to `SubMask`.
- `src/utils/maskUtils.ts` — default `liveMode: false`.
- `src/components/panel/right/MasksPanel.tsx` — add the toggle switch.
- `src/components/panel/editor/ImageCanvas.tsx` — live drawing logic.
- `src/i18n/locales/en.json` (and others) — add `editor.masks.settings.liveMode`.

## Verification

- `npm run build` passes.
- `cargo check` in `src-tauri/` passes.
- With `liveMode` off, Flow behaves exactly as before.
- With `liveMode` on, the adjustment effect updates continuously while drawing.
- The line array does not grow while the mouse is held down.
