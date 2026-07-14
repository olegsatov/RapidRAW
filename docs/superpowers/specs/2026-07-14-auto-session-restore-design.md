# Auto Session Restore Design

## Goal

Remove the need to click **Continue Session** on the start screen. Instead, the app should automatically restore the previous session on launch. The start screen should still be reachable by holding a modifier key at startup:

- **macOS:** `Option` or `Shift`
- **Windows / Linux:** `Shift`

External launches (`Open With`, `--edit`) keep their current priority and skip auto-restore. If there is no saved session, the start screen is shown as before.

## Current behavior

The start screen is rendered by `MainLibrary` whenever `rootPaths` is empty. The user must click **Continue Session**, which calls `handleContinueSession` in `useAppNavigation.ts`. That function restores `rootPaths`, folder trees, the last selected folder/album, and the last open image.

`useAppInitialization.ts` already loads settings, preloads folder trees/images for the saved folder, and notifies the backend via the `frontend_ready` command.

## Proposed architecture

Add a thin platform-specific layer in Rust that detects whether the user is holding the startup modifier key, expose the result through `frontend_ready`, and let `App.tsx` decide whether to call `handleContinueSession` automatically.

Existing restore logic in `useAppNavigation.ts` is reused unchanged.

## Components and changes

### 1. `src-tauri/src/startup_modifiers.rs` (new)

A single public function:

```rust
pub fn is_start_screen_modifier_pressed() -> bool
```

Platform implementations:

- **macOS:** call `+[NSEvent modifierFlags]` through the existing `objc` dependency. Check `NSEventModifierFlagShift` (`1 << 17`) or `NSEventModifierFlagOption` (`1 << 19`). No Input Monitoring permission is required.
- **Windows:** call `GetAsyncKeyState` for `VK_LSHIFT` / `VK_RSHIFT` via a raw `user32` import. No extra crate is needed.
- **Linux:** query `gdk_keymap_get_modifier_state` through the already linked GTK/GDK libraries and check `GDK_SHIFT_MASK`. If the display or keymap is unavailable, fall back to `false`.

### 2. `src-tauri/src/lib.rs`

- Extend `LaunchPayload` with `show_start_screen: bool`.
- In `frontend_ready`, after handling `open_with_file` / `edit_session`:
  - If an external launch is present, set `show_start_screen` to `false`.
  - Otherwise, call `is_start_screen_modifier_pressed()` and store the result.

### 3. `src/hooks/useAppInitialization.ts`

- Accept a new optional prop: `onFrontendReady?: (launch: any) => void`.
- After invoking `frontend_ready`, continue writing `editSession` / `openWithFile` into `useProcessStore` as today, then call `onFrontendReady(launch)`.

### 4. `src/App.tsx`

- Add `const autoRestoreAttemptedRef = useRef(false)`.
- Pass `onFrontendReady` to `useAppInitialization`.
- Inside the callback:
  - If `launch.showStartScreen` is `true`, do nothing; `MainLibrary` will render the start screen because `rootPaths` is still empty.
  - If `launch.openWithFile` or `launch.editSession` is present, do nothing; the external file session takes precedence.
  - Otherwise, if not already attempted, call `handleContinueSession()` once.

## Data flow

```
App launches
  ↓
Tauri setup parses args → initial_file_path / pending_edit_session
  ↓
React mounts → useAppInitialization
  ↓
LoadSettings → preloadedDataRef is populated
  ↓
frontend_ready()
  - shows/focuses window
  - checks modifier keys
  - returns { openWithFile?, editSession?, showStartScreen }
  ↓
onFrontendReady(launch)
  - external launch? → useProcessStore, skip auto-restore
  - showStartScreen? → leave rootPaths empty, start screen is shown
  - otherwise → handleContinueSession() restores rootPaths/folderTrees/last image
```

## Error handling and edge cases

- **No saved session:** `handleContinueSession()` returns immediately because `rootFolders` is empty. `rootPaths` stays empty, so `MainLibrary` shows the start screen.
- **Restore fails:** `handleContinueSession()` already catches errors, shows a toast, and calls `handleGoHome()`, which leaves the app on the start screen.
- **React StrictMode double invocation:** guarded by `autoRestoreAttemptedRef` in `App.tsx`.
- **Android:** auto-restore is not triggered. The existing preloading path already excludes Android.
- **Linux/Wayland without keymap access:** fallback to `false`, so auto-restore runs. This is acceptable because the modifier-based start screen is a convenience, not a hard requirement.

## Verification

- `cargo check` in `src-tauri/`
- `npm run build`
- Manual scenarios:
  - Launch without a modifier key → previous folder and last image open automatically.
  - Launch with `Shift` held → start screen appears.
  - On macOS, launch with `Option` held → start screen appears.
  - Launch via `Open With` or `--edit` → the requested file opens, session is not restored.
  - Delete or move the previously saved folder, then launch → start screen appears with an error toast.

## Decisions and open questions

- The start screen button **Continue Session** is kept as-is; it now serves as a manual fallback for users who dismissed the auto-restore or launched with a modifier key.
- No new locale strings are required.
