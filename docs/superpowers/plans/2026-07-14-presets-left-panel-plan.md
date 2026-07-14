# Presets Left Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the RapidRAW Presets UI from the right panel into a resizable bottom panel of the left sidebar with horizontal tabs.

**Architecture:** Extract the presets list/DnD/modals/preview logic into a reusable `PresetsBrowser` component, add a `LeftBottomPanel` shell with a horizontal tab bar, split the left column vertically inside `App.tsx`, persist the new panel height in Tauri settings, remove the Presets tab from the right panel, and rebind the `P` key to toggle the new left bottom panel.

**Tech Stack:** React, TypeScript, Tailwind CSS, Zustand, `@dnd-kit`, Framer Motion, Tauri (Rust), Prettier.

---

## File map

| File | Responsibility |
|------|----------------|
| `src/components/ui/AppProperties.tsx` | New `LeftPanelTab` enum, `UiVisibility.leftBottomPanel`, `AppSettings.leftBottomPanelHeight`. |
| `src-tauri/src/app_settings.rs` | Rust `AppSettings.left_bottom_panel_height` field. |
| `src/store/useUIStore.ts` | New dimensions/visibility/tab state, remove `Panel.Presets` from right panel order. |
| `src/hooks/useAppInitialization.ts` | Load/save `leftBottomPanelHeight` and `uiVisibility.leftBottomPanel`; fallback saved `activeRightPanel` from `Presets`. |
| `src/components/presets/PresetsBrowser.tsx` | Extracted presets UI (list, DnD, modals, previews). |
| `src/components/panel/right/PresetsPanel.tsx` | Thin wrapper over `PresetsBrowser` for upstream compatibility. |
| `src/components/panel/left/LeftPanelTabs.tsx` | Horizontal tab bar for the bottom-left panel. |
| `src/components/panel/left/LeftBottomPanel.tsx` | Shell: tab bar + active tab content. |
| `src/App.tsx` | Vertical split of the left column (FolderTree + Resizer + LeftBottomPanel). |
| `src/components/panel/right/RightPanelSwitcher.tsx` | Remove Presets icon from the right switcher. |
| `src/components/views/EditorView.tsx` | Remove `PresetsPanel` branch from right panel content. |
| `src/hooks/useKeyboardShortcuts.ts` | Rebind `P` to toggle `uiVisibility.leftBottomPanel`. |

---

### Task 1: Types and settings schema

**Files:**
- Modify: `src/components/ui/AppProperties.tsx`

- [ ] **Step 1: Add `LeftPanelTab` enum after `Panel`**

```ts
export enum LeftPanelTab {
  Presets = 'presets',
}
```

- [ ] **Step 2: Extend `UiVisibility` with `leftBottomPanel`**

```ts
export interface UiVisibility {
  folderTree: boolean;
  filmstrip: boolean;
  leftBottomPanel: boolean;
}
```

- [ ] **Step 3: Add `leftBottomPanelHeight` to `AppSettings`**

```ts
export interface AppSettings {
  // ... existing fields ...
  leftBottomPanelHeight?: number;
  // ...
}
```

- [ ] **Step 4: Run typecheck to catch import errors early**

```bash
npm run build
```

Expected: only pre-existing errors; no new ones caused by these type changes.

---

### Task 2: Rust settings schema

**Files:**
- Modify: `src-tauri/src/app_settings.rs`

- [ ] **Step 1: Add `left_bottom_panel_height` to the `AppSettings` struct**

Add inside `pub struct AppSettings { ... }`:

```rust
#[serde(default)]
pub left_bottom_panel_height: Option<u32>,
```

- [ ] **Step 2: Add default value in `Default` impl**

Inside `impl Default for AppSettings { fn default() -> Self { Self { ... } } }` add:

```rust
left_bottom_panel_height: None,
```

- [ ] **Step 3: Check Rust side**

```bash
cd src-tauri && cargo check
```

Expected: clean (no new errors).

---

### Task 3: UI store state

**Files:**
- Modify: `src/store/useUIStore.ts`

- [ ] **Step 1: Update imports to include `LeftPanelTab`**

```ts
import { ImageFile, LibraryViewMode, Panel, UiVisibility, CullingSuggestions, LeftPanelTab } from '../components/ui/AppProperties';
```

- [ ] **Step 2: Remove `Panel.Presets` from right panel order**

```ts
const RIGHT_PANEL_ORDER = [
  Panel.Metadata,
  Panel.Adjustments,
  Panel.Crop,
  Panel.Film,
  Panel.Masks,
  Panel.Ai,
  Panel.Export,
];
```

