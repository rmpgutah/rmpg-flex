// ============================================================
// RMPG Flex — Timeline Visualization (vis-timeline)
// ============================================================
// Interactive timeline component for:
// - Incident event reconstruction
// - Chain-of-custody tracking
// - Officer shift scheduling
// - Court appearance scheduling
// - Case investigation timelines
// ============================================================

import { Timeline } from 'vis-timeline/standalone';
import { DataSet } from 'vis-data/standalone';
import 'vis-timeline/styles/vis-timeline-graph2d.css';

// ── Types ─────────────────────────────────────────────────

export interface TimelineEvent {
  id: number | string;
  content: string;
  start: Date | string;
  end?: Date | string;
  group?: string | number;
  className?: string;
  type?: 'box' | 'point' | 'range' | 'background';
  style?: string;
  title?: string; // Tooltip
}

export interface TimelineGroup {
  id: string | number;
  content: string;
  className?: string;
  style?: string;
  order?: number;
}

export interface TimelineConfig {
  /** Container element to mount the timeline */
  container: HTMLElement;
  /** Timeline events/items */
  events: TimelineEvent[];
  /** Optional grouping (e.g., by officer, by evidence type) */
  groups?: TimelineGroup[];
  /** Timeline options */
  options?: {
    editable?: boolean;
    zoomMin?: number;
    zoomMax?: number;
    stack?: boolean;
    showCurrentTime?: boolean;
    orientation?: 'top' | 'bottom' | 'both';
  };
  /** Click handler */
  onSelect?: (ids: (string | number)[]) => void;
}

// ── RMPG Flex dark theme styles ───────────────────────────
// Applied via CSS class overrides to match Spillman Flex aesthetic

const DARK_THEME_STYLES = `
  .vis-timeline {
    background: #0a0a0a !important;
    border-color: #222 !important;
    font-family: system-ui, -apple-system, sans-serif !important;
  }
  .vis-item {
    background: #1a1a1a !important;
    border-color: #d4a017 !important;
    color: #ccc !important;
    border-radius: 2px !important;
    font-size: 11px !important;
  }
  .vis-item.vis-selected {
    background: #2a2000 !important;
    border-color: #d4a017 !important;
  }
  .vis-item.vis-point .vis-dot {
    border-color: #d4a017 !important;
  }
  .vis-time-axis .vis-text {
    color: #888 !important;
    font-size: 10px !important;
  }
  .vis-time-axis .vis-grid.vis-minor {
    border-color: #1a1a1a !important;
  }
  .vis-time-axis .vis-grid.vis-major {
    border-color: #333 !important;
  }
  .vis-current-time {
    background-color: #d4a017 !important;
  }
  .vis-panel.vis-center {
    border-color: #222 !important;
  }
  .vis-labelset .vis-label {
    color: #aaa !important;
    background: #0a0a0a !important;
    border-color: #222 !important;
  }
  .vis-item.priority-1 { border-color: #ff0000 !important; }
  .vis-item.priority-2 { border-color: #ff8c00 !important; }
  .vis-item.priority-3 { border-color: #d4a017 !important; }
`;

let styleInjected = false;

function injectDarkTheme(): void {
  if (styleInjected) return;
  const style = document.createElement('style');
  style.textContent = DARK_THEME_STYLES;
  document.head.appendChild(style);
  styleInjected = true;
}

// ── Timeline factory ──────────────────────────────────────

/**
 * Create an interactive timeline visualization.
 * Returns a cleanup function and the timeline instance.
 */
export function createTimeline(config: TimelineConfig): {
  timeline: Timeline;
  destroy: () => void;
  addEvent: (event: TimelineEvent) => void;
  removeEvent: (id: string | number) => void;
  setEvents: (events: TimelineEvent[]) => void;
  fitAll: () => void;
} {
  injectDarkTheme();

  const items = new DataSet(config.events);
  const groups = config.groups ? new DataSet(config.groups) : undefined;

  const defaultOptions = {
    editable: false,
    stack: true,
    showCurrentTime: true,
    orientation: { axis: 'bottom' as const },
    zoomMin: 1000 * 60 * 5, // 5 minutes
    zoomMax: 1000 * 60 * 60 * 24 * 365, // 1 year
    margin: { item: 5 },
    ...config.options,
  };

  const timeline = new Timeline(config.container, items, defaultOptions);
  if (groups) {
    timeline.setGroups(groups);
  }

  if (config.onSelect) {
    timeline.on('select', (props: { items: (string | number)[] }) => {
      config.onSelect?.(props.items);
    });
  }

  return {
    timeline,
    destroy: () => timeline.destroy(),
    addEvent: (event: TimelineEvent) => items.add(event),
    removeEvent: (id: string | number) => items.remove(id),
    setEvents: (events: TimelineEvent[]) => {
      items.clear();
      items.add(events);
    },
    fitAll: () => timeline.fit(),
  };
}

// ── Preset configurations ─────────────────────────────────

/**
 * Create groups for incident timeline (by category).
 */
export function incidentTimelineGroups(): TimelineGroup[] {
  return [
    { id: 'dispatch', content: 'Dispatch', order: 1 },
    { id: 'response', content: 'Response', order: 2 },
    { id: 'investigation', content: 'Investigation', order: 3 },
    { id: 'evidence', content: 'Evidence', order: 4 },
    { id: 'court', content: 'Court', order: 5 },
  ];
}

/**
 * Create groups for chain-of-custody timeline.
 */
export function custodyTimelineGroups(): TimelineGroup[] {
  return [
    { id: 'collection', content: 'Collection', order: 1 },
    { id: 'transfer', content: 'Transfer', order: 2 },
    { id: 'storage', content: 'Storage', order: 3 },
    { id: 'analysis', content: 'Analysis', order: 4 },
    { id: 'disposition', content: 'Disposition', order: 5 },
  ];
}
