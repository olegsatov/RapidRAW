# Симуляция плёнки в RapidRAW

Документ описывает интеграцию модуля симуляции плёночного грейда в форк RapidRAW
(`/Users/someone/Coding/RAW`): откуда пришёл алгоритм, где он живёт в GPU-пайплайне,
полный набор параметров, профили, правила layout'а uniform-буфера и как это тестировать.

## Источник

Алгоритм портирован из proof-of-concept на WebGL2, сделанного в проекте Krea Web
(`/Users/someone/Downloads/krea-web/client/src/film-poc`). PoC доказал, что весь грейд
(LUT-кривые красителей, откат светов, цветовой bleed, cross-process, WB, зерно,
виньетка, галация, размытие эмульсии, хроматическая аберрация) можно считать
на GPU в реальном времени на больших разрешениях. В RapidRAW он перенесён на WGSL/wgpu
и встроен в существующий compute-пайплайн.

**Важно:** первичная обработка RAW (демозаик, базовая экспозиция, tone window) НЕ
переносилась — по требованию используется нативный пайплайн RapidRAW. Плёнка — это
look, накладываемый поверх отработанного изображения.

## Место в пайплайне

Главный compute-шейдер `src-tauri/src/shaders/shader.wgsl` применяет коррекции в
строгом порядке. `apply_film_look` вызывается:

- **после** тон-маппера (т.е. после того, как RapidRAW привёл изображение к
  нормальному контрасту — сначала нейтральная картинка, потом плёнка);
- **после** B&W-конверсии (раздел `blackAndWhite`): ч/б-сведение применяется к
  тон-мапнутому sRGB до плёнки, поэтому плёночный грейд работает и поверх
  монохромной картинки;
- **до** пользовательских кривых, LUT и нативного зерна.

`apply_film_look` работает в sRGB (на входе и выходе sRGB, внутри — переход в linear
для LUT/математики и обратно).

### Порядок операций внутри `apply_film_look`

1. Early-return при `film_strength == 0`.
2. sRGB → linear.
3. Highlight rolloff (мягкое сворачивание светов).
4. Dye curves — LUT 256×3, упакованный в uniform-массив `film_curves`
   (chunked 16×16 vec3 из-за лимитов uniform-буфера).
5. Shadow tint (фиксированная сила 0.2).
6. Color bleed.
7. linear → sRGB.
8. Contrast (pivot 0.5).
9. Saturation.
10. Base fog blend (0.03).
11. **Film WB** — температура/тинт (отдельный от RAW WB; см. ниже).
12. Cross-process.
13. **Film shadows/highlights** — PoC-математика (LUMA_COEFF 0.2126, квадратичные маски).
14. Blend по силе: `mix(color_in, c, film_strength)`.

### Два баланса белого

Их два, и они не взаимозаменяемы:

- **RAW WB** — нативный RapidRAW, работает в linear scene-referred пространстве
  до тон-маппера, меняет баланс каналов на уровне первичной обработки.
- **Film WB** (`filmTemp`, `filmTint`) — внутри `apply_film_look`, поверх готовой
  картинки. Математика: `t = (K − 6500)/100 · 0.01; r *= 1+t; b *= 1−t` и
  `m = (tint/50) · 0.18; r *= 1+m; g *= 1−m; b *= 1+m`.

### Пространственный пост-проход

Blur эмульсии и хроматическая аберрация — отдельный шейдер
`src-tauri/src/shaders/film_post.wgsl`, выполняется после основного прохода:

1. Горизонтальный blur (`tile_output → ping_pong`) существующим blur-пайплайном.
2. Вертикальный blur (`ping_pong → film_blur`), `tile_offset = 0`.
3. `film_post`: радиальная CA (`off_px = d_px · chroma · 0.02`, центр в tile-local
   координатах) + конверсия rgba16f → rgba8unorm.

`film_post` читает из `film_blur`, если blur > 0, иначе из `tile_output`.
Результат (`graded_tile_texture` / `film_post_texture`) подменяет `tile_output`
и в display-copy, и в CPU-readback — поэтому эффект попадает и в экспорт.

#### Тайлинг

Основной проход в RapidRAW тайловый (`TILE_SIZE = 2048`, `TILE_OVERLAP = 128`).
Пост-проход делается per-tile, поэтому швов нет.

**Краевой фикс:** `BlurParams._pad1` переиспользован как `clamp_x_max`
(`u32::MAX` для input-blur, `input_width − 1` для film-blur). Horizontal-проход
blur.wgsl клампит по `min(full_dims.x − 1, clamp_x_max)` — без этого на краю кадра
подмешивался мусор из stale-области max_tile_size-текстур. `film_post` клампит по
`clamp_w`/`clamp_h` (struct `FilmPostParams {chroma, center_x, center_y, clamp_w,
clamp_h, _pad×3}`, 32 байта).

