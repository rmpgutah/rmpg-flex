// Person Dossier — 360° investigative workspace (Palantir Phase 2).
// One /api/intel/dossier/person/:id call renders identity + flags,
// unified contact timeline, known associates (pivot to THEIR dossiers),
// vehicles, addresses, and confirmed linked identities. PDF export via
// dossierPdfGenerator (Arial-only stack).
import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { UserSearch, FileDown, Network, FolderOpen, Eye, EyeOff } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';
import { generateDossierPdf, type DossierData } from '../utils/dossierPdfGenerator';
import { formatLabel } from '../utils/formatters';

interface DossierResponse extends DossierData { watched?: boolean; escalation?: { recent: number; baseline: number; ratio: number; trend: string } | null }

const SENTINELS = new Set(['', 'none', 'n/a', 'na', 'null', '0', 'unknown']);
const real = (v: unknown) => v != null && !SENTINELS.has(String(v).trim().toLowerCase());
const show = (v: unknown) => (real(v) ? String(v) : '—');

const KIND_COLOR: Record<string, string> = {
  call: 'text-[#d4a017]', incident: 'text-orange-400', citation: 'text-rmpg-300',
  field_interview: 'text-emerald-400', trespass_order: 'text-red-400',
  warrant: 'text-red-500', arrest: 'text-red-400',
};

function Field({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex gap-2 text-[11px] py-[2px]">
      <span className="text-[#888888] w-24 shrink-0">{label}</span>
      <span className="text-gray-200">{show(value)}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#141414] border border-[#222222]">
      <div className="px-2 py-[3px] text-[9px] font-semibold text-[#d4a017] border-b border-[#1a1a1a]">{title}</div>
      <div className="p-2">{children}</div>
    </div>
  );
}

