import { downloadTextFile } from './intelHitExport';

export { downloadTextFile };

function cell(c: unknown): string {
  return `"${String(c ?? '').replace(/"/g, '""')}"`;
}

export function rowsToCsv(header: string[], rows: unknown[][]): string {
  return [header.join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n');
}

export function tipsToCsv(rows: Array<{
  tracking_number: string; tip_type: string; urgency: string; status: string;
  location: string; assigned_to_name: string | null;
}>): string {
  return rowsToCsv(['tracking', 'type', 'urgency', 'status', 'location', 'assigned'],
    rows.map((r) => [r.tracking_number, r.tip_type, r.urgency, r.status, r.location ?? '', r.assigned_to_name ?? '']));
}

export function communityReportsToCsv(rows: Array<{
  tracking_number: string; report_type: string; status: string; location: string;
  anonymous: boolean; reporter_name: string; reporter_phone: string; reporter_email: string; description: string;
}>): string {
  return rowsToCsv(['tracking', 'type', 'status', 'location', 'anonymous', 'reporter', 'contact', 'description'],
    rows.map((r) => {
      const name = r.anonymous ? '[anonymous]' : r.reporter_name;
      const contact = r.anonymous ? '' : `${r.reporter_phone} ${r.reporter_email}`.trim();
      return [r.tracking_number, r.report_type, r.status, r.location, r.anonymous ? 'yes' : 'no', name, contact, r.description];
    }));
}

export function broadcastsToCsv(rows: Array<{
  message: string; priority: string; target: string; target_id: string | null; sender_name: string; created_at: string;
}>): string {
  return rowsToCsv(['created_at', 'priority', 'target', 'sender', 'message'],
    rows.map((r) => [r.created_at, r.priority, r.target_id ? `${r.target}:${r.target_id}` : r.target, r.sender_name, r.message]));
}

export function lockUnitsToCsv(rows: Array<{
  unit_id: string; officer_name: string; badge: string; status: string; reason?: string;
}>): string {
  return rowsToCsv(['unit', 'officer', 'badge', 'status', 'reason'],
    rows.map((r) => [r.unit_id, r.officer_name, r.badge, r.status, r.reason ?? '']));
}

export function crashReportsToCsv(rows: Array<{
  report_number: string; crash_date: string; location: string; crash_type: string; severity: string;
  vehicles_involved: number; injuries: number; fatalities: number; status: string;
}>): string {
  return rowsToCsv(['report', 'date', 'location', 'type', 'severity', 'vehicles', 'injuries', 'fatalities', 'status'],
    rows.map((r) => [r.report_number, r.crash_date, r.location, r.crash_type, r.severity, r.vehicles_involved, r.injuries, r.fatalities, r.status]));
}

export function briefingsToCsv(rows: Array<{
  briefing_number: string; title: string; shift_type: string; created_by: string;
  created_at: string; acknowledged_count: number; total_officers: number;
}>): string {
  return rowsToCsv(['number', 'title', 'shift', 'author', 'created_at', 'acked', 'roster'],
    rows.map((r) => [r.briefing_number, r.title, r.shift_type, r.created_by, r.created_at, r.acknowledged_count, r.total_officers]));
}

export function shiftNotesToCsv(rows: Array<{
  officer_name: string; visibility: string; tags: string[]; created_at: string; content: string;
}>): string {
  return rowsToCsv(['officer', 'visibility', 'tags', 'created_at', 'content'],
    rows.map((r) => [r.officer_name, r.visibility, (r.tags ?? []).join('|'), r.created_at, r.content]));
}

export function formatRadioLine(u: {
  unit_id: string; officer_name: string; status: string;
  location_description?: string | null; current_call_number?: string | null;
}): string {
  const where = u.current_call_number ? `call ${u.current_call_number}` : (u.location_description?.trim() || 'no location');
  return `${u.unit_id} ${u.status} — ${u.officer_name} — ${where}`;
}

export function unitsBoardToCsv(rows: Array<{
  unit_id: string; officer_name: string; badge: string; status: string;
  role?: string; current_call_number?: string | null; location_description?: string | null;
}>): string {
  return rowsToCsv(['unit', 'officer', 'badge', 'status', 'role', 'call', 'location'],
    rows.map((r) => [r.unit_id, r.officer_name, r.badge, r.status, r.role ?? '', r.current_call_number ?? '', r.location_description ?? '']));
}

export function unitsBoardToTsv(rows: Array<{
  unit_id: string; officer_name: string; status: string; current_call_number?: string | null;
}>): string {
  return ['unit\tofficer\tstatus\tcall', ...rows.map((r) => [r.unit_id, r.officer_name, r.status, r.current_call_number ?? ''].join('\t'))].join('\n');
}

export function trainingCoursesToCsv(rows: Array<{
  course_name?: string; course_code?: string; category?: string;
  duration_hours?: string | number; location?: string; is_mandatory?: number | boolean;
}>): string {
  return rowsToCsv(['name', 'code', 'category', 'hours', 'location', 'mandatory'],
    rows.map((r) => [r.course_name ?? '', r.course_code ?? '', r.category ?? '', r.duration_hours ?? '', r.location ?? '', r.is_mandatory ? 'yes' : 'no']));
}

export function fileListingToCsv(rows: Array<{ name: string; size: number; modified: string; path: string }>): string {
  return rowsToCsv(['name', 'size', 'modified', 'path'], rows.map((r) => [r.name, r.size, r.modified, r.path]));
}

export function agendaToCsv(rows: Array<{
  source: string; title: string; date: string; start?: string | null; officer_id?: number | null; status?: string | null;
}>): string {
  return rowsToCsv(['source', 'title', 'date', 'start', 'officer_id', 'status'],
    rows.map((r) => [r.source, r.title, r.date, r.start ?? '', r.officer_id ?? '', r.status ?? '']));
}

export function qaReviewsToCsv(rows: Array<{
  id?: number; review_type?: string; score?: string | number; findings?: string; reviewed_officer_name?: string;
}>): string {
  return rowsToCsv(['id', 'type', 'score', 'officer', 'findings'],
    rows.map((r) => [r.id ?? '', r.review_type ?? '', r.score ?? '', r.reviewed_officer_name ?? '', r.findings ?? '']));
}

export function assetsToCsv(rows: Array<{
  asset_tag?: string; asset_type?: string; make?: string; model?: string; serial_number?: string; status?: string;
}>): string {
  return rowsToCsv(['tag', 'type', 'make', 'model', 'serial', 'status'],
    rows.map((r) => [r.asset_tag ?? '', r.asset_type ?? '', r.make ?? '', r.model ?? '', r.serial_number ?? '', r.status ?? '']));
}

export function errorLogsToCsv(rows: Array<{
  created_at: string; severity: string; category: string; message: string; trace_id?: string; source?: string;
}>): string {
  return rowsToCsv(['created_at', 'severity', 'category', 'message', 'trace_id', 'source'],
    rows.map((r) => [r.created_at, r.severity, r.category, r.message, r.trace_id ?? '', r.source ?? '']));
}

export function recordingsToCsv(rows: Array<{
  id: number; started_at: string; duration_sec: number; status: string; location_text: string | null; notes: string | null;
}>): string {
  return rowsToCsv(['id', 'started_at', 'duration_sec', 'status', 'location', 'notes'],
    rows.map((r) => [r.id, r.started_at, r.duration_sec, r.status, r.location_text ?? '', r.notes ?? '']));
}

export function modulesToCsv(rows: Array<{ path: string; label: string; description?: string }>): string {
  return rowsToCsv(['path', 'label', 'description'], rows.map((r) => [r.path, r.label, r.description ?? '']));
}

export function mutualAidToCsv(rows: Array<{
  callNumber: string; nature: string; location: string; requestingAgency: string; assistingAgencies: string[];
}>): string {
  return rowsToCsv(['call', 'nature', 'location', 'requesting', 'assisting'],
    rows.map((r) => [r.callNumber, r.nature, r.location, r.requestingAgency, r.assistingAgencies.join('|')]));
}

export function plateHistoryToCsv(rows: Array<{ plate: string; state: string; at?: string; ts?: number }>): string {
  return rowsToCsv(['plate', 'state', 'at'],
    rows.map((r) => [r.plate, r.state, r.at ?? (r.ts != null ? new Date(r.ts).toISOString() : '')]));
}

export function updateHistoryToCsv(rows: Array<{ version: string; date: string; notes?: string }>): string {
  return rowsToCsv(['version', 'date', 'notes'], rows.map((r) => [r.version, r.date, r.notes ?? '']));
}

export function shiftsToCsv(rows: Array<{ date: string; start_time?: string; end_time?: string; location?: string; status?: string }>): string {
  return rowsToCsv(['date', 'start', 'end', 'location', 'status'],
    rows.map((r) => [r.date, r.start_time ?? '', r.end_time ?? '', r.location ?? '', r.status ?? '']));
}

export function sessionsToCsv(rows: Array<{ username: string; role: string; last_active?: string }>): string {
  return rowsToCsv(['username', 'role', 'last_active'], rows.map((r) => [r.username, r.role, r.last_active ?? '']));
}
