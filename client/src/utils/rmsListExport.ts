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
    rows.map((r) => [r.plate, r.state, r.at ?? (r.ts != null ? new Date(r.ts).toISOString() : '')])); // new-date-ok — numeric Unix ms, not a D1 string
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

export function jailBookingsToCsv(rows: Array<{
  full_name: string; booking_date: string | null; charges: string | null; county: string | null; entry_source?: string; person_id?: number | null;
}>): string {
  return rowsToCsv(['name', 'date', 'charges', 'county', 'source', 'known_person'],
    rows.map((r) => [r.full_name, r.booking_date ?? '', r.charges ?? '', r.county ?? '', r.entry_source ?? '', r.person_id ? 'yes' : 'no']));
}

export function jailSourcesToCsv(rows: Array<{
  source_key: string; display_name: string; kind: string; status: string; row_count?: number; last_status?: string | null;
}>): string {
  return rowsToCsv(['key', 'name', 'kind', 'status', 'rows', 'last_status'],
    rows.map((r) => [r.source_key, r.display_name, r.kind, r.status, r.row_count ?? 0, r.last_status ?? '']));
}

export function partnersToCsv(rows: Array<{
  agency_name: string; agency_type?: string; jurisdiction?: string; data_share_level?: string; status?: string;
}>): string {
  return rowsToCsv(['agency', 'type', 'jurisdiction', 'share_level', 'status'],
    rows.map((r) => [r.agency_name, r.agency_type ?? '', r.jurisdiction ?? '', r.data_share_level ?? '', r.status ?? '']));
}

export function accreditationsToCsv(rows: Array<{
  officer_name: string; badge_number?: string; type: string; issuing_body?: string; certificate_number?: string;
  expiration_date?: string; status?: string;
}>): string {
  return rowsToCsv(['officer', 'badge', 'type', 'issuer', 'certificate', 'expires', 'status'],
    rows.map((r) => [r.officer_name, r.badge_number ?? '', r.type, r.issuing_body ?? '', r.certificate_number ?? '', r.expiration_date ?? '', r.status ?? '']));
}

export function recruitmentPipelineToCsv(rows: Array<{
  candidate_name: string; position?: string; stage?: string; applied_date?: string;
}>): string {
  return rowsToCsv(['name', 'position', 'stage', 'applied'],
    rows.map((r) => [r.candidate_name, r.position ?? '', r.stage ?? '', r.applied_date ?? '']));
}

export function riskAssessmentsToCsv(rows: Array<{
  assessment_number?: string; entity_type?: string; risk_level?: string; risk_category?: string; status?: string; assessed_date?: string;
}>): string {
  return rowsToCsv(['number', 'entity', 'level', 'category', 'status', 'date'],
    rows.map((r) => [r.assessment_number ?? '', r.entity_type ?? '', r.risk_level ?? '', r.risk_category ?? '', r.status ?? '', r.assessed_date ?? '']));
}

export function invoicesToCsv(rows: Array<{
  invoice_number?: string; status?: string; due_date?: string | null; issue_date?: string; total_amount?: number; paid_amount?: number;
}>): string {
  return rowsToCsv(['invoice', 'status', 'issued', 'due', 'total', 'paid'],
    rows.map((r) => [r.invoice_number ?? '', r.status ?? '', r.issue_date ?? '', r.due_date ?? '', r.total_amount ?? 0, r.paid_amount ?? 0]));
}

export function timelineToCsv(rows: Array<{ timestamp: string; type: string; label: string; detail?: string }>): string {
  return rowsToCsv(['timestamp', 'type', 'label', 'detail'], rows.map((r) => [r.timestamp, r.type, r.label, r.detail ?? '']));
}

export function pingResultsToCsv(rows: Array<{ attempt: number; latencyMs: number; ok: boolean }>): string {
  return rowsToCsv(['attempt', 'latency_ms', 'ok'], rows.map((r) => [r.attempt, Math.round(r.latencyMs), r.ok ? 'yes' : 'no']));
}

export function networkIfacesToCsv(rows: Array<{ name: string; ipv4?: string; ipv6?: string; status?: string }>): string {
  return rowsToCsv(['name', 'ipv4', 'ipv6', 'status'], rows.map((r) => [r.name, r.ipv4 ?? '', r.ipv6 ?? '', r.status ?? '']));
}

