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
