# Persistent Per-Image Undo History + History Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make undo/redo history survive image switches (per-image, up to 100 entries), show it in a new "History" tab in the left bottom panel, and (Phase 2) persist it in the SQLite library catalog.

**Architecture:** Phase 1 (this branch, independent of the catalog work happening in parallel on `main`): an in-memory LRU cache `path -> { history, historyIndex }` (`src/utils/historyCache.ts`) that is written on image switch / editor exit and read on image load, plus a self-contained `HistoryPanel` tab reusing the existing toolbar history-naming logic extracted into `src/hooks/useHistoryNames.ts`. Phase 2 (after the parallel session's SQLite catalog lands and is rebased into this branch): a schema v2 migration adding an `edit_history` table, Rust load/save operations with unit tests, Tauri commands, and a debounced frontend persistence layer that upgrades the in-memory cache to an L1 cache.

**Tech Stack:** React 18 + zustand + TypeScript (frontend), Tauri v2 + rusqlite (backend, Phase 2 only).

**Repo constraints (from AGENTS.md):** new features in new files; surgical edits to shared upstream files (`useAppNavigation.ts`, `useImageLoader.ts`, `EditorToolbar.tsx`, `AppProperties.tsx`, locale JSONs); no cosmetic changes; commit style is lowercase, concise, no conventional-commit prefixes; commit only when the user asks.

**Verification baseline:** `npm run build` must pass; `npx prettier --check <changed files>` must pass; `npm run i18n:check` must pass after locale edits; `tsc` and eslint have pre-existing red baselines — judge only by *new* errors. There is no frontend test runner in this repo, so Phase 1 verification is build + manual QA checklist (Task 8). Phase 2 Rust code gets `cargo test` unit tests following the existing pattern in `src-tauri/src/library_db.rs:143-168`.

---

## Current-state map (from codebase recon)

- History lives in `src/store/useEditorStore.ts`: `history: Adjustments[]` (line 24), `historyIndex` (line 25), `pushHistory` with a 50-entry cap (line 146), `undo`/`redo`/`resetHistory`/`goToHistoryIndex` (lines 150-181).
- History is reset on image switch in `src/hooks/useAppNavigation.ts`:
  - `handleImageSelect` cached branch: `resetHistory(cached.adjustments)` at line 173; background metadata sync may `resetHistory(freshAdjustments)` at line 207.
  - Non-cached branch delegates to `src/hooks/useImageLoader.ts` `loadMetadataEarly`: `resetHistory(initialAdjusts)` at line 48.
  - `handleBackToLibrary` (line 99) and `handleSelectSubfolder` (~line 329): `resetHistory(INITIAL_ADJUSTMENTS)`.
- The per-image LRU (`src/utils/ImageLRUCache.ts`, `globalImageCache`, capacity 20) caches adjustments/previews but **not** history.
- Existing history UI: right-click dropdown in `src/components/panel/editor/EditorToolbar.tsx` (lines 556-611) with incremental name diffing in `historyNames` (lines 157-312, `prevNamesRef` at line 157).
- Left bottom panel: `src/components/panel/left/LeftBottomPanel.tsx` (tab content switch, line 31), `src/components/panel/left/LeftPanelTabs.tsx` (`TABS` array, line 13), `LeftPanelTab` enum in `src/components/ui/AppProperties.tsx:134-136`, active tab in `src/store/useUIStore.ts:121,196`.
- Locales: `src/i18n/locales/*.json` — 12 files (en, ru, de, fr, es, it, ja, ko, pl, pt, zh-CN, zh-TW); keys under `editor.*`.
- Undo/redo hotkeys already exist (`src/utils/keyboardUtils.ts:238-239`, `src/hooks/useKeyboardShortcuts.ts:248-261`) — no changes needed.

---

## Phase 1 — per-image in-memory history + History panel

### Task 1: `HISTORY_LIMIT` constant and `restoreHistory` action in the editor store

**Files:**
- Modify: `src/store/useEditorStore.ts:82-87,142-148`

- [ ] **Step 1: Add the `restoreHistory` action signature to the `EditorState` interface**

In `src/store/useEditorStore.ts`, in the `// Actions` block of `EditorState` (after `resetHistory` line 85), add:

```ts
  restoreHistory: (history: Adjustments[], index: number) => void;
```

- [ ] **Step 2: Add `HISTORY_LIMIT` and implement `restoreHistory`**

After the imports (before `export interface InteractivePatch`), add:

```ts
export const HISTORY_LIMIT = 100;
```

Replace the `pushHistory` cap (line 146) `if (newHistory.length > 50) newHistory.shift();` with:

```ts
      if (newHistory.length > HISTORY_LIMIT) newHistory.shift();
```

Add the action implementation after `resetHistory` (after line 173):

```ts
  restoreHistory: (history, index) =>
    set(() => {
      const clamped = Math.min(Math.max(index, 0), history.length - 1);
      return { history, historyIndex: clamped, adjustments: history[clamped] };
    }),
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds, no new type errors.

- [ ] **Step 4: Commit** (only when the user asks)

```bash
git add src/store/useEditorStore.ts
git commit -m "add restoreHistory action and raise history limit to 100"
```

### Task 2: In-memory per-image history cache

**Files:**
- Create: `src/utils/historyCache.ts`

- [ ] **Step 1: Create the cache module**

Create `src/utils/historyCache.ts`:

```ts
import type { Adjustments } from './adjustments';

export interface HistoryCacheEntry {
  history: Adjustments[];
  historyIndex: number;
}

const MAX_ENTRIES = 20;

// Per-image undo history, keyed by image path (virtual copies use the
// same `?vc=` path suffix convention as globalImageCache). In-memory only
// (Phase 1); Phase 2 persists to the SQLite catalog and demotes this to L1.
class HistoryCache {
  private cache = new Map<string, HistoryCacheEntry>();

  get(key: string): HistoryCacheEntry | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry;
  }

  set(key: string, entry: HistoryCacheEntry): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= MAX_ENTRIES) {
      const lruKey = this.cache.keys().next().value;
      if (lruKey !== undefined) this.cache.delete(lruKey);
    }
    this.cache.set(key, entry);
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  deleteByPrefix(prefix: string): void {
    for (const key of [...this.cache.keys()]) {
      if (key === prefix || key.startsWith(prefix + '?vc=')) this.cache.delete(key);
    }
  }

  clear(): void {
    this.cache.clear();
  }
}

