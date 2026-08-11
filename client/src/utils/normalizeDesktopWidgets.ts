export interface DesktopWidgetState {
  id: string;
  x: number;
  y: number;
  on: boolean;
  opacity: number;
  blur: number;
}

export const ALL_WIDGET_IDS = [
  'clock', 'ops-summary', 'notifications', 'quick-access',
  'shift-timer', 'pinned-call-ticker', 'mini-map',
  'weather', 'radio-channel', 'roll-call', 'incident-timer', 'gps-trail', 'shift-handoff',
  'panic', 'warrant-count', 'body-cam', 'message-count',
] as const;

export const V1_DEFAULT_ON_IDS: readonly string[] = ['clock', 'ops-summary', 'notifications', 'quick-access'];

function defaultPositionFor(index: number): { x: number; y: number } {
  // Stacked, matching v1's fixed DesktopWidgetPanel layout — only used as a
  // starting point; the user can drag afterward (Task 10). x=700 keeps the
  // widest widget (mini-map, 260px) fully on-screen down to a 1024px-wide
  // viewport (a real deployment target — Toughbook/MDT displays), unlike the
  // old x=1180 which assumed a ~1280px+ viewport and spawned new widgets
  // off-screen — undraggable back into view — on narrower ones. This is a
  // pure function with no DOM/window access (called from tests and
  // server-adjacent contexts), so the fix is a lower fixed default rather
  // than a window.innerWidth-based clamp.
  return { x: 700, y: 16 + index * 160 };
}

function defaultWidget(id: string, index: number, on: boolean): DesktopWidgetState {
  return { id, ...defaultPositionFor(index), on, opacity: 1, blur: 0 };
}

export function normalizeDesktopWidgets(raw: string | null | undefined): DesktopWidgetState[] {
  let parsed: unknown = null;
  if (raw) {
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
  }

  // v1 shape: a bare array of on-widget id strings (order = display order)
  if (Array.isArray(parsed) && (parsed.length === 0 || typeof parsed[0] === 'string')) {
    const onIds = new Set(parsed as string[]);
    return ALL_WIDGET_IDS.map((id, i) => defaultWidget(id, i, onIds.has(id)));
  }

  // v2 shape: an array of per-widget state objects
  if (Array.isArray(parsed)) {
    const byId = new Map((parsed as Partial<DesktopWidgetState>[]).map(w => [w.id as string, w]));
    return ALL_WIDGET_IDS.map((id, i) => {
      const saved = byId.get(id);
      if (!saved) return defaultWidget(id, i, false);
      const fallback = defaultPositionFor(i);
      return {
        id,
        x: saved.x ?? fallback.x,
        y: saved.y ?? fallback.y,
        on: saved.on ?? false,
        opacity: saved.opacity ?? 1,
        blur: saved.blur ?? 0,
      };
    });
  }

  // null/undefined/invalid — v1 defaults, new widgets start off
  return ALL_WIDGET_IDS.map((id, i) => defaultWidget(id, i, V1_DEFAULT_ON_IDS.includes(id)));
}

export function serializeDesktopWidgets(widgets: DesktopWidgetState[]): string {
  return JSON.stringify(widgets);
}
