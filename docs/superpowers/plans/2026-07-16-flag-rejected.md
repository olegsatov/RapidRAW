# Flag / Rejected Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lightroom-style culling: per-photo pick (`+1`) / rejected (`-1`) / unflagged (`0`) flags with `Z`/`X`/`U` hotkeys, auto-advance, thumbnail badges, library filter, and batch delete of rejected photos.

**Architecture:** A typed `flag: i8` field in `ImageMetadata` (`.rrdata` sidecar, serde default `0`, no XMP sync), wired end-to-end in parallel with the rating pipeline: batch Tauri command → sidecar → `ImageFile` → optimistic Zustand slice (`imageFlags`) → badges/filter/hotkeys. Spec: `docs/superpowers/specs/2026-07-16-flag-rejected-design.md`.

**Tech Stack:** Rust (Tauri 2, rayon, serde_json), React, TypeScript, Zustand, Tailwind CSS, lucide-react, i18next.

**Conventions:**
- This repo has no test runner; verification is `cargo check` (in `src-tauri/`) and `npm run build` (the real frontend gate — `tsc` has a pre-existing red baseline, judge only by new errors).
- Commit style: lowercase, concise, no conventional-commit prefixes.
- Touch shared upstream files surgically; no cosmetic edits.

---

## Files touched

| File | Responsibility |
| --- | --- |
| `src-tauri/src/image_processing.rs` | `ImageMetadata.flag` field + default. |
| `src-tauri/src/file_management.rs` | `ImageFile.flag`, metadata resolve/emit, new `set_flag_for_paths` command. |
| `src-tauri/src/lib.rs` | Command registration. |
| `src/components/ui/AppProperties.tsx` | `Invokes.SetFlagForPaths`, `ImageFile.flag`, `FilterCriteria.flag`, `FlagFilter` type, `AppSettings.flagAutoAdvance`. |
| `src/store/useLibraryStore.ts` | `imageFlags` slice, default `filterCriteria.flag`. |
| `src/hooks/useLibraryActions.ts` | `handleSetFlag` (optimistic, toggle, batch). |
| `src/hooks/useAppNavigation.ts` | Hydrate `imageFlags` on folder/album load. |
| `src/hooks/useTauriListeners.ts` | Apply `flag` from `image-metadata-loaded`. |
| `src/utils/keyboardUtils.ts` | `flag_pick`/`flag_reject`/`flag_clear` keybind definitions. |
| `src/hooks/useKeyboardShortcuts.ts` | Flag actions + auto-advance. |
| `src/components/panel/BottomBar.tsx` | `FlagControl`, auto-advance toggle, pass `imageFlags` to Filmstrip. |
| `src/components/panel/Filmstrip.tsx` | Flag badge slot + rejected dimming (filmstrip). |
| `src/components/panel/library/LibraryItems.tsx` | Flag badge slot + dimming (grid), flag indicator (list view). |
| `src/components/panel/library/LibraryGrid.tsx` | Pass `flag` to `ThumbnailComponent`. |
| `src/hooks/useAppContextMenus.ts` | Flag submenu + Delete Rejected Photos item. |
| `src/hooks/useSortedLibrary.ts` | Flag filter logic + `imageFlags` subscription. |
| `src/components/panel/MainLibrary.tsx` | Translated flag filter options, passed to header. |
| `src/components/panel/library/LibraryHeader.tsx` | Flag filter section in view options. |
| `src/components/modals/AppModals.tsx` + `src/App.tsx` | Culling `reject` → `handleSetFlag(-1)`. |
| `src/i18n/locales/en.json`, `ru.json` | Strings. |
| `AGENTS.md` | Delta map entry. |

---

## Task 1: Backend — `flag` field and `set_flag_for_paths`

**Files:**
- Modify: `src-tauri/src/image_processing.rs:51-72`
- Modify: `src-tauri/src/file_management.rs:83-116, 263-273, 2635-2663`
- Modify: `src-tauri/src/lib.rs:2539`

- [ ] **Step 1: Add `flag` to `ImageMetadata`**

In `src-tauri/src/image_processing.rs`, replace the struct (lines 51-60):

```rust
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ImageMetadata {
    pub version: u32,
    pub rating: u8,
    #[serde(default)]
    pub flag: i8,
    pub adjustments: Value,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exif: Option<std::collections::HashMap<String, String>>,
}
```

And the `Default` impl (lines 62-72):

```rust
impl Default for ImageMetadata {
    fn default() -> Self {
        ImageMetadata {
            version: 1,
            rating: 0,
            flag: 0,
            adjustments: Value::Null,
            tags: None,
            exif: None,
        }
    }
}
```

- [ ] **Step 2: Add `flag` to `ImageFile`**

In `src-tauri/src/file_management.rs` (lines 263-273):

```rust
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ImageFile {
    path: String,
    modified: u64,
    is_edited: bool,
    rating: u8,
    flag: i8,
    tags: Option<Vec<String>>,
    exif: Option<HashMap<String, String>>,
    is_virtual_copy: bool,
    is_cloud_placeholder: bool,
}
```

- [ ] **Step 3: Carry `flag` through metadata resolution and events**

Change `resolve_image_metadata` (lines 83-103) to return the flag as a 4th tuple element:

```rust
fn resolve_image_metadata(
    image_path: &Path,
    sidecar_path: &Path,
    enable_xmp_sync: bool,
    settings: &AppSettings,
) -> (bool, Option<Vec<String>>, u8, i8) {
    let mut metadata = crate::exif_processing::load_sidecar(sidecar_path);

    if enable_xmp_sync
        && sync_metadata_from_xmp(image_path, &mut metadata)
        && let Ok(json) = serde_json::to_string_pretty(&metadata)
    {
        let _ = fs::write(sidecar_path, json);
    }

    let is_raw = crate::formats::is_raw_file(image_path);
    let tm_override = crate::image_processing::resolve_tonemapper_override(settings, is_raw);
    let edited =
        crate::image_processing::is_image_edited(&metadata.adjustments, is_raw, tm_override);
    (edited, metadata.tags, metadata.rating, metadata.flag)
}
```

