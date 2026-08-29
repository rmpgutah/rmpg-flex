export type FocusPhase = 'focus' | 'short-break' | 'long-break';

export const PHASE_DURATIONS: Record<FocusPhase, number> = {
  focus: 25,
  'short-break': 5,
  'long-break': 15,
};

export const WELFARE_PRESETS = [5, 15, 30, 45] as const;

export function nextPhase(phase: FocusPhase, cycles: number): { phase: FocusPhase; cycles: number } {
  const newCycles = phase === 'focus' ? cycles + 1 : cycles;
  const next: FocusPhase = phase !== 'focus' ? 'focus' : newCycles % 4 === 0 ? 'long-break' : 'short-break';
  return { phase: next, cycles: newCycles };
}

export function formatMmSs(remainingSec: number): string {
  const safe = Math.max(0, Math.floor(remainingSec));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function progressPct(remainingSec: number, durationMin: number): number {
  const total = durationMin * 60;
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, (total - remainingSec) / total));
}

export interface TimerSession {
  endedAt: string;
  phase: FocusPhase;
  minutes: number;
}

export function appendSession(log: TimerSession[], entry: TimerSession, max = 20): TimerSession[] {
  return [entry, ...log].slice(0, max);
}
