import { create } from 'zustand';
import {
  ImageFile,
  LibraryViewMode,
  Panel,
  UiVisibility,
  CullingSuggestions,
  LeftPanelTab,
} from '../components/ui/AppProperties';
import { Adjustments } from '../utils/adjustments';
import { useEditorStore } from './useEditorStore';

const RIGHT_PANEL_ORDER = [
  Panel.Metadata,
  Panel.Adjustments,
  Panel.Crop,
  Panel.Film,
  Panel.Masks,
  Panel.Ai,
  Panel.Export,
];

export interface CollapsibleSectionsState {
  basic: boolean;
  blackAndWhite: boolean;
  color: boolean;
  curves: boolean;
  details: boolean;
  effects: boolean;
  film: boolean;
  lut: boolean;
}

export interface ConfirmModalState {
  confirmText?: string;
  confirmVariant?: string;
  isOpen: boolean;
  message?: string;
  onConfirm?(): void;
  title?: string;
}

export interface CollageModalState {
  isOpen: boolean;
  sourceImages: ImageFile[];
}

export interface PanoramaModalState {
  error: string | null;
  finalImageBase64: string | null;
  isOpen: boolean;
  isProcessing: boolean;
  progressMessage: string | null;
  stitchingSourcePaths: Array<string>;
}

export interface HdrModalState {
  error: string | null;
  finalImageBase64: string | null;
  isOpen: boolean;
  isProcessing: boolean;
  progressMessage: string | null;
  stitchingSourcePaths: Array<string>;
}

export interface DenoiseModalState {
  isOpen: boolean;
  isProcessing: boolean;
  previewBase64: string | null;
  originalBase64?: string | null;
  error: string | null;
  targetPaths: string[];
  progressMessage: string | null;
  isRaw: boolean;
}

export interface NegativeConversionModalState {
  isOpen: boolean;
  targetPaths: Array<string>;
}

export interface CullingModalState {
  isOpen: boolean;
  suggestions: CullingSuggestions | null;
  progress: { current: number; total: number; stage: string } | null;
  error: string | null;
  pathsToCull: Array<string>;
}

export interface CropSessionSnapshot {
  imagePath: string | null;
  adjustments: Partial<Adjustments>;
}

interface UIState {
  // View & Layout
  activeView: string;
  isFullScreen: boolean;
  isWindowFullScreen: boolean;
  isInstantTransition: boolean;
  isLayoutReady: boolean;
  uiVisibility: UiVisibility;
  isLibraryExportPanelVisible: boolean;

  // Dimensions
  leftPanelWidth: number;
  rightPanelWidth: number;
  bottomPanelHeight: number;
  leftBottomPanelHeightGallery: number;
  leftBottomPanelHeightEditor: number;
  compactEditorPanelHeightOverride: number | null;

  // Right Panel
  activeRightPanel: Panel | null;
  renderedRightPanel: Panel | null;
  slideDirection: number;
  collapsibleSectionsState: CollapsibleSectionsState;
  panelBeforeCrop: Panel | null | undefined;
  cropSessionSnapshot: CropSessionSnapshot | null;

  // Left Bottom Panel
  activeLeftBottomTab: LeftPanelTab;

  // Left Editor Tools Panel (presets / luts)
  activeEditorToolsTab: 'presets' | 'luts';

  // Modals & Dialogs
  isCreateFolderModalOpen: boolean;
  isRenameFolderModalOpen: boolean;
  isRenameFileModalOpen: boolean;
  renameTargetPaths: Array<string>;
  isImportModalOpen: boolean;
  isCopyPasteSettingsModalOpen: boolean;
  isConfigurePresetModalOpen: boolean;
  isConfigureLutHotkeyModalOpen: boolean;
  importTargetFolder: string | null;
  importSourcePaths: Array<string>;
  folderActionTarget: string | null;

  // Album Modals
  isCreateAlbumModalOpen: boolean;
  isCreateAlbumGroupModalOpen: boolean;
  isRenameAlbumModalOpen: boolean;
  albumActionTarget: string | null;

  // Complex Modal States
  confirmModalState: ConfirmModalState;
  panoramaModalState: PanoramaModalState;
  hdrModalState: HdrModalState;
  negativeModalState: NegativeConversionModalState;
  denoiseModalState: DenoiseModalState;
  cullingModalState: CullingModalState;
  collageModalState: CollageModalState;

  // Actions
  setUI: (updater: Partial<UIState> | ((state: UIState) => Partial<UIState>)) => void;
  setRightPanel: (panel: Panel | null) => void;
  customEscapeHandler: (() => void) | null;
  setCustomEscapeHandler: (handler: (() => void) | null) => void;
  cleanViewActive: boolean;
  cleanViewSnapshot: {
    activeRightPanel: Panel | null;
    renderedRightPanel: Panel | null;
    isLibraryExportPanelVisible: boolean;
  } | null;
  toggleCleanView: () => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  activeView: 'library',
  isFullScreen: false,
  isWindowFullScreen: false,
  isInstantTransition: false,
  isLayoutReady: false,
  uiVisibility: { folderTree: true, filmstrip: true, leftBottomPanel: true },
  isLibraryExportPanelVisible: false,
  cleanViewActive: false,
  cleanViewSnapshot: null,