export default function PersonDossierPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<DossierResponse | null>(null);
  const [watched, setWatched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    setData(null); setError(null);
    apiFetch<DossierResponse>(`/intel/dossier/person/${id}`)
      .then((d) => { setData(d); setWatched(!!d.watched); })
      .catch((e) => setError(e?.message || 'Failed to load dossier'));
  }, [id]);

  if (error) return <div className="p-4 text-[11px] text-red-400">{error}</div>;
  if (!data) return <div className="p-4 text-[11px] text-[#888888]">Loading dossier…</div>;

  const p = data.person;
  const name = [p.first_name, p.middle_name, p.last_name].filter(real).join(' ') || `Person #${p.id}`;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="PERSON DOSSIER" icon={UserSearch} />

      {/* Header band */}
      <div className="bg-[#141414] border border-[#222222] p-3 flex items-start gap-4">
        {real(p.photo_url)
          ? <img src={p.photo_url} alt={name} className="w-20 h-24 object-cover border border-[#222222]" />
          : <div className="w-20 h-24 bg-[#050505] border border-[#222222] flex items-center justify-center text-[9px] text-[#888888]">NO PHOTO</div>}
        <div className="flex-1 min-w-0">
          <div className="text-lg text-rmpg-100 font-semibold">{name}</div>
          <div className="text-[11px] text-[#888888]">
            DOB {show(p.dob)} · {show(p.gender)} · {show(p.race)}
            {real(p.dl_number) && <> · DL {p.dl_number} ({show(p.dl_state)})</>}
          </div>
          <div className="flex gap-2 mt-1 flex-wrap">
            {data.flags.map((f) => (
              <span key={f} className="text-[9px] font-semibold text-red-500 border border-red-900 px-2 py-[1px]">{f}</span>
            ))}
            {data.escalation?.trend === 'escalating' && (
              <span className="text-[9px] font-semibold text-red-500 border border-red-600 px-2 py-[1px]">
                ESCALATING {data.escalation.ratio >= 99 ? '' : `${data.escalation.ratio.toFixed(1)}×`}
              </span>
            )}
            {watched && (
              <span className="text-[9px] font-semibold text-[#d4a017] border border-[#d4a017] px-2 py-[1px]">WATCHED</span>
            )}
            {data.cluster.length > 0 && (
              <span className="text-[9px] text-[#d4a017] border border-[#222222] px-2 py-[1px]">
                {data.cluster.length} LINKED IDENTIT{data.cluster.length === 1 ? 'Y' : 'IES'}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-1">
          <IconButton
            aria-label={watched ? 'Remove from watchlist' : 'Add to watchlist'}
            title={watched ? 'Watching — click to stop' : 'Watch: alert me on new activity'}
            onClick={async () => {
              try {
                if (watched) await apiFetch(`/intel/watchlist/person/${p.id}`, { method: 'DELETE' });
                else await apiFetch('/intel/watchlist', { method: 'POST', body: JSON.stringify({ entity_type: 'person', entity_id: p.id }) });
                setWatched(!watched);
              } catch (e) { console.error(e); }
            }}>
            {watched ? <Eye className="w-4 h-4 text-[#d4a017]" /> : <EyeOff className="w-4 h-4" />}
          </IconButton>
          <IconButton aria-label="Export dossier PDF" title="Export PDF" onClick={() => generateDossierPdf(data)}>
            <FileDown className="w-4 h-4" />
          </IconButton>
          <IconButton aria-label="Open in Connections graph" title="Connections graph"
            onClick={() => navigate(`/connections?type=person&id=${p.id}`)}>
            <Network className="w-4 h-4" />
          </IconButton>
          <IconButton aria-label="Open person record" title="Open record"
            onClick={() => navigate(`/records?tab=persons&id=${p.id}`)}>
            <FolderOpen className="w-4 h-4" />
          </IconButton>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
        {/* Left column */}
        <div className="space-y-4">
          <Section title="IDENTITY">
            <Field label="Aliases" value={p.alias_nickname} />
            <Field label="Height" value={p.height} />
            <Field label="Weight" value={p.weight} />
            <Field label="Hair / Eyes" value={[p.hair_color, p.eye_color].filter(real).join(' / ')} />
            <Field label="Phone" value={p.phone} />
            <Field label="SSN" value={real(p.ssn_last4) ? `***-**-${p.ssn_last4}` : null} />
            <Field label="Gang" value={p.gang_affiliation} />
            <Field label="Prob/Parole" value={p.probation_parole} />
            <Field label="Marks" value={p.scars_marks_tattoos} />
          </Section>

          {data.cluster.length > 0 && (
            <Section title="LINKED IDENTITIES">
              {data.cluster.map((m) => (
                <Link key={m.person_id} to={`/intel/person/${m.person_id}`}
                  className="block text-[11px] text-[#d4a017] hover:underline py-[2px]">
                  {m.name} (#{m.person_id})
                </Link>
              ))}
            </Section>
          )}

          <Section title={`KNOWN ASSOCIATES (${data.associates.length})`}>
            {data.associates.length === 0 && <div className="text-[11px] text-[#888888]">None on record.</div>}
            {data.associates.map((a) => (
              <Link key={a.person_id} to={`/intel/person/${a.person_id}`}
                className="flex justify-between text-[11px] py-[2px] hover:bg-[#1a1a1a]">
                <span className="text-[#d4a017]">{a.name}</span>
                <span className="text-[#888888]">{a.shared_events}× ({a.kinds.join(', ')})</span>
              </Link>
            ))}
          </Section>

          <Section title={`VEHICLES (${data.vehicles.length})`}>
            {data.vehicles.length === 0 && <div className="text-[11px] text-[#888888]">None on record.</div>}
            {data.vehicles.map((v) => (
              <div key={v.id} className="text-[11px] text-gray-200 py-[2px]">
                {[v.color, v.year, v.make, v.model].filter(real).join(' ')}
                {real(v.plate_number) && <span className="text-[#d4a017]"> · {v.plate_number}</span>}
              </div>
            ))}
          </Section>

          <Section title="ADDRESSES">
            {data.addresses.length === 0 && <div className="text-[11px] text-[#888888]">None on record.</div>}
            {data.addresses.map((a, i) => (
              <div key={i} className="text-[11px] py-[2px]">
                <span className="text-gray-200">{a.address}</span>
                <span className="text-[#888888]"> — {a.source}</span>
              </div>
            ))}
          </Section>
        </div>

        {/* Right column — timeline */}
        <Section title={`CONTACT TIMELINE (${data.timeline.length})`}>
          {data.timeline.length === 0 && <div className="text-[11px] text-[#888888]">No system contacts.</div>}
          {data.timeline.map((e) => (
            <div key={`${e.kind}:${e.id}`} className="flex items-baseline gap-2 text-[11px] py-[2px] border-b border-[#1a1a1a] last:border-b-0">
              <span className="text-[#888888] w-20 shrink-0">{e.date ? String(e.date).slice(0, 10) : '—'}</span>
              <span className={`w-28 shrink-0 text-[9px] font-semibold ${KIND_COLOR[e.kind] || 'text-rmpg-400'}`}>
                {e.kind.replace(/_/g, ' ').toUpperCase()}
              </span>
              <span className="text-gray-200">{e.title}</span>
              {e.status && <span className="text-[#888888] text-[9px]">({formatLabel(e.status)})</span>}
              {e.subtitle && <span className="text-[#888888] truncate">{e.subtitle}</span>}
            </div>
          ))}
        </Section>
      </div>
    </div>
  );
}
