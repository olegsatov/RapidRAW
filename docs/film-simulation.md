# Симуляция плёнки в RapidRAW: зерно и пост-проход

Документ описывает живущие в форке движки зерна (IPOL, Pierre, realtime
bake-and-sample), film post-pass и правила layout'а uniform-буфера. Цветовое
ядро плёночного вида (flim, `tonemapper_mode == 2`) — отдельный документ:
`docs/film-look-engine.md`.

**История.** Модуль начинался как порт грейда из Krea Web PoC
(`apply_film_look`: LUT-кривые красителей, rolloff, bleed, cross-process,
профили плёнок, blur эмульсии). После перехода на flim-ядро весь этот модуль
был мёртв (UI удалён раньше, `film_strength` захардкожен в 0) и **удалён
целиком 2026-07-16**: обе шейдерные копии `apply_film_look`, uniform-поля
`film_*` (включая 4 КБ `film_curves` в каждом аплоаде adjustments),
`parse_film_curves`, пост-проходный blur эмульсии и дубль flim-функций в
`pre_tone.wgsl`. При необходимости — смотреть в git-истории.

## Место в пайплайне

- **Галация** — в `pre_tone.wgsl` (до тон-маппера, linear light,
  двухкомпонентная PSF: core = clarity blur r≈8, tail = structure blur r≈40,
  пороги в стопах над 0.18, красно-оранжевый хвост). Во flim-режиме ореол
  проходит через develop — см. `docs/film-look-engine.md`.
- **flim** — в `shader.wgsl` main при `tonemapper_mode == 2`, заменяет
  тон-маппер (scene-referred linear → sRGB).
- **Film post-pass** (`src-tauri/src/shaders/film_post.wgsl`) — per-tile,
  после основного прохода: crystal grain (bake-and-sample, см. ниже) +
  конверсия rgba16f → rgba8unorm. Запускается только при
  `crystal_grain_amount > 0`. Результат (`film_post_texture`) подменяет
  `tile_output` и в display-copy, и в CPU-readback — поэтому попадает и в
  экспорт. Тайлинг общий (`TILE_SIZE = 2048`, `TILE_OVERLAP = 128`), швов
  нет; `film_post` клампит координаты по `clamp_w`/`clamp_h` (struct
  `FilmPostParams`).

### Зерно: три независимых движка

- **Native grain** (секция Effects): ключи `grainAmount/Size/Roughness`,
  гейтинг `"effects"`, gradient-noise + roughness-mix, применяется после
  кривых/LUT в `shader.wgsl`. Upstream, не тронут.
- **Crystal grain** (таб Film): realtime bake-and-sample + офлайн-рендер
  (см. разделы ниже).
- **IPOL grain** (таб Film): офлайн Boolean-модель (см. раздел ниже).

### Union-гейтинг нативных эффектов

Halation — нативный инструмент RapidRAW (секция `"effects"`), показывается и
внутри таба Film. Чтобы он работал из обоих мест, парсинг использует
`get_val_any(&["effects", "film"], ...)`: параметр активен, если видима хотя
бы одна из секций. Затронут только `halation_amount`. (Native grain в
union-гейтинг не входит.)

## Uniform layout (правила)

`GlobalAdjustments` — bytemuck Pod, зеркалится вручную между Rust
(`image_processing.rs`, `pub struct GlobalAdjustments`) и **обоими** WGSL
(`shader.wgsl` и `pre_tone.wgsl` — оба биндят один и тот же uniform-буфер).

**Подводный камень layout'а:** naga считает `vec3/vec4` 16-выравниванием, а
Rust bytemuck пакует плотно. Перед каждым `vec3`-полем (например
`bw_weights`) число scalar-полей должно давать 16-байтную границу — иначе
нужен явный пад.

**При добавлении полей:** держать Rust-struct и оба WGSL-struct в синхроне,
дополнять padding'ом до кратности 16. Layout проверяется тестом
`global_adjustments_layout_matches_wgsl` (размер Rust-struct == размеру
struct в обоих WGSL; зеркало `pre_tone.wgsl` однажды молча потеряло поле —
офсеты удержались только на выравнивании).

## UI