## Полный набор параметров

UI-ключи — из `FilmAdjustment` (`src/utils/adjustments.ts`); uniform — поля
`GlobalAdjustments` (shader.wgsl + зеркало в `image_processing.rs:1247`, bytemuck Pod).
Scale — делитель при парсинге (`get_val(section, key, scale, default)`), все
film-параметры гейтятся видимостью секции `"film"`.

| UI-ключ | Uniform | Scale | Диапазон UI | Default |
|---|---|---|---|---|
| filmProfile | — (patch) | — | dropdown / off | off (strength 0) |
| filmStrength | film_strength | — | 0–100 | 0 |
| filmContrast | film_contrast | — | 50–150 | 100 |
| filmSaturation | film_saturation | — | 0–200 | 100 |
| filmRolloff | film_rolloff | — | 0–100 | 0 |
| filmBleed | film_bleed | — | 0–100 | 0 |
| filmCross | film_cross | — | 0–100 | 0 |
| filmTemp | film_temp | 1 | 3000–10000 (step 50) | 6500 |
| filmTint | film_tint | 1 | −100..100 | 0 |
| filmShadows | film_shadows | 1 | −100..100 | 0 |
| filmHighlights | film_highlights | 1 | −100..100 | 0 |
| filmBlur | film_blur | /100 | 0–100 | 0 |
| filmChroma | film_chroma | /200 | 0–100 | 0 |
| filmGrainAmount | film_grain_amount | /1000 | 0–100 | 0 |
| filmGrainSize | film_grain_size | /50 | 0–100 | 50 |

Blur: `sigma = v · 3 · scale`, `radius = ceil(sigma·2).clamp(1, 96)`.
Chroma: радиальное смещение `d_px · chroma · 0.02`.
Film grain: порт PoC-зерна — per-pixel fine grain (hash) + низкочастотный clump
(value-noise, частота `1/max(4, size·10)`), exposure-маска по яркости
(`clamp((1−|L−0.5|·2)·1.5, 0.3, 1.0)`), per-channel вариация ±0.3·amount.
Применяется в main-шейдере сразу после `apply_film_look`, **до** нативного зерна;
координаты делятся на `scale`, чтобы размер зерна на экране не зависел от превью.
Не масштабируется `film_strength`.

### Film grain vs native grain

Это **два независимых эффекта** с разными ключами и разной математикой:

- **Native grain** (секция Effects): ключи `grainAmount/Size/Roughness`, гейтинг
  `"effects"`, gradient-noise + roughness-mix, uniform `grain_amount/size/roughness`,
  применяется после кривых/LUT (`shader.wgsl`, блок `grain_amount > 0`).
- **Film grain** (секция Film): ключи `filmGrainAmount/Size`, гейтинг `"film"`,
  PoC-модель (см. выше), применяется сразу после `apply_film_look`.

Оба могут работать одновременно — тогда зерна честно складываются. Изначально
бегунки зерна в Film были зеркалом native-ключей (двигали один и тот же параметр) —
это исправлено: у Film теперь своё зерно.

### Union-гейтинг нативных эффектов

Vignette и halation — нативные инструменты RapidRAW (секция `"effects"`),
но показываются и внутри секции «Film». Чтобы они работали из обоих мест, парсинг
использует `get_val_any(&["effects", "film"], ...)`: параметр активен, если видима
хотя бы одна из секций. Затронуты: `vignette_amount/midpoint/roundness/feather`,
`halation_amount`. (Grain из этого списка убран — у Film своё зерно, см. выше.)

Нативная chromatic aberration (lens-инструмент в details) **не тронута** — film CA
живёт отдельно.

## Профили

`src/utils/filmProfiles.ts` — 6 стоковых профилей: Portra 400, Velvia 50, HP5,
Ektar 100, Tri-X, CineStill 800T. Значения взяты из PoC (включая blur/chroma).
LUT — natural-spline, 768 float (r,g,b interleaved, 256×3).

`filmProfilePatch` маппит профиль на UI-ключи:

- `blur / 3 · 100` → filmBlur
- `chroma / 0.5 · 100` → filmChroma
- `grainAmount · 1000` → filmGrainAmount (PoC 0.06 → UI 60)
- `grainSize · 50` → filmGrainSize (UI 50 == shader 1.0)
- `halation · 100` → halationAmount
- `vignette · −100` → vignetteAmount

