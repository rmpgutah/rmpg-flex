// Mail-merge engine for the Document Writer.
//
// Templates (and any document) can contain {{placeholder}} tokens. This module
// (a) scans the current editor HTML for those tokens, (b) builds a value map
// from a fetched CFS call + the logged-in officer + manual entries, and (c)
// replaces every token in the document HTML in one pass. Pure string/regex work
// over the editor's own HTML — no extra npm packages.

import type { Editor } from '@tiptap/react';
import { apiFetch } from '../../hooks/useApi';

/** Match {{ token }} allowing dots, underscores, spaces inside the braces. */
const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_.\s-]+?)\s*\}\}/g;

/** Distinct placeholder keys present in the document HTML, in first-seen order. */
export function scanPlaceholders(html: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(html)) !== null) {
    const key = m[1].trim();
    if (!seen.has(key)) { seen.add(key); out.push(key); }
  }
  return out;
}

export interface OfficerContext {
  name?: string;
  badge?: string | number;
  rank?: string;
  department?: string;
}

/** A normalized CFS call shape we read from /api/dispatch/calls. The live table
 *  has 100 columns; we only pull the merge-relevant ones and tolerate aliases. */
export interface MergeCall {
  call_number?: string;
  call_type?: string;
  address?: string;
  city?: string;
  received_at?: string;
  dispatched_at?: string;
  status?: string;
  disposition?: string;
  narrative?: string;
  caller_name?: string;
  caller_phone?: string;
  latitude?: number | string;
  longitude?: number | string;
  [k: string]: unknown;
}

const SENTINEL = new Set(['none', 'n/a', 'na', 'null', 'undefined', '']);
function clean(v: unknown): string {
  if (v == null) return '';
  const s = String(v).trim();
  return SENTINEL.has(s.toLowerCase()) ? '' : s;
}

/** Fetch a single CFS call by its call number (best match) for merging. */
export async function fetchCallForMerge(callNumber: string): Promise<MergeCall | null> {
  const q = callNumber.trim();
  if (!q) return null;
  try {
    const data = await apiFetch<{ calls?: MergeCall[] } | MergeCall[]>(
      `/dispatch/calls?q=${encodeURIComponent(q)}&limit=5`,
    );
    const list = Array.isArray(data) ? data : data.calls || [];
    if (list.length === 0) return null;
    // Prefer an exact call_number match; else take the first hit.
    return list.find((c) => clean(c.call_number).toLowerCase() === q.toLowerCase()) || list[0];
  } catch {
    return null;
  }
}

/** Build the merge value map from a call + officer + today's date. Keys are
 *  matched case-insensitively and also offered in snake/space variants so a
 *  template author can write {{call_number}} or {{Call Number}}. */
export function buildMergeValues(call: MergeCall | null, officer: OfficerContext): Record<string, string> {
  const now = new Date();
  const base: Record<string, string> = {
    date: now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    time: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    datetime: now.toLocaleString(),
    today: now.toISOString().slice(0, 10),
    officer_name: clean(officer.name),
    officer: clean(officer.name),
    badge: clean(officer.badge),
    badge_number: clean(officer.badge),
    rank: clean(officer.rank),
    department: clean(officer.department) || 'Rocky Mountain Protective Group',
  };
  if (call) {
    Object.assign(base, {
      call_number: clean(call.call_number),
      case_number: clean(call.call_number),
      call_type: clean(call.call_type),
      address: clean(call.address),
      location: clean(call.address),
      city: clean(call.city),
      received_at: clean(call.received_at),
      dispatched_at: clean(call.dispatched_at),
      status: clean(call.status),
      disposition: clean(call.disposition),
      narrative: clean(call.narrative),
      caller_name: clean(call.caller_name),
      caller_phone: clean(call.caller_phone),
      latitude: clean(call.latitude),
      longitude: clean(call.longitude),
    });
  }
  // Provide space-variant aliases so {{Call Number}} resolves too.
  const aliased: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    aliased[k] = v;
    aliased[k.replace(/_/g, ' ')] = v;
  }
  return aliased;
}

/** Resolve a single placeholder key against the value map (case-insensitive,
 *  underscore/space-insensitive). Returns undefined if not mapped. */
export function resolveKey(key: string, values: Record<string, string>): string | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '_');
  const target = norm(key);
  for (const [k, v] of Object.entries(values)) {
    if (norm(k) === target) return v;
  }
  return undefined;
}

export interface MergeResult { filled: number; missing: string[] }

/** Replace every {{token}} in the editor with its mapped value. Unmapped tokens
 *  are left intact (so the user can fill them manually) and reported as missing.
 *  Returns counts; mutates the editor content in place. */
export function applyMerge(editor: Editor, values: Record<string, string>): MergeResult {
  const html = editor.getHTML();
  let filled = 0;
  const missing: string[] = [];
  const seenMissing = new Set<string>();
  const next = html.replace(TOKEN_RE, (whole, rawKey) => {
    const key = String(rawKey).trim();
    const val = resolveKey(key, values);
    if (val === undefined) {
      if (!seenMissing.has(key)) { seenMissing.add(key); missing.push(key); }
      return whole; // leave the token for manual fill
    }
    filled++;
    // Escape the replacement so a value containing < or & can't break the HTML.
    return val.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  });
  if (next !== html) editor.commands.setContent(next);
  return { filled, missing };
}
