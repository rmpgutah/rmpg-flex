import { downloadTextFile } from './intelHitExport';

export { downloadTextFile };

function cell(c: unknown): string {
  return `"${String(c ?? '').replace(/"/g, '""')}"`;
}

function csvRows(header: string[], rows: unknown[][]): string {
  return [header.join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n');
}

function yesNo(v: unknown): string {
  return v === true || v === 1 || v === '1' || v === 'yes' ? 'yes' : 'no';
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
  shift_date?: string;
}>): string {
  return csvRows(
    ['number', 'title', 'shift', 'shift_date', 'author', 'created_at', 'acked', 'roster'],
    rows.map((r) => [
      r.briefing_number, r.title, r.shift_type, r.shift_date ?? '', r.created_by,
      r.created_at, r.acknowledged_count, r.total_officers,
    ]),
  );
}

export function shiftNotesToCsv(rows: Array<{
  officer_name: string;
  visibility: string;
  tags: string[];
  content: string;
  created_at?: string;
  shift_date?: string;
}>): string {
  return csvRows(
    ['shift_date', 'created_at', 'officer', 'visibility', 'tags', 'content'],
    rows.map((r) => [
      r.shift_date ?? '', r.created_at ?? '', r.officer_name, r.visibility,
      (r.tags ?? []).join('|'), r.content,
    ]),
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
  if (u.badge) {
    const call = u.current_call_number ? ` ${u.current_call_number}` : '';
    return `${u.unit_id} ${u.officer_name} #${u.badge} ${u.status}${call}`.replace(/\s+/g, ' ').trim();
  }
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
    rows.map((r) => [
      r.unit_id, r.officer_name, r.badge, r.status, r.role ?? '',
      r.current_call_number ?? '', r.location_description ?? '',
    ]),
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
  return [
    'unit\tofficer\tbadge\tstatus\tcall\tlocation',
    ...rows.map((r) => [
      r.unit_id, r.officer_name, r.badge ?? '', r.status,
      r.current_call_number ?? '', r.location_description ?? '',
    ].join('\t')),
  ].join('\n');
}

export function trainingCoursesToCsv(rows: Array<Record<string, unknown>>): string {
  return csvRows(
    ['name', 'code', 'category', 'hours', 'location', 'mandatory', 'instructor'],
    rows.map((r) => [
      r.course_name ?? '',
      r.course_code ?? '',
      r.category ?? '',
      r.hours ?? r.duration_hours ?? r.credit_hours ?? '',
      r.location ?? '',
      yesNo(r.mandatory ?? r.is_mandatory),
      r.instructor_name ?? '',
    ]),
  );
}

export function fileListingToCsv(rows: Array<{ name: string; size: number; modified: string; path: string }>): string {
  return csvRows(
    ['name', 'size', 'modified', 'path'],
    rows.map((r) => [r.name, r.size, r.modified, r.path]),
  );
}

export function agendaToCsv(rows: Array<{
  source: string;
  title: string;
  date: string;
  start?: string | null;
  end?: string | null;
  subtitle?: string | null;
  status?: string | null;
}>): string {
  return csvRows(
    ['date', 'start', 'end', 'source', 'title', 'subtitle', 'status'],
    rows.map((r) => [r.date, r.start ?? '', r.end ?? '', r.source, r.title, r.subtitle ?? '', r.status ?? '']),
  );
}

export function qaReviewsToCsv(rows: Array<Record<string, unknown>>): string {
  return csvRows(
    ['id', 'number', 'type', 'reviewer', 'score', 'status', 'findings', 'created_at'],
    rows.map((r) => [
      r.id ?? '', r.review_number ?? '', r.review_type ?? '', r.reviewer_name ?? '',
      r.score ?? '', r.status ?? '', r.findings ?? '', r.created_at ?? '',
    ]),
  );
}

export function assetsToCsv(rows: Array<Record<string, unknown>>): string {
  return csvRows(
    ['tag', 'type', 'make', 'model', 'serial', 'status', 'notes'],
    rows.map((r) => [
      r.asset_tag ?? '', r.asset_type ?? '', r.make ?? '', r.model ?? '',
      r.serial_number ?? '', r.status ?? '', r.notes ?? '',
    ]),
  );
}

export function errorLogsToCsv(rows: Array<{
  created_at: string;
  severity: string;
  category: string;
  message: string;
  trace_id?: string;
  source?: string;
  status_code?: number;
}>): string {
  return csvRows(
    ['created_at', 'severity', 'category', 'message', 'trace_id', 'source', 'status_code'],
    rows.map((r) => [r.created_at, r.severity, r.category, r.message, r.trace_id ?? '', r.source ?? '', r.status_code ?? '']),
  );
}

export function recordingsToCsv(rows: Array<{
  id: number;
  started_at: string;
  duration_sec: number;
  status: string;
  location_text: string | null;
  notes: string | null;
}>): string {
  return csvRows(
    ['id', 'started_at', 'duration_sec', 'status', 'location', 'notes'],
    rows.map((r) => [r.id, r.started_at, r.duration_sec, r.status, r.location_text ?? '', r.notes ?? '']),
  );
}

export function modulesToCsv(rows: Array<{ path: string; label: string; shortcut?: string; description?: string }>): string {
  return csvRows(
    ['path', 'label', 'shortcut', 'description'],
    rows.map((r) => [r.path, r.label, r.shortcut ?? '', r.description ?? '']),
  );
}

export function mutualAidToCsv(rows: Array<{
  callNumber: string;
  nature: string;
  location: string;
  requestingAgency: string;
  assistingAgencies: string[];
  units?: string[];
}>): string {
  return csvRows(
    ['call', 'nature', 'location', 'requesting', 'assisting', 'units'],
    rows.map((r) => [
      r.callNumber, r.nature, r.location, r.requestingAgency,
      (r.assistingAgencies ?? []).join('|'), (r.units ?? []).join('|'),
    ]),
  );
}

export function plateHistoryToCsv(rows: Array<{ plate: string; state: string; ts?: number }>): string {
  return csvRows(
    ['plate', 'state', 'checked_at'],
    rows.map((r) => [r.plate, r.state, r.ts ? new Date(r.ts).toISOString() : '']), // new-date-ok: epoch ms from localStorage plate history
  );
}

export function jailBookingsToCsv(rows: Array<{
  full_name: string;
  booking_date: string | null;
  charges: string | null;
  county: string | null;
}>): string {
  return csvRows(
    ['name', 'booking_date', 'charges', 'county'],
    rows.map((r) => [r.full_name, r.booking_date ?? '', r.charges ?? '', r.county ?? '']),
  );
}

export function jailSourcesToCsv(rows: Array<{
  source_key: string;
  display_name: string;
  county: string | null;
  kind: string;
  status: string;
  last_run_at: string | null;
  last_status: string | null;
  row_count: number;
}>): string {
  return csvRows(
    ['key', 'name', 'county', 'kind', 'status', 'last_run', 'last_status', 'rows'],
    rows.map((r) => [
      r.source_key, r.display_name, r.county ?? '', r.kind, r.status,
      r.last_run_at ?? '', r.last_status ?? '', r.row_count,
    ]),
  );
}

export function partnersToCsv(rows: Array<{
  agency_name: string;
  agency_type?: string;
  jurisdiction?: string;
  data_share_level: string;
  status?: string;
}>): string {
  return csvRows(
    ['agency', 'type', 'jurisdiction', 'share_level', 'status'],
    rows.map((r) => [r.agency_name, r.agency_type ?? '', r.jurisdiction ?? '', r.data_share_level, r.status ?? '']),
  );
}

/** Pipeline CSV omits contact fields so a download cannot leak applicant email/phone. */
export function recruitmentPipelineToCsv(rows: Array<{
  candidate_name: string;
  position: string;
  stage: string;
  applied_date: string;
}>): string {
  return csvRows(
    ['name', 'position', 'stage', 'applied'],
    rows.map((r) => [r.candidate_name, r.position, r.stage, r.applied_date]),
  );
}

export function invoicesToCsv(rows: Array<{
  invoice_number?: string;
  status?: string;
  total_amount?: number;
  paid_amount?: number;
  due_date?: string | null;
}>): string {
  return csvRows(
    ['invoice', 'status', 'total', 'paid', 'due_date'],
    rows.map((r) => [r.invoice_number ?? '', r.status ?? '', r.total_amount ?? 0, r.paid_amount ?? 0, r.due_date ?? '']),
  );
}

export function updateHistoryToCsv(rows: Array<{ version: string; date: string; notes?: string }>): string {
  return csvRows(
    ['version', 'date', 'notes'],
    rows.map((r) => [r.version, r.date, r.notes ?? '']),
  );
}

export function riskAssessmentsToCsv(rows: Array<{
  assessment_number?: string;
  entity_type: string;
  risk_level: string;
  risk_category?: string;
  description?: string;
  assessed_date?: string;
  status?: string;
}>): string {
  return csvRows(
    ['number', 'entity', 'level', 'category', 'description', 'assessed', 'status'],
    rows.map((r) => [
      r.assessment_number ?? '', r.entity_type, r.risk_level, r.risk_category ?? '',
      r.description ?? '', r.assessed_date ?? '', r.status ?? '',
    ]),
  );
}

export function accreditationsToCsv(rows: Array<{
  officer_name: string;
  badge_number: string;
  type: string;
  issuing_body: string;
  certificate_number: string;
  issued_date: string;
  expiration_date: string;
  status: string;
}>): string {
  return csvRows(
    ['officer', 'badge', 'type', 'issuer', 'certificate', 'issued', 'expires', 'status'],
    rows.map((r) => [
      r.officer_name, r.badge_number, r.type, r.issuing_body,
      r.certificate_number, r.issued_date, r.expiration_date, r.status,
    ]),
  );
}

export function sessionsToCsv(rows: Array<{
  id: number;
  user_id: number;
  username: string;
  role: string;
  last_active?: string;
}>): string {
  return csvRows(
    ['id', 'user_id', 'username', 'role', 'last_active'],
    rows.map((r) => [r.id, r.user_id, r.username, r.role, r.last_active ?? '']),
  );
}

export function pingResultsToCsv(rows: Array<{ attempt: number; latencyMs: number; ok: boolean }>): string {
  return csvRows(
    ['attempt', 'latency_ms', 'ok'],
    rows.map((r) => [r.attempt, Math.round(r.latencyMs), r.ok ? 'yes' : 'no']),
  );
}

export function networkIfacesToCsv(rows: Array<{
  name: string;
  ipv4?: string;
  ipv6?: string;
  mac?: string;
  status?: string;
}>): string {
  return csvRows(
    ['name', 'ipv4', 'ipv6', 'mac', 'status'],
    rows.map((r) => [r.name, r.ipv4 ?? '', r.ipv6 ?? '', r.mac ?? '', r.status ?? '']),
  );
}

export function timelineToCsv(rows: Array<{
  type: string;
  timestamp: string;
  label: string;
  detail?: string;
}>): string {
  return csvRows(
    ['timestamp', 'type', 'label', 'detail'],
    rows.map((r) => [r.timestamp, r.type, r.label, r.detail ?? '']),
  );
}

export function shiftsToCsv(rows: Array<{
  date: string;
  start_time?: string;
  end_time?: string;
  location?: string;
  status?: string;
}>): string {
  return csvRows(
    ['date', 'start', 'end', 'location', 'status'],
    rows.map((r) => [r.date, r.start_time ?? '', r.end_time ?? '', r.location ?? '', r.status ?? '']),
  );
}
