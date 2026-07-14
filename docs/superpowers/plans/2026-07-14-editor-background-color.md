# Editor background color picker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-click popup menu on the editor background that lets the user pick one of 10 grayscale shades from white to black, persists the choice in settings, and applies it behind the photo for both CPU and WGPU render paths.

**Architecture:** A new `editorBackgroundColor?: string` preference is added to `AppSettings` on both the TypeScript and Rust sides. A small utility (`src/utils/editorBackground.ts`) owns the 10-step color array and the fallback-to-theme helper. The editor container reads the effective color and updates its DOM background / WGPU ring color. The existing editor context menu gets a new submenu of swatches that call `handleSettingsChange`.

**Tech Stack:** React, TypeScript, Zustand, Tailwind CSS, Tauri (Rust), i18next, clsx.

---

## Task 1: Add `editorBackgroundColor` to the TypeScript `AppSettings` interface

**Files:**

- Modify: `src/components/ui/AppProperties.tsx:181-236`

- [ ] **Step 1: Insert the new optional field**

Add `editorBackgroundColor?: string;` anywhere inside the `AppSettings` interface, for example after `enableFocusMode?: boolean;`:

```ts
export interface AppSettings {
  // ... existing fields ...
  enableFocusMode?: boolean;
  editorBackgroundColor?: string;
  openTreeSections?: string[];
  // ...
}
```

- [ ] **Step 2: Verify no TS errors yet**

Run: `npx tsc --noEmit`
Expected: no new errors (baseline is pre-existing).

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/AppProperties.tsx
git commit -m "add editorBackgroundColor to AppSettings interface"
```

---

## Task 2: Add the corresponding Rust field to `AppSettings`

**Files:**

- Modify: `src-tauri/src/app_settings.rs:329-451` (struct definition)
- Modify: `src-tauri/src/app_settings.rs:453-544` (Default impl)

- [ ] **Step 1: Add the field to the struct**

Inside `pub struct AppSettings` (after `proof_margin_level`, line 450), add:

```rust
    #[serde(default)]
    pub editor_background_color: Option<String>,
```

The struct tail should now end with:

```rust
    #[serde(default)]
    pub proof_margin_level: Option<u8>,
    #[serde(default)]
    pub editor_background_color: Option<String>,
}
```

- [ ] **Step 2: Add the field to the Default impl**

In `impl Default for AppSettings`, add the new field (default `None`). A good spot is at the end of the initializer, after `proof_margin_level: Some(1),`:

```rust
            proof_margin_level: Some(1),
            editor_background_color: None,
        }
```

- [ ] **Step 3: Check Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/app_settings.rs
git commit -m "add editor_background_color rust setting"
```

---

## Task 3: Create the editor background color utility

**Files:**

- Create: `src/utils/editorBackground.ts`

- [ ] **Step 1: Write the utility file**

```ts
export const EDITOR_BACKGROUND_OPTIONS: { label: string; color: string }[] = [
  { label: '100%', color: 'rgb(255, 255, 255)' },
  { label: '90%', color: 'rgb(230, 230, 230)' },
  { label: '75%', color: 'rgb(191, 191, 191)' },
  { label: '60%', color: 'rgb(153, 153, 153)' },
  { label: '45%', color: 'rgb(115, 115, 115)' },
  { label: '30%', color: 'rgb(77, 77, 77)' },
  { label: '20%', color: 'rgb(51, 51, 51)' },
  { label: '10%', color: 'rgb(26, 26, 26)' },
  { label: '5%', color: 'rgb(13, 13, 13)' },
  { label: '0%', color: 'rgb(0, 0, 0)' },
];

export const EDITOR_BACKGROUND_COLORS = EDITOR_BACKGROUND_OPTIONS.map((option) => option.color);

export function getDefaultEditorBackground(): string {
  if (typeof document === 'undefined') {
    return 'rgb(35, 35, 35)';
  }
  const rootStyle = getComputedStyle(document.documentElement);
  return rootStyle.getPropertyValue('--app-bg-secondary').trim() || 'rgb(35, 35, 35)';
}
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/editorBackground.ts
git commit -m "add editor background color utility"
```

---

## Task 4: Apply the chosen background color in the editor viewer

**Files:**

- Modify: `src/components/panel/Editor.tsx`
  - Add import near the top
  - Modify `useEffect` that builds `wgpuStateRef` (~line 1094)
  - Modify the image container className/style (~line 1966)

