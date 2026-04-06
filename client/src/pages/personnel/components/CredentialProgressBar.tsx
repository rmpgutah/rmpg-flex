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

  return (
    <div className="flex items-center gap-1.5 mt-1" title={`${valid} of ${credentials.length} credentials valid`}>
      <div className="flex-1 h-1 bg-rmpg-700 rounded-full overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Credential compliance: ${pct}%`}>
        <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-[8px] font-mono ${pct === 100 ? 'text-green-400' : pct >= 70 ? 'text-amber-400' : 'text-red-400'}`}>
        {pct}%
      </span>
    </div>
  );
}
