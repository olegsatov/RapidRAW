import { useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEditorStore } from '../store/useEditorStore';
import { useUIStore } from '../store/useUIStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useEditorActions } from './useEditorActions';
import { getEffectiveKeybind, KEYBIND_DEFINITIONS, normalizeCombo } from '../utils/keyboardUtils';
import { GESTURE_BINDINGS, GestureBinding, GestureParam } from '../utils/gestureBindings';
import {
  AxisLock,
  clamp,
  ContinuousAccumulator,
  detectWheelDevice,
  MOUSE_MOVE_STEP,
  MOUSE_SCROLL_STEP,
  MOVE_AXIS_LOCK,
  quantizeMouseWheel,
  SCROLL_AXIS_LOCK,
  StepAccumulator,
  TRACKPAD_SCROLL_STEP,
} from '../utils/gestureEngine';

interface GestureSession {
  binding: GestureBinding;
  moveLock: AxisLock;
  moveAccX: ContinuousAccumulator;
  moveAccY: ContinuousAccumulator;
  scrollLock: AxisLock;
  scrollAccX: StepAccumulator;
  scrollAccY: StepAccumulator;
  gestureKey: string;
}

const GESTURE_HOLD_DELAY_MS = 150;

export function useGestureAdjust() {
  const { setAdjustments } = useEditorActions();
  const setEditor = useEditorStore((s) => s.setEditor);
  const sessionRef = useRef<GestureSession | null>(null);
  const pendingRef = useRef<{ event: KeyboardEvent; timer: ReturnType<typeof setTimeout> } | null>(null);

  useEffect(() => {
    const getGestureKey = (): string | null => {
      const keybinds = useSettingsStore.getState().appSettings?.keybinds;
      const def = KEYBIND_DEFINITIONS.find((d) => d.action === 'gesture_color_balance');
      if (!def) return null;
      const effective = getEffectiveKeybind(keybinds?.[def.action], def.defaultCombo);
      if (!effective || effective.length !== 1) return null;
      return effective[0];
    };

    const startSession = (gestureKey: string) => {
      const binding = GESTURE_BINDINGS.find((b) => b.action === 'gesture_color_balance');
      if (!binding) return;

      sessionRef.current = {
        binding,
        moveLock: new AxisLock(MOVE_AXIS_LOCK),
        moveAccX: new ContinuousAccumulator(MOUSE_MOVE_STEP.stepX / binding.move[1].step),
        moveAccY: new ContinuousAccumulator(MOUSE_MOVE_STEP.stepY / binding.move[0].step),
        scrollLock: new AxisLock(SCROLL_AXIS_LOCK, true),
        scrollAccX: new StepAccumulator(MOUSE_SCROLL_STEP),
        scrollAccY: new StepAccumulator(MOUSE_SCROLL_STEP),
        gestureKey,
      };

      setEditor({ isSliderDragging: true });
      const appWindow = getCurrentWindow();
      appWindow.setCursorGrab(true).catch(() => {});
      appWindow.setCursorVisible(false).catch(() => {});
    };

    const endSession = () => {
      const hadSession = sessionRef.current !== null;
      sessionRef.current = null;
      const appWindow = getCurrentWindow();
      appWindow.setCursorGrab(false).catch(() => {});
      appWindow.setCursorVisible(true).catch(() => {});
      if (hadSession) {
        setEditor({ isSliderDragging: false });
      }
    };

    const guardsPass = (): boolean => {
      const ui = useUIStore.getState();
      const editor = useEditorStore.getState();

      const isModalOpen =
        ui.isCreateFolderModalOpen ||
        ui.isRenameFolderModalOpen ||
        ui.isRenameFileModalOpen ||
        ui.isImportModalOpen ||
        ui.isCopyPasteSettingsModalOpen ||
        ui.isConfigurePresetModalOpen ||
        ui.confirmModalState.isOpen ||
        ui.panoramaModalState.isOpen ||
        ui.cullingModalState.isOpen ||
        ui.collageModalState.isOpen ||
        ui.denoiseModalState.isOpen ||
        ui.negativeModalState.isOpen;

      if (isModalOpen) return false;

      const isInputFocused =
        document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA';
      if (isInputFocused) return false;

      if (editor.adjustments.toneMapper !== 'flim') return false;

      if (!editor.selectedImage) return false;

      return true;
    };

    const applyDelta = (param: GestureParam, rawDelta: number) => {
      if (rawDelta === 0) return;
      setAdjustments((prev) => ({
        ...prev,
        [param.key]: clamp(prev[param.key] + rawDelta, param.min, param.max),
      }));
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event as KeyboardEvent & { _gestureResent?: boolean })._gestureResent) {
        return;
      }

      if (sessionRef.current) {
        if (event.key === 'Escape') {
          endSession();
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      if (event.repeat) return;
      if (!guardsPass()) return;

      const gestureKey = getGestureKey();
      if (!gestureKey) return;

      const osPlatform = useSettingsStore.getState().osPlatform;
      if (normalizeCombo(event, osPlatform).join('+') === gestureKey) {
        event.preventDefault();
        event.stopImmediatePropagation();

        const timer = setTimeout(() => {
          pendingRef.current = null;
          startSession(gestureKey);
        }, GESTURE_HOLD_DELAY_MS);

        pendingRef.current = { event, timer };
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const gestureKey = getGestureKey();

      if (pendingRef.current && gestureKey && event.code === gestureKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        clearTimeout(pendingRef.current.timer);
        const originalEvent = pendingRef.current.event;
        pendingRef.current = null;

        const syntheticInit = {
          key: originalEvent.key,
          code: originalEvent.code,
          location: originalEvent.location,
          ctrlKey: originalEvent.ctrlKey,
          altKey: originalEvent.altKey,
          shiftKey: originalEvent.shiftKey,
          metaKey: originalEvent.metaKey,
          bubbles: true,
          cancelable: true,
        };

        const syntheticDown = new KeyboardEvent('keydown', syntheticInit);
        (syntheticDown as KeyboardEvent & { _gestureResent?: boolean })._gestureResent = true;
        window.dispatchEvent(syntheticDown);

        const syntheticUp = new KeyboardEvent('keyup', syntheticInit);
        (syntheticUp as KeyboardEvent & { _gestureResent?: boolean })._gestureResent = true;
        window.dispatchEvent(syntheticUp);
        return;
      }

      if (!sessionRef.current) return;
      if (event.code === sessionRef.current.gestureKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        endSession();
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!sessionRef.current) return;

      const { binding, moveLock, moveAccX, moveAccY } = sessionRef.current;
      const locked = moveLock.push(event.movementX, event.movementY);

      if (locked === 'vertical' || locked === 'both') {
        applyDelta(binding.move[0], moveAccY.push(-event.movementY));
      }
      if (locked === 'horizontal' || locked === 'both') {
        applyDelta(binding.move[1], moveAccX.push(event.movementX));
      }
    };

    const handleWheel = (event: WheelEvent) => {
      if (!sessionRef.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();

      const { binding, scrollLock, scrollAccX, scrollAccY } = sessionRef.current;
      const device = detectWheelDevice(event);

      let dx: number;
      let dy: number;
      let locked: 'none' | 'horizontal' | 'vertical' | 'both';
      if (device === 'mouse') {
        const qx = quantizeMouseWheel(event.deltaX);
        const qy = quantizeMouseWheel(event.deltaY);
        dx = qx * MOUSE_SCROLL_STEP;
        dy = qy * MOUSE_SCROLL_STEP;
        if (qx !== 0 && qy !== 0) {
          locked = 'both';
        } else if (qx !== 0) {
          locked = 'horizontal';
        } else if (qy !== 0) {
          locked = 'vertical';
        } else {
          locked = 'none';
        }
      } else {
        scrollAccX.step = TRACKPAD_SCROLL_STEP;
        scrollAccY.step = TRACKPAD_SCROLL_STEP;
        dx = event.deltaX;
        dy = event.deltaY;
        locked = scrollLock.push(dx, dy);
      }

      if (locked === 'vertical' || locked === 'both') {
        const steps = scrollAccY.push(dy);
        applyDelta(binding.scroll[0], steps * binding.scroll[0].step);
      }
      if (locked === 'horizontal' || locked === 'both') {
        const steps = scrollAccX.push(-dx);
        applyDelta(binding.scroll[1], steps * binding.scroll[1].step);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('wheel', handleWheel, { capture: true, passive: false });

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('wheel', handleWheel, { capture: true });
      if (pendingRef.current) {
        clearTimeout(pendingRef.current.timer);
        pendingRef.current = null;
      }
      endSession();
    };
  }, [setAdjustments, setEditor]);
}