export const globalHistoryCache = new HistoryCache();
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit** (only when the user asks)

```bash
git add src/utils/historyCache.ts
git commit -m "add per-image undo history cache"
```

### Task 3: Save/restore history on image navigation

All edits in this task are surgical insertions into shared upstream files — no reformatting, no unrelated changes.

**Files:**
- Modify: `src/hooks/useAppNavigation.ts:109-215` (cached branch + cache-write on switch), `:80-99` (`handleBackToLibrary`), ~`:329` (`handleSelectSubfolder`)
- Modify: `src/hooks/useImageLoader.ts:32-52` (non-cached load branch)

- [ ] **Step 1: Save outgoing history in `handleImageSelect`**

In `src/hooks/useAppNavigation.ts`, add the import at the top of the file:

```ts
import { globalHistoryCache } from '../utils/historyCache';
```

In `handleImageSelect`, extend the destructuring at line 111 to include `restoreHistory`:

```ts
      const { selectedImage, isSliderDragging, resetHistory, restoreHistory, setEditor } = useEditorStore.getState();
```

Immediately after the existing outgoing-cache write (lines 121-123):

```ts
      if (selectedImage?.path && cachedEditStateRef.current) {
        globalImageCache.set(selectedImage.path, cachedEditStateRef.current);
      }
```

insert:

