# Lights Off Mode — Design Spec

## Summary

Add a Lightroom-style "Lights Off" toggle bound to the `L` key. When active, the editor shows only the current image on a completely black screen, preserving the configured proof margin. All chrome (title bar, toolbars, panels, filmstrip) is hidden instantly. Pressing `L` or `Escape` exits the mode.

## Motivation

Users want to evaluate the photo without distractions from the surrounding UI, exactly like Lightroom's Lights Off view. The existing Clean View mode hides panels but keeps the editor background visible; Lights Off goes further by making the background fully black.

## Design

### State

- Add `lightsOffActive: boolean` to `src/store/useUIStore.ts`.
- It is a transient UI flag, **not** persisted to app settings.
- Add `toggleLightsOff()` action to the store.
- No snapshot/restore logic is required; the flag simply overrides the visible chrome and background color while active. Other flags (`isFullScreen`, `cleanViewActive`) remain untouched so the previous layout is restored when Lights Off is toggled off.

### Hotkey

- Register a new action `toggle_lights_off` in `src/utils/keyboardUtils.ts`:
  - `defaultCombo: ['KeyL']`
  - `section: 'view'`
  - Description key: `settings.keybinds.actions.toggle_lights_off`
- Add the handler in `src/hooks/useKeyboardShortcuts.ts`:
  - `shouldFire`: an image is selected in the editor.
  - `execute`: call `useUIStore.getState().toggleLightsOff()`.
- Add `'l'` to `GLOBAL_KEYS` in `src/components/ui/AppProperties.tsx` so the key is swallowed in text inputs.
- Update `Escape` handling in `useKeyboardShortcuts.ts` to exit Lights Off first if it is active.

### Rendering

When `lightsOffActive` is true:

- `src/App.tsx`:
  - Hide the custom title bar.
  - Hide the left sidebar.
  - Hide the external-edit bar if present.
  - Make the root app background fully black (`bg-black`) when the WGPU renderer is not active. When WGPU is active, keep the root transparent so the WGPU-rendered black background (and image) is visible.
  - Remove outer padding / rounded corners.
- `src/components/views/EditorView.tsx`:
  - Hide bottom bar / filmstrip.
  - Hide right-side panel.
  - Remove spacing that normally separates panels.
- `src/components/panel/Editor.tsx`:
  - Hide the editor toolbar.
  - Remove rounded corners and padding around the image stage.
  - Force the image container and stage backgrounds to `#000000`.
  - Pass black `[0, 0, 0, 1]` to the WGPU renderer as `bgPrimary` and `bgSecondary` so the GPU-rendered background is also black.
- `src/components/panel/editor/ImageCanvas.tsx`:
  - No direct changes. It continues to use `proofMargin` from `Editor.tsx` and `useImageRenderSize`, so the image is centered with the configured proof margin on the black background.

### Locale strings

Add to all locale files under `src/i18n/locales/*.json`:

```json
"settings": {
  "keybinds": {
    "actions": {
      "toggle_lights_off": "Toggle lights off"
    }
  }
}
```

Russian translation: `"Включить/выключить затемнение"`.

### Edge cases

- **Library view**: `L` does nothing when no image is selected in the editor.
- **Fullscreen / Clean View**: Lights Off can be activated on top of either mode. It hides additional chrome and turns the background black. Toggling Lights Off off returns to the previous fullscreen/clean-view state because those flags are not modified.
- **Escape precedence**: If Lights Off is active, `Escape` exits Lights Off first. Other Escape behaviors (e.g. closing modals) remain unchanged when Lights Off is inactive.
- **No animation**: `toggleLightsOff()` sets `isInstantTransition` while toggling (mirroring `toggleCleanView`), and all CSS transitions are skipped while `lightsOffActive` is true, so the switch is instant.

## Files touched

- `src/store/useUIStore.ts`
- `src/utils/keyboardUtils.ts`
- `src/hooks/useKeyboardShortcuts.ts`
- `src/components/ui/AppProperties.tsx`
- `src/App.tsx`
- `src/components/views/EditorView.tsx`
- `src/components/panel/Editor.tsx`
- `src/i18n/locales/*.json`

## Out of scope

- Persisting the Lights Off state across sessions.
- Adding a toolbar button or menu item (hotkey only for now).
- Changing proof margin behavior; existing margin levels continue to apply.
- Dimming the rest of the screen differently; it is fully black.

## Verification

- `npm run build` should pass without new errors.
- Pressing `L` in the editor hides all chrome and shows a black background with the image centered according to the current proof margin.
- Pressing `L` or `Escape` restores the previous editor layout.
- Pressing `L` in the library does nothing.
