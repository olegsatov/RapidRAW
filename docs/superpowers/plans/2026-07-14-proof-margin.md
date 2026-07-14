# Proof Margin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить в редактор двухуровневые отступы вокруг изображения с настраиваемыми значениями и переключением по горячей клавише `'`.

**Architecture:** Активный отступ передаётся в `useImageRenderSize`, который вычитает `2 × margin` из размеров контейнера перед fit-расчётом. Переключение уровня и сохранение настроек идёт через существующий `AppSettings`/стор. UI настроек и хоткеи расширяются минимальными изменениями.

**Tech Stack:** React, TypeScript, Zustand, Tauri/Rust, Tailwind, i18next.

---

## File structure

| File | Responsibility |
|------|----------------|
| `src-tauri/src/app_settings.rs` | Новые persisted-поля и дефолты на Rust-стороне. |
| `src/components/ui/AppProperties.tsx` | TypeScript-типы для новых полей. |
| `src/hooks/useImageRenderSize.ts` | Учёт отступа при расчёте размеров изображения. |
| `src/components/panel/Editor.tsx` | Передача активного отступа в хук. |
| `src/utils/keyboardUtils.ts` | Определение действия `toggle_proof_margin`. |
| `src/hooks/useKeyboardShortcuts.ts` | Обработчик переключения уровня. |
| `src/components/panel/SettingsPanel.tsx` | Числовые поля для двух уровней отступа. |
| `src/i18n/locales/*.json` | Переводы новых строк. |

---

### Task 1: Rust — добавить поля в `AppSettings`

**Files:**
- Modify: `src-tauri/src/app_settings.rs`

- [ ] **Step 1: Добавить поля в структуру**

  После `pub folder_tree_sort: Option<FolderTreeSort>,` добавить:

  ```rust
  #[serde(default)]
  pub proof_margin_level_1: Option<u32>,
  #[serde(default)]
  pub proof_margin_level_2: Option<u32>,
  #[serde(default)]
  pub proof_margin_level: Option<u8>,
  ```

- [ ] **Step 2: Добавить дефолты**

  В `impl Default for AppSettings`, после `folder_tree_sort: Some(FolderTreeSort::default()),` добавить:

  ```rust
  proof_margin_level_1: Some(60),
  proof_margin_level_2: Some(120),
  proof_margin_level: Some(1),
  ```

- [ ] **Step 3: Проверить Rust**

  Run: `cargo check`
  Expected: no errors.

---

### Task 2: TypeScript-типы — `AppProperties.tsx`

**Files:**
- Modify: `src/components/ui/AppProperties.tsx`

- [ ] **Step 1: Добавить поля в `AppSettings`**

  После `folderTreeSort?: FolderTreeSort;` добавить:

  ```ts
  proofMarginLevel1?: number;
  proofMarginLevel2?: number;
  proofMarginLevel?: 1 | 2;
  ```

- [ ] **Step 2: Проверить типы**

  Run: `npx tsc --noEmit`
  Expected: no new errors (repo has pre-existing baseline; check only new ones).

---

### Task 3: Хук `useImageRenderSize` — учёт отступа

**Files:**
- Modify: `src/hooks/useImageRenderSize.ts`

- [ ] **Step 1: Изменить сигнатуру**

  Заменить:

  ```ts
  export const useImageRenderSize = (
    containerRef: React.RefObject<HTMLElement>,
    imageDimensions: ImageDimensions | null,
  ) => {
  ```

  на:

  ```ts
  export const useImageRenderSize = (
    containerRef: React.RefObject<HTMLElement>,
    imageDimensions: ImageDimensions | null,
    margin: number = 0,
  ) => {
  ```

- [ ] **Step 2: Вычитать отступ из размеров контейнера**

  Внутри `updateSize` заменить:

  ```ts
  const { clientWidth: containerWidth, clientHeight: containerHeight } = container;
  ```

  на:

  ```ts
  const { clientWidth: rawWidth, clientHeight: rawHeight } = container;
  const marginPx = Math.max(0, margin);
  const containerWidth = Math.max(0, rawWidth - marginPx * 2);
  const containerHeight = Math.max(0, rawHeight - marginPx * 2);
  ```

- [ ] **Step 3: Добавить `margin` в зависимости эффекта**

  Заменить `}, [containerRef, imgWidth, imgHeight]);` на `}, [containerRef, imgWidth, imgHeight, margin]);`.

