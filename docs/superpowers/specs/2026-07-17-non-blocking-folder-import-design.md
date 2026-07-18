# Спецификация: неблокирующий импорт папок с SQLite-каталогом

## Статус

Draft — ожидает ревью пользователя.

## Проблема

Сейчас добавление папки в библиотеку (`Open Folder`) блокирует приложение:

- `list_images_in_dir` / `list_images_recursive` (`src-tauri/src/file_management.rs:397,513`) — синхронные Tauri-команды, выполняются на главном потоке Rust. Пока идёт обход 10–50 тыс. файлов + `stat` + чтение сайдкаров, весь остальной IPC встаёт в очередь — нельзя открыть другое фото, нельзя работать в редакторе.
- `handleSelectSubfolder` (`src/hooks/useAppNavigation.ts:260`) ждёт один монолитный `invoke(...)`, нет событий прогресса, нет отмены.
- Затем `read_exif_for_paths` (`file_management.rs:316`) читает каждый RAW **целиком** в память и пишет `.rrdata`-сайдкар. На папке 10k RAW с медленного носителя — это сотни гигабайт лишнего I/O.
- Превью генерируются on-demand при скролле и конкурируют за тот же диск с листингом/EXIF.

## Цели

1. Импорт папки — фоновая job'а с прогрессом и отменой, приложение остаётся отзывчивым.
2. Можно работать с другими папками / фотографиями, пока импорт идёт.
3. Повторное открытие папки — мгновенно, без сетевого/дискового I/O.
4. Ручная синхронизация обновляет состояние папки с дельта-анализом.
5. Закладываем полноценный каталог на SQLite: схема сразу поддерживает все существующие фильтры, сортировки, поиск и теги, чтобы в будущем перенести `useSortedLibrary` на SQL-запросы.

## Out of scope

- Поток «Import files» (копирование файлов, `file_management.rs:3258`) — оставляем без изменений, кроме возможных небольших правок для единообразия событий, если понадобится.
- Файловый watcher: обновления подхватываются только при ручной синхронизации или повторном открытии папки из кэша.
- Перенос фильтрации/сортировки/поиска на SQL — отдельный этап после этой задачи. На первом этапе каталог заменяет источник `imageList`, а фильтрация остаётся клиентской, как сейчас.

## Архитектура

### Новые модули

| Файл | Назначение |
|------|------------|
| `src-tauri/src/library_db.rs` | Инициализация SQLite (`app_data_dir/library.db`), миграции, CRUD папок/файлов/тегов, дельта-синхронизация. Все вызовы — из `spawn_blocking`. |
| `src-tauri/src/folder_import.rs` | `ImportManager`, фоновая job'а, фазы, события, отмена. |
| `src/store/useFolderImportStore.ts` | Zustand-стор с состояниями job'ов и накопленными файлами. |
| `src/hooks/useFolderImport.ts` | API `openFolder`, `syncFolder`, `cancelFolderImport`; мост store → `imageList`. |
| `src/components/ui/ImportJobsIndicator.tsx` | Глобальный индикатор активных job'ов с прогресс-барами и отменой. |

### Хирургические правки shared-файлов

- `src/hooks/useAppNavigation.ts` — `handleSelectSubfolder` больше не делает монолитный `invoke(list_images_*)`, а вызывает `openFolder(...)` из нового хука.
- `src/hooks/useTauriListeners.ts` — подписки на события `folder-import-*` (файл уже в дельта-мапе форка).
- `src/App.tsx` — монтирование `<ImportJobsIndicator/>`; `handleLibraryRefresh` → `syncFolder`.
- `src/hooks/useAppInitialization.ts` — асинхронная проверка доступности каждой папки из `rootPaths` при старте; обновление состояния «онлайн/офлайн».
- Контекстное меню папки — пункты «Синхронизировать папку» и «Найти папку…».
- `src-tauri/src/app_state.rs` — добавить `folder_import_jobs: Arc<Mutex<HashMap<String, ImportJobHandle>>>` по образцу `export_task_handle`.
- `src-tauri/src/lib.rs` — регистрация команд `start_folder_import`, `sync_folder`, `cancel_folder_import`, `locate_folder`.

Старые команды `list_images_*` и `read_exif_for_paths` не удаляются — оставлены для совместимости с upstream.

## Схема каталога v1

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE folders (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL,
    recursive INTEGER NOT NULL,
    last_synced_at INTEGER,
    UNIQUE(path, recursive)
);

