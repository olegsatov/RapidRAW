# Flow live mode toggle

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-sub-mask "live mode" toggle for the Flow mask brush so the adjustment effect is applied continuously while drawing.

**Architecture:** Extend `SubMask` with a UI-only `liveMode` flag, expose it next to `showOverlay` in the mask properties panel, and wire it into `ImageCanvas` so that Flow strokes call `updateSubMask` on every pointer move instead of only on mouse-up.

**Tech Stack:** React, TypeScript, Tailwind, Konva (react-konva), Zustand, i18next, Rust/Tauri (no backend changes).

---

## File structure

| File | Responsibility |
|------|----------------|
| `src/components/panel/right/Masks.tsx` | `SubMask` interface. |
| `src/utils/maskUtils.ts` | Factory that creates new sub-masks. |
| `src/components/panel/right/MasksPanel.tsx` | Mask/component properties UI, including the new toggle. |
| `src/components/panel/editor/ImageCanvas.tsx` | Drawing logic for Flow live mode. |
| `src/i18n/locales/en.json` | Source locale string for the toggle label. |

---

## Task 1: Extend the SubMask type and factory defaults

**Files:**
- Modify: `src/components/panel/right/Masks.tsx`
- Modify: `src/utils/maskUtils.ts`

- [ ] **Step 1: Add `liveMode` to `SubMask`**

```ts
export interface SubMask {
  id: string;
  invert: boolean;
  liveMode?: boolean;
  mode: SubMaskMode;
  name?: string;
  opacity: number;
  parameters?: any;
  showOverlay?: boolean;
  type: Mask;
  visible: boolean;
}
```

- [ ] **Step 2: Default `liveMode` to `false` in `createSubMask`**

Change the `common` object from:

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

To:

```ts
const common = {
  id: uuidv4(),
  visible: true,
  invert: false,
  opacity: 100,
  showOverlay: false,
  liveMode: false,
  mode,
  name: formatMaskTypeName(type),
  type,
};
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: No new errors.

---

## Task 2: Add the locale key

**Files:**
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/de.json`
- Modify: `src/i18n/locales/es.json`
- Modify: `src/i18n/locales/fr.json`
- Modify: `src/i18n/locales/it.json`
- Modify: `src/i18n/locales/ja.json`
- Modify: `src/i18n/locales/ko.json`
- Modify: `src/i18n/locales/pl.json`
- Modify: `src/i18n/locales/pt.json`
- Modify: `src/i18n/locales/ru.json`
- Modify: `src/i18n/locales/zh-CN.json`
- Modify: `src/i18n/locales/zh-TW.json`

- [ ] **Step 1: Add the toggle label**

Inside `editor.masks.settings` of each locale file, add:

```json
"liveMode": "Live mode"
```

Use the English string as a placeholder for non-English locales.

- [ ] **Step 2: Verify JSON validity**

Run: `node -e "require('fs').readdirSync('src/i18n/locales').forEach(f => JSON.parse(require('fs').readFileSync('src/i18n/locales/' + f)))"`
Expected: No errors.

---

## Task 3: Add the live mode toggle to MasksPanel

**Files:**
- Modify: `src/components/panel/right/MasksPanel.tsx`

- [ ] **Step 1: Insert the Flow-only switch next to `showOverlay`**

Locate the `showOverlay` switch added earlier (around line 2410) and add the
`liveMode` switch immediately after it, still inside the `{isComponentMode && (...)}`
block:

```tsx
{activeSubMask?.type === Mask.Flow && (
  <Switch
    checked={!!activeSubMask.liveMode}
    label={t('editor.masks.settings.liveMode')}
    onChange={(v) => updateSubMask(activeSubMask.id, { liveMode: v })}
  />
)}
```

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: No new errors.

---

## Task 4: Reserve stroke index on mouse down for Flow live mode

**Files:**
- Modify: `src/components/panel/editor/ImageCanvas.tsx`

- [ ] **Step 1: Find the brush mouse-down handler**

The relevant code is inside the pointer-down handler (`handleMouseDown` / stage
`onMouseDown`), around line 2157 where `activeStrokeIndex.current = null` is set.

- [ ] **Step 2: Reserve index when Flow live mode is active**

After:

