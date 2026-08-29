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

function csvRow(cells: unknown[]): string {
  return cells.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',');
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
  const header = 'report,date,location,type,severity,vehicles,injuries,fatalities,status';
  return [header, ...rows.map((r) => csvRow([
    r.report_number, r.crash_date, r.location, r.crash_type, r.severity,
    r.vehicles_involved, r.injuries, r.fatalities, r.status,
  ]))].join('\n');
}

export function briefingsToCsv(rows: Array<{
  briefing_number: string;
  title: string;
  shift_type: string;
  created_at: string;
  created_by: string;
  acknowledged_count: number;
  total_officers: number;
}>): string {
  const header = 'number,title,shift,created_at,created_by,acked,officers';
  return [header, ...rows.map((r) => csvRow([
    r.briefing_number, r.title, r.shift_type, r.created_at, r.created_by,
    r.acknowledged_count, r.total_officers,
  ]))].join('\n');
}

export function shiftNotesToCsv(rows: Array<{
  officer_name: string;
  shift_date: string;
  visibility: string;
  tags: string[];
  content: string;
}>): string {
  const header = 'officer,date,visibility,tags,content';
  return [header, ...rows.map((r) => csvRow([
    r.officer_name, r.shift_date, r.visibility, (r.tags || []).join('|'), r.content,
  ]))].join('\n');
}

export function trainingCoursesToCsv(rows: Array<Record<string, unknown>>): string {
  const header = 'name,code,category,mandatory,hours';
  return [header, ...rows.map((r) => csvRow([
    r.course_name, r.course_code, r.category, r.mandatory, r.hours ?? r.credit_hours,
  ]))].join('\n');
}

export function fileListingToCsv(rows: Array<{
  name: string;
  size: number;
  modified: string;
  path: string;
}>): string {
  const header = 'name,size,modified,path';
  return [header, ...rows.map((r) => csvRow([r.name, r.size, r.modified, r.path]))].join('\n');
}

export function formatRadioLine(unit: {
  unit_id: string;
  officer_name: string;
  badge: string;
  status: string;
  current_call_number?: string | null;
  location_description?: string | null;
}): string {
  const call = unit.current_call_number ? ` call ${unit.current_call_number}` : '';
  const loc = unit.location_description ? ` @ ${unit.location_description}` : '';
  return `${unit.unit_id} ${unit.officer_name} (${unit.badge}) ${unit.status}${call}${loc}`.trim();
}

export function unitsBoardToCsv(rows: Array<{
  unit_id: string;
  officer_name: string;
  badge: string;
  status: string;
  current_call_number?: string | null;
  location_description?: string | null;
}>): string {
  const header = 'unit,officer,badge,status,call,location';
  return [header, ...rows.map((r) => csvRow([
    r.unit_id, r.officer_name, r.badge, r.status,
    r.current_call_number ?? '', r.location_description ?? '',
  ]))].join('\n');
}

export function unitsBoardToTsv(rows: Array<{
  unit_id: string;
  officer_name: string;
  badge: string;
  status: string;
  current_call_number?: string | null;
  location_description?: string | null;
}>): string {
  const header = ['unit', 'officer', 'badge', 'status', 'call', 'location'].join('\t');
  return [header, ...rows.map((r) => [
    r.unit_id, r.officer_name, r.badge, r.status,
    r.current_call_number ?? '', r.location_description ?? '',
  ].join('\t'))].join('\n');
}

function csvCells(vals: unknown[]): string {
  return vals.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',');
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
  investigating_officer: string;
}>): string {
  const header = 'report,date,location,type,severity,vehicles,injuries,fatalities,status,officer';
  const lines = rows.map((r) => csvCells([
    r.report_number, r.crash_date, r.location, r.crash_type, r.severity,
    r.vehicles_involved, r.injuries, r.fatalities, r.status, r.investigating_officer,
  ]));
  return [header, ...lines].join('\n');
}

export function shiftNotesToCsv(rows: Array<{
  officer_name: string;
  content: string;
  visibility: string;
  tags: string[];
  created_at: string;
  shift_date: string;
}>): string {
  const header = 'shift_date,created_at,officer,visibility,tags,content';
  const lines = rows.map((r) => csvCells([
    r.shift_date, r.created_at, r.officer_name, r.visibility, (r.tags || []).join('|'), r.content,
  ]));
  return [header, ...lines].join('\n');
}

export function briefingsToCsv(rows: Array<{
  briefing_number: string;
  title: string;
  shift_type: string;
  created_at: string;
  created_by: string;
  acknowledged_count: number;
  total_officers: number;
}>): string {
  const header = 'number,title,shift,created_at,created_by,ack,total';
  const lines = rows.map((r) => csvCells([
    r.briefing_number, r.title, r.shift_type, r.created_at, r.created_by,
    r.acknowledged_count, r.total_officers,
  ]));
  return [header, ...lines].join('\n');
}

