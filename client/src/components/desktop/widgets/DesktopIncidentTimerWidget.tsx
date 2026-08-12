import React, { useState, useEffect } from 'react';
import { Timer } from 'lucide-react';
import { useDesktopSystem } from '../../../context/DesktopSystemContext';

export default function DesktopIncidentTimerWidget() {
  const { activeCall } = useDesktopSystem();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!activeCall) { setElapsed(0); return; }
    const start = activeCall.created_at ? new Date(activeCall.created_at).getTime() : Date.now();
    setElapsed(Math.floor((Date.now() - start) / 1000));
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [activeCall?.id]);

  if (!activeCall) {
    return (
      <div style={{ padding: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <Timer className="w-3 h-3" style={{ color: 'var(--brand-400)' }} />
          <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.08em' }}>INCIDENT TIMER</span>
        </div>
        <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>No active call</div>
      </div>
    );
  }

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const color = mins >= 30 ? 'var(--sev-critical, #ef4444)' : mins >= 15 ? 'var(--sev-warn, #f59e0b)' : 'var(--sev-ok, #22c55e)';

  return (
    <div style={{ padding: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <Timer className="w-3 h-3" style={{ color }} />
        <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.08em' }}>INCIDENT TIMER</span>
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
        {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
      </div>
      <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginTop: 2 }}>{activeCall.call_number}</div>
      {mins >= 30 && (
        <div style={{ fontSize: 9, color, marginTop: 4 }}>Extended response — update dispatch</div>
      )}
    </div>
  );
}
