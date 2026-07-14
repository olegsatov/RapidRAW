# Tab Toggle Clean View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configurable `Tab` shortcut that toggles a clean view by hiding both sidebars and the filmstrip; restoring leaves the filmstrip off.

**Architecture:** Extend the existing `useUIStore` with a `toggleCleanView` action that snapshots and restores panel visibility. Register a new keybind `toggle_clean_view` in the existing keybind definitions and handle it in `useKeyboardShortcuts`. Layout components react to the same store values, so no UI component changes are needed.

**Tech Stack:** React, TypeScript, Zustand, i18next, Vite

---

## Files Changed

- `src/store/useUIStore.ts` — add `cleanViewActive`, `cleanViewSnapshot`, and `toggleCleanView`
- `src/utils/keyboardUtils.ts` — register `toggle_clean_view` keybind
- `src/hooks/useKeyboardShortcuts.ts` — handle the new action
- `src/App.tsx` — wrap `FolderTree` in `MotionConfig` to disable internal animations during toggle
- `src/components/panel/left/LeftBottomPanel.tsx` — wrap `PresetsBrowser` in `MotionConfig` to disable internal animations during toggle
- `src/components/views/EditorView.tsx` — wrap right panel content in `MotionConfig` to disable slide/fade animation during toggle
- `src/i18n/locales/*.json` — add `settings.keybinds.actions.toggle_clean_view` string

---

### Task 1: Add clean view state and toggle action to `useUIStore`

**Files:**

- Modify: `src/store/useUIStore.ts`

- [ ] **Step 1: Add new fields to the `UIState` interface**

Add these properties after `setCustomEscapeHandler` in the interface (around line 143):

```ts
  cleanViewActive: boolean;
  cleanViewSnapshot: {
    activeRightPanel: Panel | null;
    renderedRightPanel: Panel | null;
    isLibraryExportPanelVisible: boolean;
  } | null;
  toggleCleanView: () => void;
```

- [ ] **Step 2: Add initial state values**

Add after `setCustomEscapeHandler: (handler) => set({ customEscapeHandler: handler }),` in the store object:

```ts
  cleanViewActive: false,
  cleanViewSnapshot: null,
```

- [ ] **Step 3: Implement `toggleCleanView` action**

Add the action after the `setCustomEscapeHandler` line:

```ts
  toggleCleanView: () => {
    const state = get();
    if (state.cleanViewActive) {
      const snapshot = state.cleanViewSnapshot;
      if (!snapshot) return;
      set({
        isInstantTransition: true,
        cleanViewActive: false,
        cleanViewSnapshot: null,
        uiVisibility: {
          ...state.uiVisibility,
          folderTree: true,
          leftBottomPanel: true,
        },
        activeRightPanel: snapshot.activeRightPanel,
        renderedRightPanel: snapshot.renderedRightPanel,
        isLibraryExportPanelVisible: snapshot.isLibraryExportPanelVisible,
      });
      setTimeout(() => set({ isInstantTransition: false }), 400);
    } else {
      set({
        isInstantTransition: true,
        cleanViewActive: true,
        cleanViewSnapshot: {
          activeRightPanel: state.activeRightPanel,
          renderedRightPanel: state.renderedRightPanel,
          isLibraryExportPanelVisible: state.isLibraryExportPanelVisible,
        },
        uiVisibility: {
          ...state.uiVisibility,
          folderTree: false,
          leftBottomPanel: false,
          filmstrip: false,
        },
        activeRightPanel: null,
        isLibraryExportPanelVisible: false,
      });
      setTimeout(() => set({ isInstantTransition: false }), 400);
    }
  },
```

- [ ] **Step 4: Typecheck the store change**

Run:

```bash
npm run typecheck
```

Expected: no new errors related to `useUIStore.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/store/useUIStore.ts
git commit -m "add clean view state and toggle action to ui store"
```

---

### Task 2: Register `toggle_clean_view` keybind

**Files:**

- Modify: `src/utils/keyboardUtils.ts`

- [ ] **Step 1: Add the keybind definition**

Insert the following object into `KEYBIND_DEFINITIONS` after the `toggle_presets` entry (around line 189):

```ts
  {
    action: 'toggle_clean_view',
    description: 'settings.keybinds.actions.toggle_clean_view',
    defaultCombo: ['Tab'],
    section: 'panels',
  },
```