  leftPanelWidth: 256,
  rightPanelWidth: 320,
  bottomPanelHeight: 144,
  leftBottomPanelHeightGallery: 0,
  leftBottomPanelHeightEditor: 0,
  compactEditorPanelHeightOverride: null,

  activeRightPanel: Panel.Adjustments,
  renderedRightPanel: Panel.Adjustments,
  slideDirection: 1,
  panelBeforeCrop: undefined,
  cropSessionSnapshot: null,
  collapsibleSectionsState: {
    basic: true,
    blackAndWhite: false,
    color: false,
    curves: true,
    details: false,
    effects: false,
    film: false,
    lut: false,
  },
  activeLeftBottomTab: LeftPanelTab.Presets,
  activeEditorToolsTab: 'presets',

  isCreateFolderModalOpen: false,
  isRenameFolderModalOpen: false,
  isRenameFileModalOpen: false,
  renameTargetPaths: [],
  isImportModalOpen: false,
  isCopyPasteSettingsModalOpen: false,
  isConfigurePresetModalOpen: false,
  isConfigureLutHotkeyModalOpen: false,
  importTargetFolder: null,
  importSourcePaths: [],
  folderActionTarget: null,

  isCreateAlbumModalOpen: false,
  isCreateAlbumGroupModalOpen: false,
  isRenameAlbumModalOpen: false,
  albumActionTarget: null,

  confirmModalState: { isOpen: false },
  panoramaModalState: {
    error: null,
    finalImageBase64: null,
    isOpen: false,
    isProcessing: false,
    progressMessage: '',
    stitchingSourcePaths: [],
  },
  hdrModalState: {
    error: null,
    finalImageBase64: null,
    isOpen: false,
    isProcessing: false,
    progressMessage: '',
    stitchingSourcePaths: [],
  },
  negativeModalState: { isOpen: false, targetPaths: [] },
  denoiseModalState: {
    isOpen: false,
    isProcessing: false,
    previewBase64: null,
    error: null,
    targetPaths: [],
    progressMessage: null,
    isRaw: false,
  },
  cullingModalState: { isOpen: false, suggestions: null, progress: null, error: null, pathsToCull: [] },
  collageModalState: { isOpen: false, sourceImages: [] },

  setUI: (updater) => set((state) => (typeof updater === 'function' ? updater(state) : updater)),

  setRightPanel: (panelId) => {
    if (panelId && !RIGHT_PANEL_ORDER.includes(panelId)) return;
    const current = get().activeRightPanel;
    const next = panelId === current ? null : panelId;

    if (next === Panel.Crop && current !== Panel.Crop) {
      const { adjustments, selectedImage } = useEditorStore.getState();
      const { crop, aspectRatio, rotation, orientationSteps, flipHorizontal, flipVertical } = adjustments;
      set({
        panelBeforeCrop: current,
        cropSessionSnapshot: {
          imagePath: selectedImage?.path ?? null,
          adjustments: { crop, aspectRatio, rotation, orientationSteps, flipHorizontal, flipVertical },
        },
      });
    } else if (current === Panel.Crop && next !== Panel.Crop) {
      set({ cropSessionSnapshot: null });
    }

    if (next === null) {
      set({ activeRightPanel: null });
      return;
    }

    const currentIndex = current ? RIGHT_PANEL_ORDER.indexOf(current) : -1;
    const newIndex = RIGHT_PANEL_ORDER.indexOf(next);
    set({
      slideDirection: newIndex > currentIndex ? 1 : -1,
      activeRightPanel: next,
      renderedRightPanel: next,
    });
  },

  customEscapeHandler: null,
  setCustomEscapeHandler: (handler) => set({ customEscapeHandler: handler }),

  toggleCleanView: () => {
    const state = get();
    if (state.cleanViewActive) {
      const snapshot = state.cleanViewSnapshot;
      if (!snapshot) return;
      set({
        isInstantTransition: true,
        cleanViewActive: false,
        cleanViewSnapshot: null,
        uiVisibility: {
          ...state.uiVisibility,
          folderTree: true,
          leftBottomPanel: true,
        },
        activeRightPanel: snapshot.activeRightPanel,
        renderedRightPanel: snapshot.renderedRightPanel,
        isLibraryExportPanelVisible: snapshot.isLibraryExportPanelVisible,
      });
      setTimeout(() => set({ isInstantTransition: false }), 400);
    } else {
      set({
        isInstantTransition: true,
        cleanViewActive: true,
        cleanViewSnapshot: {
          activeRightPanel: state.activeRightPanel,
          renderedRightPanel: state.renderedRightPanel,
          isLibraryExportPanelVisible: state.isLibraryExportPanelVisible,
        },
        uiVisibility: {
          ...state.uiVisibility,
          folderTree: false,
          leftBottomPanel: false,
          filmstrip: false,
        },
        activeRightPanel: null,
        isLibraryExportPanelVisible: false,
      });
      setTimeout(() => set({ isInstantTransition: false }), 400);
    }
  },
}));