Change `emit_image_metadata_loaded` (lines 105-116) to include the flag:

```rust
fn emit_image_metadata_loaded(
    app_handle: &AppHandle,
    path: &str,
    rating: u8,
    flag: i8,
    is_edited: bool,
    tags: &Option<Vec<String>>,
) {
    let _ = app_handle.emit(
        "image-metadata-loaded",
        serde_json::json!({ "path": path, "rating": rating, "flag": flag, "is_edited": is_edited, "tags": tags }),
    );
}
```

Then run `cargo check` in `src-tauri/` and fix every call site the compiler reports: `ImageFile` constructions get `flag` from the tuple's 4th element; `emit_image_metadata_loaded` calls get `metadata.flag`; `resolve_image_metadata` destructures get a 4th binding. Do not change any other logic at those sites.

- [ ] **Step 4: Add the `set_flag_for_paths` command**

In `src-tauri/src/file_management.rs`, immediately after `set_rating_for_paths` (ends line 2663):

```rust
#[tauri::command]
pub fn set_flag_for_paths(paths: Vec<String>, flag: i8) -> Result<(), String> {
    if !(-1..=1).contains(&flag) {
        return Err(format!("Invalid flag value: {flag}"));
    }

    paths.par_iter().for_each(|path| {
        let (_, sidecar_path) = parse_virtual_path(path);

        let mut metadata = crate::exif_processing::load_sidecar(&sidecar_path);

        metadata.flag = flag;

        if let Ok(json_string) = serde_json::to_string_pretty(&metadata) {
            let _ = std::fs::write(&sidecar_path, json_string);
        }
    });

    Ok(())
}
```

Note: deliberately no XMP sync (Lightroom keeps flags catalog-local).

- [ ] **Step 5: Register the command**

In `src-tauri/src/lib.rs`, after `file_management::set_rating_for_paths,` (line 2539):

```rust
            file_management::set_flag_for_paths,
```

- [ ] **Step 6: Verify**

Run: `cd src-tauri && cargo check`
Expected: `Finished` with no errors (warnings acceptable if pre-existing).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/image_processing.rs src-tauri/src/file_management.rs src-tauri/src/lib.rs
git commit -m "add flag field to image metadata and set_flag_for_paths command"
```

---

## Task 2: Frontend types and library store

**Files:**
- Modify: `src/components/ui/AppProperties.tsx:97-98, 258-263, 272-281, ~236`
- Modify: `src/store/useLibraryStore.ts:32-43, 70-79`

- [ ] **Step 1: `Invokes` enum**

In `src/components/ui/AppProperties.tsx`, between `SetColorLabelForPaths` (line 97) and `SetRatingForPaths` (line 98):

```typescript
  SetFlagForPaths = 'set_flag_for_paths',
```

- [ ] **Step 2: `FlagFilter` type + `FilterCriteria`**

Replace `FilterCriteria` (lines 258-263):

```typescript
export type FlagFilter = 'all' | 'flagged' | 'unflagged' | 'rejected';

export interface FilterCriteria {
  colors: Array<string>;
  rating: number;
  rawStatus: RawStatus;
  editedStatus?: EditedStatus;
  flag?: FlagFilter;
}
```

- [ ] **Step 3: `ImageFile.flag`**

In the `ImageFile` interface (lines 272-281), after `rating: number;`:

```typescript
  flag?: number;
```

- [ ] **Step 4: `AppSettings.flagAutoAdvance`**

In the `AppSettings` interface, after `proofMarginLevel?: 1 | 2;` (line 236):

```typescript
  flagAutoAdvance?: boolean;
```

- [ ] **Step 5: `useLibraryStore` — `imageFlags` slice and default filter**

In `src/store/useLibraryStore.ts`:

In the `LibraryState` interface, after `imageRatings: Record<string, number>;` (line 34):

```typescript
  imageFlags: Record<string, number>;
```

In the initial state, after `imageRatings: {},` (line 71):

```typescript
  imageFlags: {},
```

Change the default `filterCriteria` (line 78) to:

```typescript
  filterCriteria: { colors: [], rating: 0, rawStatus: RawStatus.All, flag: 'all' },
```

- [ ] **Step 6: Verify**

Run: `npm run build`
Expected: build succeeds; no **new** type errors compared to the pre-existing baseline.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/AppProperties.tsx src/store/useLibraryStore.ts
git commit -m "add flag types and imageFlags library slice"
```

---

## Task 3: `handleSetFlag`, hydration, metadata listener

**Files:**
- Modify: `src/hooks/useLibraryActions.ts:13-36` (+ hook return)
- Modify: `src/hooks/useAppNavigation.ts:342-348, 420-428`
- Modify: `src/hooks/useTauriListeners.ts:123-133`

- [ ] **Step 1: Add `handleSetFlag`**

In `src/hooks/useLibraryActions.ts`, immediately after `handleRate` (ends line 36):

```typescript
  const handleSetFlag = useCallback((newFlag: number, paths?: string[]) => {
    const { multiSelectedPaths, imageFlags, setLibrary } = useLibraryStore.getState();
    const { selectedImage } = useEditorStore.getState();

    const pathsToFlag =
      paths || (multiSelectedPaths.length > 0 ? multiSelectedPaths : selectedImage ? [selectedImage.path] : []);
    if (pathsToFlag.length === 0) return;

    const currentFlag = imageFlags[pathsToFlag[0]] || 0;
    const finalFlag = newFlag === currentFlag ? 0 : newFlag;

    setLibrary((state) => {
      const newFlags = { ...state.imageFlags };
      pathsToFlag.forEach((p) => {
        newFlags[p] = finalFlag;
      });
      return { imageFlags: newFlags };
    });

    invoke(Invokes.SetFlagForPaths, { paths: pathsToFlag, flag: finalFlag }).catch((err) => {
      console.error(err);
      toast.error(`Failed to set flag: ${err}`);
    });
  }, []);
```

