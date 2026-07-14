# Preset Adjustment Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the coarse `style`/`tool` preset mode with the same per-adjustment selection + merge/replace mode used by copy/paste, so users decide exactly what a preset stores and applies.

**Architecture:** Add `mode` (`PasteMode.Replace`/`Merge`) and `includedAdjustments: string[]` to the `Preset` type (Rust + TypeScript). A new `presetUtils.ts` normalises legacy `presetType`/`includeMasks`/`includeCropTransform` presets on load and provides helpers to filter a preset's stored adjustments at apply-time. `ConfigurePresetModal` is rewritten to reuse the same mode switch and group grid UI as `CopyPasteSettingsModal`. `usePresets.ts` and `PresetsBrowser.tsx` stop using `style`/`tool` and use `mode`/`includedAdjustments` instead.

**Tech Stack:** React + TypeScript, Tailwind, Framer Motion, Tauri/Rust, i18next.

---

## Task 1: Extend Rust `Preset` type

**Files:**

- Modify: `src-tauri/src/file_management.rs:192-206`

- [ ] **Step 1: Add `mode` and `includedAdjustments` fields**

```rust
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub adjustments: Value,
    #[serde(rename = "includeMasks", skip_serializing_if = "Option::is_none")]
    pub include_masks: Option<bool>,
    #[serde(
        rename = "includeCropTransform",
        skip_serializing_if = "Option::is_none"
    )]
    pub include_crop_transform: Option<bool>,
    #[serde(rename = "presetType", skip_serializing_if = "Option::is_none")]
    pub preset_type: Option<String>,
    #[serde(rename = "mode", skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(rename = "includedAdjustments", skip_serializing_if = "Option::is_none")]
    pub included_adjustments: Option<Vec<String>>,
}
```

- [ ] **Step 2: Verify Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: no new errors.

---

## Task 2: Extend TypeScript `Preset` type

**Files:**

- Modify: `src/components/ui/AppProperties.tsx:1-4` and `:295-303`

- [ ] **Step 1: Import `PasteMode`**

Change the existing import from:

```ts
import { Adjustments, CopyPasteSettings } from '../../utils/adjustments';
```

to:

```ts
import { Adjustments, CopyPasteSettings, PasteMode } from '../../utils/adjustments';
```

- [ ] **Step 2: Add new optional fields to the `Preset` interface**

Replace:

```ts
export interface Preset {
  adjustments: Partial<Adjustments>;
  folder?: Folder;
  id: string;
  name: string;
  includeMasks?: boolean;
  includeCropTransform?: boolean;
  presetType?: 'tool' | 'style';
}
```

with:

```ts
export interface Preset {
  adjustments: Partial<Adjustments>;
  folder?: Folder;
  id: string;
  name: string;
  includeMasks?: boolean;
  includeCropTransform?: boolean;
  presetType?: 'tool' | 'style';
  mode?: PasteMode;
  includedAdjustments?: string[];
}
```

---

## Task 3: Create preset normalisation / apply helpers

**Files:**

- Create: `src/utils/presetUtils.ts`

- [ ] **Step 1: Write the helper module**