```ts
      const { history: outgoingHistory, historyIndex: outgoingIndex } = useEditorStore.getState();
      if (selectedImage?.path && outgoingHistory.length > 0) {
        globalHistoryCache.set(selectedImage.path, {
          history: outgoingHistory,
          historyIndex: outgoingIndex,
        });
      }
```

- [ ] **Step 2: Restore history in the cached branch**

In `handleImageSelect`, replace lines 172-174:

```ts
        setEditor({ adjustments: cached.adjustments });
        resetHistory(cached.adjustments);
        prevAdjustmentsRef.current = { path, adjustments: cached.adjustments };
```

with:

```ts
        const cachedHistory = globalHistoryCache.get(path);
        if (cachedHistory) {
          restoreHistory(cachedHistory.history, cachedHistory.historyIndex);
        } else {
          setEditor({ adjustments: cached.adjustments });
          resetHistory(cached.adjustments);
        }
        prevAdjustmentsRef.current = { path, adjustments: useEditorStore.getState().adjustments };
```

In the background metadata sync (lines 205-210), guard the reset so a restored history is not clobbered when the sidecar differs (the autosave effect will re-persist the restored adjustments to the sidecar):

```ts
            if (!cachedHistory && !isSliderDragging && JSON.stringify(cached.adjustments) !== JSON.stringify(freshAdjustments)) {
```

(`cachedHistory` is already in closure scope.)

- [ ] **Step 3: Restore history in the non-cached branch (`useImageLoader.ts`)**

In `src/hooks/useImageLoader.ts`, add the import:

```ts
import { globalHistoryCache } from '../utils/historyCache';
```

Add a store selector near the existing ones (top of the hook):

```ts
  const restoreHistory = useEditorStore((state) => state.restoreHistory);
```

In `loadMetadataEarly`, replace lines 47-48:

```ts
          setEditor({ adjustments: initialAdjusts });
          resetHistory(initialAdjusts);
```

with:

```ts
          const cachedHistory = globalHistoryCache.get(selectedImage.path);
          if (cachedHistory) {
            restoreHistory(cachedHistory.history, cachedHistory.historyIndex);
          } else {
            setEditor({ adjustments: initialAdjusts });
            resetHistory(initialAdjusts);
          }
```

Add `restoreHistory` to the effect dependency array (lines 131-138).

- [ ] **Step 4: Save history when leaving the editor**

In `src/hooks/useAppNavigation.ts` `handleBackToLibrary`, before the `setEditor({ ... selectedImage: null ... })` block (line 80), insert:

```ts
    const { selectedImage: prevImage, history: prevHistory, historyIndex: prevIndex } = useEditorStore.getState();
    if (prevImage?.path && prevHistory.length > 0) {
      globalHistoryCache.set(prevImage.path, { history: prevHistory, historyIndex: prevIndex });
    }
```

Apply the same insertion in `handleSelectSubfolder` (~line 329), before its `resetHistory(INITIAL_ADJUSTMENTS)` call.

Note: the "legit reset" call sites (`useEditorActions.ts:157` `handleResetAdjustments`, `useAppContextMenus.ts:334` Reset, `:489` Apply Auto) need **no** changes — the next outgoing-switch save overwrites the cache entry with the post-reset history, which is the desired semantics.

- [ ] **Step 5: Verify build + manual smoke**

Run: `npm run build`
Expected: build succeeds.

Manual smoke (via `npm start`): edit image A (exposure), switch to image B, switch back to A → Ctrl/Cmd+Z undoes the exposure change.

- [ ] **Step 6: Commit** (only when the user asks)

```bash
git add src/hooks/useAppNavigation.ts src/hooks/useImageLoader.ts
git commit -m "restore per-image undo history on image switch"
```

### Task 4: Extract history-entry naming into a reusable hook

The naming logic currently lives inline in `EditorToolbar.tsx` (lines 157-312). Move it verbatim into a new hook so both the toolbar dropdown and the new panel use it.

**Files:**
- Create: `src/hooks/useHistoryNames.ts`
- Modify: `src/components/panel/editor/EditorToolbar.tsx:157-312`

