// ============================================================
// Dispatch Page — Formatting Utilities
// ============================================================

import { toDisplayLabel } from '../../../utils/formatters';
import { parseTimestamp } from '../../../utils/dateUtils';
import { displayTimeZone } from '../../../utils/timeZoneMode';

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
  const diff = Date.now() - new Date(createdAt).getTime();
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