Таб Film (`FilmPanel.tsx`, см. `docs/film-look-engine.md`) хостит:
flim-пресеты/Look/Advanced, B&W, зерно (`Grain.tsx` — IPOL + Crystal с
подблоком Realtime Preview), Halation (нативный amount, общий с Effects),
pre-tone diffusion/soft blur эмульсии. Мастер-гейт: `toneMapper == "flim"`
AND-ится с видимостью секций film/blackAndWhite/grain в
`get_global_adjustments_from_json` — выключение панели гасит flim-look,
зерно и B&W и в превью, и в экспорте (общий кодовый путь, включая CPU-зерно
на экспорте — `flim_panel_on`).

## Физический рендер зерна (IPOL 2017)

Первый из двух физических рендеров зерна — офлайн-рендер по статье Newson et al.
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
  `<stem>_Grain.png` рядом с оригиналом + `.rrexif`). Native grain (Effects)
  на этом проходе отключается. События `film-grain-progress` /
  `film-grain-complete` / `film-grain-preview`.
- **Preview-режим** (`preview: true`): центральный 1:1 кроп (max 1200×800) в
  нативном разрешении — единственно честное превью для пиксельной текстуры
  (downscale исказил бы соотношение зерна и деталей). Результат летит в
  `film-grain-preview` как data URL, файл не сохраняется.
- UI: группа «Physical Grain (IPOL)» в `Grain.tsx` — 4 крутилки
  (Grain Radius `muR` 0.05–2, Radius Variation `sigmaR` 0–1, Softening
  `sigmaFilter` 0–2, Quality `nMonteCarlo` 25–800) + кнопки Preview и
  Render & Save. Параметры персистятся в sidecar (`ipolGrainMuR/...`).
- Скорость: ~0.3 с на 0.2 МП при 100 MC; 24 МП — порядка минуты. Сложность
  `O(nMC·(max_radius/ag)²)`: `sigma_r` взрывает `max_radius = r·e^{3.09σ}`,
  поэтому одновременные максимумы (muR=2, sigmaR=1, 800MC) — это ~1000× к
  дефолтной стоимости (часы на 24 МП). Не realtime, поэтому это явное
  действие, а не adjustment.
- **Monochrome-режим** (`monochrome: true`, тоггл «Monochrome (single field)»):
  одно общее поле зерна рендерится из luma (Rec.709) и переносится на каналы
  как hue-preserving gain (`out_ch = in_ch · L'/L`, общий `apply_mono_grain`).
  ×3 быстрее и правильная модель для ЧБ (один слой галогенида, без dye clouds).
  Helpers `luma_plane`/`apply_mono_grain` общие для IPOL и Pierre.
- Проверка: `cargo test --lib film_grain`, example
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
  свёртка (`convolve_same_symm`, rayon по строкам; interior-пиксели идут без
  `mirror()` — fast-path, граничные через scipy-'symm' отражение),
  per-channel RGB (3 декоррелированных поля).
- Отличия от Python-референса: вся случайность детерминирована (xorshift PRNG
  из `film_grain.rs`, seed per-layer/per-row) — рендеры бит-в-бит
  воспроизводимы; посев зёрен распараллелен по строкам; `value` клиппится в
  (0.001, 0.999) перед erfinv (scipy возвращал ±inf вне домена).
- Команда `render_crystal_grain(path, adjustments, options, preview)` — тот же
  каркас, что у IPOL (общий `load_processed_for_grain`, native grain
  отключается на проходе), события `crystal-grain-progress/preview/complete`,
  результат — `<stem>_XtalGrain.png` + `.rrexif`. Preview — центральный 1:1
  кроп 1200×800, data URL.
- UI: группа «Crystal Grain (Pierre)» в `Grain.tsx` — Filling Ratio
  (`filling` 0.05–0.8, реальные эмульсии 0.15–0.5; Ilford 1960s ≈ 0.15),
  Grain Size (`size` 1–15 px), Emulsion Layers (`layers` 5–60; B&W 20–30,
  больше слоёв — зерно размывается), Size Variation (`std` 0–2, log-normal σ)
  - Preview / Render & Save. Параметры персистятся в sidecar
    (`crystalGrainFilling/Size/Layers/Std`).
