// Declarative gesture bindings. Ranges/steps duplicate FilmPanel values for the
// 4 phase-1 params on purpose (FilmPanel stays untouched to keep the upstream
// delta small); extract a shared range table when more bindings are added.

export interface GestureParam {
  key: 'temperature' | 'tint' | 'flimWarmth' | 'flimSaturation';
  min: number;
  max: number;
  step: number; // param units per one engine step
}

export interface GestureBinding {
  action: 'gesture_color_balance'; // phase-1 literal; expand the union as bindings are added
  move: [GestureParam, GestureParam]; // [vertical, horizontal]
  scroll: [GestureParam, GestureParam]; // [vertical, horizontal]
}

// NOTE: every `action` id below must later have a matching entry in
// KEYBIND_DEFINITIONS (Task 4) and a matching i18n key.
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
];
