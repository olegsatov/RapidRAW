# Архитектура RapidRAW

Общий обзор форка RapidRAW (`/Users/someone/Coding/RAW`, upstream — CyberTimon/RapidRAW).
Версия 1.5.9 (`src-tauri/tauri.conf.json:96`). Rust-крейт `RapidRAW`, lib `rapidraw_lib`,
edition 2024 (`src-tauri/Cargo.toml:2,9`). Все пути ниже — относительно корня репозитория;
якоря `file:line` указывают на верифицированные места в коде.

## Стек

- **Оболочка**: Tauri 2 (identifier `io.github.CyberTimon.RapidRAW`, `tauri.conf.json:3`).
- **Фронтенд**: React 18 + TypeScript + Vite + Tailwind v4, Zustand-сторы.
- **GPU**: wgpu (compute-шейдеры WGSL) — вся обработка изображений; опционально
  нативный wgpu-сурфейс для отображения.
- **RAW-декод**: форкнутый rawler — `https://github.com/CyberTimon/RapidRAW-DngLab.git`
  (`Cargo.toml:30`), не апстрим.
- **AI**: ONNX Runtime через `ort = "=2.0.0-rc.10"` (load-dynamic, `Cargo.toml:35`),
  dylib бандлится в `src-tauri/resources/libonnxruntime.*`.
- Прочее: `mimalloc` как глобальный аллокатор (`Cargo.toml:54`), release-профиль
  LTO + strip (`Cargo.toml:99-110`).

## Backend: карта модулей (`src-tauri/src/`)

| Модуль | Ответственность |
|---|---|
| `lib.rs` | Точка входа Tauri, регистрация 102 команд (`lib.rs:2290-2393`), preview worker, wgpu-display, HDR merge, коллажи |
| `image_loader.rs` | `load_image` — декод + кэш full-res, fallback на embedded JPEG |
| `raw_processing.rs` | `develop_raw_image` — декод RAW через форкнутый rawler |
| `gpu_processing.rs` | `GpuProcessor` — весь GPU-пайплайн: тайлы, blur, маски, display, readback |
| `image_processing.rs` | `AllAdjustments`/`GlobalAdjustments` (Pod), парсинг коррекций, auto-adjustments |
| `mask_generation.rs` | 14 типов суб-масок, combine-режимы, overlay, кэш битмапов |
| `export_processing.rs` | `export_images` — 6 форматов, метаданные, watermark, export_masks, batch+cancel |
| `file_management.rs` | 41 команда: файлы/папки, пресеты, альбомы, виртуальные копии, рейтинги, XMP sync |
| `exif_processing.rs` | Sidecar'ы `.rrdata`/`.rrexif`, запись EXIF |
| `ai_processing.rs` | ONNX-модели + инференс (SAM, U²Net, Depth Anything, LaMa, NIND, CLIP) |
| `ai_commands.rs`, `inpainting.rs`, `denoising.rs`, `tagging.rs`, `culling.rs` | Tauri-обёртки AI-фич |
| `ai_connector.rs` | HTTP-клиент к внешнему inpainting-middleware (generative replace — удалённо) |
| `cache_utils.rs` | Хэши (transform/visual/geometry/full-job), LRU-кэш декодированных изображений |
| `app_state.rs` | `AppState` — все in-memory кэши и каналы воркеров |
| `lut_processing.rs` | LUT: импорт, парсинг, превью |
| `lens_correction.rs`, `panorama_stitching.rs`, `negative_conversion.rs` | lensfun, панорамы, негативы |
| `formats.rs` | 30 RAW + 21 не-RAW расширений (`formats.rs:4-79`) |

## Загрузка и декод изображения

`load_image` (`image_loader.rs:720`):

1. Memory-map файла (`read_file_mapped`, fallback `fs::read`).
2. Проверка `decoded_image_cache` — LRU по пути, ёмкость из настройки
   `image_cache_size` (default 5, `lib.rs:2024`).
3. Отмена устаревших загрузок через generation-counter (`app_state.rs:167`).
4. RAW: `develop_raw_image` (`raw_processing.rs:15`) — `RawSource::new_from_slice`
   → `get_decoder` → `raw_image` + `raw_metadata`; ориентация из EXIF
   (`raw_processing.rs:72-77`) применяется через `apply_orientation`.
   SRGB-шаг rawler **удалён** (`raw_processing.rs:113-118`) — выход остаётся linear;
   white level rescale'ится к `u32::MAX` с кастомной компрессией светов (`:88-134`).
   Результат — `DynamicImage::ImageRgba32F`.