- Скорость: ~0.2–0.4 с на 1 МП при 30 слоях (size 3–5) — заметно быстрее
  IPOL; 24 МП — порядка минуты. Зерно структурное (видна форма кристаллов).
- **Monochrome-режим** (`monochrome: true`): один общий стек эмульсии из
  luma, перенос на каналы hue-preserving gain'ом (общий `apply_mono_grain`
  из `film_grain.rs`). ×3 быстрее, правильная модель для ЧБ.
- Проверка: `cargo test --lib crystal_grain`, example
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
  в RGBA16F (G ∈ [0, 32] — реально [0, 2], запас чистый) — **один буфер на
  mip-уровень** (1024→1, box 2×2). Box-mip — это в точности фильтр усреднения
  при даунскейле, поэтому mip эмулирует поведение зерна при уменьшении
  картинки. Тайл 1024² (`GRAIN_FIELD_TILE`), ~0.5–1 с на CPU.
- **Команда** `bake_crystal_grain_field(options)` — bake на CPU → upload
  RGBA16F текстуры в `GpuContext.crystal_grain_view` → событие
  `crystal-grain-baked`. До первого bake'а используется dummy 1×1 (G=1,
  no-op) из `GpuProcessor`. Поле — `Arc<Mutex<Option<TextureView>>>`:
  GpuProcessor клонирует GpuContext при создании, поэтому plain-поле
  замирало бы в None. **Last-wins семантика** (`BAKE_GENERATION`,
  AtomicU64): драг слайдеров запускает перекрывающиеся bake'и (debounce
  400 мс против ~1 с bake'а); публикует текстуру и эмитит событие только
  самый свежий запрос, устаревшие результаты молча выбрасываются.
- **GPU**: film post-pass (`film_post.wgsl`) получил binding(4) с полем G
  (mipmapped, filterable) и binding(5) — sampler (linear + mirror-repeat);
  `FilmPostParams` — `origin_x/y` (тайл в координатах изображения),
  `grain_amount`, `grain_tile`, `grain_mono`, `grain_level`,
  `grain_coord_scale` (full-res px на px рендера). Сэмплинг
  `textureSampleLevel` по глобальным пиксельным координатам в full-res
  единицах. Формула на пиксель: `out = u² + (u−u²)·G` — мультипликативное
  зерно + printing model. Mono — одно поле на luma с hue-preserving gain;
  color — три поля поканально. `film_post_active` = `crystal_grain_amount > 0`.
- **Zoom-aware зерно (mip-level + full-res координаты)**: baked-поле запечено
  в единицах **full-res пикселей** (экспорт сэмплит его 1:1), поэтому превью
  обязано сэмплить его в координатах изображения, а не рендера:
  `RenderRequest.grain_coord_scale` = full-res px на px рендера
  (`1/effective_scale`; 1.0 для full-res путей), в шейдере
  `uv = (origin + coord) · coord_scale / tile`. Без этого паттерн зерна
  растягивался вместе с даунскейлом рендера и mip-усреднение давало кляксы.
  `RenderRequest.grain_mip_level` — уровень mip, соответствующий **экранному**
  масштабу: фронтенд вычисляет
  `max(0, log2(max(originalSize) / max(displaySize)))` (`displaySize` включает
  текущий зум) и передаёт его параметром `grainMipLevel` в `apply_adjustments`
  (`PreviewJob.grain_mip_level: Option<f32>`; `None` → legacy-расчёт
  `log2(full/render)` из даунскейла рендера). mip считается именно по экрану,
  потому что wgpu-блит превью на канвас не усредняет зерно достаточно.
  **Static preview + зерно**: пока `crystalGrainAmount > 0`,
  `calculateTargetRes` работает как в dynamic-режиме (рендер ≥ экран×1.25,
  но не ниже выбранного static-разрешения) — иначе апскейл 1920px-рендера
  алиасит зерно. Re-render при изменении зума: эффект в
  `useImageProcessing` на изменение `displaySize` (debounce 200 мс) бампит
  `renderGeneration` — **только если `crystalGrainAmount > 0`** (без зерна
  рендер от размера экрана не зависит, лишний проход не нужен). Экспортные/
  служебные пути передают mip 0 + coord_scale 1.0 (full-res). **Галерея**
  (`generate_thumbnail_data`): mip и coord_scale из `total_scale` — зерно как
  экспорт при том же размере.