/** Case/status only — never phone or email. */
export function victimCasesToCsv(rows: Array<{
  victim_name: string; case_number?: string; crime_type?: string; status?: string;
  safety_plan?: number; protective_order?: number;
}>): string {
  return rowsToCsv(['name', 'case', 'crime', 'status', 'safety_plan', 'po'],
    rows.map((r) => [r.victim_name, r.case_number ?? '', r.crime_type ?? '', r.status ?? '', r.safety_plan ? 'yes' : 'no', r.protective_order ? 'yes' : 'no']));
}

/** Operational account fields — never contact phone. */
export function alarmAccountsToCsv(rows: Array<{
  account_number: string; account_name: string; address?: string; alarm_type?: string;
  permit_status?: string; status?: string; false_alarm_count?: number;
}>): string {
  return rowsToCsv(['account', 'name', 'address', 'type', 'permit', 'status', 'false_alarms'],
    rows.map((r) => [r.account_number, r.account_name, r.address ?? '', r.alarm_type ?? '', r.permit_status ?? '', r.status ?? '', r.false_alarm_count ?? 0]));
}

/** Hit queue metadata — no display names. */
export function screeningHitsToCsv(rows: Array<{
  id: number; source_key: string; match_score: number; status: string;
}>): string {
  return rowsToCsv(['id', 'source', 'match_score', 'status'],
    rows.map((r) => [r.id, r.source_key, r.match_score, r.status]));
}

export function crimeOffensesToCsv(rows: Array<{ offense_type?: string; count?: number }>): string {
  return rowsToCsv(['offense', 'count'], rows.map((r) => [r.offense_type ?? '', r.count ?? 0]));
}

export function crimeHotspotsToCsv(rows: Array<{ location?: string; count?: number }>): string {
  return rowsToCsv(['location', 'count'], rows.map((r) => [r.location ?? '', r.count ?? 0]));
}

/** Docket fields only — never name, DOB, or notes. */
export function warrantDocketToCsv(rows: Array<{
  warrant_number?: string; warrant_type?: string; type?: string; status?: string; issuing_court?: string;
}>): string {
  return rowsToCsv(['warrant', 'type', 'status', 'court'],
    rows.map((r) => [r.warrant_number ?? '', r.warrant_type ?? r.type ?? '', r.status ?? '', r.issuing_court ?? '']));
}

export function briefingBolosToCsv(rows: Array<{
  nature?: string; priority?: string | number; location_address?: string; status?: string;
}>): string {
  return rowsToCsv(['nature', 'priority', 'location', 'status'],
    rows.map((r) => [r.nature ?? '', r.priority ?? '', r.location_address ?? '', r.status ?? '']));
}

export function briefingWarrantsToCsv(rows: Array<{
  warrant_number?: string; warrant_type?: string; charge?: string;
}>): string {
  return rowsToCsv(['warrant', 'type', 'charge'],
    rows.map((r) => [r.warrant_number ?? '', r.warrant_type ?? '', r.charge ?? '']));
}

export function personIntelXrefsToCsv(rows: Array<{
  source: string; externalRef: string; confidence?: number; isCriminal?: boolean;
}>): string {
  return rowsToCsv(['source', 'external_ref', 'confidence', 'criminal'],
    rows.map((r) => [r.source, r.externalRef, r.confidence ?? '', r.isCriminal ? 'yes' : 'no']));
}

export function alprCapturesToCsv(rows: Array<{
  id: number; captured_at: string; plate_number?: string; make?: string; model?: string;
  color?: string; confidence?: number; is_stolen?: boolean | number; call_id?: number;
}>): string {
  return rowsToCsv(['id', 'captured_at', 'plate', 'make', 'model', 'color', 'confidence', 'stolen', 'call_id'],
    rows.map((r) => [
      r.id, r.captured_at, r.plate_number ?? '', r.make ?? '', r.model ?? '', r.color ?? '',
      r.confidence != null ? Math.round(r.confidence * 100) : '', r.is_stolen ? 'yes' : 'no', r.call_id ?? '',
    ]));
}

export function gangMembersToCsv(rows: Array<{
  name: string; moniker?: string; gang_name?: string; status?: string; threat_level?: string;
}>): string {
  return rowsToCsv(['name', 'moniker', 'gang', 'status', 'threat'],
    rows.map((r) => [r.name, r.moniker ?? '', r.gang_name ?? '', r.status ?? '', r.threat_level ?? '']));
}

