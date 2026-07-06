// ============================================================
// Dispatch Page — Formatting Utilities
// ============================================================

import { toDisplayLabel } from '../../../utils/formatters';
import { parseTimestamp } from '../../../utils/dateUtils';
import { displayTimeZone } from '../../../utils/timeZoneMode';
import { humanizeType } from '../../../utils/statusLabels';
import { coded } from '../../../utils/searchText';
import type { CallForService } from '../../../types';
import type { WarningTag } from '../../../components/WarningTags';

/** Filter tab type for the dispatch call queue. */
export type FilterTab = 'queue' | 'pending' | 'active' | 'hold' | 'serve' | 'cleared' | 'archived';

/**
 * Format a server timestamp to MM/DD/YYYY @ HH:MM:SS (24-hour) in the active
 * display zone (Mountain by default, or the device zone if the user opted in).
 * Must go through parseTimestamp — server strings are naive UTC, and raw
 * `new Date("2026-05-29 00:59:41")` parses as device-LOCAL in V8 (wrong instant).
 */
export function formatTime(dateStr: string): string {
  if (!dateStr) return '--';
  const d = parseTimestamp(dateStr);
  if (isNaN(d.getTime())) return '--';
  const tz = displayTimeZone();
  const date = d.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz });
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: tz });
  return `${date} @ ${time}`;
}

/**
 * Format a server timestamp as elapsed time: "15m" or "2h 15m".
 * parseTimestamp (UTC-aware) — elapsed is timezone-independent but the parse
 * must be correct, or a raw device-local parse skews it by the UTC offset.
 */
export function formatElapsed(dateStr: string): string {
  const diff = Date.now() - parseTimestamp(dateStr).getTime();
  if (isNaN(diff) || diff < 0) return '0m';
  const min = Math.floor(diff / 60000);
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

/**
 * Format activity log details to be human-readable.
 * Converts "Updated call 26-CFS00002: incident_type, priority, caller_name, ..."
 * → "Updated call 26-CFS00002: Incident Type, Priority, Caller Name, ..."
 * Also summarizes long field lists.
 */
export function formatActivityDetails(details: string): string {
  if (!details) return '--';
  // Match pattern: "Updated call XX: field1, field2, ..."
  const match = details.match(/^(Updated call \S+):\s*(.+)$/);
  if (match) {
    const prefix = match[1];
    const fieldList = match[2].split(',').map(f => f.trim()).filter(Boolean);
    // Convert each snake_case field to readable label
    const readable = fieldList.map(f => toDisplayLabel(f));
    // Summarize if too many fields
    if (readable.length > 6) {
      return `${prefix}: updated ${readable.length} fields — ${readable.slice(0, 4).join(', ')}, and ${readable.length - 4} more`;
    }
    return `${prefix}: ${readable.join(', ')}`;
  }
  // For other patterns, just clean up any snake_case words
  return details.replace(/\b[a-z]+(?:_[a-z]+)+\b/g, (word) => toDisplayLabel(word));
}

/**
 * Label a call's age bucket based on time since creation.
 */
export function formatCallAge(createdAt: string): string {
  const diff = Date.now() - parseTimestamp(createdAt).getTime();
  if (isNaN(diff) || diff < 0) return 'NEW';
  const mins = diff / 60_000;
  if (mins < 5) return 'NEW';
  if (mins < 60) return 'ACTIVE';
  if (mins < 240) return 'AGING';
  return 'STALE';
}

/**
 * Return a priority string with an emoji badge prefix.
 */
export function formatPriorityBadge(priority: string): string {
  switch (priority) {
    case 'P1': return '🔴 P1';
    case 'P2': return '🟠 P2';
    case 'P3': return '🟡 P3';
    case 'P4': return '🟢 P4';
    default:   return priority;
  }
}

/**
 * Humanize a status transition (e.g. "dispatched" → "En Route" becomes
 * "Dispatched → En Route").
 */
export function getStatusTransitionLabel(from: string, to: string): string {
  return `${toDisplayLabel(from)} → ${toDisplayLabel(to)}`;
}

// ── Upgrade: Handoff Summary Formatter ──
export function formatHandoffSummary(handoff: {
  active_calls_summary?: string;
  held_calls_summary?: string;
  pending_backups?: string;
  officer_notes?: string;
  priority_items?: string;
}): string {
  const parts: string[] = [];

  try {
    const active = JSON.parse(handoff.active_calls_summary || '[]');
    if (active.length > 0) {
      parts.push(`ACTIVE CALLS (${active.length}):`);
      active.slice(0, 10).forEach((c: any) => {
        parts.push(`  ${c.priority} ${c.call_number} — ${c.incident_type} @ ${c.location_address || 'Unknown'} [${c.status}]`);
      });
      if (active.length > 10) parts.push(`  ... and ${active.length - 10} more`);
    }
  } catch { /* ignore parse errors */ }

  try {
    const held = JSON.parse(handoff.held_calls_summary || '[]');
    if (held.length > 0) {
      parts.push(`\nHELD CALLS (${held.length}):`);
      held.forEach((c: any) => {
        parts.push(`  ${c.priority} ${c.call_number} — ${c.incident_type}`);
      });
    }
  } catch { /* ignore */ }

  try {
    const backups = JSON.parse(handoff.pending_backups || '[]');
    if (backups.length > 0) {
      parts.push(`\nPENDING BACKUPS (${backups.length}):`);
      backups.forEach((c: any) => {
        parts.push(`  ${c.priority} ${c.call_number} — ${c.incident_type} @ ${c.location_address || 'Unknown'}`);
      });
    }
  } catch { /* ignore */ }

  if (handoff.priority_items) parts.push(`\nPRIORITY ITEMS: ${handoff.priority_items}`);
  if (handoff.officer_notes) parts.push(`\nNOTES: ${handoff.officer_notes}`);

  return parts.join('\n') || 'No active items to hand off.';
}

// ── Upgrade: Mutual Aid Status Formatter ──
export function formatMutualAidStatus(request: {
  responding_agency: string;
  status: string;
  units_requested: number;
  units_provided: number;
  priority: string;
}): string {
  const statusLabels: Record<string, string> = {
    pending: '⏳ PENDING',
    approved: '✅ APPROVED',
    denied: '❌ DENIED',
    completed: '✔ COMPLETED',
    cancelled: '⊘ CANCELLED',
  };
  return `${statusLabels[request.status] || request.status.toUpperCase()} — ${request.responding_agency} | ${request.priority} | Units: ${request.units_provided}/${request.units_requested}`;
}

// ── Upgrade: Quality Score Formatter ──
export function formatQualityScore(compliance: {
  priority: string;
  total: number;
  within_target: number;
}): string {
  const pct = compliance.total > 0 ? Math.round((compliance.within_target / compliance.total) * 100) : 0;
  const grade = pct >= 95 ? 'A' : pct >= 85 ? 'B' : pct >= 75 ? 'C' : pct >= 60 ? 'D' : 'F';
  return `${compliance.priority}: ${pct}% (${grade}) — ${compliance.within_target}/${compliance.total} within target`;
}

/**
 * Case-insensitive substring match for the Dispatch page's "Search calls" box
 * — call #, location, incident type (raw or humanized/coded), description,
 * caller name, and geography (dispatch code, sector/zone/beat). Shared by
 * the classic list's filteredCalls pipeline and the CAD board's own search
 * filter, so both surfaces match the same way for the same query.
 */
export function callMatchesSearch(call: CallForService, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    (call.call_number || '').toLowerCase().includes(q) ||
    (call.location || '').toLowerCase().includes(q) ||
    coded(call.incident_type, humanizeType).includes(q) ||
    (call.description || '').toLowerCase().includes(q) ||
    (call.caller_name || '').toLowerCase().includes(q) ||
    (call.dispatch_code || '').toLowerCase().includes(q) ||
    (call.zone_beat || '').toLowerCase().includes(q) ||
    (call.sector_name || '').toLowerCase().includes(q) ||
    (call.zone_id || '').toLowerCase().includes(q) ||
    (call.zone_name || '').toLowerCase().includes(q) ||
    (call.beat_id || '').toLowerCase().includes(q) ||
    (call.beat_name || '').toLowerCase().includes(q)
  );
}