- [ ] **Step 1: Import the utility**

After the existing local imports, add:

```ts
import { getDefaultEditorBackground } from '../../utils/editorBackground';
```

- [ ] **Step 2: Compute effective color and pass it to WGPU**

In the `useEffect` at line 1094, replace the `bgSecondaryStr` computation so it respects the user setting:

Old:

```ts
const bgSecondaryStr = rootStyle.getPropertyValue('--app-bg-secondary') || 'rgb(35, 35, 35)';
```

New:

```ts
const bgSecondaryStr =
  appSettings?.editorBackgroundColor || rootStyle.getPropertyValue('--app-bg-secondary') || 'rgb(35, 35, 35)';
```

Also add `appSettings?.editorBackgroundColor` to the dependency array of that `useEffect`.

- [ ] **Step 3: Apply the effective color to the DOM container**

Near line 1966, find the `div` with `ref={imageContainerRef}`. Compute the effective color before the `return`:

After `const isWgpuActive = appSettings?.useWgpuRenderer !== false && hasRenderedFirstFrame;` (line 1923), add:

```ts
const editorBackgroundColor = appSettings?.editorBackgroundColor || getDefaultEditorBackground();
```

Then replace the image container `className` block:

Old:

```tsx
      <div
        className={clsx(
          'flex-1 relative overflow-hidden touch-none',
          isFullScreen ? 'rounded-none' : 'rounded-lg',
          appSettings?.useWgpuRenderer !== false && !isFullScreen && 'ring-[9999px] ring-bg-secondary',
          !isWgpuActive && 'bg-bg-secondary',
        )}
        style={{ cursor: cursorStyle }}
```

New:

```tsx
      <div
        className={clsx(
          'flex-1 relative overflow-hidden touch-none',
          isFullScreen ? 'rounded-none' : 'rounded-lg',
          appSettings?.useWgpuRenderer !== false && !isFullScreen && 'ring-[9999px]',
          !isWgpuActive && 'bg-bg-secondary',
        )}
        style={{
          cursor: cursorStyle,
          backgroundColor: !isWgpuActive ? editorBackgroundColor : undefined,
          '--tw-ring-color': appSettings?.useWgpuRenderer !== false && !isFullScreen ? editorBackgroundColor : undefined,
        } as React.CSSProperties}
```

> Note: setting `--tw-ring-color` inline applies the same color to the giant `ring-[9999px]` used by the WGPU path. Fallback `bg-bg-secondary` stays on the CPU path when no custom color is set.

- [ ] **Step 4: Verify TS and formatting**

Run:

```bash
npx tsc --noEmit
npx prettier --check src/components/panel/Editor.tsx src/utils/editorBackground.ts
```

Expected: no new TS errors; Prettier passes (run `npx prettier --write ...` if needed).

- [ ] **Step 5: Commit**

```bash
git add src/components/panel/Editor.tsx src/utils/editorBackground.ts
git commit -m "apply editor background color to viewer"
```

---

## Task 5: Add the background-color submenu to the editor context menu

**Files:**

- Modify: `src/hooks/useAppContextMenus.ts`
  - Import the utility
  - Add a new option inside `handleEditorContextMenu`

- [ ] **Step 1: Import the utility**

After the existing imports, add:

```ts
import { EDITOR_BACKGROUND_OPTIONS, getDefaultEditorBackground } from '../utils/editorBackground';
```

- [ ] **Step 2: Read `handleSettingsChange` from the settings store**

Inside `useAppContextMenus`, after `const { appSettings } = useSettingsStore.getState();` is already fetched inside the callback, also read the action:

Change:

```ts
const { appSettings } = useSettingsStore.getState();
```

to:

```ts
const { appSettings, handleSettingsChange } = useSettingsStore.getState();
```

- [ ] **Step 3: Build the background-color submenu**

Add the following helper inside the callback, before `const options: Array<Option> = [`:

```ts
const backgroundColorSubmenu: Option[] = [
  ...EDITOR_BACKGROUND_OPTIONS.map(({ label, color }) => ({
    label,
    color,
    onClick: () => {
      if (!appSettings) return;
      handleSettingsChange({ ...appSettings, editorBackgroundColor: color });
    },
  })),
  { type: OPTION_SEPARATOR },
  {
    label: t('contextMenus.editor.resetBackgroundColor'),
    icon: RotateCcw,
    onClick: () => {
      if (!appSettings) return;
      const { editorBackgroundColor: _, ...rest } = appSettings;
      handleSettingsChange(rest as AppSettings);
    },
  },
];
```