```ts
isDrawing.current = true;
activeStrokeIndex.current = null;
drawingStageRef.current = stage;
```

Add:

```ts
if (activeSubMask?.type === Mask.Flow && activeSubMask?.liveMode) {
  activeStrokeIndex.current = activeSubMask.parameters?.lines?.length ?? 0;
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: No new errors.

---

## Task 5: Update the mask on every pointer move in Flow live mode

**Files:**
- Modify: `src/components/panel/editor/ImageCanvas.tsx`

- [ ] **Step 1: Locate the `onLiveMaskPreview` branch in `handleMove`**

It is around line 2372 inside the `if (currentLine.current)` block:

```ts
} else if (onLiveMaskPreview && activeContainer && activeSubMask && isBrushActive) {
  // ... builds previewSubMask and calls onLiveMaskPreview(previewContainer)
}
```

- [ ] **Step 2: Replace preview with live update for Flow live mode**

Change the branch condition from:

```ts
} else if (onLiveMaskPreview && activeContainer && activeSubMask && isBrushActive) {
```

To:

```ts
} else if (activeSubMask?.type === Mask.Flow && activeSubMask?.liveMode && activeId) {
  const { scale } = imageRenderSize;

  const imageSpaceLine: DrawnLine = {
    brushSize: brushImageSpaceSize,
    feather: brushSettings?.feather ? brushSettings?.feather / 100 : 0,
    flow: activeLineFlow,
    points: updatedLine.points.map((p: Coord) => ({
      x: p.x / scale + cropX,
      y: p.y / scale + cropY,
    })),
    tool: updatedLine.tool,
  };

  const existingLines = activeSubMask?.parameters?.lines ? [...activeSubMask.parameters.lines] : [];

  if (activeStrokeIndex.current !== null) {
    existingLines[activeStrokeIndex.current] = imageSpaceLine;
  }

  updateSubMask(activeId, {
    parameters: {
      ...activeSubMask?.parameters,
      lines: existingLines,
    },
  });
} else if (onLiveMaskPreview && activeContainer && activeSubMask && isBrushActive) {
```

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: No new errors.

---

## Task 6: Verify handleUp works with the reserved stroke index

**Files:**
- Modify: `src/components/panel/editor/ImageCanvas.tsx` (read-only verification)

- [ ] **Step 1: Confirm existing finalization logic**

In `handleUp` (around line 2530), the existing code already checks
`activeStrokeIndex.current`:

```ts
if (activeStrokeIndex.current !== null) {
  existingLines[activeStrokeIndex.current] = imageSpaceLine;
} else {
  existingLines.push(imageSpaceLine);
}
```

Because Task 4 reserved the index, the final mouse-up will replace the same
slot. No code change is required here.

- [ ] **Step 2: Ensure `activeStrokeIndex` is reset after finalization**

Confirm the existing code resets it:

```ts
activeStrokeIndex.current = null;
```

If it is missing, add it immediately after the `updateSubMask` call in `handleUp`.

---

## Task 7: Build, type-check, and format verification

- [ ] **Step 1: Frontend build**

Run: `npm run build`
Expected: No new errors.

- [ ] **Step 2: Rust check**

Run: `cargo check`
Expected: No errors.

- [ ] **Step 3: Prettier check**

Run: `npx prettier --check src/components/panel/right/Masks.tsx src/utils/maskUtils.ts src/components/panel/right/MasksPanel.tsx src/components/panel/editor/ImageCanvas.tsx src/i18n/locales/en.json`
Expected: All files pass formatting.

- [ ] **Step 4: Manual behavior check**

Run the app and test Flow with `liveMode` off and on:
- Off: effect appears only after mouse-up (previous behavior).
- On: effect updates continuously while drawing.
- The line array should not grow while the mouse is held down.

---

## Spec coverage check

| Spec requirement | Task |
|------------------|------|
| `liveMode` in `SubMask` | Task 1 |
| Default `false` for all mask types | Task 1 |
| Toggle next to `showOverlay`, only for Flow | Task 3 |
| Reserve stroke index on mouse down | Task 4 |
| Replace line and call `updateSubMask` on move | Task 5 |
| Existing `handleUp` finalizes correctly | Task 6 |

## Placeholder scan

No placeholders, TODOs, or open-ended steps remain. Every code change is shown in full.