```ts
import { Preset } from '../components/ui/AppProperties';
import {
  ADJUSTMENT_GROUPS,
  Adjustments,
  COPYABLE_ADJUSTMENT_KEYS,
  INITIAL_ADJUSTMENTS,
  LensAdjustment,
  PasteMode,
} from './adjustments';

const MASK_KEYS = ADJUSTMENT_GROUPS.masks.flatMap((group) => group.keys);
const GEOMETRY_KEYS = ADJUSTMENT_GROUPS.geometry.flatMap((group) => group.keys);

export function getPresetMode(preset: Preset): PasteMode {
  if (preset.mode) {
    return preset.mode;
  }
  return preset.presetType === 'tool' ? PasteMode.Merge : PasteMode.Replace;
}

export function getPresetIncludedAdjustments(preset: Preset): string[] {
  if (preset.includedAdjustments) {
    return [...preset.includedAdjustments];
  }

  let keys = [...COPYABLE_ADJUSTMENT_KEYS];

  const hasMasks = preset.includeMasks ?? (preset.adjustments?.masks && preset.adjustments.masks.length > 0) ?? false;
  const hasGeometry =
    preset.includeCropTransform ?? GEOMETRY_KEYS.some((key) => preset.adjustments?.[key] !== undefined) ?? false;

  if (!hasMasks) {
    keys = keys.filter((key) => !MASK_KEYS.includes(key));
  }
  if (!hasGeometry) {
    keys = keys.filter((key) => !GEOMETRY_KEYS.includes(key));
  }

  return keys;
}

export function normalizePreset(preset: Preset): Preset {
  const { presetType, includeMasks, includeCropTransform, ...rest } = preset as any;
  return {
    ...rest,
    mode: getPresetMode(preset),
    includedAdjustments: getPresetIncludedAdjustments(preset),
  };
}

export function getEffectivePresetAdjustments(preset: Preset): Partial<Adjustments> {
  const mode = getPresetMode(preset);
  const included = new Set(getPresetIncludedAdjustments(preset));
  const result: Partial<Adjustments> = {};

  for (const key of included) {
    if (Object.prototype.hasOwnProperty.call(preset.adjustments, key)) {
      const value = preset.adjustments[key];
      if (mode === PasteMode.Merge) {
        const defaultValue = INITIAL_ADJUSTMENTS[key as keyof Adjustments];
        if (JSON.stringify(value) !== JSON.stringify(defaultValue)) {
          (result as any)[key] = value;
        }
      } else {
        (result as any)[key] = value;
      }
    }
  }

  if (included.has(LensAdjustment.LensMaker) && !result.lensMaker) {
    result.lensDistortionParams = null;
  }

  return result;
}
```

---

## Task 4: Refactor `usePresets.ts` to use mode + included adjustments

**Files:**

- Modify: `src/hooks/usePresets.ts`

- [ ] **Step 1: Update imports**

Add at the top:

```ts
import { normalizePreset, getPresetMode, getPresetIncludedAdjustments } from '../utils/presetUtils';
import { PasteMode } from '../utils/adjustments';
```

- [ ] **Step 2: Normalise presets after load and import**

Replace the body of `loadPresets`:

```ts
const loadPresets = useCallback(async () => {
  setIsLoading(true);
  try {
    const loadedPresets: Array<UserPreset> = await invoke(Invokes.LoadPresets);
    const normalized = loadedPresets.map((item) => (item.preset ? { preset: normalizePreset(item.preset) } : item));
    const changed = JSON.stringify(normalized) !== JSON.stringify(loadedPresets);
    setPresets(normalized);
    if (changed) {
      savePresetsToBackend(normalized);
    }
  } catch (error) {
    console.error('Failed to load presets:', error);
    setPresets([]);
  } finally {
    setIsLoading(false);
  }
}, [savePresetsToBackend]);
```

Update `importPresetsFromFile` and `importLegacyPresetsFromFile` to normalise before setting state:

```ts
const updatedPresetList: Array<any> = await invoke(Invokes.HandleImportPresetsFromFile, { filePath });
const normalized = updatedPresetList.map((item) => (item.preset ? { preset: normalizePreset(item.preset) } : item));
setPresets(normalized);
```

Do the same for `importLegacyPresetsFromFile`.

- [ ] **Step 3: Rewrite `addPreset`**

Replace the function with:

