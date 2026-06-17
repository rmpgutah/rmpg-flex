// Jail / booking records (Intel Wave 3a). Shows the Utah source registry
// + scrape health, a manual roster-ingest box (CSV or "Name - charges"
// lines) that cross-hits every booking against known/flagged subjects,
// and a recent-bookings list with match badges.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';

interface Source {
  source_key: string; display_name: string; county: string | null;
  kind: string; status: string; last_run_at: string | null; last_status: string | null; row_count: number;
}
interface Booking {
  id: number; full_name: string; booking_date: string | null; charges: string | null;
  county: string | null; entry_source: string; person_id: number | null;
}
interface IngestResult { ingested: number; matched: number; alerts: number; parsed: number }

const STATUS_DOT: Record<string, string> = {
  active: 'bg-emerald-500', pending: 'bg-rmpg-500', disabled: 'bg-red-600',
};

export default function JailRecordsPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [county, setCounty] = useState('');
  const [format, setFormat] = useState<'lines' | 'csv'>('lines');
  const [text, setText] = useState('');
  const [result, setResult] = useState<IngestResult | null>(null);
  const [busy, setBusy] = useState(false);

  const loadSources = () => apiFetch<Source[]>('/intel/jail/sources').then((r) => setSources(Array.isArray(r) ? r : [])).catch(() => setSources([]));
  const loadBookings = () => apiFetch<Booking[]>('/intel/jail/bookings?limit=25').then((r) => setBookings(Array.isArray(r) ? r : [])).catch(() => setBookings([]));
  useEffect(() => { loadSources(); loadBookings(); }, []);

  const ingest = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const r = await apiFetch<IngestResult>('/intel/jail/ingest', {
        method: 'POST', body: JSON.stringify({ county: county.trim() || undefined, format, text }),
      });
      setResult(r); setText(''); loadBookings();
    } catch (e) { console.error(e); }
    finally { setBusy(false); }
  };

  const active = sources.filter((s) => s.status === 'active');
  const pending = sources.filter((s) => s.status !== 'active');

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="JAIL / BOOKING RECORDS" icon={Building2} />

      {/* Manual ingest */}
      <div className="bg-surface-raised border border-rmpg-700 p-3 space-y-2">
        <div className="text-[9px] font-semibold text-[#d4a017]">MANUAL ROSTER INGEST</div>
        <div className="flex gap-2">
          <input value={county} onChange={(e) => setCounty(e.target.value)} placeholder="County (e.g. Salt Lake)"
            className="flex-1 bg-surface-deep border border-rmpg-700 px-2 py-1 text-[11px] text-rmpg-200 focus:border-[#d4a017] outline-none" />
          <select value={format} onChange={(e) => setFormat(e.target.value as 'lines' | 'csv')}
            className="bg-surface-deep border border-rmpg-700 px-2 py-1 text-[11px] text-rmpg-200">
            <option value="lines">Lines (Name - charges)</option>
            <option value="csv">CSV (name,dob,booking_date,charges)</option>
          </select>
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4}
          placeholder={format === 'csv' ? 'name,dob,booking_date,charges\nJohn Smith,1990-01-02,2026-06-10,Theft' : 'John Smith - Theft, Trespass\nJane Doe - DUI'}
          className="w-full bg-surface-deep border border-rmpg-700 px-2 py-1 text-[11px] text-rmpg-200 focus:border-[#d4a017] outline-none font-mono" />
        <button onClick={ingest} disabled={busy || !text.trim()}
          className="w-full py-1.5 text-[11px] font-semibold border border-[#d4a017] text-[#d4a017] hover:bg-surface-raised disabled:opacity-40">
          {busy ? 'INGESTING…' : 'INGEST + CROSS-HIT'}
        </button>
        {result && (
          <div className="text-[11px] text-rmpg-200">
            Parsed {result.parsed} · ingested {result.ingested} · matched {result.matched} known subject(s)
            {result.alerts > 0 && <span className="text-red-500 font-semibold"> · {result.alerts} FLAGGED HIT(S)</span>}
          </div>
        )}
      </div>

      {/* Recent bookings */}
      <div className="bg-surface-raised border border-rmpg-700">
        <div className="px-2 py-[3px] text-[9px] font-semibold text-[#d4a017] border-b border-border-subtle">RECENT BOOKINGS</div>
        {bookings.length === 0 && <div className="p-2 text-[11px] text-rmpg-500">None yet — ingest a roster above.</div>}
        {bookings.map((b) => (
          <div key={b.id} className="px-2 py-[2px] text-[11px] flex items-center gap-2 border-b border-border-subtle last:border-b-0">
            <span className="text-rmpg-200 w-44 shrink-0 truncate">{b.full_name}</span>
            <span className="text-rmpg-500 min-w-0 flex-1 truncate">{b.charges || ''}</span>
            <span className="text-rmpg-500">{b.county || ''}</span>
            <span className="text-rmpg-500">{b.booking_date ? String(b.booking_date).slice(0, 10) : ''}</span>
            {b.person_id
              ? <Link to={`/intel/person/${b.person_id}`} className="text-[9px] text-[#d4a017] border border-rmpg-700 px-1">KNOWN →</Link>
              : <span className="text-[9px] text-rmpg-500 w-12 text-right">new</span>}
          </div>
        ))}
      </div>

      {/* Source registry */}
      <div className="bg-surface-raised border border-rmpg-700">
        <div className="px-2 py-[3px] text-[9px] font-semibold text-[#d4a017] border-b border-border-subtle">
          SOURCES — {active.length} active, {pending.length} pending
        </div>
        {[...active, ...pending].map((s) => (
          <div key={s.source_key} className="px-2 py-[2px] text-[11px] flex items-center gap-2 border-b border-border-subtle last:border-b-0">
            <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[s.status] || 'bg-rmpg-500'}`} />
            <span className="text-rmpg-200 min-w-0 flex-1 truncate">{s.display_name}</span>
            <span className="text-rmpg-500 text-[9px]">{s.kind}</span>
            <span className="text-rmpg-500 text-[9px]">{s.row_count || 0} rec</span>
            <span className="text-rmpg-500 text-[9px] w-28 truncate text-right">{s.last_status || s.status}</span>
          </div>
        ))}
      </div>
      <div className="text-[9px] text-rmpg-500">
        Live county portals are JS-rendered and can't be auto-scraped from the edge yet — use manual ingest for those.
        UDC/VINELink adapters are wired and self-report health; authorized feeds flip a source to active.
      </div>
    </div>
  );
}
