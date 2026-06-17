// Per-vehicle evidence dossier: fetches /alpr/vehicle/:plate/dossier and renders
// each capture package as a row with thumbnail, trust badge, source, and variants.
import { useEffect, useState } from 'react';
import { X, ScanSearch } from 'lucide-react';
import { apiFetch, authedImageUrl } from '../hooks/useApi';
import TrustBadge from './TrustBadge';

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
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso.replace(' ', 'T') + 'Z').toLocaleString([], {
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
          <span className="text-[11px] font-semibold tracking-wider text-[#d4a017]">
            VEHICLE FILE —{' '}
            <span className="font-mono text-rmpg-100">{plate}</span>
          </span>
          <button
            type="button"
            aria-label="Close dossier"
            onClick={onClose}
            className="text-[#888] hover:text-rmpg-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-2 space-y-1">
          {loading && (
            <div className="text-[11px] text-[#888] text-center py-6">Loading…</div>
          )}
          {err && (
            <div className="text-[11px] text-red-300 border border-red-600 bg-red-950/40 px-3 py-2">{err}</div>
          )}
          {!loading && !err && data && data.packages.length === 0 && (
            <div className="text-[11px] text-[#888] text-center py-6">No packages on file for this plate.</div>
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
                  <div className="flex items-center gap-2 text-[9px] text-[#888]">
                    {pkg.source_type && (
                      <span className="border border-border-default px-1 py-[1px]">
                        {pkg.source_type.replace(/_/g, ' ')}
                      </span>
                    )}
                    <span>{fmtDate(pkg.created_at)}</span>
                  </div>
                  {variants.length > 0 && (
                    <div className="text-[9px] text-[#888] border-t border-border-default pt-0.5 mt-0.5">
                      variants: {variants.join(', ')} — <span className="text-[#d4a017]">verify</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        {data && data.packages.length > 0 && (
          <div className="px-3 py-1.5 border-t border-border-default text-[9px] text-rmpg-500">
            {data.packages.length} package{data.packages.length !== 1 ? 's' : ''} on file · newest first
          </div>
        )}
      </div>
    </div>
  );
}
