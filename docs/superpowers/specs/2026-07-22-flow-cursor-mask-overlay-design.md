# Flow cursor ring and mask-overlay visibility toggle

## Problem

The **Flow** mask brush is meant for very subtle, low-opacity strokes (e.g. 5 %).
Two things make it hard to use right now:

1. The on-canvas brush cursor is almost invisible at low flow values because its
   fill opacity is multiplied by the flow amount.
2. The live red mask overlay is always shown while a mask is active. For Flow
   this blocks the user's ability to see the subtle adjustment they are painting.

## Goals

- Make the Flow brush cursor clearly visible regardless of flow value.
- Let the user hide the red mask overlay per sub-mask.
- Keep the change local to the frontend; no backend behavior changes.

## Non-goals

- Changing how Flow softness/feather is rendered.
- Changing the mask generation logic on the Rust side.
- Adding overlay opacity slider or mask color customization.

## Design

### 1. Data model

Add a new optional boolean field to the `SubMask` interface:

```ts
// src/components/panel/right/Masks.tsx
export interface SubMask {
  id: string;
  invert: boolean;
  mode: SubMaskMode;
  name?: string;
  opacity: number;
  parameters?: any;
  showOverlay?: boolean; // NEW
  type: Mask;
  visible: boolean;
}
```

- `showOverlay` is **per sub-mask**.
- Default is `false` (overlay hidden) for all mask types.
- The Rust `SubMask` struct does not list this field, but Serde ignores unknown
  fields by default, so no backend changes are required.

Update `createSubMask` in `src/utils/maskUtils.ts` to set `showOverlay: false`
for every mask type.

### 2. Mask-overlay visibility toggle

Location: `src/components/panel/right/MasksPanel.tsx`, inside the
"Mask/Component Properties" collapsible section, **above** the existing invert
switch.

```tsx
<Switch
  checked={!!activeSubMask.showOverlay}
  label={t('editor.masks.settings.showOverlay')}
  onChange={(v) => updateSubMask(activeSubMask.id, { showOverlay: v })}
/>
```

- The toggle is shown while a sub-mask is selected (`isComponentMode === true`).
- It is universal: the same control appears for every mask type (Flow, Brush,
  Radial, AI subject, etc.).
- New locale key: `editor.masks.settings.showOverlay`.

### 3. Overlay rendering

In `src/components/panel/editor/ImageCanvas.tsx` the red overlay is rendered
from `displayedMaskUrl`. Change the render condition so the overlay image is
only shown when the active sub-mask has `showOverlay === true`.

Also update the effect that sets `displayedMaskUrl` so that toggling the switch
off clears the overlay immediately without waiting for a new backend response.

### 4. Flow cursor ring

In `src/components/panel/editor/ImageCanvas.tsx`, where the brush cursor
preview circle is rendered, add a second `Circle` when the active sub-mask is
`Mask.Flow`:

- Radius equals `brushCursorPreview.radius`.
- Stroke: `rgba(255, 255, 255, 0.9)`.
- `strokeWidth={1}`.
- `dash={[4, 4]}` for a dashed ring.
- `listening={false}` and `perfectDrawEnabled={false}` for performance.
- The inner gradient/fill circle stays in place so the user still sees brush
  size and feather.

The ring is only shown for Flow; Brush/Clone/Heal keep their current cursor.

## Files touched

- `src/components/panel/right/Masks.tsx` — add `showOverlay` to `SubMask`.
- `src/utils/maskUtils.ts` — default `showOverlay: false`.
- `src/components/panel/right/MasksPanel.tsx` — add the toggle switch.
- `src/components/panel/editor/ImageCanvas.tsx` — conditional overlay and Flow
  cursor ring.
- `src/i18n/locales/en.json` (and others) — add `editor.masks.settings.showOverlay`.

## Verification

- `npm run build` passes.
- `cargo check` in `src-tauri/` passes.
- Flow cursor shows a dashed ring at any flow value.
- The red mask overlay is hidden by default and appears only when the toggle is
  on for the active sub-mask.
- Toggle works for any mask type (e.g. Radial, Brush, AI subject).
