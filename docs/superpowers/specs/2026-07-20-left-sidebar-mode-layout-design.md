# Left sidebar layout per mode

## Goal

Change the left sidebar so that its content and bottom-panel height are independent for the gallery and editor modes:

- **Gallery mode** (`selectedImage === null`): top shows the folder/album tree (`FolderTree`), bottom panel stays empty.
- **Editor mode** (`selectedImage !== null`): top shows the presets browser (`PresetsBrowser`), bottom panel shows only the history panel (`HistoryPanel`) without tabs.
- The horizontal splitter height between the top and bottom parts of the left sidebar is persisted separately for each mode and across application restarts.

## Context

The current layout is implemented inline in `src/App.tsx` inside `renderFolderTree()`:

- The top part always renders `FolderTree`.
- The bottom part always renders `LeftBottomPanel`, which contains tabs for `PresetsBrowser` and `HistoryPanel`.
- A single `leftBottomPanelHeight` value controls the bottom-part height for both modes.

## Decision

Extract the whole left sidebar into a dedicated `LeftSidebar` component (option B from the brainstorming session). This keeps `App.tsx` focused on wiring and makes the mode-specific rendering explicit.

## Design

### New component: `src/components/panel/left/LeftSidebar.tsx`

Responsibilities:

- Render the entire left sidebar: top content, horizontal resizer, bottom content, vertical resizer.
- Switch top content based on `mode`:
  - `gallery` → `FolderTree`.
  - `editor` → `PresetsBrowser`.
- Switch bottom content when `leftBottomPanelVisible` is true:
  - `gallery` → empty container (preserves current behavior).
  - `editor` → `HistoryPanel` directly, no tabs.
- Apply the same transition/resize behavior that currently lives in `App.tsx`.

Props:

```ts
interface LeftSidebarProps {
  mode: 'gallery' | 'editor';
  isResizing: boolean;
  isInstantTransition: boolean;
  isFullScreen: boolean;
  leftPanelWidth: number;
  leftBottomPanelHeight: number;
  folderTreeVisible: boolean;
  leftBottomPanelVisible: boolean;
  createResizeHandler: (stateKey: string, startSize: number) => (e: ReactPointerEvent<HTMLDivElement>) => void;
  onFolderSelect: (path: string) => void;
  onToggleFolder: (path: string) => void;
  onSelectAlbum: (id: string, name: string, images: string[]) => void;
  onOpenFolder: () => void;
  onFolderTreeContextMenu: (e: any, path: string | null, isPinned?: boolean) => void;
  onAlbumTreeContextMenu: (e: any, item: AlbumItem | null) => void;
  setFolderTreeVisible: (visible: boolean) => void;
}
```

### Changes to `src/App.tsx`

- Remove the inline `renderFolderTree()` function.
- Remove direct imports of `FolderTree` and `LeftBottomPanel`.
- Import `LeftSidebar`.
- Compute mode and active bottom height:

```ts
const leftSidebarMode = selectedImage ? 'editor' : 'gallery';
const activeLeftBottomHeight = selectedImage
  ? leftBottomPanelHeightEditor
  : leftBottomPanelHeightGallery;
```

- Render `LeftSidebar` in place of the old markup, conditioned on `!shouldHideFolderTree && (hasRoots || selectedImage)`.
- Pass handlers already available from `useAppNavigation`, `useLibraryActions`, and `useAppContextMenus`.
- Update `createResizeHandler` for the `'leftBottom'` case to write into the mode-specific store key:

```ts
const heightKey = selectedImage ? 'leftBottomPanelHeightEditor' : 'leftBottomPanelHeightGallery';
setUI({ [heightKey]: Math.round(Math.max(120, Math.min(actualStartSize - (moveEvent.clientY - startY), maxHeight))) });
```

### Split heights in `src/store/useUIStore.ts`

Replace the single `leftBottomPanelHeight` with two values:

```ts
leftBottomPanelHeightGallery: number;
leftBottomPanelHeightEditor: number;
```

Default both to `0` (falls back to 50% of the container, matching current behavior).

### Persistence in Rust: `src-tauri/src/app_settings.rs`

Add two new persisted fields:

```rust
#[serde(default)]
pub left_bottom_panel_height_gallery: Option<u32>,
#[serde(default)]
pub left_bottom_panel_height_editor: Option<u32>,
```

Keep the old `left_bottom_panel_height` field (optional) to migrate existing user settings into the new fields on first load.

### Frontend settings type: `src/components/ui/AppProperties.tsx`

Add to `AppSettings`:

```ts
leftBottomPanelHeightGallery?: number;
leftBottomPanelHeightEditor?: number;
```

Keep `leftBottomPanelHeight?: number` as the legacy field for migration.

### Loading and saving: `src/hooks/useAppInitialization.ts`

On settings load:

```ts
const legacy = settings?.leftBottomPanelHeight;
const gallery = settings?.leftBottomPanelHeightGallery ?? legacy ?? 0;
const editor = settings?.leftBottomPanelHeightEditor ?? legacy ?? 0;
setUI({ leftBottomPanelHeightGallery: gallery, leftBottomPanelHeightEditor: editor });
```

Add two separate `useEffect` hooks that persist `leftBottomPanelHeightGallery` and `leftBottomPanelHeightEditor` into `appSettings` via `handleSettingsChange`. Remove the single `useEffect` that persisted the old `leftBottomPanelHeight`.

### Edge cases

- Switching modes happens when `selectedImage` changes; `LeftSidebar` re-renders with the other `mode` and the matching stored height.
- If `uiVisibility.leftBottomPanel` is false, the bottom part is hidden in both modes (Clean View behavior unchanged).
- If no root folders exist and no image is selected, the sidebar is not rendered.
- Legacy `leftBottomPanelHeight` is read once on load; afterward only the two new fields are written.

## Verification

- `npm run build` — frontend bundle builds without new errors.
- `cargo check` in `src-tauri/` — Rust compiles.
- `npx prettier --check` on modified files — formatting is clean.

## Files changed

- `src/components/panel/left/LeftSidebar.tsx` (new)
- `src/App.tsx`
- `src/store/useUIStore.ts`
- `src/hooks/useAppInitialization.ts`
- `src/components/ui/AppProperties.tsx`
- `src-tauri/src/app_settings.rs`
