import React, { useState } from 'react';
import { Search, CheckCircle, XCircle, Loader2, ArrowDownToLine } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY',
  'LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND',
  'OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

export interface PlateLookupResult {
  vin: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  drivetrain: string;
  engine: string;
  transmission: string;
}

interface PlateLookupBarProps {
  /** Called when officer clicks "Apply to Record" with the fetched data. */
  onApply: (result: PlateLookupResult) => void;
  /** Pre-seeds the state dropdown from the parent form (e.g. 'UT'). */
  defaultState?: string;
  /** Pre-seeds the plate field. */
  defaultPlate?: string;
}

interface ApiResponse {
  ok: boolean;
  data?: PlateLookupResult;
  code?: string;
  message?: string;
}

const ERROR_LABELS: Record<string, string> = {
  PLATE_NOT_FOUND: 'No vehicle found for this plate.',
  NO_DATA_FOUND: 'Plate found but no vehicle data available.',
  INVALID_PLATE_FORMAT: 'Invalid plate format — must be 2–8 alphanumeric characters.',
  INVALID_STATE_CODE: 'Invalid state code.',
  not_configured: 'Auto.dev API key is not configured on this server.',
  SERVER_ERROR: 'Server error — try again.',
};

export default function PlateLookupBar({ onApply, defaultState = 'UT', defaultPlate = '' }: PlateLookupBarProps) {
  const [state, setState] = useState(defaultState);
  const [plate, setPlate] = useState(defaultPlate);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PlateLookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleQuery = async () => {
    if (!plate.trim()) return;
    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const res = await apiFetch<ApiResponse>(
        `/plate-lookup/${encodeURIComponent(state)}/${encodeURIComponent(plate.trim().toUpperCase())}`,
      );
      if (res.ok && res.data) {
        setResult(res.data);
      } else {
        const label = res.code ? (ERROR_LABELS[res.code] ?? res.message ?? 'Unknown error') : 'Unknown error';
        setError(label);
      }
    } catch {
      setError('Network error — check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleQuery();
    }
  };

  return (
    <div className="mb-4 border border-rmpg-600 bg-rmpg-800/60">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-rmpg-700/60 border-b border-rmpg-600">
        <Search className="w-3 h-3 text-accent-silver-400" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-accent-silver-400">
          Plate Query
        </span>
        <span className="ml-auto text-[9px] text-fg-muted uppercase tracking-wider">Auto.dev</span>
      </div>

      {/* Query row — Spillman-style: [STATE] [PLATE ___________] [QUERY] */}
      <div className="flex items-end gap-2 px-3 py-2">
        <div className="flex flex-col gap-0.5">
          <label className="text-[9px] font-semibold uppercase tracking-wider text-[color:var(--field-label-color)]">
            State
          </label>
          <select
            value={state}
            onChange={(e) => { setState(e.target.value); setResult(null); setError(null); }}
            className="select-dark text-xs h-7 pr-5 min-w-[4rem]"
          >
            {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-0.5 flex-1">
          <label className="text-[9px] font-semibold uppercase tracking-wider text-[color:var(--field-label-color)]">
            Plate Number
          </label>
          <input
            type="text"
            value={plate}
            onChange={(e) => { setPlate(e.target.value.toUpperCase()); setResult(null); setError(null); }}
            onKeyDown={handleKeyDown}
            placeholder="e.g. ABC1234"
            maxLength={10}
            className="input-dark text-xs h-7 font-mono tracking-widest placeholder:font-sans placeholder:tracking-normal"
          />
        </div>

        <button
          type="button"
          onClick={handleQuery}
          disabled={loading || !plate.trim()}
          className="h-7 px-4 text-[10px] font-bold uppercase tracking-widest bg-accent-silver-600 hover:bg-accent-silver-500 text-rmpg-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 whitespace-nowrap"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
          {loading ? 'Querying…' : 'Query'}
        </button>
      </div>

      {/* Result strip */}
      {result && (
        <div className="mx-3 mb-3 border border-green-700/50 bg-green-900/15">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-green-700/30">
            <CheckCircle className="w-3 h-3 text-green-400" />
            <span className="text-[9px] font-bold uppercase tracking-wider text-green-400">
              Query Result
            </span>
          </div>

          {/* Data grid */}
          <div className="px-3 py-2 grid grid-cols-3 sm:grid-cols-6 gap-x-4 gap-y-2">
            {[
              { label: 'Year',         value: String(result.year) },
              { label: 'Make',         value: result.make },
              { label: 'Model',        value: result.model },
              { label: 'Trim',         value: result.trim || '—' },
              { label: 'Drivetrain',   value: result.drivetrain || '—' },
              { label: 'VIN',          value: result.vin },
            ].map(({ label, value }) => (
              <div key={label}>
                <div className="text-[8px] font-semibold uppercase tracking-wider text-[color:var(--field-label-color)]">
                  {label}
                </div>
                <div className="text-[11px] text-fg-primary font-mono mt-0.5 truncate" title={value}>
                  {value}
                </div>
              </div>
            ))}
          </div>

          {/* Apply button */}
          <div className="px-3 pb-2.5 flex justify-end">
            <button
              type="button"
              onClick={() => onApply(result)}
              className="flex items-center gap-1.5 px-3 h-6 text-[10px] font-bold uppercase tracking-wider bg-green-700 hover:bg-green-600 text-white transition-colors"
            >
              <ArrowDownToLine className="w-3 h-3" />
              Apply to Record
            </button>
          </div>
        </div>
      )}

      {/* Error strip */}
      {error && (
        <div className="mx-3 mb-3 flex items-start gap-2 px-3 py-2 border border-red-700/50 bg-red-900/15">
          <XCircle className="w-3 h-3 text-red-400 mt-0.5 shrink-0" />
          <span className="text-[10px] text-red-300">{error}</span>
        </div>
      )}
    </div>
  );
}