5. При ошибке RAW-декода — fallback на embedded JPEG preview (`image_loader.rs:144-171`).
6. Не-RAW: crate `image` (`load_image_with_orientation`, `image_loader.rs:339`).
7. На GPU пиксели идут как `to_rgba_f16` → `TextureFormat::Rgba16Float`
   (`gpu_processing.rs:2018-2038`).

## Поток коррекций → рендер

1. `useEditorStore.ts` держит `adjustments`; `useImageProcessing.ts:175` вызывает
   `ApplyAdjustments` с `{jsAdjustments, isInteractive, targetResolution, roi,
   computeWaveform, activeWaveformChannel}`.
2. Большие payload'ы (маски/патчи) отправляются один раз, затем нуллятся и
   ре-гидрируются на сервере из `patch_cache` (`useImageProcessing.ts:130-169`;
   `adjustment_utils.rs:47`).
3. `apply_adjustments` (`lib.rs:669`) ставит `PreviewJob` в канал выделенного
   **preview worker thread** (`lib.rs:634`); воркер забирает только последнюю задачу
   (`lib.rs:642-644`) — естественный debounce. Отдельный analytics-воркер шлёт
   события гистограммы/осциллограммы (`lib.rs:600`).
4. `process_preview_job` (`lib.rs:314`): transform-hash кэширование
   геометрически трансформированной базы (`CachedPreview`, `app_state.rs:47`),
   интерактивный downscale по `live_preview_quality` (`lib.rs:348-352`), маски через
   `get_cached_or_generate_mask`, затем
   `process_and_get_dynamic_image_with_analytics` с `RenderRequest { adjustments:
   AllAdjustments, mask_bitmaps, lut, roi }` (`gpu_processing.rs:24-29`).
   `AllAdjustments` = global + `[MaskAdjustments; MAX_MASKS]`
   (`image_processing.rs:1411-1417`).
5. **ROI**: нормализованный float ROI из фронтенда конвертируется в пиксели только
   в интерактиве (`lib.rs:432-441`); GPU рендерит только тайлы, пересекающие ROI
   (`gpu_processing.rs:1404-1424`). Ответ — 24-байтный заголовок (x,y,w,h,fullW,fullH)
   + JPEG, показывается как `interactivePatch` blob-overlay.
6. Результат: JPEG blob → `finalPreviewUrl` в сторе, **или** (если
   `use_wgpu_renderer`, default true, macOS/Windows — `lib.rs:342-345`) пиксели
   копируются в display-текстуру, возвращается маркер `"WGPU_RENDER"` и шлётся
   событие `wgpu-frame-ready` (`lib.rs:515-524`; слушатель —
   `useTauriListeners.ts:238`).

## GPU-пайплайн

- Основной проход — **тайловый** compute (TILE_SIZE grid, пересечение с ROI выше).
  Тайлинг позволяет обрабатывать большие RAW без упирания в лимиты текстур.
- Pre-passes (blur) и main pass живут в `GpuProcessor`; пайплайны/текстуры
  ресайзятся шагами по 256 px (`gpu_processing.rs:1921-1943`).
- Входная текстура кэшируется: `gpu_image_cache` — одна Rgba16Float текстура + view,
  ключ `transform_hash` + dims (`app_state.rs:57-63`; инвалидация/создание —
  `gpu_processing.rs:2008-2047`).
- **Маски на GPU**: CPU `GrayImage` битмапы пакуются в **R8Unorm texture array**
  (`gpu_processing.rs:1211-1247`), `mask_layer_count = len.clamp(2, MAX_MASKS)`,
  **MAX_MASKS = 32** (`image_processing.rs:1411`). Per-mask коррекции — в
  `AllAdjustments.mask_adjustments`. (Поле `mask_atlas_cols` существует, но атласа
  нет — похоже на vestigial.)
- **Display**: на macOS/Windows — нативный wgpu-сурфейс поверх главного окна
  (`instance.create_surface(window)`, `gpu_processing.rs:168-194`; `WgpuDisplay` +
  `display.wgsl`, рендер `gpu_processing.rs:57-135`; pan/zoom/clip приходит через
  `update_wgpu_transform`, `lib.rs:274`). Иначе — JPEG blob'ы рисует
  `ImageCanvas.tsx` (`components/panel/editor/ImageCanvas.tsx:1209`).

## Экспорт

`export_images` (`export_processing.rs:701`), пайплайн —
`process_image_for_export_pipeline` (`:277`):

1. `apply_all_transformations` — CPU warp/rotate/crop.
2. Full-res битмапы масок.
3. `process_and_get_dynamic_image` — GPU `GpuProcessor::run` с `roi: None` +
   CPU readback.
