// In-memory diagnostics registry — records which backend rendered each
// document so a debug panel can surface "Native: 12, PDF.js fallback: 3"
// over the session. Tells us where to invest engineering time on the
// native backend's coverage gaps.

import { DiagnosticEntry } from './types';

const entries: DiagnosticEntry[] = [];
const listeners: Array<() => void> = [];
const MAX = 200;

export function recordOpen(entry: DiagnosticEntry): void {
  entries.unshift(entry);
  if (entries.length > MAX) entries.length = MAX;
  for (const fn of listeners) fn();
}

export function getDiagnostics(): DiagnosticEntry[] {
  return entries.slice();
}

export function subscribeDiagnostics(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export function diagnosticsSummary(): { native: number; pdfjs: number; total: number } {
  let native = 0, pdfjs = 0;
  for (const e of entries) {
    if (e.backend === 'native') native++;
    else if (e.backend === 'pdfjs') pdfjs++;
  }
  return { native, pdfjs, total: entries.length };
}
