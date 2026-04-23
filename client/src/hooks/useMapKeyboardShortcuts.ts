// ============================================================
// RMPG Flex — useMapKeyboardShortcuts
// Global keydown handler that toggles map overlays via single-
// key shortcuts. Dispatchers hitting H to flip the heatmap is
// faster than hunting for the toolbar button, especially on a
// P1 when the map toolbar is partially obscured by the route
// panel or active-calls list.
//
// Shortcuts are IGNORED when:
//  - focus is in an input, textarea, or contenteditable (so
//    typing "h" in a search box doesn't flip the heatmap)
//  - a modifier key (ctrl/cmd/alt) is held (don't collide with
//    browser shortcuts like Cmd+R for reload)
//
// Keys map to overlay toggles one-for-one; mapping is fixed
// for muscle memory across shifts.
// ============================================================

import { useEffect } from 'react';

export interface MapShortcutHandlers {
  /** H — heatmap toggle */
  toggleHeatmap?: () => void;
  /** B — breadcrumb trails toggle */
  toggleBreadcrumbs?: () => void;
  /** C — call clustering toggle */
  toggleClustering?: () => void;
  /** P — patrol checkpoints toggle */
  togglePatrolCheckpoints?: () => void;
  /** F — field interviews toggle */
  toggleFieldInterviews?: () => void;
  /** D — daylight overlay toggle */
  toggleDaylight?: () => void;
  /** I — incident reports toggle */
  toggleIncidentReports?: () => void;
  /** E — enforcement clusters toggle */
  toggleEnforcementClusters?: () => void;
}

/** Show a toast/banner with the shortcut list. Provided by caller. */
export type ShowHelpFn = () => void;

function isTypingInField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

export function useMapKeyboardShortcuts(
  handlers: MapShortcutHandlers,
  showHelp?: ShowHelpFn,
  /** Master enable flag — lets users disable shortcuts entirely */
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(e: KeyboardEvent) {
      if (isTypingInField(e.target)) return;
      // Skip when modifiers are held — don't clash with Cmd+R, Ctrl+F, etc.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key.toLowerCase();
      const match = (() => {
        switch (key) {
          case 'h': return handlers.toggleHeatmap;
          case 'b': return handlers.toggleBreadcrumbs;
          case 'c': return handlers.toggleClustering;
          case 'p': return handlers.togglePatrolCheckpoints;
          case 'f': return handlers.toggleFieldInterviews;
          case 'd': return handlers.toggleDaylight;
          case 'i': return handlers.toggleIncidentReports;
          case 'e': return handlers.toggleEnforcementClusters;
          case '?': return showHelp;
          default: return null;
        }
      })();
      if (!match) return;
      // Prevent the default browser behavior (e.g. "/" quick-find) for
      // any key we consume, so officers don't also get an unrelated
      // browser side-effect.
      e.preventDefault();
      match();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, handlers, showHelp]);
}

/** Pretty list of the shortcut bindings — for help overlays. */
export const MAP_SHORTCUT_BINDINGS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'H', label: 'Heatmap' },
  { key: 'B', label: 'Breadcrumb trails' },
  { key: 'C', label: 'Call clustering' },
  { key: 'P', label: 'Patrol checkpoints' },
  { key: 'F', label: 'Field interviews' },
  { key: 'D', label: 'Daylight overlay' },
  { key: 'I', label: 'Incident reports' },
  { key: 'E', label: 'Enforcement clusters' },
  { key: '?', label: 'Show this help' },
];