4. Resize / watermark (`:423`, `:100`).
5. Форматы (`:459-529`): **jxl** (lossless при q=100), **webp**, **jpg**, **png**
   (16-bit из float-источника), **tiff** (Rgb16), **avif**.
6. Метаданные: `save_image_with_metadata` (`:346`) →
   `exif_processing::write_image_with_metadata` (честит `keep_metadata`/`strip_gps`);
   опциональное сохранение timestamps из EXIF (`:335`, настройка
   `preserve_timestamps`).
7. `export_masks` — один дополнительный рендер на каждый слой маски с
   single-mask коррекциями (`:535-602`).
8. Batch + отмена через `export_task_handle` (`export_processing.rs:1052`);
   `estimate_export_sizes` (`:1065`).

## Маски

- `MaskDefinition` (id/name/visible/invert/opacity/adjustments/sub_masks) и `SubMask`
  (type/visible/invert/opacity/mode/parameters) — `mask_generation.rs:27-59`.
  Combine-режимы: Additive/Subtractive/Intersect (`:21-25`, применение `:1351-1370`).
- Типы суб-масок (dispatch `generate_sub_mask_bitmap`, `:1257-1317`): `radial`,
  `linear`, `brush`/`clone`/`heal`, `flow`, `color`, `luminance` (этим двум нужно
  warped-изображение), `ai-subject`, `ai-foreground`, `ai-sky`, `ai-depth`,
  `quick-eraser`, `all`. AI-маски предвычисляются ONNX-моделями и передаются
  base64-битмапами в parameters.
- Кэш битмапов: `mask_cache: HashMap<u64, GrayImage>` — ключ = хэш JSON маски
  (adjustments нуллятся) + dims/scale/crop offset; чистится при >50 записей
  (`mask_generation.rs:1459-1508`).
- `generate_mask_overlay` (`:1390`) — красный overlay PNG data-URL для UI.

## AI

ONNX через bundled dylib (`ORT_DYLIB_PATH` ставится на старте, `lib.rs:2054-2073`).
Модели — HuggingFace `CyberTimon/RapidRAW-Models`, pinned SHA256
(`ai_processing.rs:21-60`). `AiState` держит сессии + кэшированные embeddings/depth
(`ai_processing.rs:62-96`).

| Фича | Модель | Где |
|---|---|---|
| Subject segmentation | SAM ViT-B (encoder/decoder, point prompts) | `ai_processing.rs` |
| Foreground mask | U²Net | `ai_processing.rs` |
| Sky mask | skyseg-u2net | `ai_processing.rs` |
| Depth mask | Depth Anything V2 ViT-S | `ai_processing.rs` |
| Manual cleanup (inpainting) | LaMa fp16, локально | `inpainting.rs:17` |
| Generative replace | **внешний middleware** по HTTP (multipart JPEG + mask, bearer token) | `ai_connector.rs:57-116`, `inpainting.rs:305` |
| Denoise "ai" | NIND UNet | `denoising.rs:63` |
| Denoise (fallback) | CPU BM3D | `denoising.rs:24-49` |
| Tagging | CLIP zero-shot по `TAG_CANDIDATES`/`TAG_HIERARCHY` + эвристические `color:`-теги из HSV | `tagging.rs`, `tagging_utils/` |
| Culling | AI-assisted (`image_hasher`) | `culling.rs:182` |

Теги пишутся в sidecar'ы; индексация папок — фоновая (`start_background_indexing`,
`tagging.rs:251`).

## Кэширование

- Хэши (`cache_utils.rs`): `calculate_transform_hash` (orientation/rotation/flips/
  crop/geometry/AI patches, `:70`), `calculate_visual_hash` (`:47`),
  `calculate_geometry_hash` (`:28`), `calculate_full_job_hash` (path + full JSON,
  `:152`); список `GEOMETRY_KEYS` — `:8-26`.
- `DecodedImageCache` — LRU `Arc<DynamicImage>` + EXIF по пути (`:159-207`).
- В `AppState` (`app_state.rs:140-173`): `original_image`, `cached_preview`,
  `gpu_image_cache`, `gpu_processor`, `mask_cache`, `patch_cache`,
  `geometry_cache`, `full_warped_cache`/`full_transformed_cache`, `lut_cache`,
  `thumbnail_geometry_cache`.
- На диске: thumbnail cache в `$APPCACHE/thumbnails` (asset protocol scope,
  `tauri.conf.json:28`; очистка — `clear_thumbnail_cache`).
- Команды `clear_image_caches`/`clear_session_caches` (`cache_utils.rs:209,228`).

