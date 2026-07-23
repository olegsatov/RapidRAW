# Lights Off Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Lightroom-style "Lights Off" toggle bound to the `L` key that shows only the current image on a completely black screen while preserving the proof margin.

**Architecture:** A single transient flag `lightsOffActive` lives in `useUIStore`. Components that render editor chrome (`App.tsx`, `EditorView.tsx`, `Editor.tsx`) read the flag and hide themselves or switch to a black background. The existing `proofMargin` / `useImageRenderSize` logic is reused unchanged.

**Tech Stack:** React, TypeScript, Tailwind CSS, Zustand, Framer Motion, Tauri (WGPU renderer).

---

## Files to create or modify

| File | Responsibility |
|------|----------------|
| `src/store/useUIStore.ts` | New `lightsOffActive` flag and `toggleLightsOff()` action. |
| `src/utils/keyboardUtils.ts` | Register `toggle_lights_off` action with default `KeyL`. |
| `src/hooks/useKeyboardShortcuts.ts` | Handler for `L`; Escape exits Lights Off first. |
| `src/components/ui/AppProperties.tsx` | Add `'l'` to `GLOBAL_KEYS`. |
| `src/App.tsx` | Hide title bar and outer padding when Lights Off is active. |
| `src/components/views/EditorView.tsx` | Hide bottom bar and right panel when Lights Off is active. |
| `src/components/panel/Editor.tsx` | Hide toolbar, remove rounded corners, force black background (CSS + WGPU). |
| `src/i18n/locales/*.json` | Add `settings.keybinds.actions.toggle_lights_off` key. |

---

## Task 1: Add `lightsOffActive` to `useUIStore`

**Files:**
- Modify: `src/store/useUIStore.ts:95-167` (interface), `src/store/useUIStore.ts:169-179` (initial state), `src/store/useUIStore.ts:290-329` (actions)

- [ ] **Step 1: Add state fields to the `UIState` interface**

  Insert after `cleanViewActive` / `cleanViewSnapshot` / `toggleCleanView` (around line 166):

  ```ts
  lightsOffActive: boolean;
  toggleLightsOff: () => void;
  ```

- [ ] **Step 2: Add initial state values**

  Insert after `cleanViewSnapshot: null,` (line 178):

  ```ts
  lightsOffActive: false,
  ```

- [ ] **Step 3: Add the `toggleLightsOff` action**

  Insert after the closing `},` of `toggleCleanView` (after line 329):

  ```ts
  toggleLightsOff: () => {
    set((state) => ({ lightsOffActive: !state.lightsOffActive }));
  },
  ```

- [ ] **Step 4: Verify the store compiles**

  Run: `npx tsc --noEmit src/store/useUIStore.ts`
  Expected: no new errors (repo has a pre-existing red baseline; only check for new ones).

---

## Task 2: Register the keyboard shortcut definition

**Files:**
- Modify: `src/utils/keyboardUtils.ts:108-118` (after `toggle_fullscreen`)

- [ ] **Step 1: Insert the new definition**

  Add immediately after the `toggle_fullscreen` definition (after line 112):

  ```ts
  {
    action: 'toggle_lights_off',
    description: 'settings.keybinds.actions.toggle_lights_off',
    defaultCombo: ['KeyL'],
    section: 'view',
  },
  ```

---

## Task 3: Add the shortcut handler and Escape precedence

**Files:**
- Modify: `src/hooks/useKeyboardShortcuts.ts:278-284` (after `show_original`), `src/hooks/useKeyboardShortcuts.ts:529-548` (Escape builtin)

- [ ] **Step 1: Insert the `toggle_lights_off` action handler**

  Add after the `show_original` handler (after line 284):

  ```ts
  toggle_lights_off: {
    shouldFire: (s: any) => !!s.editor.selectedImage,
    execute: (e: any) => {
      e.preventDefault();
      useUIStore.getState().toggleLightsOff();
    },
  },
  ```

- [ ] **Step 2: Make Escape exit Lights Off first**

  In the Escape builtin shortcut (around line 530), change the `execute` body so the first check is Lights Off:

  ```ts
  execute: (e: KeyboardEvent, s: any) => {
    e.preventDefault();
    if (s.ui.lightsOffActive) {
      s.ui.toggleLightsOff();
      return;
    }
    if (s.editor.isStraightenActive) s.editor.setEditor({ isStraightenActive: false });
    else if (s.ui.customEscapeHandler) s.ui.customEscapeHandler();
    else if (s.editor.activeAiSubMaskId) s.editor.setEditor({ activeAiSubMaskId: null });
    else if (s.editor.activeAiPatchContainerId) s.editor.setEditor({ activeAiPatchContainerId: null });
    else if (s.editor.activeMaskId) s.editor.setEditor({ activeMaskId: null });
    else if (s.editor.activeMaskContainerId) s.editor.setEditor({ activeMaskContainerId: null });
    else if (s.ui.activeRightPanel === Panel.Crop) {
      const snapshot = s.ui.cropSessionSnapshot;
      if (snapshot && snapshot.imagePath === (s.editor.selectedImage?.path ?? null)) {
        const newAdjustments = { ...s.editor.adjustments, ...snapshot.adjustments };
        s.editor.setEditor({ adjustments: newAdjustments });
        debouncedSetHistory(newAdjustments, Panel.Crop);
      }
      s.ui.setRightPanel(s.ui.panelBeforeCrop === undefined ? Panel.Adjustments : s.ui.panelBeforeCrop);
    } else if (s.ui.isFullScreen) handleToggleFullScreen();
    else if (s.editor.selectedImage) handleBackToLibrary();
  },
  ```