- [ ] **Step 4: Проверить форматирование**

  Run: `npx prettier --check src/hooks/useImageRenderSize.ts`
  Expected: clean.

---

### Task 4: `Editor.tsx` — передать активный отступ

**Files:**
- Modify: `src/components/panel/Editor.tsx`

- [ ] **Step 1: Вычислить активный margin**

  Перед строкой:

  ```ts
  const imageRenderSize = useImageRenderSize(imageContainerRef, croppedDimensions);
  ```

  добавить:

  ```ts
  const proofMargin = useMemo(() => {
    if (!appSettings) return 0;
    return appSettings.proofMarginLevel === 2
      ? (appSettings.proofMarginLevel2 == null ? 120 : appSettings.proofMarginLevel2)
      : (appSettings.proofMarginLevel1 == null ? 60 : appSettings.proofMarginLevel1);
  }, [appSettings?.proofMarginLevel, appSettings?.proofMarginLevel1, appSettings?.proofMarginLevel2]);
  ```

- [ ] **Step 2: Передать margin в хук**

  Заменить:

  ```ts
  const imageRenderSize = useImageRenderSize(imageContainerRef, croppedDimensions);
  ```

  на:

  ```ts
  const imageRenderSize = useImageRenderSize(imageContainerRef, croppedDimensions, proofMargin);
  ```

- [ ] **Step 3: Проверить форматирование**

  Run: `npx prettier --check src/components/panel/Editor.tsx`
  Expected: clean.

---

### Task 5: Горячая клавиша — `keyboardUtils.ts`

**Files:**
- Modify: `src/utils/keyboardUtils.ts`

- [ ] **Step 1: Добавить определение действия**

  Перед `brush_size_down` добавить:

  ```ts
  {
    action: 'toggle_proof_margin',
    description: 'settings.keybinds.actions.toggle_proof_margin',
    defaultCombo: ['Quote'],
    section: 'view',
  },
  ```

- [ ] **Step 2: Проверить форматирование**

  Run: `npx prettier --check src/utils/keyboardUtils.ts`
  Expected: clean.

---

### Task 6: Обработчик переключения — `useKeyboardShortcuts.ts`

**Files:**
- Modify: `src/hooks/useKeyboardShortcuts.ts`

- [ ] **Step 1: Добавить action в `actions`**

  Перед `brush_size_up` (или в секции `view`) добавить:

  ```ts
  toggle_proof_margin: {
    shouldFire: (s: any) => !!s.editor.selectedImage,
    execute: (e: any, s: any) => {
      e.preventDefault();
      const settings = s.settings.appSettings || {};
      const nextLevel = settings.proofMarginLevel === 2 ? 1 : 2;
      s.settings.handleSettingsChange({ ...settings, proofMarginLevel: nextLevel });
    },
  },
  ```

- [ ] **Step 2: Проверить форматирование**

  Run: `npx prettier --check src/hooks/useKeyboardShortcuts.ts`
  Expected: clean.

---

### Task 7: UI настроек — `SettingsPanel.tsx`

**Files:**
- Modify: `src/components/panel/SettingsPanel.tsx`

- [ ] **Step 1: Добавить поля ввода уровней**

  После блока `focusMode` (`SettingItem` с `focusMode`) добавить два блока:

  ```tsx
  <SettingItem
    label={t('settings.general.proofMarginLevel1')}
    description={t('settings.general.proofMarginLevel1Desc')}
  >
    <Input
      type="number"
      min={0}
      max={500}
      step={1}
      value={String(appSettings?.proofMarginLevel1 ?? 60)}
      onChange={(e) =>
        onSettingsChange({
          ...appSettings,
          proofMarginLevel1: Math.min(500, Math.max(0, parseInt(e.target.value, 10) || 0)),
        })
      }
      bgClassName="bg-bg-primary"
    />
  </SettingItem>

  <SettingItem
    label={t('settings.general.proofMarginLevel2')}
    description={t('settings.general.proofMarginLevel2Desc')}
  >
    <Input
      type="number"
      min={0}
      max={500}
      step={1}
      value={String(appSettings?.proofMarginLevel2 ?? 120)}
      onChange={(e) =>
        onSettingsChange({
          ...appSettings,
          proofMarginLevel2: Math.min(500, Math.max(0, parseInt(e.target.value, 10) || 0)),
        })
      }
      bgClassName="bg-bg-primary"
    />
  </SettingItem>
  ```