/** Case/substance only — never notes. */
export function narcCasesToCsv(rows: Array<{
  case_number: string; case_type?: string; substance?: string; status?: string; location?: string; street_value?: number;
}>): string {
  return rowsToCsv(['case', 'type', 'substance', 'status', 'location', 'street_value'],
    rows.map((r) => [r.case_number, r.case_type ?? '', r.substance ?? '', r.status ?? '', r.location ?? '', r.street_value ?? 0]));
}

/** No owner phone or name. */
export function animalCasesToCsv(rows: Array<{
  case_number: string; case_type?: string; status?: string; animal_type?: string; breed?: string; location?: string;
}>): string {
  return rowsToCsv(['case', 'type', 'status', 'animal', 'breed', 'location'],
    rows.map((r) => [r.case_number, r.case_type ?? '', r.status ?? '', r.animal_type ?? '', r.breed ?? '', r.location ?? '']));
}

/** No owner phone. */
export function impoundsToCsv(rows: Array<{
  license_plate?: string | null; license_state?: string | null; vehicle_make?: string | null;
  vehicle_model?: string | null; status?: string; lot_location?: string | null; impound_date?: string;
}>): string {
  return rowsToCsv(['plate', 'state', 'make', 'model', 'status', 'lot', 'date'],
    rows.map((r) => [r.license_plate ?? '', r.license_state ?? '', r.vehicle_make ?? '', r.vehicle_model ?? '', r.status ?? '', r.lot_location ?? '', r.impound_date ?? '']));
}

/** Shop/item/serial only — never seller DOB, phone, or ID. */
export function pawnItemsToCsv(rows: Array<{
  shop_name: string; item_description?: string; serial_number?: string; item_category?: string;
  status?: string; flagged_stolen?: number;
}>): string {
  return rowsToCsv(['shop', 'item', 'serial', 'category', 'status', 'flagged'],
    rows.map((r) => [r.shop_name, r.item_description ?? '', r.serial_number ?? '', r.item_category ?? '', r.status ?? '', r.flagged_stolen ? 'yes' : 'no']));
}

/** No suspect name or description. */
export function bulletinsToCsv(rows: Array<{
  bulletin_number: string; title: string; type?: string; priority?: string; status?: string; location?: string;
}>): string {
  return rowsToCsv(['number', 'title', 'type', 'priority', 'status', 'location'],
    rows.map((r) => [r.bulletin_number, r.title, r.type ?? '', r.priority ?? '', r.status ?? '', r.location ?? '']));
}

export function alarmPermitsToCsv(rows: Array<{
  permit_number: string; location_name?: string; alarm_type?: string; status?: string; false_alarm_count?: number;
}>): string {
  return rowsToCsv(['permit', 'location', 'type', 'status', 'false_alarms'],
    rows.map((r) => [r.permit_number, r.location_name ?? '', r.alarm_type ?? '', r.status ?? '', r.false_alarm_count ?? 0]));
}

export function alarmActivationsToCsv(rows: Array<{
  activation_date: string; alarm_type?: string; is_false_alarm?: boolean; responding_officer?: string; billed?: boolean;
}>): string {
  return rowsToCsv(['date', 'type', 'false_alarm', 'officer', 'billed'],
    rows.map((r) => [r.activation_date, r.alarm_type ?? '', r.is_false_alarm ? 'yes' : 'no', r.responding_officer ?? '', r.billed ? 'yes' : 'no']));
}

export function fieldPhotosToCsv(rows: Array<{
  id: number; filename?: string; original_filename?: string; officer_name?: string; created_at?: string;
}>): string {
  return rowsToCsv(['id', 'filename', 'officer', 'created_at'],
    rows.map((r) => [r.id, r.original_filename ?? r.filename ?? '', r.officer_name ?? '', r.created_at ?? '']));
}

export function timerLapsToCsv(rows: Array<{ n: number; split: string; total: string }>): string {
  return rowsToCsv(['lap', 'split', 'total'], rows.map((r) => [r.n, r.split, r.total]));
}

export function colorHistoryToCsv(rows: string[]): string {
  return rowsToCsv(['hex'], rows.map((hex) => [hex]));
}

