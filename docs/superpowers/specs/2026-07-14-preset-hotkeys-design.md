# Preset Hotkeys Design

## Goal

Allow users to assign a global keyboard shortcut to each preset so that the preset can be applied instantly to the currently open image. The shortcut must be configurable both from the preset configuration modal and from the standard keyboard settings panel.

## Context

- The `Preset` type already contains an unused `hotkey?: string[] | null` field on both the frontend (`AppProperties.tsx`) and the Rust backend (`file_management.rs`).
- Presets are currently managed by a local `usePresets` hook. A global Zustand store `usePresetStore.ts` exists but is not yet wired into the UI.
- Keyboard shortcuts are captured globally in `useKeyboardShortcuts.ts` using `keyboardUtils.ts` (`normalizeCombo`, `formatKeyCode`).
- The settings panel already renders keybind rows for application actions and highlights conflicts.

## Design

### 1. Data Model & Storage

- `Preset.hotkey` is an array of key codes such as `['ctrl', 'Digit1']` or `null` when unassigned.
- The hotkey is persisted inside the preset object in `presets.json` and travels with import/export.
- Rust `Preset.hotkey` mirrors the frontend shape (`Option<Vec<String>>`).

### 2. Global Preset Store

`usePresetStore.ts` becomes the single source of truth for presets:

- Loads presets once via `LoadPresets`.
- Exposes CRUD operations (`addPreset`, `updatePreset`, `deletePreset`, `reorderPresets`, etc.).
- Debounces saves to the backend (≈ 500 ms) to avoid writing on every keystroke.
- Provides selectors: `flattenPresets`, `findPresetById`.

`usePresets(currentAdjustments)` is kept as a thin adapter over the store so existing consumers do not change their interface.

### 3. Capturing Hotkeys

Create `src/components/ui/HotkeyCapture.tsx`:

- Displays the current combo as `<kbd>` badges.
- Enters recording mode on click; captures the next non-modifier combo via `normalizeCombo(event, osPlatform)`.
- `Escape` while recording clears the hotkey.
- Bails out if the captured combo is a reserved/hardcoded application shortcut (e.g. `Escape`, arrow keys, `Delete` in mask mode).
- Shows a conflict warning when the captured combo is already used by an application keybind or another preset.
- Offers an explicit **Overwrite** action to resolve the conflict.

### 4. UI Integration

#### ConfigurePresetModal

Add a **Hotkey** row at the bottom of the modal using `HotkeyCapture`. If the chosen combo conflicts with an application keybind or another preset, show the conflict details and the Overwrite button.

#### PresetsBrowser

Show the assigned combo as a small `<kbd>` badge next to the preset name when `hotkey` is set.

#### SettingsPanel

After the standard `KEYBIND_SECTIONS`, add a new section **Preset Hotkeys**:

- Render a flat list of all presets (`flattenPresets`), sorted by name.
- Each row shows preset name, folder/path as secondary text, and a `HotkeyCapture`.
- Users can assign or clear hotkeys directly without opening the preset modal.

### 5. Dispatching Preset Hotkeys

`useKeyboardShortcuts.ts` subscribes to `usePresetStore` and builds a `Map<combo, Preset>` from all presets that have a `hotkey`.

On `keydown`:

- If no image is open (`selectedImage` is absent), ignore preset hotkeys.
- If a modal is open or an input/textarea is focused, ignore (existing behavior).
- Normalize the event combo and look it up in the preset map.
- If matched, apply the preset via `getEffectivePresetAdjustments(preset)` + `setAdjustments(...)` at 100% intensity.

### 6. Conflict Resolution

| Conflict Type | Behavior |
| --- | --- |
| Reserved/hardcoded shortcut (Escape, arrows, Delete in mask, etc.) | Block assignment, show "This combo is reserved by the application". |
| Reassignable application keybind from `KEYBIND_DEFINITIONS` | Show warning with action name; **Overwrite** clears `appSettings.keybinds[action]` to `[]` and assigns to preset. |
| Another preset already uses the combo | Show warning with preset name; **Overwrite** clears `hotkey` on the other preset and assigns to the current one. |

No automatic overwriting happens; the user must confirm each time.

### 7. Platform & i18n

- Use existing `normalizeCombo` / `formatKeyCode` so macOS users see `⌘`, `⌥`, etc.
- Add i18n keys under `modals.configurePreset.hotkey*`, `editor.presets.hotkey*`, and `settings.controls.presetHotkeys*` in `en.json` and `ru.json` (other locales can fall back to English).

### 8. Edge Cases

- Deleted preset: its hotkey disappears from the dispatch map automatically.
- Imported preset: its embedded `hotkey` is loaded; conflicts with existing presets are resolved lazily when the user edits them.
- Empty library: preset hotkeys are simply inactive.
- Intensity: always 100% when triggered by hotkey.

## Verification

- `npm run build` passes without new TypeScript errors.
- `cargo check` in `src-tauri/` passes.
- `npx prettier --check <changed-files>` passes.
- Manual check: assign a hotkey, verify it applies the preset in the editor, verify SettingsPanel reflects the change, verify conflicts show warnings.
