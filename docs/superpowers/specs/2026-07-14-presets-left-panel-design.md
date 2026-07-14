# Перенос Presets в левую колонку

## Контекст

В RapidRAW интерфейс пресетов сейчас находится в отдельном табе правой колонки (`Panel.Presets`). Это неудобно: пользователь видит либо инструменты, либо пресеты. Нужно продублировать (фактически — перенести) интерфейс пресетов в нижнюю половину левой колонки, разделив её вертикально на список папок и панель пресетов.

## Цель

1. Убрать таб Presets из правой колонки.
2. Добавить в левую колонку нижнюю панель с горизонтальными табами.
3. Сейчас в ней один таб — Presets. Архитектура должна позволять добавлять новые табы позже.
4. Сохранить существующий функционал: список пресетов/папок, drag-and-drop, контекстные меню, модалки, генерацию превью, импорт/экспорт, community.
5. Сделать разделение ресайзабельным по умолчанию 50/50 и сохранять высоту между сессиями.
6. Переназначить горячую клавишу `P` на показ/скрытие левой нижней панели.

## Решение

### 1. Лейаут левой колонки

В `App.tsx` текущий `renderFolderTree()` возвращает горизонтальную ячейку: `FolderTree` + вертикальный `Resizer`. Внутри этой ячейки появляется вертикальный сплит:

- Верх — существующий `FolderTree` (`flex-1 min-h-0`).
- Горизонтальный `Resizer` (`Orientation.Horizontal`) для изменения высоты нижней части.
- Низ — новый `LeftBottomPanel`.

По умолчанию нижняя часть занимает 50 % высоты левой колонки. После первого ресайза запоминается абсолютная высота `leftBottomPanelHeight`. Ограничения: min ~120 px, max ~(высота левой колонки − 120 px).

### 2. Табы в нижней части

`LeftBottomPanel` состоит из:

- Горизонтального таб-бара вверху.
- Области контента под ним.

Сейчас табов один:

- **Presets** — иконка `SwatchBook`, текст `editor.presets.title`.

Вводится тип `LeftPanelTab`:

```ts
export enum LeftPanelTab {
  Presets = 'presets',
}
```

Таб-бар рисуется вдоль верхней границы нижней половины левой колонки.

### 3. Перенос интерфейса пресетов

Вся логика пресетов сейчас находится в `src/components/panel/right/PresetsPanel.tsx`. Она выделяется в новый компонент `src/components/presets/PresetsBrowser.tsx`:

- список пресетов и папок;
- drag-and-drop (`@dnd-kit`);
- контекстные меню;
- модалки (`ConfigurePresetModal`, `CreateFolderModal`, `RenameFolderModal`);
- генерация превью;
- apply/overwrite/configure/duplicate/delete/import/export.

`PresetsBrowser` принимает пропсы:

```ts
interface PresetsBrowserProps {
  isVisible: boolean;
  onNavigateToCommunity?: () => void;
}
```

`isVisible` заменяет текущую проверку `activeRightPanel === Panel.Presets` для запуска генерации превью.

`PresetsPanel.tsx` остаётся тонкой обёрткой вокруг `PresetsBrowser` для минимизации upstream-диффа, но больше не используется в правой колонке.

### 4. Удаление Presets из правой колонки

- `RightPanelSwitcher.tsx` — убрать иконку Presets из `panelGroups`.
- `EditorView.tsx` — убрать ветку `renderedRightPanel === Panel.Presets`.
- `useUIStore.ts` — убрать `Panel.Presets` из `RIGHT_PANEL_ORDER`.
- `useAppInitialization.ts` — при загрузке, если сохранённый `activeRightPanel === Panel.Presets`, сбрасывать на `Panel.Adjustments`.

### 5. Горячая клавиша P

В `useKeyboardShortcuts.ts` `toggle_presets` переназначается:

- показывать/скрывать `uiVisibility.leftBottomPanel`;
- при показе переключать активный таб нижней панели на `LeftPanelTab.Presets`.

### 6. Состояние и персистентность

В `useUIStore.ts` добавляются поля:

```ts
leftBottomPanelHeight: number; // 0 означает "50 % по умолчанию"
activeLeftBottomTab: LeftPanelTab;
uiVisibility.leftBottomPanel: boolean;
```

В `AppSettings` (TypeScript и Rust) добавляется:

```ts
leftBottomPanelHeight?: number;
```

`uiVisibility` уже сохраняется как объект; в `UiVisibility` добавляется `leftBottomPanel: boolean`.

В `useAppInitialization.ts`:

- при старте применяются сохранённые `leftBottomPanelHeight` и `uiVisibility.leftBottomPanel`;
- добавляются эффекты для сохранения изменений `leftBottomPanelHeight` в `appSettings`.

### 7. Превью и DnD

- Генерация превью в `PresetsBrowser` завязана на `isVisible`. Пока панель скрыта, превью не считаются.
- DnD-id остаются UUID пресетов/папок. Так как правый Presets-таб убран, одновременно виден только один `PresetsBrowser` — конфликтов не будет.

### 8. Трогаемые файлы

#### Новые

- `src/components/panel/left/LeftBottomPanel.tsx`
- `src/components/panel/left/LeftPanelTabs.tsx`
- `src/components/presets/PresetsBrowser.tsx`

#### Хирургические правки

- `src/App.tsx` — вертикальный сплит в `renderFolderTree()`.
- `src/store/useUIStore.ts` — новые поля, удаление Presets из `RIGHT_PANEL_ORDER`.
- `src/components/views/EditorView.tsx` — удаление Presets из правой панели.
- `src/components/panel/right/RightPanelSwitcher.tsx` — удаление иконки Presets.
- `src/components/panel/right/PresetsPanel.tsx` — обёртка над `PresetsBrowser`.
- `src/hooks/useKeyboardShortcuts.ts` — переназначение `P`.
- `src/hooks/useAppInitialization.ts` — загрузка/сохранение новых настроек.
- `src/components/ui/AppProperties.tsx` — поля в `AppSettings` и `UiVisibility`, добавление `LeftPanelTab`.
- `src-tauri/src/app_settings.rs` — поле `left_bottom_panel_height`.

## Критерии приёмки

- [ ] В правой колонке больше нет таба Presets.
- [ ] В левой колонке нижняя половина содержит таб Presets.
- [ ] Интерфейс пресетов в нижней панели полностью работает: apply, intensity slider, DnD, папки, контекстные меню, модалки, import/export, community.
- [ ] Левая колонка разделена вертикально 50/50 по умолчанию, ресайзер работает.
- [ ] Высота нижней панели сохраняется после перезапуска приложения.
- [ ] Клавиша `P` показывает/скрывает левую нижнюю панель.
- [ ] `npm run build` проходит без новых ошибок.
- [ ] `cargo check` в `src-tauri/` проходит без новых ошибок.