CREATE TABLE files (
    id INTEGER PRIMARY KEY,
    folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL COLLATE NOCASE,
    modified INTEGER,
    size INTEGER,
    sidecar_modified INTEGER,
    extension TEXT,
    is_raw INTEGER,
    is_edited INTEGER,
    is_virtual_copy INTEGER,
    is_cloud_placeholder INTEGER,
    rating INTEGER,
    flag INTEGER,
    color TEXT,
    exif_scanned INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL,

    date_taken TEXT,
    iso INTEGER,
    aperture REAL,
    shutter REAL,
    focal_length REAL,
    focal_length_35 REAL,
    make TEXT,
    model TEXT,
    lens_make TEXT,
    lens_model TEXT,
    orientation INTEGER
);

CREATE TABLE tags (
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    source TEXT NOT NULL,  -- 'user' | 'ai'
    PRIMARY KEY (file_id, tag)
);

-- Индексы
CREATE INDEX idx_files_folder ON files(folder_id);
CREATE INDEX idx_files_name ON files(name);
CREATE INDEX idx_files_modified ON files(modified);
CREATE INDEX idx_files_rating ON files(rating);
CREATE INDEX idx_files_flag ON files(flag);
CREATE INDEX idx_files_color ON files(color);
CREATE INDEX idx_files_is_raw ON files(is_raw);
CREATE INDEX idx_files_folder_exif_scanned ON files(folder_id, exif_scanned);
CREATE INDEX idx_files_folder_date_taken ON files(folder_id, date_taken);
CREATE INDEX idx_files_folder_iso ON files(folder_id, iso);
CREATE INDEX idx_files_folder_aperture ON files(folder_id, aperture);
CREATE INDEX idx_files_folder_shutter ON files(folder_id, shutter);
CREATE INDEX idx_files_folder_focal_length ON files(folder_id, focal_length);
CREATE INDEX idx_files_folder_make ON files(folder_id, make);
CREATE INDEX idx_files_folder_model ON files(folder_id, model);
CREATE INDEX idx_files_folder_lens_model ON files(folder_id, lens_model);
CREATE INDEX idx_tags_tag ON tags(tag COLLATE NOCASE);
```

### Почему именно такие столбцы

- `name` — сортировка по имени и текстовый поиск.
- `modified` / `size` / `sidecar_modified` — fingerprint для дельта-синхронизации (не перечитываем сайдкар, если не изменился).
- `is_raw` — фильтр RAW/non-RAW; вычисляется на момент скана по `supportedTypes` из настроек.
- `is_edited` — фильтр edited/unedited.
- `rating`, `flag` — фильтры по рейтингу и флагу.
- `color` — фильтр по цветовой метке; извлекается из тега `color:<name>` при скане.
- `exif_scanned` — флаг, по которому фаза 2 возобновляет/продолжает работу.
- `files.path` — абсолютный путь (с `?vc=...` для виртуальных копий), что позволяет при перемещении папки обновить все пути заменой префикса.
- `files.id` — стабильный идентификатор файла в каталоге; используется как часть ключа кэша превью (`blake3(file_id + mtime + adjustments)`), поэтому перемещение папки не инвалидирует кэш.
- `metadata_json` — сериализованное `ImageFile`-представление для мгновенной отрисовки грида без парсинга отдельных полей.
- Структурированные EXIF-колонки — под все сортировки (`date_taken`, `iso`, `shutter_speed`, `aperture`, `focal_length`) и advanced query (`camera/make/model`, `lens`), а также под будущий перенос поиска на SQL.
- `tags` отдельной таблицей — фильтрация по тегам и текстовый поиск по тегам; `source` различает пользовательские (`user:`) и AI-теги.

## Жизненный цикл job'ы

### Команды

- `start_folder_import(path: String, recursive: bool) -> Result<String, String>`
  - Нормализует путь.
  - Если для этой папки job уже запущена — возвращает существующий id (attach к работающей задаче).
  - Если в каталоге уже есть запись для папки — результаты берутся из SQLite, job не стартует заново. Открытие происходит мгновенно.
  - Иначе создаёт `Arc<AtomicBool>`, спавнит tokio-задачу, сохраняет `JoinHandle` в `AppState`, эмитит `folder-import-started { path, recursive }`.

- `sync_folder(path: String, recursive: bool) -> Result<String, String>`
  - Backend сам читает из каталога существующие fingerprint'ы `(path, modified, size, sidecar_modified)`.
  - Обходит папку, вычисляет дельту (новые / изменённые / удалённые) и применяет её в одной транзакции.
  - Затем запускает фазы 2 и 3 только для изменённых/новых файлов.
  - Используется для `handleLibraryRefresh` и пункта меню «Синхронизировать папку».

- `cancel_folder_import(path: String) -> Result<(), String>`
  - Выставляет cancel-флаг.
  - Вызывает `abort()` на `JoinHandle`.
  - Эмитит `folder-import-cancelled { path, processed }`.

### Фазы

#### Фаза 1 — Скан

- Обход каталога (`WalkDir` / `read_dir` с фильтром `is_supported_image_file`).
- Каждые ~500 найденных файлов эмитит `folder-import-scan { path, discovered }`.
- Чанками по 128 файлов:
  - `stat` файла;
  - чтение `.rrdata` (если есть) — `resolve_image_metadata`;
  - для виртуальных копий отдельная запись (`?vc=` в `path`);
  - `INSERT OR REPLACE` в `files`;
  - `DELETE/INSERT` тегов.
- Эмитит `folder-import-batch { path, files: Vec<ImageFile>, scanned, total }` после каждого чанка (128 файлов при скане).
- Если сайдкар уже содержит EXIF — сразу заполняет структурированные колонки и ставит `exif_scanned = 1`.
- При открытии папки из уже заполненного каталога события идут более крупными чанками (~2000 записей), чтобы быстро загрузить грид.

#### Фаза 2 — EXIF / сайдкары

- `SELECT path FROM files WHERE folder_id = ? AND exif_scanned = 0`.
- Конкурентность — **2** потока (бережём медленный диск).
- Перед каждым файлом проверяется cancel-флаг.
- `read_file_bytes` → `read_exif_data` → запись `.rrdata` → апдейт строки в БД.
- Эмитит `folder-import-exif-progress { path, current, total }`.
- Для каждого обработанного файла шлёт существующее событие `image-metadata-loaded` — фронт уже умеет мерджить метаданные.

#### Фаза 3 — Превью

- Отдельный фоновый поток, конкурентность **1–2**.
- Для каждого файла находит в каталоге `files.id` по `path` и использует `blake3(file_id + mtime + adjustments)` как ключ кэша превью.
- Вызывает `generate_single_thumbnail_and_cache` — кэш превью общий с on-demand скроллом.
- Пропускает cache-hit'ы мгновенно.
- Эмитит `folder-import-thumbs-progress { path, current, total }` и `thumbnail-generated` (для обновления видимых ячеек).

### Завершение

- `folder-import-complete { path, total, errors }`.
- Обновляет `folders.last_synced_at`.
- Удаляет хендл из `AppState`.
- Ошибки отдельных файлов считаются, но не прерывают job'у; финальное событие содержит их число.

## Семантика синхронизации

- **Открытие папки:** если в каталоге есть запись для папки — мгновенная загрузка из SQLite, **ноль** обращений к сетевому/дисковому источнику. Если нет — запускается полная job'а.
- **Ручная синхронизация** (refresh / пункт меню): backend читает из каталога существующие fingerprint'ы `(path, modified, size, sidecar_modified)`, обходит папку, сравнивает и в одной транзакции:
  - вставляет новые файлы;
  - для изменённых сбрасывает `exif_scanned = 0` и перечитывает сайдкар;
  - удаляет исчезнувшие (каскадно с тегами);
  - после транзакции запускает фазы 2 и 3 для изменённых/новых.
- **Перезапуск приложения:** каталог персистентен, поэтому большая папка на сетевом диске открывается мгновенно.
- **Папка недоступна:** показываем последний снапшот из каталога с пометкой «недоступно», скан не стартуем.
- **Удаление папки из библиотеки:** отмена job'ы + `DELETE FROM folders WHERE path = ?` (каскадно чистит файлы и теги).

## Офлайн-папки и перемещение

### Офлайн-папки

- При старте приложения все папки из `rootPaths` отображаются в дереве библиотеки, даже если их путь сейчас недоступен.
- Доступность папки проверяется асинхронно, без блокировки UI; для сетевых томов — с разумным таймаутом. Пока идёт проверка, показывается спиннер; по результату — badge «онлайн» / «офлайн».
- Офлайн-папка открывается мгновенно из каталога. Превью берутся из дискового кэша, если они там есть; отсутствующие превью не генерируются, пока папка офлайн.
- Поиск/фильтрация внутри офлайн-папки работают по данным каталога (для файлов без превью показывается плейсхолдер).
- При попытке синхронизации офлайн-папки, если путь снова доступен, папка автоматически переходит в онлайн и запускается `sync_folder`. Если путь всё ещё недоступен — toast с ошибкой, состояние остаётся офлайн.

### Перемещение папки

- Если папка недоступна, потому что её переместили на диске, в контекстном меню доступен пункт «Найти папку…» (Locate folder).
- Пользователь выбирает новый путь через файловый диалог.
- Применяются обновления:
  1. Настройки: заменить старый путь на новый в `rootPaths`.
  2. Каталог: `UPDATE folders SET path = new_path WHERE path = old_path` для всех комбинаций `recursive`; для всех строк `files` обновить `path` заменой префикса (`old_path` → `new_path`).
  3. Альбомы: через существующий `sync_album_path_changes` обновить пути в `albums.json`.
- Поскольку ключ кэша превью построен на `files.id` (стабильном идентификаторе каталога), а не на пути, после обновления путей в БД существующие превью остаются валидными и не перегенерируются.

## UI/UX

- `ImportJobsIndicator` — глобальная панель, видна и в библиотеке, и в редакторе. Для каждой активной job'ы: имя папки, текущая фаза, детерминированный прогресс-бар, `current/total`, кнопка отмены.
- При завершении — `react-toastify` toast: успех / успех с N ошибками / ошибка / отмена.
- В контекстном меню папки / хедере — «Синхронизировано: 2 дня назад» по `folders.last_synced_at`.
- В дереве папок и хедере библиотеки — badge «онлайн» / «офлайн» / «проверка…».
- Контекстное меню папки:
  - «Синхронизировать папку» (работает и в офлайн — если том появился, переходит в онлайн).
  - «Найти папку…» (доступно, когда папка недоступна, чтобы указать новый путь после перемещения).
- `isViewLoading` снимается с первым полученным батчем; грид заполняется постепенно.

## Обработка ошибок и краевые случаи

- **Ошибка файла:** счётчик++, продолжаем. Финальное событие с числом ошибок.
- **Фатальная ошибка фазы 1 (диск отключён, папка не читается):** папка помечается офлайн; если в каталоге есть снапшот — показываем его. Скан не затирает существующие данные.
- **Отмена:** законченные чанки остаются в БД; незавершённые транзакции откатываются. Повторный запуск продолжает с `exif_scanned = 0`.
- **Read-only том:** сайдкар не пишется (как сейчас), но EXIF остаётся в каталоге — грид работает; правки по-прежнему падают с ошибкой, потому что источником истины остаётся `.rrdata`.
- **Виртуальные копии:** каждая копия — отдельная строка `files` с `?vc=` в `path` и `is_virtual_copy = 1`.
- **Смена режима просмотра** flat ↔ recursive: разные записи в `folders`, поэтому это разные job'ы/кэши.
- **Повторный запуск job'ы на той же папке:** attach к существующей.
- **Битая база:** переименовываем в `library.db.corrupt`, создаём пустую; каталоги пересинхронизируются вручную. Пользовательские данные (сайдкары, превью) не теряются.

## Производительность и конкурентность

- Главный поток Rust не занят листингом — редактор, `load_image`, thumbnail-события не блокируются.
- Фаза 1: умеренный параллелизм для `stat` (rayon с разумным лимитом), чанки по 128.
- Фаза 2: **2** потока — не saturate'им медленный диск полным rayon.
- Фаза 3: **1–2** потока через общую функцию `generate_single_thumbnail_and_cache`.
- Целевые метрики приёмки:
  - открытие закэшированной папки 50 тыс. файлов — грид < 1 с;
  - отмена job'ы — < 2 с;
  - UI не блокируется на любой фазе.

## Тестирование

### Автоматические

- Unit-тесты `library_db.rs` на временной БД:
  - инициализация и миграции;
  - вставка/загрузка папки;
  - дельта-синхронизация (новые / изменённые / удалённые);
  - каскадное удаление.
- Тесты `folder_import.rs` на временной директории с файлами-заглушками:
  - счёт чанков;
  - отмена останавливает job'у в разумное время;
  - фаза 2 пропускается, если EXIF уже в каталоге.

### Ручные QA

- Локальная папка ~1k файлов: прогрессивное заполнение, отмена, повторное открытие из каталога.
- Сетевая папка 30–50 тыс. файлов: мгновенное открытие после перезапуска, ручная синхронизация, offline-режим.

### Верификационные гейты

- `cargo check` в `src-tauri/`
- `npm run build`
- `npx prettier --check <changed files>`

## Будущее развитие

- **SQL-backed filtering/search:** перенести `useSortedLibrary` на запросы к каталогу с пейджингом/виртуализацией для работы с 100k+ файлами без держания всего списка в памяти.
- **Файловый watcher:** подписываться на изменения папок через `notify` для автоматического обновления, когда приложение активно.
- **Альбомы:** связать `albums.json` с каталогом для проверки валидности путей и быстрого поиска файлов по альбому.

## Дельта к upstream

- Новые файлы: `src-tauri/src/library_db.rs`, `src-tauri/src/folder_import.rs`, `src/store/useFolderImportStore.ts`, `src/hooks/useFolderImport.ts`, `src/components/ui/ImportJobsIndicator.tsx`.
- Минимальные правки: `src/hooks/useAppNavigation.ts`, `src/hooks/useTauriListeners.ts`, `src/App.tsx`, контекстное меню папки, `src-tauri/src/app_state.rs`, `src-tauri/src/lib.rs` (регистрация команд), `src-tauri/Cargo.toml` (rusqlite), локали.
- Старые `list_images_*` и `read_exif_for_paths` не удаляются — форк остаётся merge-friendly.