- [ ] **Step 1: Create the hook**

Create `src/hooks/useHistoryNames.ts` — move the `prevNamesRef` ref and the entire `historyNames` `useMemo` body from `EditorToolbar.tsx:157-312` verbatim (including the full `formatKey` dictionary and the masks/aiPatches special cases), wrapped as:

```ts
import { useMemo, useRef } from 'react';
import type { Adjustments } from '../utils/adjustments';

// Human-readable names for undo-history entries, diffed incrementally
// between consecutive snapshots. Shared by the toolbar history dropdown
// (EditorToolbar) and the History panel (HistoryPanel).
export function useHistoryNames(adjustmentsHistory: Adjustments[]): string[] {
  const prevNamesRef = useRef<string[]>(['Initial State']);

  return useMemo(() => {
    // ... verbatim body of the historyNames useMemo from EditorToolbar.tsx:159-312,
    // minus the prevNamesRef declaration (now above) ...
  }, [adjustmentsHistory]);
}
```

- [ ] **Step 2: Rewire `EditorToolbar`**

In `src/components/panel/editor/EditorToolbar.tsx`:
- Add import: `import { useHistoryNames } from '../../../hooks/useHistoryNames';`
- Delete lines 157-312 (`prevNamesRef` + the whole `historyNames` `useMemo`).
- Where `historyNames` was computed, add: `const historyNames = useHistoryNames(adjustmentsHistory);`
- Remove now-unused imports only if the compiler flags them (`useMemo`/`useRef` may still be used elsewhere in the file — check, do not bulk-delete).

- [ ] **Step 3: Verify build + smoke**

Run: `npm run build`
Expected: build succeeds. Manual smoke: right-click undo button in the editor toolbar → dropdown still shows named entries.

- [ ] **Step 4: Commit** (only when the user asks)

```bash
git add src/hooks/useHistoryNames.ts src/components/panel/editor/EditorToolbar.tsx
git commit -m "extract history entry naming into useHistoryNames hook"
```

### Task 5: History panel component

**Files:**
- Create: `src/components/panel/left/HistoryPanel.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/panel/left/HistoryPanel.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../../store/useEditorStore';
import { useHistoryNames } from '../../../hooks/useHistoryNames';
import Text from '../../ui/Text';
import { TextColors, TextVariants, TextWeights } from '../../../types/typography';

export default function HistoryPanel() {
  const { t } = useTranslation();
  const history = useEditorStore((state) => state.history);
  const historyIndex = useEditorStore((state) => state.historyIndex);
  const goToHistoryIndex = useEditorStore((state) => state.goToHistoryIndex);
  const historyNames = useHistoryNames(history);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const activeEl = listRef.current?.querySelector('[data-active="true"]');
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [historyIndex, history.length]);

  return (
    <div ref={listRef} className="h-full overflow-y-auto py-1">
      {history.length <= 1 && (
        <div className="px-3 py-2">
          <Text variant={TextVariants.small} color={TextColors.secondary}>
            {t('editor.history.empty')}
          </Text>
        </div>
      )}
      {history.map((_, i) => {
        const isActive = i === historyIndex;
        return (
          <button
            key={i}
            data-active={isActive}
            onClick={() => goToHistoryIndex(i)}
            className={`w-full text-left px-3 py-1.5 transition-colors ${
              isActive ? 'bg-surface' : i > historyIndex ? 'opacity-50 hover:bg-surface' : 'hover:bg-surface'
            }`}
          >
            <Text
              variant={TextVariants.small}
              color={isActive ? TextColors.primary : TextColors.secondary}
              weight={isActive ? TextWeights.medium : TextWeights.regular}
            >
              {historyNames[i] ?? ''}
            </Text>
          </button>
        );
      })}
    </div>
  );
}
```

Entries above the current index (the "future" after undo) are dimmed, mirroring common history-panel UX. Entry names are English-only for now (the `formatKey` dictionary is hardcoded English, same as the existing toolbar dropdown) — localizing them is out of scope.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build succeeds (component is not mounted yet — no visual check).