```ts
const addPreset = (
  name: string,
  folderId: string | null = null,
  mode: PasteMode = PasteMode.Replace,
  includedAdjustments: string[] = COPYABLE_ADJUSTMENT_KEYS,
) => {
  const presetAdjustments: Record<string, any> = {};

  for (const key of includedAdjustments) {
    if (Object.prototype.hasOwnProperty.call(currentAdjustments, key)) {
      const currentValue = currentAdjustments[key as keyof Adjustments];
      if (mode === PasteMode.Merge) {
        const defaultValue = INITIAL_ADJUSTMENTS[key as keyof Adjustments];
        if (JSON.stringify(currentValue) !== JSON.stringify(defaultValue)) {
          presetAdjustments[key] = currentValue;
        }
      } else {
        presetAdjustments[key] = currentValue;
      }
    }
  }

  const newPresetData: Preset = {
    adjustments: presetAdjustments,
    id: crypto.randomUUID(),
    name,
    mode,
    includedAdjustments,
  };

  let updatedPresets: Array<UserPreset>;
  if (folderId) {
    updatedPresets = presets.map((item: UserPreset) => {
      if (item.folder && item.folder.id === folderId) {
        return {
          folder: {
            ...item.folder,
            children: [...item.folder.children, newPresetData],
          },
        };
      }
      return item;
    });
  } else {
    updatedPresets = [...presets, { preset: newPresetData }];
  }

  setPresets(updatedPresets);
  savePresetsToBackend(updatedPresets);
  return newPresetData;
};
```

- [ ] **Step 4: Rewrite `configurePreset`**

Replace the function with:

```ts
const configurePreset = (id: string | null, name: string, mode: PasteMode, includedAdjustments: string[]) => {
  let updatedPreset: Preset | null = null;

  const updatedPresets = presets.map((item: UserPreset) => {
    if (item.preset?.id === id) {
      updatedPreset = {
        ...normalizePreset(item.preset),
        name,
        mode,
        includedAdjustments,
      };
      return { preset: updatedPreset };
    }
    if (item.folder) {
      let found = false;
      const newChildren = item.folder.children.map((child: Preset) => {
        if (child.id === id) {
          found = true;
          updatedPreset = {
            ...normalizePreset(child),
            name,
            mode,
            includedAdjustments,
          };
          return updatedPreset;
        }
        return child;
      });
      if (found) {
        return { folder: { ...item.folder, children: newChildren } };
      }
    }
    return item;
  });

  setPresets(updatedPresets);
  savePresetsToBackend(updatedPresets);
  return updatedPreset;
};
```

- [ ] **Step 5: Rewrite `overwritePreset`**

Replace the function with:

```ts
const overwritePreset = (id: string | null) => {
  let existingPreset: Preset | null = null;

  for (const item of presets) {
    if (item.preset?.id === id) {
      existingPreset = item.preset;
      break;
    }
    if (item.folder) {
      const found = item.folder.children.find((p: Preset) => p.id === id);
      if (found) {
        existingPreset = found;
        break;
      }
    }
  }

  if (!existingPreset) return null;

  const mode = getPresetMode(existingPreset);
  const includedAdjustments = getPresetIncludedAdjustments(existingPreset);

  const presetAdjustments: Record<string, any> = {};

  for (const key of includedAdjustments) {
    if (Object.prototype.hasOwnProperty.call(currentAdjustments, key)) {
      const currentValue = currentAdjustments[key as keyof Adjustments];
      if (mode === PasteMode.Merge) {
        const defaultValue = INITIAL_ADJUSTMENTS[key as keyof Adjustments];
        if (JSON.stringify(currentValue) !== JSON.stringify(defaultValue)) {
          presetAdjustments[key] = currentValue;
        }
      } else {
        presetAdjustments[key] = currentValue;
      }
    }
  }

  let updatedPreset: Preset | null = null;
  const updatedPresets = presets.map((item: UserPreset) => {
    if (item.preset?.id === id) {
      updatedPreset = {
        ...normalizePreset(item.preset),
        adjustments: presetAdjustments,
      };
      return { preset: updatedPreset };
    }
    if (item.folder) {
      let found = false;
      const newChildren = item.folder.children.map((child: Preset) => {
        if (child.id === id) {
          found = true;
          updatedPreset = {
            ...normalizePreset(child),
            adjustments: presetAdjustments,
          };
          return updatedPreset;
        }
        return child;
      });
      if (found) {
        return { folder: { ...item.folder, children: newChildren } };
      }
    }
    return item;
  });

  setPresets(updatedPresets);
  savePresetsToBackend(updatedPresets);
  return updatedPreset;
};
```

