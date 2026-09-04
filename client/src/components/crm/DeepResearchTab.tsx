// client/src/components/crm/DeepResearchTab.tsx
// Overwatch → Deep Research: launch a Firecrawl-powered deep research job,
// poll its async pipeline, and review trust-scored findings + a cited report.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Telescope, Loader2, RefreshCw, Trash2, ExternalLink, ShieldCheck, AlertTriangle,
  Search, Plus, X, CheckCircle, Eye,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useToast } from '../ToastProvider';
import PanelTitleBar from '../PanelTitleBar';
import ConfirmDialog from '../ConfirmDialog';
import { formatEnumValue } from '../../utils/formatters';

interface JobRow {
  id: string; subject: string; subject_type: string; status: string; progress: number;
  stage_detail: string | null; source_count: number; finding_count: number;
  monitor_interval_days: number | null; run_count: number; created_at: string;
}
interface Finding {
  id: number; finding_type: string; title: string; detail: string; confidence: number;
  trust: number; verdict: string; source_urls_json: string | null; status: string; is_delta: number;
}
interface SourceRow { id: number; url: string; title: string; description: string; angle: string; scraped: number }
interface JobDetail { job: JobRow & { report_md: string | null; error: string | null; angles_json: string | null }; sources: SourceRow[]; findings: Finding[] }

const SUBJECT_TYPES = ['person', 'business', 'address', 'vehicle', 'lead', 'competitor', 'topic'];
const ACTIVE = new Set(['queued', 'expanding', 'searching', 'scraping', 'extracting', 'verifying', 'synthesizing', 'monitoring']);