- [ ] **Step 3: Add new fields to `UIState` interface**

```ts
  // Dimensions
  leftPanelWidth: number;
  rightPanelWidth: number;
  bottomPanelHeight: number;
  leftBottomPanelHeight: number;
  compactEditorPanelHeightOverride: number | null;

  // Right Panel
  activeRightPanel: Panel | null;
  renderedRightPanel: Panel | null;

  // Left Bottom Panel
  activeLeftBottomTab: LeftPanelTab;
```

- [ ] **Step 4: Add defaults in store creation**

```ts
  leftPanelWidth: 256,
  rightPanelWidth: 320,
  bottomPanelHeight: 144,
  leftBottomPanelHeight: 0,
```

```ts
  uiVisibility: { folderTree: true, filmstrip: true, leftBottomPanel: true },
```

```ts
  activeRightPanel: Panel.Adjustments,
  renderedRightPanel: Panel.Adjustments,
  activeLeftBottomTab: LeftPanelTab.Presets,
```

- [ ] **Step 5: Guard `setRightPanel` against unknown panels**

```ts
  setRightPanel: (panelId) => {
    if (panelId && !RIGHT_PANEL_ORDER.includes(panelId)) return;
    const current = get().activeRightPanel;
    if (panelId === current) {
      set({ activeRightPanel: null });
    } else {
      const currentIndex = current ? RIGHT_PANEL_ORDER.indexOf(current) : -1;
      const newIndex = panelId ? RIGHT_PANEL_ORDER.indexOf(panelId) : -1;
      set({
        slideDirection: newIndex > currentIndex ? 1 : -1,
        activeRightPanel: panelId,
        renderedRightPanel: panelId,
      });
    }
  },
```

- [ ] **Step 6: Run build**

```bash
npm run build
```

Expected: no new errors.

---

### Task 4: App initialization persistence

**Files:**
- Modify: `src/hooks/useAppInitialization.ts`

- [ ] **Step 1: Destructure `leftBottomPanelHeight` from `useUIStore`**

Update the `useUIStore` selector block to also pull:

```ts
const { uiVisibility, activeRightPanel, leftBottomPanelHeight, setUI } = useUIStore(
  useShallow((state) => ({
    uiVisibility: state.uiVisibility,
    activeRightPanel: state.activeRightPanel,
    leftBottomPanelHeight: state.leftBottomPanelHeight,
    setUI: state.setUI,
  })),
);
```

- [ ] **Step 2: Load saved height on startup**

Inside the `invoke(Invokes.LoadSettings).then(...)` block, after the `uiVisibility` block, add:

```ts
if (typeof settings?.leftBottomPanelHeight === 'number') {
  setUI({ leftBottomPanelHeight: settings.leftBottomPanelHeight });
}
```

- [ ] **Step 3: Persist `leftBottomPanelHeight` changes**

After the existing active-right-panel persistence effect, add:

```ts
  useEffect(() => {
    if (isInitialMount.current || !appSettings) return;
    if ((appSettings.leftBottomPanelHeight ?? null) !== leftBottomPanelHeight) {
      handleSettingsChange({ ...appSettings, leftBottomPanelHeight });
    }
  }, [leftBottomPanelHeight, appSettings, handleSettingsChange]);
```

- [ ] **Step 4: Fallback saved `activeRightPanel === Panel.Presets`**

Find the existing block:

```ts
if (settings?.activeRightPanel && Object.values(Panel).includes(settings.activeRightPanel)) {
  setUI({ activeRightPanel: settings.activeRightPanel, renderedRightPanel: settings.activeRightPanel });
}
```

Replace with:

```ts
if (settings?.activeRightPanel && Object.values(Panel).includes(settings.activeRightPanel)) {
  const panel = settings.activeRightPanel === Panel.Presets ? Panel.Adjustments : settings.activeRightPanel;
  setUI({ activeRightPanel: panel, renderedRightPanel: panel });
}
```

- [ ] **Step 5: Run build**

```bash
npm run build
```

Expected: no new errors.

---

### Task 5: Extract `PresetsBrowser`

**Files:**
- Create: `src/components/presets/PresetsBrowser.tsx`
- Modify: `src/components/panel/right/PresetsPanel.tsx`

- [ ] **Step 1: Copy existing PresetsPanel to new location**

```bash
cp src/components/panel/right/PresetsPanel.tsx src/components/presets/PresetsBrowser.tsx
```

