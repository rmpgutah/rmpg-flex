// ============================================================
// RMPG Flex — Daily Email: HTML renderer
// ============================================================
// Pure function: DailyReportData + ExtendedActivity → HTML string.
// No D1, no fetch, no clock reads. Email-client-compatible
// inline styles only (no external CSS, no <style> blocks in
// most clients).
// ============================================================

import type { DailyReportData } from '../dailyReport/types';
import type { ExtendedActivity } from './collectExtended';
import { toDenverWallClock } from '../denverTime';

// ── Helpers ───────────────────────────────────────────────

const ACRONYMS = new Set(['pspso','psos','cfs','utah','slc','id','pp','gp','dna','dob','dl','atv','psp']);

/** Convert snake_case to Title Case. e.g. "pso_client_request" → "PSO Client Request" */
function toDisplayLabel(s: string | null | undefined): string {
  if (!s) return '—';
  return s
    .replace(/_/g, ' ')
    .split(' ')
    .map(w => {
      const lower = w.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.replace(/pspso/i,'PSO').replace(/psos/i,'PSO').replace(/cfs/i,'CFS').replace(/utah/i,'Utah').replace(/slc/i,'SLC').replace(/pp/i,'PP').replace(/gp/i,'GP');
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

/** Parse a D1 UTC timestamp to Mountain Time "HH:MM MT". */
function fmtTime(s: string | null | undefined): string {
  if (!s) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  let raw: string;
  if (/[Zz]$/.test(s)) {
    raw = s;
  } else if (/^\d{4}-\d{2}-\d{2} /.test(s)) {
    raw = s.replace(' ', 'T') + 'Z';
  } else if (/^\d{4}-\d{2}-\d{2}T/.test(s) && !/[+-]\d{2}:?\d{2}$/.test(s.slice(-6))) {
    raw = s + 'Z';
  } else {
    raw = s;
  }
  const d = new Date(raw);
  if (isNaN(d.getTime())) return '—';
  const wall = toDenverWallClock(d);
  if (!wall) return '—';
  return wall.slice(11, 16) + ' MT';
}

/** Format unit_call_signs — clean empty/[]/null → '—'. */
function fmtUnits(s: string | null | undefined): string {
  if (!s) return '—';
  const trimmed = s.trim();
  if (!trimmed || trimmed === '[]' || trimmed === 'null' || trimmed === 'undefined') return '—';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr) && arr.length > 0) {
        return arr.filter((v: unknown) => v != null && String(v).trim() !== '').join(', ') || '—';
      }
      return '—';
    } catch { return trimmed; }
  }
  return trimmed;
}

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function countRow(label: string, count: number): string {
  return `<tr>
    <td style="padding:4px 8px;font-size:13px;color:#374151;">${esc(label)}</td>
    <td style="padding:4px 8px;font-size:13px;color:#111827;font-weight:600;text-align:right;">${count}</td>
  </tr>`;
}

function sectionHeader(title: string): string {
  return `<tr>
    <td colspan="2" style="padding:12px 8px 4px;font-size:14px;font-weight:700;color:#1e3a5f;border-top:1px solid #d1d5db;">
      ${esc(title)}
    </td>
  </tr>`;
}

function noActivity(): string {
  return `<tr>
    <td colspan="2" style="padding:4px 8px;font-size:12px;color:#6b7280;font-style:italic;">
      No activity recorded.
    </td>
  </tr>`;
}

// ── Main renderer ─────────────────────────────────────────

