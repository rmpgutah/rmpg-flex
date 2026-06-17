// ============================================================
// RMPG Flex — Button Health Overlay (diagnostic)
// ------------------------------------------------------------
// Opt-in, read-only on-screen report of any button whose
// clickable area does not match its visual area. Point it at a
// screen where "the button is there but won't click" and it
// names every offender and exactly what is covering it.
//
// Activate with EITHER:
//   • append ?btnaudit=1 to the URL, or
//   • press Ctrl+Alt+B on any page
// Press Ctrl+Alt+B again (or the ✕) to dismiss.
//
// Everything is inline-styled at a very high z-index so the
// diagnostic itself is immune to the layering bug it detects.
// ============================================================

import React, { useCallback, useEffect, useState } from 'react';
import { auditButtonHealth, type ButtonHealthReport } from '../utils/buttonHealthAudit';

const HIGHLIGHT_ID = 'rmpg-btn-audit-highlights';

function clearHighlights() {
  document.getElementById(HIGHLIGHT_ID)?.remove();
}

/** Draw a non-interactive outline over each offending control. */
function drawHighlights(report: ButtonHealthReport) {
  clearHighlights();
  const layer = document.createElement('div');
  layer.id = HIGHLIGHT_ID;
  layer.style.cssText =
    'position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
  for (const e of report.entries) {
    const [x, y, w, h] = e.rect;
    const box = document.createElement('div');
    const color = e.severity === 'blocked' ? '#ef4444' : '#f59e0b';
    box.style.cssText =
      `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;` +
      `border:2px solid ${color};box-shadow:0 0 0 1px rgba(0,0,0,0.6);` +
      `background:${color}1a;border-radius:2px;`;
    layer.appendChild(box);
  }
  document.body.appendChild(layer);
}

export default function ButtonHealthOverlay() {
  const [open, setOpen] = useState(
    () => new URLSearchParams(location.search).get('btnaudit') === '1',
  );
  const [report, setReport] = useState<ButtonHealthReport | null>(null);
  const [highlight, setHighlight] = useState(true);

  const rescan = useCallback(() => {
    const r = auditButtonHealth();
    setReport(r);
    if (highlight) drawHighlights(r);
    else clearHighlights();
  }, [highlight]);

  // Ctrl+Alt+B toggles the overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Scan when opened; clean up highlights when closed.
  useEffect(() => {
    if (open) rescan();
    else clearHighlights();
    return clearHighlights;
  }, [open, rescan]);

  if (!open) return null;

  const panel: React.CSSProperties = {
    position: 'fixed',
    top: 12,
    right: 12,
    width: 380,
    maxHeight: '80vh',
    overflow: 'auto',
    zIndex: 2147483647,
    background: 'var(--surface-base)',
    color: '#e5e7eb',
    border: '1px solid #d4a017',
    borderRadius: 2,
    boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
    font: '12px ui-monospace, SFMono-Regular, Menlo, monospace',
    pointerEvents: 'auto',
  };

  return (
    <div style={panel} role="dialog" aria-label="Button health diagnostic">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 10px',
          background: '#11243a',
          borderBottom: '1px solid #1f3a57',
          position: 'sticky',
          top: 0,
        }}
      >
        <strong style={{ color: '#d4a017', letterSpacing: '0.08em' }}>BUTTON HEALTH</strong>
        <span>
          <button type="button" onClick={rescan} style={btnStyle}>
            Re-scan
          </button>
          <button
            type="button"
            onClick={() => {
              setHighlight((v) => {
                const next = !v;
                if (report) next ? drawHighlights(report) : clearHighlights();
                return next;
              });
            }}
            style={btnStyle}
          >
            {highlight ? 'Hide marks' : 'Show marks'}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            style={{ ...btnStyle, color: '#ef4444' }}
            aria-label="Close diagnostic"
          >
            ✕
          </button>
        </span>
      </div>

      {report && (
        <div style={{ padding: '8px 10px' }}>
          <div style={{ marginBottom: 6, color: 'var(--rmpg-400)' }}>
            {report.url} · {report.viewport[0]}×{report.viewport[1]}
          </div>
          <div style={{ marginBottom: 8 }}>
            <Stat label="Visible" value={report.totalVisible} color="#9ca3af" />{' '}
            <Stat label="Blocked" value={report.blocked} color="#ef4444" />{' '}
            <Stat label="Sliver" value={report.sliver} color="#f59e0b" />
          </div>

          {report.entries.length === 0 ? (
            <div style={{ color: '#22c55e' }}>✓ All buttons fully clickable on this screen.</div>
          ) : (
            <>
              <div style={{ color: 'var(--rmpg-400)', margin: '6px 0 4px' }}>Top click-stealers:</div>
              <ul style={{ margin: '0 0 8px', paddingLeft: 16 }}>
                {report.interceptorTally.slice(0, 5).map(([sig, n]) => (
                  <li key={sig}>
                    <span style={{ color: '#f59e0b' }}>{n}×</span> {sig}
                  </li>
                ))}
              </ul>
              <div style={{ color: 'var(--rmpg-400)', margin: '6px 0 4px' }}>Offenders:</div>
              {report.entries.map((e, i) => (
                <div
                  key={i}
                  style={{
                    padding: '4px 0',
                    borderTop: '1px solid #1f3a57',
                  }}
                >
                  <div>
                    <span
                      style={{ color: e.severity === 'blocked' ? '#ef4444' : '#f59e0b' }}
                    >
                      [{e.severity} {e.reachablePoints}/5]
                    </span>{' '}
                    <strong>{e.label}</strong>
                  </div>
                  <div className="text-rmpg-400">covered by: {e.interceptor}</div>
                  <div style={{ color: '#6b7280', fontSize: 11 }}>{e.interceptorStyle}</div>
                </div>
              ))}
            </>
          )}
          <div style={{ marginTop: 8, color: '#6b7280', fontSize: 11 }}>
            Red = fully dead · Amber = only part clickable. Re-scan after any action.
          </div>
        </div>
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: '#1f3a57',
  color: '#e5e7eb',
  border: '1px solid var(--border-panel)',
  borderRadius: 2,
  padding: '2px 8px',
  marginLeft: 6,
  cursor: 'pointer',
  font: 'inherit',
};

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span style={{ marginRight: 4 }}>
      <span style={{ color: '#6b7280' }}>{label}:</span>{' '}
      <span style={{ color, fontWeight: 700 }}>{value}</span>
    </span>
  );
}
