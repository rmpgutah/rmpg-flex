// ============================================================
// RMPG Flex — Per-plate dossier (modal)
// Click a plate anywhere in the plate log → a full picture: live screen hits,
// the vehicle record (+ owner), a map of everywhere it's been seen, and the
// full source-tagged sighting history. Read-only; assembled from existing
// endpoints (no new server route).
// ============================================================

import { useEffect, useState } from 'react';
import { X, Car, MapPin, ShieldAlert } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { sightingSource } from '../utils/alprSource';
import SightingsMap, { type MapSighting } from './SightingsMap';

interface Hit { kind: string; severity: 'critical' | 'warning'; detail: string }
interface SightingRow {
  id: number; plate: string; state: string | null; location_text: string | null;
  notes: string | null; lat: number | null; lng: number | null; confidence: number | null; created_at: string;
}
interface VehicleRow {
  id: number; plate_number: string; state?: string | null; make?: string | null; model?: string | null;
  color?: string | null; year?: number | null; is_stolen?: number | null;
  owner_first_name?: string | null; owner_last_name?: string | null;
}

export default function PlateDossier({ plate, onClose }: { plate: string; onClose: () => void }) {
  const [sightings, setSightings] = useState<SightingRow[]>([]);
  const [vehicle, setVehicle] = useState<VehicleRow | null>(null);
  const [hits, setHits] = useState<Hit[]>([]);
  const [screenFailed, setScreenFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const norm = plate.toUpperCase().replace(/[\s-]/g, '');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setScreenFailed(false);
    Promise.allSettled([
      apiFetch<SightingRow[]>(`/intel/sightings?plate=${encodeURIComponent(norm)}&limit=100`),
      apiFetch<VehicleRow[]>(`/records/vehicles/search?q=${encodeURIComponent(norm)}`),
      apiFetch<{ hits: Hit[] }>(`/intel/screen`, { method: 'POST', body: JSON.stringify({ entity_type: 'vehicle', plate: norm }) }),
    ]).then(([s, v, h]) => {
      if (cancelled) return;
      setSightings(s.status === 'fulfilled' && Array.isArray(s.value) ? s.value : []);
      const vrows = v.status === 'fulfilled' && Array.isArray(v.value) ? v.value : [];
      setVehicle(vrows.find((r) => (r.plate_number || '').toUpperCase().replace(/[\s-]/g, '') === norm) || null);
      setHits(h.status === 'fulfilled' && Array.isArray(h.value?.hits) ? h.value.hits : []);
      setScreenFailed(h.status === 'rejected');
      setLoading(false);
    }).catch((e) => {
      if (!cancelled) { console.error(e); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [norm]);

  const mapSightings: MapSighting[] = sightings.map((s) => ({
    id: s.id, plate: s.plate, lat: s.lat, lng: s.lng, notes: s.notes, created_at: s.created_at,
    hit: hits.some((h) => h.severity === 'critical'),
  }));
  const ownerName = [vehicle?.owner_first_name, vehicle?.owner_last_name].filter(Boolean).join(' ');
  const vehicleDesc = [vehicle?.color, vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(' ');

  return (
    <div className="fixed inset-0 z-[200] bg-black/80 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-surface-sunken border border-rmpg-700 w-full sm:max-w-lg max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 bg-surface-sunken border-b border-border-default px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Car className="w-4 h-4 text-[#d4a017]" />
            <span className="text-xl tracking-[0.2em] text-rmpg-100 font-semibold">{norm}</span>
            {vehicle?.state && <span className="text-[11px] text-[#888888]">{vehicle.state}</span>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close dossier" className="text-[#888888] hover:text-rmpg-100"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-3 space-y-3">
          {/* Hits */}
          {hits.filter((h) => h.severity === 'critical').map((h, i) => (
            <div key={`c${i}`} className="bg-red-950 border border-red-600 text-red-300 text-sm font-semibold px-3 py-2 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0" /> {h.detail}
            </div>
          ))}
          {hits.filter((h) => h.severity === 'warning').map((h, i) => (
            <div key={`w${i}`} className="border border-[#d4a017] text-[#d4a017] text-[11px] px-3 py-1">{h.detail}</div>
          ))}
          {!loading && screenFailed && (
            <div className="bg-amber-950 border border-amber-600 text-amber-300 text-sm font-semibold px-3 py-2 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0" /> Screening unavailable — could not verify hits. Treat as UNVERIFIED.
            </div>
          )}
          {!loading && !screenFailed && !hits.length && (
            <div className="text-[11px] text-green-400/80 border border-green-900 bg-green-950/30 px-3 py-1.5">No active hits on this plate.</div>
          )}

          {/* Vehicle record */}
          {vehicle ? (
            <div className="border border-border-default bg-surface-base p-2.5">
              <div className="text-[9px] uppercase tracking-wider text-[#888888] mb-1">On file</div>
              <div className="text-sm text-rmpg-100">{vehicleDesc || 'Vehicle record'}</div>
              {ownerName && <div className="text-[11px] text-rmpg-300 mt-0.5">Owner: {ownerName}</div>}
              {vehicle.is_stolen === 1 && <div className="text-[11px] text-red-400 font-semibold mt-0.5">⚠ FLAGGED STOLEN</div>}
            </div>
          ) : !loading && (
            <div className="text-[11px] text-[#888888] border border-border-default px-3 py-1.5">Plate not on file — sightings only.</div>
          )}

          {/* Map */}
          <SightingsMap sightings={mapSightings} height={200} />

          {/* History */}
          <div className="border border-border-default">
            <div className="px-2 py-[3px] text-[9px] font-semibold text-[#d4a017] border-b border-border-default flex items-center justify-between">
              <span>SIGHTING HISTORY</span><span>{sightings.length}</span>
            </div>
            {loading && <div className="p-2 text-[11px] text-[#888888]">Loading…</div>}
            {!loading && !sightings.length && <div className="p-2 text-[11px] text-[#888888]">No sightings.</div>}
            {sightings.map((s) => {
              const src = sightingSource(s.notes);
              return (
                <div key={s.id} className="px-2 py-1.5 border-b border-border-default last:border-b-0 flex items-center gap-2 text-[11px]">
                  <span className={`text-[8px] font-bold uppercase px-1 py-0.5 border shrink-0 ${src.badgeClass}`}>{src.label}</span>
                  <span className="flex-1 min-w-0 truncate text-rmpg-300">
                    {s.location_text || (s.lat != null ? `${s.lat.toFixed(4)}, ${s.lng?.toFixed(4)}` : '—')}
                  </span>
                  {s.confidence != null && <span className="text-[#888888] shrink-0">{Math.round(s.confidence * 100)}%</span>}
                  <span className="text-rmpg-500 shrink-0">{String(s.created_at).slice(5, 16)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
