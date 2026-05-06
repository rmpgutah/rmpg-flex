// ──────────────────────────────────────────────────────────────────
// RadioPage — pure helpers (no React, no DOM).
// localStorage wrapper · audio beep generator · search/date predicates
// ──────────────────────────────────────────────────────────────────
import { NOTIF_SOUNDS } from './constants';

// ── localStorage helpers (silently swallow quota / private mode) ──
export const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ok */ } },
  getSet: (k: string): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(k) || '[]')); } catch { return new Set(); } },
  setSet: (k: string, v: Set<string>) => { try { localStorage.setItem(k, JSON.stringify([...v])); } catch { /* ok */ } },
  getJSON: <T,>(k: string, def: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
  setJSON: (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ok */ } },
};

// ── Audio beep generator (multi-preset) ──
export function playBeep(preset: string = 'chime', volume: number = 1) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const cfg = NOTIF_SOUNDS[preset] || NOTIF_SOUNDS.chime;
    o.connect(g); g.connect(ctx.destination);
    o.type = cfg.type;
    o.frequency.setValueAtTime(cfg.freq, ctx.currentTime);
    g.gain.setValueAtTime(0.04 * volume, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + cfg.dur);
    o.start(); o.stop(ctx.currentTime + cfg.dur);
    setTimeout(() => ctx.close().catch(() => {}), Math.max(300, cfg.dur * 1000 + 200));
  } catch { /* ignore */ }
}

// ── Date predicate for filter chips ──
export const COMPARE_DATE = (entry: any, range: string): boolean => {
  if (range === 'all') return true;
  const t = Date.parse(entry?.transmitted_at || '');
  if (!t) return false;
  const now = Date.now();
  if (range === 'today')  { const start = new Date(); start.setHours(0,0,0,0); return t >= start.getTime(); }
  if (range === 'h24')    return now - t <= 86400000;
  if (range === 'week')   return now - t <= 7 * 86400000;
  if (range === 'month')  return now - t <= 30 * 86400000;
  return true;
};

// ── Boolean search: supports OR (|), negation (-) ──
export function matchesSearch(text: string, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = (text || '').toLowerCase();
  // OR groups separated by | — within a group, all terms required (AND)
  const orGroups = q.split('|').map(s => s.trim()).filter(Boolean);
  if (orGroups.length === 0) return true;
  return orGroups.some(group => {
    const tokens = group.split(/\s+/).filter(Boolean);
    return tokens.every(tok => {
      if (tok.startsWith('-')) return !t.includes(tok.slice(1));
      return t.includes(tok);
    });
  });
}