- [ ] **Step 2: Fix relative imports in `PresetsBrowser.tsx`**

Run these `sed` replacements from repo root:

```bash
sed -i '' 's|../../../hooks/|../../hooks/|g' src/components/presets/PresetsBrowser.tsx
sed -i '' 's|../../../context/|../../context/|g' src/components/presets/PresetsBrowser.tsx
sed -i '' 's|../../../store/|../../store/|g' src/components/presets/PresetsBrowser.tsx
sed -i '' 's|../../../types/|../../types/|g' src/components/presets/PresetsBrowser.tsx
sed -i '' 's|../../../utils/|../../utils/|g' src/components/presets/PresetsBrowser.tsx
sed -i '' 's|../../ui/|../ui/|g' src/components/presets/PresetsBrowser.tsx
sed -i '' 's|../../modals/|../modals/|g' src/components/presets/PresetsBrowser.tsx
```

- [ ] **Step 3: Update `PresetsBrowser` props and visibility logic**

In `src/components/presets/PresetsBrowser.tsx`:

1. Remove `Panel` from the `AppProperties` import if still present.
2. Replace the interface block:

```ts
interface PresetsBrowserProps {
  isVisible: boolean;
  onNavigateToCommunity?(): void;
}
```

3. Replace the default function signature:

```ts
export default function PresetsBrowser({ isVisible, onNavigateToCommunity }: PresetsBrowserProps) {
```

4. Remove this line:

```ts
const activePanel = useUIStore((s) => s.activeRightPanel);
```

5. In the preview-generating `useEffect` (currently using `activePanel === Panel.Presets`), replace the condition:

```ts
if (isVisible && selectedImage?.isReady && presets.length > 0) {
```

6. Update the effect dependency array: replace `activePanel` with `isVisible`.

- [ ] **Step 4: Turn `PresetsPanel.tsx` into a thin wrapper**

Replace the entire contents of `src/components/panel/right/PresetsPanel.tsx` with:

```tsx
import PresetsBrowser from '../../presets/PresetsBrowser';

interface PresetsPanelProps {
  onNavigateToCommunity(): void;
}

export default function PresetsPanel({ onNavigateToCommunity }: PresetsPanelProps) {
  return <PresetsBrowser isVisible onNavigateToCommunity={onNavigateToCommunity} />;
}
```

- [ ] **Step 5: Run build**

```bash
npm run build
```

Expected: no new errors.

---

### Task 6: Build `LeftPanelTabs`

**Files:**
- Create: `src/components/panel/left/LeftPanelTabs.tsx`

- [ ] **Step 1: Create the tab bar component**

```tsx
import { SwatchBook } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LeftPanelTab } from '../../ui/AppProperties';
import Text from '../../ui/Text';
import { TextColors, TextVariants, TextWeights } from '../../../types/typography';

interface TabDef {
  id: LeftPanelTab;
  icon: typeof SwatchBook;
  labelKey: string;
}

const TABS: TabDef[] = [
  { id: LeftPanelTab.Presets, icon: SwatchBook, labelKey: 'editor.presets.title' },
];

interface LeftPanelTabsProps {
  activeTab: LeftPanelTab;
  onSelect(tab: LeftPanelTab): void;
}

export default function LeftPanelTabs({ activeTab, onSelect }: LeftPanelTabsProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 border-b border-surface shrink-0">
      {TABS.map(({ id, icon: Icon, labelKey }) => {
        const isActive = activeTab === id;
        return (
          <button
            key={id}
            onClick={() => onSelect(id)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors ${
              isActive
                ? 'bg-surface text-text-primary'
                : 'text-text-secondary hover:bg-surface hover:text-text-primary'
            }`}
          >
            <Icon size={14} />
            <Text
              variant={TextVariants.small}
              color={isActive ? TextColors.primary : TextColors.secondary}
              weight={isActive ? TextWeights.medium : TextWeights.regular}
            >
              {t(labelKey)}
            </Text>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Run build**

```bash
npm run build
```

Expected: no new errors.

---

### Task 7: Build `LeftBottomPanel`

**Files:**
- Create: `src/components/panel/left/LeftBottomPanel.tsx`

- [ ] **Step 1: Create the shell component**

