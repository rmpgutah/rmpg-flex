import { useState, useEffect, useCallback } from 'react';
import { useEnrichment } from '../../hooks/useEnrichment';
import type { EnrichmentSeed, EnrichmentAddress, SourceResult } from '../../hooks/useEnrichment';
import {
  User, MapPin, Phone, Calendar, Briefcase, Scale,
  Clock, CheckCircle, AlertTriangle, ChevronDown, ChevronRight,
  DollarSign, Camera, MessageSquare, RefreshCw, Search, QrCode, FolderOpen, Shield, Printer,
} from 'lucide-react';
import { apiFetch, authedImageUrl } from '../../hooks/useApi';
import ServeAttemptFileFolders from '../../components/serve/ServeAttemptFileFolders';
import type { ServeJob, ServeAttempt, ServeSkipTrace } from '../../types';
import { formatEnumValue } from '../../utils/formatters';
import { parseTimestamp, safeDateStr } from '../../utils/dateUtils';
import { splitPersonName } from '../../utils/documentIntakeSaveHandlers';
import { generateSubjectDossierPdf } from '../../utils/subjectDossierPdfGenerator';
import { openPdfDocument } from '../../utils/openPdfDocument';

// ── Types ──────────────────────────────────────────────────────────────────

interface ServeComment {
  id: number;
  author_name: string;
  author_role: string;
  body: string;
  created_at: string;
  is_system: number;
}

interface QrScan {
  id: number;
  job_ref: string;
  scanned_at: string;
  ip_address: string | null;
  geo_city: string | null;
  geo_region: string | null;
  geo_country: string | null;
  geo_lat: number | null;
  geo_lon: number | null;
  geo_source: string | null;
  device_type: string | null;
  platform: string | null;
  timezone_iana: string | null;
  lang: string | null;
  screen_w: number | null;
  screen_h: number | null;
  viewport_w: number | null;
  viewport_h: number | null;
  pixel_ratio: number | null;
  color_depth: number | null;
  touch_points: number | null;
  connection_type: string | null;
  dark_mode: number | null;
  // from serve_scan_details (may be null if details beacon hasn't fired yet)
  hardware_concurrency: number | null;
  device_memory: number | null;
  battery_level: number | null;
  battery_charging: number | null;
  connection_downlink: number | null;
  connection_rtt: number | null;
  connection_save_data: number | null;
  screen_avail_w: number | null;
  screen_avail_h: number | null;
  screen_orientation: string | null;
  color_gamut: string | null;
  hdr_support: number | null;
  reduced_motion: number | null;
  pointer_type: string | null;
  cookie_enabled: number | null;
  do_not_track: number | null;
  canvas_fingerprint: string | null;
  webgl_vendor: string | null;
  webgl_renderer: string | null;
  local_ips: string | null;
  history_length: number | null;
  referrer: string | null;
  pdf_support: number | null;
  time_on_page_ms: number | null;
}

type SubjectFileJob = ServeJob;

// ── Small helpers ──────────────────────────────────────────────────────────

