// Person Dossier — 360° investigative workspace (Palantir Phase 2).
// One /api/intel/dossier/person/:id call renders identity + flags,
// unified contact timeline, known associates (pivot to THEIR dossiers),
// vehicles, addresses, confirmed linked identities, and disseminated
// intel reports naming this person. PDF export via the schema-driven
// pdf/v2 engine (steel/gold accents).
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router';
import { UserSearch, FileDown, Network, FolderOpen, Eye, EyeOff, X, FileText } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';
import { downloadPdfV2 } from '../utils/pdf/v2';
import { dossierSchema, type DossierData, type LinkedIntelEntry } from '../utils/pdf/v2/forms/dossier';
import { toDisplayLabel, formatLabel } from '../utils/formatters';
import { useToast } from '../components/ToastProvider';
import { formatDate } from '../utils/dateUtils';
import { useAuth } from '../context/AuthContext';

interface DossierResponse extends DossierData {
  watched?: boolean;
  escalation?: { recent: number; baseline: number; ratio: number; trend: string } | null;
  linked_intel?: LinkedIntelEntry[];
}

const SENTINELS = new Set(['', 'none', 'n/a', 'na', 'null', '0', 'unknown']);
const real = (v: unknown) => v != null && !SENTINELS.has(String(v).trim().toLowerCase());
const show = (v: unknown) => (real(v) ? String(v) : '—');

const MANAGE_ROLES = new Set(['admin', 'manager', 'supervisor']);

const KIND_COLOR: Record<string, string> = {
  call: '[color:var(--panel-header-color)]', incident: 'text-orange-400', citation: 'text-fg-muted',
  field_interview: 'text-emerald-400', trespass_order: 'text-red-400',
  warrant: 'text-red-500', arrest: 'text-red-400',
};

const THREAT_COLOR: Record<string, string> = {
  low: 'text-emerald-400', medium: '[color:var(--panel-header-color)]', high: 'text-orange-400',
  critical: 'text-red-500', imminent: 'text-red-500',
};

function Field({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex gap-2 text-[11px] py-[2px]">
      <span className="text-fg-muted w-24 shrink-0">{label}</span>
      <span className="text-rmpg-200">{show(value)}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-base border border-border-default">
      <div className="px-2 py-[3px] text-[9px] font-semibold text-brand-400 border-b border-border-default">{title}</div>
      <div className="p-2">{children}</div>
    </div>
  );
}

