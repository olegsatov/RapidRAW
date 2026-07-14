# Auto Session Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app restore the previous session automatically on launch, while still allowing the start screen to be reached by holding `Option`/`Shift` on macOS or `Shift` on Windows/Linux.

**Architecture:** A new Rust module detects the startup modifier keys. `frontend_ready` returns a `show_start_screen` flag. `useAppInitialization` exposes the launch payload through a new `onFrontendReady` callback, and `App.tsx` decides whether to call the existing `handleContinueSession` automatically.

**Tech Stack:** Rust (Tauri v2, `objc` on macOS, raw `user32` on Windows, GTK/GDK on Linux), TypeScript + React, Zustand, Prettier.

---

## Task 1: Create the Rust modifier-detection module

**Files:**
- Create: `src-tauri/src/startup_modifiers.rs`
- Modify: `src-tauri/src/lib.rs` (add module declaration)

- [ ] **Step 1: Create `src-tauri/src/startup_modifiers.rs`**

```rust
pub fn is_start_screen_modifier_pressed() -> bool {
    inner()
}

#[cfg(target_os = "macos")]
fn inner() -> bool {
    use objc::{msg_send, sel, sel_impl};
    use objc::runtime::Class;

    const NSEVENT_MODIFIER_FLAG_SHIFT: u64 = 1 << 17;
    const NSEVENT_MODIFIER_FLAG_OPTION: u64 = 1 << 19;

    unsafe {
        let class = Class::get("NSEvent").expect("NSEvent class not found");
        let flags: u64 = msg_send![class, modifierFlags];
        (flags & (NSEVENT_MODIFIER_FLAG_SHIFT | NSEVENT_MODIFIER_FLAG_OPTION)) != 0
    }
}

#[cfg(target_os = "windows")]
fn inner() -> bool {
    const VK_LSHIFT: i32 = 0xA0;
    const VK_RSHIFT: i32 = 0xA1;

    #[link(name = "user32")]
    extern "system" {
        fn GetAsyncKeyState(vKey: i32) -> i16;
    }

    unsafe {
        (GetAsyncKeyState(VK_LSHIFT) & 0x8000) != 0
            || (GetAsyncKeyState(VK_RSHIFT) & 0x8000) != 0
    }
}

#[cfg(target_os = "linux")]
fn inner() -> bool {
    use std::ffi::c_void;
    use std::os::raw::c_uint;

    const GDK_SHIFT_MASK: c_uint = 1 << 0;

    extern "C" {
        fn gdk_display_get_default() -> *mut c_void;
        fn gdk_keymap_get_for_display(display: *mut c_void) -> *mut c_void;
        fn gdk_keymap_get_modifier_state(keymap: *mut c_void) -> c_uint;
    }

    unsafe {
        let display = gdk_display_get_default();
        if display.is_null() {
            return false;
        }
        let keymap = gdk_keymap_get_for_display(display);
        if keymap.is_null() {
            return false;
        }
        let state = gdk_keymap_get_modifier_state(keymap);
        (state & GDK_SHIFT_MASK) != 0
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn inner() -> bool {
    false
}
```

- [ ] **Step 2: Register the module in `src-tauri/src/lib.rs`**

Add a new line in the module list near the top:

```rust
mod startup_modifiers;
```

- [ ] **Step 3: Verify Rust compiles**

Run:

```bash
cd src-tauri
cargo check
```

