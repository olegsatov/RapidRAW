# Preset Hotkeys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-preset keyboard shortcuts that apply the preset to the current image, configurable from both the preset modal and Settings → Controls.

**Architecture:** Promote `usePresetStore` to the single source of truth for presets; keep `usePresets` as a thin React adapter so existing consumers do not change. Add a reusable `HotkeyCapture` component, wire preset hotkeys into `useKeyboardShortcuts`, and expose them in `ConfigurePresetModal` and `SettingsPanel`.

**Tech Stack:** React, TypeScript, Zustand, Tauri, Tailwind CSS, i18next.

---

## Files touched

| File | Responsibility |
| --- | --- |
| `src/hooks/usePresets.ts` | Thin adapter over `usePresetStore`; keeps existing hook API. |
| `src/hooks/useAppInitialization.ts` | Triggers `loadPresets()` at startup so presets are available globally. |
| `src/components/ui/HotkeyCapture.tsx` | Reusable combo capture + display with conflict warning. |
| `src/components/modals/ConfigurePresetModal.tsx` | Adds hotkey row and conflict resolution UI. |
| `src/components/presets/PresetsBrowser.tsx` | Renders hotkey badge on preset items. |
| `src/hooks/useKeyboardShortcuts.ts` | Builds `combo → preset` map and applies presets on shortcut. |
| `src/components/panel/SettingsPanel.tsx` | New "Preset Hotkeys" section in Controls tab. |
| `src/i18n/locales/en.json` | English strings. |
| `src/i18n/locales/ru.json` | Russian strings. |

---

## Task 1: Refactor `usePresets` into a store adapter

**Files:**
- Modify: `src/hooks/usePresets.ts`

- [ ] **Step 1: Replace local state and actions with `usePresetStore`**

Keep the same return shape so `PresetsBrowser`, `ExportPanel`, and other consumers do not change. Wrap `addPreset` and `overwritePreset` so they receive `currentAdjustments` from the hook argument.

```typescript
import { useEffect, useCallback } from 'react';
import { Adjustments, PasteMode } from '../utils/adjustments';
import { Preset } from '../components/ui/AppProperties';
import { usePresetStore, UserPreset } from '../store/usePresetStore';

export { PresetListType, UserPreset } from '../store/usePresetStore';

export function usePresets(currentAdjustments: Adjustments) {
  const store = usePresetStore();

  useEffect(() => {
    store.loadPresets();
  }, [store]);

  const addPreset = useCallback(
    (
      name: string,
      folderId: string | null = null,
      mode: PasteMode = PasteMode.Replace,
      includedAdjustments: string[] = [],
    ) => store.addPreset(currentAdjustments, name, folderId, mode, includedAdjustments),
    [store, currentAdjustments],
  );

  const overwritePreset = useCallback(
    (id: string | null) => store.overwritePreset(currentAdjustments, id),
    [store, currentAdjustments],
  );

  return {
    addFolder: store.addFolder,
    addPreset,
    configurePreset: store.configurePreset,
    deleteItem: store.deleteItem,
    duplicatePreset: store.duplicatePreset,
    exportPresetsToFile: store.exportPresetsToFile,
    importPresetsFromFile: store.importPresetsFromFile,
    importLegacyPresetsFromFile: store.importLegacyPresetsFromFile,
    isLoading: store.isLoading,
    movePreset: store.movePreset,
    overwritePreset,
    presets: store.presets,
    refreshPresets: store.loadPresets,
    renameItem: store.renameItem,
    reorderItems: store.reorderItems,
    sortAllPresetsAlphabetically: store.sortAllPresetsAlphabetically,
  };
}
```

- [ ] **Step 2: Remove unused imports and helper functions**

Delete the old local `arrayMove`, `normalizeUserPresetItem`, `savePresetsToBackend`, `loadPresets`, and all local CRUD implementations.

- [ ] **Step 3: Verify the hook compiles**

Run: `npx tsc --noEmit` is pre-existing red, so instead run:

```bash
npx tsc --noEmit src/hooks/usePresets.ts
```

