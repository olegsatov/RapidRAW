# Left sidebar layout per mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the left sidebar into a mode-aware component that shows folders in gallery mode and presets/history in editor mode, with independent persisted bottom-panel heights for each mode.

**Architecture:** Add a new `LeftSidebar` component that owns the top content, horizontal resizer, and bottom content. `App.tsx` selects the mode from `selectedImage` and passes the active height. The Zustand store and Rust `AppSettings` keep two height values instead of one, migrating the legacy single value on first load.

**Tech Stack:** React, TypeScript, Tailwind CSS, Zustand, Tauri (Rust), Framer Motion.

---

## File map

| File | Responsibility |
|------|----------------|
| `src-tauri/src/app_settings.rs` | Persist `left_bottom_panel_height_gallery` and `left_bottom_panel_height_editor`; keep legacy field for migration. |
| `src/components/ui/AppProperties.tsx` | Frontend `AppSettings` type with the two new optional height fields. |
| `src/store/useUIStore.ts` | Replace single `leftBottomPanelHeight` with `leftBottomPanelHeightGallery` and `leftBottomPanelHeightEditor`. |
| `src/components/panel/left/LeftSidebar.tsx` | New component rendering the whole left sidebar with mode-specific content. |
| `src/App.tsx` | Wire `LeftSidebar`, compute active mode/height, update resize handler to write the mode-specific key. |
| `src/hooks/useAppInitialization.ts` | Load the two heights (with legacy fallback) and persist them separately. |

---

### Task 1: Add Rust persistence fields

**Files:**
- Modify: `src-tauri/src/app_settings.rs`

- [ ] **Step 1: Add new fields to `AppSettings`**

Find the existing `left_bottom_panel_height` field (around line 433) and add the two new fields after it:

```rust
    #[serde(default)]
    pub left_bottom_panel_height: Option<u32>,
    #[serde(default)]
    pub left_bottom_panel_height_gallery: Option<u32>,
    #[serde(default)]
    pub left_bottom_panel_height_editor: Option<u32>,
```

- [ ] **Step 2: Add defaults in `Default for AppSettings`**

In the `Default` impl, set all three to `None`:

```rust
            left_bottom_panel_height: None,
            left_bottom_panel_height_gallery: None,
            left_bottom_panel_height_editor: None,
```

- [ ] **Step 3: Verify Rust compiles**

Run:
```bash
cd src-tauri && cargo check
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/app_settings.rs
git commit -m "add split left-bottom panel heights to app settings"
```

---

### Task 2: Update frontend `AppSettings` type

**Files:**
- Modify: `src/components/ui/AppProperties.tsx`

- [ ] **Step 1: Add new optional fields**

In the `AppSettings` interface, keep the existing `leftBottomPanelHeight?: number;` and add the two new fields after it:

```ts
  leftBottomPanelHeight?: number;
  leftBottomPanelHeightGallery?: number;
  leftBottomPanelHeightEditor?: number;
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/AppProperties.tsx
git commit -m "add split left-bottom panel heights to AppSettings type"
```

---

### Task 3: Split heights in `useUIStore`

**Files:**
- Modify: `src/store/useUIStore.ts`

- [ ] **Step 1: Update the state interface**

Replace:
```ts
  leftBottomPanelHeight: number;
```
with:
```ts
  leftBottomPanelHeightGallery: number;
  leftBottomPanelHeightEditor: number;
```

- [ ] **Step 2: Update default state**

Replace:
```ts
  leftBottomPanelHeight: 0,
```
with:
```ts
  leftBottomPanelHeightGallery: 0,
  leftBottomPanelHeightEditor: 0,
```

- [ ] **Step 3: Commit**

```bash
git add src/store/useUIStore.ts
git commit -m "store separate left-bottom panel heights per mode"
```

---

### Task 4: Create `LeftSidebar` component

**Files:**
- Create: `src/components/panel/left/LeftSidebar.tsx`

- [ ] **Step 1: Write the component**

Create the file with the following content. It mirrors the current `App.tsx` sidebar markup but switches top/bottom content by `mode`.