---

## Task 4: Prevent `L` from typing in inputs

**Files:**
- Modify: `src/components/ui/AppProperties.tsx:5-29`

- [ ] **Step 1: Add `'l'` to `GLOBAL_KEYS`**

  Insert `'l'` after `'p'` (around line 19):

  ```ts
  'l',
  ```

---

## Task 5: Hide chrome in `App.tsx`

**Files:**
- Modify: `src/App.tsx:101-133` (store selector), `src/App.tsx:641-655` (title bar / padding)

- [ ] **Step 1: Read `lightsOffActive` from the store**

  Add `lightsOffActive` to the `useUIStore` selector (around line 116):

  ```ts
  lightsOffActive: state.lightsOffActive,
  ```

- [ ] **Step 2: Hide the title bar when Lights Off is active**

  Update the title-bar wrapper class (around line 644) to also collapse when `lightsOffActive` is true:

  ```ts
  isFullScreen || lightsOffActive ? 'max-h-0 opacity-0 pointer-events-none' : 'max-h-[60px] opacity-100',
  ```

- [ ] **Step 3: Remove outer padding when Lights Off is active**

  Update the outer content class (around line 654):

  ```ts
  [hasMainContent && ((isFullScreen || lightsOffActive) ? 'p-0 gap-0' : 'p-px gap-px')],
  ```

---

## Task 6: Hide panels in `EditorView.tsx`

**Files:**
- Modify: `src/components/views/EditorView.tsx:95-117` (store selector), `src/components/views/EditorView.tsx:189-267` (panel visibility styles)

- [ ] **Step 1: Read `lightsOffActive` from the store**

  Add it to the `useUIStore` selector (around line 104):

  ```ts
  lightsOffActive: state.lightsOffActive,
  ```

- [ ] **Step 2: Collapse the bottom bar in Lights Off**

  Update the bottom-bar wrapper style (around line 196):

  ```ts
  maxHeight: isFullScreen || lightsOffActive ? '0px' : '500px',
  opacity: isFullScreen || lightsOffActive ? 0 : 1,
  ```

- [ ] **Step 3: Collapse the right panel in Lights Off**

  Update the right-panel wrapper styles for both compact and desktop layouts (around line 258 and 264):

  ```ts
  isCompactPortrait
    ? {
        height: isFullScreen || lightsOffActive
          ? '0px'
          : `${activeRightPanel ? compactEditorPanelHeight : compactEditorPanelCollapsedHeight}px`,
        opacity: isFullScreen || lightsOffActive ? 0 : 1,
      }
    : {
        maxWidth: isFullScreen || lightsOffActive ? '0px' : '1000px',
        opacity: isFullScreen || lightsOffActive ? 0 : 1,
      }
  ```

---

## Task 7: Black background and hidden toolbar in `Editor.tsx`

**Files:**
- Modify: `src/components/panel/Editor.tsx:82-89` (store selector), `src/components/panel/Editor.tsx:1102-1139` (WGPU bg), `src/components/panel/Editor.tsx:2040-2098` (render)

- [ ] **Step 1: Read `lightsOffActive` from the store**

  Add it near the other UI store reads (around line 87):

  ```ts
  const lightsOffActive = useUIStore((s) => s.lightsOffActive);
  ```

- [ ] **Step 2: Force WGPU background to black in Lights Off**

  In the `wgpuStateRef` default (around line 1102), change the default colors to derive from a memoized black-when-lights-off value. First add a memo near `editorBackgroundColor` (around line 2038):

  ```ts
  const isLightsOff = lightsOffActive;
  ```

  Then update the `useEffect` that builds `wgpuStateRef.current` (around line 1113) so the parsed colors are black when `isLightsOff` is true:

  ```ts
  const bgPrimaryStr = isLightsOff ? 'rgb(0, 0, 0)' : rootStyle.getPropertyValue('--app-bg-primary') || 'rgb(24, 24, 24)';
  const bgSecondaryStr = isLightsOff
    ? 'rgb(0, 0, 0)'
    : appSettings?.editorBackgroundColor || rootStyle.getPropertyValue('--app-bg-secondary') || 'rgb(35, 35, 35)';
  ```

  Also update the default `wgpuStateRef` initial values (around line 1109) to use `[0, 0, 0, 1]` instead of the gray defaults so the first frame before the effect runs is also black when Lights Off is active. Because the effect runs immediately, this is optional, but keep it consistent.

