import { downloadTextFile } from './intelHitExport';

export { downloadTextFile };

export function tipsToCsv(rows: Array<{
  tracking_number: string;
  tip_type: string;
  urgency: string;
  status: string;
  location: string;
  assigned_to_name: string | null;
}>): string {
  const header = 'tracking,type,urgency,status,location,assigned';
  const lines = rows.map((r) =>
    [r.tracking_number, r.tip_type, r.urgency, r.status, r.location ?? '', r.assigned_to_name ?? '']
      .map((c) => `"${String(c).replace(/"/g, '""')}"`)
      .join(','),
  );
  return [header, ...lines].join('\n');
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
  const header = 'tracking,type,status,location,anonymous,reporter,contact,description';
  const lines = rows.map((r) => {
    const name = r.anonymous ? '[anonymous]' : r.reporter_name;
    const contact = r.anonymous ? '' : `${r.reporter_phone} ${r.reporter_email}`.trim();
    return [r.tracking_number, r.report_type, r.status, r.location, r.anonymous ? 'yes' : 'no', name, contact, r.description]
      .map((c) => `"${String(c).replace(/"/g, '""')}"`)
      .join(',');
  });
  return [header, ...lines].join('\n');
}

export function broadcastsToCsv(rows: Array<{
  message: string;
  priority: string;
  target: string;
  target_id: string | null;
  sender_name: string;
  created_at: string;
}>): string {
  const header = 'created_at,priority,target,sender,message';
  const lines = rows.map((r) =>
    [r.created_at, r.priority, r.target_id ? `${r.target}:${r.target_id}` : r.target, r.sender_name, r.message]
      .map((c) => `"${String(c).replace(/"/g, '""')}"`)
      .join(','),
  );
  return [header, ...lines].join('\n');
}

export function lockUnitsToCsv(rows: Array<{
  unit_id: string;
  officer_name: string;
  badge: string;
  status: string;
  reason?: string;
}>): string {
  const header = 'unit,officer,badge,status,reason';
  const lines = rows.map((r) =>
    [r.unit_id, r.officer_name, r.badge, r.status, r.reason ?? '']
      .map((c) => `"${String(c).replace(/"/g, '""')}"`)
      .join(','),
  );
  return [header, ...lines].join('\n');
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
