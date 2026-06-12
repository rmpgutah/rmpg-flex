// Field quick-capture (Intel Wave 2) — 30-second contact logging.
// One CAPTURE: dedupes-or-creates the person and vehicle, writes the
// field interview with GPS, screens everything, and shows hit banners.
// Links straight to the new/updated dossier.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardPen, MapPin } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';

interface ScreenHit { kind: string; severity: 'critical' | 'warning'; detail: string }
interface CaptureResult {
  person_id: number | null; person_reused: boolean;
  vehicle_id: number | null; fi_id: number | null; hits: ScreenHit[];
}

const inputCls = 'w-full bg-[#050505] border border-[#222222] px-2 py-2 text-sm text-gray-200 focus:border-[#d4a017] outline-none';

export default function QuickCapturePage() {
  const [form, setForm] = useState({ first_name: '', last_name: '', dob: '', plate: '', location: '', narrative: '' });
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => { /* GPS unavailable — manual location still works */ },
      { enableHighAccuracy: true, timeout: 5000 },
    );
  }, []);

  const submit = async () => {
    if ((!form.last_name.trim() && !form.plate.trim()) || busy) return;
    setBusy(true);
    try {
      const r = await apiFetch<CaptureResult>('/intel/quick-capture', {
        method: 'POST',
        body: JSON.stringify({
          first_name: form.first_name.trim() || undefined,
          last_name: form.last_name.trim() || undefined,
          dob: form.dob.trim() || undefined,
          plate: form.plate.trim() || undefined,
          location: form.location.trim() || undefined,
          narrative: form.narrative.trim() || undefined,
          lat: coords?.lat, lng: coords?.lng,
        }),
      });
      setResult(r);
      setForm({ first_name: '', last_name: '', dob: '', plate: '', location: '', narrative: '' });
    } catch (e) { console.error(e); }
    finally { setBusy(false); }
  };

  return (
    <div className="p-4 space-y-3 max-w-xl mx-auto">
      <PanelTitleBar title="QUICK CAPTURE" icon={ClipboardPen} />

      {result?.hits.filter((h) => h.severity === 'critical').map((h) => (
        <div key={h.detail} className="bg-red-950 border border-red-600 text-red-300 text-sm font-semibold px-3 py-2">⚠ {h.detail}</div>
      ))}
      {result?.hits.filter((h) => h.severity === 'warning').map((h) => (
        <div key={h.detail} className="border border-[#d4a017] text-[#d4a017] text-[11px] px-3 py-1">{h.detail}</div>
      ))}
      {result && (
        <div className="border border-[#222222] text-[11px] text-[#888888] px-3 py-1 flex gap-3">
          <span>FI logged{result.person_reused ? ' (known subject)' : ''}.</span>
          {result.person_id && (
            <Link to={`/intel/person/${result.person_id}`} className="text-[#d4a017] hover:underline">Open dossier →</Link>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <input value={form.first_name} onChange={set('first_name')} placeholder="First name" className={inputCls} />
        <input value={form.last_name} onChange={set('last_name')} placeholder="Last name" className={inputCls} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input value={form.dob} onChange={set('dob')} placeholder="DOB (YYYY-MM-DD)" className={inputCls} />
        <input value={form.plate} onChange={(e) => setForm((f) => ({ ...f, plate: e.target.value.toUpperCase() }))} placeholder="Plate" className={`${inputCls} uppercase`} />
      </div>
      <div className="flex items-center gap-2">
        <MapPin className="w-4 h-4 text-[#888888] shrink-0" />
        <input value={form.location} onChange={set('location')}
          placeholder={coords ? `GPS captured — add detail` : 'Location'} className={inputCls} />
      </div>
      <textarea value={form.narrative} onChange={set('narrative')} placeholder="Narrative / observations" rows={3} className={inputCls} />
      <button onClick={submit} disabled={busy || (!form.last_name.trim() && !form.plate.trim())}
        className="w-full py-2 text-sm font-semibold border border-[#d4a017] text-[#d4a017] hover:bg-[#1a1a1a] disabled:opacity-40">
        {busy ? 'CAPTURING…' : 'CAPTURE + CHECK'}
      </button>
      <div className="text-[9px] text-[#888888]">Creates/updates the person and vehicle records, files an FI, and runs a records check — all in one step.</div>
    </div>
  );
}
