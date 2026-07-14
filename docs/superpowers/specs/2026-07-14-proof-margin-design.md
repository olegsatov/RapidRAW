# Proof Margin — design spec

## Summary

Добавить в редактор двухуровневые отступы (proof margin) вокруг изображения, чтобы кадр «плавал» на однотонном фоне редактора. Отступы применяются только в режиме fit-to-window; при зуме изображение масштабируется относительно уменьшенного fit и может заполнять поля. Переключение между уровнями — по горячей клавише `'` (Quote) по умолчанию.

## Requirements

1. Два настраиваемых значения в приложении:
   - `proofMarginLevel1` — маленький отступ (по умолчанию **60 px**).
   - `proofMarginLevel2` — большой отступ (по умолчанию **120 px**).
2. Активный уровень `proofMarginLevel` сохраняется между запусками (`1` или `2`, по умолчанию `1`).
3. Горячая клавиша переключает активный уровень `1 ↔ 2`. Дефолт: `Quote` (`'`).
4. Отступ равен со всех сторон редактора и задаётся в пикселях.
5. Отступ применяется только в fit-виде; при приближении изображение расширяется и может покрывать поля.
6. Настройки редактируются во вкладке **General** панели настроек.

## Out of scope

- Отдельный режим «margin off» (кроме значения `0` в одном из уровней).
- Анимация перехода между уровнями.
- Разные отступы по горизонтали/вертикали.

## Architecture

### 1. Хранение настроек

Новые поля добавляются в Rust-структуру `AppSettings` и в TypeScript-тип `AppSettings`:

- `proof_margin_level_1: Option<u32>` → `proofMarginLevel1?: number`
- `proof_margin_level_2: Option<u32>` → `proofMarginLevel2?: number`
- `proof_margin_level: Option<u8>` → `proofMarginLevel?: 1 | 2`

Дефолты: `60`, `120`, `1`. Значения `0` означают «отступа нет».

### 2. Расчёт размера изображения

Хук `useImageRenderSize(containerRef, imageDimensions, margin?)` получает опциональный параметр `margin` в пикселях.

Логика:

```text
effectiveWidth  = max(container.clientWidth  - margin * 2, 0)
effectiveHeight = max(container.clientHeight - margin * 2, 0)
```

Далее изображение подгоняется под `effectiveWidth × effectiveHeight` с сохранением пропорций. Возвращаемые `width/height/offsetX/offsetY/scale` учитывают отступ:

- `width/height` — уменьшенные размеры картинки;
- `offsetX/offsetY` — смещение от левого/верхнего края контейнера (включают отступ + центрирование);
- `scale` — соотношение уменьшенной ширины к исходной ширине картинки.

Благодаря этому все потребители `imageRenderSize` (DOM-изображение, SVG-оверлеи, маски, WGPU-оверлей) автоматически рисуют картинку меньше и центрируют её с полями.

### 3. Переключение уровня

В `keyboardUtils.ts` добавляется определение:

```ts
{
  action: 'toggle_proof_margin',
  description: 'settings.keybinds.actions.toggle_proof_margin',
  defaultCombo: ['Quote'],
  section: 'view',
}
```

В `useKeyboardShortcuts.ts` по этому действию:

```ts
const nextLevel = settings.proofMarginLevel === 2 ? 1 : 2;
settings.handleSettingsChange({ ...settings.appSettings, proofMarginLevel: nextLevel });
```

### 4. UI настроек

Во вкладке **General** панели `SettingsPanel` добавляется блок с двумя числовыми полями:

- Label: `settings.general.proofMarginLevel1` / `…Level2`
- Description: `settings.general.proofMarginLevel1Desc` / `…Level2Desc`
- Input type: `number`, min `0`, max `500`, step `1`.
- Значение сохраняется сразу через `onSettingsChange`.

### 5. Локализация

Ключи добавляются во все языковые файлы:

- `settings.general.proofMarginLevel1`
- `settings.general.proofMarginLevel1Desc`
- `settings.general.proofMarginLevel2`
- `settings.general.proofMarginLevel2Desc`
- `settings.keybinds.actions.toggle_proof_margin`

Для языков, кроме `ru.json`, используем английские строки как fallback; в `ru.json` — русский перевод.

## Files to change

| File | Change |
|------|--------|
| `src-tauri/src/app_settings.rs` | Новые поля `proof_margin_level_1/2/level`, дефолты, `Default`. |
| `src/components/ui/AppProperties.tsx` | Типы `proofMarginLevel1/2/level` в `AppSettings`. |
| `src/hooks/useImageRenderSize.ts` | Принимать `margin` и вычитать его из размеров контейнера. |
| `src/components/panel/Editor.tsx` | Передавать активный margin в `useImageRenderSize`. |
| `src/utils/keyboardUtils.ts` | Определение `toggle_proof_margin`. |
| `src/hooks/useKeyboardShortcuts.ts` | Обработчик переключения уровня. |
| `src/components/panel/SettingsPanel.tsx` | Поля ввода отступов. |
| `src/i18n/locales/*.json` | Локализация новых строк. |

## Edge cases

- Если отступ больше половины меньшей стороны контейнера, `effectiveWidth/Height` становятся `0`. Хук должен класть `0`, чтобы изображение не исчезло при некорректных настройках; на практике UI ограничивает значение `500 px`, что безопасно для любого окна.
- При переключении уровня `imageRenderSize` обновляется мгновенно; масштаб `transformState.scale` остаётся относительным к новому fit.
- В полноэкранном режиме и в режиме кропа margin применяется так же, потому что они используют тот же хук и тот же fit-расчёт. Это считается корректным поведением для «fit-вида».

## Verification

- `npm run build` — фронт собирается без новых ошибок TypeScript.
- `cargo check` в `src-tauri/` — Rust собирается.
- `npx prettier --check` на изменённых файлах.
- Ручная проверка:
  - открыть изображение — видны поля;
  - нажать `'` — переключается уровень;
  - изменить значения в настройках — сразу применяются;
  - зум/панорамирование работают без смещений;
  - маски, WGPU-оверлей и кроп остаются выровненными.
