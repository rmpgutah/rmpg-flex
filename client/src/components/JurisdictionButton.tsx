// client/src/components/JurisdictionButton.tsx
// Shows which county an address resolved to for assessor/recorder lookups,
// and lets an operator override it when the router gets an edge case wrong
// (addresses on county lines, new annexations, etc). Tokens-only — no hex.

import { useEffect, useState } from 'react';
import { useJurisdiction, type OverridableCounty } from '../hooks/useJurisdiction';

interface Props {
  address: string;
  recordType?: 'business' | 'property';
  recordId?: number | string;
}

const OVERRIDE_OPTIONS: Array<{ value: OverridableCounty; label: string }> = [
  { value: 'salt_lake', label: 'Salt Lake County' },
  { value: 'utah', label: 'Utah County' },
  { value: 'summit', label: 'Summit County' },
  { value: 'tooele', label: 'Tooele County' },
];

export function JurisdictionButton({ address, recordType, recordId }: Props) {
  const { info, loading, error, fetchInfo, setOverride } = useJurisdiction(address, { recordType, recordId });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (address.trim()) fetchInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, recordType, recordId]);

  if (!address.trim()) return null;

  return (
    <div className="relative inline-block text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="px-2 py-1 bg-surface-raised text-rmpg-200 border border-surface-raised hover:bg-surface-base">
        🏛️ {loading ? 'Resolving…' : info ? info.label : 'Jurisdiction'}
        {info?.override && <span className="ml-1 text-brand-400">(override)</span>}
      </button>
      {open && (
        <div className="absolute z-10 mt-1 p-2 border border-surface-raised bg-surface-base w-64 shadow-lg">
          {error && <div className="text-red-400 mb-1">{error}</div>}
          {info && (
            <>
              <div className="mb-1 text-rmpg-400">
                Resolved: <span className="text-rmpg-200">{info.label}</span>
                {info.override && <span className="ml-1 text-brand-400">(manually overridden)</span>}
              </div>
              <label className="block mb-2">
                <span className="block text-rmpg-500 mb-1">Override county</span>
                <select
                  className="w-full bg-surface-raised text-rmpg-200 border border-surface-raised p-1"
                  value={info.override ?? ''}
                  disabled={!recordType || recordId == null}
                  onChange={(e) => setOverride(e.target.value ? (e.target.value as OverridableCounty) : null)}>
                  <option value="">Auto (no override)</option>
                  {OVERRIDE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              {info.manual_url && (
                <a
                  href={info.manual_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-400 underline">
                  Search {info.label} manually ↗
                </a>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default JurisdictionButton;
