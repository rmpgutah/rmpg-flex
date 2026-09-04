import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Search, Plus, X, Save, Loader2, Car, ChevronRight, ChevronLeft,
  FileText, Download, Copy,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';
import { apiFetch } from '../hooks/useApi';
import { toDisplayLabel } from '../utils/formatters';
import { crashReportsToCsv, downloadTextFile } from '../utils/rmsListExport';

// ── Types ──
interface CrashReport {
  id: number;
  report_number: string;
  crash_date: string;
  location: string;
  crash_type: string;
  severity: string;
  vehicles_involved: number;
  injuries: number;
  fatalities: number;
  status: string;
  narrative: string;
  weather_conditions: string;
  road_conditions: string;
  investigating_officer: string;
}

interface CrashStats {
  total: number;
  draft: number;
  pending_review: number;
  filed: number;
}

const CRASH_TYPES = ['vehicle_vehicle', 'vehicle_pedestrian', 'vehicle_bicycle', 'vehicle_fixed_object', 'rollover', 'rear_end', 'head_on', 'sideswipe', 'hit_and_run', 'other'];
const SEVERITY_LEVELS = ['property_damage_only', 'minor_injury', 'major_injury', 'fatal'];

const STATUS_COLORS: Record<string, string> = {
  draft: 'text-rmpg-400',
  pending_review: 'text-amber-400',
  approved: 'text-green-400',
  filed: 'text-blue-400',
  amended: 'text-purple-400',
};

const EMPTY_FORM_STEP1 = {
  crash_date: '', location: '', crash_type: 'vehicle_vehicle',
  severity: 'property_damage_only', weather_conditions: '', road_conditions: '',
};

const EMPTY_FORM_STEP2 = {
  vehicles_involved: '2', injuries: '0', fatalities: '0',
  investigating_officer: '', parties_description: '',
};

const EMPTY_FORM_STEP3 = {
  narrative: '',
};

