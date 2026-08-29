import { classifyClipboard } from './clipboardClassify';

/** Local clipboard history that works outside DesktopSystemProvider. */

export const CLIP_STORAGE_KEY = 'rmpg_clipboard_history';
export const CLIP_PIN_KEY = 'rmpg_clipboard_pins';
export const MAX_CLIP = 50;

export type ClipEntry = string;

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

export function loadClipHistory(): string[] {
  try {
    return parseList(localStorage.getItem(CLIP_STORAGE_KEY)).slice(0, MAX_CLIP);
  } catch {
    return [];
  }
}

export function saveClipHistory(entries: string[]): string[] {
  const next = entries.filter(Boolean).slice(0, MAX_CLIP);
  try {
    localStorage.setItem(CLIP_STORAGE_KEY, JSON.stringify(next));
  } catch { /* quota */ }
  return next;
}

export function addClipEntry(history: string[], text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return history;
  const kind = classifyClipboard(trimmed);
  // DOB / phone stay on the system clipboard; do not persist to localStorage.
  if (kind === 'dob' || kind === 'phone') return history;
  const filtered = history.filter((e) => e !== trimmed);
  return saveClipHistory([trimmed, ...filtered]);
}

export function removeClipEntry(history: string[], text: string): string[] {
  return saveClipHistory(history.filter((e) => e !== text));
}

export function loadPins(): string[] {
  try {
    return parseList(localStorage.getItem(CLIP_PIN_KEY));
  } catch {
    return [];
  }
}

export function togglePin(pins: string[], text: string): string[] {
  const next = pins.includes(text) ? pins.filter((p) => p !== text) : [text, ...pins].slice(0, MAX_CLIP);
  try {
    localStorage.setItem(CLIP_PIN_KEY, JSON.stringify(next));
  } catch { /* quota */ }
  return next;
}

export function filterClipHistory(history: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return history;
  return history.filter((e) => e.toLowerCase().includes(q));
}

export function clipsToCsv(history: string[], pins: string[]): string {
  const header = 'kind,text,pinned,chars';
  const lines = history.map((t) => {
    const kind = classifyClipboard(t);
    const body = (kind === 'dob' || kind === 'phone') ? '[redacted]' : t;
    const escaped = `"${body.replace(/"/g, '""')}"`;
    return `${kind},${escaped},${pins.includes(t) ? 'yes' : 'no'},${t.length}`;
  });
  return [header, ...lines].join('\n');
}

export function sortClips(history: string[], pins: string[]): string[] {
  const pinned = history.filter((e) => pins.includes(e));
  const rest = history.filter((e) => !pins.includes(e));
  return [...pinned, ...rest];
}
