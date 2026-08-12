import React, { useState, useEffect } from 'react';
import { Shield } from 'lucide-react';
import { useOptionalDesktopSystem } from '../../context/DesktopSystemContext';

export default function DesktopWelfareCountdown() {
  const ctx = useOptionalDesktopSystem();
  // All hooks must run unconditionally before any early return (React rules of hooks).
  const [now, setNow] = useState(Date.now());
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  if (!ctx) return null;
  const { welfareTimer, startWelfareTimer, cancelWelfareTimer } = ctx;

  const remaining = welfareTimer ? welfareTimer.endsAt - now : null;
  const mins = remaining !== null ? Math.max(0, Math.floor(remaining / 60000)) : null;
  const secs = remaining !== null ? Math.max(0, Math.floor((remaining % 60000) / 1000)) : null;
  const isOverdue = remaining !== null && remaining < 0;
  const color = remaining === null
    ? 'var(--text-secondary)'
    : isOverdue
    ? 'var(--sev-critical, #ef4444)'
    : remaining < 120000
    ? 'var(--sev-warn, #f59e0b)'
    : 'var(--sev-ok, #22c55e)';

  if (!welfareTimer && !showPicker) {
    return (
      <button
        type="button"
        onClick={() => setShowPicker(true)}
        title="Start welfare check timer"
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', display: 'flex', alignItems: 'center', gap: 4 }}
      >
        <Shield className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
      </button>
    );
  }

  if (showPicker) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 2, padding: '2px 6px' }}>
        {[15, 30, 45, 60].map(m => (
          <button
            key={m}
            type="button"
            onClick={() => { startWelfareTimer(m); setShowPicker(false); }}
            style={{ fontSize: 9, padding: '1px 6px', background: 'var(--surface-base)', border: '1px solid var(--border-subtle)', borderRadius: 2, cursor: 'pointer', color: 'var(--text-primary)' }}
          >
            {m}m
          </button>
        ))}
        <button type="button" onClick={() => setShowPicker(false)} style={{ fontSize: 9, color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--surface-raised)', border: `1px solid ${color}`, borderRadius: 2, padding: '2px 8px' }}>
      <Shield className="w-3 h-3" style={{ color }} />
      <span style={{ fontSize: 10, fontWeight: 600, color, fontVariantNumeric: 'tabular-nums' }}>
        {isOverdue ? 'OVERDUE' : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`}
      </span>
      <button type="button" onClick={cancelWelfareTimer} style={{ fontSize: 9, color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer', marginLeft: 2 }}>✕</button>
    </div>
  );
}
