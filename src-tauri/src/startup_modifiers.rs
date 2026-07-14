//! Startup modifier-key detection.
//!
//! This module detects whether the user is holding the modifier key(s) that
//! request the start screen on application startup.
//!
//! - macOS: `Option` (`Alt`) or `Shift` opens the start screen.
//! - Windows/Linux: `Shift` opens the start screen.
//!
//! The detection queries the GUI toolkit (`AppKit`, `Win32`, `GTK/GDK`) and
//! therefore must be called on the main/GUI thread after the toolkit has been
//! initialized.

pub fn is_start_screen_modifier_pressed() -> bool {
    check_current_platform()
}

#[cfg(target_os = "macos")]
fn check_current_platform() -> bool {
    use objc::runtime::Class;
    use objc::{msg_send, sel, sel_impl};

    const NSEVENT_MODIFIER_FLAG_SHIFT: u64 = 1 << 17;
    const NSEVENT_MODIFIER_FLAG_OPTION: u64 = 1 << 19;

    let Some(class) = Class::get("NSEvent") else {
        return false;
    };

    unsafe {
        // SAFETY: `class` is a valid Objective-C `NSEvent` meta-class object,
        // and `modifierFlags` is a class method that returns a bit mask of the
        // currently pressed modifier keys. It is only valid to call after the
        // AppKit/GUI runtime has been initialized on the main thread.
        let flags: u64 = msg_send![class, modifierFlags];
        (flags & (NSEVENT_MODIFIER_FLAG_SHIFT | NSEVENT_MODIFIER_FLAG_OPTION)) != 0
    }
}

#[cfg(target_os = "windows")]
fn check_current_platform() -> bool {
    const VK_LSHIFT: i32 = 0xA0;
    const VK_RSHIFT: i32 = 0xA1;

    #[link(name = "user32")]
    extern "system" {
        fn GetAsyncKeyState(vKey: i32) -> i16;
    }

    unsafe {
        // SAFETY: `GetAsyncKeyState` reads the asynchronous key state for the
        // specified virtual-key codes on the calling thread. `VK_LSHIFT` and
        // `VK_RSHIFT` are valid Windows virtual-key codes for the left and
        // right Shift keys.
        (GetAsyncKeyState(VK_LSHIFT) & 0x8000) != 0 || (GetAsyncKeyState(VK_RSHIFT) & 0x8000) != 0
    }
}

#[cfg(target_os = "linux")]
fn check_current_platform() -> bool {
    use std::ffi::{c_uint, c_void};

    const GDK_SHIFT_MASK: c_uint = 1 << 0;

    extern "C" {
        fn gdk_display_get_default() -> *mut c_void;
        fn gdk_keymap_get_for_display(display: *mut c_void) -> *mut c_void;
        fn gdk_keymap_get_modifier_state(keymap: *mut c_void) -> c_uint;
    }

    unsafe {
        // SAFETY: These functions are part of the GTK/GDK libraries that are
        // already linked into this process. The returned pointers are checked
        // for null before use, and `gdk_keymap_get_modifier_state` only reads
        // the current modifier state. This must be called on the GUI thread
        // after GTK has been initialized.
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
fn check_current_platform() -> bool {
    false
}
