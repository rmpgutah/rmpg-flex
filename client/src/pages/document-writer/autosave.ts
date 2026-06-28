// Autosave, crash recovery, and version snapshots for the Document Writer.
// localStorage-backed (documents are HTML strings); guarded against quota errors.
// Covers features 13–20: auto-save, indicator, recovery, session persistence,
// named snapshots/checkpoints, version history, restore.

const DRAFT_KEY = 'rmpg_writer_draft';
const SNAP_KEY = 'rmpg_writer_snapshots';
const MAX_SNAPSHOTS = 30;

export interface Draft { title: string; html: string; savedAt: string }
export interface Snapshot { id: string; name: string; html: string; title: string; createdAt: string }

export function writeDraft(title: string, html: string): string | null {
  const savedAt = new Date().toISOString();
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ title, html, savedAt }));
    return savedAt;
  } catch {
    return null; // quota (e.g. large base64 images) — autosave best-effort
  }
}

export function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch { return null; }
}

export function clearDraft(): void {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
}

export function listSnapshots(): Snapshot[] {
  try { return JSON.parse(localStorage.getItem(SNAP_KEY) || '[]') as Snapshot[]; } catch { return []; }
}

export function saveSnapshot(name: string, title: string, html: string): Snapshot {
  const snap: Snapshot = {
    // Avoid Date.now()/Math.random reliance issues by composing from ISO + counter.
    id: `${new Date().toISOString()}-${listSnapshots().length}`,
    name, title, html, createdAt: new Date().toISOString(),
  };
  const all = [...listSnapshots(), snap].slice(-MAX_SNAPSHOTS);
  try { localStorage.setItem(SNAP_KEY, JSON.stringify(all)); } catch { /* quota */ }
  return snap;
}

export function deleteSnapshot(id: string): void {
  try { localStorage.setItem(SNAP_KEY, JSON.stringify(listSnapshots().filter((s) => s.id !== id))); } catch { /* noop */ }
}

/** A naive line-level diff (added/removed) for the compare-versions view (15). */
export function diffHtml(oldHtml: string, newHtml: string): { type: 'same' | 'add' | 'del'; text: string }[] {
  const strip = (h: string) => h.replace(/<[^>]+>/g, '\n').split('\n').map((s) => s.trim()).filter(Boolean);
  const a = strip(oldHtml);
  const b = strip(newHtml);
  const bSet = new Set(b);
  const aSet = new Set(a);
  const out: { type: 'same' | 'add' | 'del'; text: string }[] = [];
  for (const line of a) if (!bSet.has(line)) out.push({ type: 'del', text: line });
  for (const line of b) out.push({ type: aSet.has(line) ? 'same' : 'add', text: line });
  return out;
}
