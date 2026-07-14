# Tab Toggle Clean View Design

## Goal

Add a single-key shortcut that toggles a "clean view" by hiding both sidebars and the filmstrip at once. The first press hides everything; the second press restores the left and right sidebars, but leaves the filmstrip hidden.

## Motivation

Users want a quick way to maximize the image viewing area without toggling each panel individually. `Tab` is unused in the current keymap, making it a natural choice for this convenience shortcut.

## Current State

- Panel visibility is controlled by `useUIStore`:
  - Left sidebar: `uiVisibility.folderTree` and `uiVisibility.leftBottomPanel`
  - Right sidebar (editor): `activeRightPanel`
  - Right sidebar (library): `isLibraryExportPanelVisible`
  - Filmstrip: `uiVisibility.filmstrip`
- Keyboard shortcuts are configured through `KEYBIND_DEFINITIONS` in `src/utils/keyboardUtils.ts` and handled in `src/hooks/useKeyboardShortcuts.ts`.
- `Tab` is not currently assigned to any shortcut.

## Design

### 1. Store State

Add to `useUIStore` (`src/store/useUIStore.ts`):

```ts
cleanViewActive: boolean;
cleanViewSnapshot: {
  activeRightPanel: Panel | null;
  renderedRightPanel: Panel | null;
  isLibraryExportPanelVisible: boolean;
} | null;
toggleCleanView: () => void;
```

Behavior of `toggleCleanView`:

- When entering clean view (`cleanViewActive === false`):
  1. Save the current values of `activeRightPanel`, `renderedRightPanel`, and `isLibraryExportPanelVisible` into `cleanViewSnapshot`.
  2. Set `isInstantTransition = true` for the duration of the layout change so panels hide instantly.
  3. Set `cleanViewActive = true`.
  4. Hide the left sidebar: `folderTree = false`, `leftBottomPanel = false`.
  5. Hide the right sidebar: `activeRightPanel = null`, `isLibraryExportPanelVisible = false`.
     Leave `renderedRightPanel` unchanged so the panel content is ready to reappear.
  6. Hide the filmstrip: `filmstrip = false`.
  7. After 400 ms, set `isInstantTransition = false` to restore normal panel animations.

- When exiting clean view (`cleanViewActive === true`):
  1. Set `isInstantTransition = true` for the duration of the layout change so panels reappear instantly.
  2. Restore the right sidebar from `cleanViewSnapshot`: `activeRightPanel`, `renderedRightPanel`, and `isLibraryExportPanelVisible`.
  3. Show the left sidebar: `folderTree = true`, `leftBottomPanel = true`.
  4. Set `cleanViewSnapshot = null`.
  5. Set `cleanViewActive = false`.
  6. Do **not** restore `filmstrip`; leave it as-is.
  7. After 400 ms, set `isInstantTransition = false` to restore normal panel animations.

### 2. Keyboard Binding

Add to `KEYBIND_DEFINITIONS` in `src/utils/keyboardUtils.ts`:

```ts
{
  action: 'toggle_clean_view',
  description: 'settings.keybinds.actions.toggle_clean_view',
  defaultCombo: ['Tab'],
  section: 'panels',
}
```

Add to `useKeyboardShortcuts.ts` actions map:

```ts
toggle_clean_view: {
  shouldFire: (s) => !s.ui.isFullScreen,
  execute: (e, s) => {
    e.preventDefault();
    s.ui.toggleCleanView();
  },
}
```

The existing guards in `useKeyboardShortcuts` already prevent firing when a modal is open or an input/textarea is focused, so no additional guard logic is needed.

### 3. Layout Integration

In `EditorView.tsx`, the right panel content is wrapped in `framer-motion`'s `MotionConfig` with `reducedMotion` tied to `isInstantTransition`, and the `motion.div` uses the `animate` variant for both `initial` and `exit` when instant, so the panel slide/fade animation is completely disabled during the toggle.

In `App.tsx`, the `FolderTree` is wrapped in `MotionConfig` the same way to disable internal folder-list animations. `LeftBottomPanel` wraps `PresetsBrowser` to disable presets-list animations.

Internal list animations that would otherwise produce a staggered fade-in (folders, pinned folders, albums, presets) are driven by `isInstantTransition`. During an instant transition their `framer-motion` `transition.duration` is set to `0`, `initial` is forced to the visible/open variant so children appear all at once instead of sequentially from top to bottom, and `layout` animation is disabled. The `TreeNode` container variants, `FolderTree` section wrappers (pinned/current/albums), `AlbumTreeNode` group container and children, the root albums list, and `PresetsBrowser` item variants all respect this flag.

The layout containers already react to `isInstantTransition`, so CSS width/opacity transitions are also suppressed.

### 4. Edge Cases

- **Fullscreen**: The shortcut is disabled while `isFullScreen` is true to avoid confusing state transitions. The user can use the existing fullscreen shortcut (`F`) first if they want an immersive view.
- **Library view**: `activeRightPanel` is irrelevant; `isLibraryExportPanelVisible` is hidden. The left folder tree is hidden. Filmstrip is not shown in library view, so it has no effect.
- **Manual panel changes during clean view**: If the user opens the folder tree manually while clean view is active, the presets block stays hidden because `leftBottomPanel` is still false. The next `Tab` press exits clean view and restores both left and right sidebars.
- **Filmstrip already off**: Entering clean view sets it to off again (idempotent). Exiting clean view never turns it back on.

### 5. Localization

Add the key `settings.keybinds.actions.toggle_clean_view` to all locale files under `src/i18n/locales/*.json`. Use English as the fallback string for all locales; a Russian translation can be added for `ru.json`.

### 6. Files Changed

- `src/store/useUIStore.ts`
- `src/utils/keyboardUtils.ts`
- `src/hooks/useKeyboardShortcuts.ts`
- `src/App.tsx`
- `src/components/panel/left/LeftBottomPanel.tsx`
- `src/components/views/EditorView.tsx`
- `src/i18n/locales/en.json`
- `src/i18n/locales/ru.json`
- `src/i18n/locales/*.json` (remaining locale files)

## Testing Plan

1. Open an image in the editor. Press `Tab` — left sidebar, right sidebar, and filmstrip should hide.
2. Press `Tab` again — left and right sidebars should reappear; filmstrip should stay hidden.
3. Switch to library view. Press `Tab` — left folder tree and right export panel should hide. Press `Tab` again — they should reappear.
4. Remap the action to a different key in settings and verify it still works.
5. Verify `Tab` does not trigger clean view while an input, modal, or fullscreen is active.
