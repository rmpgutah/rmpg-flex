import React, { useCallback, useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import {
  PHASE_DURATIONS, WELFARE_PRESETS, appendSession, formatMmSs, nextPhase, progressPct,
  type FocusPhase, type TimerSession,
} from '../utils/focusTimerLogic';

const PHASE_COLORS: Record<FocusPhase, string> = {
  focus: 'var(--brand-400)',
  'short-break': 'var(--sev-ok)',
  'long-break': 'var(--sev-warn)',
};
const PHASE_LABELS: Record<FocusPhase, string> = {
  focus: 'DEEP FOCUS',
  'short-break': 'SHORT BREAK',
  'long-break': 'LONG BREAK',
};

const LOG_KEY = 'rmpg_focus_timer_log';

function loadLog(): TimerSession[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export default function FocusTimerPage() {
  const [phase, setPhase] = useState<FocusPhase>('focus');
  const [cycles, setCycles] = useState(0);
  const [duration, setDuration] = useState(PHASE_DURATIONS.focus);
  const [remaining, setRemaining] = useState(duration * 60);
  const [running, setRunning] = useState(false);
  const [custom, setCustom] = useState('');
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [sound, setSound] = useState(true);
  const [log, setLog] = useState<TimerSession[]>(loadLog);

  useEffect(() => { setRemaining(duration * 60); setRunning(false); }, [duration, phase]);

  const completePhase = useCallback(() => {
    const entry: TimerSession = { endedAt: new Date().toISOString(), phase, minutes: duration };
    setLog((l) => {
      const next = appendSession(l, entry);
      try { localStorage.setItem(LOG_KEY, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
    if (sound) {
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 880;
        gain.gain.value = 0.08;
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(); osc.stop(ctx.currentTime + 0.25);
      } catch { /* no audio */ }
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(`${PHASE_LABELS[phase]} complete`);
    }
    if (autoAdvance) {
      const n = nextPhase(phase, cycles);
      setCycles(n.cycles);
      setPhase(n.phase);
      setDuration(PHASE_DURATIONS[n.phase]);
    }
  }, [autoAdvance, cycles, duration, phase, sound]);

  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          setRunning(false);
          completePhase();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [running, completePhase]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT') return;
      if (e.key === ' ') { e.preventDefault(); setRunning((v) => !v); }
      if (e.key === 'r' || e.key === 'R') { setRunning(false); setRemaining(duration * 60); }
      if (e.key === 'n' || e.key === 'N') {
        const n = nextPhase(phase, cycles);
        setCycles(n.cycles); setPhase(n.phase); setDuration(PHASE_DURATIONS[n.phase]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cycles, duration, phase]);

  const pct = progressPct(remaining, duration);
  const radius = 60;
  const circ = 2 * Math.PI * radius;
  const color = PHASE_COLORS[phase];

  return (
    <div className="min-h-full bg-surface-base p-4 flex flex-col items-center">
      <div className="flex items-center gap-2 mb-3 self-stretch">
        <Timer className="w-4 h-4" style={{ color }} />
        <div className="text-[10px] font-semibold tracking-widest text-[color:var(--field-label-color)]">FOCUS TIMER</div>
        <span className="ml-auto text-[9px] text-fg-muted">Cycle {cycles}</span>
      </div>
      <div className="text-[9px] font-semibold tracking-widest mb-3" style={{ color }}>{PHASE_LABELS[phase]}</div>
      <svg width={160} height={160} className="mb-3">
        <circle cx={80} cy={80} r={radius} fill="none" stroke="var(--border-subtle)" strokeWidth={8} />
        <circle cx={80} cy={80} r={radius} fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round" transform="rotate(-90 80 80)" />
        <text x={80} y={84} textAnchor="middle" style={{ fontSize: 28, fontWeight: 700, fill: 'var(--text-primary)' }}>
          {formatMmSs(remaining)}
        </text>
      </svg>
      <div className="flex gap-1.5 mb-3">
        <button type="button" onClick={() => setRunning(!running)} className="text-[11px] px-5 py-1.5 rounded-[2px] text-[color:var(--surface-base)]" style={{ background: color }}>
          {running ? 'Pause' : 'Start'}
        </button>
        <button type="button" onClick={() => { setRunning(false); setRemaining(duration * 60); }} className="text-[11px] px-3 py-1.5 bg-surface-raised border border-border-subtle rounded-[2px] text-rmpg-100">Reset</button>
        <button type="button" onClick={() => {
          const n = nextPhase(phase, cycles);
          setCycles(n.cycles); setPhase(n.phase); setDuration(PHASE_DURATIONS[n.phase]);
        }} className="text-[11px] px-3 py-1.5 bg-surface-raised border border-border-subtle rounded-[2px] text-rmpg-100">Skip</button>
        <button type="button" onClick={() => navigator.clipboard.writeText(formatMmSs(remaining)).catch(() => undefined)} className="text-[11px] px-3 py-1.5 bg-surface-raised border border-border-subtle rounded-[2px] text-rmpg-100">Copy</button>
      </div>
      <div className="flex gap-1 flex-wrap justify-center mb-2">
        {(['focus', 'short-break', 'long-break'] as FocusPhase[]).map((p) => (
          <button key={p} type="button" onClick={() => { setPhase(p); setDuration(PHASE_DURATIONS[p]); }} className="text-[8px] px-2 py-0.5 rounded-[2px] border border-border-subtle" style={{ background: p === phase ? color : 'var(--surface-raised)', color: p === phase ? 'var(--surface-base)' : 'var(--text-secondary)' }}>
            {PHASE_LABELS[p]}
          </button>
        ))}
      </div>
      <div className="flex gap-2 items-center mb-2 text-[9px] text-fg-muted">
        <label className="flex items-center gap-1"><input type="checkbox" checked={autoAdvance} onChange={(e) => setAutoAdvance(e.target.checked)} /> Auto-advance</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} /> Beep</label>
        <button type="button" className="text-brand-400" onClick={() => { if (typeof Notification !== 'undefined') Notification.requestPermission(); }}>Notify</button>
      </div>
      <div className="flex gap-1 flex-wrap justify-center mb-2">
        {WELFARE_PRESETS.map((m) => (
          <button key={m} type="button" onClick={() => setDuration(m)} className="text-[8px] px-2 py-0.5 border border-border-subtle rounded-[2px] text-fg-muted">
            {m}m welfare
          </button>
        ))}
      </div>
      <div className="flex gap-1.5 items-center mb-3">
        <input type="number" placeholder="Custom min" value={custom} onChange={(e) => setCustom(e.target.value)} className="w-20 text-[10px] px-1.5 py-1 bg-surface-raised border border-border-subtle rounded-[2px] text-rmpg-100" />
        <button type="button" onClick={() => { const m = parseInt(custom, 10); if (m > 0) setDuration(m); }} className="text-[9px] px-2 py-1 bg-surface-raised border border-border-subtle rounded-[2px] text-rmpg-100">Set</button>
      </div>
      {log.length > 0 && (
        <div className="self-stretch text-[8px] text-fg-muted font-mono space-y-0.5 max-h-24 overflow-y-auto">
          {log.map((s, i) => (
            <div key={`${s.endedAt}-${i}`}>{s.phase} · {s.minutes}m · {s.endedAt.slice(11, 16)}</div>
          ))}
        </div>
      )}
    </div>
  );
}