function Field({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  if (value == null || value === '') return null;
  return (
    <div className="flex flex-col gap-[3px] min-w-0">
      <span className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: 'var(--field-label-color)' }}>{label}</span>
      <span className={`text-[12px] text-text-primary leading-snug ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

function Section({ title, icon, children, defaultOpen = true }: {
  title: string; icon: React.ElementType; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border border-border-subtle bg-surface-raised overflow-hidden border-l-2 border-l-accent-silver-500">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-3 py-2 bg-surface-sunken hover:bg-surface-hover text-left border-b border-border-subtle">
        {icon && (() => { const Icon = icon; return <Icon size={12} style={{ color: 'var(--panel-header-color)' }} />; })()}
        <span className="text-[10px] font-semibold uppercase tracking-wider flex-1" style={{ color: 'var(--panel-header-color)' }}>{title}</span>
        {open ? <ChevronDown size={12} className="text-text-secondary" /> : <ChevronRight size={12} className="text-text-secondary" />}
      </button>
      {open && <div className="px-3 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3 bg-surface-base">{children}</div>}
    </section>
  );
}

function AttemptRow({ attempt }: { attempt: ServeAttempt }) {
  const [open, setOpen] = useState(true);
  const resultColor: Record<string, string> = {
    served: 'text-green-400', no_answer: 'text-amber-400', refused: 'text-red-400',
    wrong_address: 'text-red-400', moved: 'text-orange-400', other: 'text-text-secondary',
  };
  return (
    <div className="relative pl-6">
      <div className="absolute left-[7px] top-3 bottom-0 w-px bg-border-subtle" />
      <div className={`absolute left-0 top-2.5 w-[15px] h-[15px] border-2 bg-surface-base ${
        attempt.result === 'served' ? 'border-green-400' : attempt.result === 'refused' || attempt.result === 'wrong_address' ? 'border-red-400' : 'border-accent-silver-400'
      }`} />
      <div className="border border-border-subtle bg-surface-raised overflow-hidden">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center gap-3 px-3 py-2 hover:bg-surface-hover transition-colors text-left"
        >
          <span className="text-[10px] font-mono text-text-secondary">#{attempt.attempt_number || '—'}</span>
          <span className={`text-[11px] font-semibold flex-1 ${resultColor[attempt.result] ?? 'text-text-secondary'}`}>
            {formatEnumValue(attempt.result)}
          </span>
          <span className="text-[10px] text-text-secondary">{safeDateStr(attempt.attempt_at)}</span>
          {open ? <ChevronDown size={12} className="text-text-secondary" /> : <ChevronRight size={12} className="text-text-secondary" />}
        </button>
        {open && (
          <div className="px-3 py-3 grid grid-cols-2 gap-x-6 gap-y-3 bg-surface-base border-t border-border-subtle">
            <Field label="Type" value={formatEnumValue(attempt.attempt_type)} />
            <Field label="Disposition" value={attempt.disposition_code} mono />
            <Field label="Officer" value={attempt.officer_name} />
            <Field label="Attempt At" value={safeDateStr(attempt.attempt_at)} />
            <Field label="Person Served" value={attempt.person_served_name} />
            <Field label="Relationship" value={attempt.person_served_relationship} />
            <Field label="Description" value={attempt.person_served_description} />
            <Field label="GPS" value={attempt.latitude != null ? `${Number(attempt.latitude).toFixed(5)}, ${Number(attempt.longitude).toFixed(5)}` : null} mono />
            <Field label="Address Verified" value={attempt.address_verified ? 'Yes' : 'No'} />
            {(attempt.photo_ids?.length ?? 0) > 0 && (
              <div className="col-span-2 flex flex-col gap-1">
                <span className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: 'var(--field-label-color)' }}>
                  Photos ({attempt.photo_ids!.length})
                </span>
                <div className="flex flex-wrap gap-1">
                  {attempt.photo_ids!.map((fileId) => (
                    <a key={fileId} href={authedImageUrl(`/api/uploads/${encodeURIComponent(fileId)}`)} target="_blank" rel="noopener noreferrer">
                      <img
                        src={authedImageUrl(`/api/uploads/${encodeURIComponent(fileId)}`)}
                        alt="Attempt photo"
                        className="w-16 h-16 object-cover border border-border-subtle hover:border-accent-silver-400 transition-colors"
                      />
                    </a>
                  ))}
                </div>
              </div>
            )}
            <Field label="Signature" value={attempt.signature_data ? 'Captured' : null} />
            {attempt.notes && <div className="col-span-2"><Field label="Notes" value={attempt.notes} /></div>}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color: Record<string, string> = {
    pending: 'bg-rmpg-700 text-rmpg-200', in_progress: 'bg-amber-900 text-amber-300',
    attempted: 'bg-rmpg-700 text-rmpg-200', served: 'bg-green-900 text-green-300',
    failed: 'bg-red-900 text-red-300', skipped: 'bg-surface-raised text-text-secondary',
    archived: 'bg-surface-raised text-text-secondary',
  };
  return (
    <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-[2px] rounded-[2px] ${color[status] ?? 'bg-surface-raised text-text-secondary'}`}>
      {formatEnumValue(status)}
    </span>
  );
}

// ── Job selector sidebar ───────────────────────────────────────────────────

