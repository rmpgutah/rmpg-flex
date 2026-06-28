// ============================================================
// RMPG Flex — Duplicate Call Warning
// Debounced check for active calls at the same/similar address.
// Shown inline in NewCallModal to warn dispatchers before
// creating duplicate calls. Follows PremiseHistory debounce pattern.
// ============================================================

import { useState, useEffect } from 'react';
import { AlertTriangle, Clock } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { safeTimeStr } from '../utils/dateUtils';

interface DuplicateCall {
  id: number;
  call_number: string;
  incident_type: string;
  priority: string;
  status: string;
  location_address: string;
  created_at: string;
}

interface DuplicateCallWarningProps {
  address: string;
}

export default function DuplicateCallWarning({ address }: DuplicateCallWarningProps) {
  const [duplicates, setDuplicates] = useState<DuplicateCall[]>([]);

  useEffect(() => {
    if (!address || address.length < 5) {
      setDuplicates([]);
      return;
    }

    const debounce = setTimeout(async () => {
      try {
        const result = await apiFetch<{ duplicates: DuplicateCall[]; count: number }>(
          `/dispatch/calls/check-duplicate?address=${encodeURIComponent(address)}`
        );
        setDuplicates(result.duplicates || []);
      } catch {
        setDuplicates([]);
      }
    }, 600);

    return () => clearTimeout(debounce);
  }, [address]);

  if (duplicates.length === 0) return null;

  return (
    <div
      className="animate-fade-in"
      style={{
        background: 'rgba(180, 130, 0, 0.12)',
        border: '1px solid #b48200',
        padding: '6px 8px',
        marginTop: 4,
      }}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <AlertTriangle style={{ width: 11, height: 11, color: '#f59e0b' }} />
        <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">
          Possible Duplicate — {duplicates.length} Active Call{duplicates.length !== 1 ? 's' : ''} at This Address
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {duplicates.slice(0, 3).map((d) => (
          <div key={d.id} className="flex items-center gap-2 text-[9px] text-rmpg-300 font-mono">
            <span className="text-amber-500 font-bold">{d.call_number}</span>
            <span>{d.incident_type?.replace(/_/g, ' ')}</span>
            <span className="text-rmpg-500">({(d.status || '').toUpperCase()})</span>
            <span className="text-rmpg-500 flex items-center gap-0.5">
              <Clock style={{ width: 8, height: 8 }} />
              {safeTimeStr(d.created_at)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