export default function PersonDossierPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { addToast } = useToast();
  const [data, setData] = useState<DossierResponse | null>(null);
  const [watched, setWatched] = useState(false);
  const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();
  const canManage = MANAGE_ROLES.has(user?.role ?? '');

  // Deep-link: ?person_id=<n> → redirect to /intel/person/<n> (strip param).
  useEffect(() => {
    const personId = searchParams.get('person_id');
    if (personId) {
      setSearchParams({}, { replace: true });
      navigate(`/intel/person/${personId}`, { replace: true });
    }
  }, [searchParams, setSearchParams, navigate]);

  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    setData(null); setError(null);
    apiFetch<DossierResponse>(`/intel/dossier/person/${id}`)
      .then((d) => { setData(d); setWatched(!!d.watched); })
      .catch((e: any) => {
        const notFound = e?.status === 404;
        setError({ message: e instanceof Error ? e.message : 'Failed to load dossier', notFound });
      });
  }, [id, reloadTick]);

  // Esc cascade: photo zoom → navigate back. Read-only page, no forms /
  // confirms / filters to peel off, so the stack is short by design.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (photoOpen) { e.stopPropagation(); setPhotoOpen(false); return; }
      navigate(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [photoOpen, navigate]);

  // N shortcut: open the linked person record (canManage only).
  useEffect(() => {
    if (!canManage || !id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'n' && e.key !== 'N') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      navigate(`/records?tab=persons&id=${id}`);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canManage, id, navigate]);

  if (error) {
    if (error.notFound) {
      return (
        <div className="p-4 space-y-3">
          <PanelTitleBar title="PERSON DOSSIER" icon={UserSearch} />
          <div className="bg-surface-base border border-border-default p-4 text-[11px] text-fg-muted">
            No person on file for id <span className="text-rmpg-200">#{id}</span>. The record may have been merged, deleted, or never existed.
            <div className="mt-3">
              <button type="button" onClick={() => navigate(-1)} className="text-brand-400 hover:underline">← Back</button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="p-4 text-[11px] text-red-400 space-y-2" role="alert">
        <p>{error.message}</p>
        <button type="button" className="toolbar-btn" onClick={() => setReloadTick((n) => n + 1)}>Retry</button>
      </div>
    );
  }
  if (!data) return <div className="p-4 text-[11px] text-fg-muted">Loading dossier…</div>;

  const p = data.person;
  const name = [p.first_name, p.middle_name, p.last_name].filter(real).join(' ') || `Person #${p.id}`;
  const linkedIntel = data.linked_intel ?? [];

  const onExportPdf = async () => {
    if (pdfBusy) return;
    setPdfBusy(true);
    try {
      const filename = `dossier-${(data.person.first_name ?? '') + '-' + (data.person.last_name ?? '')}`
        .toLowerCase().replace(/\s+/g, '-').replace(/^-+|-+$/g, '') || `dossier-${data.person.id}`;
      await downloadPdfV2(dossierSchema, data, `${filename}-${data.person.id}.pdf`, { schemaId: 'dossier' });
    }
    finally {
      // Tiny visual debounce so accidental double-press doesn't fire two
      // jsPDF instances (each one re-registers the Arial font subset).
      setTimeout(() => setPdfBusy(false), 600);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="PERSON DOSSIER" icon={UserSearch} />

      {/* Header band */}
      <div className="bg-surface-base border border-border-default p-3 flex items-start gap-4">
        {real(p.photo_url)
          ? (
            <button
              type="button"
              onClick={() => setPhotoOpen(true)}
              aria-label="Open photo full-size"
              title="Click to enlarge"
              className="block w-20 h-24 border border-border-default p-0 overflow-hidden"
            >
              <img src={p.photo_url} alt={name} className="w-full h-full object-cover" />
            </button>
          )
          : <div className="w-20 h-24 bg-surface-overlay border border-border-default flex items-center justify-center text-[9px] text-fg-muted">NO PHOTO</div>}
        <div className="flex-1 min-w-0">
          <div className="text-lg text-rmpg-100 font-semibold">{name}</div>
          <div className="text-[11px] text-fg-muted">
            DOB {show(p.dob)} · {show(p.gender)} · {show(p.race)}
            {real(p.dl_number) && <> · DL {p.dl_number} ({show(p.dl_state)})</>}
          </div>
          <div className="flex gap-2 mt-1 flex-wrap">
            {data.flags.map((f) => (
              <span key={f} className="text-[9px] font-semibold text-red-500 border border-red-900 px-2 py-[1px]">{f}</span>
            ))}
            {data.escalation?.trend === 'escalating' && (
              <span
                title={`Recent 30d: ${data.escalation.recent} events; 90d baseline: ${data.escalation.baseline.toFixed(1)}`}
                className="text-[9px] font-semibold text-red-500 border border-red-600 px-2 py-[1px]"
              >
                ESCALATING {data.escalation.ratio >= 99 ? '' : `${data.escalation.ratio.toFixed(1)}×`}
              </span>
            )}
            {watched && (
              <span className="text-[9px] font-semibold [color:var(--panel-header-color)] border [border-color:var(--field-label-color)] px-2 py-[1px]">WATCHED</span>
            )}
            {data.cluster.length > 0 && (
              <span className="text-[9px] [color:var(--panel-header-color)] border border-border-default px-2 py-[1px]">
                {data.cluster.length} LINKED IDENTIT{data.cluster.length === 1 ? 'Y' : 'IES'}
              </span>
            )}
            {linkedIntel.length > 0 && (
              <span className="text-[9px] font-semibold [color:var(--panel-header-color)] border [border-color:var(--field-label-color)] px-2 py-[1px]">
                {linkedIntel.length} INTEL REPORT{linkedIntel.length === 1 ? '' : 'S'}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-1">
          {canManage && (
            <IconButton
              aria-label={watched ? 'Remove from watchlist' : 'Add to watchlist'}
              title={watched ? 'Watching — click to stop' : 'Watch: alert me on new activity'}
              onClick={async () => {
                try {
                  if (watched) await apiFetch(`/intel/watchlist/person/${p.id}`, { method: 'DELETE' });
                  else await apiFetch('/intel/watchlist', { method: 'POST', body: JSON.stringify({ entity_type: 'person', entity_id: p.id }) });
                  setWatched(!watched);
                } catch (e) { console.error(e); addToast(e instanceof Error ? e.message : 'Failed to update watchlist', 'error'); }
              }}>
              {watched ? <Eye className="w-4 h-4 [color:var(--panel-header-color)]" /> : <EyeOff className="w-4 h-4" />}
            </IconButton>
          )}
          <IconButton
            aria-label="Export dossier PDF"
            title={pdfBusy ? 'Generating…' : 'Export PDF'}
            disabled={pdfBusy}
            onClick={onExportPdf}
          >
            <FileDown className={`w-4 h-4 ${pdfBusy ? 'opacity-40' : ''}`} />
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
                  className="block text-[11px] text-brand-400 hover:underline py-[2px]">
                  {m.name} (#{m.person_id})
                </Link>
              ))}
            </Section>
          )}

          <Section title={`KNOWN ASSOCIATES (${data.associates.length})`}>
            {data.associates.length === 0 && <div className="text-[11px] text-fg-muted">None on record.</div>}
            {data.associates.map((a) => (
              <Link key={a.person_id} to={`/intel/person/${a.person_id}`}
                className="flex justify-between text-[11px] py-[2px] hover:bg-surface-raised">
                <span className="text-brand-400">{a.name}</span>
                <span className="text-fg-muted">{a.shared_events}× ({a.kinds.join(', ')})</span>
              </Link>
            ))}
          </Section>

          <Section title={`VEHICLES (${data.vehicles.length})`}>
            {data.vehicles.length === 0 && <div className="text-[11px] text-fg-muted">None on record.</div>}
            {data.vehicles.map((v) => (
              <div key={v.id} className="text-[11px] text-rmpg-200 py-[2px]">
                {[v.color, v.year, v.make, v.model].filter(real).join(' ')}
                {real(v.plate_number) && <span className="text-brand-400"> · {v.plate_number}</span>}
              </div>
            ))}
          </Section>

          <Section title="ADDRESSES">
            {data.addresses.length === 0 && <div className="text-[11px] text-fg-muted">None on record.</div>}
            {data.addresses.map((a, i) => (
              <div key={i} className="text-[11px] py-[2px]">
                <span className="text-rmpg-200">{a.address}</span>
                <span className="text-fg-muted"> — {a.source}</span>
              </div>
            ))}
          </Section>

          {/* Linked Intelligence — disseminated intel reports naming this
              person. The dossier endpoint has shipped `linked_intel` since
              Wave 4 but the workspace never rendered it; the data was only
              visible from the Intel Reports list, never on the subject. */}
          {linkedIntel.length > 0 && (
            <Section title={`LINKED INTELLIGENCE (${linkedIntel.length})`}>
              {linkedIntel.map((r) => (
                <Link
                  key={r.id}
                  to={`/intel/reports/${r.id}`}
                  className="block py-[3px] border-b border-border-default last:border-b-0 hover:bg-surface-raised"
                >
                  <div className="flex items-baseline gap-2 text-[11px]">
                    <FileText className="w-3 h-3 text-brand-400 shrink-0" />
                    <span className="text-brand-400">{r.report_number || `IR-${r.id}`}</span>
                    {r.threat_level && (
                      <span className={`text-[9px] font-semibold ${THREAT_COLOR[r.threat_level] || 'text-fg-muted'}`}>
                        {r.threat_level.toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-rmpg-200 ml-5 truncate">{r.title}</div>
                  <div className="text-[9px] text-fg-muted ml-5">
                    {r.role || 'subject'}
                    {r.disseminated_at && ` · ${formatDate(r.disseminated_at)}`}
                    {r.handling_code && ` · ${r.handling_code}`}
                  </div>
                </Link>
              ))}
            </Section>
          )}
        </div>

        {/* Right column — timeline */}
        <Section title={`CONTACT TIMELINE (${data.timeline.length})`}>
          {data.timeline.length === 0 && <div className="text-[11px] text-fg-muted">No system contacts.</div>}
          {data.timeline.map((e) => (
            <div key={`${e.kind}:${e.id}`} className="flex items-baseline gap-2 text-[11px] py-[2px] border-b border-border-default last:border-b-0">
              <span className="text-fg-muted w-20 shrink-0">{formatDate(e.date)}</span>
              <span className={`w-28 shrink-0 text-[9px] font-semibold ${KIND_COLOR[e.kind] || 'text-fg-muted'}`}>
                {toDisplayLabel(e.kind).toUpperCase()}
              </span>
              <span className="text-rmpg-200">{e.title}</span>
              {e.status && <span className="text-fg-muted text-[9px]">({formatLabel(e.status)})</span>}
              {e.subtitle && <span className="text-fg-muted truncate">{e.subtitle}</span>}
            </div>
          ))}
        </Section>
      </div>

      {/* Photo full-size modal */}
      {photoOpen && real(p.photo_url) && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Subject photo"
          onClick={() => setPhotoOpen(false)}
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 cursor-zoom-out"
        >
          <div className="relative max-w-3xl max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <img src={p.photo_url} alt={name} className="max-w-full max-h-[90vh] object-contain border border-border-default" />
            <button
              type="button"
              onClick={() => setPhotoOpen(false)}
              aria-label="Close photo"
              className="absolute top-2 right-2 bg-surface-overlay border border-border-default p-1"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="mt-2 text-[10px] text-fg-muted text-center">{name} — press Esc to close</div>
          </div>
        </div>
      )}
    </div>
  );
}
