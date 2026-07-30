// client/src/components/CarxeLookupPanel.tsx
// Manual CarsXE lookup trigger + result display. Two modes:
//   - mode="plate": decodes a plate/state via /api/carxe/plate-lookup
//   - mode="vin": offers Specifications / Lien & Theft / History buttons
//     against a single VIN via /api/carxe/vin-specs, /lien-theft, /history
// Results are cached server-side (carxe_lookups, 24h TTL) — this component
// just renders whatever the route returns; it does not itself cache.
import { useState } from 'react';
import { Search, AlertTriangle, Loader2 } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

type PlateResult = { success: boolean; make?: string; model?: string; trim?: string; year?: string; vin?: string; color?: string; [key: string]: unknown };
type SpecsResult = { attributes?: Record<string, unknown>; [key: string]: unknown };
type LienTheftEvent = { event: string; location?: string; lienholder?: string; date?: string; details_list?: string[] };
type LienTheftResult = { events: LienTheftEvent[]; [key: string]: unknown };
type HistoryResult = { status?: string; brandsRecordCount?: number; [key: string]: unknown };

interface CarxeResponse<T> {
  ok: boolean;
  code?: string;
  cached?: boolean;
  result?: T;
  screening?: { hits: Array<{ kind: string; severity: string; detail: string }> };
}

interface PlateProps { mode: 'plate'; plate: string; state?: string }
interface VinProps { mode: 'vin'; vin: string }

export default function CarxeLookupPanel(props: PlateProps | VinProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plateResult, setPlateResult] = useState<PlateResult | null>(null);
  const [specsResult, setSpecsResult] = useState<SpecsResult | null>(null);
  const [lienResult, setLienResult] = useState<LienTheftResult | null>(null);
  const [lienHits, setLienHits] = useState<Array<{ kind: string; severity: string; detail: string }>>([]);
  const [historyResult, setHistoryResult] = useState<HistoryResult | null>(null);

  async function runLookup(kind: 'plate' | 'vin-specs' | 'lien-theft' | 'history') {
    setLoading(kind);
    setError(null);
    try {
      const body = kind === 'plate'
        ? { plate: (props as PlateProps).plate, state: (props as PlateProps).state }
        : { vin: (props as VinProps).vin };
      const resp = await apiFetch<CarxeResponse<any>>(`/carxe/${kind}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        setError(resp.code === 'not_configured' ? 'CarsXE lookup is not configured' : (resp.code || 'Lookup failed'));
        return;
      }
      if (kind === 'plate') setPlateResult(resp.result);
      if (kind === 'vin-specs') setSpecsResult(resp.result);
      if (kind === 'lien-theft') {
        setLienResult(resp.result);
        setLienHits(resp.screening?.hits ?? []);
      }
      if (kind === 'history') setHistoryResult(resp.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-2">
      {error && (
        <div className="text-[11px] text-sev-critical flex items-center gap-1">
          <AlertTriangle size={12} /> {error}
        </div>
      )}
      {props.mode === 'plate' && (
        <button
          onClick={() => runLookup('plate')}
          disabled={loading === 'plate'}
          className="flex items-center gap-1 text-[11px] px-2 py-1 bg-surface-raised hover:bg-surface-hover border border-rmpg-700 disabled:opacity-50"
        >
          {loading === 'plate' ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
          Run CarsXE Lookup
        </button>
      )}
      {plateResult && (
        <div className="text-[11px] text-rmpg-100">
          {(plateResult.description as string | undefined) || `${plateResult.year ?? ''} ${plateResult.make ?? ''} ${plateResult.model ?? ''} ${plateResult.trim ?? ''}`.trim()}
          {plateResult.vin ? ` · VIN ${plateResult.vin}` : ''}
        </div>
      )}

      {props.mode === 'vin' && (
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => runLookup('vin-specs')} disabled={loading === 'vin-specs'} className="text-[11px] px-2 py-1 bg-surface-raised hover:bg-surface-hover border border-rmpg-700 disabled:opacity-50">
            {loading === 'vin-specs' ? <Loader2 size={12} className="animate-spin inline" /> : null} Specifications
          </button>
          <button onClick={() => runLookup('lien-theft')} disabled={loading === 'lien-theft'} className="text-[11px] px-2 py-1 bg-surface-raised hover:bg-surface-hover border border-rmpg-700 disabled:opacity-50">
            {loading === 'lien-theft' ? <Loader2 size={12} className="animate-spin inline" /> : null} Lien &amp; Theft
          </button>
          <button onClick={() => runLookup('history')} disabled={loading === 'history'} className="text-[11px] px-2 py-1 bg-surface-raised hover:bg-surface-hover border border-rmpg-700 disabled:opacity-50">
            {loading === 'history' ? <Loader2 size={12} className="animate-spin inline" /> : null} History
          </button>
        </div>
      )}

      {specsResult?.attributes && (
        <div className="text-[11px] text-rmpg-100">
          {Object.entries(specsResult.attributes).slice(0, 6).map(([k, v]) => (
            <div key={k}>{k}: {String(v)}</div>
          ))}
        </div>
      )}

      {lienResult && (
        <div className="text-[11px]">
          {lienHits.length > 0 && (
            <div className="text-sev-critical font-semibold mb-1">
              {lienHits.map((h, i) => <div key={i}>⚠ {h.detail}</div>)}
            </div>
          )}
          {lienResult.events.length === 0 && <div className="text-fg-muted">No lien or theft records found</div>}
          {lienResult.events.map((e, i) => (
            <div key={i} className={e.event.toLowerCase().includes('theft') ? 'text-sev-critical' : 'text-rmpg-100'}>
              {e.event}{e.lienholder ? ` — ${e.lienholder}` : ''}{e.location ? ` (${e.location})` : ''}
            </div>
          ))}
        </div>
      )}

      {historyResult && (
        <div className="text-[11px] text-rmpg-100">
          Status: {historyResult.status ?? 'unknown'} · Brand records: {historyResult.brandsRecordCount ?? 0}
        </div>
      )}
    </div>
  );
}