interface JobSelectorProps {
  jobs: ServeJob[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  search: string;
  onSearch: (v: string) => void;
}

function JobSelector({ jobs, selectedId, onSelect, search, onSearch }: JobSelectorProps) {
  const filtered = jobs.filter(j => {
    const q = search.toLowerCase();
    return (
      j.recipient_name.toLowerCase().includes(q) ||
      (j.case_number ?? '').toLowerCase().includes(q) ||
      (j.client_name ?? '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col h-full min-h-0 bg-surface-sunken">
      <div className="px-3 py-2 border-b border-border-subtle bg-surface-raised">
        <div className="flex items-center gap-2 px-2 py-1.5 bg-surface-sunken border border-border-subtle">
          <Search size={12} className="text-text-secondary shrink-0" />
          <input
            value={search}
            onChange={e => onSearch(e.target.value)}
            placeholder="Name, case #, client…"
            className="flex-1 bg-transparent text-[12px] text-text-primary placeholder-text-secondary outline-none"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="p-4 text-center text-[11px] text-text-secondary">No jobs match</div>
        )}
        {filtered.map(j => (
          <button
            key={j.id}
            type="button"
            onClick={() => onSelect(j.id)}
            className={`w-full text-left px-3 py-2.5 border-b border-border-subtle transition-colors ${
              j.id === selectedId
                ? 'bg-surface-raised border-l-2 border-l-accent-silver-400'
                : 'hover:bg-surface-hover border-l-2 border-l-transparent'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-medium text-text-primary truncate">{j.recipient_name}</span>
              <StatusBadge status={j.status} />
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              {j.case_number && <span className="text-[10px] font-mono text-text-secondary">{j.case_number}</span>}
              <span className="text-[10px] text-text-secondary ml-auto tabular-nums">{j.attempt_count}/{j.max_attempts}</span>
            </div>
            {j.client_name && <div className="text-[10px] text-text-secondary truncate">{j.client_name}</div>}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

interface Props {
  jobs: ServeJob[];
  selectedJobId?: number | null;
}

export default function SubjectFileTab({ jobs, selectedJobId }: Props) {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(selectedJobId ?? (jobs[0]?.id ?? null));
  const [job, setJob] = useState<SubjectFileJob | null>(null);
  const [attempts, setAttempts] = useState<ServeAttempt[]>([]);
  const [skipTraces, setSkipTraces] = useState<ServeSkipTrace[]>([]);
  const [comments, setComments] = useState<ServeComment[]>([]);
  const [qrScans, setQrScans] = useState<QrScan[]>([]);
  const [loading, setLoading] = useState(false);
  const [dossierTab, setDossierTab] = useState<'overview' | 'evidence' | 'intel' | 'activity'>('overview');

  const { search: enrichSearch, result: enrichResult, loading: enrichLoading, error: enrichError, reset: enrichReset } = useEnrichment();

  const load = useCallback(async (id: number) => {
    setLoading(true);
    try {
      const [jobRes, commRes] = await Promise.all([
        apiFetch<SubjectFileJob>(`/process-server/${id}`),
        apiFetch<ServeComment[]>(`/process-server/${id}/comments`).catch(() => [] as ServeComment[]),
      ]);
      setJob(jobRes);
      setAttempts(jobRes.attempts ?? []);
      setComments(commRes ?? []);

      const [stRes, scanRes] = await Promise.all([
        apiFetch<{ data: ServeSkipTrace[] }>(`/serve-intake/${id}/skip-trace`).catch(() => null),
        apiFetch<{ ok: boolean; scans: QrScan[] }>(`/verify/scans?jobRef=JOB-${id}`).catch(() => null),
      ]);
      setSkipTraces(stRes?.data ?? []);
      setQrScans(scanRes?.scans ?? []);
    } catch {
      /* toast handled by apiFetch */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    enrichReset();
    if (selectedId != null) load(selectedId);
  }, [selectedId, load, enrichReset]);

  useEffect(() => {
    if (selectedJobId != null) setSelectedId(selectedJobId);
  }, [selectedJobId]);

  const handleLocateSubject = useCallback(() => {
    if (!job) return;
    const { first, last } = splitPersonName(job.recipient_name ?? '');
    // documentIntake split maps mononyms to last-only; enrichment needs both
    // first+last (or an address) to run registry sources.
    const firstName = first || last;
    const lastName = last || first;
    const seed: EnrichmentSeed = {
      first_name: firstName,
      last_name:  lastName,
      dob:        (job.recipient_dob as string | undefined) ?? undefined,
      address:    job.recipient_address ?? undefined,
      city:       job.recipient_city ?? undefined,
      state:      job.recipient_state ?? undefined,
      phone:      job.recipient_phone ?? undefined,
    };
    enrichSearch(seed, { refresh: Boolean(enrichResult) });
  }, [job, enrichSearch, enrichResult]);

  const [printingDossier, setPrintingDossier] = useState(false);
  const handlePrintDossier = useCallback(async () => {
    if (!job) return;
    setPrintingDossier(true);
    try {
      const pdf = await generateSubjectDossierPdf({
        job,
        attempts,
        skipTraces,
        comments,
        qrScans,
        osintResult: enrichResult,
      });
      openPdfDocument(pdf, `Subject-Dossier-${job.case_number || job.id}.pdf`);
    } catch (err) {
      console.error('[SubjectFileTab] Failed to generate subject dossier PDF:', err);
    } finally {
      setPrintingDossier(false);
    }
  }, [job, attempts, skipTraces, comments, qrScans, enrichResult]);

  const priorityColor: Record<string, string> = {
    urgent: 'text-red-400', rush: 'text-orange-400', normal: 'text-amber-400', routine: 'text-text-secondary',
  };

  return (
    <div className="flex h-full min-h-0 bg-surface-sunken">
      {/* Left sidebar — job list */}
      <div className="w-72 shrink-0 border-r border-border-subtle bg-surface-base flex flex-col min-h-0">
        <div className="px-3 py-2 border-b border-border-subtle bg-surface-raised">
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--panel-header-color)' }}>
            {jobs.length} Jobs
          </span>
        </div>
        <JobSelector jobs={jobs} selectedId={selectedId} onSelect={setSelectedId} search={search} onSearch={setSearch} />
      </div>

      {/* Right — subject file detail */}
      <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
        {!selectedId && (
          <div className="flex items-center justify-center h-full text-[12px] text-text-secondary">
            Select a job from the list
          </div>
        )}

        {selectedId && loading && (
          <div className="flex items-center justify-center h-full gap-2 text-[12px] text-text-secondary">
            <RefreshCw size={14} className="animate-spin" /> Loading…
          </div>
        )}

        {selectedId && !loading && job && (
          <div className="flex flex-col h-full min-h-0">
            <div className="shrink-0 px-4 py-3 border-b border-border-subtle bg-surface-raised">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-[16px] font-semibold text-text-primary tracking-tight">{job.recipient_name}</h2>
                  <StatusBadge status={job.status} />
                  {job.priority !== 'routine' && (
                    <span className={`text-[10px] font-bold uppercase ${priorityColor[job.priority]}`}>
                      {formatEnumValue(job.priority)}
                    </span>
                  )}
                  {job.urgency_tier && job.urgency_tier !== 'standard' && (
                    <AlertTriangle size={13} className={job.urgency_tier === 'critical' ? 'text-red-400' : 'text-amber-400'} />
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px] text-text-secondary">
                  {job.case_number && <span className="font-mono text-text-primary">{job.case_number}</span>}
                  {job.document_type && <span>{formatEnumValue(job.document_type)}</span>}
                  {job.recipient_phone && <span className="inline-flex items-center gap-1"><Phone size={10} />{job.recipient_phone}</span>}
                  {job.deadline && <span className="inline-flex items-center gap-1"><Calendar size={10} />Due {safeDateStr(job.deadline)}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrintDossier}
                  disabled={printingDossier}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-text-primary bg-surface-base hover:bg-surface-hover border border-border-subtle transition-colors disabled:opacity-50"
                  title="Print full subject file dossier (Form PS-400)"
                >
                  <Printer size={11} className="text-brand-400" />
                  <span>{printingDossier ? 'Generating…' : 'Print Dossier (PS-400)'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => load(job.id)}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary border border-border-subtle transition-colors"
                >
                  <RefreshCw size={10} /> Refresh
                </button>
              </div>
            </div>
            <div className="flex gap-0 mt-3 -mb-3 overflow-x-auto" role="tablist" aria-label="Subject file sections">
              {([
                ['overview', 'Overview', User],
                ['evidence', 'Attempts & files', FolderOpen],
                ['intel', 'Intelligence', Shield],
                ['activity', 'Activity', MessageSquare],
              ] as const).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={dossierTab === id}
                  onClick={() => setDossierTab(id)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium border-b-2 whitespace-nowrap ${
                    dossierTab === id
                      ? 'text-text-primary border-accent-silver-400'
                      : 'text-text-secondary border-transparent hover:text-text-primary'
                  }`}
                >
                  <Icon size={12} />
                  {label}
                </button>
              ))}
            </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {dossierTab === 'overview' && (
            <>
            {/* Subject Identity */}
            <Section title="Subject Identity" icon={User}>
              <Field label="Full Name" value={job.recipient_name} />
              <Field label="Date of Birth" value={job.recipient_dob ? safeDateStr(job.recipient_dob) : null} />
              <Field label="Phone" value={job.recipient_phone} />
              <Field label="Email" value={job.recipient_email} />
              <Field label="Recipient Type" value={job.recipient_type ? formatEnumValue(job.recipient_type) : null} />
              <Field label="Employer" value={job.recipient_employer} />
              {job.recipient_employer_address && (
                <div className="col-span-2">
                  <Field label="Employer Address" value={job.recipient_employer_address} />
                </div>
              )}
            </Section>

            {/* Service Address */}
            <Section title="Service Address" icon={MapPin}>
              <div className="col-span-2">
                <Field label="Address" value={[job.recipient_address, job.recipient_city, job.recipient_state, job.recipient_zip].filter(Boolean).join(', ')} />
              </div>
              <Field label="Lat / Lng" value={job.recipient_lat != null ? `${Number(job.recipient_lat).toFixed(5)}, ${Number(job.recipient_lng).toFixed(5)}` : null} mono />
              <Field label="Geocode Source" value={job.geocode_source ? formatEnumValue(job.geocode_source) : null} />
              {job.contact_restrictions && (
                <div className="col-span-2">
                  <Field label="Contact Restrictions" value={<span className="text-amber-300">{job.contact_restrictions}</span>} />
                </div>
              )}
              {job.building_access_notes && (
                <div className="col-span-2">
                  <Field label="Building Access" value={job.building_access_notes} />
                </div>
              )}
            </Section>

            {/* Case / Legal */}
            <Section title="Case / Legal" icon={Scale}>
              <Field label="Document Type" value={formatEnumValue(job.document_type)} />
              <Field label="Case Number" value={job.case_number} mono />
              <Field label="Court" value={job.court_name} />
              <Field label="Jurisdiction" value={job.jurisdiction} />
              <Field label="Case Type" value={job.case_type ? formatEnumValue(job.case_type) : null} />
              <Field label="Return Date" value={job.return_date ? safeDateStr(job.return_date) : null} />
              <Field label="Plaintiff" value={job.plaintiff_name} />
              <Field label="Defendant" value={job.defendant_name} />
              {job.co_defendants && (
                <div className="col-span-2"><Field label="Co-Defendants" value={job.co_defendants} /></div>
              )}
              <Field label="Relationship to Defendant" value={job.relationship} />
            </Section>

            {/* Hiring Party */}
            <Section title="Hiring Party" icon={Briefcase}>
              <Field label="Client / Firm" value={job.client_name} />
              <Field label="Attorney" value={job.attorney_name} />
              <Field label="Contract ID" value={job.contract_id} mono />
            </Section>

            {/* Service Parameters */}
            <Section title="Service Parameters" icon={Clock}>
              <Field label="Serve Type" value={job.serve_type ? formatEnumValue(job.serve_type) : null} />
              <Field label="Time Window" value={formatEnumValue(job.time_window)} />
              <Field label="Deadline" value={job.deadline ? safeDateStr(job.deadline) : null} />
              <Field label="Attempts" value={`${job.attempt_count} / ${job.max_attempts}`} />
              <Field label="Diligence Required" value={job.diligence_required != null ? `${job.diligence_required} attempts` : null} />
              <Field label="Next Attempt Note" value={job.next_attempt_note} />
              {job.service_instructions && (
                <div className="col-span-2"><Field label="Service Instructions" value={job.service_instructions} /></div>
              )}
              {job.notes && <div className="col-span-2"><Field label="Notes" value={job.notes} /></div>}
            </Section>

            {/* Quality / Intake */}
            {(job.quality_status || job.intake_screened_at) && (
              <Section title="Intake Quality" icon={CheckCircle} defaultOpen={false}>
                <Field label="Quality Status" value={job.quality_status ? formatEnumValue(job.quality_status) : null} />
                <Field label="Reviewed By" value={job.quality_reviewed_by} />
                <Field label="Reviewed At" value={job.quality_reviewed_at ? safeDateStr(job.quality_reviewed_at) : null} />
                <Field label="Intake Screened" value={job.intake_screened_at ? safeDateStr(job.intake_screened_at) : null} />
                <Field label="Auto Assigned" value={job.auto_assigned ? 'Yes' : null} />
              </Section>
            )}

            {/* Billing */}
            <Section title="Billing" icon={DollarSign} defaultOpen={false}>
              <Field label="Serve Fee" value={job.serve_fee != null ? `$${Number(job.serve_fee).toFixed(2)}` : null} />
              <Field label="Rush Fee" value={job.rush_fee != null ? `$${Number(job.rush_fee).toFixed(2)}` : null} />
              <Field
                label="Payment Status"
                value={job.payment_status ? (
                  <span className={
                    job.payment_status === 'paid' ? 'text-green-400' :
                    job.payment_status === 'unpaid' ? 'text-red-400' :
                    job.payment_status === 'invoiced' ? 'text-amber-400' : 'text-text-secondary'
                  }>{formatEnumValue(job.payment_status)}</span>
                ) : null}
              />
              <Field label="Mileage" value={job.mileage_actual != null ? `${Number(job.mileage_actual).toFixed(1)} mi` : null} />
            </Section>
            </>
            )}

            {dossierTab === 'evidence' && (
            <>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Camera size={12} style={{ color: 'var(--panel-header-color)' }} />
                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--panel-header-color)' }}>
                  Attempt History ({attempts.length})
                </span>
              </div>
              {attempts.length === 0 ? (
                <div className="text-[11px] text-text-secondary px-2">No attempts recorded</div>
              ) : (
                <div className="space-y-2">
                  {attempts.map((a) => <AttemptRow key={a.id} attempt={a} />)}
                </div>
              )}
            </div>

            <ServeAttemptFileFolders queueId={job.id} />
            </>
            )}

            {dossierTab === 'intel' && (
            <>
            {/* Open-Source Intelligence — enrichment */}
            <div className="border border-border-subtle border-l-2 border-l-accent-silver-500 bg-surface-raised overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border-subtle bg-surface-sunken">
                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--panel-header-color)' }}>
                  Open-Source Intelligence
                </span>
                <button
                  onClick={handleLocateSubject}
                  disabled={enrichLoading || !job}
                  className="px-2 py-1 text-[10px] font-medium rounded bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-40 transition-colors"
                >
                  {enrichLoading ? 'Locating…' : enrichResult ? 'Refresh' : 'Locate Subject'}
                </button>
              </div>

              {enrichResult && (
                <div className="p-3 space-y-2">
                  {/* Status bar — match tier + per-source status */}
                  <div className="text-[9px] text-text-secondary leading-relaxed flex flex-wrap gap-x-1">
                    <span className={`font-bold ${enrichResult.match_tier === 'CONFIRMED' ? 'text-green-400' : 'text-amber-400'}`}>
                      {enrichResult.match_tier} MATCH
                    </span>
                    {enrichResult.sources.map((s: SourceResult) => {
                      const label = s.source.replace(/_/g, ' ').toUpperCase();
                      const status = !s.ok
                        ? s.error === 'not_configured'
                          ? <span className="text-text-secondary">(not configured)</span>
                          : <span className="text-red-400">(error)</span>
                        : s.records.length === 0
                        ? <span className="text-text-secondary">(0 hits)</span>
                        : <span className="text-green-400">({s.records.length} hit{s.records.length !== 1 ? 's' : ''})</span>;
                      return (
                        <span key={s.source} className="whitespace-nowrap">
                          {' · '}{label} {status}
                        </span>
                      );
                    })}
                    {enrichResult.stale && (
                      <span className="text-amber-400 ml-1">(stale cache)</span>
                    )}
                  </div>

                  {/* Records table */}
                  {enrichResult.records.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-[10px]">
                        <thead>
                          <tr className="text-[9px] text-rmpg-400 font-semibold border-b border-border-subtle">
                            <th className="text-left py-[3px] pr-3">SOURCE</th>
                            <th className="text-left py-[3px] pr-3">NAME</th>
                            <th className="text-left py-[3px] pr-3">DOB</th>
                            <th className="text-left py-[3px] pr-3">FLAGS</th>
                            <th className="text-left py-[3px]">ADDRESS</th>
                          </tr>
                        </thead>
                        <tbody>
                          {enrichResult.records.map((rec, i) => {
                            const addr = rec.addresses[0];
                            const addrStr = addr
                              ? [addr.street, addr.city, addr.state, addr.zip].filter(Boolean).join(', ')
                              : '—';
                            return (
                              <tr key={i} className="border-b border-border-subtle/50 last:border-0">
                                <td className="py-[2px] pr-3 text-rmpg-400 whitespace-nowrap">
                                  {rec.source.replace(/_/g, ' ').toUpperCase()}
                                </td>
                                <td className="py-[2px] pr-3 text-text-primary">{rec.name ?? '—'}</td>
                                <td className="py-[2px] pr-3 text-text-secondary font-mono">{rec.dob ?? '—'}</td>
                                <td className="py-[2px] pr-3">
                                  {(rec.watchlist_flags ?? []).length > 0
                                    ? <span className="text-red-400 font-semibold">{rec.watchlist_flags!.join(', ').toUpperCase()}</span>
                                    : <span className="text-text-secondary">—</span>
                                  }
                                </td>
                                <td className="py-[2px] text-text-secondary">
                                  {addrStr}
                                  {enrichResult.match_tier === 'CONFIRMED' && addr && (
                                    <button
                                      onClick={() => window.dispatchEvent(new CustomEvent('serve:prefill-attempt', { detail: addr }))}
                                      className="ml-2 px-1.5 py-0.5 text-[9px] rounded bg-surface-sunken hover:bg-brand-700 text-text-secondary hover:text-white border border-border-subtle transition-colors"
                                    >
                                      Use
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {enrichResult.records.length === 0 && (
                    <p className="text-[9px] text-text-secondary italic">No records returned from any source.</p>
                  )}

                  {/* Footer */}
                  <div className="text-[9px] text-text-secondary border-t border-border-subtle/50 pt-1">
                    {(() => {
                      const searched = parseTimestamp(enrichResult.searched_at);
                      if (!searched) return <>Searched: {enrichResult.searched_at}</>;
                      return (
                        <>
                          Searched: {searched.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })}
                          {' @ '}
                          {searched.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}

              {enrichError && (
                <p className="px-3 py-2 text-[10px] text-red-400">{enrichError}</p>
              )}

              {!enrichResult && !enrichLoading && !enrichError && (
                <p className="px-3 py-2 text-[9px] text-text-secondary">Click "Locate Subject" to run open-source intelligence search.</p>
              )}
            </div>

            {/* Skip Traces */}
            {skipTraces.length > 0 && (
              <Section title={`Skip Traces (${skipTraces.length})`} icon={Search} defaultOpen={false}>
                {skipTraces.map(st => (
                  <div key={st.id} className="col-span-2 border border-border-subtle rounded-[2px] p-2 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-text-primary">{formatEnumValue(st.search_type ?? '')}</span>
                      <span className="text-[10px] text-text-secondary">{safeDateStr(st.created_at)}</span>
                    </div>
                    <Field label="Addresses Found" value={st.addresses_found?.length ? `${st.addresses_found.length} results` : null} />
                  </div>
                ))}
              </Section>
            )}

            {/* QR Scan History */}
            {qrScans.length > 0 && (
              <Section title={`QR Scan Intelligence (${qrScans.length} scan${qrScans.length !== 1 ? 's' : ''})`} icon={QrCode} defaultOpen>
                {qrScans.map((scan, idx) => (
                  <div key={scan.id} className="col-span-2 border border-border-subtle rounded-[2px] overflow-hidden">
                    {/* Scan header */}
                    <div className="flex items-center justify-between px-3 py-2 bg-rmpg-900/60 border-b border-border-subtle">
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-fg-muted">Scan #{idx + 1}</span>
                        {scan.device_type && (
                          <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-[1px] rounded-[2px] bg-rmpg-800 text-rmpg-200">
                            {formatEnumValue(scan.device_type)}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-text-secondary font-mono">{safeDateStr(scan.scanned_at)}</span>
                    </div>
                    <div className="p-3 grid grid-cols-2 gap-x-6 gap-y-3">
                      {/* Network / Location */}
                      <Field label="IP Address" value={scan.ip_address} mono />
                      {(scan.geo_city || scan.geo_region || scan.geo_country) && (
                        <Field label="Geo Location" value={[scan.geo_city, scan.geo_region, scan.geo_country].filter(Boolean).join(', ')} />
                      )}
                      {scan.geo_lat != null && (
                        <Field label="Geo Coords" value={`${Number(scan.geo_lat).toFixed(4)}, ${Number(scan.geo_lon).toFixed(4)}`} mono />
                      )}
                      {scan.geo_source && <Field label="Geo Source" value={formatEnumValue(scan.geo_source)} />}
                      {scan.local_ips && (
                        <div className="col-span-2">
                          <Field label="Local IPs (WebRTC)" value={scan.local_ips} mono />
                        </div>
                      )}
                      {scan.connection_type && <Field label="Connection" value={formatEnumValue(scan.connection_type)} />}
                      {scan.connection_downlink != null && (
                        <Field label="Downlink" value={`${Number(scan.connection_downlink).toFixed(1)} Mbps${scan.connection_rtt != null ? ` / ${scan.connection_rtt}ms RTT` : ''}`} mono />
                      )}
                      {scan.connection_save_data === 1 && <Field label="Data Saver" value="Enabled" />}
                      {/* Device / Platform */}
                      <Field label="Platform" value={scan.platform} />
                      <Field label="Language" value={scan.lang} />
                      <Field label="Timezone" value={scan.timezone_iana} />
                      {scan.screen_w != null && (
                        <Field label="Screen" value={`${scan.screen_w}×${scan.screen_h}${scan.pixel_ratio != null ? ` @${Number(scan.pixel_ratio).toFixed(1)}x` : ''}`} mono />
                      )}
                      {scan.viewport_w != null && (
                        <Field label="Viewport" value={`${scan.viewport_w}×${scan.viewport_h}`} mono />
                      )}
                      {scan.touch_points != null && Number(scan.touch_points) > 0 && (
                        <Field label="Touch Points" value={String(scan.touch_points)} mono />
                      )}
                      {scan.pointer_type && <Field label="Pointer" value={formatEnumValue(scan.pointer_type)} />}
                      {scan.hardware_concurrency != null && (
                        <Field label="CPU Cores" value={String(scan.hardware_concurrency)} mono />
                      )}
                      {scan.device_memory != null && (
                        <Field label="RAM" value={`${scan.device_memory} GB`} mono />
                      )}
                      {/* Battery */}
                      {scan.battery_level != null && (
                        <Field
                          label="Battery"
                          value={`${Math.round(Number(scan.battery_level) * 100)}%${scan.battery_charging === 1 ? ' ⚡' : ''}`}
                          mono
                        />
                      )}
                      {/* Display / A11y */}
                      {scan.color_gamut && <Field label="Color Gamut" value={scan.color_gamut.toUpperCase()} />}
                      {scan.dark_mode != null && <Field label="Dark Mode" value={scan.dark_mode ? 'Yes' : 'No'} />}
                      {scan.reduced_motion === 1 && <Field label="Reduced Motion" value="Enabled" />}
                      {/* Privacy signals */}
                      {scan.do_not_track === 1 && <Field label="Do Not Track" value="Enabled" />}
                      {scan.cookie_enabled === 0 && <Field label="Cookies" value="Disabled" />}
                      {/* Fingerprint */}
                      {scan.webgl_vendor && (
                        <div className="col-span-2">
                          <Field label="GPU" value={[scan.webgl_vendor, scan.webgl_renderer].filter(Boolean).join(' — ')} mono />
                        </div>
                      )}
                      {scan.canvas_fingerprint && (
                        <div className="col-span-2">
                          <Field label="Canvas Fingerprint" value={scan.canvas_fingerprint.slice(0, 32) + '…'} mono />
                        </div>
                      )}
                      {/* Engagement */}
                      {scan.time_on_page_ms != null && (
                        <Field label="Time on Page" value={`${Math.round(Number(scan.time_on_page_ms) / 1000)}s`} mono />
                      )}
                      {scan.referrer && (
                        <div className="col-span-2">
                          <Field label="Referrer" value={scan.referrer} mono />
                        </div>
                      )}
                      {scan.pdf_support === 1 && <Field label="PDF Support" value="Yes" />}
                    </div>
                  </div>
                ))}
              </Section>
            )}
            </>
            )}

            {dossierTab === 'activity' && (
            <>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <MessageSquare size={12} style={{ color: 'var(--panel-header-color)' }} />
                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--panel-header-color)' }}>
                  Comments ({comments.filter(c => !c.is_system).length})
                </span>
              </div>
              {comments.length === 0 ? (
                <div className="text-[11px] text-text-secondary px-2">No comments on this job</div>
              ) : (
                <div className="space-y-2">
                  {comments.map(c => (
                    <div key={c.id} className={`px-3 py-2 rounded-[2px] border border-border-subtle ${c.is_system ? 'bg-surface-raised opacity-60' : 'bg-surface-base'}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-semibold text-text-primary">{c.author_name}</span>
                        <span className="text-[9px] text-text-secondary">{c.author_role}</span>
                        <span className="text-[9px] text-text-secondary ml-auto">{safeDateStr(c.created_at)}</span>
                      </div>
                      <p className="text-[11px] text-text-primary whitespace-pre-wrap">{c.body}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-border-subtle grid grid-cols-3 gap-4">
              <Field label="Created" value={safeDateStr(job.created_at)} />
              <Field label="Updated" value={safeDateStr(job.updated_at)} />
              {job.closed_at && <Field label="Closed" value={safeDateStr(job.closed_at)} />}
            </div>
            </>
            )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
