import { type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { MotionConfig } from 'framer-motion';
import clsx from 'clsx';

import FolderTree from '../FolderTree';
import EditorToolsPanel from './EditorToolsPanel';
import HistoryPanel from './HistoryPanel';
import Resizer from '../../ui/Resizer';

import { Orientation, AlbumItem } from '../../ui/AppProperties';

export interface LeftSidebarProps {
  mode: 'gallery' | 'editor';
  isResizing: boolean;
  isInstantTransition: boolean;
  isFullScreen: boolean;
  leftPanelWidth: number;
  leftBottomPanelHeight: number;
  folderTreeVisible: boolean;
  leftBottomPanelVisible: boolean;
  createResizeHandler: (stateKey: string, startSize: number) => (e: ReactPointerEvent<HTMLDivElement>) => void;
  onFolderSelect: (path: string) => void;
  onToggleFolder: (path: string) => void;
  onSelectAlbum: (id: string, name: string, images: string[]) => void;
  onOpenFolder: () => void;
  onFolderTreeContextMenu: (e: ReactMouseEvent<HTMLElement>, path: string | null, isPinned?: boolean) => void;
  onAlbumTreeContextMenu: (e: ReactMouseEvent<HTMLElement>, item: AlbumItem | null) => void;
  setFolderTreeVisible: (visible: boolean) => void;
}

export default function LeftSidebar({
  mode,
  isResizing,
  isInstantTransition,
  isFullScreen,
  leftPanelWidth,
  leftBottomPanelHeight,
  folderTreeVisible,
  leftBottomPanelVisible,
  createResizeHandler,
  onFolderSelect,
  onToggleFolder,
  onSelectAlbum,
  onOpenFolder,
  onFolderTreeContextMenu,
  onAlbumTreeContextMenu,
  setFolderTreeVisible,
}: LeftSidebarProps) {
  const isEditor = mode === 'editor';

  return (
    <div
      className={clsx(
        'flex h-full overflow-hidden shrink-0',
        !isResizing && !isInstantTransition && 'transition-all duration-300 ease-in-out',
      )}
      style={{
        maxWidth: isFullScreen ? '0px' : '1000px',
        opacity: isFullScreen ? 0 : 1,
      }}
    >
      <div className="flex flex-col h-full" style={{ width: folderTreeVisible ? `${leftPanelWidth}px` : '32px' }}>
        <div className="flex-1 min-h-0 overflow-hidden">
          <MotionConfig reducedMotion={isInstantTransition ? 'always' : 'user'}>
            {isEditor ? (
              <EditorToolsPanel isVisible={folderTreeVisible} isInstantTransition={isInstantTransition} />
            ) : (
              <FolderTree
                isResizing={isResizing}
                isVisible={folderTreeVisible}
                onContextMenu={onFolderTreeContextMenu}
                onAlbumContextMenu={onAlbumTreeContextMenu}
                onSelectAlbum={onSelectAlbum}
                onFolderSelect={onFolderSelect}
                onToggleFolder={onToggleFolder}
                onOpenFolder={onOpenFolder}
                setIsVisible={setFolderTreeVisible}
                style={{ width: '100%', height: '100%' }}
                isInstantTransition={isInstantTransition}
              />
            )}
          </MotionConfig>
        </div>
        {folderTreeVisible && leftBottomPanelVisible && (
          <>
            <Resizer
              direction={Orientation.Horizontal}
              onMouseDown={createResizeHandler('leftBottom', leftBottomPanelHeight)}
            />
            <div
              className="shrink-0 overflow-hidden"
              style={{ height: leftBottomPanelHeight > 0 ? `${leftBottomPanelHeight}px` : '50%' }}
            >
              {isEditor ? <HistoryPanel /> : <div className="flex flex-col h-full bg-bg-secondary rounded-lg" />}
            </div>
          </>
        )}
      </div>
      <Resizer direction={Orientation.Vertical} onMouseDown={createResizeHandler('left', leftPanelWidth)} />
    </div>
  );
}
