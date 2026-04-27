// ============================================================
// Dispatch Page — Formatting Utilities
// ============================================================

import { toDisplayLabel } from '../../../utils/formatters';

/** Filter tab type for the dispatch call queue. */
export type FilterTab = 'all' | 'pending' | 'active' | 'cleared' | 'archived' | 'serve' | 'mine';

/**
 * Format a date string to MM/DD/YYYY @ HH:MM:SS (24-hour military time).
 * Example: 03/09/2026 @ 02:15:33 PM
 */
export function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '--';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${mm}/${dd}/${yyyy} @ ${hh}:${mi}:${ss}`;
}

/**
 * Format a date string as elapsed time: "15m" or "2h 15m".
 */
export function formatElapsed(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
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