```tsx
import { LeftPanelTab } from '../../ui/AppProperties';
import { useUIStore } from '../../../store/useUIStore';
import LeftPanelTabs from './LeftPanelTabs';
import PresetsBrowser from '../../presets/PresetsBrowser';

interface LeftBottomPanelProps {
  onNavigateToCommunity(): void;
}

export default function LeftBottomPanel({ onNavigateToCommunity }: LeftBottomPanelProps) {
  const { uiVisibility, activeLeftBottomTab, setUI } = useUIStore((state) => ({
    uiVisibility: state.uiVisibility,
    activeLeftBottomTab: state.activeLeftBottomTab,
    setUI: state.setUI,
  }));

  const handleTabSelect = (tab: LeftPanelTab) => {
    setUI({ activeLeftBottomTab: tab });
  };

  const isVisible = uiVisibility.leftBottomPanel;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-bg-secondary rounded-lg">
      <LeftPanelTabs activeTab={activeLeftBottomTab} onSelect={handleTabSelect} />
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeLeftBottomTab === LeftPanelTab.Presets && (
          <PresetsBrowser isVisible={isVisible} onNavigateToCommunity={onNavigateToCommunity} />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run build**

```bash
npm run build
```

Expected: no new errors.

---

### Task 8: Vertical split in `App.tsx`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Import `LeftBottomPanel` and `LeftPanelTab`**

Add near the top imports:

```tsx
import LeftBottomPanel from './components/panel/left/LeftBottomPanel';
import { LeftPanelTab } from './components/ui/AppProperties';
```

- [ ] **Step 2: Add `leftBottomPanelHeight` to the UI store selector**

In the first `useUIStore` selector block, add:

```ts
leftBottomPanelHeight: state.leftBottomPanelHeight,
```

and destructure it alongside `leftPanelWidth`, etc.

- [ ] **Step 3: Add horizontal resize branch**

In `createResizeHandler`, add a branch before `compact`:

```ts
} else if (stateKey === 'leftBottom') {
  const container = (e.target as HTMLDivElement).parentElement?.parentElement;
  const maxHeight = container ? container.clientHeight - 120 : 800;
  setUI({
    leftBottomPanelHeight: Math.round(Math.max(120, Math.min(startSize - (moveEvent.clientY - startY), maxHeight))),
  });
```

- [ ] **Step 4: Rewrite `renderFolderTree()` to split vertically**

Replace the current `renderFolderTree` implementation with:

```tsx
  const renderFolderTree = () => {
    if (!hasRoots) return null;

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
        <div className="flex flex-col h-full" style={{ width: uiVisibility.folderTree ? `${leftPanelWidth}px` : '32px' }}>
          <div className="flex-1 min-h-0 overflow-hidden">
            <FolderTree
              isResizing={isResizing}
              isVisible={uiVisibility.folderTree}
              onContextMenu={handleFolderTreeContextMenu}
              onAlbumContextMenu={handleAlbumTreeContextMenu}
              onSelectAlbum={handleSelectAlbum}
              onFolderSelect={(path) => handleSelectSubfolder(path, false)}
              onToggleFolder={handleToggleFolder}
              onOpenFolder={handleOpenFolder}
              setIsVisible={(value: boolean) =>
                setUI((state) => ({ uiVisibility: { ...state.uiVisibility, folderTree: value } }))
              }
              style={{ width: '100%', height: '100%' }}
              isInstantTransition={isInstantTransition}
            />
          </div>
          {uiVisibility.folderTree && (
            <>
              <Resizer direction={Orientation.Horizontal} onMouseDown={createResizeHandler('leftBottom', leftBottomPanelHeight)} />
              <div
                className="shrink-0 overflow-hidden"
                style={{ height: leftBottomPanelHeight > 0 ? `${leftBottomPanelHeight}px` : '50%' }}
              >
                <LeftBottomPanel
                  onNavigateToCommunity={() => {
                    handleBackToLibrary();
                    setUI({ activeView: 'community' });
                  }}
                />
              </div>
            </>
          )}
        </div>
        <Resizer direction={Orientation.Vertical} onMouseDown={createResizeHandler('left', leftPanelWidth)} />
      </div>
    );
  };
