# Flow cursor ring and mask-overlay visibility toggle

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dashed cursor ring for the Flow mask brush and a per-sub-mask toggle that hides/shows the red mask overlay.

**Architecture:** Extend the `SubMask` type with a UI-only `showOverlay` flag, default it to `false`, expose it as a switch in the mask-properties panel, and use it to gate the overlay image in `ImageCanvas`. Render an extra dashed `Circle` around the Flow cursor preview so the brush stays visible at low flow values.

**Tech Stack:** React, TypeScript, Tailwind, Konva (react-konva), Zustand, i18next, Rust/Tauri (no backend changes).

---

## File structure

| File | Responsibility |
|------|----------------|
| `src/components/panel/right/Masks.tsx` | `SubMask` interface and mask icon/type metadata. |
| `src/utils/maskUtils.ts` | Factory that creates new sub-masks. |
| `src/components/panel/right/MasksPanel.tsx` | Mask/component properties UI, including the new toggle. |
| `src/components/panel/editor/ImageCanvas.tsx` | Overlay rendering and brush cursor preview. |
| `src/i18n/locales/en.json` | Source locale string for the toggle label. |

---

## Task 1: Extend the SubMask type and factory

**Files:**
- Modify: `src/components/panel/right/Masks.tsx:59-68`
- Modify: `src/utils/maskUtils.ts:9-19`

- [ ] **Step 1: Add `showOverlay` to `SubMask`**

```ts
export interface SubMask {
  id: string;
  invert: boolean;
  mode: SubMaskMode;
  name?: string;
  opacity: number;
  parameters?: any;
  showOverlay?: boolean;
  type: Mask;
  visible: boolean;
}
```

- [ ] **Step 2: Default `showOverlay` to `false` in `createSubMask`**

Change the `common` object in `createSubMask` from:

```ts
const common = {
  id: uuidv4(),
  visible: true,
  invert: false,
  opacity: 100,
  mode,
  name: formatMaskTypeName(type),
  type,
};
```

To:

```ts
const common = {
  id: uuidv4(),
  visible: true,
  invert: false,
  opacity: 100,
  showOverlay: false,
  mode,
  name: formatMaskTypeName(type),
  type,
};
```

- [ ] **Step 3: Type-check the factory return types**

Run: `npx tsc --noEmit`
Expected: No new errors related to `showOverlay`.

---

## Task 2: Add the locale key

**Files:**
- Modify: `src/i18n/locales/en.json`

- [ ] **Step 1: Add the toggle label**

Locate the `editor.masks.settings` object and add:

```json
"showOverlay": "Show mask overlay"
```

- [ ] **Step 2: Run translation sync if the project has a script**

Check `package.json` for a translation script. If present, run it.
Otherwise, manually add the same key to the other locale files in `src/i18n/locales/`. Use the English string as a placeholder; translators can update later.

---

## Task 3: Add the overlay toggle to MasksPanel

**Files:**
- Modify: `src/components/panel/right/MasksPanel.tsx:2409-2416`

- [ ] **Step 1: Insert the switch above the invert switch**

Replace:

```tsx
<div className="space-y-4 pt-2">
  <Switch
    checked={!!(isComponentMode ? activeSubMask.invert : displayContainer.invert)}
    label={isComponentMode ? t('editor.masks.settings.invertComponent') : t('editor.masks.settings.invertMask')}
    onChange={(v) =>
      isComponentMode ? updateSubMask(activeSubMask.id, { invert: v }) : handleMaskPropertyChange('invert', v)
    }
  />
```

With:

```tsx
<div className="space-y-4 pt-2">
  {isComponentMode && (
    <Switch
      checked={!!activeSubMask.showOverlay}
      label={t('editor.masks.settings.showOverlay')}
      onChange={(v) => updateSubMask(activeSubMask.id, { showOverlay: v })}
    />
  )}
  <Switch
    checked={!!(isComponentMode ? activeSubMask.invert : displayContainer.invert)}
    label={isComponentMode ? t('editor.masks.settings.invertComponent') : t('editor.masks.settings.invertMask')}
    onChange={(v) =>
      isComponentMode ? updateSubMask(activeSubMask.id, { invert: v }) : handleMaskPropertyChange('invert', v)
    }
  />
```

- [ ] **Step 2: Verify the component renders**

Run: `npm run build`
Expected: Build completes without new errors.

---

## Task 4: Gate the red mask overlay on `showOverlay`