- [ ] **Step 3: Commit** (only when the user asks)

```bash
git add src/components/panel/left/HistoryPanel.tsx
git commit -m "add history panel component"
```

### Task 6: Wire the History tab into the left bottom panel

**Files:**
- Modify: `src/components/ui/AppProperties.tsx:134-136`
- Modify: `src/components/panel/left/LeftPanelTabs.tsx:1,13`
- Modify: `src/components/panel/left/LeftBottomPanel.tsx:1-7,30-36`

- [ ] **Step 1: Add the enum member**

In `src/components/ui/AppProperties.tsx` (lines 134-136):

```ts
export enum LeftPanelTab {
  Presets = 'presets',
  History = 'history',
}
```

- [ ] **Step 2: Add the tab definition**

In `src/components/panel/left/LeftPanelTabs.tsx`, change the lucide import (line 1) to:

```ts
import { History, SwatchBook } from 'lucide-react';
```

and the `TABS` array (line 13) to:

```ts
const TABS: TabDef[] = [
  { id: LeftPanelTab.Presets, icon: SwatchBook, labelKey: 'editor.presets.title' },
  { id: LeftPanelTab.History, icon: History, labelKey: 'editor.history.title' },
];
```

- [ ] **Step 3: Render the panel for the new tab**

In `src/components/panel/left/LeftBottomPanel.tsx`, add the import:

```ts
import HistoryPanel from './HistoryPanel';
```

and inside the content `div` (after the `Presets` branch, lines 31-35), add:

```tsx
        {activeLeftBottomTab === LeftPanelTab.History && <HistoryPanel />}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: build succeeds (tab label will show the raw key until Task 7).

- [ ] **Step 5: Commit** (only when the user asks)

```bash
git add src/components/ui/AppProperties.tsx src/components/panel/left/LeftPanelTabs.tsx src/components/panel/left/LeftBottomPanel.tsx
git commit -m "add history tab to left bottom panel"
```

### Task 7: Locale strings

**Files:**
- Modify: `src/i18n/locales/en.json`, `ru.json`, `de.json`, `fr.json`, `es.json`, `it.json`, `ja.json`, `ko.json`, `pl.json`, `pt.json`, `zh-CN.json`, `zh-TW.json` (all under the `editor` object, next to `presets`)

- [ ] **Step 1: Add `editor.history` keys to all 12 locales**

Add under `editor` (sibling of `"presets"`):

| Locale | `title` | `empty` |
|---|---|---|
| en | History | No edits yet |
| ru | История | Изменений пока нет |
| de | Verlauf | Noch keine Bearbeitungen |
| fr | Historique | Aucune modification |
| es | Historial | Sin ediciones todavía |
| it | Cronologia | Nessuna modifica |
| ja | 履歴 | 編集はまだありません |
| ko | 기록 | 아직 편집 내용이 없습니다 |
| pl | Historia | Brak zmian |
| pt | Histórico | Sem edições ainda |
| zh-CN | 历史记录 | 暂无编辑 |
| zh-TW | 歷史記錄 | 尚無編輯 |

JSON shape (example for en):

```json
    "history": {
      "title": "History",
      "empty": "No edits yet"
    },
