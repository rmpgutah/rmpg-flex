import React from 'react';
import { Radio } from 'lucide-react';
import { useDesktopSystem } from '../../context/DesktopSystemContext';

const PRIORITY_COLORS: Record<number, string> = {
  1: 'var(--sev-critical, #ef4444)',
  2: 'var(--sev-high, #f97316)',
  3: 'var(--sev-warn, #f59e0b)',
  4: 'var(--sev-ok, #22c55e)',
};

interface Props { taskbarHeightPx: number; }

export default function DesktopActiveCallBar({ taskbarHeightPx }: Props) {
  const { activeCall } = useDesktopSystem();
  if (!activeCall) return null;
  const color = PRIORITY_COLORS[activeCall.priority] ?? 'var(--text-secondary)';
  return (
    <div style={{
      position: 'fixed', bottom: taskbarHeightPx, left: 0, right: 0, height: 24,
      background: 'var(--surface-raised)', borderTop: `1px solid ${color}`,
      display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px',
      zIndex: 10000,
    }}>
      <Radio className="w-3 h-3" style={{ color }} />
      <span style={{ fontSize: 9, fontWeight: 700, color, letterSpacing: '0.08em' }}>P{activeCall.priority}</span>
      <span style={{ fontSize: 10, color: 'var(--text-primary)', fontWeight: 600 }}>{activeCall.call_number}</span>
      <span style={{ fontSize: 10, color: 'var(--text-primary)' }}>{activeCall.nature_of_call}</span>
      {activeCall.address && <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>{activeCall.address}</span>}
      <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{activeCall.status}</span>
    </div>
  );
}