- **Adjustments**: `crystalGrainAmount` (0..100 → 0..1, strength-mix) и
  `crystalGrainMono` (0/1) — поле `crystal_grain` (vec4) в
  `GlobalAdjustments`.
- **UI**: подблок «Realtime Preview» в группе Crystal Grain — Amount +
  Monochrome. Параметры кристаллов (filling/size/layers/std) общие для
  realtime и офлайна; их изменение триггерит debounce-bake (400 мс),
  событие `crystal-grain-baked` пинает ре-рендер (listener в
  `useTauriListeners` → `renderGeneration++`).
- **Экспорт учитывает Amount**: `CrystalGrainOptions.amount` (0..1, serde
  default 1.0) — после `apply_crystal_grain_rgb` команда
  `render_crystal_grain` делает `mix(clean, clamp(grained, 0..1), amount)`
  (`mix_grain_amount`), тот же blend, что в шейдере, поэтому сохранённый
  файл совпадает с превью по силе зерна. Amount не участвует в bake —
  поле G всегда full-strength, mix выполняется на стороне шейдера/экспорта.
  UI: при `crystalGrainAmount = 0` (realtime выключен) экспорт идёт с
  полной силой (старое поведение), иначе — со значением слайдера.
- **Ограничения**: превью ≠ пиксель-в-пиксель офлайн-рендеру (линеаризация,
  фиксированный тайл); для финального файла — Render & Save. IPOL-зерно
  realtime не получило (его Boolean-модель так не линеаризуется). Monochrome —
  единый тоггл для realtime и экспорта (`crystalGrainMono`; экспорт передаёт
  его как `options.monochrome`). Нативное зерно секции Effects (`grainAmount`)
  — отдельный upstream-движок, тоггл на него не распространяется. **Масштаб/зум**: зерно
  сэмплится с mip-уровнем под текущий **экранный** зум (см. выше), поэтому
  уменьшенное превью показывает усреднённое зерно как экспорт при том же
  просмотре; форму кристаллов разглядеть можно только на 100%, но общее
  впечатление от зерна корректно при любом зуме.

## Зерно при штатном экспорте

В панели экспорта есть блок **Grain**: галочка «Add film grain», выбор режима
и галочка «B&W noise». `ExportSettings` получил `grain_enabled`,
`grain_mode` (`fast` | `pierre` | `ipol`) и `grain_mono` — всё с
`#[serde(default)]`, старые вызовы трактуются как «без зерна».

- **fast (WYSIWYG)**: GPU-проход сэмплит baked-поле. Параметры зерна
  персистятся в sidecar (`crystalGrainFilling/Size/Layers/Std`,
  `ipolGrainMuR/SigmaR/SigmaFilter/MonteCarlo`), поэтому экспорт воспроизводит
  настройки из sidecar даже без открытого редактора. Bake делается на экспорте
  по требованию: `get_export_grain_view()` (export_processing.rs) печёт поле
  через `bake_grain_field` → `upload_grain_field` и кеширует по
  `bake_cache_key(opts)` в `AppState.grain_bake_cache` (batch с одинаковыми
  параметрами печёт один раз). Текстура уезжает в `RenderRequest.grain_view` —
  per-request слот, который в film post-pass имеет приоритет над shared
  `context.crystal_grain_view` (гонок между параллельными export-джобами нет).
- **pierre / ipol (high quality)**: полный CPU-рендер модели
  (`apply_crystal_grain_rgb` / `apply_film_grain_rgb`) **после ресайза**
  экспорта, но с размерами зерна (`size`, `mu_r`, `sigma_r`, `sigma_filter`),
  умноженными на коэффициент ресайза — зерно выглядит как отрендеренное
  в full-res и уменьшенное вместе с картинкой (и рендер в 1/scale² раз
  дешевле full-res; `sigma_r` масштабируется вместе с `mu_r`, т.к. форма
  лог-нормали зависит от их отношения); watermark накладывается после зерна
  и остаётся чистым. GPU-проход при этом зерно не кладёт
  (`crystal_grain_amount = 0`), двойного зерна нет. Рендеры сериализованы
  через `AppState.grain_render_lock` (rayon и так грузит все ядра).
  Сила берётся из слайдера Amount (`crystalGrainAmount/100`) —
  `mix_grain_amount` тем же миксом, что и шейдер/офлайн-кнопки.
  **Amount 0 (или ключ отсутствует — картинку не редактировали) = зерна
  нет**, даже при включённой галочке экспорта (WYSIWYG: в превью его тоже
  не было); чтобы получить зерно, Amount задаётся в Film-панели.
  **Панель Film выключена (toneMapper ≠ flim) = зерна нет** — тот же гейт
  (`flim_panel_on`), что у превью и fast-пути.
