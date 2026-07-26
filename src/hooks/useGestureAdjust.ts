import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEditorStore } from '../store/useEditorStore';
import { useUIStore } from '../store/useUIStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useGestureStore, GestureOverlayParam } from '../store/useGestureStore';
import { useEditorActions } from './useEditorActions';
import { getEffectiveKeybind, KEYBIND_DEFINITIONS } from '../utils/keyboardUtils';
import { GESTURE_BINDINGS, GestureBinding, GestureParam } from '../utils/gestureBindings';
import { Adjustments, INITIAL_ADJUSTMENTS } from '../utils/adjustments';
import {
  DEFAULT_LUT_PARAMS,
  ResolvedLutParams,
  getEffectiveLutParams,
  lutParamsToAdjustments,
  resolvedLutParamsToLutFileSettings,
} from '../utils/lutSettings';
import type { LutFileSettings } from '../components/ui/AppProperties';
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
  TRACKPAD_SCROLL_AXIS_LOCK,
  TRACKPAD_SCROLL_STEP,
} from '../utils/gestureEngine';

interface GestureSession {
  binding: GestureBinding;
  moveLock: AxisLock;
  moveAccX: ContinuousAccumulator;
  moveAccY: ContinuousAccumulator;
  scrollLock: AxisLock;
  trackpadScrollLock: AxisLock;
  scrollStepAccX: StepAccumulator;
  scrollStepAccY: StepAccumulator;
  scrollContAccX: ContinuousAccumulator;
  scrollContAccY: ContinuousAccumulator;
  gestureKey: string;
  overlayParams: GestureOverlayParam[];
  lutCycleAccY: StepAccumulator;
}

const GESTURE_HOLD_DELAY_MS = 150;
const NO_LUT_PATH = '';

