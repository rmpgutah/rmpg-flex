import { useEffect } from 'react';
import type OlMap from 'ol/Map';
import { fromLonLat } from 'ol/proj';

interface ShortcutHandlers {
  onRecenter?: () => void;
  onScreenshot?: () => void;
  onToggleLayers?: () => void;
  onToggleFullscreen?: () => void;
  onLocate?: () => void;
}

/**
 * Map-v2 keyboard shortcuts. All single-key (no modifiers) so they
 * don't conflict with browser/OS shortcuts. Active only when the focus
 * isn't inside an input/textarea/contenteditable, so typing in the
 * search bar doesn't trigger them.
 *
 * Shortcuts (familiar navigation keybindings where possible):
 *   R - Recenter map
 *   F - Toggle fullscreen
 *   L - Toggle layers panel
 *   M - Trigger screenshot (M = mark/snap)
 *   G - Trigger geolocate (G = go to me)
 *   + / - - Zoom (handled natively by OL)
 *   Esc - Closes context menu / popups (handled by their own components)
 */
export function useMapV2Shortcuts(map: OlMap | null, h: ShortcutHandlers): void {
  useEffect(() => {
    if (!map) return;
    function isEditable(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (el.isContentEditable) return true;
      return false;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditable(e.target)) return;
      const key = e.key.toLowerCase();
      switch (key) {
        case 'r': h.onRecenter?.(); break;
        case 'f': h.onToggleFullscreen?.(); break;
        case 'l': h.onToggleLayers?.(); break;
        case 'm': h.onScreenshot?.(); break;
        case 'g': h.onLocate?.(); break;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [map, h.onRecenter, h.onToggleFullscreen, h.onToggleLayers, h.onScreenshot, h.onLocate]);
}

// Default SLC center — exported so MapPageV2 can wire R to it without
// a circular import.
export const DEFAULT_CENTER_3857 = fromLonLat([-111.891, 40.760]);