- [ ] **Step 4: Insert the new menu item**

Inside `const options: Array<Option> = [ ... ]`, add a new entry after the `exportImage` separator or near the top. For example, after the first separator (line 181), insert:

```ts
        {
          label: t('contextMenus.editor.backgroundColor'),
          icon: Palette,
          submenu: backgroundColorSubmenu,
        },
        { type: OPTION_SEPARATOR },
```

The beginning of `options` will look like:

```ts
      const options: Array<Option> = [
        {
          label: t('contextMenus.editor.exportImage'),
          icon: FileInput,
          onClick: () => setRightPanel(Panel.Export),
        },
        { type: OPTION_SEPARATOR },
        {
          label: t('contextMenus.editor.backgroundColor'),
          icon: Palette,
          submenu: backgroundColorSubmenu,
        },
        { type: OPTION_SEPARATOR },
        // undo/redo etc.
```

- [ ] **Step 5: Add `AppSettings` import if needed**

`AppSettings` is already imported from `../components/ui/AppProperties` (used in the existing `Option` import), so the type cast `as AppSettings` is fine.

- [ ] **Step 6: Verify TS and formatting**

Run:

```bash
npx tsc --noEmit
npx prettier --check src/hooks/useAppContextMenus.ts
```

Expected: no new errors; Prettier passes.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useAppContextMenus.ts
git commit -m "add editor background color context menu"
```

---

## Task 6: Add locale strings

**Files:**

- Modify: `src/i18n/locales/en.json:216-241`
- Modify: `src/i18n/locales/ru.json:216-241`

- [ ] **Step 1: Add English strings**

Inside `"contextMenus.editor"`, add two new keys alphabetically:

```json
      "backgroundColor": "Background color",
      "resetBackgroundColor": "Reset background color",
```

Result:

```json
    "editor": {
      "autoAdjust": "Auto Adjust Image",
      "backgroundColor": "Background color",
      "cancel": "Cancel",
      // ...
      "resetAdjustments": "Reset Adjustments",
      "resetBackgroundColor": "Reset background color",
      // ...
    },
```

- [ ] **Step 2: Add Russian strings**

```json
      "backgroundColor": "Цвет фона",
      "resetBackgroundColor": "Сбросить цвет фона",
```

- [ ] **Step 3: Commit**

```bash
git add src/i18n/locales/en.json src/i18n/locales/ru.json
git commit -m "add editor background color locale strings"
```

---

## Task 7: Final verification

- [ ] **Step 1: Frontend build**

Run: `npm run build`
Expected: build succeeds with no new errors (pre-existing TS baseline is allowed).

- [ ] **Step 2: Rust check**

Run: `cd src-tauri && cargo check`
Expected: success.

- [ ] **Step 3: Prettier check on all changed files**

```bash
npx prettier --check \
  src/components/ui/AppProperties.tsx \
  src/components/panel/Editor.tsx \
  src/hooks/useAppContextMenus.ts \
  src/utils/editorBackground.ts \
  src/i18n/locales/en.json \
  src/i18n/locales/ru.json
```

Expected: all files pass.

- [ ] **Step 4: Final commit (optional)**

If any fixes were needed, commit them with a message like:

```bash
git commit -m "verify editor background color feature"
```

---

## Spec coverage checklist

| Spec requirement                       | Implementing task |
| -------------------------------------- | ----------------- |
| 10 grayscale steps from white to black | Task 3            |
| Popup menu on editor background        | Task 5            |
| Persist in `AppSettings`               | Tasks 1, 2        |
| Apply to CPU (DOM) and WGPU paths      | Task 4            |
| Reset to theme default                 | Tasks 3, 4, 5     |
| Locale strings                         | Task 6            |
| Verification                           | Task 7            |

## Known constraints / notes

- The WGPU clear color is sent to Rust via the existing `update_wgpu_transform` flow inside `Editor.tsx`. Because `appSettings?.editorBackgroundColor` is added to the dependency array, the WGPU state refreshes when the user picks a color.
- `getDefaultEditorBackground()` reads `--app-bg-secondary` at runtime, so changing the theme still updates the fallback color correctly.
- The `OPTION_SEPARATOR` and `Palette` icon are already used by existing editor context-menu items (`colorLabel`).
