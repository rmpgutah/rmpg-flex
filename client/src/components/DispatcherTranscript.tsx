// ============================================================
// Dispatcher Transcript Drawer
//
// Mirrors every spoken dispatcher line as text for hearing-impaired
// dispatchers and for later review. Toggled with the 'T' key. Uses
// two hidden ARIA live regions so screen readers announce new
// content without needing TTS. Colored LED-style dots convey
// severity at a glance for users who can't hear the audio cue.
// ============================================================

import { useEffect, useState } from 'react';
import { useDispatchTranscript, clearTranscript } from '../hooks/useDispatchTranscript';
import type { AlertSeverity } from '../utils/alertSeverity';

const SEV_COLOR: Record<AlertSeverity, string> = {
  major:    '#ff3b30', // red
  moderate: '#ff9500', // amber
  minor:    '#34c759', // green
};

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export default function DispatcherTranscript() {
  const { entries } = useDispatchTranscript();
  const [open, setOpen] = useState(false);

  // Toggle with 'T' key unless the user is typing in a field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 't' && e.key !== 'T') return;
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (target && (target as any).isContentEditable) return;
      setOpen((v) => !v);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const recent = entries.slice(-3);
  const criticalRecent = entries.filter((e) => e.severity === 'major').slice(-1);

  return (
    <>
      {/* Polite live region: general announcements */}
      <div
        aria-live="polite"
        aria-atomic="false"
        style={{ position: 'absolute', left: -9999, width: 1, height: 1, overflow: 'hidden' }}
      >
        {recent.map((e) => (
          <div key={e.id}>{e.text}</div>
        ))}
      </div>

      {/* Assertive live region: major severity, preempts other SR speech */}
      <div
        aria-live="assertive"
        style={{ position: 'absolute', left: -9999, width: 1, height: 1, overflow: 'hidden' }}
      >
        {criticalRecent.map((e) => (
          <div key={e.id}>{e.text}</div>
        ))}
      </div>

      {open && (
        <div
          style={{
            position: 'fixed',
            bottom: 28,
            right: 8,
            width: 420,
            maxHeight: '40vh',
            overflowY: 'auto',
            background: '#0a0a0a',
            border: '1px solid #222222',
            borderRadius: 2,
            zIndex: 50,
            boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '6px 8px',
              borderBottom: '1px solid #222222',
              background: 'linear-gradient(180deg, #1a1a1a, #242424)',
            }}
          >
            <span style={{ color: '#d4a017', fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>
              DISPATCHER TRANSCRIPT
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => clearTranscript()}
                style={{ color: '#888888', fontSize: 10, background: 'none', border: 'none', cursor: 'pointer' }}
                title="Clear transcript"
              >
                CLEAR
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{ color: '#888888', fontSize: 14, background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1 }}
                title="Close"
              >
                ×
              </button>
            </div>
          </div>
          {entries.length === 0 ? (
            <div style={{ padding: 12, color: '#666', fontSize: 11 }}>No announcements yet.</div>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {entries.map((e) => (
                <li
                  key={e.id}
                  style={{
                    display: 'flex',
                    gap: 6,
                    padding: '3px 8px',
                    borderBottom: '1px solid #1a1a1a',
                    fontSize: 11,
                    fontFamily: 'monospace',
                  }}
                >
                  <span style={{ color: SEV_COLOR[e.severity], textShadow: `0 0 4px ${SEV_COLOR[e.severity]}` }}>●</span>
                  <span style={{ color: '#888888', minWidth: 56 }}>{fmtTime(e.ts)}</span>
                  <span style={{ color: '#dddddd', flex: 1, wordBreak: 'break-word' }}>{e.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