// Values that mean "no weapon", not "unknown weapon" — a plain truthy check
// would flag "none" as ARMED. Compared against a trimmed/lowercased value so
// data-entry variants ('NONE', 'None ', etc.) are excluded too, not just the
// exact casings the server's callWarnings handler (src/routes/dispatch/
// extensions.ts) happens to check — that handler has the same case/whitespace
// gap; not fixed here since this PR only touches the client.
const NO_WEAPON_VALUES = new Set(['', '0', 'none', 'nil', 'n/a']);

/**
 * Derives CallCard's compact warning badges from fields already present on
 * every list-row call object (weapons_involved/injuries_reported/
 * domestic_violence — see LIST_VIEW_COLUMNS in calls.ts) — no extra network
 * round trip. Deliberately a SUBSET of the full safety briefing the server's
 * GET /dispatch/calls/:id/warnings returns (that one also covers officer-
 * safety-caution/hazmat/mental-health/felony-in-progress/gang/premise-alert
 * proximity, all of which live in calls_for_service_ext or need a per-call
 * geo query — not safe/practical to bulk-fetch for every row in the queue).
 * This is a "does this call need a second look" glance, not the full detail
 * — that still lives on the call's own record.
 */
export function deriveCallWarnings(call: CallForService): WarningTag[] {
  const warnings: WarningTag[] = [];
  if (call.weapons_involved && !NO_WEAPON_VALUES.has(String(call.weapons_involved).trim().toLowerCase())) {
    warnings.push({ type: 'ARMED', label: 'ARMED / WEAPONS', severity: 'critical', source: 'call' });
  }
  if (call.domestic_violence) {
    warnings.push({ type: 'DV', label: 'DOMESTIC VIOLENCE', severity: 'high', source: 'call' });
  }
  if (call.injuries_reported) {
    warnings.push({ type: 'INJURIES', label: 'INJURIES REPORTED', severity: 'high', source: 'call' });
  }
  return warnings;
}