- [ ] **Step 6: Update `duplicatePreset`**

In the new preset object, copy `mode` and `includedAdjustments`:

```ts
const newPreset: Preset = {
  adjustments: JSON.parse(JSON.stringify(presetToDuplicate.adjustments)),
  id: crypto.randomUUID(),
  name: `${presetToDuplicate.name} Copy`,
  mode: getPresetMode(presetToDuplicate),
  includedAdjustments: getPresetIncludedAdjustments(presetToDuplicate),
};
```

---

## Task 5: Create reusable `PasteModeSwitch` component

**Files:**

- Create: `src/components/ui/PasteModeSwitch.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState, useEffect, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { PasteMode } from '../../utils/adjustments';

interface PasteModeSwitchProps {
  selectedMode: PasteMode;
  onModeChange: (mode: PasteMode) => void;
  isVisible?: boolean;
}

export default function PasteModeSwitch({ selectedMode, onModeChange, isVisible = true }: PasteModeSwitchProps) {
  const { t } = useTranslation();
  const [buttonRefs, setButtonRefs] = useState<Map<string, HTMLButtonElement>>(new Map());
  const [bubbleStyle, setBubbleStyle] = useState({});
  const containerRef = useRef<HTMLDivElement>(null);
  const isInitialAnimation = useRef(true);

  const pasteModeOptions = useMemo(
    () => [
      { id: PasteMode.Merge, label: t('modals.copyPaste.modeMerge') },
      { id: PasteMode.Replace, label: t('modals.copyPaste.modeReplace') },
    ],
    [t],
  );

  useEffect(() => {
    const selectedButton = buttonRefs.get(selectedMode);

    if (!isVisible || !selectedButton || !containerRef.current) {
      return;
    }

    const targetStyle = {
      x: selectedButton.offsetLeft,
      width: selectedButton.offsetWidth,
    };

    if (isInitialAnimation.current && containerRef.current.offsetWidth > 0) {
      const initialX = selectedMode === PasteMode.Replace ? containerRef.current.offsetWidth : -targetStyle.width;
      setBubbleStyle({
        x: [initialX, targetStyle.x],
        width: targetStyle.width,
      });
      isInitialAnimation.current = false;
    } else {
      setBubbleStyle(targetStyle);
    }
  }, [selectedMode, buttonRefs, isVisible]);

  useEffect(() => {
    if (!isVisible) {
      isInitialAnimation.current = true;
    }
  }, [isVisible]);

  return (
    <div ref={containerRef} className="relative flex w-full gap-1 bg-bg-primary p-1 rounded-md">
      <motion.div
        className="absolute top-1 bottom-1 z-0 bg-accent shadow-xs"
        style={{ borderRadius: 6 }}
        animate={bubbleStyle}
        transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
      />
      {pasteModeOptions.map((option) => (
        <button
          key={option.id}
          ref={(el) => {
            if (el) {
              setButtonRefs((prev) => {
                if (prev.get(option.id) === el) return prev;
                const next = new Map(prev);
                next.set(option.id, el);
                return next;
              });
            }
          }}
          onClick={() => onModeChange(option.id)}
          className={clsx(
            'relative flex-1 flex items-center justify-center gap-2 py-1.5 text-sm rounded-md transition-colors',
            {
              'text-text-primary hover:bg-surface': selectedMode !== option.id,
              'text-button-text': selectedMode === option.id,
            },
          )}
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          <span className="relative z-10 flex items-center">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
```

---

## Task 6: Create reusable `AdjustmentKeyPicker` component

**Files:**