Expected: `error` count is `0`. Warnings about unused code are OK at this stage.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/startup_modifiers.rs src-tauri/src/lib.rs
git commit -m "add startup modifier key detection"
```

---

## Task 2: Return the modifier result from `frontend_ready`

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Extend `LaunchPayload`**

Find:

```rust
#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct LaunchPayload {
    open_with_file: Option<String>,
    edit_session: Option<ExternalEditSession>,
}
```

Replace with:

```rust
#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct LaunchPayload {
    open_with_file: Option<String>,
    edit_session: Option<ExternalEditSession>,
    show_start_screen: bool,
}
```

- [ ] **Step 2: Compute `show_start_screen` before returning**

Find the end of `frontend_ready` (around the `Ok(LaunchPayload { ... })` return). Replace:

```rust
    let open_with_file = state.initial_file_path.lock().unwrap().take();
    let edit_session = state.pending_edit_session.lock().unwrap().take();
    if let Some(path) = &open_with_file {
        log::info!("Frontend is ready, returning initial path: {}", path);
    }
    if let Some(session) = &edit_session {
        log::info!(
            "Frontend is ready, returning external edit session for: {}",
            &session.source
        );
    }
    Ok(LaunchPayload {
        open_with_file,
        edit_session,
    })
```

with:

```rust
    let open_with_file = state.initial_file_path.lock().unwrap().take();
    let edit_session = state.pending_edit_session.lock().unwrap().take();
    if let Some(path) = &open_with_file {
        log::info!("Frontend is ready, returning initial path: {}", path);
    }
    if let Some(session) = &edit_session {
        log::info!(
            "Frontend is ready, returning external edit session for: {}",
            &session.source
        );
    }

    let show_start_screen =
        open_with_file.is_none() && edit_session.is_none() && startup_modifiers::is_start_screen_modifier_pressed();

    Ok(LaunchPayload {
        open_with_file,
        edit_session,
        show_start_screen,
    })
```

- [ ] **Step 3: Verify Rust compiles**

Run:

```bash
cd src-tauri
cargo check
```

Expected: `error` count is `0`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "pass show_start_screen flag from frontend_ready"
```

---

## Task 3: Forward the launch payload to `App.tsx`

**Files:**
- Modify: `src/hooks/useAppInitialization.ts`

- [ ] **Step 1: Add the `onFrontendReady` prop**

Find the `UseAppInitializationProps` interface and add the callback:

```typescript
interface UseAppInitializationProps {
  preloadedDataRef: React.RefObject<any>;
  thumbnailSize: ThumbnailSize;
  setThumbnailSize: (size: ThumbnailSize) => void;
  thumbnailAspectRatio: ThumbnailAspectRatio;
  setThumbnailAspectRatio: (ratio: ThumbnailAspectRatio) => void;
  libraryViewMode: LibraryViewMode;
  setLibraryViewMode: (mode: LibraryViewMode) => void;
  onFrontendReady?: (launch: any) => void;
}
```

- [ ] **Step 2: Destructure the prop in the hook**

Find:

```typescript
export const useAppInitialization = ({
  preloadedDataRef,
  thumbnailSize,
  setThumbnailSize,
  thumbnailAspectRatio,
  setThumbnailAspectRatio,
  libraryViewMode,
  setLibraryViewMode,
}: UseAppInitializationProps) => {
```

Replace with:

```typescript
export const useAppInitialization = ({
  preloadedDataRef,
  thumbnailSize,
  setThumbnailSize,
  thumbnailAspectRatio,
  setThumbnailAspectRatio,
  libraryViewMode,
  setLibraryViewMode,
  onFrontendReady,
}: UseAppInitializationProps) => {
```

- [ ] **Step 3: Invoke the callback after `frontend_ready`**

Find:

```typescript
        invoke('frontend_ready')
          .then((launch: any) => {
            if (launch?.editSession) {
              useProcessStore.getState().setProcess({ externalEditSession: launch.editSession });
            } else if (launch?.openWithFile) {
              useProcessStore.getState().setProcess({ initialFileToOpen: launch.openWithFile });
            }
          })
          .catch((e) => console.error('Failed to notify backend of readiness:', e));
```

Replace with:

```typescript
        invoke('frontend_ready')
          .then((launch: any) => {
            if (launch?.editSession) {
              useProcessStore.getState().setProcess({ externalEditSession: launch.editSession });
            } else if (launch?.openWithFile) {
              useProcessStore.getState().setProcess({ initialFileToOpen: launch.openWithFile });
            }
            onFrontendReady?.(launch);
          })
          .catch((e) => console.error('Failed to notify backend of readiness:', e));
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useAppInitialization.ts
git commit -m "add onFrontendReady callback to useAppInitialization"
```