```tsx
import { type PointerEvent as ReactPointerEvent } from 'react';
import { MotionConfig } from 'framer-motion';
import clsx from 'clsx';

import FolderTree from '../FolderTree';
import PresetsBrowser from '../../presets/PresetsBrowser';
import HistoryPanel from './HistoryPanel';
import Resizer from '../../ui/Resizer';

import { Orientation, AlbumItem } from '../../ui/AppProperties';

export interface LeftSidebarProps {
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

export default function LeftSidebar({
  mode,
  isResizing,
  isInstantTransition,
  isFullScreen,
  leftPanelWidth,
  leftBottomPanelHeight,
  folderTreeVisible,
  leftBottomPanelVisible,
  createResizeHandler,
  onFolderSelect,
  onToggleFolder,
  onSelectAlbum,
  onOpenFolder,
  onFolderTreeContextMenu,
  onAlbumTreeContextMenu,
  setFolderTreeVisible,
}: LeftSidebarProps) {
  const isEditor = mode === 'editor';

  return (
    <div
      className={clsx(
        'flex h-full overflow-hidden shrink-0',
        !isResizing && !isInstantTransition && 'transition-all duration-300 ease-in-out',
      )}
      style={{
        maxWidth: isFullScreen ? '0px' : '1000px',
        opacity: isFullScreen ? 0 : 1,
      }}
    >
      <div
        className="flex flex-col h-full"
        style={{ width: folderTreeVisible ? `${leftPanelWidth}px` : '32px' }}
      >
        <div className="flex-1 min-h-0 overflow-hidden">
          <MotionConfig reducedMotion={isInstantTransition ? 'always' : 'user'}>
            {isEditor ? (
              <PresetsBrowser isVisible={folderTreeVisible} isInstantTransition={isInstantTransition} />
            ) : (
              <FolderTree
                isResizing={isResizing}
                isVisible={folderTreeVisible}
                onContextMenu={onFolderTreeContextMenu}
                onAlbumContextMenu={onAlbumTreeContextMenu}
                onSelectAlbum={onSelectAlbum}
                onFolderSelect={onFolderSelect}
                onToggleFolder={onToggleFolder}
                onOpenFolder={onOpenFolder}
                setIsVisible={setFolderTreeVisible}
                style={{ width: '100%', height: '100%' }}
                isInstantTransition={isInstantTransition}
              />
            )}
          </MotionConfig>
        </div>
        {folderTreeVisible && leftBottomPanelVisible && (
          <>
            <Resizer
              direction={Orientation.Horizontal}
              onMouseDown={createResizeHandler('leftBottom', leftBottomPanelHeight)}
            />
            <div
              className="shrink-0 overflow-hidden"
              style={{ height: leftBottomPanelHeight > 0 ? `${leftBottomPanelHeight}px` : '50%' }}
            >
              {isEditor ? <HistoryPanel /> : <div className="flex flex-col h-full bg-bg-secondary rounded-lg" />}
            </div>
          </>
        )}
      </div>
      <Resizer direction={Orientation.Vertical} onMouseDown={createResizeHandler('left', leftPanelWidth)} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/panel/left/LeftSidebar.tsx
git commit -m "add LeftSidebar component with mode-specific content"
```

---

### Task 5: Wire `LeftSidebar` in `App.tsx`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Update imports**

Remove:
```ts
import FolderTree from './components/panel/FolderTree';
import LeftBottomPanel from './components/panel/left/LeftBottomPanel';
```

Add:
```ts
import LeftSidebar from './components/panel/left/LeftSidebar';
```

- [ ] **Step 2: Read split heights from store**

In the `useUIStore` destructuring (around line 116), replace:
```ts
    leftBottomPanelHeight,
```
with:
```ts
    leftBottomPanelHeightGallery,
    leftBottomPanelHeightEditor,
```

- [ ] **Step 3: Compute mode and active height**

After the `hasMainContent` calculation (around line 622), add:

```ts
  const leftSidebarMode = selectedImage ? 'editor' : 'gallery';
  const activeLeftBottomHeight = selectedImage
    ? leftBottomPanelHeightEditor
    : leftBottomPanelHeightGallery;
```

- [ ] **Step 4: Replace `renderFolderTree()` with `LeftSidebar` JSX**

Delete the entire `renderFolderTree` function (lines 624–679). Replace the call site:
```tsx
{!shouldHideFolderTree && renderFolderTree()}
```
with:
```tsx
{!shouldHideFolderTree && (hasRoots || selectedImage) && (
  <LeftSidebar
    mode={leftSidebarMode}
    isResizing={isResizing}
    isInstantTransition={isInstantTransition}
    isFullScreen={isFullScreen}
    leftPanelWidth={leftPanelWidth}
    leftBottomPanelHeight={activeLeftBottomHeight}
    folderTreeVisible={uiVisibility.folderTree}
    leftBottomPanelVisible={uiVisibility.leftBottomPanel}
    createResizeHandler={createResizeHandler}
    onFolderSelect={(path) => handleSelectSubfolder(path, false)}
    onToggleFolder={handleToggleFolder}
    onSelectAlbum={handleSelectAlbum}
    onOpenFolder={handleOpenFolder}
    onFolderTreeContextMenu={handleFolderTreeContextMenu}
    onAlbumTreeContextMenu={handleAlbumTreeContextMenu}
    setFolderTreeVisible={(value: boolean) =>
      setUI((state) => ({ uiVisibility: { ...state.uiVisibility, folderTree: value } }))
    }
  />
)}
```

- [ ] **Step 5: Make the bottom resizer write to the mode-specific key**