- **B&W noise** (`grain_mono`): форсит общее (монохромное) поле на экспорте
  поверх редакторского `crystalGrainMono` (OR-семантика). Моно-поле
  накладывается как per-pixel luminance gain (`apply_mono_grain`,
  `out = in · L'/L`) — hue сохраняется, картинка остаётся цветной
  (тест `monochrome_grain_preserves_hue`).
- Параметры парсятся из sidecar через
  `crystal_grain::options_from_adjustments` /
  `film_grain::options_from_adjustments` (flat JSON, дефолты = дефолты
  моделей; старые sidecar без новых ключей работают).
- **Cube-экспорт и маски**: зерно принудительно выключено
  (`crystal_grain_amount = 0` в LUT-пути и в `export_masks_for_image`);
  `load_processed_for_grain` (офлайн-кнопки) рендерит базу с
  `ExportGrainMode::Off` — фикс латентного двойного зерна.

## Тестирование

Layout- и shader-тесты — `mod film_layout_tests` в `image_processing.rs`:

- `main_shader_validates` — naga-валидация shader.wgsl.
- `aux_shaders_validate` — blur.wgsl + pre_tone.wgsl + film_post.wgsl.
- `global_adjustments_layout_matches_wgsl` — размер Rust-struct == WGSL-struct
  в **обоих** шейдерах (через naga Layouter).
- `flim_advanced_keys_match_builtin_presets`,
  `flim_advanced_knob_math` — flim-пресеты/ручки (см. film-look-engine.md).
- `flim_shoulder_recalibration_offset` — перекалибровка бегунка Shoulder.
- `film_tab_modules_follow_panel_toggle` — мастер-гейт таба Film.
- `crystal_grain_follows_grain_section_and_engine` — гейты зерна.
- `flim_negative_black_point_reaches_uniform` — отрицательный black point
  пресета (nostalgia −5) доходит до uniform (регрессия: кламп в 0 резал
  фирменный подъём чёрного).

```bash
cd src-tauri && cargo test --lib film_layout_tests   # 9/9
cargo test --lib crystal_grain film_grain            # движки зерна
```

Полная проверка фронтенда:

```bash
npm run build   # vite build — реальный gate; tsc сломан апстримом, игнорировать
```

## Карта файлов

- `src-tauri/src/shaders/shader.wgsl` — flim-ядро (`tonemapper_mode == 2`),
  uniform-struct, нативное зерно.
- `src-tauri/src/shaders/pre_tone.wgsl` — галация (`apply_halation`,
  two-component PSF), pre-tone diffusion/soft blur эмульсии.
- `src-tauri/src/shaders/film_post.wgsl` — crystal grain пост-проход.
- `src-tauri/src/shaders/blur.wgsl` — краевой фикс (`clamp_x_max`).
- `src-tauri/src/image_processing.rs` — Pod-struct, парсинг, `get_val_any`,
  `compute_flim_uniforms`, тесты.
- `src-tauri/src/gpu_processing.rs` — film post-pass, текстуры, гейты
  входных blur'ов.
- `src/utils/adjustments.ts` — ключи, секции, группы, sanitize.
- `src/components/adjustments/Grain.tsx` — UI зерна (IPOL + Crystal).
- `src/components/panel/right/FilmPanel.tsx` — таб Film.
- `src-tauri/src/film_grain.rs` — IPOL-рендер зерна + общий загрузчик
  `load_processed_for_grain` для офлайн grain-рендеров.
- `src-tauri/src/crystal_grain.rs` — кристаллографический синтез зерна (Pierre)
  - bake-and-sample.