- Create: `src/components/ui/AdjustmentKeyPicker.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useTranslation } from 'react-i18next';
import { ADJUSTMENT_GROUPS, COPYABLE_ADJUSTMENT_KEYS } from '../../utils/adjustments';
import Button from './Button';
import Switch from './Switch';
import Text from './Text';
import { TextVariants } from '../../types/typography';

interface AdjustmentKeyPickerProps {
  includedAdjustments: string[];
  onChange: (includedAdjustments: string[]) => void;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function AdjustmentKeyPicker({ includedAdjustments, onChange }: AdjustmentKeyPickerProps) {
  const { t } = useTranslation();

  const handleSelectAll = () => {
    onChange([...COPYABLE_ADJUSTMENT_KEYS]);
  };

  const handleSelectNone = () => {
    onChange([]);
  };

  const handleGroupToggle = (keys: string[], checked: boolean) => {
    const newSet = new Set(includedAdjustments);
    keys.forEach((key) => {
      if (checked) newSet.add(key);
      else newSet.delete(key);
    });
    onChange(Array.from(newSet));
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <Text variant={TextVariants.heading}>{t('modals.copyPaste.includedAdjustments')}</Text>
        <div className="flex gap-2">
          <Button
            className="px-4 py-2 rounded-md text-text-secondary hover:bg-surface transition-colors"
            size="sm"
            onClick={handleSelectAll}
          >
            {t('modals.copyPaste.selectAll')}
          </Button>
          <Button
            className="px-4 py-2 rounded-md text-text-secondary hover:bg-surface transition-colors"
            size="sm"
            onClick={handleSelectNone}
          >
            {t('modals.copyPaste.selectNone')}
          </Button>
        </div>
      </div>
      <div className="bg-bg-primary p-4 rounded-md max-h-64 overflow-y-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-6">
          {Object.entries(ADJUSTMENT_GROUPS).map(([section, groups]) => (
            <div key={section}>
              <Text variant={TextVariants.heading} className="mb-2">
                {t(`editor.adjustments.sections.${section}`, { defaultValue: capitalize(section) })}
              </Text>
              {groups.map((group) => {
                const isFullyChecked = group.keys.every((key) => includedAdjustments.includes(key));
                return (
                  <div key={group.label} className="mb-1.5 last:mb-0">
                    <Switch
                      label={t(group.label)}
                      checked={isFullyChecked}
                      onChange={(checked) => handleGroupToggle(group.keys, checked)}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

---

## Task 7: Rewrite `ConfigurePresetModal.tsx`

**Files:**

- Modify: `src/components/modals/ConfigurePresetModal.tsx`

- [ ] **Step 1: Replace file content**

```tsx
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import Text from '../ui/Text';
import { TextVariants } from '../../types/typography';
import { Preset } from '../ui/AppProperties';
import { COPYABLE_ADJUSTMENT_KEYS, PasteMode } from '../../utils/adjustments';
import { getPresetMode, getPresetIncludedAdjustments } from '../../utils/presetUtils';
import PasteModeSwitch from '../ui/PasteModeSwitch';
import AdjustmentKeyPicker from '../ui/AdjustmentKeyPicker';

interface ConfigurePresetModalProps {
  isOpen: boolean;
  onClose(): void;
  onSave(name: string, mode: PasteMode, includedAdjustments: string[]): void;
  initialPreset?: Preset | null;
}

