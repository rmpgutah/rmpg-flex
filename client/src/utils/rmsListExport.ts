import { downloadTextFile } from './intelHitExport';

export { downloadTextFile };

function cell(c: unknown): string {
  return `"${String(c ?? '').replace(/"/g, '""')}"`;
}

function csvRows(header: string[], rows: unknown[][]): string {
  return [header.join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n');
}

export function tipsToCsv(rows: Array<{
  tracking_number: string;
  tip_type: string;
  urgency: string;
  status: string;
  location: string;
  assigned_to_name: string | null;
}>): string {
  return csvRows(
    ['tracking', 'type', 'urgency', 'status', 'location', 'assigned'],
    rows.map((r) => [r.tracking_number, r.tip_type, r.urgency, r.status, r.location ?? '', r.assigned_to_name ?? '']),
  );
}

/** Anonymous reports drop contact fields so CSV cannot re-identify a tipster. */
export function communityReportsToCsv(rows: Array<{
  tracking_number: string;
  report_type: string;
  status: string;
  location: string;
  anonymous: boolean;
  reporter_name: string;
  reporter_phone: string;
  reporter_email: string;
  description: string;
}>): string {
  return csvRows(
    ['tracking', 'type', 'status', 'location', 'anonymous', 'reporter', 'contact', 'description'],
    rows.map((r) => {
      const name = r.anonymous ? '[anonymous]' : r.reporter_name;
      const contact = r.anonymous ? '' : `${r.reporter_phone} ${r.reporter_email}`.trim();
      return [r.tracking_number, r.report_type, r.status, r.location, r.anonymous ? 'yes' : 'no', name, contact, r.description];
    }),
  );
}

export function broadcastsToCsv(rows: Array<{
  message: string;
  priority: string;
  target: string;
  target_id: string | null;
  sender_name: string;
  created_at: string;
}>): string {
  return csvRows(
    ['created_at', 'priority', 'target', 'sender', 'message'],
    rows.map((r) => [r.created_at, r.priority, r.target_id ? `${r.target}:${r.target_id}` : r.target, r.sender_name, r.message]),
  );
}

export function lockUnitsToCsv(rows: Array<{
  unit_id: string;
  officer_name: string;
  badge: string;
  status: string;
  reason?: string;
}>): string {
  return csvRows(
    ['unit', 'officer', 'badge', 'status', 'reason'],
    rows.map((r) => [r.unit_id, r.officer_name, r.badge, r.status, r.reason ?? '']),
  );
}

export function crashReportsToCsv(rows: Array<{
  report_number: string;
  crash_date: string;
  location: string;
  crash_type: string;
  severity: string;
  vehicles_involved: number;
  injuries: number;
  fatalities: number;
  status: string;
}>): string {
  return csvRows(
    ['report', 'date', 'location', 'type', 'severity', 'vehicles', 'injuries', 'fatalities', 'status'],
    rows.map((r) => [r.report_number, r.crash_date, r.location, r.crash_type, r.severity, r.vehicles_involved, r.injuries, r.fatalities, r.status]),
  );
}

export function briefingsToCsv(rows: Array<{
  briefing_number: string;
  title: string;
  shift_type: string;
  created_by: string;
  created_at: string;
  acknowledged_count: number;
  total_officers: number;
}>): string {
  return csvRows(
    ['number', 'title', 'shift', 'author', 'created_at', 'acked', 'roster'],
    rows.map((r) => [r.briefing_number, r.title, r.shift_type, r.created_by, r.created_at, r.acknowledged_count, r.total_officers]),
  );
}

export function shiftNotesToCsv(rows: Array<{
  officer_name: string;
  visibility: string;
  tags: string[];
  created_at: string;
  content: string;
}>): string {
  return csvRows(
    ['officer', 'visibility', 'tags', 'created_at', 'content'],
    rows.map((r) => [r.officer_name, r.visibility, (r.tags ?? []).join('|'), r.created_at, r.content]),
  );
}

export function formatRadioLine(u: {
  unit_id: string;
  officer_name: string;
  status: string;
  location_description?: string | null;
  current_call_number?: string | null;
}): string {
  const where = u.current_call_number
    ? `call ${u.current_call_number}`
    : (u.location_description?.trim() || 'no location');
  return `${u.unit_id} ${u.status} — ${u.officer_name} — ${where}`;
}

export function unitsBoardToCsv(rows: Array<{
  unit_id: string;
  officer_name: string;
  badge: string;
  status: string;
  role?: string;
  current_call_number?: string | null;
  location_description?: string | null;
}>): string {
  return csvRows(
    ['unit', 'officer', 'badge', 'status', 'role', 'call', 'location'],
    rows.map((r) => [r.unit_id, r.officer_name, r.badge, r.status, r.role ?? '', r.current_call_number ?? '', r.location_description ?? '']),
  );
}

export function unitsBoardToTsv(rows: Array<{
  unit_id: string;
  officer_name: string;
  status: string;
  current_call_number?: string | null;
}>): string {
  return ['unit\tofficer\tstatus\tcall', ...rows.map((r) => [r.unit_id, r.officer_name, r.status, r.current_call_number ?? ''].join('\t'))].join('\n');
}

export function trainingCoursesToCsv(rows: Array<{
  course_name?: string;
  course_code?: string;
  category?: string;
  duration_hours?: string | number;
  location?: string;
  is_mandatory?: number | boolean;
}>): string {
  return csvRows(
    ['name', 'code', 'category', 'hours', 'location', 'mandatory'],
    rows.map((r) => [r.course_name ?? '', r.course_code ?? '', r.category ?? '', r.duration_hours ?? '', r.location ?? '', r.is_mandatory ? 'yes' : 'no']),
  );
}

export function fileListingToCsv(rows: Array<{ name: string; size: number; modified: string; path: string }>): string {
  return csvRows(
    ['name', 'size', 'modified', 'path'],
    rows.map((r) => [r.name, r.size, r.modified, r.path]),
  );
}