Выбор «off» сбрасывает в `{ filmProfile: null, filmStrength: 0 }`.

## Uniform layout (правила)

`GlobalAdjustments` — bytemuck Pod, зеркалится вручную между Rust
(`image_processing.rs:1247`) и WGSL (shader.wgsl). Film-поля добавлены в конец:
`film_temp`, `film_tint`, `film_shadows`, `film_highlights`, `film_blur`,
`film_chroma`, `film_grain_amount`, `film_grain_size` (два f32-пада
`_pad_film5/6` позже заменены на grain-поля — размер struct'а не изменился).

**При добавлении полей:** держать Rust-struct и WGSL-struct в синхроне, дополнять
padding'ом до кратности 16. Layout проверяется тестом (см. ниже) — если struct'ы
разъедутся, тест упадёт.

## UI

`src/components/adjustments/Film.tsx` — секция «Film» (i18n: en "Film", ru «Плёнка»),
рендерится через ControlsPanel после Effects, по умолчанию свёрнута. В MasksPanel
отфильтрована (global-only). Группы контролов:

- **Stock + Look** — профиль, strength, contrast, saturation, rolloff, bleed, cross.
- **White Balance** — filmTemp, filmTint.
- **Tone** — filmShadows, filmHighlights.
- **Grain** — filmGrainAmount/filmGrainSize (своё PoC-зерно, не native).
- **Halation** — нативный amount.
- **Vignette** — нативный amount.
- **Emulsion** — filmBlur, filmChroma.

Регистрация в `adjustments.ts`: enum `FilmAdjustment` (18 ключей), поля в интерфейсе
`Adjustments`, `INITIAL`, `ADJUSTMENT_SECTIONS.film`, `ADJUSTMENT_GROUPS.film`
(label `modals.copyPaste.groups.film`), sanitize в `applyLoadedAdjustments`.

i18n: `adjustments.effects.film*`, `filmBlur`, `filmEmulsion`, `tone`,
`whiteBalance` (en/ru), `editor.adjustments.sections.film`.

## Отклонения от PoC

- **Halation threshold** не выставляется — используется нативный адаптивный cutoff.
- **Chroma** сэмплит уже размытую текстуру (в PoC chroma применялась до blur) —
  разница negligible.
- **Spatial-эффекты** (blur, chroma) не масштабируются `film_strength`.
- **RAW primary processing** исключён — плёнка поверх нативного пайплайна.

## Карта файлов

- `src-tauri/src/shaders/shader.wgsl` — `apply_film_look`, uniform-struct.
- `src-tauri/src/shaders/film_post.wgsl` — blur+CA пост-проход.
- `src-tauri/src/shaders/blur.wgsl` — краевой фикс (`clamp_x_max`).
- `src-tauri/src/image_processing.rs` — Pod-struct, парсинг, `get_val_any`, тесты.
- `src-tauri/src/gpu_processing.rs` — film_post пайплайн, текстуры, per-tile пост-проход.
- `src/utils/adjustments.ts` — ключи, секции, группы, sanitize.
- `src/utils/filmProfiles.ts` — профили + `filmProfilePatch`.
- `src/components/adjustments/Film.tsx` — UI секции.
- `src-tauri/src/film_grain.rs` — IPOL-рендер зерна + общий загрузчик
  `load_processed_for_grain` для офлайн grain-рендеров.
- `src-tauri/src/crystal_grain.rs` — кристаллографический синтез зерна (Pierre).

## Физический рендер зерна (IPOL 2017)

Отдельно от процедурного film grain есть офлайн-рендер по статье Newson et al.
«Realistic Film Grain Rendering» (IPOL 2017, GPL V3+ — совместимо с AGPLv3 проекта):
Boolean-модель стохастической геометрии — центры зёрен бросаются Пуассоновским
процессом с интенсивностью, зависящей от яркости (`lambda(u)`), радиусы const или
log-normal; каждый выходной пиксель — Monte-Carlo оценка вероятности покрытия
зерном. Изображение **перерендеривается сквозь эмульсию**, а не зашумляется:
для константного u матожидание выхода ровно u (проверено тестом).

- `src-tauri/src/film_grain.rs` — порт pixel-wise алгоритма (PRNG wang-hash +
  xorshift портирован бит-в-бит, есть known-answer тест против референсного
  C++-бинаря), rayon-параллелизм, по одному независимому полю зерна на канал
  (три слоя эмульсии).
- Отклонения от референса: jitter детерминирован per-pixel (в C++ — недетерминированный
  mt19937 и двойное применение sigmaFilter); grain-wise алгоритм не портирован;
  off-by-one в lambdaList C++ исправлен.
- Команда `render_film_grain(path, adjustments, options, preview)` — полный пайплайн
  (загрузка → GPU-обработка с текущими коррекциями → grain по каналам →
  `<stem>_Grain.png` рядом с оригиналом + `.rrexif`). Procedural grain
  (native + PoC) на этом проходе отключается. События `film-grain-progress` /
  `film-grain-complete` / `film-grain-preview`.
- **Preview-режим** (`preview: true`): центральный 1:1 кроп (max 1200×800) в
  нативном разрешении — единственно честное превью для пиксельной текстуры
  (downscale исказил бы соотношение зерна и деталей). Результат летит в
  `film-grain-preview` как data URL, файл не сохраняется.
- UI: группа «Physical Grain (IPOL)» в секции Film — 4 крутилки
  (Grain Radius `muR` 0.05–2, Radius Variation `sigmaR` 0–1, Softening
  `sigmaFilter` 0–2, Quality `nMonteCarlo` 25–800) + кнопки Preview и
  Render & Save. Параметры живут в локальном состоянии панели (рендер —
  одноразовое действие, не adjustment).
- Скорость: ~0.3 с на 0.2 МП при 100 MC; 24 МП — порядка минуты. Не realtime,
  поэтому это явное действие, а не adjustment.
- **Monochrome-режим** (`monochrome: true`, тоггл «Monochrome (single field)»):
  одно общее поле зерна рендерится из luma (Rec.709) и переносится на каналы
  как hue-preserving gain (`out_ch = in_ch · L'/L`, общий `apply_mono_grain`).
  ×3 быстрее и правильная модель для ЧБ (один слой галогенида, без dye clouds).
  Helpers `luma_plane`/`apply_mono_grain` общие для IPOL и Pierre.
- Проверка: `cargo test --lib film_grain` (4 теста), example
  `cargo run --example film_grain_check --release -- <in.png> [out] [mu_r] [n_mc]`.
  Референсный C++-код — `scratch/ipol192/`.

## Кристаллографический синтез зерна (Pierre 2023)

Второй офлайн-рендер зерна, рядом с IPOL (не взамен) — порт статьи Aurélien
Pierre «Stochastic photographic grain synthesis from crystallographic
structure simulation» (2023, eng.aurelienpierre.com). Модель: эмульсия —
стек из N элементарных слоёв кристаллов; на каждом слое бросается **одна**
случайная форма кристалла (правильный полиэдр: 3–10 вершин по гауссу,
log-normal размер, случайный поворот), яркость I/N раздаётся «зародышам»,
посаженным порогованием гауссовой СВ (порог через erfinv даёт точную
поверхностную плотность с учётом размера кристалла — эмпирический фиттинг
`filling_to_rand_variable`), затем зародыши «выращиваются» свёрткой с
ненормированным ядром кристалла (convolution, symm-границы), перекрытия
клиппятся для сохранения энергии. Слои суммируются, экспозиция выравнивается
по среднему (`coef = mean(I)/mean(result)`), и применяется printing model:
`out = (1-I)·grainy + I²` — в чисто белом зерна нет (негатив там непрозрачен).

- `src-tauri/src/crystal_grain.rs` — весь порт: erfinv (аппроксимация Giles),
  `create_crystal` (растеризация полиэдра по полярному уравнению; f64-математика
  ядра, known-answer тест по битовой маске 11×11 из статьи), `pick_crystal`,
  свёртка (rayon по строкам), per-channel RGB (3 декоррелированных поля).
- Отличия от Python-референса: вся случайность детерминирована (xorshift PRNG
  из `film_grain.rs`, seed per-layer/per-row) — рендеры бит-в-бит
  воспроизводимы; посев зёрен распараллелен по строкам; `value` клиппится в
  (0.001, 0.999) перед erfinv (scipy возвращал ±inf вне домена).
- Команда `render_crystal_grain(path, adjustments, options, preview)` — тот же
  каркас, что у IPOL (общий `load_processed_for_grain`, процедурные зёрна
  отключаются на проходе), события `crystal-grain-progress/preview/complete`,
  результат — `<stem>_XtalGrain.png` + `.rrexif`. Preview — центральный 1:1
  кроп 1200×800, data URL.
- UI: группа «Crystal Grain (Pierre)» в секции Film — Filling Ratio
  (`filling` 0.05–0.8, реальные эмульсии 0.15–0.5; Ilford 1960s ≈ 0.15),
  Grain Size (`size` 1–15 px), Emulsion Layers (`layers` 5–60; B&W 20–30,
  больше слоёв — зерно размывается), Size Variation (`std` 0–2, log-normal σ;
  больше — более «хлопьевидная» текстура) + Preview / Render & Save.
- Скорость: ~0.2–0.4 с на 1 МП при 30 слоях (size 3–5) — заметно быстрее
  IPOL; 24 МП — порядка минуты. Зерно структурное (видна форма кристаллов),
  в отличие от гауссова шума Lightroom-подобных реализаций.
- **Monochrome-режим** (`monochrome: true`, тоггл «Monochrome (single field)»):
  один общий стек эмульсии из luma, перенос на каналы hue-preserving gain'ом
  (общий `apply_mono_grain` из `film_grain.rs`). ×3 быстрее, правильная
  модель для ЧБ.
- Проверка: `cargo test --lib crystal_grain` (7 тестов, включая known-answer
  по ядру кристалла и сохранение средней яркости), example
  `cargo run --example crystal_grain_check -- <in.png> [out] [filling] [size] [layers] [std]`.

## Realtime-превью кристаллического зерна (bake-and-sample)

Офлайн-рендер Pierre остаётся эталоном для экспорта, но для интерактива есть
realtime-режим, основанный на линеаризации модели: в рабочем диапазоне
значения зёрен (`u/N`), свёртка и клиппинг перекрытий линейны по локальной
яркости `u`, поэтому `result = u·D(x)` — доля покрытия `D` не зависит от
изображения. Единственная нелинейность (истощение headroom в светах) живёт
там, где printing model зерно всё равно гасит.

- **Bake**: `bake_grain_field()` в `crystal_grain.rs` рендерит плоское поле
  `u=0.5` через `apply_crystal_grain_rgb` (3 декоррелированных поля),
  извлекает `G = (out − u²)/((1−u)·u) = 4·out − 1`, нормирует каждый канал
  на mean=1 (сохранение средней яркости становится численно точным) и пакует
  в RGBA16F (G ∈ [0, 32]). Тайл 1024² (`GRAIN_FIELD_TILE`), ~0.5–1 с на CPU.
- **Команда** `bake_crystal_grain_field(options)` — bake на CPU → upload
  RGBA16F текстуры в `GpuContext.crystal_grain_view` → событие
  `crystal-grain-baked`. До первого bake'а используется dummy 1×1 (G=1,
  no-op) из `GpuProcessor`.