export default function ConfigurePresetModal({ isOpen, onClose, onSave, initialPreset }: ConfigurePresetModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [mode, setMode] = useState<PasteMode>(PasteMode.Replace);
  const [includedAdjustments, setIncludedAdjustments] = useState<string[]>(COPYABLE_ADJUSTMENT_KEYS);
  const [isMounted, setIsMounted] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName(initialPreset?.name || '');
      setMode(getPresetMode(initialPreset || ({} as Preset)));
      setIncludedAdjustments(getPresetIncludedAdjustments(initialPreset || ({} as Preset)));
      setIsMounted(true);
      const timer = setTimeout(() => setShow(true), 10);
      return () => clearTimeout(timer);
    } else {
      setShow(false);
      const timer = setTimeout(() => {
        setIsMounted(false);
        setName('');
        setMode(PasteMode.Replace);
        setIncludedAdjustments(COPYABLE_ADJUSTMENT_KEYS);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen, initialPreset]);

  const handleSave = useCallback(() => {
    if (name.trim()) {
      onSave(name.trim(), mode, includedAdjustments);
      onClose();
    }
  }, [name, mode, includedAdjustments, onSave, onClose]);

  const handleKeyDown = useCallback(
    (e: any) => {
      if (e.key === 'Enter') {
        handleSave();
      } else if (e.key === 'Escape') {
        onClose();
      }
    },
    [handleSave, onClose],
  );

  if (!isMounted) {
    return null;
  }

  return (
    <div
      className={`
        fixed inset-0 flex items-center justify-center z-50
        bg-black/30 backdrop-blur-xs
        transition-opacity duration-300 ease-in-out
        ${show ? 'opacity-100' : 'opacity-0'}
      `}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`
          bg-surface rounded-lg shadow-xl p-6 w-full max-w-2xl flex flex-col
          transform transition-all duration-300 ease-out
          ${show ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 -translate-y-4'}
        `}
        onClick={(e: any) => e.stopPropagation()}
      >
        <Text variant={TextVariants.title} className="mb-4">
          {initialPreset ? t('modals.configurePreset.titleConfigure') : t('modals.configurePreset.titleSave')}
        </Text>
        <input
          autoFocus
          className="w-full bg-bg-primary text-text-primary border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          onChange={(e: any) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('modals.configurePreset.placeholder')}
          type="text"
          value={name}
        />

        <div className="grow overflow-y-auto pr-2 -mr-2 space-y-6 mt-5">
          <div>
            <Text variant={TextVariants.heading} className="block mb-2">
              {t('modals.configurePreset.pasteMode')}
            </Text>
            <PasteModeSwitch selectedMode={mode} onModeChange={setMode} isVisible={show} />
            <Text variant={TextVariants.small} className="mt-2">
              <b>{t('modals.copyPaste.modeMerge')}:</b> {t('modals.copyPaste.descMerge')}
              <br />
              <b>{t('modals.copyPaste.modeReplace')}:</b> {t('modals.copyPaste.descReplace')}
            </Text>
          </div>

          <AdjustmentKeyPicker includedAdjustments={includedAdjustments} onChange={setIncludedAdjustments} />
        </div>

        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-surface">
          <button
            className="px-4 py-2 rounded-md text-text-secondary hover:bg-surface transition-colors"
            onClick={onClose}
          >
            {t('modals.configurePreset.cancel')}
          </button>
          <button
            className="px-4 py-2 rounded-md bg-accent text-button-text font-semibold hover:bg-accent-hover disabled:bg-gray-500 disabled:text-white disabled:cursor-not-allowed transition-colors"
            disabled={!name.trim()}
            onClick={handleSave}
          >
            {t('modals.configurePreset.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

## Task 8: Refactor `CopyPasteSettingsModal.tsx` to reuse new components

**Files:**

- Modify: `src/components/modals/CopyPasteSettingsModal.tsx`

- [ ] **Step 1: Replace imports and remove inline switch/picker code**

Remove the inline `PasteModeSwitch` component and the group grid code. Replace the import block with:

```ts
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ADJUSTMENT_GROUPS, COPYABLE_ADJUSTMENT_KEYS, CopyPasteSettings, PasteMode } from '../../utils/adjustments';
import Button from '../ui/Button';
import Switch from '../ui/Switch';
import Text from '../ui/Text';
import { TextVariants } from '../../types/typography';
import PasteModeSwitch from '../ui/PasteModeSwitch';
import AdjustmentKeyPicker from '../ui/AdjustmentKeyPicker';
```

- [ ] **Step 2: Simplify the modal body**

Replace the modal content inside the `return` with:

```tsx
return (
  <div
    className={`fixed inset-0 flex items-center justify-center z-50 bg-black/30 backdrop-blur-xs transition-opacity duration-300 ease-in-out ${
      show ? 'opacity-100' : 'opacity-0'
    }`}
    onClick={onClose}
    role="dialog"
  >
    <div
      className={`bg-surface rounded-lg shadow-xl p-6 w-full max-w-2xl flex flex-col transform transition-all duration-300 ease-out ${
        show ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 -translate-y-4'
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      <Text variant={TextVariants.title} className="mb-4">
        {t('modals.copyPaste.title')}
      </Text>
      <div className="grow overflow-y-auto pr-2 -mr-2 space-y-6">
        <div>
          <Text variant={TextVariants.heading} className="block mb-2">
            {t('modals.copyPaste.pasteMode')}
          </Text>
          <PasteModeSwitch
            selectedMode={localSettings.mode}
            onModeChange={(mode) => setLocalSettings((p) => ({ ...p, mode }))}
            isVisible={show}
          />
          <Text variant={TextVariants.small} className="mt-2">
            <b>{t('modals.copyPaste.modeMerge')}:</b> {t('modals.copyPaste.descMerge')}
            <br />
            <b>{t('modals.copyPaste.modeReplace')}:</b> {t('modals.copyPaste.descReplace')}
          </Text>
        </div>

        <AdjustmentKeyPicker
          includedAdjustments={localSettings.includedAdjustments}
          onChange={(includedAdjustments) => setLocalSettings((p) => ({ ...p, includedAdjustments }))}
        />
      </div>

      <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-surface">
        <Button
          className="px-4 py-2 rounded-md text-text-secondary bg-surface hover:bg-surface transition-colors"
          onClick={onClose}
        >
          {t('modals.copyPaste.cancel')}
        </Button>
        <Button onClick={handleSave}>{t('modals.copyPaste.save')}</Button>
      </div>
    </div>
  </div>
);
```

Keep the existing `DEFAULT_SETTINGS`, `handleSave`, `handleKeyDown`, `isMounted/show` logic unchanged.

---

## Task 9: Update `PresetsBrowser.tsx`

**Files:**

- Modify: `src/components/presets/PresetsBrowser.tsx`

- [ ] **Step 1: Import helpers**

Add to the imports from `../../utils/adjustments`:

```ts
import { getEffectivePresetAdjustments, getPresetIncludedAdjustments } from '../../utils/presetUtils';
import { PasteMode } from '../../utils/adjustments';
```

- [ ] **Step 2: Update `PresetItemDisplay`**

Replace the badge derivation block:

```ts
const geometryKeys = ADJUSTMENT_GROUPS.geometry.flatMap((g) => g.keys);
const includedAdjustments = getPresetIncludedAdjustments(preset);
const supportsMasks = includedAdjustments.includes('masks');
const supportsGeometry = geometryKeys.some((key) => includedAdjustments.includes(key));
```

Remove the `isTool` variable and the entire `<div className="flex items-center gap-1.5 mt-0.5">...</div>` block that shows the wrench/palette icon.

- [ ] **Step 3: Update apply handlers**

Replace `handleApplyPreset` with:

```ts
const handleApplyPreset = (preset: Preset) => {
  if (activePresetId === preset.id) {
    setActivePresetId(null);
    if (baseAdjustments) {
      setAdjustments(baseAdjustments);
    }
    setBaseAdjustments(null);
    return;
  }

  setBaseAdjustments(adjustments);
  setActivePresetId(preset.id);
  setPresetIntensity(100);

  const effective = getEffectivePresetAdjustments(preset);
  setAdjustments((prevAdjustments: Adjustments) => ({
    ...prevAdjustments,
    ...effective,
  }));
};
```

Replace `handleIntensityChange` with:

```ts
const handleIntensityChange = useCallback(
  (preset: Preset, intensity: number) => {
    setPresetIntensity(intensity);
    const effective = getEffectivePresetAdjustments(preset);
    const mixed = mixAdjustments(effective, intensity);
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      ...mixed,
    }));
  },
  [setAdjustments],
);
```

- [ ] **Step 4: Update save handler signature**

Replace `handleSaveConfiguredPreset` with:

```ts
const handleSaveConfiguredPreset = async (name: string, mode: PasteMode, includedAdjustments: string[]) => {
  if (configureModalState.preset) {
    const updated = configurePreset(configureModalState.preset.id, name, mode, includedAdjustments);
    if (updated) {
      await generateSinglePreview(updated);
    }
  } else {
    const newPreset = addPreset(name, null, mode, includedAdjustments);
    if (newPreset) {
      await generateSinglePreview(newPreset);
    }
  }
  setConfigureModalState({ isOpen: false, preset: null });
};
```

- [ ] **Step 5: Clean up unused imports**

Remove `Switch` and `Wrench`, `Palette`, and `Settings2` from the `lucide-react` import if they are no longer used. `Settings2` is used by the context menu; keep it. Remove `Wrench` and `Palette`.

---

## Task 10: Add/configure i18n strings

**Files:**

- Modify: `src/i18n/locales/en.json` around `modals.configurePreset`
- Modify: `src/i18n/locales/ru.json` around `modals.configurePreset`

- [ ] **Step 1: Update English strings**

Replace the existing `configurePreset` block with:

```json
    "configurePreset": {
      "cancel": "Cancel",
      "pasteMode": "Apply Mode",
      "placeholder": "Enter preset name...",
      "save": "Save",
      "titleConfigure": "Configure Preset",
      "titleSave": "Save New Preset"
    },
