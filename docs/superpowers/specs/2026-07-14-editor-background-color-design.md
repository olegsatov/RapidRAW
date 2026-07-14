# Editor background color picker

## Goal

Allow the user to change the gray background behind the photo in the editor from white to black in 10 discrete steps, using a popup menu that appears when clicking the background area.

## Background

The editor viewer in `src/components/panel/Editor.tsx` currently shows a gray background coming from the active theme (`--app-bg-secondary` / `bg-bg-secondary`). For WGPU rendering the same gray is also sent to the Rust backend as `bgSecondary`. Users want to override this color independently of the theme to better judge exposure, contrast, and black/white points.

## Decisions

### Scope

- Trigger: right-click on the editor background area (reuses the existing editor context menu).
- UI: popup submenu with 10 preset grayscale swatches plus a "Reset" item.
- Persistence: saved in `AppSettings` so it survives restarts.
- Fallback: when no custom color is set, the theme's `--app-bg-secondary` is used.
- No separate Settings panel control; the feature is accessed only via the popup menu as requested.

### Color scale

10 non-linear steps from white to black. Steps are rounded to 5% and packed tighter near black so shadow/detail judgement is finer in the dark range:

| Label | RGB                  | Hex       |
| ----- | -------------------- | --------- |
| 100%  | `rgb(255, 255, 255)` | `#FFFFFF` |
| 90%   | `rgb(230, 230, 230)` | `#E6E6E6` |
| 75%   | `rgb(191, 191, 191)` | `#BFBFBF` |
| 60%   | `rgb(153, 153, 153)` | `#999999` |
| 45%   | `rgb(115, 115, 115)` | `#737373` |
| 30%   | `rgb(77, 77, 77)`    | `#4D4D4D` |
| 20%   | `rgb(51, 51, 51)`    | `#333333` |
| 10%   | `rgb(26, 26, 26)`    | `#1A1A1A` |
| 5%    | `rgb(13, 13, 13)`    | `#0D0D0D` |
| 0%    | `rgb(0, 0, 0)`       | `#000000` |

RGB is used so the existing WGPU `parseRgb` helper parses the same value that CSS displays. Each menu item shows its percentage label.

### Architecture

Add a single new preference `editorBackgroundColor?: string` that is interpreted by the editor and updated through the existing settings store/context-menu flow.

## Components / files changed

### New file

- `src/utils/editorBackground.ts`
  - `EDITOR_BACKGROUND_OPTIONS: { label: string; color: string }[]` — the 10 RGB grayscale values with percentage labels.
  - `EDITOR_BACKGROUND_COLORS: string[]` — convenience array of just the colors.
  - `getDefaultEditorBackground(): string` — reads `--app-bg-secondary` from `document.documentElement` and returns it as an `rgb(...)` string, falling back to `rgb(35, 35, 35)`.

### Modified frontend files

- `src/components/ui/AppProperties.tsx`
  - Add `editorBackgroundColor?: string` to the `AppSettings` interface.
- `src/hooks/useAppContextMenus.ts`
  - In `handleEditorContextMenu`, add a new top-level option `contextMenus.editor.backgroundColor` with a `submenu` array.
  - The submenu contains 10 `Option` entries, each with `label` (the percentage), `color` (the RGB value), and `onClick` calling `handleSettingsChange({ ...appSettings, editorBackgroundColor: color })`.
  - After the 10 swatches add a separator and a "Reset" option that sets `editorBackgroundColor` to `undefined`.
- `src/components/panel/Editor.tsx`
  - Compute `effectiveBackgroundColor = appSettings?.editorBackgroundColor ?? getDefaultEditorBackground()`.
  - Apply `effectiveBackgroundColor` to the image container:
    - Non-WGPU: inline `style={{ backgroundColor: effectiveBackgroundColor }}` (replacing the conditional `bg-bg-secondary`).
    - WGPU: use `effectiveBackgroundColor` for the `ring-[9999px]` color and pass it as `bgSecondary` to the Rust transform update.
- `src/i18n/locales/*.json`
  - Add keys:
    - `contextMenus.editor.backgroundColor`
    - `contextMenus.editor.resetBackgroundColor`

### Modified Rust files

- `src-tauri/src/app_settings.rs`
  - Add `editor_background_color: Option<String>` to the `AppSettings` struct (default `None`).
  - Include it in serialization/deserialization and any migration/default impl.

## Data flow

1. User right-clicks the editor background → `handleEditorContextMenu` builds options.
2. User clicks a swatch → `handleSettingsChange` updates the Zustand store and invokes `Invokes.SaveSettings`.
3. `Editor.tsx` reacts to the changed `appSettings` and applies `effectiveBackgroundColor` to the DOM and to the WGPU payload.
4. If user clicks "Reset", `editorBackgroundColor` becomes `undefined` and the theme default is restored.

## Error handling

- Invalid/missing saved color: fallback to `getDefaultEditorBackground()`.
- Theme changes: custom color is preserved until reset.
- WGPU and CPU render paths must both use the same effective color.

## Verification

- `npm run build` — frontend bundle (typecheck gate).
- `cargo check` in `src-tauri/` — Rust compile.
- `npx prettier --check <changed-files>` — formatting.