Then find the hook's return object (search `handleRate,` near the end of the file) and add `handleSetFlag,` next to it.

- [ ] **Step 2: Hydrate on folder load**

In `src/hooks/useAppNavigation.ts`, replace lines 342-348:

```typescript
        const initialRatings: Record<string, number> = {};
        const initialFlags: Record<string, number> = {};
        files.forEach((f) => {
          if (f.rating !== undefined) {
            initialRatings[f.path] = f.rating;
          }
          if (f.flag !== undefined) {
            initialFlags[f.path] = f.flag;
          }
        });
        setLibrary({ imageRatings: initialRatings, imageFlags: initialFlags });
```

- [ ] **Step 3: Hydrate on album load**

In `src/hooks/useAppNavigation.ts`, replace lines 420-428:

```typescript
        const initialRatings: Record<string, number> = {};
        const initialFlags: Record<string, number> = {};
        files.forEach((f) => {
          if (f.rating !== undefined) initialRatings[f.path] = f.rating;
          if (f.flag !== undefined) initialFlags[f.path] = f.flag;
        });

        setLibrary({
          imageList: files,
          imageRatings: initialRatings,
          imageFlags: initialFlags,
          ...(preserveEditor ? {} : { multiSelectedPaths: [], libraryActivePath: null }),
        });
```

- [ ] **Step 4: Apply `flag` from `image-metadata-loaded`**

In `src/hooks/useTauriListeners.ts`, replace the listener (lines 123-133):

```typescript
      listen('image-metadata-loaded', (event: any) => {
        if (!isEffectActive) return;
        const { path, rating, is_edited, tags, flag } = event.payload;

        useLibraryStore.getState().setLibrary((state) => ({
          imageRatings: { ...state.imageRatings, [path]: rating },
          ...(flag !== undefined ? { imageFlags: { ...state.imageFlags, [path]: flag } } : {}),
          imageList: state.imageList.map((img) =>
            img.path === path ? { ...img, is_edited, tags: tags ?? img.tags } : img,
          ),
        }));
      }),
```

- [ ] **Step 5: Verify**

Run: `npm run build`
Expected: build succeeds; no new type errors.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useLibraryActions.ts src/hooks/useAppNavigation.ts src/hooks/useTauriListeners.ts
git commit -m "add handleSetFlag with optimistic updates and flag hydration"
```

---

## Task 4: Hotkeys `Z`/`X`/`U` and auto-advance

**Files:**
- Modify: `src/utils/keyboardUtils.ts` (after last `color_label_*` definition)
- Modify: `src/hooks/useKeyboardShortcuts.ts:34, ~437`

- [ ] **Step 1: Keybind definitions**

In `src/utils/keyboardUtils.ts`, immediately after the `color_label_purple` entry in `KEYBIND_DEFINITIONS`:

```typescript
  {
    action: 'flag_pick',
    description: 'settings.keybinds.actions.flag_pick',
    defaultCombo: ['KeyZ'],
    section: 'rating',
  },
  {
    action: 'flag_reject',
    description: 'settings.keybinds.actions.flag_reject',
    defaultCombo: ['KeyX'],
    section: 'rating',
  },
  {
    action: 'flag_clear',
    description: 'settings.keybinds.actions.flag_clear',
    defaultCombo: ['KeyU'],
    section: 'rating',
  },
```

- [ ] **Step 2: Get `handleSetFlag` in the shortcuts hook**

In `src/hooks/useKeyboardShortcuts.ts`, line 34:

```typescript
  const { handleRate, handleSetColorLabel, handleSetFlag } = useLibraryActions();