function TrustBadge({ trust, verdict }: { trust: number; verdict: string }) {
  const pct = Math.round(trust * 100);
  const cls = verdict === 'refuted' || trust < 0.4 ? 'text-red-400 border-red-700/50'
    : trust < 0.7 ? 'text-amber-400 border-amber-700/50' : 'text-emerald-400 border-emerald-700/50';
  return (
    <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 border tabular-nums ${cls}`} style={{ borderRadius: '2px' }}>
      {pct}% · {verdict}
    </span>
  );
}

export default function DeepResearchTab() {
  const { addToast } = useToast();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [subject, setSubject] = useState('');
  const [subjectType, setSubjectType] = useState('person');
  const [context, setContext] = useState('');
  const [seedAngles, setSeedAngles] = useState<string[]>([]);
  const [angleDraft, setAngleDraft] = useState('');
  const [monitorDays, setMonitorDays] = useState<number | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  // ConfirmDialog target — replaces the native window.confirm() that was
  // escaping the theme, blocking the polling loop, and rendering outside
  // the page's accessibility/focus contract.
  const [jobToDelete, setJobToDelete] = useState<JobRow | null>(null);
  const [deletingJob, setDeletingJob] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadJobs = useCallback(async () => {
    try { setJobs(await apiFetch<JobRow[]>('/deep-research/jobs')); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    apiFetch<{ configured: boolean }>('/deep-research/health').then((d) => setConfigured(d.configured)).catch(() => setConfigured(false));
    loadJobs();
  }, [loadJobs]);

  const loadDetail = useCallback(async (id: string) => {
    try { setDetail(await apiFetch<JobDetail>(`/deep-research/jobs/${id}`)); }
    catch (e) {
      // Job is gone (deleted, or not in this org). The poll loop's stop-condition
      // reads d.job.status, which a failed fetch never updates — so without this
      // the interval would re-poll a missing id forever (the 404 console spam).
      // Stop polling, drop the stale selection, and refresh the list.
      if ((e as { status?: number }).status === 404) {
        if (pollRef.current) clearInterval(pollRef.current);
        setActiveId((cur) => (cur === id ? null : cur));
        setDetail(null);
        loadJobs();
      }
      /* other errors (transient network) → ignore, next tick retries */
    }
  }, [loadJobs]);

  // Poll the active job while it's running.
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (!activeId) return;
    loadDetail(activeId);
    pollRef.current = setInterval(() => {
      loadDetail(activeId);
      setDetail((d) => {
        if (d && !ACTIVE.has(d.job.status)) { if (pollRef.current) clearInterval(pollRef.current); loadJobs(); }
        return d;
      });
    }, 2500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeId, loadDetail, loadJobs]);

  const addAngle = () => {
    const a = angleDraft.trim();
    if (a && !seedAngles.includes(a)) setSeedAngles([...seedAngles, a]);
    setAngleDraft('');
  };

  const submit = async () => {
    if (!subject.trim()) { addToast('Enter a subject', 'error'); return; }
    setSubmitting(true);
    try {
      const r = await apiFetch<{ id: string }>('/deep-research', {
        method: 'POST',
        body: JSON.stringify({
          subject: subject.trim(), subject_type: subjectType, context: context.trim(),
          seed_angles: seedAngles, monitor_interval_days: monitorDays || undefined,
        }),
      });
      addToast('Research started', 'success');
      setSubject(''); setContext(''); setSeedAngles([]); setMonitorDays('');
      setActiveId(r.id);
      loadJobs();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      addToast(msg.includes('503') ? 'Firecrawl not configured' : 'Failed to start research', 'error');
    } finally { setSubmitting(false); }
  };

  const confirmFinding = async (f: Finding) => {
    try { await apiFetch(`/deep-research/findings/${f.id}/confirm`, { method: 'POST', body: JSON.stringify({}) }); if (activeId) loadDetail(activeId); addToast('Finding confirmed', 'success'); }
    catch { addToast('Failed', 'error'); }
  };
  const dismissFinding = async (f: Finding) => {
    try { await apiFetch(`/deep-research/findings/${f.id}/dismiss`, { method: 'POST', body: JSON.stringify({}) }); if (activeId) loadDetail(activeId); }
    catch { addToast('Failed', 'error'); }
  };
  const rerun = async (id: string) => {
    try { await apiFetch(`/deep-research/jobs/${id}/rerun`, { method: 'POST', body: JSON.stringify({}) }); setActiveId(id); addToast('Re-running', 'success'); }
    catch { addToast('Failed', 'error'); }
  };
  const confirmDeleteJob = useCallback(async () => {
    if (!jobToDelete) return;
    setDeletingJob(true);
    try {
      const id = jobToDelete.id;
      await apiFetch(`/deep-research/jobs/${id}`, { method: 'DELETE' });
      if (activeId === id) { setActiveId(null); setDetail(null); }
      loadJobs();
      addToast('Research job deleted', 'success');
      setJobToDelete(null);
    } catch {
      addToast('Failed to delete', 'error');
    } finally {
      setDeletingJob(false);
    }
  }, [jobToDelete, activeId, loadJobs, addToast]);

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="DEEP RESEARCH" icon={Telescope} />

      {configured === false && (
        <div className="flex items-center gap-2 text-amber-400 text-xs border border-amber-700/50 bg-amber-900/20 p-2" style={{ borderRadius: '2px' }}>
          <AlertTriangle className="w-4 h-4" /> Firecrawl is not configured — set FIRECRAWL_API_KEY to enable research.
        </div>
      )}

      {/* New research form */}
      <div className="bg-surface-raised border border-rmpg-700 p-3 space-y-2" style={{ borderRadius: '2px' }}>
        <div className="flex gap-2 flex-wrap">
          <input
            id="dr-subject" value={subject} onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject (name, business, address, plate, topic…)"
            className="flex-1 min-w-[220px] bg-surface-base border border-rmpg-700 text-rmpg-100 text-xs px-2 py-1.5" style={{ borderRadius: '2px' }} />
          <select value={subjectType} onChange={(e) => setSubjectType(e.target.value)}
            className="bg-surface-base border border-rmpg-700 text-rmpg-100 text-xs px-2 py-1.5" style={{ borderRadius: '2px' }}>
            {SUBJECT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <input value={context} onChange={(e) => setContext(e.target.value)} placeholder="Context / why you're researching (optional)"
          className="w-full bg-surface-base border border-rmpg-700 text-rmpg-100 text-xs px-2 py-1.5" style={{ borderRadius: '2px' }} />
        <div className="flex gap-2 items-center flex-wrap">
          <input value={angleDraft} onChange={(e) => setAngleDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAngle(); } }}
            placeholder="Add a seed angle (optional)" className="flex-1 min-w-[180px] bg-surface-base border border-rmpg-700 text-rmpg-100 text-xs px-2 py-1.5" style={{ borderRadius: '2px' }} />
          <button type="button" onClick={addAngle} aria-label="Add angle" className="text-rmpg-400 hover:text-rmpg-100"><Plus className="w-4 h-4" /></button>
          <label className="text-[10px] text-rmpg-400 flex items-center gap-1">Monitor every
            <input type="number" min={1} value={monitorDays} onChange={(e) => setMonitorDays(e.target.value ? Number(e.target.value) : '')}
              className="w-14 bg-surface-base border border-rmpg-700 text-rmpg-100 text-xs px-1 py-1 ml-1" style={{ borderRadius: '2px' }} /> days
          </label>
        </div>
        {seedAngles.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {seedAngles.map((a) => (
              <span key={a} className="text-[9px] bg-rmpg-800 text-rmpg-300 px-1.5 py-0.5 flex items-center gap-1" style={{ borderRadius: '2px' }}>
                {a}<button type="button" aria-label={`Remove ${a}`} onClick={() => setSeedAngles(seedAngles.filter((x) => x !== a))}><X className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
        )}
        <button type="button" onClick={submit} disabled={submitting || configured === false}
          className="flex items-center gap-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-rmpg-100 text-xs font-semibold px-3 py-1.5" style={{ borderRadius: '2px' }}>
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Start Deep Research
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Jobs list */}
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold text-rmpg-400 uppercase">Research Jobs</div>
          {jobs.length === 0 && <div className="text-[11px] text-fg-muted">No jobs yet.</div>}
          {jobs.map((j) => (
            <div key={j.id} onClick={() => setActiveId(j.id)}
              className={`cursor-pointer border p-2 ${activeId === j.id ? 'border-brand-500 bg-surface-raised' : 'border-rmpg-700 bg-surface-base'}`} style={{ borderRadius: '2px' }}>
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-rmpg-100 font-semibold truncate">{j.subject}</div>
                <span className="text-[8px] text-rmpg-400 uppercase">{formatEnumValue(j.subject_type)}</span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[9px] text-rmpg-400">{ACTIVE.has(j.status) ? `${j.stage_detail || j.status} (${j.progress}%)` : j.status}</span>
                <div className="flex items-center gap-1">
                  {j.monitor_interval_days ? <span className="text-[8px] text-rmpg-400 flex items-center gap-0.5"><Eye className="w-3 h-3" />{j.monitor_interval_days}d</span> : null}
                  <button type="button" aria-label="Re-run" onClick={(e) => { e.stopPropagation(); rerun(j.id); }} className="text-rmpg-400 hover:text-rmpg-100"><RefreshCw className="w-3 h-3" /></button>
                  <button type="button" aria-label="Delete" onClick={(e) => { e.stopPropagation(); setJobToDelete(j); }} className="text-rmpg-400 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Detail */}
        <div className="lg:col-span-2 space-y-3">
          {!detail && <div className="text-[11px] text-fg-muted">Select a job to view findings.</div>}
          {detail && (
            <>
              <div className="bg-surface-raised border border-rmpg-700 p-2" style={{ borderRadius: '2px' }}>
                <div className="flex items-center gap-2">
                  {ACTIVE.has(detail.job.status) && <Loader2 className="w-4 h-4 animate-spin text-brand-400" />}
                  <span className="text-xs text-rmpg-100 font-semibold">{detail.job.subject}</span>
                  <span className="text-[9px] text-rmpg-400 ml-auto">{detail.job.stage_detail || detail.job.status} · {detail.job.progress}%</span>
                </div>
                {detail.job.error && <div className="text-[10px] text-red-400 mt-1">{detail.job.error}</div>}
              </div>

              {/* Findings */}
              {detail.findings.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[10px] font-semibold text-rmpg-400 uppercase">Findings ({detail.findings.length})</div>
                  {detail.findings.map((f) => (
                    <div key={f.id} className={`border p-2 ${f.status === 'dismissed' ? 'opacity-50 border-rmpg-800' : 'border-rmpg-700'} bg-surface-base`} style={{ borderRadius: '2px' }}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[8px] uppercase text-fg-muted">{formatEnumValue(f.finding_type)}</span>
                        <TrustBadge trust={f.trust} verdict={f.verdict} />
                        {f.is_delta ? <span className="text-[8px] text-rmpg-400">NEW</span> : null}
                        <span className="text-xs text-rmpg-100 font-semibold">{f.title}</span>
                        {f.status !== 'dismissed' && (
                          <span className="ml-auto flex items-center gap-1">
                            <button type="button" aria-label="Confirm finding" onClick={() => confirmFinding(f)} className="text-emerald-400 hover:text-emerald-300"><CheckCircle className="w-3.5 h-3.5" /></button>
                            <button type="button" aria-label="Dismiss finding" onClick={() => dismissFinding(f)} className="text-rmpg-400 hover:text-red-400"><X className="w-3.5 h-3.5" /></button>
                          </span>
                        )}
                        {f.status === 'confirmed' && <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 ml-auto" />}
                      </div>
                      {f.detail && <div className="text-[11px] text-rmpg-300 mt-1">{f.detail}</div>}
                    </div>
                  ))}
                </div>
              )}

              {/* Report */}
              {detail.job.report_md && (
                <div className="bg-surface-raised border border-rmpg-700 p-3" style={{ borderRadius: '2px' }}>
                  <div className="text-[10px] font-semibold text-rmpg-400 uppercase mb-1">Report</div>
                  <pre className="text-[11px] text-rmpg-200 whitespace-pre-wrap font-sans">{detail.job.report_md}</pre>
                </div>
              )}

              {/* Sources */}
              {detail.sources.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] font-semibold text-rmpg-400 uppercase">Sources ({detail.sources.length})</div>
                  {detail.sources.map((s, i) => (
                    <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-[10px] text-rmpg-400 hover:text-rmpg-300 truncate">
                      <span className="text-fg-muted">[{i + 1}]</span><ExternalLink className="w-3 h-3 shrink-0" />
                      <span className="truncate">{s.title || s.url}</span>
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={jobToDelete !== null}
        onClose={() => { if (!deletingJob) setJobToDelete(null); }}
        onConfirm={confirmDeleteJob}
        title="Delete research job?"
        message="This permanently removes the job and all of its findings, sources, and report. Confirmed findings linked to entities elsewhere remain on those records."
        details={jobToDelete ? (
          <div className="mt-2 text-[11px] text-rmpg-300">
            <div><span className="text-fg-muted">Subject:</span> {jobToDelete.subject}</div>
            <div><span className="text-fg-muted">Type:</span> {formatEnumValue(jobToDelete.subject_type)}</div>
            <div><span className="text-fg-muted">Sources / Findings:</span> {jobToDelete.source_count} · {jobToDelete.finding_count}</div>
          </div>
        ) : undefined}
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={deletingJob}
      />
    </div>
  );
}