Expected: no errors in this file.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/usePresets.ts
git commit -m "refactor: usePresets as adapter over usePresetStore"
```

---

## Task 2: Load presets during app initialization

**Files:**
- Modify: `src/hooks/useAppInitialization.ts`

- [ ] **Step 1: Import the preset store**

Add near the other store imports:

```typescript
import { usePresetStore } from '../store/usePresetStore';
```

- [ ] **Step 2: Trigger preset load after settings load**

Inside the `.then()` of `invoke(Invokes.LoadSettings)` (around line 155), after `setAppSettings(settings);`, add:

```typescript
usePresetStore.getState().loadPresets();
```

This ensures presets are available before the user opens the presets panel or presses a hotkey.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAppInitialization.ts
git commit -m "chore: load presets at app startup"
```

---

## Task 3: Create reusable `HotkeyCapture` component

**Files:**
- Create: `src/components/ui/HotkeyCapture.tsx`

- [ ] **Step 1: Write the component**

```typescript
import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { formatKeyCode, normalizeCombo } from '../../utils/keyboardUtils';
import Text from './Text';
import { TextColors, TextVariants, TextWeights } from '../../types/typography';

export interface HotkeyCaptureConflict {
  type: 'app' | 'preset';
  label: string;
}

interface HotkeyCaptureProps {
  combo: string[] | null | undefined;
  onChange: (combo: string[] | null) => void;
  osPlatform: string;
  conflict?: HotkeyCaptureConflict | null;
  onOverwrite?: () => void;
}

const RESERVED_COMBOS = new Set([
  'Escape',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Delete',
  'Backspace',
]);

export default function HotkeyCapture({
  combo,
  onChange,
  osPlatform,
  conflict,
  onOverwrite,
}: HotkeyCaptureProps) {
  const { t } = useTranslation();
  const [isRecording, setIsRecording] = useState(false);
  const [reservedError, setReservedError] = useState(false);

  const startRecording = useCallback(() => {
    setReservedError(false);
    setIsRecording(true);
  }, []);

  useEffect(() => {
    if (!isRecording) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onChange(null);
        setIsRecording(false);
        setReservedError(false);
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      const parts = normalizeCombo(e, osPlatform);
      const mainKey = parts[parts.length - 1];

      if (!mainKey || ['ctrl', 'shift', 'alt'].includes(mainKey)) return;

      if (parts.length === 1 && RESERVED_COMBOS.has(mainKey)) {
        setReservedError(true);
        setIsRecording(false);
        return;
      }

      onChange(parts);
      setIsRecording(false);
      setReservedError(false);
    };

    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [isRecording, onChange, osPlatform]);

  const displayCombo = combo && combo.length > 0 ? combo : null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <button
          onClick={startRecording}
          className="flex items-center gap-1 flex-wrap shrink-0"
          type="button"
        >
          {isRecording ? (
            <Text
              as="kbd"
              variant={TextVariants.small}
              color={TextColors.accent}
              weight={TextWeights.semibold}
              className="px-2 py-1 font-sans bg-bg-primary border border-accent rounded-md animate-pulse"
            >
              {t('settings.controls.pressKey')}
            </Text>
          ) : (
            <Text
              as="kbd"
              variant={TextVariants.small}
              color={TextColors.primary}
              weight={TextWeights.semibold}
              className="px-2 py-1 font-sans bg-bg-primary border border-border-color rounded-md cursor-pointer hover:border-accent transition-colors"
            >
              {displayCombo ? (
                displayCombo.map((k) => formatKeyCode(k, osPlatform)).join(' + ')
              ) : (
                <span className="text-text-secondary italic">{t('settings.controls.notAssigned')}</span>
              )}
            </Text>
          )}
        </button>

        {displayCombo && !isRecording && (
          <button
            onClick={() => onChange(null)}
            className="text-text-secondary hover:text-text-primary text-xs"
            type="button"
          >
            ✕
          </button>
        )}
      </div>

      {reservedError && (
        <Text variant={TextVariants.small} color={TextColors.error}>
          {t('modals.configurePreset.hotkeyReserved')}
        </Text>
      )}

      {conflict && !reservedError && (
        <div className="flex items-center gap-2">
          <Text variant={TextVariants.small} color={TextColors.warning}>
            {conflict.type === 'app'
              ? t('modals.configurePreset.hotkeyUsedByApp', { action: conflict.label })
              : t('modals.configurePreset.hotkeyUsedByPreset', { name: conflict.label })}
          </Text>
          {onOverwrite && (
            <button
              onClick={onOverwrite}
              className="text-xs text-accent hover:underline"
              type="button"
            >
              {t('modals.configurePreset.hotkeyOverwrite')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Check component compiles**

```bash
npx tsc --noEmit src/components/ui/HotkeyCapture.tsx
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/HotkeyCapture.tsx
git commit -m "feat: add HotkeyCapture component"
```

---

## Task 4: Add hotkey capture to `ConfigurePresetModal`

**Files:**
- Modify: `src/components/modals/ConfigurePresetModal.tsx`

- [ ] **Step 1: Update imports and props**

Add imports:

```typescript
import { useCallback, useEffect, useMemo, useState, KeyboardEvent } from 'react';
import HotkeyCapture from '../ui/HotkeyCapture';
import { KEYBIND_DEFINITIONS, normalizeCombo } from '../../utils/keyboardUtils';
import { usePresetStore } from '../../store/usePresetStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { AppSettings } from '../ui/AppProperties';
```

Change `onSave` signature:

```typescript
interface ConfigurePresetModalProps {
  isOpen: boolean;
  onClose(): void;
  onSave(name: string, mode: PasteMode, includedAdjustments: string[], hotkey: string[] | null): void;
  initialPreset?: Preset | null;
  osPlatform: string;
}
```

- [ ] **Step 2: Add hotkey state and conflict detection**

Inside the component:

```typescript
export default function ConfigurePresetModal({ isOpen, onClose, onSave, initialPreset, osPlatform }: ConfigurePresetModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [mode, setMode] = useState<PasteMode>(PasteMode.Replace);
  const [includedAdjustments, setIncludedAdjustments] = useState<string[]>(COPYABLE_ADJUSTMENT_KEYS);
  const [hotkey, setHotkey] = useState<string[] | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [show, setShow] = useState(false);

  const appSettings = useSettingsStore((s) => s.appSettings);
  const updatePreset = usePresetStore((s) => s.updatePreset);
  const allPresets = usePresetStore((s) => s.flattenPresets());

  useEffect(() => {
    if (isOpen) {
      setName(initialPreset?.name || '');
      setMode(initialPreset ? getPresetMode(initialPreset) : PasteMode.Replace);
      setIncludedAdjustments(
        initialPreset ? getPresetIncludedAdjustments(initialPreset) : [...COPYABLE_ADJUSTMENT_KEYS],
      );
      setHotkey(initialPreset?.hotkey ?? null);
      setIsMounted(true);
      const timer = setTimeout(() => setShow(true), 10);
      return () => clearTimeout(timer);
    } else {
      setShow(false);
      const timer = setTimeout(() => {
        setIsMounted(false);
        setName('');
        setMode(PasteMode.Replace);
        setIncludedAdjustments([...COPYABLE_ADJUSTMENT_KEYS]);
        setHotkey(null);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen, initialPreset]);

  const conflict = useMemo(() => {
    if (!hotkey || hotkey.length === 0) return null;
    const key = hotkey.join('+');
    const userKb = appSettings?.keybinds || {};
    for (const def of KEYBIND_DEFINITIONS) {
      const combo = userKb[def.action]?.length ? userKb[def.action] : def.defaultCombo;
      if (combo && combo.join('+') === key) {
        return { type: 'app' as const, label: t(def.description as any) as string };
      }
    }
    for (const preset of allPresets) {
      if (preset.id === initialPreset?.id) continue;
      if (preset.hotkey && preset.hotkey.join('+') === key) {
        return { type: 'preset' as const, label: preset.name };
      }
    }
    return null;
  }, [hotkey, appSettings?.keybinds, allPresets, initialPreset?.id, t]);
```

- [ ] **Step 3: Handle overwrite and save**

```typescript
  const handleOverwrite = useCallback(() => {
    if (!hotkey || hotkey.length === 0 || !conflict) return;

    if (conflict.type === 'app') {
      const newKeybinds = { ...(appSettings?.keybinds || {}) };
      for (const def of KEYBIND_DEFINITIONS) {
        const combo = newKeybinds[def.action]?.length ? newKeybinds[def.action] : def.defaultCombo;
        if (combo && combo.join('+') === hotkey.join('+')) {
          newKeybinds[def.action] = [];
          break;
        }
      }
      useSettingsStore.getState().handleSettingsChange({ ...appSettings, keybinds: newKeybinds } as AppSettings);
    } else {
      const key = hotkey.join('+');
      for (const preset of flattenPresets()) {
        if (preset.id !== initialPreset?.id && preset.hotkey?.join('+') === key) {
          updatePreset(preset.id, (p) => ({ ...p, hotkey: null }));
          break;
        }
      }
    }
  }, [hotkey, conflict, appSettings, flattenPresets, updatePreset, initialPreset?.id]);

  const handleSave = useCallback(() => {
    if (name.trim()) {
      onSave(name.trim(), mode, includedAdjustments, hotkey);
      onClose();
    }
  }, [name, mode, includedAdjustments, hotkey, onSave, onClose]);
```

- [ ] **Step 4: Render the hotkey row**

After `<AdjustmentKeyPicker />` inside the modal body:

```tsx
          <div>
            <Text variant={TextVariants.heading} className="block mb-2">
              {t('modals.configurePreset.hotkey')}
            </Text>
            <HotkeyCapture
              combo={hotkey}
              onChange={setHotkey}
              osPlatform={osPlatform}
              conflict={conflict}
              onOverwrite={handleOverwrite}
            />
          </div>
```

- [ ] **Step 5: Update `PresetsBrowser` save handler signature**

In `src/components/presets/PresetsBrowser.tsx`, change:

```typescript
  const handleSaveConfiguredPreset = async (
    name: string,
    mode: PasteMode,
    includedAdjustments: string[],
    hotkey: string[] | null,
  ) => {
    if (configureModalState.preset) {
      const updated = configurePreset(configureModalState.preset.id, name, mode, includedAdjustments);
      if (updated) {
        usePresetStore.getState().updatePreset(updated.id, (p) => ({ ...p, hotkey }));
        await generateSinglePreview(updated);
      }
    } else {
      const newPreset = addPreset(name, null, mode, includedAdjustments);
      if (newPreset) {
        usePresetStore.getState().updatePreset(newPreset.id, (p) => ({ ...p, hotkey }));
        await generateSinglePreview(newPreset);
      }
    }
    setConfigureModalState({ isOpen: false, preset: null });
  };
```

Also add `import { usePresetStore } from '../../store/usePresetStore';` to PresetsBrowser.

- [ ] **Step 6: Verify compile**

```bash
npx tsc --noEmit src/components/modals/ConfigurePresetModal.tsx src/components/presets/PresetsBrowser.tsx
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/modals/ConfigurePresetModal.tsx src/components/presets/PresetsBrowser.tsx
git commit -m "feat: configure preset hotkey with conflict UI"
```

---

## Task 5: Show hotkey badge in `PresetsBrowser`

**Files:**
- Modify: `src/components/presets/PresetsBrowser.tsx`

- [ ] **Step 1: Import `formatKeyCode`**

```typescript
import { formatKeyCode } from '../../utils/keyboardUtils';
```

- [ ] **Step 2: Render badge next to preset name**

In `PresetItemDisplay`, inside the `<div className="grow min-w-0 flex flex-col justify-center">` block:

```tsx
        <div className="grow min-w-0 flex flex-col justify-center">
          <div className="flex items-center gap-2">
            <Text color={TextColors.primary} weight={TextWeights.medium} className="truncate">
              {preset.name}
            </Text>
            {preset.hotkey && preset.hotkey.length > 0 && (
              <Text
                as="kbd"
                variant={TextVariants.small}
                color={TextColors.secondary}
                className="px-1.5 py-0.5 bg-bg-primary border border-border-color rounded text-[10px] shrink-0"
              >
                {preset.hotkey.map((k) => formatKeyCode(k, 'macos')).join('')}
              </Text>
            )}
          </div>
        </div>
```

Note: use `osPlatform` from `useOsPlatform()` hook if available in the component; otherwise pass it down. Since `PresetsBrowser` is a top-level component, import `useOsPlatform`:

```typescript
import { useOsPlatform } from '../../hooks/useOsPlatform';
```

and inside `PresetsBrowser`:

```typescript
const osPlatform = useOsPlatform();
```

Pass `osPlatform` through `DraggablePresetItem` → `PresetItemDisplay` and use it in `formatKeyCode`.

- [ ] **Step 3: Verify compile and format**

```bash
npx tsc --noEmit src/components/presets/PresetsBrowser.tsx
npx prettier --check src/components/presets/PresetsBrowser.tsx
```

Expected: no errors; Prettier clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/presets/PresetsBrowser.tsx
git commit -m "feat: show preset hotkey badge in browser"
```

---

## Task 6: Dispatch preset hotkeys in `useKeyboardShortcuts`

**Files:**
- Modify: `src/hooks/useKeyboardShortcuts.ts`

- [ ] **Step 1: Import preset helpers**

```typescript
import { usePresetStore } from '../store/usePresetStore';
import { getEffectivePresetAdjustments } from '../utils/presetUtils';
```

- [ ] **Step 2: Build preset combo map inside the keydown effect**

After the app `comboMap` is built (around line 48-57), add:

```typescript
    const presetComboMap = new Map<string, Preset>();
    const presets = usePresetStore.getState().flattenPresets();
    for (const preset of presets) {
      if (preset.hotkey && preset.hotkey.length > 0) {
        const key = preset.hotkey.join('+');
        presetComboMap.set(key, preset);
      }
    }
```

- [ ] **Step 3: Import `debouncedSetHistory` and `Preset` type**

Add at the top of `src/hooks/useKeyboardShortcuts.ts`:

```typescript
import { Preset } from '../components/ui/AppProperties';
import { debouncedSetHistory } from './useEditorActions';
```

- [ ] **Step 4: Apply preset when combo matches**

After the app action dispatch block (after `if (action) { ... return; }`), add:

```typescript
      const preset = presetComboMap.get(normalized.join('+'));
      if (preset && state.editor.selectedImage) {
        event.preventDefault();
        const effective = getEffectivePresetAdjustments(preset);
        const newAdjustments = { ...state.editor.adjustments, ...effective };
        state.editor.setEditor({ adjustments: newAdjustments });
        debouncedSetHistory(newAdjustments);
        return;
      }
```

- [ ] **Step 5: Verify compile**

```bash
npx tsc --noEmit src/hooks/useKeyboardShortcuts.ts
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useKeyboardShortcuts.ts
git commit -m "feat: dispatch preset hotkeys from keyboard shortcuts"
```

---

## Task 7: Add "Preset Hotkeys" section to `SettingsPanel`

**Files:**
- Modify: `src/components/panel/SettingsPanel.tsx`

- [ ] **Step 1: Add imports**

```typescript
import HotkeyCapture from '../ui/HotkeyCapture';
import { usePresetStore } from '../../store/usePresetStore';
import type { HotkeyCaptureConflict } from '../ui/HotkeyCapture';
```

- [ ] **Step 2: Add local state for preset recording**

Inside `SettingsPanel` component, near `recordingAction` state (around line 200):

```typescript
const [recordingPresetId, setRecordingPresetId] = useState<string | null>(null);
```

- [ ] **Step 3: Add preset hotkey save handler**

Add before the `return` JSX:

```typescript
  const presetStore = usePresetStore();

  const handlePresetHotkeySave = (presetId: string, combo: string[] | null) => {
    presetStore.updatePreset(presetId, (p) => ({ ...p, hotkey: combo }));
  };

  const getPresetHotkeyConflict = (presetId: string, combo: string[] | null): HotkeyCaptureConflict | null => {
    if (!combo || combo.length === 0) return null;
    const key = combo.join('+');
    const userKb = appSettings?.keybinds || {};
    for (const def of KEYBIND_DEFINITIONS) {
      const effective = userKb[def.action]?.length ? userKb[def.action] : def.defaultCombo;
      if (effective && effective.join('+') === key) {
        return { type: 'app', label: t(def.description as any) as string };
      }
    }
    for (const preset of presetStore.flattenPresets()) {
      if (preset.id === presetId) continue;
      if (preset.hotkey && preset.hotkey.join('+') === key) {
        return { type: 'preset', label: preset.name };
      }
    }
    return null;
  };

  const handlePresetHotkeyOverwrite = (presetId: string, combo: string[] | null) => {
    if (!combo || combo.length === 0) return;
    const key = combo.join('+');
    const conflict = getPresetHotkeyConflict(presetId, combo);
    if (!conflict) return;

    if (conflict.type === 'app') {
      const newKeybinds = { ...(appSettings?.keybinds || {}) };
      for (const def of KEYBIND_DEFINITIONS) {
        const effective = newKeybinds[def.action]?.length ? newKeybinds[def.action] : def.defaultCombo;
        if (effective && effective.join('+') === key) {
          newKeybinds[def.action] = [];
          break;
        }
      }
      onSettingsChange({ ...appSettings, keybinds: newKeybinds });
    } else {
      for (const preset of presetStore.flattenPresets()) {
        if (preset.id !== presetId && preset.hotkey?.join('+') === key) {
          presetStore.updatePreset(preset.id, (p) => ({ ...p, hotkey: null }));
          break;
        }
      }
    }
  };
```

- [ ] **Step 4: Render section after keyboard controls**

After the `KEYBIND_SECTIONS` loop and before the "Reset Defaults" button (around line 2418), add:

```tsx
                    <div>
                      <Text variant={TextVariants.heading} className="mb-4">
                        {t('settings.controls.presetHotkeys')}
                      </Text>
                      <div className="divide-y divide-border-color">
                        {presetStore
                          .flattenPresets()
                          .slice()
                          .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
                          .map((preset) => {
                            const conflict = getPresetHotkeyConflict(preset.id, preset.hotkey ?? null);
                            return (
                              <div key={preset.id} className="flex justify-between items-center py-2">
                                <div className="flex flex-col min-w-0 mr-4">
                                  <Text variant={TextVariants.label} className="truncate">
                                    {preset.name}
                                  </Text>
                                  {preset.folder?.name && (
                                    <Text variant={TextVariants.small} color={TextColors.secondary}>
                                      {preset.folder.name}
                                    </Text>
                                  )}
                                </div>
                                <HotkeyCapture
                                  combo={preset.hotkey}
                                  onChange={(combo) => handlePresetHotkeySave(preset.id, combo)}
                                  osPlatform={osPlatform}
                                  conflict={conflict}
                                  onOverwrite={() => handlePresetHotkeyOverwrite(preset.id, preset.hotkey ?? null)}
                                />
                              </div>
                            );
                          })}
                      </div>
                    </div>
```

- [ ] **Step 5: Verify compile and format**

```bash
npx tsc --noEmit src/components/panel/SettingsPanel.tsx
npx prettier --check src/components/panel/SettingsPanel.tsx
```

Expected: no errors; Prettier clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/panel/SettingsPanel.tsx
git commit -m "feat: preset hotkeys section in settings panel"
```

---

## Task 8: Add i18n strings

**Files:**
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/ru.json`

- [ ] **Step 1: Add English strings**

Under `modals.configurePreset` (around line 1182):

```json
    "configurePreset": {
      "cancel": "Cancel",
      "hotkey": "Hotkey",
      "hotkeyOverwrite": "Overwrite",
      "hotkeyReserved": "This combination is reserved by the application.",
      "hotkeyUsedByApp": "Used by: {{action}}",
      "hotkeyUsedByPreset": "Used by preset: {{name}}",
      "pasteMode": "Apply Mode",
      "placeholder": "Enter preset name...",
      "save": "Save",
      "titleConfigure": "Configure Preset",
      "titleSave": "Save New Preset"
    },
```

Under `settings.controls` (around line 1473):

```json
    "controls": {
      "keyboardTitle": "Keyboard Controls",
      "modes": {
        "mouse": "Mouse",
        "trackpad": "Touchpad"
      },
      "notAssigned": "Not assigned",
      "optimization": "Input Device Optimization",
      "optimizationDesc": "Choose the primary input device you use to pan and zoom the canvas.",
      "presetHotkeys": "Preset Hotkeys",
      "pressKey": "Press a key... (Esc to clear)",
      "resetDefaults": "Reset All to Defaults",
      "speed": "Speed",
      "title": "Mouse Controls",
      "zoom": "Zoom Speed Multiplier",
      "zoomDesc": "Adjust how fast the canvas zooms in and out when using the scroll wheel or pinch gesture."
    },
```

- [ ] **Step 2: Add Russian strings**

Under `modals.configurePreset` (around line 1181):

```json
    "configurePreset": {
      "cancel": "Отмена",
      "hotkey": "Горячая клавиша",
      "hotkeyOverwrite": "Перезаписать",
      "hotkeyReserved": "Эта комбинация зарезервирована приложением.",
      "hotkeyUsedByApp": "Используется: {{action}}",
      "hotkeyUsedByPreset": "Используется пресетом: {{name}}",
      "pasteMode": "Режим применения",
      "placeholder": "Введите название пресета...",
      "save": "Сохранить",
      "titleConfigure": "Настройка пресета",
      "titleSave": "Сохранить новый пресет"
    },
```

Under `settings.controls` (around line 1472):

```json
    "controls": {
      "keyboardTitle": "Управление клавиатурой",
      "modes": {
        "mouse": "Мышь",
        "trackpad": "Тачпад"
      },
      "notAssigned": "Не назначено",
      "optimization": "Оптимизация устройств ввода",
      "optimizationDesc": "Выберите основное устройство ввода для перемещения и масштабирования холста.",
      "presetHotkeys": "Горячие клавиши пресетов",
      "pressKey": "Нажмите клавишу... (Esc для очистки)",
      "resetDefaults": "Сбросить настройки управления",
      "speed": "Скорость",
      "title": "Управление мышью",
      "zoom": "Чувствительность масштабирования",
      "zoomDesc": "Настройте скорость масштабирования холста при использовании колеса мыши или жестов тачпада."
    },
```

- [ ] **Step 3: Verify JSON validity**

```bash
node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/en.json')); console.log('en ok')"
node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/ru.json')); console.log('ru ok')"
```

Expected: both print "ok".

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/en.json src/i18n/locales/ru.json
git commit -m "feat: i18n strings for preset hotkeys"
```

---

## Task 9: Verification

- [ ] **Step 1: Frontend build**

```bash
npm run build
```

Expected: completes without new TypeScript errors. (Pre-existing red baseline is acceptable only if unchanged.)

- [ ] **Step 2: Rust check**

```bash
cd src-tauri && cargo check
```

Expected: `Finished dev [unoptimized + debuginfo] target(s) in ...` with no errors.

- [ ] **Step 3: Prettier check**

```bash
npx prettier --check src/hooks/usePresets.ts src/hooks/useAppInitialization.ts src/components/ui/HotkeyCapture.tsx src/components/modals/ConfigurePresetModal.tsx src/components/presets/PresetsBrowser.tsx src/hooks/useKeyboardShortcuts.ts src/components/panel/SettingsPanel.tsx src/i18n/locales/en.json src/i18n/locales/ru.json
```

Expected: `All matched files use Prettier code style!`

- [ ] **Step 4: Manual smoke test**

Run the app, open an image, and:
1. Open a preset's Configure modal.
2. Assign `Ctrl+Shift+1`.
3. Press `Ctrl+Shift+1` in the editor — the preset should apply.
4. Open Settings → Controls → Preset Hotkeys and confirm the combo is listed.
5. Assign the same combo to a second preset and click Overwrite; the first preset should lose its hotkey.

- [ ] **Step 5: Commit if all checks pass**

```bash
git commit -m "verify: preset hotkeys build and checks pass" --allow-empty
```

---

## Plan self-review

- **Spec coverage:**
  - Global store as source of truth → Task 1, 2.
  - Hotkey capture component → Task 3.
  - ConfigurePresetModal hotkey row → Task 4.
  - Preset badge in browser → Task 5.
  - Keyboard dispatch → Task 6.
  - SettingsPanel section → Task 7.
  - i18n → Task 8.
  - Verification → Task 9.
- **Placeholder scan:** No TBD/TODO/fill-in-details found.
- **Type consistency:** `Preset.hotkey` is `string[] | null` in AppProperties, store, modal, and keyboard handler. `HotkeyCaptureConflict` type is reused.