export function useGestureAdjust() {
  const { t } = useTranslation();
  const { setAdjustments, handleLutSelect } = useEditorActions();
  const setEditor = useEditorStore((s) => s.setEditor);
  const sessionRef = useRef<GestureSession | null>(null);
  const pendingRef = useRef<{ event: KeyboardEvent; timer: ReturnType<typeof setTimeout> } | null>(null);
  const stripRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const getGestureAction = (code: string): GestureBinding['action'] | null => {
      const keybinds = useSettingsStore.getState().appSettings?.keybinds;
      for (const binding of GESTURE_BINDINGS) {
        const def = KEYBIND_DEFINITIONS.find((d) => d.action === binding.action);
        if (!def) continue;
        const effective = getEffectiveKeybind(keybinds?.[def.action], def.defaultCombo);
        if (effective && effective.length === 1 && effective[0] === code) {
          return binding.action;
        }
      }
      return null;
    };

    const loadLutStrip = async () => {
      try {
        const entries = await invoke<Array<{ name: string; path: string }>>('list_luts');
        if (entries.length === 0) return;

        const adjustments = useEditorStore.getState().adjustments;
        const appSettings = useSettingsStore.getState().appSettings;
        const favorites = new Set(appSettings?.lutFavorites ?? []);
        const sourceEntries = favorites.size > 0 ? entries.filter((e) => favorites.has(e.path)) : entries;
        const currentPath = adjustments.lutPath ?? null;

        const noLutEntry = { path: NO_LUT_PATH, name: t('ui.lut.disabledLut'), thumb: null };
        const stripEntries = [noLutEntry, ...sourceEntries.map((e) => ({ path: e.path, name: e.name, thumb: null }))];
        const selectedIndex = currentPath ? Math.max(1, 1 + sourceEntries.findIndex((e) => e.path === currentPath)) : 0;

        const lutFieldSet = new Set([
          'lutPath',
          'lutName',
          'lutData',
          'lutSize',
          'lutIntensity',
          'lutTiming',
          'lutNormalizeMode',
          'lutInputRange',
          'lutInputOffset',
          'lutOffsetCompensation',
          'lutWbTemperatureShift',
          'lutWbTintShift',
          'lutPerImageParams',
        ]);
        const previewAdjustments: Record<string, unknown> = {};
        Object.entries(adjustments).forEach(([key, value]) => {
          if (!lutFieldSet.has(key)) {
            previewAdjustments[key] = value;
          }
        });
        previewAdjustments.sectionVisibility = {
          ...(adjustments.sectionVisibility ?? {}),
          effects: true,
          lut: true,
        };

        const lutParams: Record<string, LutFileSettings> = {};
        sourceEntries.forEach((entry) => {
          const effective = getEffectiveLutParams(appSettings, adjustments, entry.path);
          lutParams[entry.path] = resolvedLutParamsToLutFileSettings(effective);
        });

        useGestureStore.getState().startLutStrip(stripEntries, selectedIndex);

        const results = await invoke<Array<{ path: string; thumb: string | null }>>('generate_lut_previews', {
          lutPaths: stripEntries.map((e) => e.path),
          size: 200,
          adjustments: previewAdjustments,
          lutParams,
        });
        results.forEach((result) => {
          useGestureStore.getState().setLutStripThumb(result.path, result.thumb);
        });
        useGestureStore.getState().setLutStripLoading(false);
      } catch (err) {
        console.error('Failed to load LUT strip:', err);
      }
    };

    const refreshSelectedStripThumb = () => {
      const strip = useGestureStore.getState().lutStrip;
      const lutPath = useEditorStore.getState().adjustments.lutPath;
      if (!strip || !lutPath) return;

      if (stripRefreshTimer.current) {
        clearTimeout(stripRefreshTimer.current);
      }

      stripRefreshTimer.current = setTimeout(() => {
        const adjustments = useEditorStore.getState().adjustments;
        const appSettings = useSettingsStore.getState().appSettings;
        const lutFieldSet = new Set([
          'lutPath',
          'lutName',
          'lutData',
          'lutSize',
          'lutIntensity',
          'lutTiming',
          'lutNormalizeMode',
          'lutInputRange',
          'lutInputOffset',
          'lutOffsetCompensation',
          'lutWbTemperatureShift',
          'lutWbTintShift',
          'lutPerImageParams',
        ]);
        const previewAdjustments: Record<string, unknown> = {};
        Object.entries(adjustments).forEach(([key, value]) => {
          if (!lutFieldSet.has(key)) {
            previewAdjustments[key] = value;
          }
        });
        previewAdjustments.sectionVisibility = {
          ...(adjustments.sectionVisibility ?? {}),
          effects: true,
          lut: true,
        };

        const effective = getEffectiveLutParams(appSettings, adjustments, lutPath);
        invoke<Array<{ path: string; thumb: string | null }>>('generate_lut_previews', {
          lutPaths: [lutPath],
          size: 200,
          adjustments: previewAdjustments,
          lutParams: { [lutPath]: resolvedLutParamsToLutFileSettings(effective) },
        })
          .then((results) => {
            const result = results[0];
            if (result) {
              useGestureStore.getState().setLutStripThumb(result.path, result.thumb);
            }
          })
          .catch((err) => {
            console.error('Failed to refresh LUT strip thumb:', err);
          });
      }, 200);
    };

    const startSession = (action: GestureBinding['action'], gestureKey: string) => {
      const binding = GESTURE_BINDINGS.find((b) => b.action === action);
      if (!binding) return;

      const adjustments = useEditorStore.getState().adjustments;

      const buildOverlayParams = (): GestureOverlayParam[] => {
        if (action === 'gesture_color_balance') {
          return [
            {
              label: t('gesture.overlay.colorBalance'),
              axisLabels: ['temperature', 'tint'],
              values: [adjustments.temperature, adjustments.tint],
              min: [binding.move[0].min, binding.move[1].min],
              max: [binding.move[0].max, binding.move[1].max],
            },
            {
              label: t('gesture.overlay.warmSat'),
              axisLabels: ['flimWarmth', 'flimSaturation'],
              values: [adjustments.flimWarmth, adjustments.flimSaturation],
              min: [binding.scroll[0].min, binding.scroll[1].min],
              max: [binding.scroll[0].max, binding.scroll[1].max],
            },
          ];
        }

        if (action === 'gesture_tone_basic') {
          return [
            {
              label: t('gesture.overlay.exposureContrast'),
              axisLabels: ['flimEv', 'flimContrast'],
              values: [adjustments.flimEv, adjustments.flimContrast],
              min: [binding.move[0].min, binding.move[1].min],
              max: [binding.move[0].max, binding.move[1].max],
            },
            {
              label: t('gesture.overlay.lightsShadows'),
              axisLabels: ['flimShoulder', 'flimToe'],
              values: [adjustments.flimShoulder, adjustments.flimToe],
              min: [binding.scroll[0].min, binding.scroll[1].min],
              max: [binding.scroll[0].max, binding.scroll[1].max],
              invert: [true, true],
            },
          ];
        }

        if (action === 'gesture_lut') {
          return [
            {
              label: t('gesture.overlay.lutInput'),
              axisLabels: ['lutInputOffset', 'lutInputRange'],
              values: [adjustments.lutInputOffset ?? 0, adjustments.lutInputRange ?? 6],
              min: [binding.move[0].min, binding.move[1].min],
              max: [binding.move[0].max, binding.move[1].max],
            },
            {
              label: t('gesture.overlay.lutIntensity'),
              axisLabels: ['lutIntensity', 'lutIntensity'],
              values: [(binding.scroll[0].max + binding.scroll[0].min) / 2, adjustments.lutIntensity ?? 100],
              min: [binding.scroll[0].min, binding.scroll[1].min],
              max: [binding.scroll[0].max, binding.scroll[1].max],
              orientation: 'horizontal',
            },
          ];
        }

        return [];
      };

      const overlayParams = buildOverlayParams();
      useGestureStore.getState().startOverlay(action, overlayParams);

      sessionRef.current = {
        binding,
        moveLock: new AxisLock(MOVE_AXIS_LOCK),
        moveAccX: new ContinuousAccumulator(MOUSE_MOVE_STEP.stepX / binding.move[1].step, 0.4, binding.move[1].step),
        moveAccY: new ContinuousAccumulator(MOUSE_MOVE_STEP.stepY / binding.move[0].step, 0.4, binding.move[0].step),
        scrollLock: new AxisLock(SCROLL_AXIS_LOCK, true),
        trackpadScrollLock: new AxisLock(TRACKPAD_SCROLL_AXIS_LOCK),
        scrollStepAccX: new StepAccumulator(MOUSE_SCROLL_STEP),
        scrollStepAccY: new StepAccumulator(MOUSE_SCROLL_STEP),
        scrollContAccX: new ContinuousAccumulator(
          TRACKPAD_SCROLL_STEP / binding.scroll[1].step,
          0.6,
          binding.scroll[1].step,
        ),
        scrollContAccY: new ContinuousAccumulator(
          TRACKPAD_SCROLL_STEP / binding.scroll[0].step,
          0.6,
          binding.scroll[0].step,
        ),
        gestureKey,
        overlayParams,
        lutCycleAccY: new StepAccumulator(100),
      };

      if (action === 'gesture_lut') {
        loadLutStrip();
      }

      setEditor({ isSliderDragging: true });
      const appWindow = getCurrentWindow();
      appWindow.setCursorGrab(true).catch(() => {});
      appWindow.setCursorVisible(false).catch(() => {});
    };

    const endSession = () => {
      const hadSession = sessionRef.current !== null;
      sessionRef.current = null;
      useGestureStore.getState().endOverlay();
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
        ui.isConfigureLutHotkeyModalOpen ||
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

      if (!editor.selectedImage) return false;

      return true;
    };

    const LUT_GESTURE_PARAM_KEYS = new Set([
      'lutIntensity',
      'lutInputOffset',
      'lutInputRange',
      'lutWbTemperatureShift',
      'lutWbTintShift',
    ]);

    const applyDelta = (param: GestureParam, rawDelta: number) => {
      if (rawDelta === 0) return;
      setAdjustments((prev) => {
        const current = prev[param.key] ?? (INITIAL_ADJUSTMENTS[param.key] as number | undefined) ?? 0;
        const next: Adjustments = { ...prev, [param.key]: clamp(current + rawDelta, param.min, param.max) };
        if (prev.lutPath && LUT_GESTURE_PARAM_KEYS.has(param.key)) {
          const resolved: ResolvedLutParams = {
            intensity: next.lutIntensity ?? DEFAULT_LUT_PARAMS.intensity,
            timing: 'before',
            inputRange: next.lutInputRange ?? DEFAULT_LUT_PARAMS.inputRange,
            inputOffset: next.lutInputOffset ?? DEFAULT_LUT_PARAMS.inputOffset,
            offsetCompensation: next.lutOffsetCompensation ?? DEFAULT_LUT_PARAMS.offsetCompensation,
            wbTemperatureShift: next.lutWbTemperatureShift ?? DEFAULT_LUT_PARAMS.wbTemperatureShift,
            wbTintShift: next.lutWbTintShift ?? DEFAULT_LUT_PARAMS.wbTintShift,
          };
          next.lutPerImageParams = { ...prev.lutPerImageParams, [prev.lutPath]: resolved };
          refreshSelectedStripThumb();
        }
        updateOverlayValues(next);
        return next;
      });
    };

    const resetPanel = (panelIndex: number, valueMode: 'zero' | 'default') => {
      const session = sessionRef.current;
      if (!session) return;
      const panel = session.overlayParams[panelIndex];
      if (!panel) return;

      setAdjustments((prev) => {
        const next: Adjustments = { ...prev };
        panel.axisLabels.forEach((key, axisIndex) => {
          const defaultValue = (INITIAL_ADJUSTMENTS[key] as number | undefined) ?? 0;
          const value = valueMode === 'zero' ? 0 : defaultValue;
          next[key] = clamp(value, panel.min[axisIndex], panel.max[axisIndex]);
        });
        const updatedLutKeys = panel.axisLabels.filter((key) => prev.lutPath && LUT_GESTURE_PARAM_KEYS.has(key));
        if (updatedLutKeys.length > 0 && prev.lutPath) {
          const resolved: ResolvedLutParams = {
            intensity: next.lutIntensity ?? DEFAULT_LUT_PARAMS.intensity,
            timing: 'before',
            inputRange: next.lutInputRange ?? DEFAULT_LUT_PARAMS.inputRange,
            inputOffset: next.lutInputOffset ?? DEFAULT_LUT_PARAMS.inputOffset,
            offsetCompensation: next.lutOffsetCompensation ?? DEFAULT_LUT_PARAMS.offsetCompensation,
            wbTemperatureShift: next.lutWbTemperatureShift ?? DEFAULT_LUT_PARAMS.wbTemperatureShift,
            wbTintShift: next.lutWbTintShift ?? DEFAULT_LUT_PARAMS.wbTintShift,
          };
          next.lutPerImageParams = { ...prev.lutPerImageParams, [prev.lutPath]: resolved };
          refreshSelectedStripThumb();
        }
        updateOverlayValues(next);
        return next;
      });
    };

    const cycleLut = async (delta: number) => {
      const strip = useGestureStore.getState().lutStrip;
      if (!strip || strip.entries.length === 0) return;
      const nextIndex = clamp(strip.selectedIndex + delta, 0, strip.entries.length - 1);
      if (nextIndex === strip.selectedIndex) return;
      useGestureStore.getState().setLutStripSelectedIndex(nextIndex);

      const path = strip.entries[nextIndex].path;
      if (path === NO_LUT_PATH) {
        setAdjustments((prev) => ({
          ...prev,
          ...lutParamsToAdjustments(DEFAULT_LUT_PARAMS),
          lutPath: null,
          lutName: null,
          lutData: null,
          lutSize: 0,
        }));
      } else {
        try {
          await handleLutSelect(path);
        } catch (err) {
          console.error('Failed to select LUT from gesture strip:', err);
          return;
        }
      }
      updateOverlayValues(useEditorStore.getState().adjustments);
      refreshSelectedStripThumb();
    };

    const updateOverlayValues = (adjustments: Adjustments) => {
      const session = sessionRef.current;
      if (!session || session.overlayParams.length === 0) return;

      useGestureStore.getState().setParams(
        session.overlayParams.map((panel) => {
          const vertical =
            panel.orientation === 'horizontal'
              ? (panel.max[0] + panel.min[0]) / 2
              : clamp(adjustments[panel.axisLabels[0]], panel.min[0], panel.max[0]);
          const horizontal =
            panel.orientation === 'vertical'
              ? (panel.max[1] + panel.min[1]) / 2
              : clamp(adjustments[panel.axisLabels[1]], panel.min[1], panel.max[1]);
          return {
            ...panel,
            values: [vertical, horizontal] as [number, number],
          };
        }),
      );
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event as KeyboardEvent & { _gestureResent?: boolean })._gestureResent) {
        return;
      }

      if (sessionRef.current) {
        const isGestureKey = event.code === sessionRef.current.gestureKey;
        if (event.key === 'Escape' || isGestureKey) {
          if (event.key === 'Escape') {
            endSession();
          }
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        return;
      }

      if (event.repeat) return;
      if (!guardsPass()) return;

      const action = getGestureAction(event.code);
      if (!action) return;

      // Color balance only makes sense while the flim tonemapper is active.
      const editor = useEditorStore.getState();
      if (action === 'gesture_color_balance' && editor.adjustments.toneMapper !== 'flim') return;

      event.preventDefault();
      event.stopImmediatePropagation();

      const timer = setTimeout(() => {
        pendingRef.current = null;
        startSession(action, event.code);
      }, GESTURE_HOLD_DELAY_MS);

      pendingRef.current = { event, timer };
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (pendingRef.current && event.code === pendingRef.current.event.code) {
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
      const moveSign = binding.moveSign ?? [1, 1];
      const locked = moveLock.push(event.movementX, event.movementY);

      if (locked === 'vertical' || locked === 'both') {
        applyDelta(binding.move[0], moveAccY.push(-event.movementY * moveSign[0]));
      }
      if (locked === 'horizontal' || locked === 'both') {
        applyDelta(binding.move[1], moveAccX.push(event.movementX * moveSign[1]));
      }
    };

    const handleWheel = (event: WheelEvent) => {
      if (!sessionRef.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();

      const { binding, trackpadScrollLock, scrollStepAccX, scrollStepAccY, scrollContAccX, scrollContAccY } =
        sessionRef.current;
      const scrollSign = binding.scrollSign ?? [1, 1];
      const device = detectWheelDevice(event);

      const isLutSession = binding.action === 'gesture_lut';

      if (device === 'mouse') {
        const qx = quantizeMouseWheel(event.deltaX);
        const qy = quantizeMouseWheel(event.deltaY);

        if (isLutSession && qy !== 0 && (qx === 0 || Math.abs(qy) >= Math.abs(qx))) {
          const steps = sessionRef.current.lutCycleAccY.push(-qy * 50);
          if (steps !== 0) {
            cycleLut(Math.sign(steps));
          }
          return;
        }

        const dx = qx * MOUSE_SCROLL_STEP;
        const dy = qy * MOUSE_SCROLL_STEP;

        let locked: 'none' | 'horizontal' | 'vertical' | 'both';
        if (qx !== 0 && qy !== 0) {
          locked = 'both';
        } else if (qx !== 0) {
          locked = 'horizontal';
        } else if (qy !== 0) {
          locked = 'vertical';
        } else {
          locked = 'none';
        }

        if (binding.scrollSingleParam !== undefined) {
          const param = binding.scroll[binding.scrollSingleParam];
          if (locked === 'vertical' || (locked === 'both' && Math.abs(dy) >= Math.abs(dx))) {
            const steps = scrollStepAccY.push(dy * scrollSign[0]);
            applyDelta(param, steps * param.step);
          } else if (locked === 'horizontal' || locked === 'both') {
            const steps = scrollStepAccX.push(-dx * scrollSign[1]);
            applyDelta(param, steps * param.step);
          }
        } else {
          if (locked === 'vertical' || locked === 'both') {
            const steps = scrollStepAccY.push(dy * scrollSign[0]);
            applyDelta(binding.scroll[0], steps * binding.scroll[0].step);
          }
          if (locked === 'horizontal' || locked === 'both') {
            const steps = scrollStepAccX.push(-dx * scrollSign[1]);
            applyDelta(binding.scroll[1], steps * binding.scroll[1].step);
          }
        }
        return;
      }

      // Trackpad: continuous fractional scrolling with axis lock.
      const dx = event.deltaX;
      const dy = event.deltaY;
      const locked = trackpadScrollLock.push(dx, dy);

      if (isLutSession && (locked === 'vertical' || (locked === 'both' && Math.abs(dy) >= Math.abs(dx)))) {
        const steps = sessionRef.current.lutCycleAccY.push(-dy);
        if (steps !== 0) {
          cycleLut(Math.sign(steps));
        }
        return;
      }

      if (binding.scrollSingleParam !== undefined) {
        const param = binding.scroll[binding.scrollSingleParam];
        if (locked === 'vertical' || (locked === 'both' && Math.abs(dy) >= Math.abs(dx))) {
          applyDelta(param, scrollContAccY.push(dy * scrollSign[0]));
        } else if (locked === 'horizontal' || locked === 'both') {
          applyDelta(param, -scrollContAccX.push(dx * scrollSign[1]));
        }
      } else {
        if (locked === 'vertical' || locked === 'both') {
          applyDelta(binding.scroll[0], scrollContAccY.push(dy * scrollSign[0]));
        }
        if (locked === 'horizontal' || locked === 'both') {
          applyDelta(binding.scroll[1], -scrollContAccX.push(dx * scrollSign[1]));
        }
      }
    };

    const handleBlur = () => {
      if (pendingRef.current) {
        clearTimeout(pendingRef.current.timer);
        pendingRef.current = null;
      }
      endSession();
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        handleBlur();
      }
    };

    const handleDblClick = (event: MouseEvent) => {
      if (!sessionRef.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      resetPanel(0, 'default');
    };

    const handleSecondaryAction = (event: MouseEvent) => {
      if (!sessionRef.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      resetPanel(1, 'default');
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('wheel', handleWheel, { capture: true, passive: false });
    window.addEventListener('dblclick', handleDblClick, true);
    window.addEventListener('contextmenu', handleSecondaryAction, true);
    window.addEventListener('auxclick', handleSecondaryAction, true);
    window.addEventListener('blur', handleBlur, true);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('wheel', handleWheel, { capture: true });
      window.removeEventListener('dblclick', handleDblClick, true);
      window.removeEventListener('contextmenu', handleSecondaryAction, true);
      window.removeEventListener('auxclick', handleSecondaryAction, true);
      window.removeEventListener('blur', handleBlur, true);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (pendingRef.current) {
        clearTimeout(pendingRef.current.timer);
        pendingRef.current = null;
      }
      if (stripRefreshTimer.current) {
        clearTimeout(stripRefreshTimer.current);
        stripRefreshTimer.current = null;
      }
      endSession();
    };
  }, [setAdjustments, setEditor, handleLutSelect, t]);
}
