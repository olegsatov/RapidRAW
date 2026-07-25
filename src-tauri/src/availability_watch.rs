use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::json;
use tauri::{AppHandle, Emitter};

/// Manages FSEvents/kqueue watchers for root library folders. When a watched
/// root path is modified or removed (e.g. a network volume goes away), we
/// re-check availability and emit the result to the frontend.
pub struct AvailabilityWatchers {
    watchers: Mutex<HashMap<String, RecommendedWatcher>>,
}

impl AvailabilityWatchers {
    pub fn new() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
        }
    }

    /// Replace the watched set with `paths`. Paths that disappeared are
    /// un-watched; new paths get a non-recursive watcher.
    pub fn update(&self, app_handle: &AppHandle, paths: Vec<String>) -> Result<(), String> {
        log::info!("[availability] updating watchers for {} root path(s)", paths.len());
        let mut watchers = self.watchers.lock().map_err(|e| e.to_string())?;

        // Stop watching paths that are no longer root folders.
        watchers.retain(|path, _watcher| paths.contains(path));

        for path in paths {
            if watchers.contains_key(&path) {
                continue;
            }

            let watched_path = path.clone();
            let app_handle = app_handle.clone();

            let mut watcher = RecommendedWatcher::new(
                move |res: Result<Event, notify::Error>| {
                    if let Ok(event) = res {
                        log::info!("[availability] watcher event for {}: {:?}", watched_path, event.kind);
                        // Filter out noisy events. We care about the root path
                        // itself being removed, renamed, or otherwise changed.
                        let root_path = Path::new(&watched_path);
                        let relevant = event.paths.iter().any(|p| p == root_path);
                        if !relevant {
                            return;
                        }

                        let path = watched_path.clone();
                        let app_handle = app_handle.clone();
                        tauri::async_runtime::spawn(async move {
                            let path_for_check = path.clone();
                            let exists = tauri::async_runtime::spawn_blocking(move || {
                                std::path::Path::new(&path_for_check).exists()
                            })
                            .await
                            .unwrap_or(false);

                            let status = if exists { "online" } else { "offline" };
                            let _ = app_handle.emit(
                                "folder-availability-changed",
                                json!({ "path": path, "status": status }),
                            );
                        });
                    }
                },
                Config::default(),
            )
            .map_err(|e| format!("Failed to create availability watcher: {e}"))?;

            watcher
                .watch(Path::new(&path), RecursiveMode::NonRecursive)
                .map_err(|e| format!("Failed to watch availability path {path}: {e}"))?;
            watchers.insert(path, watcher);
        }

        Ok(())
    }
}

impl Default for AvailabilityWatchers {
    fn default() -> Self {
        Self::new()
    }
}
