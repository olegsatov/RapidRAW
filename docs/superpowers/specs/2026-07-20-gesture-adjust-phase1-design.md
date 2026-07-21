# Gesture Adjust — фаза 1: дизайн

Дата: 2026-07-20
Статус: утверждён пользователем (brainstorming session)

## Цель

Перенести идею BetterSpeedEdit (macOS-утилита «мышь как контроллер ретуши») в RapidRAW.
Поскольку у нас полный контроль над кодом, не нужны AppleScript, синтетические хоткеи и
отдельные оверлеи — работаем с параметрами изображения напрямую через существующий
пайплайн adjustments.

**Фаза 1 (этот документ):** самый базовый функционал, без визуализации. Одна клавиша
(по умолчанию «A», переназначаемая в панели хоткеев): удержание клавиши + движение
мыши → `temperature`/`tint`, удержание + скролл → `flimWarmth`/`flimSaturation`.
Из BetterSpeedEdit портируется математика перехвата движений мыши и жестов трекпада.

Не входит в фазу 1: визуализация (оверлеи слайдеров), дополнительные биндинги,
LMB/RMB-наборы параметров, hue-wrap, конфиг-движок с JSON.

## Решённые вопросы (из уточнений)

- Активация: отдельная команда в панели хоткеев, дефолт — одиночная буква «A»
  (как speededit в Capture One). Модель «одна клавиша → 2 параметра на движение +
  2 параметра на скролл» взята из BetterSpeedEdit (`parametersMain` + `parametersScroll`).
- Каналы ввода: движение мыши (Pointer Lock) **и** скролл (колесо/трекпад).
- Биндинг фазы 1: move → `temperature`, `tint`; scroll → `flimWarmth`, `flimSaturation`.
  Action id в `KEYBIND_DEFINITIONS`: `gesture_color_balance` (не `gesture_white_balance`,
  потому что scroll-оси управляют film color, а не балансом белого).
- Если flim-тонмаппер выключен (`toneMapper !== 'flim'`) — жест игнорируется
  (warmth/saturation — flim-only параметры).

## Архитектура (подход A: чистый фронтенд-модуль)

### Новые файлы (наша дельта)

- `src/utils/gestureEngine.ts` — чистый порт математики BetterSpeedEdit без DOM:
  - `AxisLock` — скользящее окно последних N дельт, переходы
    none → horizontal/vertical → both (порт `MouseInterpreter.consumeMouseDelta`,
    `BetterSpeedEdit/Sources/MouseToKeys/MouseInterpreter.swift:63-111`);
  - `StepAccumulator` — дробный аккумулятор с порогом step и переносом остатка
    (порт `consumeSteps`, `EventEngine.swift:847-866`);
  - `detectDevice(wheelEvent)` — эвристика мышь/трекпад для web (`deltaMode`,
    кратность дельт 100/120, дробные мелкие дельты); аналог `isContinuous` +
    проверки фаз (`EventEngine.swift:712-732`);
  - константы чувствительности из shipped-конфига BSE: mouse move `{stepX:6, stepY:6}`,
    mouse scroll `6`, trackpad scroll `2.5`; axis `{windowSize:5, axisThreshold:1.5,
diagRatio:0.5}`; scrollAxis `{windowSize:5, axisThreshold:8, diagRatio:0.5}`.
- `src/hooks/useGestureAdjust.ts` — хук сессии: трекинг зажатой клавиши, жизненный
  цикл жеста, Pointer Lock на контейнере превью, применение шагов к adjustments
  с clamp, `isSliderDragging` на время сессии.
- `src/utils/gestureBindings.ts` — декларативная таблица биндингов (одна запись):
  id команды, дефолтная клавиша, move → `[{key:'temperature', min:-100, max:100, step:1},
{key:'tint', ...}]`, scroll → `[flimWarmth, flimSaturation]`. Диапазоны/шаги
  дублируют значения из FilmPanel (4 параметра) — FilmPanel в фазе 1 не трогаем,
  чтобы не раздувать дельту с upstream; вынос в общий модуль — отдельной задачей,
  когда биндингов станет больше.
- Юнит-тесты движка (см. «Тестирование»).

### Хирургические правки shared-файлов (минимальные)