- [ ] **Step 2: Проверить форматирование**

  Run: `npx prettier --check src/components/panel/SettingsPanel.tsx`
  Expected: clean.

---

### Task 8: Локализация

**Files:**
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/ru.json`
- Modify: `src/i18n/locales/de.json`, `es.json`, `fr.json`, `it.json`, `ja.json`, `ko.json`, `pl.json`, `pt.json`, `zh-CN.json`, `zh-TW.json`

- [ ] **Step 1: Добавить строки в `en.json`**

  Внутри `settings.general` добавить:

  ```json
  "proofMarginLevel1": "Proof Margin — Level 1",
  "proofMarginLevel1Desc": "Small padding around the image in the editor (pixels).",
  "proofMarginLevel2": "Proof Margin — Level 2",
  "proofMarginLevel2Desc": "Large padding around the image in the editor (pixels)."
  ```

  Внутри `settings.keybinds.actions` добавить:

  ```json
  "toggle_proof_margin": "Toggle proof margin level"
  ```

- [ ] **Step 2: Добавить строки в `ru.json`**

  Внутри `settings.general`:

  ```json
  "proofMarginLevel1": "Proof margin — уровень 1",
  "proofMarginLevel1Desc": "Маленький отступ вокруг изображения в редакторе (в пикселях).",
  "proofMarginLevel2": "Proof margin — уровень 2",
  "proofMarginLevel2Desc": "Большой отступ вокруг изображения в редакторе (в пикселях)."
  ```

  Внутри `settings.keybinds.actions`:

  ```json
  "toggle_proof_margin": "Переключить уровень proof margin"
  ```

- [ ] **Step 3: Добавить fallback-строки в остальные локали**

  В каждый из оставшихся файлов (`de`, `es`, `fr`, `it`, `ja`, `ko`, `pl`, `pt`, `zh-CN`, `zh-TW`) добавить те же ключи, что и в `en.json`, с английскими значениями. Это избавляет от пустых ключей до момента полного перевода.

- [ ] **Step 4: Проверить JSON**

  Run: `npx prettier --check "src/i18n/locales/*.json"`
  Expected: clean.

---

### Task 9: Сборка и финальная проверка

- [ ] **Step 1: Rust check**

  Run:
  ```bash
  cd src-tauri && cargo check
  ```
  Expected: clean.

- [ ] **Step 2: Frontend build**

  Run:
  ```bash
  npm run build
  ```
  Expected: completes without new TypeScript/build errors.

- [ ] **Step 3: Formatting checks**

  Rust formatting:
  ```bash
  cd src-tauri && cargo fmt --check
  ```
  Expected: clean.

  Frontend formatting:
  ```bash
  npx prettier --check src/components/ui/AppProperties.tsx src/hooks/useImageRenderSize.ts src/components/panel/Editor.tsx src/utils/keyboardUtils.ts src/hooks/useKeyboardShortcuts.ts src/components/panel/SettingsPanel.tsx "src/i18n/locales/*.json"
  ```
  Expected: clean.

- [ ] **Step 4: Ручная проверка (если запускается dev-режим)**

  1. Открыть изображение — должны быть видны поля размером 60 px.
  2. Нажать `'` — поля должны увеличиться до 120 px.
  3. Изменить значения в Settings → General — изменения применяются сразу.
  4. Зум/пан, маски, WGPU-оверлей и кроп остаются выровненными.

---

## Self-review

- **Spec coverage:** Все требования спецификации покрыты: поля настроек, дефолты, сохранение уровня, хоткей, передача margin в `useImageRenderSize`, UI, локализация, проверки.
- **Placeholder scan:** Нет `TBD`, `TODO`, ссылок на нереализованные функции.
- **Type consistency:** `proofMarginLevel1/2` везде `number`/u32, `proofMarginLevel` — `1 | 2`/u8, имя действия `toggle_proof_margin` едино во всех файлах.

## Notes

- Согласно `AGENTS.md`, не делать косметических правок в файлах, которые не требуются фичей. Все изменения минимальны и нацелены.
- Git-коммиты не выполняются без явного запроса пользователя.
