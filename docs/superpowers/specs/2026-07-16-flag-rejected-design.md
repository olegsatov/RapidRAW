# Flag / Rejected Design

## Goal

Lightroom-style culling: a per-photo three-state flag — **pick** (`+1`), **rejected** (`-1`), **unflagged** (`0`) — as an independent axis next to rating and color labels.

- Keyboard-driven: `Z` = pick, `X` = reject, `U` = clear (`P` is taken by the presets panel). All rebindable via the existing keybind settings.
- Toggle semantics: pressing the same flag again clears it (mirrors `handleRate`).
- **Auto-advance**: a toggle button in the editor BottomBar (next to the rating/flag status). When ON, flagging moves the selection to the next photo. Persisted in `appSettings.flagAutoAdvance` (default ON).
- Library filter by flag and a **Delete Rejected Photos** batch command.

## Current behavior

- No flag concept exists. Closest analogs: rating `0–5` stored in the `.rrdata` JSON sidecar (`ImageMetadata.rating`, `image_processing.rs:52`), color labels stored as `color:*` tags. The AI Culling modal maps `'reject'` to the red color label.
- Metadata pipeline: `ImageMetadata` ↔ sidecar; `ImageFile` (`file_management.rs:264`) carries `rating`/`tags` to the frontend; `set_rating_for_paths` (`file_management.rs:2635`) batch-writes sidecars with rayon; the frontend updates `useLibraryStore.imageRatings` optimistically in `useLibraryActions.handleRate` (`useLibraryActions.ts:13`).
- Hotkeys: `KEYBIND_DEFINITIONS` (`keyboardUtils.ts:21`) + a single `keydown` listener in `useKeyboardShortcuts.ts:624`; user-rebindable in SettingsPanel. `X`, `Z`, `U` are free.
- Thumbnails show a pill overlay with rating/color/edit slots in both `Filmstrip.tsx` and `library/LibraryItems.tsx`; context menus live in `useAppContextMenus.ts`; deletion goes through `useFileOperations.executeDelete`; library filtering is `computeSortedLibrary` (`useSortedLibrary.ts`) with `filterCriteria` persisted in `appSettings`.

## Proposed architecture

A typed `flag: i8` field in `ImageMetadata` (serde default `0`), wired end-to-end in parallel with the rating pipeline: backend batch command → sidecar → `ImageFile` → optimistic Zustand slice → badges/filter/hotkeys. The flag is **not** synced to XMP (Lightroom keeps flags catalog-local; existing XMP sync code stays untouched). The Culling modal's `'reject'` action switches from the red color label to `flag = -1`.

## Components and changes

### Backend

1. **`src-tauri/src/image_processing.rs`** — `ImageMetadata` += `#[serde(default)] flag: i8`; the `Default` impl sets `flag: 0`. Old sidecars deserialize with `flag = 0`, no migration.
2. **`src-tauri/src/file_management.rs`** — `ImageFile` += `flag: i8`, filled in `resolve_image_metadata`. New command `set_flag_for_paths(paths: Vec<String>, flag: i8)` modeled on `set_rating_for_paths` (rayon `par_iter`, load sidecar → set flag → save; no XMP). Values outside `{-1, 0, 1}` are rejected with an error.
3. **`src-tauri/src/lib.rs`** — register `set_flag_for_paths`.

### Frontend core

4. **`src/components/ui/AppProperties.tsx`** — `Invokes` enum += `SetFlagForPaths`; `AppSettings` += `flagAutoAdvance?: boolean` (default `true`).
5. **`src/store/useLibraryStore.ts`** — `imageFlags: Record<string, number>` next to `imageRatings`, with its setter.
6. **`src/hooks/useAppNavigation.ts`** — populate `imageFlags` from `ImageFile.flag` where `imageRatings` is populated (folder/album load).
7. **`src/hooks/useLibraryActions.ts`** — `handleSetFlag(flag: number, paths?: string[])`: toggle semantics (same value → `0`), optimistic store update, then `invoke`. Without `paths`, batches over `multiSelectedPaths` (same as `handleRate`).
8. **`src/utils/keyboardUtils.ts`** — `KEYBIND_DEFINITIONS` += flag actions: `flag_pick` (`KeyZ`), `flag_reject` (`KeyX`), `flag_clear` (`KeyU`), shown in the keybind settings like the rest.
9. **`src/hooks/useKeyboardShortcuts.ts`** — handle the three actions in the editor (current image) and the library (current selection). After a successful set, if `flagAutoAdvance` is ON, move the selection to the next photo (editor: existing next-image navigation; library: `libraryActivePath` to the next sorted item).

