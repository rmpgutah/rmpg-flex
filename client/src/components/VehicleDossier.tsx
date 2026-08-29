// Per-vehicle evidence dossier: fetches /alpr/vehicle/:plate/dossier and renders
// each capture package as a row with thumbnail, trust badge, source, and variants.
import { useEffect, useState } from 'react';
import { X, ScanSearch, RefreshCw, Loader2 } from 'lucide-react';
import { apiFetch, authedImageUrl } from '../hooks/useApi';
import IconButton from './IconButton';
import { toDisplayLabel } from '../utils/formatters';
import { parseTimestamp } from '../utils/dateUtils';
import TrustBadge from './TrustBadge';
import CarxeLookupPanel from './CarxeLookupPanel';

interface DossierPackage {
  id: number;
  canonical_plate: string;
  trust_score: number;
  read_count: number;
  trust_basis: string;
  full_r2_key: string | null;
  vehicle_r2_key: string | null;
  plate_r2_key: string | null;
  source_type: string | null;
  asserted: string | null;
  created_at: string;
  variants_json: string | null;
}

interface DossierResponse {
  plate: string;
  packages: DossierPackage[];
  vehicle_record_id: number | null;
}

function fmtDate(iso: string): string {
  try {
    return parseTimestamp(iso).toLocaleString('en-US', {
      timeZone: 'America/Denver',
      month: 'numeric', day: 'numeric', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function VehicleDossier({ plate, onClose }: { plate: string; onClose: () => void }) {
  const [data, setData] = useState<DossierResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichMsg, setEnrichMsg] = useState<string | null>(null);

  const handleEnrich = async () => {
    if (!data) return;
    const vehicleId = data.vehicle_record_id;
    if (!vehicleId) {
      setEnrichMsg('No vehicle record ID available');
      return;
    }
    setEnriching(true);
    setEnrichMsg(null);
    try {
      await apiFetch(`/vehicle-enrichment/enrich/${vehicleId}`, { method: 'POST' });
      setEnrichMsg('Enriched');
      setTimeout(() => setEnrichMsg(null), 4000);
      setLoading(true);
      try {
        const r = await apiFetch<DossierResponse>(`/alpr/vehicle/${encodeURIComponent(plate)}/dossier`);
        setData(r);
      } catch (e: unknown) {
        setErr((e as Error)?.message || 'Failed to reload');
      } finally {
        setLoading(false);
        setEnriching(false);
      }
    } catch {
      setEnrichMsg('Enrichment failed');
      setEnriching(false);
    }
  };

  useEffect(() => {
    setLoading(true); setErr(null); setData(null);
    apiFetch<DossierResponse>(`/alpr/vehicle/${encodeURIComponent(plate)}/dossier`)
      .then((r) => setData(r))
      .catch((e) => setErr(e?.message || 'Failed to load dossier'))
      .finally(() => setLoading(false));
  }, [plate]);

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {/* Panel */}
      <div className="w-full max-w-lg max-h-[85vh] flex flex-col border border-border-subtle bg-surface-sunken">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
          <span className="text-[11px] font-semibold tracking-wider text-[var(--field-label-color)]">
            VEHICLE FILE —{' '}
            <span className="font-mono text-rmpg-100">{plate}</span>
          </span>
          <div className="flex items-center gap-1">
            <IconButton
              aria-label="Re-enrich vehicle data"
              onClick={handleEnrich}
              disabled={enriching}
              className="text-fg-muted hover:text-rmpg-100">
              {enriching
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <RefreshCw className="w-4 h-4" />}
            </IconButton>
            <button
              type="button"
              aria-label="Close dossier"
              onClick={onClose}
              className="text-fg-muted hover:text-rmpg-100">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        {enrichMsg && (
          <div className="px-3 py-1 text-[10px] text-rmpg-400 border-b border-border-default">
            {enrichMsg}
          </div>
        )}

        {/* CarsXE manual lookup — this dossier is keyed by plate only (no VIN
            is available on DossierPackage or its callers), so this uses
            mode="plate" rather than the VIN mode suggested by the task brief. */}
        <div className="px-3 py-2 border-b border-border-default">
          <CarxeLookupPanel mode="plate" plate={plate} />
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-2 space-y-1">
          {loading && (
            <div className="text-[11px] text-fg-muted text-center py-6">Loading…</div>
          )}
          {err && (
            <div className="text-[11px] text-red-300 border border-red-600 bg-red-950/40 px-3 py-2">{err}</div>
          )}
          {!loading && !err && data && data.packages.length === 0 && (
            <div className="text-[11px] text-fg-muted text-center py-6">No packages on file for this plate.</div>
          )}
          {!loading && !err && data && data.packages.map((pkg) => {
            const imageUrl = pkg.full_r2_key
              ? authedImageUrl(`/api/alpr/image/${pkg.full_r2_key}`)
              : null;
            const trust = {
              trustScore: pkg.trust_score,
              readCount: pkg.read_count,
              basis: pkg.trust_basis,
            };
            const variants: string[] = (() => {
              try { return JSON.parse(pkg.variants_json || '[]'); } catch { return []; }
            })();

            return (
              <div key={pkg.id} className="flex gap-2 border border-border-default bg-black p-1.5">
                {/* Thumbnail */}
                <div className="shrink-0 w-20 h-16 bg-surface-sunken border border-border-default overflow-hidden">
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt={pkg.canonical_plate}
                      loading="lazy"
                      className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-rmpg-700">
                      <ScanSearch className="w-5 h-5" />
                    </div>
                  )}
                </div>

                {/* Meta */}
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[11px] font-semibold text-rmpg-100 tracking-wider">
                      {pkg.canonical_plate}
                    </span>
                    <TrustBadge trust={trust} />
                  </div>
                  <div className="flex items-center gap-2 text-[9px] text-fg-muted">
                    {pkg.source_type && (
                      <span className="border border-border-default px-1 py-[1px]">
                        {toDisplayLabel(pkg.source_type)}
                      </span>
                    )}
                    <span>{fmtDate(pkg.created_at)}</span>
                  </div>
                  {variants.length > 0 && (
                    <div className="text-[9px] text-fg-muted border-t border-border-default pt-0.5 mt-0.5">
                      variants: {variants.join(', ')} — <span className="text-[var(--field-label-color)]">verify</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        {data && data.packages.length > 0 && (
          <div className="px-3 py-1.5 border-t border-border-default text-[9px] text-fg-muted">
            {data.packages.length} package{data.packages.length !== 1 ? 's' : ''} on file · newest first
          </div>
        )}
      </div>
    </div>
  );
}