## Фронтенд

- `src/App.tsx` — `ClerkProvider` + `ContextMenuProvider`; `TitleBar`, слева
  `FolderTree`, центр — **`EditorView`** или **`LibraryView`**, справа — панель по
  `activeRightPanel`; менеджеры `ImageProcessingManager`/`ImageLoaderManager`
  драйвят эффекты.
- **Zustand-сторы** (`src/store/`):
  - `useEditorStore.ts` — выбранное изображение, adjustments JSON, история, превью
    (`finalPreviewUrl`, `interactivePatch`), гистограмма/осциллограмма, активные
    маски/патчи.
  - `useLibraryStore.ts` — корни/папки, деревья, альбомы, выделение.
  - `useSettingsStore.ts` — настройки приложения, тема, платформа.
  - `useUIStore.ts` — layout (ширины панелей, видимость, сворачивание секций,
    fullscreen, активная правая панель).
  - `useProcessStore.ts` — прогресс экспорта/каллинга/импорта.
- **Правая панель**: `RightPanelSwitcher.tsx` — `ControlsPanel`, `MasksPanel`,
  `CropPanel`, `AIPanel`, `PresetsPanel`, `MetadataPanel`, `ExportPanel`.
  `ControlsPanel.tsx:276` итерирует `ADJUSTMENT_SECTIONS` = `basic, curves, color,
  details, effects, film` (`utils/adjustments.ts:374-379`), рендеря
  `Basic/Curves/Color/Details/Effects/Film.tsx` + `Waveform`.

## Персистентность

- `settings.json` в `app_data_dir()` (`app_settings.rs:530-541`); `AppSettings`
  (`app_settings.rs:329`) — включая `enable_xmp_sync`/`create_xmp_if_missing`,
  `ai_connector_address`, экспорт-пресеты, UI state.
- `presets.json` (`file_management.rs:2668-2679`), `albums.json` (`:647-656`),
  `luts/` — в app data dir; `window_state.json` — в config dir (`lib.rs:2134-2135`);
  логи — app_log_dir.
- **Коррекции на изображение**: JSON-sidecar **`<filename>.rrdata`** рядом с файлом
  (`exif_processing.rs:1074-1076`; виртуальные копии — `<filename>.<id>.rrdata`).
  Читается `load_sidecar` (`exif_processing.rs:40`, с auto-heal раздутых sidecar'ов),
  пишется `save_metadata_and_update_thumbnail` (`file_management.rs:2207`).
  Второй sidecar `.rrexif` кэширует EXIF.
- **XMP sync** (если `enable_xmp_sync`): при чтении рейтинг/label/теги импортируются
  из `.xmp` в `.rrdata` (`sync_metadata_from_xmp`, `file_management.rs:3649`);
  при записи `sync_metadata_to_xmp` (`:3699`) regex-патчит
  `xmp:Rating`/`xmp:Label`/`dc:subject` (может создать skeleton XMP). Сами коррекции
  в XMP не идут — только rating/label/tags.

## Сборка и запуск

- `package.json`: `dev` (vite), `build`, `tauri`, **`start` = `tauri dev`**,
  `typecheck`, `lint`, `format`, i18n-команды (`package.json:5-18`).
- Tauri: `beforeDevCommand: npm run dev`, devUrl `http://localhost:1420`,
  frontendDist `../dist` (`tauri.conf.json:4-9`).
- Окно создаётся программно (`create: false`), 1280×720, min 800×600, transparent,
  без декораций, `macOSPrivateApi: true` (`tauri.conf.json:11-32`).
- Bundle resources: `resources` (libonnxruntime + лицензии) и `lensfun_db`
  (`tauri.conf.json:38`); file associations для всех RAW + распространённых
  форматов (`:40-89`).
- Внешних sidecar-процессов нет — только ONNX dylib.
- **Gate-сборка**: `npm run build` (vite build). `tsc` сломан апстримом —
  игнорировать. Первая cargo-сборка 2–4 минуты — не убивать rustc; cargo-watch
  в `tauri dev` пересобирает Rust при изменениях, транзиентные ошибки mid-edit —
  норма, важен финальный `Finished`.

## Caveats (не верифицировано)

- `mask_atlas_cols` — вероятно vestigial, атласа масок не найдено.
- `quick-eraser` и `flow` есть в dispatch, их UI-экспозиция не проверена.
- Внутренности `cull_images` (алгоритм сравнения) не изучались.
- `EditorView.tsx` делегирует канвас `ImageCanvas.tsx` — его внутренности не
  разбирались подробно.