```

- [ ] **Step 3: Auto-advance helper + flag actions**

In `src/hooks/useKeyboardShortcuts.ts`, inside the `useEffect`, immediately before `const actions: Record<string, any> = {` (line 50):

```typescript
    const handleFlagAutoAdvance = (s: any) => {
      if (s.settings.appSettings?.flagAutoAdvance === false) return;
      const list = sortedListRef.current;
      if (list.length === 0) return;

      if (s.editor.selectedImage) {
        const currentIndex = list.findIndex((img) => img.path === s.editor.selectedImage!.path);
        if (currentIndex === -1 || currentIndex + 1 >= list.length) return;
        handleImageSelect(list[currentIndex + 1].path);
      } else {
        const activePath = s.library.libraryActivePath;
        const currentIndex = list.findIndex((img) => img.path === activePath);
        if (currentIndex === -1 || currentIndex + 1 >= list.length) return;
        const next = list[currentIndex + 1];
        s.library.setLibrary({ libraryActivePath: next.path, multiSelectedPaths: [next.path] });
      }
    };
```

Then, immediately after the `color_label_purple` action in the `actions` map (before `toggle_proof_margin`):

```typescript
      flag_pick: {
        shouldFire: () => true,
        execute: (e: any, s: any) => {
          e.preventDefault();
          handleSetFlag(1);
          handleFlagAutoAdvance(s);
        },
      },
      flag_reject: {
        shouldFire: () => true,
        execute: (e: any, s: any) => {
          e.preventDefault();
          handleSetFlag(-1);
          handleFlagAutoAdvance(s);
        },
      },
      flag_clear: {
        shouldFire: () => true,
        execute: (e: any) => {
          e.preventDefault();
          handleSetFlag(0);
        },
      },
```

Auto-advance deliberately stops at the last photo (no wrap-around) and never fires for `flag_clear`.

- [ ] **Step 4: Verify**

Run: `npm run build`
Expected: build succeeds; no new type errors.

- [ ] **Step 5: Commit**

```bash
git add src/utils/keyboardUtils.ts src/hooks/useKeyboardShortcuts.ts
git commit -m "add flag hotkeys with auto-advance"
```

---

## Task 5: BottomBar — flag control and auto-advance toggle

**Files:**
- Modify: `src/components/panel/BottomBar.tsx:1-13, 57-92, 129-135, 157-163, ~268, 292`

- [ ] **Step 1: Imports**

Line 2 — add `Flag`, `FlagOff`, `FastForward` to the lucide-react import. After line 13 (`COLOR_LABELS` import) add:

```typescript
import { useSettingsStore } from '../../store/useSettingsStore';
import { useLibraryActions } from '../../hooks/useLibraryActions';
```

- [ ] **Step 2: `FlagControl` component**

Immediately after the `StarRating` component (ends line 92):

```typescript
interface FlagControlProps {
  disabled: boolean;
  flag: number;
  onFlag(flag: number): void;
}

const FlagControl = ({ flag, onFlag, disabled }: FlagControlProps) => {
  const { t } = useTranslation();

  return (
    <div className={clsx('flex items-center gap-1', disabled && 'cursor-not-allowed')}>
      <button
        className="disabled:cursor-not-allowed"
        disabled={disabled}
        onClick={() => !disabled && onFlag(1)}
        data-tooltip={disabled ? t('ui.bottomBar.tooltips.selectToRate') : t('ui.bottomBar.tooltips.flagPick')}
      >
        <Flag
          size={18}
          className={clsx(
            'transition-colors duration-150',
            disabled
              ? 'text-text-secondary opacity-40'
              : flag === 1
                ? 'fill-accent text-accent'
                : 'text-text-secondary hover:text-accent',
          )}
        />
      </button>
      <button
        className="disabled:cursor-not-allowed"
        disabled={disabled}
        onClick={() => !disabled && onFlag(-1)}
        data-tooltip={disabled ? t('ui.bottomBar.tooltips.selectToRate') : t('ui.bottomBar.tooltips.flagReject')}
      >
        <FlagOff
          size={18}
          className={clsx(
            'transition-colors duration-150',
            disabled
              ? 'text-text-secondary opacity-40'
              : flag === -1
                ? 'fill-accent text-accent'
                : 'text-text-secondary hover:text-accent',
          )}
        />
      </button>
    </div>
  );
};
```

- [ ] **Step 3: Store selectors**

Extend the existing `useLibraryStore` selector (lines 158-163) to:

```typescript
  const { filterCriteria, setFilterCriteria, imageFlags, libraryActivePath } = useLibraryStore(
    useShallow((state) => ({
      filterCriteria: state.filterCriteria,
      setFilterCriteria: state.setFilterCriteria,
      imageFlags: state.imageFlags,
      libraryActivePath: state.libraryActivePath,
    })),
  );

  const { appSettings, handleSettingsChange } = useSettingsStore(
    useShallow((state) => ({
      appSettings: state.appSettings,
      handleSettingsChange: state.handleSettingsChange,
    })),
  );

  const { handleSetFlag } = useLibraryActions();
  const flagAutoAdvance = appSettings?.flagAutoAdvance ?? true;
  const flagPath = selectedImage?.path ?? libraryActivePath ?? '';
  const flag = imageFlags[flagPath] || 0;
```

(`selectedImage` is already a BottomBar prop.)

- [ ] **Step 4: Render the control and the toggle**

Replace line 292:

```typescript
          <StarRating rating={rating} onRate={onRate} disabled={isRatingDisabled} />
          <FlagControl flag={flag} onFlag={handleSetFlag} disabled={isRatingDisabled} />
          {!isLibraryView && (
            <button
              className={clsx(
                'w-8 h-8 flex items-center justify-center rounded-md transition-colors',
                flagAutoAdvance
                  ? 'text-accent bg-surface'
                  : 'text-text-secondary hover:bg-surface hover:text-text-primary',
              )}
              onClick={() =>
                appSettings && handleSettingsChange({ ...appSettings, flagAutoAdvance: !flagAutoAdvance })
              }
              data-tooltip={t('ui.bottomBar.tooltips.autoAdvance')}
            >
              <FastForward size={18} />
            </button>
          )}
```

- [ ] **Step 5: Pass `imageFlags` to the Filmstrip**

Find the `<Filmstrip` element (line 268) and add the prop (it already receives `imageRatings`):

```typescript
            imageFlags={imageFlags}
```

- [ ] **Step 6: Verify**

Run: `npm run build`
Expected: build succeeds; no new type errors. (The `imageFlags` prop on `Filmstrip` will be a type error until Task 6 — if the build fails only on that, proceed to Task 6 and verify there; do not commit yet.)

- [ ] **Step 7: Commit** (after Task 6 if the build gate required it)

```bash
git add src/components/panel/BottomBar.tsx
git commit -m "add flag control and auto-advance toggle to bottom bar"
```

---

## Task 6: Filmstrip — flag badge and rejected dimming

**Files:**
- Modify: `src/components/panel/Filmstrip.tsx:22-24, 35-58, 80-91, 179-180, 253-265, 291-335, 609-623, ~666`

- [ ] **Step 1: Thread `imageFlags` through the component chain**

In `src/components/panel/Filmstrip.tsx`:

1. `ItemData` interface (lines 22-24) — after `imageRatings: any;` add:

```typescript
  imageFlags: any;
```

2. `FilmstripThumbnail` props — add `imageFlags` to both the destructuring (line 38, after `imageRatings,`) and the type annotation (line 49, after `imageRatings: any;`):

```typescript
    imageFlags,
```

```typescript
    imageFlags: any;
```

3. `FilmstripCell` (line 295) — add `imageFlags,` to the destructuring, and in the `<FilmstripThumbnail` render (line 322) add `imageFlags={imageFlags}` right after `imageRatings={imageRatings}`.

4. The default-exported `Filmstrip` component — add `imageFlags: any;` to its props type (line 609, after `imageRatings: any;`), add `imageFlags,` to the destructuring (line 623), and add `imageFlags,` to the `itemData` object (line 666, right after `imageRatings,`).

- [ ] **Step 2: Compute the flag and extend overlay visibility**

In `FilmstripThumbnail`, after line 81 (`const rating = imageRatings?.[path] || 0;`):

```typescript
    const flag = imageFlags?.[path] || 0;
```

Replace lines 88-91:

```typescript
    const hasEditIcon = !!showEditIcon;
    const hasColorLabel = !!colorLabel;
    const hasRating = rating > 0;
    const hasFlag = flag !== 0;
    const hasAnyOverlay = hasEditIcon || hasColorLabel || hasRating || hasFlag;
```

- [ ] **Step 3: Dim rejected thumbnails**

Replace line 180 (the opening `div` of the layers wrapper):

```typescript
          <div className={clsx('absolute inset-0 w-full h-full', flag === -1 && 'opacity-50')}>
```

- [ ] **Step 4: Flag badge slot**

Add `Flag` and `FlagOff` to the lucide-react import at the top of the file.

In the overlay pill, immediately after the rating slot (the `<div>` containing `{rating}` and `<Star .../>`, ends line 264):

```typescript
            <div
              className={clsx(
                'flex items-center justify-center shrink-0 transition-all duration-200 ease-out overflow-hidden',
                hasFlag ? 'max-w-3 opacity-100 scale-100' : 'max-w-0 opacity-0 scale-75 pointer-events-none',
                hasFlag && (hasEditIcon || hasColorLabel || hasRating) ? 'ml-1.5' : 'ml-0',
              )}
            >
              {flag === 1 ? (
                <Flag size={12} className="text-white fill-white" />
              ) : (
                <FlagOff size={12} className="text-white" />
              )}
            </div>
```

- [ ] **Step 5: Verify**

Run: `npm run build`
Expected: build succeeds; no new type errors (including the BottomBar prop from Task 5).

- [ ] **Step 6: Commit**

```bash
git add src/components/panel/Filmstrip.tsx
git commit -m "show flag badge and dim rejected in filmstrip"
```

---

## Task 7: Library grid and list — flag badge, dimming, indicator

**Files:**
- Modify: `src/components/panel/library/LibraryItems.tsx:1-12, 20-34, 141-144, 157-158, 245-256, 641-650, ~823, ~840`
- Modify: `src/components/panel/library/LibraryGrid.tsx:170, 435, 455`

- [ ] **Step 1: Imports and props**

In `src/components/panel/library/LibraryItems.tsx`, line 2 — add `Flag` and `FlagOff` to the lucide-react import.

The two render sites (lines ~823 and ~840) pass `rating={imageRatings?.[imageFile.path] || 0}`. Find where `imageRatings` enters this file's scope (prop or store selector) and obtain `imageFlags` the exact same way. Then at both render sites add, right after the `rating=...` line:

```typescript
              flag={imageFlags?.[imageFile.path] || 0}
```

In `src/components/panel/library/LibraryGrid.tsx`, `imageRatings` appears at lines 170 (props), 435 and 455 (passed to cell renderers). Add `imageFlags` at the same three places, sourced identically to `imageRatings` (if it comes from `useLibraryStore`, add `imageFlags: state.imageFlags` to the same selector; if it is a prop, thread it the same way). Wherever `rating={...}` is passed into `ThumbnailComponent`, add `flag={imageFlags?.[item.path] || 0}` using the same item variable the `rating` expression uses.

- [ ] **Step 2: `ThumbnailComponent` — flag state**

In `ThumbnailComponent` (props destructuring at lines 20-34, type is `any`), add `flag` to the destructured props. Then replace lines 141-144:

```typescript
  const hasEditIcon = !!showEditIcon;
  const hasColorLabel = !!colorLabel;
  const hasRating = rating > 0;
  const hasFlag = (flag || 0) !== 0;
  const hasAnyOverlay = hasEditIcon || hasColorLabel || hasRating || hasFlag;
```

- [ ] **Step 3: Dim rejected in the grid**

Replace lines 157-158:

```typescript
      <div className="relative w-full flex-1 min-h-0 z-0 bg-surface">
        {layers.length > 0 && (
          <div className={clsx('absolute inset-0 w-full h-full', flag === -1 && 'opacity-50')}>
```

(Only the layers wrapper `div` gains `clsx` + the dimming class; the surrounding lines stay as they are.)

- [ ] **Step 4: Flag badge slot in the grid pill**

Immediately after the rating slot (ends line 256, the `<div>` with `{rating}` and `<StarIcon .../>`):

```typescript
          <div
            className={clsx(
              'flex items-center justify-center shrink-0 transition-all duration-200 ease-out overflow-hidden',
              hasFlag ? 'max-w-3 opacity-100 scale-100' : 'max-w-0 opacity-0 scale-75 pointer-events-none',
              hasFlag && (hasEditIcon || hasColorLabel || hasRating) ? 'ml-1.5' : 'ml-0',
            )}
          >
            {flag === 1 ? (
              <Flag size={12} className="text-white fill-white" />
            ) : (
              <FlagOff size={12} className="text-white" />
            )}
          </div>
```

- [ ] **Step 5: List-view indicator**

In the list-item component, add `flag` to its destructured props (same place `rating` is destructured) and replace the rating cell (lines 641-650):

```typescript
      <div style={{ width: getW('rating') }} className="flex items-center px-3 h-full overflow-hidden">
        {(rating > 0 || (flag || 0) !== 0) && (
          <div className="flex items-center gap-1">
            {flag === 1 && <Flag size={12} className="text-accent fill-accent shrink-0" />}
            {flag === -1 && <FlagOff size={12} className="text-text-secondary shrink-0" />}
            {rating > 0 && (
              <>
                <StarIcon size={12} className="text-accent fill-accent" />
                <Text variant={TextVariants.small} color={TextColors.primary} weight={TextWeights.medium}>
                  {rating}
                </Text>
              </>
            )}
          </div>
        )}
      </div>
```

(No dimming in list view — indicator only.)

- [ ] **Step 6: Verify**

Run: `npm run build`
Expected: build succeeds; no new type errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/panel/library/LibraryItems.tsx src/components/panel/library/LibraryGrid.tsx
git commit -m "show flag badge and dim rejected in library grid and list"
```

---

## Task 8: Context menus — Flag submenu and Delete Rejected Photos

**Files:**
- Modify: `src/hooks/useAppContextMenus.ts:~24, 79, ~343, 350-393, 726-741, ~799`

- [ ] **Step 1: Imports and hook wiring**

Add `Flag` to the lucide-react import (the import block containing `Trash2`, around line 24).

Line 79:

```typescript
  const { handleRate, handleSetColorLabel, handleTagsChanged, handleSetFlag } = useLibraryActions();
```

Add `handleSetFlag,` to both `useCallback` dependency arrays that list `handleSetColorLabel,` (search `handleSetColorLabel,` — around lines 343 and 799).

- [ ] **Step 2: Rejected paths in the thumbnail menu**

In `handleThumbnailContextMenu`, extend the library store destructure (lines 356-357) to include `imageFlags`:

```typescript
      const { multiSelectedPaths, imageList, libraryActivePath, albumTree, activeAlbumId, setLibrary, imageFlags } =
        useLibraryStore.getState();
```

After the `hasAssociatedFiles` block (ends line 393):

```typescript
      const rejectedPaths = imageList
        .filter((image: ImageFile) => (imageFlags[image.path] || 0) === -1)
        .map((image: ImageFile) => image.path);
```

(`ImageFile` is already imported in this file — verify; if not, add it to the `AppProperties` import.)

- [ ] **Step 3: Flag submenu**

In the thumbnail menu items array, immediately after the Tagging entry (ends line 740), before `{ type: OPTION_SEPARATOR }` (line 741):

```typescript
        {
          icon: Flag,
          label: t('contextMenus.editor.flag'),
          submenu: [
            { label: t('contextMenus.editor.flagPick'), onClick: () => handleSetFlag(1, finalSelection) },
            { label: t('contextMenus.editor.flagReject'), onClick: () => handleSetFlag(-1, finalSelection) },
            { label: t('contextMenus.editor.flagClear'), onClick: () => handleSetFlag(0, finalSelection) },
          ],
        },
```

- [ ] **Step 4: Delete Rejected Photos item**

Find the menu item that renders `submenu: deleteSubmenu` in the items array and insert immediately after it:

```typescript
        {
          icon: Trash2,
          label: t('contextMenus.thumbnail.deleteRejected', { count: rejectedPaths.length }),
          isDestructive: true,
          disabled: rejectedPaths.length === 0,
          onClick: () =>
            setUI({
              confirmModalState: {
                confirmText: 'Delete',
                confirmVariant: 'destructive',
                isOpen: true,
                message: `Are you sure you want to permanently delete ${rejectedPaths.length} rejected photo(s)? This action cannot be undone.`,
                onConfirm: () => props.executeDelete(rejectedPaths, { includeAssociated: false }),
                title: 'Delete Rejected Photos',
              },
            }),
        },
```

(`setUI` is already destructured from `useUIStore.getState()` at line 359; `props.executeDelete` and `Trash2` already exist.)

- [ ] **Step 5: Verify**

Run: `npm run build`
Expected: build succeeds; no new type errors.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useAppContextMenus.ts
git commit -m "add flag submenu and delete rejected to thumbnail context menu"
```

---

## Task 9: Library filter by flag

**Files:**
- Modify: `src/hooks/useSortedLibrary.ts:37-38, 92-98, 283-298`
- Modify: `src/components/panel/MainLibrary.tsx:101-112, ~483`
- Modify: `src/components/panel/library/LibraryHeader.tsx:~310, ~597`

- [ ] **Step 1: Filter logic**

In `src/hooks/useSortedLibrary.ts`, `computeSortedLibrary` — line 38 stays, but add a safe flag map right after it:

```typescript
  const { imageList, imageRatings, filterCriteria, searchCriteria, sortCriteria } = libraryState;
  const flagMap: Record<string, number> = libraryState.imageFlags || {};
```

(`imageFlags` is read defensively because other callers of `computeSortedLibrary`, e.g. `handleMultiSelectClick`, may not pass it.)

Inside the `filteredList` filter callback, immediately after the rating block (ends line 98):

```typescript
    if (filterCriteria.flag && filterCriteria.flag !== 'all') {
      const flag = flagMap[image.path] || 0;
      if (filterCriteria.flag === 'flagged' && flag !== 1) return false;
      if (filterCriteria.flag === 'rejected' && flag !== -1) return false;
      if (filterCriteria.flag === 'unflagged' && flag !== 0) return false;
    }
```

- [ ] **Step 2: Hook subscription**

Replace `useSortedLibrary` (lines 283-298):

```typescript
export function useSortedLibrary() {
  const imageList = useLibraryStore((state) => state.imageList);
  const imageRatings = useLibraryStore((state) => state.imageRatings);
  const imageFlags = useLibraryStore((state) => state.imageFlags);
  const filterCriteria = useLibraryStore((state) => state.filterCriteria);
  const searchCriteria = useLibraryStore((state) => state.searchCriteria);
  const sortCriteria = useLibraryStore((state) => state.sortCriteria);

  const appSettings = useSettingsStore((state) => state.appSettings);
  const supportedTypes = useSettingsStore((state) => state.supportedTypes);

  const sortedImageList = useMemo(() => {
    return computeSortedLibrary(
      { imageList, imageRatings, imageFlags, filterCriteria, searchCriteria, sortCriteria },
      { appSettings, supportedTypes },
    );
  }, [imageList, sortCriteria, imageRatings, imageFlags, filterCriteria, supportedTypes, searchCriteria, appSettings]);

  return sortedImageList;
}
```

- [ ] **Step 3: Translated options in `MainLibrary`**

After `translatedRatingFilterOptions` (ends line 112):

```typescript
  const translatedFlagFilterOptions = useMemo(
    () => [
      { value: 'all', label: t('library.filters.flag.all') },
      { value: 'flagged', label: t('library.filters.flag.flagged') },
      { value: 'unflagged', label: t('library.filters.flag.unflagged') },
      { value: 'rejected', label: t('library.filters.flag.rejected') },
    ],
    [t],
  );
```

At the `<LibraryHeader` render (line ~483), after `ratingFilterOptions={translatedRatingFilterOptions}`:

```typescript
            flagFilterOptions={translatedFlagFilterOptions}
```

- [ ] **Step 4: Filter section in `LibraryHeader`**

Add `flagFilterOptions,` to the props destructuring (line ~310, next to `ratingFilterOptions,`).

Immediately after the closing `</div>` of the rating filter section (line ~597), add:

```typescript
            <div>
              <Text as="div" variant={TextVariants.small} weight={TextWeights.semibold} className="px-3 py-2 uppercase">
                {t('library.header.viewOptions.filterByFlag')}
              </Text>

              {flagFilterOptions.map((option: any) => {
                const isSelected = (filterCriteria.flag ?? 'all') === option.value;
                return (
                  <button
                    className={`w-full text-left px-3 py-2 rounded-md flex items-center justify-between transition-colors duration-150 ${
                      isSelected ? 'bg-card-active' : 'hover:bg-bg-primary'
                    }`}
                    key={option.value}
                    onClick={() =>
                      setFilterCriteria((prev: Partial<FilterCriteria>) => ({ ...prev, flag: option.value }))
                    }
                    role="menuitem"
                  >
                    <Text
                      variant={TextVariants.label}
                      color={TextColors.primary}
                      weight={isSelected ? TextWeights.semibold : TextWeights.normal}
                    >
                      {option.label}
                    </Text>
                    {isSelected && <Check size={16} className={TEXT_COLOR_KEYS[TextColors.primary]} />}
                  </button>
                );
              })}
            </div>
```

(`FilterCriteria` is already imported in this file — verify; if not, add it to the `AppProperties` import.)

- [ ] **Step 5: Verify**

Run: `npm run build`
Expected: build succeeds; no new type errors.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useSortedLibrary.ts src/components/panel/MainLibrary.tsx src/components/panel/library/LibraryHeader.tsx
git commit -m "add library filter by flag"
```

---

## Task 10: Culling modal — `reject` sets the flag

**Files:**
- Modify: `src/components/modals/AppModals.tsx:303-310`
- Modify: `src/App.tsx:~318, ~820`

- [ ] **Step 1: Switch the `reject` action**

In `src/components/modals/AppModals.tsx`, replace lines 303-310:

```typescript
        onApply={(action, paths) => {
          if (action === 'reject') {
            props.handleSetFlag(-1, paths);
          } else if (action === 'rate_zero') {
            props.handleRate(1, paths);
          } else if (action === 'delete') {
            props.executeDelete(paths, { includeAssociated: false });
          }
```

- [ ] **Step 2: Provide `handleSetFlag` to `AppModals`**

In `src/App.tsx`, find the destructure containing `handleSetColorLabel` (~line 318) and add `handleSetFlag,` to it. These handlers ultimately come from `useLibraryActions`; if an intermediate hook explicitly re-exports them (search where `handleSetColorLabel` is produced for this destructure), add `handleSetFlag` there too.

Then at the `AppModals` render (~line 820), after `handleSetColorLabel={handleSetColorLabel}`:

```typescript
          handleSetFlag={handleSetFlag}
```

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: build succeeds; no new type errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/modals/AppModals.tsx src/App.tsx
git commit -m "culling modal reject sets flag instead of red label"
```

---

## Task 11: i18n strings (en, ru)

**Files:**
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/ru.json`

(The other ten locales fall back to English via i18next — same as previous features, e.g. preset hotkeys, shipped.)

- [ ] **Step 1: English strings**

In `src/i18n/locales/en.json`:

1. In `settings.keybinds.actions` (find `"rate_0"`):

```json
      "flag_pick": "Flag as Pick",
      "flag_reject": "Flag as Rejected",
      "flag_clear": "Clear Flag",
```

2. In `contextMenus.editor` (find `"colorLabel"`):

```json
      "flag": "Flag",
      "flagPick": "Pick",
      "flagReject": "Reject",
      "flagClear": "Clear Flag",
```

3. In `contextMenus.thumbnail` (find `"cullImage"`):

```json
      "deleteRejected": "Delete Rejected Photos ({{count}})",
```

4. In `library.header.viewOptions` (find `"filterByRating"`):

```json
      "filterByFlag": "Filter by Flag",
```

5. In `library.filters` (sibling of `"rating"`), add:

```json
    "flag": {
      "all": "All",
      "flagged": "Flagged",
      "unflagged": "Unflagged",
      "rejected": "Rejected"
    },
```

6. In `ui.bottomBar.tooltips` (find `"rateStars"`):

```json
      "flagPick": "Flag as Pick (Z)",
      "flagReject": "Flag as Rejected (X)",
      "autoAdvance": "Auto-advance to next photo after flagging",
```

- [ ] **Step 2: Russian strings**

In `src/i18n/locales/ru.json`, same locations:

1. `settings.keybinds.actions`:

```json
      "flag_pick": "Отметить как отобранное",
      "flag_reject": "Отметить как отклонённое",
      "flag_clear": "Снять флаг",
```

2. `contextMenus.editor`:

```json
      "flag": "Флаг",
      "flagPick": "Отобрано",
      "flagReject": "Отклонено",
      "flagClear": "Снять флаг",
```

3. `contextMenus.thumbnail`:

```json
      "deleteRejected": "Удалить отклонённые фото ({{count}})",
```

4. `library.header.viewOptions`:

```json
      "filterByFlag": "Фильтр по флагу",
```

5. `library.filters`:

```json
    "flag": {
      "all": "Все",
      "flagged": "Отобранные",
      "unflagged": "Без флага",
      "rejected": "Отклонённые"
    },
```

6. `ui.bottomBar.tooltips`:

```json
      "flagPick": "Отобрать (Z)",
      "flagReject": "Отклонить (X)",
      "autoAdvance": "Автопереход к следующему фото после флага",
```

- [ ] **Step 3: Verify**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/en.json','utf8')); JSON.parse(require('fs').readFileSync('src/i18n/locales/ru.json','utf8')); console.log('ok')"` then `npm run build`
Expected: `ok`; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/en.json src/i18n/locales/ru.json
git commit -m "add flag culling locale strings"
```

---

## Task 12: AGENTS.md delta map

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Add the delta map entry**

In `AGENTS.md`, under "What's ours (delta map)", after the "Session restore" bullet:

```markdown
- Flag/rejected culling (Lightroom-style pick/reject, `Z`/`X`/`U` hotkeys,
  auto-advance toggle, library flag filter, Delete Rejected): `flag` field in
  `src-tauri/src/image_processing.rs` (`ImageMetadata`) and
  `set_flag_for_paths` in `src-tauri/src/file_management.rs`,
  `handleSetFlag` in `src/hooks/useLibraryActions.ts`, flag parts of
  `src/store/useLibraryStore.ts`, `src/hooks/useAppNavigation.ts`,
  `src/hooks/useTauriListeners.ts`, `src/hooks/useKeyboardShortcuts.ts`,
  `src/utils/keyboardUtils.ts`, `src/components/panel/BottomBar.tsx`,
  `src/components/panel/Filmstrip.tsx`,
  `src/components/panel/library/LibraryItems.tsx` / `LibraryGrid.tsx`,
  `src/hooks/useAppContextMenus.ts`, `src/hooks/useSortedLibrary.ts`,
  `src/components/panel/MainLibrary.tsx`,
  `src/components/panel/library/LibraryHeader.tsx`, culling-apply in
  `src/components/modals/AppModals.tsx`.
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "document flag culling in delta map"
```

---

## Task 13: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Rust gate**

Run: `cd src-tauri && cargo check`
Expected: `Finished`, no errors.

- [ ] **Step 2: Frontend gate**

Run: `npm run build`
Expected: build succeeds; no new type errors vs. baseline.

- [ ] **Step 3: Formatting**

Run: `npx prettier --check src/components/ui/AppProperties.tsx src/store/useLibraryStore.ts src/hooks/useLibraryActions.ts src/hooks/useAppNavigation.ts src/hooks/useTauriListeners.ts src/utils/keyboardUtils.ts src/hooks/useKeyboardShortcuts.ts src/components/panel/BottomBar.tsx src/components/panel/Filmstrip.tsx src/components/panel/library/LibraryItems.tsx src/components/panel/library/LibraryGrid.tsx src/hooks/useAppContextMenus.ts src/hooks/useSortedLibrary.ts src/components/panel/MainLibrary.tsx src/components/panel/library/LibraryHeader.tsx src/components/modals/AppModals.tsx src/App.tsx src/i18n/locales/en.json src/i18n/locales/ru.json AGENTS.md`
Expected: all files `Pass`. If not: `npx prettier --write` the failing files, re-check, and amend the relevant task commits (or add a `prettier` commit if amending is not possible).

- [ ] **Step 4: Manual QA**

Run the app (`npm run tauri dev`) with a folder of test photos:

1. `Z` / `X` / `U` in the editor flag/unflag the current photo; pressing the same flag again clears it.
2. Same hotkeys in the library flag the whole multi-selection.
3. Auto-advance ON (BottomBar toggle highlighted): after `Z`/`X` the selection moves to the next photo; at the last photo it stays put. Toggle OFF: selection stays. Toggle state survives an app restart.
4. Badges: white `Flag` on picked, `FlagOff` on rejected, rejected dimmed — in filmstrip, grid, and the list-view indicator.
5. BottomBar flag buttons show and change the current photo's flag (editor and library).
6. Context menu: Flag submenu works on multi-selection; Delete Rejected Photos is disabled when nothing is rejected, otherwise confirms and deletes exactly the rejected set.
7. Library filter: all / flagged / unflagged / rejected each show the right photos; the filter persists across restart.
8. Flags survive an app restart; a sidecar written before this feature (no `flag` key) loads as unflagged and gains `flag: 0` on next write.
9. AI Culling modal → Reject sets the rejected flag (not the red color label).
10. Keybinds for flag actions appear under Settings → Controls (rating section) and are rebindable.
