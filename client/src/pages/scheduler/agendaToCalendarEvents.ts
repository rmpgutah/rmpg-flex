// Pure mapping: unified-agenda items (from GET /api/scheduler/agenda) → FullCalendar EventInput.
// Kept dependency-free (no FullCalendar imports) so it's unit-testable without mounting the grid.

export type AgendaSource = 'serve' | 'shift' | 'court' | 'custom';

export interface AgendaItem {
  key: string;
  source: AgendaSource;
  id: number | string;
  date: string;
  start: string | null;
  end: string | null;
  title: string;
  subtitle: string | null;
  officer_id: number | null;
  status: string | null;
  link: string | null;
}

// court_events are imported from an external calendar — RMPG doesn't own that
// data, so writing a moved date back would silently diverge from the source
// of truth. serve/shift/custom are all backed by tables this app owns.
const DRAGGABLE: ReadonlySet<AgendaSource> = new Set(['serve', 'shift', 'custom']);

export function isDraggableSource(source: AgendaSource): boolean {
  return DRAGGABLE.has(source);
}

export const SOURCE_COLORS: Record<AgendaSource, string> = {
  serve: '#d4a017',   // brand gold
  shift: '#7dd3fc',   // blue-300
  court: '#c4b5fd',   // purple-300
  custom: '#6ee7b7',  // emerald-300
};

export interface CalendarEventInput {
  id: string;
  title: string;
  start: string;
  end?: string;
  allDay?: boolean;
  editable: boolean;
  backgroundColor: string;
  extendedProps: {
    source: AgendaSource;
    originalId: number | string;
    officerId: number | null;
  };
}

export function agendaItemToEvent(item: AgendaItem): CalendarEventInput {
  const allDay = !item.start;
  return {
    id: item.key,
    title: item.title,
    start: allDay ? item.date : `${item.date}T${item.start}:00`,
    end: !allDay && item.end ? `${item.date}T${item.end}:00` : undefined,
    allDay,
    editable: isDraggableSource(item.source),
    backgroundColor: SOURCE_COLORS[item.source],
    extendedProps: {
      source: item.source,
      originalId: item.id,
      officerId: item.officer_id,
    },
  };
}
