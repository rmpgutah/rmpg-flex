// ============================================================
// Dispatch Transcript — in-memory rolling buffer of every line
// the dispatcher spoke or the officer heard. Consumed by
// <DispatcherTranscript /> (accessibility pane). A module-level
// buffer + subscriber set means multiple components can read the
// same transcript without prop-drilling or context boilerplate.
// ============================================================

import { useEffect, useState } from 'react';
import type { AlertSeverity } from '../utils/alertSeverity';

export interface TranscriptEntry {
  id: string;
  ts: number;
  text: string;
  severity: AlertSeverity;
  source: 'system' | 'officer' | 'rule';
  ruleId?: string;
}

const MAX_ENTRIES = 100;

let buffer: TranscriptEntry[] = [];
const listeners = new Set<(b: TranscriptEntry[]) => void>();

function nextId(): string {
  // crypto.randomUUID is widely available in modern browsers; fall back to
  // a Math.random id for jsdom versions that lack it.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function pushTranscriptEntry(
  entry: Omit<TranscriptEntry, 'id' | 'ts'>,
): void {
  const full: TranscriptEntry = { ...entry, id: nextId(), ts: Date.now() };
  buffer = [...buffer, full].slice(-MAX_ENTRIES);
  for (const fn of listeners) fn(buffer);
}

export function clearTranscript(): void {
  buffer = [];
  for (const fn of listeners) fn(buffer);
}

export function useDispatchTranscript() {
  const [entries, setEntries] = useState<TranscriptEntry[]>(buffer);

  useEffect(() => {
    const fn = (b: TranscriptEntry[]) => setEntries(b);
    listeners.add(fn);
    // sync once on mount in case the buffer changed during initial render
    setEntries(buffer);
    return () => { listeners.delete(fn); };
  }, []);

  return { entries };
}
