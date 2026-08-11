import React, { useState, useEffect, useCallback } from 'react';
import { Timer } from 'lucide-react';

type Phase = 'focus' | 'short-break' | 'long-break';
const PHASE_DURATIONS: Record<Phase, number> = { focus: 25, 'short-break': 5, 'long-break': 15 };
const PHASE_COLORS: Record<Phase, string> = { focus: 'var(--brand-400)', 'short-break': 'var(--sev-ok, #22c55e)', 'long-break': 'var(--sev-warn, #f59e0b)' };
const PHASE_LABELS: Record<Phase, string> = { focus: 'DEEP FOCUS', 'short-break': 'SHORT BREAK', 'long-break': 'LONG BREAK' };

export default function FocusTimerPage() {
  const [phase, setPhase] = useState<Phase>('focus');
  const [cycles, setCycles] = useState(0);
  const [duration, setDuration] = useState(PHASE_DURATIONS.focus);
  const [remaining, setRemaining] = useState(duration * 60);
  const [running, setRunning] = useState(false);
  const [custom, setCustom] = useState('');

  useEffect(() => { setRemaining(duration * 60); setRunning(false); }, [duration, phase]);

  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => setRemaining(r => { if (r <= 1) { setRunning(false); return 0; } return r - 1; }), 1000);
    return () => clearInterval(iv);
  }, [running]);

  const nextPhase = useCallback(() => {
    const newCycles = phase === 'focus' ? cycles + 1 : cycles;
    setCycles(newCycles);
    const next: Phase = phase !== 'focus' ? 'focus' : newCycles % 4 === 0 ? 'long-break' : 'short-break';
    setPhase(next); setDuration(PHASE_DURATIONS[next]);
  }, [phase, cycles]);

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const total = duration * 60;
  const pct = (total - remaining) / total;
  const radius = 60;
  const circ = 2 * Math.PI * radius;
  const color = PHASE_COLORS[phase];

  return (
    <div style={{ background: 'var(--surface-base)', minHeight: '100vh', padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, alignSelf: 'stretch' }}>
        <Timer className="w-4 h-4" style={{ color }} />
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.08em' }}>FOCUS TIMER</div>
        <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--text-secondary)' }}>Cycle {cycles}</span>
      </div>
      <div style={{ fontSize: 9, fontWeight: 600, color, letterSpacing: '0.12em', marginBottom: 14 }}>{PHASE_LABELS[phase]}</div>
      <svg width={160} height={160} style={{ marginBottom: 14 }}>
        <circle cx={80} cy={80} r={radius} fill="none" stroke="var(--border-subtle)" strokeWidth={8} />
        <circle cx={80} cy={80} r={radius} fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round" transform="rotate(-90 80 80)"
          style={{ transition: 'stroke-dashoffset 1s linear' }} />
        <text x={80} y={84} textAnchor="middle" style={{ fontSize: 28, fontWeight: 700, fill: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
          {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
        </text>
      </svg>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button type="button" onClick={() => setRunning(!running)} style={{ fontSize: 11, padding: '6px 20px', background: color, color: '#fff', border: 'none', borderRadius: 2, cursor: 'pointer' }}>
          {running ? 'Pause' : 'Start'}
        </button>
        <button type="button" onClick={() => { setRunning(false); setRemaining(duration * 60); }} style={{ fontSize: 11, padding: '6px 12px', background: 'var(--surface-raised)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 2, cursor: 'pointer' }}>
          Reset
        </button>
        <button type="button" onClick={nextPhase} style={{ fontSize: 11, padding: '6px 12px', background: 'var(--surface-raised)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 2, cursor: 'pointer' }}>
          Skip
        </button>
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 10 }}>
        {(['focus', 'short-break', 'long-break'] as Phase[]).map(p => (
          <button key={p} type="button" onClick={() => { setPhase(p); setDuration(PHASE_DURATIONS[p]); }} style={{ fontSize: 8, padding: '2px 8px', background: p === phase ? color : 'var(--surface-raised)', color: p === phase ? '#fff' : 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 2, cursor: 'pointer' }}>
            {PHASE_LABELS[p]}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="number" placeholder="Custom min" value={custom} onChange={e => setCustom(e.target.value)} style={{ width: 80, fontSize: 10, padding: '3px 6px', background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 2, color: 'var(--text-primary)' }} />
        <button type="button" onClick={() => { const m = parseInt(custom, 10); if (m > 0) setDuration(m); }} style={{ fontSize: 9, padding: '3px 8px', background: 'var(--surface-raised)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 2, cursor: 'pointer' }}>Set</button>
      </div>
    </div>
  );
}
