// ============================================================
// RMPG Flex — call note append helper
// ============================================================
// calls_for_service.notes is a JSON array of {id, author, text, timestamp}
// (legacy rows may hold plain text). Appending = read → merge → PUT, so the
// PUT route's audit/broadcast fire and no prior note is ever lost. Shared by
// the CAD `NT` verb and the dispatcher command engine's append_note action.

import { apiFetch } from '../hooks/useApi';

export interface CallNote { id: string; author: string; text: string; timestamp: string }

export function mergeNotes(existing: unknown, text: string, author: string, now: Date = new Date()): CallNote[] {
  let notes: CallNote[] = [];
  if (typeof existing === 'string' && existing.trim()) {
    try {
      const parsed = JSON.parse(existing);
      if (Array.isArray(parsed)) notes = parsed as CallNote[];
    } catch { /* plain text — preserved below */ }
    if (notes.length === 0) {
      notes = [{ id: 'legacy', author: 'System', text: existing, timestamp: now.toISOString() }];
    }
  } else if (Array.isArray(existing)) {
    notes = existing as CallNote[];
  }
  return [...notes, { id: String(now.getTime()), author, text, timestamp: now.toISOString() }];
}

export async function appendCallNote(callId: string | number, text: string, author: string): Promise<CallNote[]> {
  const current = await apiFetch<{ notes?: unknown }>(`/dispatch/calls/${callId}`);
  const merged = mergeNotes(current?.notes, text, author);
  await apiFetch(`/dispatch/calls/${callId}`, {
    method: 'PUT',
    body: JSON.stringify({ notes: JSON.stringify(merged) }),
  });
  return merged;
}