export default function CrashReportsPage() {
  const [reports, setReports] = useState<CrashReport[]>([]);
  const [stats, setStats] = useState<CrashStats>({ total: 0, draft: 0, pending_review: 0, filed: 0 });
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [fatalFirst, setFatalFirst] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [selected, setSelected] = useState<CrashReport | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { mountedRef.current = false; if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);

  // ── Wizard state ──
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [step1, setStep1] = useState({ ...EMPTY_FORM_STEP1 });
  const [step2, setStep2] = useState({ ...EMPTY_FORM_STEP2 });
  const [step3, setStep3] = useState({ ...EMPTY_FORM_STEP3 });
  const [submitting, setSubmitting] = useState(false);

  // ── Fetch ──
  const fetchReports = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set('search', searchQuery);
      if (filterType) params.set('crash_type', filterType);
      if (filterSeverity) params.set('severity', filterSeverity);
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);
      const data = await apiFetch<{ data: CrashReport[]; stats: CrashStats }>(`/crash-reports?${params}`);
      setReports(data.data || []);
      setStats(data.stats || { total: 0, draft: 0, pending_review: 0, filed: 0 });
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load crash reports');
    }
    finally { setLoading(false); }
  }, [searchQuery, filterType, filterSeverity, dateFrom, dateTo]);

  useEffect(() => { fetchReports(); }, [fetchReports]);

  const openWizard = () => {
    setStep1({ ...EMPTY_FORM_STEP1 });
    setStep2({ ...EMPTY_FORM_STEP2 });
    setStep3({ ...EMPTY_FORM_STEP3 });
    setWizardStep(1);
    setWizardOpen(true);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await apiFetch('/crash-reports', {
        method: 'POST',
        body: JSON.stringify({
          ...step1, ...step2, ...step3,
          vehicles_involved: parseInt(step2.vehicles_involved) || 0,
          injuries: parseInt(step2.injuries) || 0,
          fatalities: parseInt(step2.fatalities) || 0,
        }),
      });
      setWizardOpen(false);
      setToast('Crash report filed');
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => { if (mountedRef.current) setToast(null); }, 3000);
      fetchReports();
    } catch (e: unknown) {
      setToast(e instanceof Error ? e.message : 'Failed to file report');
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => { if (mountedRef.current) setToast(null); }, 4000);
    }
    finally { setSubmitting(false); }
  };

  const STEPS = ['Crash Info', 'Parties / Vehicles', 'Narrative'];

  const visible = useMemo(() => {
    let rows = reports;
    if (filterStatus) rows = rows.filter((r) => r.status === filterStatus);
    if (fatalFirst) rows = [...rows].sort((a, b) => b.fatalities - a.fatalities || b.injuries - a.injuries);
    return rows;
  }, [reports, filterStatus, fatalFirst]);

  const filtersOn = Boolean(searchQuery || filterType || filterSeverity || dateFrom || dateTo || filterStatus);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.key === 'Escape') {
        if (wizardOpen) { setWizardOpen(false); return; }
        if (selected) { setSelected(null); return; }
      }
      if (typing) return;
      if (e.key === 'n' || e.key === 'N') openWizard();
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [wizardOpen, selected]);

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="CRASH / ACCIDENT REPORTS" icon={Car} />

      {toast && (
        <div className="text-[11px] px-3 py-2 border border-border-default bg-surface-raised text-rmpg-100">{toast}</div>
      )}
      {loadError && (
        <div className="text-[11px] px-3 py-2 border border-red-700/40 bg-red-900/20 text-red-400 flex items-center justify-between" role="alert">
          <span>{loadError}</span>
          <button type="button" onClick={fetchReports} className="underline">Retry</button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: stats.total, status: '' },
          { label: 'Draft', value: stats.draft, status: 'draft' },
          { label: 'Pending Review', value: stats.pending_review, status: 'pending_review' },
          { label: 'Filed', value: stats.filed, status: 'filed' },
        ].map(s => (
          <button
            type="button"
            key={s.label}
            onClick={() => setFilterStatus(filterStatus === s.status ? '' : s.status)}
            className={`bg-surface-raised border rounded-[2px] p-3 text-left ${filterStatus === s.status ? 'border-accent-silver-600' : 'border-border-default'}`}
          >
            <div className="text-lg font-bold text-white">{s.value}</div>
            <div className="text-[10px] text-rmpg-400 uppercase tracking-wider">{s.label}</div>
          </button>
        ))}
      </div>

      {/* Search + Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-accent-silver-500" />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search report #, location… (/ to focus)"
            aria-label="Search crash reports by number or location"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-surface-sunken border border-border-default rounded-[2px] text-white text-xs focus:border-accent-silver-600 outline-none"
          />
        </div>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="bg-surface-sunken border border-border-default rounded-[2px] px-2 py-1.5 text-white text-xs focus:border-accent-silver-600 outline-none">
          <option value="">All Types</option>
          {CRASH_TYPES.map(t => <option key={t} value={t}>{toDisplayLabel(t)}</option>)}
        </select>
        <select value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)}
          className="bg-surface-sunken border border-border-default rounded-[2px] px-2 py-1.5 text-white text-xs focus:border-accent-silver-600 outline-none">
          <option value="">All Severity</option>
          {SEVERITY_LEVELS.map(s => <option key={s} value={s}>{toDisplayLabel(s)}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="bg-surface-sunken border border-border-default rounded-[2px] px-2 py-1.5 text-white text-xs focus:border-accent-silver-600 outline-none" />
        <span className="text-rmpg-400 text-xs">to</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="bg-surface-sunken border border-border-default rounded-[2px] px-2 py-1.5 text-white text-xs focus:border-accent-silver-600 outline-none" />
        <label className="flex items-center gap-1 text-[10px] text-rmpg-400">
          <input type="checkbox" checked={fatalFirst} onChange={e => setFatalFirst(e.target.checked)} />
          Fatalities first
        </label>
        {filtersOn && (
          <button type="button" onClick={() => { setSearchQuery(''); setFilterType(''); setFilterSeverity(''); setDateFrom(''); setDateTo(''); setFilterStatus(''); }}
            className="text-[10px] px-2 py-1 border border-border-default rounded-[2px] text-rmpg-100">Clear</button>
        )}
        <button type="button" disabled={visible.length === 0}
          onClick={() => downloadTextFile('crash-reports.csv', crashReportsToCsv(visible))}
          className="flex items-center gap-1 px-2 py-1.5 text-xs border border-border-default rounded-[2px] text-rmpg-100 disabled:opacity-40">
          <Download className="w-3.5 h-3.5" /> CSV
        </button>
        <button onClick={openWizard}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-silver-500 text-black text-xs font-semibold rounded-[2px] hover:bg-accent-silver-400">
          <Plus className="w-3.5 h-3.5" /> New Report
        </button>
      </div>

      {/* Table */}
      <div className="bg-surface-raised border border-border-default rounded-[2px] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border-subtle">
                {['Report #', 'Date', 'Location', 'Type', 'Severity', 'Vehicles', 'Injuries', 'Fatalities', 'Status'].map(h => (
                  <th key={h} className="text-left px-3 py-[3px] text-[9px] font-semibold text-rmpg-400 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-8 text-rmpg-400"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8 text-rmpg-400">
                  {reports.length === 0 ? 'No crash reports found' : 'Filters hid every report'}
                </td></tr>
              ) : visible.map(report => (
                <tr key={report.id} onClick={() => setSelected(report)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(report); } }} tabIndex={0} role="row" aria-selected={selected?.id === report.id} className={`border-b border-border-subtle hover:bg-surface-hover cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent-silver-500 ${selected?.id === report.id ? 'bg-surface-hover' : ''}`}>
                  <td className="px-3 py-[2px] text-rmpg-100 font-mono">{report.report_number}</td>
                  <td className="px-3 py-[2px] text-rmpg-400">{report.crash_date}</td>
                  <td className="px-3 py-[2px] text-rmpg-400">{report.location}</td>
                  <td className="px-3 py-[2px] text-rmpg-400 capitalize">{toDisplayLabel(report.crash_type)}</td>
                  <td className="px-3 py-[2px] text-rmpg-400 capitalize">{toDisplayLabel(report.severity)}</td>
                  <td className="px-3 py-[2px] text-rmpg-400 text-center">{report.vehicles_involved}</td>
                  <td className="px-3 py-[2px] text-rmpg-400 text-center">{report.injuries}</td>
                  <td className="px-3 py-[2px] text-center">
                    {report.fatalities > 0
                      ? <span className="text-red-400 font-bold">{report.fatalities}</span>
                      : <span className="text-rmpg-400">0</span>}
                  </td>
                  <td className={`px-3 py-[2px] font-semibold capitalize ${STATUS_COLORS[report.status] || 'text-rmpg-400'}`}>
                    {toDisplayLabel(report.status)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="bg-surface-raised border border-border-default rounded-[2px] p-4 space-y-2">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-accent-silver-500" />
            <span className="font-mono text-sm text-[color:var(--panel-header-color)]">{selected.report_number}</span>
            <IconButton aria-label="Copy report number" onClick={() => navigator.clipboard.writeText(selected.report_number).catch(() => undefined)}>
              <Copy className="w-4 h-4 text-accent-silver-500" />
            </IconButton>
            <IconButton aria-label="Copy location" onClick={() => navigator.clipboard.writeText(selected.location).catch(() => undefined)}>
              <span className="text-[10px] text-rmpg-100">Loc</span>
            </IconButton>
            <div className="ml-auto">
              <IconButton aria-label="Close detail" onClick={() => setSelected(null)}><X className="w-4 h-4 text-rmpg-400" /></IconButton>
            </div>
          </div>
          <p className="text-xs text-rmpg-400">{selected.location} · {toDisplayLabel(selected.crash_type)} · {toDisplayLabel(selected.severity)}</p>
          <p className="text-xs text-white whitespace-pre-wrap">{selected.narrative || 'No narrative on file.'}</p>
          <p className="text-[10px] text-rmpg-400">Officer {selected.investigating_officer || '—'} · weather {selected.weather_conditions || '—'} · road {selected.road_conditions || '—'}</p>
        </div>
      )}

      {/* ═══ Wizard Modal ═══ */}
      {wizardOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 overflow-y-auto p-4">
          <div className="bg-surface-raised border border-border-default rounded-[2px] w-full max-w-xl mx-4 shadow-lg my-auto">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle">
              <span className="text-sm font-semibold text-[color:var(--panel-header-color)]">New Crash Report</span>
              <IconButton aria-label="Close wizard" onClick={() => setWizardOpen(false)}>
                <X className="w-4 h-4 text-rmpg-400" />
              </IconButton>
            </div>

            {/* Step indicator */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
              {STEPS.map((label, i) => (
                <React.Fragment key={label}>
                  {i > 0 && <div className="flex-1 h-px bg-border-subtle" />}
                  <div className={`flex items-center gap-1.5 text-xs font-semibold
                    ${wizardStep === i + 1 ? 'text-accent-silver-500' : wizardStep > i + 1 ? 'text-green-400' : 'text-rmpg-400'}`}>
                    <span className={`w-5 h-5 flex items-center justify-center rounded-full text-[10px] border
                      ${wizardStep === i + 1 ? 'border-accent-silver-600 bg-accent-silver-500/20' : wizardStep > i + 1 ? 'border-green-500 bg-green-500/20' : 'border-border-default'}`}>
                      {i + 1}
                    </span>
                    {label}
                  </div>
                </React.Fragment>
              ))}
            </div>

            {/* Step content */}
            <div className="p-4 space-y-3 min-h-[200px]">
              {/* Step 1: Crash Info */}
              {wizardStep === 1 && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-rmpg-400 uppercase">Crash Date *</label>
                      <input type="datetime-local" value={step1.crash_date} onChange={e => setStep1(p => ({ ...p, crash_date: e.target.value }))}
                        className="w-full px-2 py-1.5 bg-surface-sunken border border-border-default rounded-[2px] text-white text-xs focus:border-accent-silver-600 outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] text-rmpg-400 uppercase">Crash Type</label>
                      <select value={step1.crash_type} onChange={e => setStep1(p => ({ ...p, crash_type: e.target.value }))}
                        className="w-full px-2 py-1.5 bg-surface-sunken border border-border-default rounded-[2px] text-white text-xs focus:border-accent-silver-600 outline-none">
                        {CRASH_TYPES.map(t => <option key={t} value={t}>{toDisplayLabel(t)}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-rmpg-400 uppercase">Location *</label>
                    <input value={step1.location} onChange={e => setStep1(p => ({ ...p, location: e.target.value }))}
                      className="w-full px-2 py-1.5 bg-surface-sunken border border-border-default rounded-[2px] text-white text-xs focus:border-accent-silver-600 outline-none" />
                  </div>
                  <div>
                    <label className="text-[10px] text-rmpg-400 uppercase">Severity</label>
                    <select value={step1.severity} onChange={e => setStep1(p => ({ ...p, severity: e.target.value }))}
                      className="w-full px-2 py-1.5 bg-surface-sunken border border-border-default rounded-[2px] text-white text-xs focus:border-accent-silver-600 outline-none">
                      {SEVERITY_LEVELS.map(s => <option key={s} value={s}>{toDisplayLabel(s)}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-rmpg-400 uppercase">Weather Conditions</label>
                      <input value={step1.weather_conditions} onChange={e => setStep1(p => ({ ...p, weather_conditions: e.target.value }))}
                        className="w-full px-2 py-1.5 bg-surface-sunken border border-border-default rounded-[2px] text-white text-xs focus:border-accent-silver-600 outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] text-rmpg-400 uppercase">Road Conditions</label>
                      <input value={step1.road_conditions} onChange={e => setStep1(p => ({ ...p, road_conditions: e.target.value }))}
                        className="w-full px-2 py-1.5 bg-surface-sunken border border-border-default rounded-[2px] text-white text-xs focus:border-accent-silver-600 outline-none" />
                    </div>
                  </div>
                </>
              )}

              {/* Step 2: Parties/Vehicles */}
              {wizardStep === 2 && (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] text-rmpg-400 uppercase">Vehicles Involved</label>
                      <input type="number" min="0" value={step2.vehicles_involved} onChange={e => setStep2(p => ({ ...p, vehicles_involved: e.target.value }))}
                        className="w-full px-2 py-1.5 bg-surface-sunken border border-border-default rounded-[2px] text-white text-xs focus:border-accent-silver-600 outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] text-rmpg-400 uppercase">Injuries</label>
                      <input type="number" min="0" value={step2.injuries} onChange={e => setStep2(p => ({ ...p, injuries: e.target.value }))}
                        className="w-full px-2 py-1.5 bg-surface-sunken border border-border-default rounded-[2px] text-white text-xs focus:border-accent-silver-600 outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] text-rmpg-400 uppercase">Fatalities</label>
                      <input type="number" min="0" value={step2.fatalities} onChange={e => setStep2(p => ({ ...p, fatalities: e.target.value }))}
                        className="w-full px-2 py-1.5 bg-surface-sunken border border-border-default rounded-[2px] text-white text-xs focus:border-accent-silver-600 outline-none" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-rmpg-400 uppercase">Investigating Officer</label>
                    <input value={step2.investigating_officer} onChange={e => setStep2(p => ({ ...p, investigating_officer: e.target.value }))}
                      className="w-full px-2 py-1.5 bg-surface-sunken border border-border-default rounded-[2px] text-white text-xs focus:border-accent-silver-600 outline-none" />
                  </div>
                  <div>
                    <label className="text-[10px] text-rmpg-400 uppercase">Parties / Vehicle Details</label>
                    <textarea value={step2.parties_description} onChange={e => setStep2(p => ({ ...p, parties_description: e.target.value }))} rows={5}
                      placeholder="Enter vehicle/driver/passenger information for each party involved..."
                      className="w-full px-2 py-1.5 bg-surface-sunken border border-border-default rounded-[2px] text-white text-xs focus:border-accent-silver-600 outline-none resize-none" />
                  </div>
                </>
              )}

              {/* Step 3: Narrative */}
              {wizardStep === 3 && (
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase">Narrative *</label>
                  <textarea value={step3.narrative} onChange={e => setStep3(p => ({ ...p, narrative: e.target.value }))} rows={10}
                    placeholder="Describe the crash in detail..."
                    className="w-full px-2 py-1.5 bg-surface-sunken border border-border-default rounded-[2px] text-white text-xs focus:border-accent-silver-600 outline-none resize-none" />
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-between px-4 py-3 border-t border-border-subtle">
              <div>
                {wizardStep > 1 && (
                  <button onClick={() => setWizardStep(s => s - 1)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-surface-sunken border border-border-default rounded-[2px] text-xs text-rmpg-400 hover:text-white">
                    <ChevronLeft className="w-3.5 h-3.5" /> Back
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setWizardOpen(false)} className="px-3 py-1.5 bg-surface-sunken border border-border-default rounded-[2px] text-xs text-rmpg-400 hover:text-white">Cancel</button>
                {wizardStep < 3 ? (
                  <button onClick={() => setWizardStep(s => s + 1)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-accent-silver-500 text-black text-xs font-semibold rounded-[2px] hover:bg-accent-silver-400">
                    Next <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <button onClick={handleSubmit} disabled={submitting}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-silver-500 text-black text-xs font-semibold rounded-[2px] hover:bg-accent-silver-400 disabled:opacity-50">
                    {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    File Report
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