- **GPU**: film post-pass (`film_post.wgsl`) получил binding(3) с полем G;
  `FilmPostParams` — `origin_x/y` (тайл в координатах изображения),
  `grain_amount`, `grain_tile`, `grain_mono`. Сэмплинг по глобальным
  пиксельным координатам с mirrored wrap (numpy `symm`) — швы между тайлами
  и повтор тайла незаметны (стационарное случайное поле). Формула на пиксель:
  `out = u² + (u−u²)·G` — мультипликативное зерно + printing model, ~10 ALU
  + 1 fetch. Mono — одно поле на luma с hue-preserving gain; color — три
  поля поканально. `film_post_active` теперь включается и по
  `crystal_grain_amount > 0`.
- **Adjustments**: `crystalGrainAmount` (0..100 → 0..1, strength-mix) и
  `crystalGrainMono` (0/1) — поля `crystal_grain_amount/mono` в
  `GlobalAdjustments` (layout-тест на sync Rust↔WGSL).
- **UI**: подблок «Realtime Preview» в группе Crystal Grain — Amount +
  Monochrome. Параметры кристаллов (filling/size/layers/std) общие для
  realtime и офлайна; их изменение триггерит debounce-bake (400 мс),
  событие `crystal-grain-baked` пинает ре-рендер.
- **Ограничения**: превью ≠ пиксель-в-пиксель офлайн-рендеру (линеаризация,
  фиксированный тайл); для финального файла — Render & Save. IPOL-зерно
  realtime не получило (его Boolean-модель так не линеаризуется).

## Тестирование

Layout- и shader-тесты — `mod film_layout_tests` в `image_processing.rs`:

- `main_shader_validates` — naga-валидация shader.wgsl.
- `aux_shaders_validate` — blur.wgsl + film_post.wgsl.
- `global_adjustments_layout_matches_wgsl` — размер Rust-struct == WGSL-struct
  (через naga Layouter).

```bash
cd src-tauri && cargo test --lib film_layout_tests
```

Ожидаемо: 3/3 зелёные. Полная проверка фронтенда:

```bash
npm run build   # vite build — реальный gate; tsc сломан апстримом, игнорировать
```

Ручной прогон: `npm start` (`tauri dev`), открыть RAW, раскрыть секцию Film,
выбрать профиль. Первая cargo-сборка 2–4 минуты — не убивать rustc.