---

## Task 4: Trigger auto-restore from `App.tsx`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the auto-restore attempted ref**

Find the refs near the top of `App` (around `isBackendReadyRef`). Add after:

```typescript
  const isBackendReadyRef = useRef(true);
```

this line:

```typescript
  const autoRestoreAttemptedRef = useRef(false);
```

- [ ] **Step 2: Move `useAppInitialization` after `useAppNavigation`**

Find the existing `useAppInitialization` call (currently before `useAppNavigation`). Remove it. We will re-add it after `handleContinueSession` is available.

Find the `useAppNavigation` block that returns `handleContinueSession`. After that block, add:

```typescript
  const handleFrontendReady = useCallback(
    (launch: any) => {
      if (autoRestoreAttemptedRef.current) {
        return;
      }
      autoRestoreAttemptedRef.current = true;

      if (launch?.showStartScreen) {
        return;
      }

      if (launch?.openWithFile || launch?.editSession) {
        return;
      }

      handleContinueSession();
    },
    [handleContinueSession],
  );

  useAppInitialization({
    preloadedDataRef,
    thumbnailSize,
    setThumbnailSize,
    thumbnailAspectRatio,
    setThumbnailAspectRatio,
    libraryViewMode,
    setLibraryViewMode,
    onFrontendReady: handleFrontendReady,
  });
```

Make sure `useCallback` is already imported from React (it is at the top of `App.tsx`).

- [ ] **Step 3: Build the frontend**

Run:

```bash
npm run build
```

Expected: build completes without new TypeScript errors.

- [ ] **Step 4: Check formatting**

Run:

```bash
npx prettier --check src/App.tsx src/hooks/useAppInitialization.ts src-tauri/src/lib.rs src-tauri/src/startup_modifiers.rs
```

If it fails, run:

```bash
npx prettier --write src/App.tsx src/hooks/useAppInitialization.ts src-tauri/src/lib.rs src-tauri/src/startup_modifiers.rs
```

Then re-run the check.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/hooks/useAppInitialization.ts
git commit -m "auto-restore previous session on startup"
```

---

## Task 5: Verify the integration

**Files:** none (manual checks)

- [ ] **Step 1: Run the Rust checks**

```bash
cd src-tauri
cargo check
```

Expected: `error` count is `0`.

- [ ] **Step 2: Run the full frontend build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Manual scenario — normal launch**

1. Open a folder, select an image, then close the app.
2. Launch the app without holding any modifier key.
3. Expected: the previous folder tree loads and the last selected image opens in the editor.

- [ ] **Step 4: Manual scenario — modifier key shows start screen**

1. Hold `Shift` (on any platform) while launching the app.
2. On macOS, repeat with `Option` held.
3. Expected: the start screen appears, and clicking **Continue Session** still restores the previous session.

- [ ] **Step 5: Manual scenario — external launch has priority**

1. Close the app with a saved session.
2. Launch the app via `Open With` on an image file, or via `--edit <source> --output <output>`.
3. Expected: the externally requested file opens; the previous session is not restored.

- [ ] **Step 6: Manual scenario — missing folder**

1. Save a session, then move or delete the saved folder.
2. Launch without a modifier key.
3. Expected: an error toast appears and the app lands on the start screen.

- [ ] **Step 7: Final formatting check**

```bash
npx prettier --check src/App.tsx src/hooks/useAppInitialization.ts src-tauri/src/lib.rs src-tauri/src/startup_modifiers.rs
```

Expected: passes.

---

## Self-Review Checklist

- [x] Spec coverage: every requirement (auto-restore, modifier keys, external launch priority, fallback to start screen) maps to a task.
- [x] No placeholders: every step includes exact file paths and code or commands.
- [x] Type consistency: `showStartScreen` / `show_start_screen` used consistently; `onFrontendReady` signature matches its usage.