export function renderDailyEmailHtml(
  blotter: DailyReportData,
  extended: ExtendedActivity,
): string {
  const d = blotter.date;

  // Summary counters
  const callCount = blotter.operations.calls.length;
  const citationCount = blotter.operations.citations.length;
  const tripCount = blotter.fleet.trips.length;
  const fuelCount = blotter.fleet.fuel.length;
  const checkCount = blotter.fleet.checks.length;
  const workOrderCount = blotter.fleet.workOrders.length;
  const totalActions = callCount + citationCount + extended.warrants.totalCount +
    extended.incidents.totalCount + extended.alpr.totalCount +
    extended.patrolScans.totalCount + extended.persons.totalCount +
    tripCount + fuelCount + checkCount + workOrderCount;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;">
<tr><td align="center" style="padding:24px 0;">
<table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

  <!-- Header -->
  <tr>
    <td style="background-color:#1e3a5f;padding:20px 24px;">
      <div style="font-size:18px;font-weight:700;color:#ffffff;">Rocky Mountain Protective Group</div>
      <div style="font-size:13px;color:#93c5fd;margin-top:4px;">Daily Activity Report &mdash; ${esc(d)}</div>
    </td>
  </tr>

  <!-- Summary -->
  <tr>
    <td style="padding:16px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-size:14px;font-weight:700;color:#1e3a5f;padding-bottom:8px;">
            Daily Summary
          </td>
        </tr>
        <tr>
          <td style="font-size:48px;font-weight:700;color:#1e3a5f;text-align:center;padding:8px 0;">
            ${totalActions}
          </td>
        </tr>
        <tr>
          <td style="font-size:12px;color:#6b7280;text-align:center;">
            total actions recorded
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Counts Table -->
  <tr>
    <td style="padding:0 24px 16px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:4px;">
        ${sectionHeader('Operations')}
        ${countRow('Calls for Service', callCount)}
        ${countRow('Citations', citationCount)}

        ${sectionHeader('Warrants')}
        ${countRow('New Warrants', extended.warrants.newCount)}
        ${countRow('Warrants Served', extended.warrants.servedCount)}

        ${sectionHeader('Incidents')}
        ${countRow('New Incidents', extended.incidents.totalCount)}
        ${Object.entries(extended.incidents.byStatus).map(([s, n]) =>
          countRow(`  ${s}`, n)
        ).join('')}

        ${sectionHeader('ALPR / Vehicle Intelligence')}
        ${countRow('ALPR Captures', extended.alpr.totalCount)}
        ${countRow('Alerted', extended.alpr.alertedCount)}

        ${sectionHeader('Patrol Compliance')}
        ${countRow('Patrol Scans', extended.patrolScans.totalCount)}
        ${extended.patrolScans.totalCount > 0 ? [
          countRow('  On Time', extended.patrolScans.onTime),
          countRow('  Late', extended.patrolScans.late),
          countRow('  Missed', extended.patrolScans.missed),
        ].join('') : ''}

        ${sectionHeader('Records')}
        ${countRow('New Persons Added', extended.persons.totalCount)}

        ${sectionHeader('Fleet')}
        ${countRow('Vehicle Trips', tripCount)}
        ${countRow('Fuel Entries', fuelCount)}
        ${countRow('Inspections / Pre-Trip', checkCount)}
        ${countRow('Work Orders', workOrderCount)}
      </table>
    </td>
  </tr>

  <!-- Call Details (if any) -->
  ${callCount > 0 ? `
  <tr>
    <td style="padding:0 24px 16px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:4px;">
        <tr>
          <td colspan="2" style="padding:8px;font-size:13px;font-weight:700;color:#1e3a5f;background-color:#f9fafb;">
            Calls for Service Detail (${callCount})
          </td>
        </tr>
        <tr style="background-color:#f9fafb;">
          <td style="padding:4px 8px;font-size:11px;font-weight:600;color:#6b7280;width:80px;">TIME</td>
          <td style="padding:4px 8px;font-size:11px;font-weight:600;color:#6b7280;">CALL / TYPE / UNIT / OFFICER</td>
        </tr>
        ${blotter.operations.calls.map((c) => `
        <tr>
          <td style="padding:3px 8px;font-size:12px;color:#374151;white-space:nowrap;vertical-align:top;">
            ${esc(fmtTime(c.received_at))}<br/>
            <span style="font-size:10px;color:#9ca3af;">${esc(c.source ?? '')}</span>
          </td>
          <td style="padding:3px 8px;font-size:12px;color:#111827;">
            ${esc(c.call_number ?? '—')} &mdash; ${esc(toDisplayLabel(c.incident_type))} (P${esc(String(c.priority ?? '—'))}) ${esc(c.secondary_type ? `[${toDisplayLabel(c.secondary_type)}]` : '')}<br/>
            <span style="color:#6b7280;font-size:11px;">
              ${esc(c.location_address ?? '—')} | ${esc(fmtUnits(c.unit_call_signs))} | ${esc(c.responding_officer ?? '—')} | ${esc(toDisplayLabel(c.disposition ?? c.status ?? '—'))}
            </span>
            ${c.description ? `<br/><span style="color:#374151;font-size:11px;"><b>Dispatch:</b> ${esc(c.description.slice(0,200))}${(c.description?.length ?? 0) > 200 ? '…' : ''}</span>` : ''}
            ${c.notes ? `<br/><span style="color:#374151;font-size:11px;"><b>Notes:</b> ${esc(c.notes.slice(0,200))}${(c.notes?.length ?? 0) > 200 ? '…' : ''}</span>` : ''}
            ${c.action_taken ? `<br/><span style="color:#374151;font-size:11px;"><b>Action:</b> ${esc(c.action_taken.slice(0,200))}${(c.action_taken?.length ?? 0) > 200 ? '…' : ''}</span>` : ''}
            ${c.damage_description ? `<br/><span style="color:#374151;font-size:11px;"><b>Damage:</b> ${esc(c.damage_description.slice(0,200))}${(c.damage_description?.length ?? 0) > 200 ? '…' : ''} ${c.damage_estimate ? `($${c.damage_estimate})` : ''}</span>` : ''}
            <br/>
            <span style="font-size:10px;color:#9ca3af;">
              ${[c.sector_name ? `Sector: ${esc(c.sector_name)}` : '', c.zone_name ? `Zone: ${esc(c.zone_name)}` : '', c.beat_name ? `Beat: ${esc(c.beat_name)}` : '', c.dispatch_code ? `Code: ${esc(c.dispatch_code)}` : '', c.caller_relationship ? `Caller: ${esc(c.caller_relationship)}` : '', c.caller_name ? `${esc(c.caller_name)}` : ''].filter(Boolean).join(' | ')}
            </span>
            <br/>
            <span style="font-size:10px;color:#9ca3af;">
              ${[
                c.response_time_seconds != null ? `Response: ${Math.round(c.response_time_seconds / 60)}m${c.response_time_seconds % 60}s` : '',
                c.onscene_duration_seconds != null ? `On-Scene: ${Math.round(c.onscene_duration_seconds / 60)}m${c.onscene_duration_seconds % 60}s` : '',
                c.scene_safety ? `Safety: ${esc(c.scene_safety)}` : '',
              ].filter(Boolean).join(' | ')}
            </span>
            <br/>
            <span style="font-size:10px;color:#9ca3af;">
              ${[
                c.weapons_involved ? 'WEAPONS' : '',
                c.domestic_violence ? 'DV' : '',
                c.mental_health_crisis ? 'MENTAL HEALTH' : '',
                c.juvenile_involved ? 'JUVENILE' : '',
                c.felony_in_progress ? 'FELONY' : '',
                c.officer_safety_caution ? 'OFFICER SAFETY' : '',
                c.k9_requested ? 'K9' : '',
                c.ems_requested ? 'EMS' : '',
                c.le_notified ? `LE: ${esc(c.le_case_number ?? '—')}` : '',
                c.supervisor_notified ? 'SUPERVISOR' : '',
              ].filter(Boolean).map(f => `<span style="background:#fef3c7;color:#92400e;padding:1px 4px;border-radius:2px;margin-right:4px;">${f}</span>`).join(' ')}
            </span>
            ${c.pso_requestor_name ? `<br/><span style="font-size:10px;color:#9ca3af;">PSO Request: ${esc(c.pso_requestor_name)} — ${esc(c.pso_service_type ?? '—')}</span>` : ''}
          </td>
        </tr>`).join('')}
      </table>
    </td>
  </tr>` : ''}

  <!-- Citation Details (if any) -->
  ${citationCount > 0 ? `
  <tr>
    <td style="padding:0 24px 16px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:4px;">
        <tr>
          <td colspan="2" style="padding:8px;font-size:13px;font-weight:700;color:#1e3a5f;background-color:#f9fafb;">
            Citations Detail
          </td>
        </tr>
        ${blotter.operations.citations.map((c) => `
        <tr>
          <td style="padding:3px 8px;font-size:12px;color:#111827;">
            ${esc(c.citation_number ?? '—')} &mdash; ${esc(c.violation_description ?? '—')}<br/>
            <span style="color:#6b7280;font-size:11px;">
              ${esc(c.issuing_officer_name ?? '—')} | $${c.fine_amount ?? 0}
            </span>
          </td>
        </tr>`).join('')}
      </table>
    </td>
  </tr>` : ''}

  <!-- Warrant Highlights (if any) -->
  ${extended.warrants.totalCount > 0 ? `
  <tr>
    <td style="padding:0 24px 16px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:4px;">
        <tr>
          <td colspan="2" style="padding:8px;font-size:13px;font-weight:700;color:#1e3a5f;background-color:#f9fafb;">
            Warrant Activity
          </td>
        </tr>
        ${extended.warrants.newToday.map((w) => `
        <tr>
          <td style="padding:3px 8px;font-size:12px;color:#111827;">
            NEW: ${esc(w.warrant_number ?? '—')} &mdash; ${esc(w.subject_name ?? '—')}<br/>
            <span style="color:#6b7280;font-size:11px;">
              ${esc(w.charge_description ?? '—')} | ${esc(w.type ?? '—')} | $${w.bond_amount ?? 0}
            </span>
          </td>
        </tr>`).join('')}
        ${extended.warrants.servedToday.map((w) => `
        <tr>
          <td style="padding:3px 8px;font-size:12px;color:#111827;">
            SERVED: ${esc(w.warrant_number ?? '—')} &mdash; ${esc(w.subject_name ?? '—')}<br/>
            <span style="color:#6b7280;font-size:11px;">
              ${esc(w.charge_description ?? '—')} | Served at ${esc(w.served_at ?? '—')}
            </span>
          </td>
        </tr>`).join('')}
      </table>
    </td>
  </tr>` : ''}

  <!-- ALPR Highlights (if alerted) -->
  ${extended.alpr.alertedCount > 0 ? `
  <tr>
    <td style="padding:0 24px 16px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ef4444;border-radius:4px;">
        <tr>
          <td colspan="2" style="padding:8px;font-size:13px;font-weight:700;color:#dc2626;background-color:#fef2f2;">
            ALPR Alerts (${extended.alpr.alertedCount} of ${extended.alpr.totalCount} captures)
          </td>
        </tr>
        ${extended.alpr.rows.filter((a) => a.alerted === 1).map((a) => `
        <tr>
          <td style="padding:3px 8px;font-size:12px;color:#111827;">
            ${esc(a.plate ?? '—')} (${esc(a.state ?? '—')}) &mdash; ${esc(a.make ?? '')} ${esc(a.model ?? '')} ${esc(a.color ?? '')}<br/>
            <span style="color:#6b7280;font-size:11px;">
              Confidence: ${a.confidence != null ? `${Math.round(a.confidence * 100)}%` : '—'} | Risk: ${a.risk_score != null ? a.risk_score.toFixed(2) : '—'} | ${fmtTime(a.created_at)}
            </span>
          </td>
        </tr>`).join('')}
      </table>
    </td>
  </tr>` : ''}

  <!-- Incidents Detail (if any) -->
  ${extended.incidents.totalCount > 0 ? `
  <tr>
    <td style="padding:0 24px 16px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:4px;">
        <tr>
          <td colspan="2" style="padding:8px;font-size:13px;font-weight:700;color:#1e3a5f;background-color:#f9fafb;">
            Incidents Detail (${extended.incidents.totalCount})
          </td>
        </tr>
        <tr style="background-color:#f9fafb;">
          <td style="padding:4px 8px;font-size:11px;font-weight:600;color:#6b7280;">TIME</td>
          <td style="padding:4px 8px;font-size:11px;font-weight:600;color:#6b7280;">INCIDENT / TYPE / STATUS / LOCATION</td>
        </tr>
        ${extended.incidents.rows.map((inc) => `
        <tr>
          <td style="padding:3px 8px;font-size:12px;color:#374151;white-space:nowrap;vertical-align:top;">
            ${esc(fmtTime(inc.created_at))}
          </td>
          <td style="padding:3px 8px;font-size:12px;color:#111827;">
            ${esc(inc.incident_number ?? '—')} &mdash; ${esc(toDisplayLabel(inc.incident_type))} (P${esc(String(inc.priority ?? '—'))})<br/>
            <span style="color:#6b7280;font-size:11px;">
              ${esc(inc.location_address ?? '—')} | ${esc(toDisplayLabel(inc.status ?? '—'))}
            </span>
          </td>
        </tr>`).join('')}
      </table>
    </td>
  </tr>` : ''}

  <!-- Footer -->
  <tr>
    <td style="background-color:#f9fafb;padding:16px 24px;border-top:1px solid #e5e7eb;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-size:11px;color:#9ca3af;">
            Generated ${esc(blotter.generatedAt)} &bull; Rocky Mountain Protective Group &bull; Confidential
          </td>
        </tr>
      </table>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}