- `KEYBIND_DEFINITIONS` / `src/utils/keyboardUtils.ts` — новая команда хоткея
  (`gesture_color_balance`, дефолт «A»), переназначаемая через существующую панель.
- `src/hooks/useKeyboardShortcuts.ts` — guard: на время активной жест-сессии
  остальные хоткеи заблокированы (одна проверка флага).
- `src/components/views/EditorView.tsx` — подключение хука.
- `src/i18n/locales/*.json` — строка имени команды.

Изменений в Rust нет: клавиша и настройки живут в существующем `appSettings`
(keybinds уже persist'ятся).

## Жизненный цикл сессии и поток данных

**Старт:** keydown клавиши жеста. Guard'ы как в `useKeyboardShortcuts.ts:593-611`
(редактор активен, нет модалки, фокус не в input) + `toneMapper === 'flim'`.
Портирован `swallowDelay` из BSE: реальный keydown проглатывается в capture-фазе,
но на 150 мс откладывается решение — если keyup пришёл раньше, синтетическая пара
keydown/keyup отправляется на `window`, и клавиша работает как обычная (например,
`A` продолжает переключать analytics); если таймер сработал — стартует жест.
Запрос Pointer Lock на `document.body` → курсор замирает и прячется (нативный
аналог freeze/warp курсора из BSE). `isSliderDragging: true`.

**Во время сессии:**

- `pointermove` → `movementX/Y` (сырые дельты без OS-ускорения — аналог HID-дельт
  BSE) → AxisLock → StepAccumulator → целые шаги: up `+temperature`, down `−temperature`,
  left `−tint`, right `+tint`.
- `wheel` (preventDefault, перехват раньше обработчика панорамирования Editor.tsx) →
  detectDevice → scroll AxisLock → StepAccumulator: up `+flimWarmth`, down `−flimWarmth`,
  left `−flimSaturation`, right `+flimSaturation`. Мышиное колесо квантуется до ±1
  на щелчок (как в BSE direct-режиме); трекпад использует дельту как есть.
- Применённый шаг: `setAdjustments(prev => ({...prev, [key]: clamp(v+delta, min, max)}))`
  через `useEditorActions`. Быстрый interactive-patch рендер подхватывается
  автоматически (путь `isSliderDragging` в `useImageProcessing.ts:446`); история
  пишется одной записью через существующий debounce 500 мс.

**Конец:** keyup клавиши → `document.exitPointerLock()`, `isSliderDragging: false` →
существующий 50-мс финальный рендер + `debouncedSave`. Сброс всех аккумуляторов и окон
axis-lock (порт `mouse.reset()` / `forceStopCapture`). Тот же сброс по
`pointerlockchange` (Esc рвёт lock на уровне браузера) и при уходе из редактора.

**Коллизии:** зажатая «A» блокирует остальные хоткеи на время сессии; Shift/Alt-пан
и pinch-zoom (ctrl+wheel) не затрагиваются вне сессии.

## Тестирование

- Юнит-тесты `gestureEngine.ts`: axis-lock (чистые оси, диагональ → both, сброс),
  аккумулятор (дробный перенос, знаки, серии мелких дельт), квантование мышиного
  колеса до ±1, detectDevice на записанных последовательностях wheel-событий.
  Раннер: vitest, если есть в проекте; иначе node-скрипт в `scratch/` (решается на
  этапе плана).
- Ручная проверка: мышь и трекпад по отдельности; freeze курсора; одна запись истории;
  Esc; flim off → игнор; Shift/Alt-пан и pinch-zoom не сломаны.
- Гейты репо: `npm run build`, `npx prettier --check` по новым файлам, `cargo check`
  (контрольный прогон; правок Rust быть не должно).

## Референсы BetterSpeedEdit (для порта)

- `Sources/MouseToKeys/MouseInterpreter.swift:63-111` — axis-lock мыши.
- `Sources/MouseToKeys/EventEngine.swift:659-698` — axis-lock скролла (фильтрация осей).
- `EventEngine.swift:703-916` — нормализация скролла, device detection, аккумуляторы.
- `EventEngine.swift:847-866` — `consumeSteps` (fractional carry-over).
- `bindings.json` (корень репо BSE) — модель `parametersMain`/`parametersScroll`.
- `settings.json` — дефолты чувствительности и axis-lock.