```

Make sure `FolderTree` accepts `style` with `height: '100%'` — it already accepts a generic `style` prop.

- [ ] **Step 5: Run build**

```bash
npm run build
```

Expected: no new errors.

---

### Task 9: Remove Presets from right panel switcher

**Files:**
- Modify: `src/components/panel/right/RightPanelSwitcher.tsx`

- [ ] **Step 1: Remove Presets from imports and panel groups**

Update imports to remove `SwatchBook`:

```tsx
import {
  SlidersHorizontal,
  Info,
  Crop,
  Film,
  Layers,
  Paintbrush,
  FileInput,
  type LucideIcon,
} from 'lucide-react';
```

Update `panelGroups`:

```tsx
const panelGroups: Array<Array<PanelOptions>> = [
  [{ id: Panel.Metadata, icon: Info, title: 'editor.switcher.tooltips.info' }],
  [
    { id: Panel.Adjustments, icon: SlidersHorizontal, title: 'editor.switcher.tooltips.adjust' },
    { id: Panel.Crop, icon: Crop, title: 'editor.switcher.tooltips.crop' },
    { id: Panel.Film, icon: Film, title: 'editor.switcher.tooltips.film' },
    { id: Panel.Masks, icon: Layers, title: 'editor.switcher.tooltips.masks' },
    { id: Panel.Ai, icon: Paintbrush, title: 'editor.switcher.tooltips.inpaint' },
  ],
  [{ id: Panel.Export, icon: FileInput, title: 'editor.switcher.tooltips.export' }],
];
```

- [ ] **Step 2: Run build**

```bash
npm run build
```

Expected: no new errors.

---

### Task 10: Remove Presets from `EditorView`

**Files:**
- Modify: `src/components/views/EditorView.tsx`

- [ ] **Step 1: Remove `PresetsPanel` import**

Delete:

```tsx
import PresetsPanel from '../panel/right/PresetsPanel';
```

- [ ] **Step 2: Remove Presets branch from `editorRightPanelContent`**

Delete the block:

```tsx
{renderedRightPanel === Panel.Presets && (
  <PresetsPanel
    onNavigateToCommunity={() => {
      handleBackToLibrary();
      setUI({ activeView: 'community' });
    }}
  />
)}
```

- [ ] **Step 3: Run build**

```bash
npm run build
```

Expected: no new errors.

---

### Task 11: Rebind `P` shortcut

**Files:**
- Modify: `src/hooks/useKeyboardShortcuts.ts`

- [ ] **Step 1: Import `LeftPanelTab`**

```ts
import { ImageFile, Panel, ExifOverlay, LeftPanelTab } from '../components/ui/AppProperties';
```

- [ ] **Step 2: Replace `toggle_presets` action**

Replace the existing `toggle_presets` block with:

```ts
      toggle_presets: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.ui.setUI({
            uiVisibility: {
              ...s.ui.uiVisibility,
              leftBottomPanel: !s.ui.uiVisibility.leftBottomPanel,
            },
            activeLeftBottomTab: LeftPanelTab.Presets,
          });
        },
      },
```

- [ ] **Step 3: Run build**

```bash
npm run build
```

Expected: no new errors.

---

### Task 12: Final verification

- [ ] **Step 1: TypeScript / frontend build**

```bash
npm run build
```

Expected: completes; only pre-existing errors allowed.

- [ ] **Step 2: Rust check**

```bash
cd src-tauri && cargo check
```

Expected: clean.

- [ ] **Step 3: Prettier check on changed files**

```bash
npx prettier --check \
  src/components/ui/AppProperties.tsx \
  src/store/useUIStore.ts \
  src/hooks/useAppInitialization.ts \
  src/components/presets/PresetsBrowser.tsx \
  src/components/panel/right/PresetsPanel.tsx \
  src/components/panel/left/LeftPanelTabs.tsx \
  src/components/panel/left/LeftBottomPanel.tsx \
  src/App.tsx \
  src/components/panel/right/RightPanelSwitcher.tsx \
  src/components/views/EditorView.tsx \
  src/hooks/useKeyboardShortcuts.ts
```

Expected: all files pass Prettier.

- [ ] **Step 4: Manual UI smoke test**

Run the app (`npm run tauri dev` or equivalent), then:

1. Open an image.
2. Confirm the right panel switcher has **no** Presets icon.
3. Confirm the left sidebar is split vertically with FolderTree on top and a Presets tab below.
4. Apply a preset from the bottom-left panel — image should update.
5. Drag the horizontal resizer — bottom panel height should change and persist after restart.
6. Press `P` — bottom panel should toggle visible/hidden.
7. Expand a folder in the presets panel — previews should generate.

---

## Self-review checklist

- [ ] **Spec coverage:** Every spec requirement (new left panel, tabs, resizer, persistence, remove right tab, rebind P, preview generation) maps to at least one task above.
- [ ] **Placeholder scan:** No "TBD", "TODO", "implement later", or vague instructions remain.
- [ ] **Type consistency:** `leftBottomPanelHeight`, `LeftPanelTab`, `uiVisibility.leftBottomPanel`, and `activeLeftBottomTab` names match across TypeScript, Rust, and all components.
