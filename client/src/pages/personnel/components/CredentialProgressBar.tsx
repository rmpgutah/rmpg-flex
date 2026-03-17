import React from 'react';
import { calcDaysUntilExpiry } from '../utils/personnelFormatters';
import type { Credential } from '../../../types';

interface Props {
  credentials: Credential[];
}

export default function CredentialProgressBar({ credentials }: Props) {
  if (credentials.length === 0) return null;
  const valid = credentials.filter(c => c.status === 'valid').length;
  const pct = Math.round((valid / credentials.length) * 100);
  const color = pct === 100 ? 'bg-green-500' : pct >= 70 ? 'bg-amber-500' : 'bg-red-500';

  const expiring = credentials.filter(c => c.status === 'expiring_soon').length;
  const expired = credentials.filter(c => c.status === 'expired').length;
  const validPct = (valid / credentials.length) * 100;
  const expiringPct = (expiring / credentials.length) * 100;
  const expiredPct = (expired / credentials.length) * 100;

  return (
    <div className="flex items-center gap-1.5 mt-1">
      <div className="flex-1 h-1.5 bg-rmpg-700/50 overflow-hidden flex" style={{ borderRadius: '1px' }}>
        <div className="h-full bg-green-500 transition-all" style={{ width: `${validPct}%` }} />
        <div className="h-full bg-amber-500 transition-all" style={{ width: `${expiringPct}%` }} />
        <div className="h-full bg-red-500 transition-all" style={{ width: `${expiredPct}%` }} />
      </div>
      <span className={`text-[8px] font-mono font-bold ${pct === 100 ? 'text-green-400' : pct >= 70 ? 'text-amber-400' : 'text-red-400'}`}>
        {valid}/{credentials.length}
      </span>
    </div>
  );
}