### UI

10. **Badges** — `Filmstrip.tsx` (`FilmstripThumbnail`) and `library/LibraryItems.tsx` (`ThumbnailComponent` + list view): a flag slot in the existing pill — lucide `Flag` for pick, `FlagOff` for reject. Rejected thumbnails are dimmed (`opacity-50`) in grid and filmstrip, Lightroom-style.
11. **`src/components/panel/BottomBar.tsx`** — next to `StarRating`: pick/reject buttons showing and setting the current image's flag, plus the auto-advance toggle button (highlighted when ON, persists to `appSettings.flagAutoAdvance`).
12. **`src/hooks/useAppContextMenus.ts`** — thumbnail context menu: **Flag** submenu (Pick `Z` / Reject `X` / Clear `U`, batched over the selection, next to Rating/Color Label) and **Delete Rejected Photos** — collects `flag === -1` paths from the current list, `ConfirmModal`, then the existing `executeDelete`. Disabled when nothing is rejected.
13. **Library filter** — `filterCriteria.flag`: `'all' | 'flagged' | 'unflagged' | 'rejected'` (default `'all'`); UI in `LibraryHeader.tsx` next to the rating filter; logic in `computeSortedLibrary`; persisted via the existing `appSettings.filterCriteria` mechanism.
14. **`src/components/modals/AppModals.tsx`** (Culling apply) — the `'reject'` action calls `handleSetFlag(-1)` instead of `handleSetColorLabel('red')`.
15. **i18n** — new strings in all `src/i18n/locales/*.json` (repo convention).

### Docs

16. **`AGENTS.md`** — add the flag feature to the delta map.

## Data flow

```
Key Z/X/U (or context menu / BottomBar buttons)
  → handleSetFlag(flag, paths?)        optimistic: useLibraryStore.imageFlags
  → invoke set_flag_for_paths
  → sidecar .rrdata rewritten (flag: -1 | 0 | 1)
  → next list_images_* / image-metadata-loaded rehydrates imageFlags
Auto-advance ON → selection moves to the next photo
```

## Error handling and edge cases

- **Old sidecars** without `flag` → `0` via serde default.
- **Virtual copies** have their own sidecar → their own flag (same as rating).
- **Toggle**: same flag again → `0` (matches `handleRate`).
- **Albums / cloud placeholders**: same sidecar mechanics as rating, no special handling.
- **Delete Rejected** with nothing rejected → menu item disabled.
- Deletion reuses `executeDelete`: existing `ConfirmModal`, associated-file handling, and post-delete selection.
- **Auto-advance at the last photo** → selection stays put (no wrap-around).
- **Multi-select + hotkey in the library** → flags all selected photos.

## Verification

- `cargo check` in `src-tauri/`, `npm run build`, `npx prettier --check` on touched files.
- Manual scenarios:
  - `Z`/`X`/`U` in editor and library; pressing the same flag again clears it.
  - Auto-advance ON moves to the next photo; OFF keeps the selection; toggle persists across restart.
  - Badges and dimming render correctly in filmstrip, grid, and list view.
  - Filter: all / flagged / unflagged / rejected.
  - Delete Rejected Photos removes exactly the rejected set (with confirmation).
  - Flags survive an app restart; a pre-feature sidecar (no `flag` field) loads as unflagged.
  - Multi-select + `X` flags the whole selection.
  - Culling modal `reject` sets the flag (not the red label).

## Decisions and open questions

- Flag is not written to XMP — matches Lightroom and keeps the XMP sync code untouched.
- Culling modal `'reject'` changes semantics: red color label → `flag = -1`.
- Sorting by flag and a `flag:` search query are intentionally out of scope (YAGNI).
