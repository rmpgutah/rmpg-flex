// ============================================================
// Dispatch Page — Formatting Utilities
// ============================================================

import { toDisplayLabel } from '../../../utils/formatters';
import { parseTimestamp, APP_TIME_ZONE } from '../../../utils/dateUtils';

/** Filter tab type for the dispatch call queue. */
export type FilterTab = 'all' | 'pending' | 'active' | 'cleared' | 'archived' | 'serve' | 'mine';

/**
 * Format a server timestamp to MM/DD/YYYY @ HH:MM:SS (24-hour) in Mountain Time.
 * Must go through parseTimestamp — server strings are naive UTC, and raw
 * `new Date("2026-05-29 00:59:41")` parses as device-LOCAL in V8 (wrong instant).
 * Display is pinned to America/Denver so it's MT regardless of device.
 */
export function formatTime(dateStr: string): string {
  if (!dateStr) return '--';
  const d = parseTimestamp(dateStr);
  if (isNaN(d.getTime())) return '--';
  const date = d.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: APP_TIME_ZONE });
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: APP_TIME_ZONE });
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
