// Patrol plate/sighting log (Intel Wave 1). Mobile-first: big plate
// input, GPS autofill (best-effort), instant cross-hit screening —
// STOLEN / watchlist / owner-warrant hits render as full-width red
// banners. Every sighting is stored, building a searchable history
// per plate that feeds investigations.
import { useEffect, useState } from 'react';
import { Car, MapPin } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';

interface ScreenHit { kind: string; severity: 'critical' | 'warning'; detail: string }
interface SightResult {
  plate: string;
  vehicle: { id: number; plate_number: string; make: string; model: string; color: string; year: number } | null;
  hits: ScreenHit[];
}
interface Sighting {
  id: number; plate: string; location_text: string | null; notes: string | null; created_at: string;
}

export default function PlateLogPage() {
  const [plate, setPlate] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [result, setResult] = useState<SightResult | null>(null);
  const [recent, setRecent] = useState<Sighting[]>([]);
  const [busy, setBusy] = useState(false);

  const loadRecent = () => {
    apiFetch<Sighting[]>('/intel/sightings?limit=15')
      .then((r) => setRecent(Array.isArray(r) ? r : []))
      .catch(() => setRecent([]));
  };
  useEffect(loadRecent, []);
  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => { /* GPS denied/unavailable — location_text still works */ },
      { enableHighAccuracy: true, timeout: 5000 },
    );
  }, []);

  const submit = async () => {
    if (plate.trim().length < 2 || busy) return;
    setBusy(true);
    try {
      const r = await apiFetch<SightResult>('/intel/sightings', {
        method: 'POST',
        body: JSON.stringify({
          plate: plate.trim(), location_text: location.trim() || undefined,
          notes: notes.trim() || undefined, lat: coords?.lat, lng: coords?.lng,
        }),
      });
      setResult(r);
      setPlate(''); setNotes('');
      loadRecent();
    } catch (e) { console.error(e); }
    finally { setBusy(false); }
  };

  return (
    <div className="p-4 space-y-4 max-w-xl mx-auto">
      <PanelTitleBar title="PLATE LOG" icon={Car} />

      {result && result.hits.filter((h) => h.severity === 'critical').map((h) => (
        <div key={h.detail} className="bg-red-950 border border-red-600 text-red-300 text-sm font-semibold px-3 py-2">
          ⚠ {h.detail}
        </div>
      ))}
      {result && result.hits.filter((h) => h.severity === 'warning').map((h) => (
        <div key={h.detail} className="border border-[#d4a017] text-[#d4a017] text-[11px] px-3 py-1">
          {h.detail}
        </div>
      ))}
      {result && !result.hits.length && (
        <div className="border border-[#222222] text-[11px] text-[#888888] px-3 py-1">
          {result.plate}: no hits{result.vehicle ? ` — ${[result.vehicle.color, result.vehicle.year, result.vehicle.make, result.vehicle.model].filter(Boolean).join(' ')} on file` : ' (plate not on file — sighting logged)'}
        </div>
      )}

      <input
        autoFocus value={plate}
        onChange={(e) => setPlate(e.target.value.toUpperCase())}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="PLATE"
        className="w-full bg-[#050505] border border-[#222222] px-3 py-3 text-2xl tracking-[0.3em] text-center text-white font-semibold focus:border-[#d4a017] outline-none uppercase"
      />
      <div className="flex items-center gap-2">
        <MapPin className="w-4 h-4 text-[#888888] shrink-0" />
        <input
          value={location} onChange={(e) => setLocation(e.target.value)}
          placeholder={coords ? `GPS captured (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}) — add detail` : 'Location'}
          className="flex-1 bg-[#050505] border border-[#222222] px-2 py-1 text-[11px] text-gray-200 focus:border-[#d4a017] outline-none"
        />
      </div>
      <input
        value={notes} onChange={(e) => setNotes(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="Notes (optional)"
        className="w-full bg-[#050505] border border-[#222222] px-2 py-1 text-[11px] text-gray-200 focus:border-[#d4a017] outline-none"
      />
      <button
        onClick={submit} disabled={busy || plate.trim().length < 2}
        className="w-full py-2 text-sm font-semibold border border-[#d4a017] text-[#d4a017] hover:bg-[#1a1a1a] disabled:opacity-40">
        {busy ? 'CHECKING…' : 'LOG + CHECK'}
      </button>

      <div className="bg-[#141414] border border-[#222222]">
        <div className="px-2 py-[3px] text-[9px] font-semibold text-[#d4a017] border-b border-[#1a1a1a]">RECENT SIGHTINGS</div>
        {recent.length === 0 && <div className="p-2 text-[11px] text-[#888888]">None yet.</div>}
        {recent.map((s) => (
          <div key={s.id} className="px-2 py-[2px] text-[11px] text-gray-200 flex gap-2 border-b border-[#1a1a1a] last:border-b-0">
            <span className="text-[#d4a017] w-24 shrink-0">{s.plate}</span>
            <span className="text-[#888888] flex-1 truncate">{s.location_text || ''} {s.notes || ''}</span>
            <span className="text-[#888888]">{String(s.created_at).slice(5, 16)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