- [ ] **Step 2: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/utils/keyboardUtils.ts
git commit -m "register toggle_clean_view keybind"
```

---

### Task 3: Handle the new action in `useKeyboardShortcuts`

**Files:**

- Modify: `src/hooks/useKeyboardShortcuts.ts`

- [ ] **Step 1: Add the action handler**

Insert the following entry into the `actions` object after `toggle_presets` (around line 298):

```ts
      toggle_clean_view: {
        shouldFire: (s: any) => !s.ui.isFullScreen,
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.ui.toggleCleanView();
        },
      },
```

- [ ] **Step 2: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useKeyboardShortcuts.ts
git commit -m "handle toggle_clean_view keyboard shortcut"
```

---

### Task 4: Add locale strings

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

- [ ] **Step 1: Add English string**

In `src/i18n/locales/en.json`, add the following line after `"toggle_presets": "Toggle Presets panel",` (around line 1612):

```json
        "toggle_clean_view": "Toggle clean view",
```

- [ ] **Step 2: Add Russian string**

In `src/i18n/locales/ru.json`, add the following line after `"toggle_presets": "Панель пресетов",` (around line 1611):

```json
        "toggle_clean_view": "Переключить чистый вид",
```

- [ ] **Step 3: Add fallback strings for remaining locales**

For each of the remaining locale files, add the same English fallback after their `toggle_presets` entry:

```json
        "toggle_clean_view": "Toggle clean view",
```

Files:

- `src/i18n/locales/de.json`
- `src/i18n/locales/es.json`
- `src/i18n/locales/fr.json`
- `src/i18n/locales/it.json`
- `src/i18n/locales/ja.json`
- `src/i18n/locales/ko.json`
- `src/i18n/locales/pl.json`
- `src/i18n/locales/pt.json`
- `src/i18n/locales/zh-CN.json`
- `src/i18n/locales/zh-TW.json`

- [ ] **Step 4: Validate i18n**

Run:

```bash
npm run i18n:check
```

Expected: no missing-key errors for `toggle_clean_view`.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/locales/
git commit -m "add toggle_clean_view locale strings"
```

---

### Task 5: Disable folder tree internal animations during toggle

**Files:**

- Modify: `src/App.tsx`

- [ ] **Step 1: Import `MotionConfig`**

Add to the imports:

```ts
import { MotionConfig } from 'framer-motion';
```

- [ ] **Step 2: Wrap `FolderTree` in `MotionConfig`**

Wrap the `<FolderTree ... />` element in `src/App.tsx` with:

```tsx
<MotionConfig reducedMotion={isInstantTransition ? 'always' : 'user'}>
  <FolderTree ... />
</MotionConfig>
```

- [ ] **Step 3: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: no new errors.

---

### Task 6: Disable presets list internal animations during toggle

**Files:**

- Modify: `src/components/panel/left/LeftBottomPanel.tsx`

- [ ] **Step 1: Import `MotionConfig` and read `isInstantTransition`**

Add to the imports:

```ts
import { MotionConfig } from 'framer-motion';
```

Read `isInstantTransition` from the store:

```ts
const isInstantTransition = useUIStore((state) => state.isInstantTransition);
```

- [ ] **Step 2: Wrap `PresetsBrowser` in `MotionConfig`**

Wrap the `<PresetsBrowser isVisible={isVisible} />` element with:

```tsx
<MotionConfig reducedMotion={isInstantTransition ? 'always' : 'user'}>
  <PresetsBrowser isVisible={isVisible} />
</MotionConfig>
```

- [ ] **Step 3: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: no new errors.

---

### Task 7: Disable right sidebar content animation during toggle

**Files:**

- Modify: `src/components/views/EditorView.tsx`

- [ ] **Step 1: Import `MotionConfig`**

Add to the imports:

```ts
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
```

- [ ] **Step 2: Wrap right panel content in `MotionConfig`**

Wrap the `<AnimatePresence mode="wait" custom={slideDirection}>...</AnimatePresence>` block in `editorRightPanelContent` with:

```tsx
<MotionConfig reducedMotion={isInstantTransition ? 'always' : 'user'}>
  <AnimatePresence mode="wait" custom={slideDirection}>
    ...
  </AnimatePresence>
