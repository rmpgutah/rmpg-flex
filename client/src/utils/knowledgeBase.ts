// Client for the system-wide Knowledge Base search (/api/knowledge-base).
// One call returns ranked, normalized results across every record type,
// keyed on the VISIBLE identifier (call/case/citation/warrant number, name,
// plate, badge, call sign, statute cite) — never the backend row id.
//
// Shared by the global Cmd+K search (GlobalSearch.tsx) and the dedicated
// Knowledge Base page so both stay in lockstep.

import { apiFetch } from '../hooks/useApi';

export interface KbResult {
  type: string;
  /** The visible assignment number / name — the headline users search by. */
  label: string;
  title: string;
  subtitle: string;
  route: string;
  recordId: number;
}

/** Per-type display metadata (label + accent). Icons are chosen in the UI. */
export const KB_TYPE_META: Record<string, { label: string; color: string }> = {
  call: { label: 'Calls', color: '#22c55e' },
  person: { label: 'Persons', color: '#d4a017' },
  vehicle: { label: 'Vehicles', color: '#a78bfa' },
  warrant: { label: 'Warrants', color: '#f59e0b' },
  citation: { label: 'Citations', color: '#38bdf8' },
  incident: { label: 'Incidents', color: '#fb923c' },
  personnel: { label: 'Personnel', color: 'var(--rmpg-400)' },
  unit: { label: 'Units', color: '#34d399' },
  evidence: { label: 'Evidence', color: '#c084fc' },
  bolo: { label: 'BOLOs', color: '#ef4444' },
  property: { label: 'Property', color: 'var(--rmpg-400)' },
  arrest: { label: 'Arrests', color: '#fb7185' },
  statute: { label: 'Statutes', color: '#d4a017' },
};

export function kbTypeLabel(type: string): string {
  return KB_TYPE_META[type]?.label || type;
}

/** Run a knowledge-base search. Returns [] for short queries or on failure. */
export async function knowledgeBaseSearch(query: string, limit = 50): Promise<KbResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const res = await apiFetch<{ results?: KbResult[] } | KbResult[]>(
      `/knowledge-base/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    );
    if (Array.isArray(res)) return res;
    return Array.isArray(res?.results) ? res.results : [];
  } catch {
    return [];
  }
}
