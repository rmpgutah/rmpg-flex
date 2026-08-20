import React, { useState, useEffect, useRef } from 'react';
import { useDesktopSystem } from '../../context/DesktopSystemContext';

export default function DesktopP1AlertOverlay() {
  const { activeCall } = useDesktopSystem();
  const [visible, setVisible] = useState(false);
  const lastCallId = useRef<number | null>(null);
  const dismissed = useRef<number | null>(null);

  useEffect(() => {
    if (!activeCall || activeCall.priority !== 1) return;
    if (activeCall.id === lastCallId.current || activeCall.id === dismissed.current) return;
    lastCallId.current = activeCall.id;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 6000);
    return () => clearTimeout(t);
  }, [activeCall?.id, activeCall?.priority]);

  if (!visible || !activeCall) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99995,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      animation: 'p1-flash 0.5s ease-in-out 3 alternate',
    }}>
      <style>{`@keyframes p1-flash { from { background: rgba(220,38,38,0.05); } to { background: rgba(220,38,38,0.3); } }`}</style>
      <div style={{
        background: 'var(--surface-raised)', borderRadius: 2,
        border: '2px solid var(--sev-critical)',
        padding: '16px 24px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--sev-critical)', letterSpacing: '0.12em', marginBottom: 4 }}>
          P1 — PRIORITY CALL ASSIGNED
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-primary)', marginBottom: 8 }}>
          {activeCall.nature_of_call}
        </div>
        <button
          type="button"
          onClick={() => { dismissed.current = activeCall.id; setVisible(false); }}
          style={{ fontSize: 9, padding: '3px 12px', background: 'var(--sev-critical)', color: '#fff', border: 'none', borderRadius: 2, cursor: 'pointer' }}
        >
          ACKNOWLEDGE
        </button>
      </div>
    </div>
  );
}