```

`includedAdjustments`, `selectAll`, `selectNone`, `modeMerge`, `modeReplace`, `descMerge`, `descReplace` are reused from `modals.copyPaste`.

- [ ] **Step 2: Update Russian strings**

Replace the existing `configurePreset` block with:

```json
    "configurePreset": {
      "cancel": "Отмена",
      "pasteMode": "Режим применения",
      "placeholder": "Введите название пресета...",
      "save": "Сохранить",
      "titleConfigure": "Настройка пресета",
      "titleSave": "Сохранить новый пресет"
    },
```

---

## Task 11: Verify the build

**Files:**

- All modified files above.

- [ ] **Step 1: Type-check and build the frontend**

Run: `npm run build`
Expected: build succeeds with no new TypeScript errors.

- [ ] **Step 2: Check Rust compilation**

Run: `cd src-tauri && cargo check`
Expected: no errors.

- [ ] **Step 3: Check formatting on changed files**

Run:

```bash
npx prettier --check \
  src/components/ui/AppProperties.tsx \
  src/utils/presetUtils.ts \
  src/hooks/usePresets.ts \
  src/components/ui/PasteModeSwitch.tsx \
  src/components/ui/AdjustmentKeyPicker.tsx \
  src/components/modals/ConfigurePresetModal.tsx \
  src/components/modals/CopyPasteSettingsModal.tsx \
  src/components/presets/PresetsBrowser.tsx \
  src/i18n/locales/en.json \
  src/i18n/locales/ru.json
```

Expected: all files pass Prettier formatting.

---

## Self-review coverage

- Rust preset persistence: Task 1.
- TypeScript preset type: Task 2.
- Legacy preset migration: Task 3 helpers + Task 4 load/import.
- Create preset with selected keys/mode: Task 4 `addPreset` + Task 7 modal.
- Configure existing preset selection: Task 4 `configurePreset` + Task 7 modal.
- Overwrite preset respecting existing selection: Task 4 `overwritePreset`.
- Apply preset with merge/replace semantics: Task 9 `handleApplyPreset`/`handleIntensityChange` + Task 3 `getEffectivePresetAdjustments`.
- Preset list badges reflect selection: Task 9 `PresetItemDisplay`.
- Reusable UI shared with copy/paste: Tasks 5 and 6, consumed by Tasks 7 and 8.
- i18n labels for new modal: Task 10.
- Verification: Task 11.
