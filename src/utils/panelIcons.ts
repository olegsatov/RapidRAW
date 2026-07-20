import {
  SlidersHorizontal,
  Info,
  Crop,
  Film,
  Layers,
  Paintbrush,
  FileInput,
  Bookmark,
  type LucideIcon,
} from 'lucide-react';
import { Panel } from '../components/ui/AppProperties';

export const PANEL_ICON_SIZE = 14;

export function getPanelIcon(panel: Panel | null): LucideIcon | null {
  switch (panel) {
    case Panel.Adjustments:
      return SlidersHorizontal;
    case Panel.Metadata:
      return Info;
    case Panel.Crop:
      return Crop;
    case Panel.Film:
      return Film;
    case Panel.Masks:
      return Layers;
    case Panel.Ai:
      return Paintbrush;
    case Panel.Export:
      return FileInput;
    case Panel.Presets:
      return Bookmark;
    default:
      return null;
  }
}