**Files:**
- Modify: `src/components/panel/editor/ImageCanvas.tsx:1771-1777`
- Modify: `src/components/panel/editor/ImageCanvas.tsx:2992-3008`

- [ ] **Step 1: Update the effect that sets `displayedMaskUrl`**

Change:

```ts
useEffect(() => {
  if (maskOverlayUrl && (isMasking || isAiEditing)) {
    setDisplayedMaskUrl(maskOverlayUrl);
  } else {
    setDisplayedMaskUrl(null);
  }
}, [maskOverlayUrl, isMasking, isAiEditing]);
```

To:

```ts
useEffect(() => {
  if (maskOverlayUrl && (isMasking || isAiEditing) && activeSubMask?.showOverlay) {
    setDisplayedMaskUrl(maskOverlayUrl);
  } else {
    setDisplayedMaskUrl(null);
  }
}, [maskOverlayUrl, isMasking, isAiEditing, activeSubMask?.showOverlay]);
```

- [ ] **Step 2: Defensive guard in the render block**

Change the condition wrapping the overlay `<img>` from:

```tsx
{displayedMaskUrl && (
```

To:

```tsx
{displayedMaskUrl && activeSubMask?.showOverlay && (
```

- [ ] **Step 3: Confirm overlay behavior**

Build and run the app. Select any mask sub-component. The red overlay should be hidden by default. Toggle "Show mask overlay" on — the overlay should appear. Toggle it off — it should disappear immediately.

---

## Task 5: Add a dashed cursor ring for Flow

**Files:**
- Modify: `src/components/panel/editor/ImageCanvas.tsx:3173-3193`

- [ ] **Step 1: Render an extra dashed circle for Flow**

After the existing cursor `Circle`, add a second one conditional on `activeSubMask?.type === Mask.Flow`:

```tsx
{isBrushActive &&
  cursorPreview.visible &&
  (!isManualCleanupActive ||
    (activeSubMask?.parameters?.sourceX !== undefined && !isCtrlPressed)) && (
    <>
      <Circle
        {...(brushCursorPreview.colorStops
          ? {
              fillRadialGradientColorStops: brushCursorPreview.colorStops,
              fillRadialGradientEndPoint: { x: 0, y: 0 },
              fillRadialGradientEndRadius: brushCursorPreview.radius,
              fillRadialGradientStartPoint: { x: 0, y: 0 },
              fillRadialGradientStartRadius: 0,
            }
          : { fill: brushCursorPreview.fill })}
        listening={false}
        perfectDrawEnabled={false}
        radius={brushCursorPreview.radius}
        x={cursorPreview.x}
        y={cursorPreview.y}
      />
      {activeSubMask?.type === Mask.Flow && (
        <Circle
          listening={false}
          perfectDrawEnabled={false}
          radius={brushCursorPreview.radius}
          stroke="rgba(255, 255, 255, 0.9)"
          strokeWidth={1}
          dash={[4, 4]}
          x={cursorPreview.x}
          y={cursorPreview.y}
        />
      )}
    </>
  )}
```

- [ ] **Step 2: Verify the Flow cursor**

Build and run. Select a Flow mask sub-component. A dashed white ring should appear around the cursor at all flow values, including 5 %. Switch to a regular Brush mask — the ring should not appear.

---

## Task 6: Build and type-check

- [ ] **Step 1: Frontend build**

Run: `npm run build`
Expected: No new errors.

- [ ] **Step 2: Rust check**

Run: `cargo check`
Expected: No errors.

- [ ] **Step 3: Prettier check on modified files**

Run: `npx prettier --check src/components/panel/right/Masks.tsx src/utils/maskUtils.ts src/components/panel/right/MasksPanel.tsx src/components/panel/editor/ImageCanvas.tsx src/i18n/locales/en.json`
Expected: All files pass formatting.

---

## Spec coverage check

| Spec requirement | Task |
|------------------|------|
| `showOverlay` in `SubMask` | Task 1 |
| Default `false` for all mask types | Task 1 |
| Toggle above invert switch | Task 3 |
| Toggle universal for all mask types | Task 3 (`isComponentMode` branch) |
| Overlay hidden by default | Task 4 |
| Dashed cursor ring for Flow | Task 5 |
| No backend changes | Tasks 1-5 (Rust only type-checked in Task 6) |

## Placeholder scan

No placeholders, TODOs, or open-ended steps remain. Every code change is shown in full.
