import React from 'react';
import { useNavBadges } from '../../../hooks/useNavBadges';

const ROWS: { key: 'activeCalls' | 'openCases' | 'activeWarrants' | 'pendingServe'; label: string }[] = [
  { key: 'activeCalls', label: 'Active Calls' },
  { key: 'openCases', label: 'Open Cases' },
  { key: 'activeWarrants', label: 'Active Warrants' },
  { key: 'pendingServe', label: 'Pending Serve' },
];

export default function DesktopOpsSummaryWidget() {
  const { badges } = useNavBadges();
  return (
    <div className="p-3" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-default)', width: 200 }}>
      <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>Live Ops</div>
      {ROWS.map(row => (
        <div key={row.key} className="flex items-center justify-between text-[11px] py-0.5">
          <span style={{ color: 'var(--text-muted)' }}>{row.label}</span>
          <span className="font-mono font-bold" style={{ color: 'var(--text-primary)' }}>{badges[row.key] ?? 0}</span>
        </div>
      ))}
    </div>
  );
}
