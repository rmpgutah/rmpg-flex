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
  investigating_officer?: string;
}>): string {
  return csvRows(
    ['report', 'date', 'location', 'type', 'severity', 'vehicles', 'injuries', 'fatalities', 'status', 'officer'],
    rows.map((r) => [
      r.report_number, r.crash_date, r.location, r.crash_type, r.severity,
      r.vehicles_involved, r.injuries, r.fatalities, r.status, r.investigating_officer ?? '',
    ]),
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
    ['number', 'title', 'shift', 'created_at', 'created_by', 'acked', 'officers'],
    rows.map((r) => [r.briefing_number, r.title, r.shift_type, r.created_at, r.created_by, r.acknowledged_count, r.total_officers]),
  );
}

export function shiftNotesToCsv(rows: Array<{
  officer_name: string;
  visibility: string;
  tags: string[];
  content: string;
  shift_date?: string;
  created_at?: string;
}>): string {
  return csvRows(
    ['shift_date', 'created_at', 'officer', 'visibility', 'tags', 'content'],
    rows.map((r) => [r.shift_date ?? '', r.created_at ?? '', r.officer_name, r.visibility, (r.tags ?? []).join('|'), r.content]),
  );
}

export function formatRadioLine(u: {
  unit_id: string;
  officer_name: string;
  badge?: string;
  status: string;
  location_description?: string | null;
  current_call_number?: string | null;
}): string {
  if (u.location_description && !u.badge) {
    const where = u.current_call_number ? `call ${u.current_call_number}` : u.location_description.trim();
    return `${u.unit_id} ${u.status} — ${u.officer_name} — ${where}`;
  }
  const badge = u.badge ? ` #${u.badge}` : '';
  const call = u.current_call_number ? ` ${u.current_call_number}` : '';
  const loc = u.location_description ? ` @ ${u.location_description}` : '';
  return `${u.unit_id} ${u.officer_name}${badge} ${u.status}${call}${loc}`.replace(/\s+/g, ' ').trim();
}

export function unitsBoardToCsv(rows: Array<{
  unit_id: string;
  officer_name: string;
  badge?: string;
  status: string;
  role?: string;
  current_call_number?: string | null;
  location_description?: string | null;
}>): string {
  return csvRows(
    ['unit', 'officer', 'badge', 'status', 'role', 'call', 'location'],
    rows.map((r) => [r.unit_id, r.officer_name, r.badge ?? '', r.status, r.role ?? '', r.current_call_number ?? '', r.location_description ?? '']),
  );
}

export function unitsBoardToTsv(rows: Array<{
  unit_id: string;
  officer_name: string;
  badge?: string;
  status: string;
  current_call_number?: string | null;
  location_description?: string | null;
}>): string {
  const header = ['unit', 'officer', 'badge', 'status', 'call', 'location'].join('\t');
  return [header, ...rows.map((r) => [
    r.unit_id, r.officer_name, r.badge ?? '', r.status, r.current_call_number ?? '', r.location_description ?? '',
  ].join('\t'))].join('\n');
}

export function trainingCoursesToCsv(rows: Array<Record<string, unknown>>): string {
  return csvRows(
    ['name', 'code', 'category', 'hours', 'location', 'mandatory'],
    rows.map((r) => [
      r.course_name ?? '', r.course_code ?? '', r.category ?? '',
      r.hours ?? r.duration_hours ?? r.credit_hours ?? '',
      r.location ?? '',
      r.mandatory || r.is_mandatory ? 'yes' : 'no',
    ]),
  );
}

export function fileListingToCsv(rows: Array<{ name: string; size: number; modified: string; path: string }>): string {
  return csvRows(['name', 'size', 'modified', 'path'], rows.map((r) => [r.name, r.size, r.modified, r.path]));
}

export function agendaToCsv(rows: Array<{ source?: string; title?: string; date?: string; [k: string]: unknown }>): string {
  return csvRows(
    ['source', 'title', 'date'],
    rows.map((r) => [r.source ?? '', r.title ?? '', r.date ?? r.start ?? '']),
  );
}

export function qaReviewsToCsv(rows: Array<Record<string, unknown>>): string {
  return csvRows(
    ['id', 'type', 'findings', 'score'],
    rows.map((r) => [r.id ?? '', r.review_type ?? r.type ?? '', r.findings ?? '', r.score ?? r.review_score ?? '']),
  );
}

export function assetsToCsv(rows: Array<Record<string, unknown>>): string {
  return csvRows(
    ['tag', 'serial', 'status', 'type'],
    rows.map((r) => [r.asset_tag ?? r.tag ?? '', r.serial_number ?? r.serial ?? '', r.status ?? '', r.asset_type ?? r.type ?? '']),
  );
}

export function errorLogsToCsv(rows: Array<Record<string, unknown>>): string {
  return csvRows(
    ['created_at', 'severity', 'category', 'message', 'trace_id'],
    rows.map((r) => [r.created_at ?? '', r.severity ?? '', r.category ?? '', r.message ?? '', r.trace_id ?? '']),
  );
}

export function recordingsToCsv(rows: Array<Record<string, unknown>>): string {
  return csvRows(
    ['id', 'started_at', 'duration_sec', 'status', 'location', 'notes'],
    rows.map((r) => [r.id ?? '', r.started_at ?? '', r.duration_sec ?? '', r.status ?? '', r.location_text ?? r.location ?? '', r.notes ?? '']),
  );
}

