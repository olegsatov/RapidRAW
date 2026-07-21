// Declarative gesture bindings. Ranges/steps duplicate FilmPanel values for the
// 4 phase-1 params on purpose (FilmPanel stays untouched to keep the upstream
// delta small); extract a shared range table when more bindings are added.

export interface GestureParam {
  key: 'temperature' | 'tint' | 'flimWarmth' | 'flimSaturation' | 'exposure' | 'contrast' | 'highlights' | 'shadows';
  min: number;
  max: number;
  step: number; // param units per one engine step
}

export interface GestureBinding {
  action: 'gesture_color_balance' | 'gesture_tone_basic'; // expand the union as bindings are added
  move: [GestureParam, GestureParam]; // [vertical, horizontal]
  scroll: [GestureParam, GestureParam]; // [vertical, horizontal]
  moveSign?: [number, number]; // per-axis sign multipliers; default [1, 1]
  scrollSign?: [number, number];
}

// NOTE: every `action` id below must later have a matching entry in
// KEYBIND_DEFINITIONS and a matching i18n key.
export const GESTURE_BINDINGS: GestureBinding[] = [
  {
    action: 'gesture_color_balance',
    move: [
      { key: 'temperature', min: -100, max: 100, step: 1 },
      { key: 'tint', min: -100, max: 100, step: 1 },
    ],
    scroll: [
      { key: 'flimWarmth', min: -100, max: 100, step: 1 },
      { key: 'flimSaturation', min: 0, max: 200, step: 1 },
    ],
  },
  {
    action: 'gesture_tone_basic',
    move: [
      { key: 'exposure', min: -5, max: 5, step: 0.1 },
      { key: 'contrast', min: -100, max: 100, step: 1 },
    ],
    scroll: [
      { key: 'highlights', min: -100, max: 100, step: 1 },
      { key: 'shadows', min: -100, max: 100, step: 1 },
    ],
    moveSign: [1, -1],
  },
];
