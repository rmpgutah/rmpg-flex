// ============================================================
// RMPG Flex — Map Top Toolbar
// Slim, always-visible top bar: map chrome (scale/fullscreen/
// minimap/style), bookmarks, snapshot export. Address search is
// NOT here — it's Mapbox's own native Geocoder control, added
// separately via map.addControl (see MapboxMapPage.tsx).
// ============================================================

import IconButton from '../../../components/IconButton';
import { Ruler, Maximize, Map as MapIcon, Star, Download, ListTree, ImageDown, Clipboard } from 'lucide-react';
import { MAP_STYLE_LABELS, type MapStyleId } from '../utils/mapConstants';

export interface MapTopToolbarProps {
  scaleEnabled: boolean;
  onToggleScale: () => void;
  fullscreenEnabled: boolean;
  onToggleFullscreen: () => void;
  minimapOpen: boolean;
  onToggleMinimap: () => void;
  mapStyle: MapStyleId;
  onStyleChange: (id: MapStyleId) => void;
  showBookmarksPanel: boolean;
  onToggleBookmarks: () => void;
  legendOpen: boolean;
  onToggleLegend: () => void;
  onSnapshot: () => void;
  onExportImage: () => void;
  onCopyImage?: () => void;
}

const ITEM_CLASS = 'p-1.5 transition-colors';

export default function MapTopToolbar({
  scaleEnabled, onToggleScale, fullscreenEnabled, onToggleFullscreen,
  minimapOpen, onToggleMinimap, mapStyle, onStyleChange,
  showBookmarksPanel, onToggleBookmarks, legendOpen, onToggleLegend, onSnapshot,
  onExportImage, onCopyImage,
}: MapTopToolbarProps) {
  return (
    <div className="relative z-20 flex items-center gap-1 px-2 h-9 w-full bg-surface-raised/95 border-b border-border-default backdrop-blur-sm">
      <IconButton
        aria-label={scaleEnabled ? 'Hide scale bar' : 'Show scale bar'}
        onClick={onToggleScale}
        className={`${ITEM_CLASS} ${scaleEnabled ? 'text-rmpg-100' : 'text-rmpg-300 hover:text-rmpg-100'}`}
      >
        <Ruler className="w-4 h-4" />
      </IconButton>
      <IconButton
        aria-label={fullscreenEnabled ? 'Exit fullscreen' : 'Enter fullscreen'}
        onClick={onToggleFullscreen}
        className={`${ITEM_CLASS} ${fullscreenEnabled ? 'text-rmpg-100' : 'text-rmpg-300 hover:text-rmpg-100'}`}
      >
        <Maximize className="w-4 h-4" />
      </IconButton>
      <IconButton
        aria-label={minimapOpen ? 'Hide minimap' : 'Show minimap'}
        onClick={onToggleMinimap}
        className={`${ITEM_CLASS} ${minimapOpen ? 'text-rmpg-100' : 'text-rmpg-300 hover:text-rmpg-100'}`}
      >
        <MapIcon className="w-4 h-4" />
      </IconButton>
      <select
        aria-label="Map style"
        value={mapStyle}
        onChange={(e) => onStyleChange(e.target.value as MapStyleId)}
        className="text-[10px] bg-transparent text-rmpg-300 border border-border-subtle px-1.5 py-1"
        style={{ borderRadius: 2 }}
      >
        {(Object.keys(MAP_STYLE_LABELS) as MapStyleId[]).map((id) => (
          <option key={id} value={id}>{MAP_STYLE_LABELS[id]}</option>
        ))}
      </select>
      <div className="flex-1" />
      <IconButton
        aria-label={showBookmarksPanel ? 'Hide bookmarks' : 'Show bookmarks'}
        onClick={onToggleBookmarks}
        className={`${ITEM_CLASS} ${showBookmarksPanel ? 'text-rmpg-100' : 'text-rmpg-300 hover:text-rmpg-100'}`}
      >
        <Star className="w-4 h-4" />
      </IconButton>
      <IconButton
        aria-label={legendOpen ? 'Hide legend' : 'Show legend'}
        onClick={onToggleLegend}
        className={`${ITEM_CLASS} ${legendOpen ? 'text-rmpg-100' : 'text-rmpg-300 hover:text-rmpg-100'}`}
      >
        <ListTree className="w-4 h-4" />
      </IconButton>
      <IconButton
        aria-label="Capture snapshot"
        onClick={onSnapshot}
        className={`${ITEM_CLASS} text-rmpg-300 hover:text-rmpg-100`}
      >
        <Download className="w-4 h-4" />
      </IconButton>
      <IconButton
        aria-label="Export map image"
        onClick={onExportImage}
        className={`${ITEM_CLASS} text-rmpg-300 hover:text-rmpg-100`}
      >
        <ImageDown className="w-4 h-4" />
      </IconButton>
      {onCopyImage && (
        <IconButton
          aria-label="Copy map image"
          onClick={onCopyImage}
          className={`${ITEM_CLASS} text-rmpg-300 hover:text-rmpg-100`}
        >
          <Clipboard className="w-4 h-4" />
        </IconButton>
      )}
    </div>
  );
}