export function accreditationStandardsToCsv(rows: Array<{
  standard_number: string; standard_name: string; category: string; compliance_status: string;
  last_reviewed?: string; next_review?: string;
}>): string {
  return rowsToCsv(['number', 'name', 'category', 'status', 'last_reviewed', 'next_review'],
    rows.map((r) => [r.standard_number, r.standard_name, r.category, r.compliance_status, r.last_reviewed ?? '', r.next_review ?? '']));
}

export function crisisIncidentsToCsv(rows: Array<{
  incident_number: string; incident_type: string; location: string; disposition: string;
  cit_team_used?: number; resolved_on_scene?: number; diverted?: number;
}>): string {
  return rowsToCsv(['number', 'type', 'location', 'disposition', 'cit', 'resolved', 'diverted'],
    rows.map((r) => [r.incident_number, r.incident_type, r.location, r.disposition, r.cit_team_used ? 'yes' : 'no', r.resolved_on_scene ? 'yes' : 'no', r.diverted ? 'yes' : 'no']));
}

export function alertTemplatesToCsv(rows: Array<{
  template_name: string; subject?: string | null; channel: string; category?: string | null; created_at?: string | null;
}>): string {
  return rowsToCsv(['name', 'subject', 'channel', 'category', 'created_at'],
    rows.map((r) => [r.template_name, r.subject ?? '', r.channel, r.category ?? '', r.created_at ?? '']));
}

export function inmateRosterToCsv(rows: Array<{
  booking_number: string; status: string; housing_unit?: string; housing_cell?: string; booking_date?: string;
}>): string {
  return rowsToCsv(['booking', 'status', 'unit', 'cell', 'booking_date'],
    rows.map((r) => [r.booking_number, r.status, r.housing_unit ?? '', r.housing_cell ?? '', r.booking_date ?? '']));
}

export function communityEventsToCsv(rows: Array<{
  event_name: string; event_type: string; location?: string; start_date: string; status: string;
}>): string {
  return rowsToCsv(['name', 'type', 'location', 'start_date', 'status'],
    rows.map((r) => [r.event_name, r.event_type, r.location ?? '', r.start_date, r.status]));
}

export function communityTipsSafeToCsv(rows: Array<{
  tip_number: string; is_anonymous: number; submitter_name?: string; category?: string; location?: string; status: string; priority: string;
}>): string {
  return rowsToCsv(['number', 'submitter', 'category', 'location', 'status', 'priority'],
    rows.map((r) => [r.tip_number, r.is_anonymous ? '[anonymous]' : (r.submitter_name ?? ''), r.category ?? '', r.location ?? '', r.status, r.priority]));
}

export function communityAlertsToCsv(rows: Array<{
  alert_title: string; alert_type: string; severity: string; target_area?: string; created_at: string;
}>): string {
  return rowsToCsv(['title', 'type', 'severity', 'area', 'created_at'],
    rows.map((r) => [r.alert_title, r.alert_type, r.severity, r.target_area ?? '', r.created_at]));
}

export function watchGroupsToCsv(rows: Array<{
  group_name: string; neighborhood?: string; member_count: number; last_meeting?: string; next_meeting?: string;
}>): string {
  return rowsToCsv(['group', 'neighborhood', 'members', 'last_meeting', 'next_meeting'],
    rows.map((r) => [r.group_name, r.neighborhood ?? '', r.member_count, r.last_meeting ?? '', r.next_meeting ?? '']));
}

export function darListToCsv(rows: Array<{
  dar_number: string; shift_date: string; status: string;
}>): string {
  return rowsToCsv(['number', 'shift_date', 'status'],
    rows.map((r) => [r.dar_number, r.shift_date, r.status]));
}

export function bodyCamerasToCsv(rows: Array<{
  camera_id: string; make: string; model: string; status: string;
}>): string {
  return rowsToCsv(['camera_id', 'make', 'model', 'status'],
    rows.map((r) => [r.camera_id, r.make, r.model, r.status]));
}

export function loginHistoryToCsv(rows: Array<{
  created_at: string; success: number; ip_address: string;
}>): string {
  return rowsToCsv(['created_at', 'success', 'ip'],
    rows.map((r) => [r.created_at, r.success ? 'yes' : 'no', r.ip_address]));
}

export function cdocResultsToCsv(rows: Array<{
  doc_number: string; facility?: string | null; status?: string | null; gender?: string | null;
}>): string {
  return rowsToCsv(['doc_number', 'facility', 'status', 'gender'],
    rows.map((r) => [r.doc_number, r.facility ?? '', r.status ?? '', r.gender ?? '']));
}