</MotionConfig>
```

- [ ] **Step 3: Disable the panel fade-in/fade-out**

On the inner `<motion.div>` that renders the panel content, set `initial` and `exit` to use the `animate` variant when instant:

```tsx
<motion.div
  animate="animate"
  className="h-full w-full"
  custom={slideDirection}
  exit={isInstantTransition ? 'animate' : 'exit'}
  initial={isInstantTransition ? 'animate' : 'initial'}
  key={renderedRightPanel}
  variants={panelVariants}
>
```

- [ ] **Step 4: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: no new errors.

---

### Task 8: Disable staggered list fade-in during toggle

**Files:**

- Modify: `src/components/presets/PresetsBrowser.tsx`
- Modify: `src/components/panel/FolderTree.tsx`

- [ ] **Step 1: Make `PresetsBrowser` item variants instant-aware**

Replace the static `itemVariants` object with a `getItemVariants(isInstantTransition)` factory. When `isInstantTransition` is `true`, set `transition: { duration: 0 }` and omit the per-item `delay`; otherwise keep the existing staggered fade-in.

Pass `isInstantTransition` into `PresetsBrowser` from `LeftBottomPanel` and use `getItemVariants(isInstantTransition)` for both folder and root preset rows.

- [ ] **Step 2: Make `FolderTree` list variants instant-aware**

In `TreeNode`, update `containerVariants` and `itemVariants` so that `transition.duration` is `0` when `isInstantTransition` is `true`. Force `initial="visible"` on child items and `initial="open"` on the children container during instant transitions.

Update the two inline `variants` objects used for pinned folders (around line 880) and regular folders (around line 1019) to use `duration: 0` when `isInstantTransition` is `true`.

Add `isInstantTransition: boolean` to `AlbumTreeNode` and pass it through recursively and from the root render. Convert the album group expand/collapse container and its children to `variants`, forcing `initial="open"`/`initial="visible"` and `duration: 0` during instant transitions. In the root albums list, convert the per-album `motion.div` to `variants` with `initial="visible"` and `duration: 0` during instant transitions, and disable `layout` animation (`layout={false}`) when instant.

- [ ] **Step 3: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: no new errors.

---

### Task 9: Format and final verification

**Files:**

- Modify: all files touched above

- [ ] **Step 1: Format changed files**

Run:

```bash
npx prettier --write src/store/useUIStore.ts src/utils/keyboardUtils.ts src/hooks/useKeyboardShortcuts.ts src/App.tsx src/components/panel/left/LeftBottomPanel.tsx src/components/views/EditorView.tsx src/i18n/locales/en.json src/i18n/locales/ru.json src/i18n/locales/de.json src/i18n/locales/es.json src/i18n/locales/fr.json src/i18n/locales/it.json src/i18n/locales/ja.json src/i18n/locales/ko.json src/i18n/locales/pl.json src/i18n/locales/pt.json src/i18n/locales/zh-CN.json src/i18n/locales/zh-TW.json
```

- [ ] **Step 2: Run final checks**

Run:

```bash
npm run typecheck
npm run build
```

Expected: `typecheck` reports no new errors and `build` completes successfully.

- [ ] **Step 3: Commit formatting fixes if any**

```bash
git diff --quiet || git commit -am "format clean view changes"
```

---

### Task 10: Manual testing

- [ ] **Step 1: Editor clean view**

Open an image in the editor. Press `Tab`.

Expected: left sidebar, right sidebar, and filmstrip hide instantly (no animation).

Press `Tab` again.

Expected: left and right sidebars reappear instantly; filmstrip stays hidden.

- [ ] **Step 2: Library clean view**

Switch to library view. Press `Tab`.

Expected: left folder tree and right export panel are hidden.

Press `Tab` again.

Expected: left folder tree and right export panel reappear.

- [ ] **Step 3: Keybind remap**

Open Settings → Keybinds, remap "Toggle clean view" to another key, and test.

Expected: the new key performs the same toggle.

- [ ] **Step 4: Disabled contexts**

Verify `Tab` does not toggle clean view while:

- a modal is open,
- an input/textarea is focused,
- the app is in fullscreen mode.

---

## Self-Review Checklist

- [ ] Spec coverage: every requirement from `docs/superpowers/specs/2026-07-14-tab-toggle-clean-view-design.md` maps to a task.
- [ ] Placeholder scan: no TBD/TODO/"implement later" in the plan.
- [ ] Type consistency: `toggleCleanView`, `cleanViewActive`, `cleanViewSnapshot`, and `toggle_clean_view` are named consistently across files.