export function modulesToCsv(rows: Array<{ path?: string; label?: string; [k: string]: unknown }>): string {
  return csvRows(['path', 'label'], rows.map((r) => [r.path ?? '', r.label ?? '']));
}

export function mutualAidToCsv(rows: Array<{
  callNumber?: string;
  nature?: string;
  location?: string;
  requestingAgency?: string;
  assistingAgencies?: string[];
  [k: string]: unknown;
}>): string {
  return csvRows(
    ['call', 'nature', 'location', 'requesting', 'assisting'],
    rows.map((r) => [r.callNumber ?? '', r.nature ?? '', r.location ?? '', r.requestingAgency ?? '', (r.assistingAgencies ?? []).join('|')]),
  );
}

export function plateHistoryToCsv(rows: Array<{ plate?: string; state?: string; ts?: number; [k: string]: unknown }>): string {
  return csvRows(
    ['plate', 'state', 'ts'],
    rows.map((r) => [r.plate ?? r.plate_number ?? '', r.state ?? r.plate_state ?? '', r.ts ?? r.created_at ?? '']),
  );
}

export function jailBookingsToCsv(rows: Array<Record<string, unknown>>): string {
  return csvRows(
    ['name', 'booking_date', 'charges', 'county'],
    rows.map((r) => [r.full_name ?? r.name ?? '', r.booking_date ?? '', r.charges ?? '', r.county ?? '']),
  );
}

export function jailSourcesToCsv(rows: Array<Record<string, unknown>>): string {
  return csvRows(
    ['source', 'status', 'last_sync'],
    rows.map((r) => [r.source ?? r.name ?? '', r.status ?? '', r.last_sync ?? r.updated_at ?? '']),
  );
}

export function partnersToCsv(rows: Array<Record<string, unknown>>): string {
  return csvRows(
    ['agency', 'share_level'],
    rows.map((r) => [r.agency_name ?? r.name ?? '', r.data_share_level ?? r.share_level ?? '']),
  );
}

export function recruitmentPipelineToCsv(rows: Array<Record<string, unknown>>): string {
  return csvRows(
    ['name', 'position', 'stage', 'applied_date'],
    rows.map((r) => [r.candidate_name ?? '', r.position ?? '', r.stage ?? '', r.applied_date ?? '']),
  );
}

export function invoicesToCsv(rows: Array<Record<string, unknown>>): string {
  return csvRows(
    ['number', 'status', 'total', 'paid'],
    rows.map((r) => [r.invoice_number ?? '', r.status ?? '', r.total_amount ?? '', r.paid_amount ?? '']),
  );
}

export function accreditationsToCsv(rows: Array<Record<string, unknown>>): string {
  return csvRows(
    ['name', 'status', 'expires'],
    rows.map((r) => [r.name ?? r.title ?? '', r.status ?? '', r.expires_at ?? r.expiration_date ?? '']),
  );
}

export function riskAssessmentsToCsv(rows: Array<Record<string, unknown>>): string {
  return csvRows(
    ['id', 'title', 'level', 'status'],
    rows.map((r) => [r.id ?? '', r.title ?? r.name ?? '', r.level ?? r.risk_level ?? '', r.status ?? '']),
  );
}

export function updateHistoryToCsv(rows: Array<Record<string, unknown>>): string {
  return csvRows(
    ['version', 'status', 'applied_at'],
    rows.map((r) => [r.version ?? r.name ?? '', r.status ?? '', r.applied_at ?? r.created_at ?? '']),
  );
}

export function shiftsToCsv(rows: Array<Record<string, unknown>>): string {
  return csvRows(
    ['date', 'start', 'end', 'location', 'status'],
    rows.map((r) => [r.date ?? '', r.start_time ?? '', r.end_time ?? '', r.location ?? '', r.status ?? '']),
  );
}

export function sessionsToCsv(rows: Array<Record<string, unknown>>): string {
  return csvRows(
    ['id', 'user', 'started_at', 'ip'],
    rows.map((r) => [r.id ?? '', r.username ?? r.user ?? '', r.started_at ?? '', r.ip ?? r.ip_address ?? '']),
  );
}

export function pingResultsToCsv(rows: Array<Record<string, unknown>>): string {
  return csvRows(
    ['attempt', 'latency_ms', 'ok'],
    rows.map((r) => [r.attempt ?? '', r.latencyMs ?? r.latency_ms ?? '', r.ok ? 'yes' : 'no']),
  );
}

export function networkIfacesToCsv(rows: Array<Record<string, unknown>>): string {
  return csvRows(
    ['name', 'ipv4', 'ipv6', 'mac', 'status'],
    rows.map((r) => [r.name ?? '', r.ipv4 ?? '', r.ipv6 ?? '', r.mac ?? '', r.status ?? '']),
  );
}

export function timelineToCsv(rows: Array<Record<string, unknown>>): string {
  return csvRows(
    ['time', 'label', 'detail'],
    rows.map((r) => [r.time ?? r.created_at ?? '', r.label ?? r.title ?? '', r.detail ?? r.description ?? '']),
  );
}
