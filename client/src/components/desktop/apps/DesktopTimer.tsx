import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Timer, StopCircle, Copy, RotateCcw, Play, Pause, Flag } from 'lucide-react';
import { useDraggablePosition } from '../../../hooks/useDraggablePosition';
import { timerLapsToCsv, downloadTextFile } from '../../../utils/rmsListExport';

const W = 380;
const H = 460;
const MAX_LAPS = 20;

interface DesktopTimerProps {
  onClose: () => void;
}

function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.6);
  } catch {
    // AudioContext unavailable — silently skip
  }
}

function fmtMSS(totalMs: number): string {
  const ms = totalMs % 1000;
  const s = Math.floor(totalMs / 1000) % 60;
  const m = Math.floor(totalMs / 60000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

function fmtMMSS(totalSecs: number): string {
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ─── Countdown ────────────────────────────────────────────────────────────────
function CountdownTab() {
  const [inputMins, setInputMins] = useState(5);
  const [inputSecs, setInputSecs] = useState(0);
  const [label, setLabel] = useState('');
  const [callId, setCallId] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [expired, setExpired] = useState(false);
  const intervalRef = useRef<number | null>(null);

  const totalInputSecs = inputMins * 60 + inputSecs;

  const clear = useCallback(() => {
    if (intervalRef.current !== null) clearInterval(intervalRef.current);
    intervalRef.current = null;
  }, []);

  const start = useCallback(() => {
    if (running) return;
    const startFrom = remaining !== null ? remaining : totalInputSecs;
    if (startFrom <= 0) return;
    setExpired(false);
    setRunning(true);
    let current = startFrom;
    intervalRef.current = window.setInterval(() => {
      current -= 1;
      setRemaining(current);
      if (current <= 0) {
        setRunning(false);
        setExpired(true);
        beep();
        if (intervalRef.current !== null) clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }, 1000);
  }, [running, remaining, totalInputSecs]);

  const pause = useCallback(() => {
    clear();
    setRunning(false);
  }, [clear]);

  const reset = useCallback(() => {
    clear();
    setRunning(false);
    setRemaining(null);
    setExpired(false);
  }, [clear]);

  useEffect(() => () => clear(), [clear]);

  const displaySecs = remaining !== null ? remaining : totalInputSecs;

  const inputStyle: React.CSSProperties = {
    width: 64, padding: '4px 6px', fontSize: 20, textAlign: 'center',
    background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)',
    color: 'var(--text-primary)', borderRadius: 2, outline: 'none',
    fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums',
  };

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Duration inputs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <input
            type="number" min={0} max={99} value={inputMins}
            onChange={e => { setInputMins(Math.min(99, Math.max(0, Number(e.target.value)))); reset(); }}
            style={inputStyle} disabled={running}
          />
          <span style={{ fontSize: 9, color: 'var(--field-label-color)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>MIN</span>
        </div>
        <span style={{ fontSize: 24, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>:</span>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <input
            type="number" min={0} max={59} value={inputSecs}
            onChange={e => { setInputSecs(Math.min(59, Math.max(0, Number(e.target.value)))); reset(); }}
            style={inputStyle} disabled={running}
          />
          <span style={{ fontSize: 9, color: 'var(--field-label-color)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>SEC</span>
        </div>
      </div>

      {/* Optional fields */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input
          value={label} onChange={e => setLabel(e.target.value)}
          placeholder="Label (e.g. Welfare Check)"
          style={{ fontSize: 11, padding: '4px 8px', background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: 2, outline: 'none' }}
        />
        <input
          value={callId} onChange={e => setCallId(e.target.value)}
          placeholder="Call ID (optional)"
          style={{ fontSize: 11, padding: '4px 8px', background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: 2, outline: 'none' }}
        />
      </div>

      {/* Display */}
      <div style={{
        textAlign: 'center', fontFamily: 'monospace', fontSize: 52, fontWeight: 200,
        color: expired ? 'var(--sev-critical)' : 'var(--text-primary)',
        letterSpacing: '0.04em', background: 'var(--surface-sunken)',
        borderRadius: 2, padding: '16px 8px', border: '1px solid var(--border-subtle)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {expired ? "TIME'S UP" : fmtMMSS(displaySecs)}
      </div>
      {label && <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--field-label-color)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}{callId ? ` · Call ${callId}` : ''}</div>}

      {/* Controls */}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
        {!running ? (
          <button onClick={start} disabled={totalInputSecs === 0 && remaining === null}
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '5px 14px', background: 'var(--brand-600)', color: '#fff', border: 'none', borderRadius: 2, cursor: 'pointer' }}>
            <Play size={12} /> Start
          </button>
        ) : (
          <button onClick={pause}
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '5px 14px', background: 'var(--surface-base)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 2, cursor: 'pointer' }}>
            <Pause size={12} /> Pause
          </button>
        )}
        <button onClick={reset}
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '5px 14px', background: 'var(--surface-base)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 2, cursor: 'pointer' }}>
          <RotateCcw size={12} /> Reset
        </button>
      </div>
    </div>
  );
}

// ─── Stopwatch ────────────────────────────────────────────────────────────────
function StopwatchTab() {
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [laps, setLaps] = useState<{ n: number; split: number; total: number }[]>([]);
  const [status, setStatus] = useState('');
  const startRef = useRef<number | null>(null);
  const accRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const tick = useCallback(() => {
    if (startRef.current === null) return;
    setElapsed(accRef.current + Date.now() - startRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const start = useCallback(() => {
    if (running) return;
    startRef.current = Date.now();
    setRunning(true);
    rafRef.current = requestAnimationFrame(tick);
  }, [running, tick]);

  const stop = useCallback(() => {
    if (!running) return;
    if (startRef.current !== null) accRef.current += Date.now() - startRef.current;
    startRef.current = null;
    setRunning(false);
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, [running]);

  const lap = useCallback(() => {
    if (!running) return;
    const total = accRef.current + Date.now() - (startRef.current ?? Date.now());
    setLaps(prev => {
      if (prev.length >= MAX_LAPS) return prev;
      const lastTotal = prev[prev.length - 1]?.total ?? 0;
      return [...prev, { n: prev.length + 1, split: total - lastTotal, total }];
    });
  }, [running]);

  const reset = useCallback(() => {
    stop();
    accRef.current = 0;
    startRef.current = null;
    setElapsed(0);
    setLaps([]);
    setRunning(false);
  }, [stop]);

  const copyLaps = useCallback(() => {
    const text = laps.map(l => `Lap ${l.n}: ${fmtMSS(l.split)} (Total: ${fmtMSS(l.total)})`).join('\n');
    const doWrite = (t: string) => {
      const api = (window as unknown as Record<string, unknown>).electron as { setClipboardText?: (t: string) => void } | undefined;
      if (api?.setClipboardText) { api.setClipboardText(t); }
      else { navigator.clipboard.writeText(t).catch(() => {}); }
    };
    doWrite(text);
    setStatus('Copied!');
    setTimeout(() => setStatus(''), 1500);
  }, [laps]);

  useEffect(() => () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); }, []);

  const btnBase: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '5px 12px', border: '1px solid var(--border-subtle)', borderRadius: 2, cursor: 'pointer', background: 'var(--surface-base)', color: 'var(--text-primary)' };

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      {/* Display */}
      <div style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: 38, fontWeight: 200, color: 'var(--text-primary)', letterSpacing: '0.04em', background: 'var(--surface-sunken)', borderRadius: 2, padding: '12px 8px', border: '1px solid var(--border-subtle)', fontVariantNumeric: 'tabular-nums' }}>
        {fmtMSS(elapsed)}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
        {!running ? (
          <button onClick={start} style={{ ...btnBase, background: 'var(--brand-600)', color: '#fff', border: 'none' }}>
            <Play size={12} /> Start
          </button>
        ) : (
          <button onClick={stop} style={btnBase}><StopCircle size={12} /> Stop</button>
        )}
        <button onClick={lap} disabled={!running} style={{ ...btnBase, opacity: running ? 1 : 0.4 }}><Flag size={12} /> Lap</button>
        <button onClick={reset} style={btnBase}><RotateCcw size={12} /> Reset</button>
        {laps.length > 0 && (
          <button onClick={copyLaps} style={btnBase}><Copy size={12} /> Copy laps</button>
        )}
        {laps.length > 0 && (
          <button onClick={() => downloadTextFile('timer-laps.csv', timerLapsToCsv(laps.map((l) => ({ n: l.n, split: fmtMSS(l.split), total: fmtMSS(l.total) }))))} style={btnBase}>CSV</button>
        )}
        {status && <span style={{ fontSize: 10, color: 'var(--text-muted)', alignSelf: 'center' }}>{status}</span>}
      </div>

      {/* Laps */}
      {laps.length > 0 && (
        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 2, background: 'var(--surface-sunken)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                {['Lap', 'Split', 'Total'].map(h => (
                  <th key={h} style={{ padding: '4px 8px', textAlign: h === 'Lap' ? 'left' : 'right', fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...laps].reverse().map(l => (
                <tr key={l.n} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '3px 8px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>#{l.n}</td>
                  <td style={{ padding: '3px 8px', textAlign: 'right', color: 'var(--text-primary)', fontFamily: 'monospace' }}>{fmtMSS(l.split)}</td>
                  <td style={{ padding: '3px 8px', textAlign: 'right', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{fmtMSS(l.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function DesktopTimer({ onClose }: DesktopTimerProps) {
  const [pos, setPos] = useState({ x: Math.max(0, (window.innerWidth - W) / 2), y: Math.max(0, (window.innerHeight - H) / 4) });
  const { onPointerDown } = useDraggablePosition(pos.x, pos.y, (x, y) => setPos({ x, y }));
  const [tab, setTab] = useState<'countdown' | 'stopwatch'>('countdown');

  return (
    <div style={{
      position: 'fixed', left: pos.x, top: pos.y, width: W, height: H,
      background: 'var(--surface-raised)', border: '1px solid var(--border-default)',
      borderRadius: 2, boxShadow: '0 8px 32px rgba(0 0 0 / 0.45)', zIndex: 20100,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Title bar */}
      <div onPointerDown={onPointerDown} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', height: 32, background: 'var(--surface-sunken)', cursor: 'move', flexShrink: 0 }}>
        <Timer size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-primary)', flex: 1 }}>Timer</span>
        <button aria-label="Close Timer" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
          <X size={14} />
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        {(['countdown', 'stopwatch'] as const).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)} style={{
            flex: 1, padding: '6px 0', fontSize: 10, fontWeight: tab === t ? 700 : 400,
            color: tab === t ? 'var(--text-primary)' : 'var(--text-muted)',
            background: 'none', border: 'none',
            borderBottom: tab === t ? '2px solid var(--brand-400)' : '2px solid transparent',
            cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            {t === 'countdown' ? 'Countdown' : 'Stopwatch'}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'hidden', overflowY: 'auto' }}>
        {tab === 'countdown' ? <CountdownTab /> : <StopwatchTab />}
      </div>
    </div>
  );
}