```

- [ ] **Step 2: Verify i18n + build**

Run: `npm run i18n:check && npm run build`
Expected: both pass.

- [ ] **Step 3: Commit** (only when the user asks)

```bash
git add src/i18n/locales/
git commit -m "add history panel locale strings"
```

### Task 8: Phase 1 final verification + manual QA

- [ ] **Step 1: Formatting**

Run: `npx prettier --check src/store/useEditorStore.ts src/utils/historyCache.ts src/hooks/useAppNavigation.ts src/hooks/useImageLoader.ts src/hooks/useHistoryNames.ts src/components/panel/editor/EditorToolbar.tsx src/components/panel/left/HistoryPanel.tsx src/components/panel/left/LeftBottomPanel.tsx src/components/panel/left/LeftPanelTabs.tsx src/components/ui/AppProperties.tsx`
Expected: all pass (run `npx prettier --write` on any failure and re-check).

- [ ] **Step 2: Full build + typecheck delta**

Run: `npm run build` and `npm run typecheck 2>&1 | grep -E "historyCache|HistoryPanel|useHistoryNames|useEditorStore|useAppNavigation|useImageLoader|LeftBottomPanel|LeftPanelTabs"`
Expected: build passes; grep output is empty (no *new* type errors in touched files — the repo has a pre-existing red `tsc` baseline).

- [ ] **Step 3: Manual QA checklist** (`npm start`)

1. Edit image A (several sliders), switch to B, back to A → undo/redo works, history preserved.
2. Edit A, go Back to Library, reopen A → history preserved.
3. Edit A past 100 entries (e.g. drag a slider back and forth) → oldest entries drop, cap holds at 100.
4. Reset adjustments on A, switch away and back → history shows the reset state only (no resurrected pre-reset entries).
5. History panel: entries named like the toolbar dropdown; current entry highlighted; entries after undo dimmed; clicking an entry jumps state; toolbar right-click dropdown still works.
6. Virtual copy: edit a virtual copy, switch to the original, back → histories are independent.

---

## Phase 2 — persistence in the SQLite catalog (PRELIMINARY)

> Depends on the parallel session's folder-import/catalog work on `main` (`src-tauri/src/library_db.rs`, schema v1 committed; import pipeline still in flight). **Detail this phase into bite-sized tasks only after that work lands and this branch is rebased onto it.** What follows is the agreed direction and the concrete integration points known today.

**Storage decision (agreed with user):** history lives in SQLite only. The `.rrdata` sidecar remains the source of truth for *current* adjustments; history is secondary data. Consequence: a full catalog rebuild loses history — accepted.

**Schema v2 migration** (extend `migrate()` in `src-tauri/src/library_db.rs:28`, bump `CURRENT_SCHEMA_VERSION` to 2):

```sql
CREATE TABLE IF NOT EXISTS edit_history (
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  label TEXT,
  adjustments_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (file_id, idx)
);
ALTER TABLE files ADD COLUMN history_index INTEGER;
```

**Rust operations** in `library_db.rs` (with `cargo test` unit tests following the existing pattern at `library_db.rs:143-168`):
- `save_edit_history(conn, file_id, entries: &[(idx, label, adjustments_json)], history_index)` — replace-all in one transaction + prune to the last 100 (`DELETE FROM edit_history WHERE file_id = ?1 AND idx < ?2`).
- `load_edit_history(conn, file_id) -> (Vec<Entry>, Option<i64>)`.

**Tauri commands:** `load_edit_history(path)` / `save_edit_history(path, entries, history_index)`, registered in `lib.rs`. Path → `file_id` resolution is the main open integration point (see below).

**Frontend:** new `src/utils/historyPersistence.ts` — debounced (~2 s) writer subscribed to `useEditorStore` history changes, flushed on image switch and app close; loader on image select with priority **DB → in-memory LRU** (Task 2-3 code becomes the L1 fallback for paths not yet in the catalog).

**Open questions to resolve at Phase 2 start:**
1. Final catalog command/API surface (depends on the parallel session's finished work).
2. What to do when the edited file has no `files` row yet (never imported): upsert a minimal row by path, or keep history memory-only until import.
3. Virtual-copy path format in the DB (`?vc=` suffix per the catalog spec) — confirm against the landed implementation.
4. Whether `label` is written from the frontend (`useHistoryNames`) or recomputed — leaning frontend-written, since names are already computed there.
5. History panel badge/count for persisted-but-not-currently-loaded images (nice-to-have, not committed).

**Phase 2 verification:** `cargo test` (new unit tests), `cargo check`, `npm run build`, plus a restart-persistence QA pass (edit → quit app → relaunch → history and panel restored).