export function trainingCoursesToCsv(rows: Array<Record<string, unknown>>): string {
  const header = 'course,code,category,hours,instructor';
  const lines = rows.map((r) => csvCells([
    r.course_name, r.course_code, r.category, r.duration_hours, r.instructor_name,
  ]));
  return [header, ...lines].join('\n');
}

export function fileListingToCsv(rows: Array<{ name: string; size: number; modified: string; path: string }>): string {
  const header = 'name,size,modified,path';
  const lines = rows.map((r) => csvCells([r.name, r.size, r.modified, r.path]));
  return [header, ...lines].join('\n');
}

export function formatRadioLine(u: {
  unit_id: string;
  officer_name: string;
  badge?: string;
  status: string;
  current_call_number?: string | null;
}): string {
  const call = u.current_call_number ? ` ${u.current_call_number}` : '';
  const badge = u.badge ? ` #${u.badge}` : '';
  return `${u.unit_id}${badge} ${u.officer_name} ${u.status}${call}`.trim();
}

export function unitsBoardToCsv(rows: Array<{
  unit_id: string;
  officer_name: string;
  badge: string;
  status: string;
  current_call_number?: string | null;
  location_description?: string | null;
}>): string {
  const header = 'unit,badge,officer,status,call,location';
  const lines = rows.map((r) => csvCells([
    r.unit_id, r.badge, r.officer_name, r.status, r.current_call_number ?? '', r.location_description ?? '',
  ]));
  return [header, ...lines].join('\n');
}

export function unitsBoardToTsv(rows: Array<{
  unit_id: string;
  officer_name: string;
  badge: string;
  status: string;
  current_call_number?: string | null;
  location_description?: string | null;
}>): string {
  const header = ['unit', 'badge', 'officer', 'status', 'call', 'location'].join('\t');
  const lines = rows.map((r) =>
    [r.unit_id, r.badge, r.officer_name, r.status, r.current_call_number ?? '', r.location_description ?? ''].join('\t'),
  );
  return [header, ...lines].join('\n');
}

function csvLine(cols: unknown[]): string {
  return cols.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',');
}

export function crashReportsToCsv(rows: Array<{
  report_number: string;
  crash_date: string;
  location: string;
  crash_type: string;
  severity: string;
  status: string;
  investigating_officer: string;
}>): string {
  const header = 'report,date,location,type,severity,status,officer';
  return [header, ...rows.map((r) => csvLine([
    r.report_number, r.crash_date, r.location, r.crash_type, r.severity, r.status, r.investigating_officer,
  ]))].join('\n');
}

export function briefingsToCsv(rows: Array<{
  briefing_number: string;
  title: string;
  shift_type: string;
  created_at: string;
  created_by: string;
}>): string {
  const header = 'number,title,shift,created_at,author';
  return [header, ...rows.map((r) => csvLine([
    r.briefing_number, r.title, r.shift_type, r.created_at, r.created_by,
  ]))].join('\n');
}

export function shiftNotesToCsv(rows: Array<{
  officer_name: string;
  content: string;
  visibility: string;
  created_at: string;
  shift_date: string;
}>): string {
  const header = 'officer,visibility,shift_date,created_at,content';
  return [header, ...rows.map((r) => csvLine([
    r.officer_name, r.visibility, r.shift_date, r.created_at, r.content,
  ]))].join('\n');
}

export function trainingCoursesToCsv(rows: Array<{
  course_name?: string;
  course_code?: string;
  category?: string;
  duration_hours?: number | string;
  instructor_name?: string;
}>): string {
  const header = 'course,code,category,hours,instructor';
  return [header, ...rows.map((r) => csvLine([
    r.course_name, r.course_code, r.category, r.duration_hours, r.instructor_name,
  ]))].join('\n');
}

export function formatRadioLine(unit: {
  unit_id: string;
  officer_name: string;
  badge: string;
  status: string;
  current_call_number?: string | null;
}): string {
  const call = unit.current_call_number ? ` ${unit.current_call_number}` : '';
  return `${unit.unit_id} ${unit.officer_name} #${unit.badge} ${unit.status}${call}`;
}

export function unitsBoardToCsv(rows: Array<{
  unit_id: string;
  officer_name: string;
  badge: string;
  status: string;
  current_call_number?: string | null;
  location_description?: string | null;
}>): string {
  const header = 'unit,officer,badge,status,call,location';
  return [header, ...rows.map((r) => csvLine([
    r.unit_id, r.officer_name, r.badge, r.status, r.current_call_number, r.location_description,
  ]))].join('\n');
}

export function unitsBoardToTsv(rows: Array<{
  unit_id: string;
  officer_name: string;
  badge: string;
  status: string;
  current_call_number?: string | null;
}>): string {
  return rows.map((r) => [r.unit_id, r.officer_name, r.badge, r.status, r.current_call_number ?? ''].join('\t')).join('\n');
}

export function fileListingToCsv(rows: Array<{
  name: string;
  size: number;
  modified: string;
  path: string;
}>): string {
  const header = 'name,size,modified,path';
  return [header, ...rows.map((r) => csvLine([r.name, r.size, r.modified, r.path]))].join('\n');
}
