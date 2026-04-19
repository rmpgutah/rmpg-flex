import { useEffect } from 'react';
import { Copy, MapPin, Phone, Search, X } from 'lucide-react';
import type { ContextMenuState } from '../hooks/useOlContextMenu';

interface MapV2ContextMenuProps {
  menu: ContextMenuState | null;
  onClose: () => void;
  onCreateCall?: (lat: number, lng: number) => void;
  onSearchNearby?: (lat: number, lng: number) => void;
}

function fmtCoord(n: number, axis: 'lat' | 'lng'): string {
  const abs = Math.abs(n).toFixed(6);
  const dir = axis === 'lat' ? (n >= 0 ? 'N' : 'S') : (n >= 0 ? 'E' : 'W');
  return `${abs}\u00B0${dir}`;
}

/**
 * Right-click context menu for /map-v2 — Spillman dark, top-aligned at
 * the click pixel. Closes on click-anywhere or Escape. Each action is
 * a one-liner that uses the captured (lat, lng) from useOlContextMenu.
 */
export default function MapV2ContextMenu({
  menu, onClose, onCreateCall, onSearchNearby,
}: MapV2ContextMenuProps) {
  // Close on Escape or any click outside
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => {
      // Right-click dispatches contextmenu first then mousedown; ignore
      // the same-event mousedown by checking button (right-click=2)
      if (e.button === 2) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  const coordText = `${fmtCoord(menu.lat, 'lat')} ${fmtCoord(menu.lng, 'lng')}`;
  const decimalText = `${menu.lat.toFixed(6)}, ${menu.lng.toFixed(6)}`;

  function copyCoords() {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(decimalText).catch(() => { /* ignore */ });
    }
    onClose();
  }

  return (
    <div
      role="menu"
      aria-label="Map context menu"
      className="fixed z-[200] bg-[#0a0a0a] border border-[#222222] font-mono text-[10px] uppercase tracking-wider select-none shadow-lg min-w-[200px]"
      style={{ left: menu.x, top: menu.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-[#222222] bg-[#0d0d0d]">
        <div className="flex items-center gap-1.5">
          <MapPin className="w-3 h-3 text-[#d4a017]" aria-hidden="true" />
          <span className="text-[9px] text-[#e5e7eb]">{coordText}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          className="p-0.5 hover:bg-[#1a1a1a] text-[#888888]"
        >
          <X className="w-3 h-3" aria-hidden="true" />
        </button>
      </div>
      <button
        type="button"
        role="menuitem"
        onClick={copyCoords}
        className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-[#1a1a1a] text-left text-[#e5e7eb]"
      >
        <Copy className="w-3 h-3 text-[#9ca3af]" aria-hidden="true" />
        Copy Coordinates
      </button>
      {onCreateCall && (
        <button
          type="button"
          role="menuitem"
          onClick={() => { onCreateCall(menu.lat, menu.lng); onClose(); }}
          className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-[#1a1a1a] text-left text-[#e5e7eb]"
        >
          <Phone className="w-3 h-3 text-[#9ca3af]" aria-hidden="true" />
          Create Call Here
        </button>
      )}
      {onSearchNearby && (
        <button
          type="button"
          role="menuitem"
          onClick={() => { onSearchNearby(menu.lat, menu.lng); onClose(); }}
          className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-[#1a1a1a] text-left text-[#e5e7eb]"
        >
          <Search className="w-3 h-3 text-[#9ca3af]" aria-hidden="true" />
          Search Nearby
        </button>
      )}
    </div>
  );
}