In `createResizeHandler`, find the `else if (stateKey === 'leftBottom')` block (around line 530) and replace:
```ts
        setUI({
          leftBottomPanelHeight: Math.round(
            Math.max(120, Math.min(actualStartSize - (moveEvent.clientY - startY), maxHeight)),
          ),
        });
```
with:
```ts
        const heightKey = selectedImage ? 'leftBottomPanelHeightEditor' : 'leftBottomPanelHeightGallery';
        setUI({
          [heightKey]: Math.round(
            Math.max(120, Math.min(actualStartSize - (moveEvent.clientY - startY), maxHeight)),
          ),
        });
```

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "wire LeftSidebar and mode-aware bottom height"
```

---

### Task 6: Load and save split heights

**Files:**
- Modify: `src/hooks/useAppInitialization.ts`

- [ ] **Step 1: Read split heights from store**

In the `useUIStore` destructuring (around line 101), replace:
```ts
    leftBottomPanelHeight,
```
with:
```ts
    leftBottomPanelHeightGallery,
    leftBottomPanelHeightEditor,
```

- [ ] **Step 2: Load heights with legacy fallback**

Find the block that loads `settings?.leftBottomPanelHeight` (around line 202) and replace:
```ts
        if (typeof settings?.leftBottomPanelHeight === 'number') {
          setUI({ leftBottomPanelHeight: settings.leftBottomPanelHeight });
        }
```
with:
```ts
        const legacyHeight = settings?.leftBottomPanelHeight;
        const galleryHeight = settings?.leftBottomPanelHeightGallery ?? legacyHeight ?? 0;
        const editorHeight = settings?.leftBottomPanelHeightEditor ?? legacyHeight ?? 0;
        setUI({ leftBottomPanelHeightGallery: galleryHeight, leftBottomPanelHeightEditor: editorHeight });
```

- [ ] **Step 3: Replace the single save effect with two separate effects**

Find the `useEffect` that persists `leftBottomPanelHeight` (around line 433) and replace it with:

```ts
  useEffect(() => {
    if (isInitialMount.current || !appSettings) return;
    if ((appSettings.leftBottomPanelHeightGallery ?? null) !== leftBottomPanelHeightGallery) {
      handleSettingsChange({ ...appSettings, leftBottomPanelHeightGallery });
    }
  }, [leftBottomPanelHeightGallery, appSettings, handleSettingsChange]);

  useEffect(() => {
    if (isInitialMount.current || !appSettings) return;
    if ((appSettings.leftBottomPanelHeightEditor ?? null) !== leftBottomPanelHeightEditor) {
      handleSettingsChange({ ...appSettings, leftBottomPanelHeightEditor });
    }
  }, [leftBottomPanelHeightEditor, appSettings, handleSettingsChange]);
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useAppInitialization.ts
git commit -m "load and persist split left-bottom panel heights"
```

---

### Task 7: Verify the implementation

- [ ] **Step 1: Frontend build**

Run:
```bash
npm run build
```
Expected: bundle completes. The repo has a pre-existing TypeScript baseline, so only **new** type errors caused by these changes are blockers.

- [ ] **Step 2: Rust check**

Run:
```bash
cd src-tauri && cargo check
```
Expected: no errors.

- [ ] **Step 3: Prettier check**

Run:
```bash
npx prettier --check \
  src/components/panel/left/LeftSidebar.tsx \
  src/App.tsx \
  src/store/useUIStore.ts \
  src/hooks/useAppInitialization.ts \
  src/components/ui/AppProperties.tsx \
  src-tauri/src/app_settings.rs
```
Expected: all files pass formatting.

- [ ] **Step 4: Manual sanity check**

1. Launch the app in gallery mode — left sidebar top should show folders, bottom should be empty.
2. Open an image — left sidebar top should switch to presets, bottom should show history without tabs.
3. Resize the bottom panel in editor mode, go back to gallery, resize it again, then return to editor — each mode should remember its own height.
4. Restart the app — heights should be restored.

- [ ] **Step 5: Final commit**

```bash
git add docs/superpowers/specs/2026-07-20-left-sidebar-mode-layout-design.md \
        docs/superpowers/plans/2026-07-20-left-sidebar-mode-layout-plan.md
# (the implementation files are already committed per task)
git commit -m "left sidebar layout per mode"
```

---

## Plan self-review

- **Spec coverage:** Every requirement from the spec has a task:
  - New `LeftSidebar` component → Task 4.
  - `App.tsx` wiring and mode-aware resize → Task 5.
  - Split heights in store → Task 3.
  - Rust persistence and frontend type → Tasks 1 and 2.
  - Loading/saving with legacy migration → Task 6.
  - Verification → Task 7.
- **Placeholder scan:** No TBDs, TODOs, or vague steps. Each step includes exact file paths and code.
- **Type consistency:**
  - Store keys: `leftBottomPanelHeightGallery`, `leftBottomPanelHeightEditor`.
  - Rust fields: `left_bottom_panel_height_gallery`, `left_bottom_panel_height_editor`.
  - TypeScript settings fields: `leftBottomPanelHeightGallery`, `leftBottomPanelHeightEditor`.
  - `createResizeHandler` writes the matching camelCase store key.