- [ ] **Step 3: Update outer editor wrapper for Lights Off**

  Change the outer `div` class (around line 2042) from:

  ```ts
  isFullScreen
    ? 'rounded-none p-0 gap-0'
    : clsx(
        'rounded-lg p-px gap-px',
        appSettings?.useWgpuRenderer !== false ? 'bg-transparent' : 'bg-bg-secondary',
      ),
  ```

  to:

  ```ts
  isFullScreen || isLightsOff
    ? 'rounded-none p-0 gap-0'
    : clsx(
        'rounded-lg p-px gap-px',
        appSettings?.useWgpuRenderer !== false ? 'bg-transparent' : 'bg-bg-secondary',
      ),
  ```

- [ ] **Step 4: Hide the editor toolbar in Lights Off**

  Update the toolbar wrapper class (around line 2053):

  ```ts
  isFullScreen || isLightsOff ? 'max-h-0 opacity-0 m-0' : 'max-h-25 opacity-100',
  ```

- [ ] **Step 5: Make the image container background black in Lights Off**

  Update the image container class (around line 2083). Add a black background class when Lights Off is active:

  ```ts
  'flex-1 relative overflow-hidden touch-none',
  isFullScreen || isLightsOff ? 'rounded-none' : 'rounded-lg',
  appSettings?.useWgpuRenderer !== false && !isFullScreen && !isLightsOff && 'ring-[9999px]',
  !isWgpuActive && (isLightsOff ? 'bg-black' : 'bg-bg-secondary'),
  ```

  Update the inline style (around line 2090) to force black when Lights Off is active:

  ```ts
  style={
    {
      cursor: cursorStyle,
      backgroundColor: !isWgpuActive
        ? isLightsOff
          ? '#000000'
          : editorBackgroundColor
        : undefined,
      '--tw-ring-color':
        appSettings?.useWgpuRenderer !== false && !isFullScreen && !isLightsOff ? editorBackgroundColor : '#000000',
    } as React.CSSProperties
  }
  ```

- [ ] **Step 6: Hide overlays in Lights Off**

  Wrap the `GestureOverlay` and `LutStripOverlay` so they are not rendered when Lights Off is active (around line 2178):

  ```ts
  {!isLightsOff && <GestureOverlay />}
  {!isLightsOff && <LutStripOverlay />}
  ```

---

## Task 8: Add locale strings

**Files:**
- Modify: `src/i18n/locales/en.json`, `src/i18n/locales/ru.json`, and the other 10 locale files.

- [ ] **Step 1: Find the `settings.keybinds.actions` object**

  Search for `"toggle_clean_view"` in each file and add the new key right after it.

- [ ] **Step 2: Add the English entry**

  In `src/i18n/locales/en.json`:

  ```json
  "toggle_lights_off": "Toggle lights off",
  ```

- [ ] **Step 3: Add the Russian entry**

  In `src/i18n/locales/ru.json`:

  ```json
  "toggle_lights_off": "Включить/выключить затемнение",
  ```

- [ ] **Step 4: Add the entry to all other locales**

  For the remaining locale files, use the English string as a fallback:

  ```json
  "toggle_lights_off": "Toggle lights off",
  ```

  Locale files to update: `de.json`, `es.json`, `fr.json`, `it.json`, `ja.json`, `ko.json`, `pl.json`, `pt.json`, `zh-CN.json`, `zh-TW.json`.

---

## Task 9: Build and verify

- [ ] **Step 1: Build the frontend**

  Run: `npm run build`
  Expected: completes without new errors.

- [ ] **Step 2: Check Rust side**

  Run: `cd src-tauri && cargo check`
  Expected: no new errors (this change does not touch Rust).

- [ ] **Step 3: Format changed files**

  Run: `npx prettier --write src/store/useUIStore.ts src/utils/keyboardUtils.ts src/hooks/useKeyboardShortcuts.ts src/components/ui/AppProperties.tsx src/App.tsx src/components/views/EditorView.tsx src/components/panel/Editor.tsx 'src/i18n/locales/*.json'`
  Expected: all files are already formatted or reformatted cleanly.

---

## Spec coverage self-review

| Spec requirement | Plan task |
|------------------|-----------|
| Transient `lightsOffActive` flag in `useUIStore` | Task 1 |
| Hotkey `L` registered and handled | Tasks 2, 3, 4 |
| Escape exits Lights Off first | Task 3 |
| Title bar / outer padding hidden | Task 5 |
| Bottom bar / right panel hidden | Task 6 |
| Toolbar hidden, black background (CSS + WGPU) | Task 7 |
| Proof margin preserved (no changes to margin logic) | — (no code change required) |
| Locale strings added | Task 8 |
| Build verification | Task 9 |

No placeholders or unresolved dependencies remain.
