# Dodge & Burn Brush

## Summary

Новый тип sub-mask в табе **Masks** — локальная кисть для проявки film-эффекта через маску. В отличие от Flow, инструмент не пересчитывает всё изображение на каждое движение мыши. Вместо этого рендерятся две плоскости — базовая (`base`) и с эффектом (`effect`) — и во время рисования фронтенд смешивает их через накапливаемую grayscale-маску в WebGL.

## Goals

- Работать как «спрей»: повторное прохождение по одному месту усиливает эффект (аддитивно, clamp 0..1).
- Не пересчитывать изображение во время движения мыши.
- Оставаться редактируемым: параметры кисти и маску можно менять после рисования.
- Переиспользовать существующую логику Flow для overlay (`showOverlay`, клавиша `O`) и erase (`Option`).

## Non-goals

- Поддержка LUT, grain, B&W и advanced-регуляторов в этой кисти.
- Собственный полноценный рендер на фронтенде: рендер effect-плоскости всё ещё делается в Rust/GPU.
- Замена Flow: Flow остаётся для существующих сценариев.

## Core concept

```
result = mix(base, effect, mask)
```

- `base` — изображение, отрендеренное по текущим глобальным параметрам Film.
- `effect` — то же изображение, отрендеренное с `film_params + delta_params` кисти.
- `mask` — накапливаемая grayscale маска, рисуемая пользователем.

Рендер `effect` происходит только при изменении параметров кисти или базовых Film-параметров. Рисование — только обновление маски и один WebGL draw call.

## Data model

Новый sub-mask тип в `adjustments.masks[...].subMasks`:

```ts
interface DodgeBurnMaskParameters {
  // Итоговая grayscale-маска, сжатая в WebP ~70% качества.
  // Хранится как base64-строка.
  mask_bitmap: string;

  // Delta-параметры Film, применяемые локально.
  // Тот же набор регуляторов, что на табе Film,
  // но без LUT, grain, B&W и advanced.
  adjustments: FilmDeltaAdjustments;
}
```

```ts
{
  id: string;
  type: 'dodgeBurn';
  enabled: boolean;
  inverted: boolean;        // общая логика масок
  showOverlay: boolean;     // из Flow
  parameters: DodgeBurnMaskParameters;
}
```

Отдельные strokes не храним — итоговая маска уже содержит суммарный результат. Для undo одного штриха делается snapshot маски перед `onMouseDown`.

## Frontend architecture

### WebGL layer

Поверх `ImageCanvas` добавляется полупрозрачный WebGL canvas той же трансформации.

Компоненты:
- `DodgeBurnLayer` — React-обёртка, следит за трансформацией изображения.
- `DodgeBurnRenderer` — WebGL-контекст, шейдер смешивания, загрузка текстур.
- `DodgeBurnMaskTexture` — grayscale-текстура, в которую additive рисуются feathered круги.

### Шейдер смешивания

```glsl
precision highp float;
uniform sampler2D u_base;
uniform sampler2D u_effect;
uniform sampler2D u_mask;
varying vec2 v_uv;

void main() {
  vec3 base = texture2D(u_base, v_uv).rgb;
  vec3 effect = texture2D(u_effect, v_uv).rgb;
  float mask = texture2D(u_mask, v_uv).r;
  gl_FragColor = vec4(mix(base, effect, mask), 1.0);
}
```

### Получение плоскостей

- `base` — текущий рендер изображения (`apply_adjustments` с глобальными Film-параметрами).
- `effect` — отдельный вызов `apply_adjustments` с `film_params + delta`.

Обе плоскости — в текущем preview-разрешении — загружаются как WebGL-текстуры.

### Рисование маски

1. По координатам указателя вычисляем UV в текстуре маски.
2. Рисуем feathered круг в `u_mask` в режиме additive blend с clamp к 1.0.
3. Один `gl.drawArrays` для обновления экрана.

### Erase

Тот же механизм, но вычитание из маски (additive blend с отрицательным flow, clamp к 0.0). Логика активации erase берётся из Flow (`Option`).

### Overlay

Reuse существующих `maskOverlayUrl` и `showOverlay` из Flow. Показываем красную/чёрно-белую подсветку маски по тогглу или клавише `O`.

## Interaction flow

### Активация

1. Пользователь добавляет sub-mask типа `dodgeBurn` в табе Masks.
2. Правая панель показывает регуляторы Film (без LUT, grain, B&W, advanced).
3. При изменении любого регулятора запускается рендер `effect`.
4. После загрузки `effect` в WebGL кисть готова к рисованию.

### Во время штриха

1. `onMouseDown`: snapshot текущей маски (для undo), создаём временный stroke buffer.
2. `onMouseMove`: рисуем feathered круг в маску additive, clamp 0..1; перерисовываем WebGL слой.
3. `onMouseUp`: сжимаем маску в WebP (~70%) и сохраняем в `parameters.mask_bitmap`.

### Изменение параметров кисти

1. Перерендеривается только `effect`.
2. Маска остаётся без изменений.
3. WebGL слой обновляется автоматически.

### Изменение базовых Film-параметров

1. Перерендериваются `base` и `effect`.
2. Маска не меняется.

## Edge cases

- **Пустая маска / нулевой delta:** если delta = 0, `effect` совпадает с `base`, разницы не видно.
- **Рендер ещё не готов:** рисование отключено, курсор показывает состояние загрузки.
- **Zoom / pan:** WebGL canvas следует за трансформацией `ImageCanvas` через UV, маску не перерисовываем.
- **Undo:** snapshot маски перед штрихом; undo восстанавливает предыдущее состояние.
- **Export:** WebGL-маска существует только в preview-разрешении. При экспорте маска передаётся в бэкенд, где выполняется финальное смешивание `base` + `effect` в полном разрешении.
- **Переключение на другой инструмент:** WebGL слой скрывается, sub-mask с маской и параметрами сохраняется.

## Export handling

При экспорте маска передаётся в Rust как bitmap. Бэкенд:

1. Рендерит `base` и `effect` в полном разрешении.
2. Смешивает их через маску.
3. Продолжает остальной pipeline (tonemapping, вывод).

## Reuse from existing code

- Overlay display: `showOverlay`, `maskOverlayUrl`, клавиша `O` — из Flow.
- Erase activation: `Option` + drag — из Flow.
- Brush settings: `useEditorStore.brushSettings` — размер, feather, flow.
- Sub-mask infrastructure: `maskUtils.ts`, `MasksPanel.tsx`, `ImageCanvas.tsx`.
- Backend mask storage: аналогично Flow маскам, но вместо strokes храним сжатый WebP bitmap.

## Implementation decisions

- **Название типа sub-mask:** `dodgeBurn`. Простое, понятное, не конфликтует с `flow`.
- **WebGL-контекст:** отдельный WebGL2 контекст на `<canvas>` поверх `ImageCanvas`. Интеграция в существующий WGPU surface на фронтенде слишком сложна и не нужна для этой задачи.
- **Получение плоскостей:**
  - `base` — используем текущий `finalPreviewUrl`, который уже есть в редакторе.
  - `effect` — один явный вызов `apply_adjustments` с `film_params + delta`.
