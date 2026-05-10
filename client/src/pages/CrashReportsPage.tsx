import React, { useState, useEffect, useCallback } from 'react';
import {
  Search, Plus, X, Save, Loader2, Car, ChevronRight, ChevronLeft,
  FileText, Filter,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';
import { apiFetch } from '../hooks/useApi';

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
  draft: 'text-[#888888]',
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
    } catch { /* empty */ }
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
      fetchReports();
    } catch { /* error */ }
    finally { setSubmitting(false); }
  };

  const STEPS = ['Crash Info', 'Parties / Vehicles', 'Narrative'];

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="CRASH / ACCIDENT REPORTS" icon={Car} />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: stats.total },
          { label: 'Draft', value: stats.draft },
          { label: 'Pending Review', value: stats.pending_review },
          { label: 'Filed', value: stats.filed },
        ].map(s => (
          <div key={s.label} className="bg-[#141414] border border-[#222222] rounded-[2px] p-3">
            <div className="text-lg font-bold text-white">{s.value}</div>
            <div className="text-[10px] text-[#888888] uppercase tracking-wider">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Search + Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[#888888]" />
          <input
            type="text"
            placeholder="Search report #, location..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none"
          />
        </div>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="bg-[#0a0a0a] border border-[#222222] rounded-[2px] px-2 py-1.5 text-white text-xs focus:border-[#d4a017] outline-none">
          <option value="">All Types</option>
          {CRASH_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </select>
        <select value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)}
          className="bg-[#0a0a0a] border border-[#222222] rounded-[2px] px-2 py-1.5 text-white text-xs focus:border-[#d4a017] outline-none">
          <option value="">All Severity</option>
          {SEVERITY_LEVELS.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="bg-[#0a0a0a] border border-[#222222] rounded-[2px] px-2 py-1.5 text-white text-xs focus:border-[#d4a017] outline-none" />
        <span className="text-[#888888] text-xs">to</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="bg-[#0a0a0a] border border-[#222222] rounded-[2px] px-2 py-1.5 text-white text-xs focus:border-[#d4a017] outline-none" />
        <button onClick={openWizard}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#d4a017] text-black text-xs font-semibold rounded-[2px] hover:bg-[#b8891a]">
          <Plus className="w-3.5 h-3.5" /> New Report
        </button>
      </div>

      {/* Table */}
      <div className="bg-[#141414] border border-[#222222] rounded-[2px] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#222222]">
                {['Report #', 'Date', 'Location', 'Type', 'Severity', 'Vehicles', 'Injuries', 'Fatalities', 'Status'].map(h => (
                  <th key={h} className="text-left px-3 py-[3px] text-[9px] font-semibold text-[#888888] uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-8 text-[#888888]"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
              ) : reports.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8 text-[#888888]">No crash reports found</td></tr>
              ) : reports.map(report => (
                <tr key={report.id} className="border-b border-[#1a1a1a] hover:bg-[#1a1a1a]">
                  <td className="px-3 py-[2px] text-[#d4a017] font-mono">{report.report_number}</td>
                  <td className="px-3 py-[2px] text-[#888888]">{report.crash_date}</td>
                  <td className="px-3 py-[2px] text-[#888888]">{report.location}</td>
                  <td className="px-3 py-[2px] text-[#888888] capitalize">{report.crash_type.replace(/_/g, ' ')}</td>
                  <td className="px-3 py-[2px] text-[#888888] capitalize">{report.severity.replace(/_/g, ' ')}</td>
                  <td className="px-3 py-[2px] text-[#888888] text-center">{report.vehicles_involved}</td>
                  <td className="px-3 py-[2px] text-[#888888] text-center">{report.injuries}</td>
                  <td className="px-3 py-[2px] text-center">
                    {report.fatalities > 0
                      ? <span className="text-red-400 font-bold">{report.fatalities}</span>
                      : <span className="text-[#888888]">0</span>}
                  </td>
                  <td className={`px-3 py-[2px] font-semibold capitalize ${STATUS_COLORS[report.status] || 'text-[#888888]'}`}>
                    {report.status.replace(/_/g, ' ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ═══ Wizard Modal ═══ */}
      {wizardOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-[#141414] border border-[#222222] rounded-[2px] w-full max-w-xl mx-4 shadow-lg">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-[#222222]">
              <span className="text-sm font-semibold text-[#d4a017]">New Crash Report</span>
              <IconButton aria-label="Close wizard" onClick={() => setWizardOpen(false)}>
                <X className="w-4 h-4 text-[#888888]" />
              </IconButton>
            </div>

            {/* Step indicator */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
              {STEPS.map((label, i) => (
                <React.Fragment key={label}>
                  {i > 0 && <div className="flex-1 h-px bg-[#222222]" />}
                  <div className={`flex items-center gap-1.5 text-xs font-semibold
                    ${wizardStep === i + 1 ? 'text-[#d4a017]' : wizardStep > i + 1 ? 'text-green-400' : 'text-[#888888]'}`}>
                    <span className={`w-5 h-5 flex items-center justify-center rounded-full text-[10px] border
                      ${wizardStep === i + 1 ? 'border-[#d4a017] bg-[#d4a017]/20' : wizardStep > i + 1 ? 'border-green-500 bg-green-500/20' : 'border-[#222222]'}`}>
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
                      <label className="text-[10px] text-[#888888] uppercase">Crash Date *</label>
                      <input type="datetime-local" value={step1.crash_date} onChange={e => setStep1(p => ({ ...p, crash_date: e.target.value }))}
                        className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] text-[#888888] uppercase">Crash Type</label>
                      <select value={step1.crash_type} onChange={e => setStep1(p => ({ ...p, crash_type: e.target.value }))}
                        className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none">
                        {CRASH_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-[#888888] uppercase">Location *</label>
                    <input value={step1.location} onChange={e => setStep1(p => ({ ...p, location: e.target.value }))}
                      className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none" />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#888888] uppercase">Severity</label>
                    <select value={step1.severity} onChange={e => setStep1(p => ({ ...p, severity: e.target.value }))}
                      className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none">
                      {SEVERITY_LEVELS.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-[#888888] uppercase">Weather Conditions</label>
                      <input value={step1.weather_conditions} onChange={e => setStep1(p => ({ ...p, weather_conditions: e.target.value }))}
                        className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] text-[#888888] uppercase">Road Conditions</label>
                      <input value={step1.road_conditions} onChange={e => setStep1(p => ({ ...p, road_conditions: e.target.value }))}
                        className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none" />
                    </div>
                  </div>
                </>
              )}

              {/* Step 2: Parties/Vehicles */}
              {wizardStep === 2 && (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] text-[#888888] uppercase">Vehicles Involved</label>
                      <input type="number" min="0" value={step2.vehicles_involved} onChange={e => setStep2(p => ({ ...p, vehicles_involved: e.target.value }))}
                        className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] text-[#888888] uppercase">Injuries</label>
                      <input type="number" min="0" value={step2.injuries} onChange={e => setStep2(p => ({ ...p, injuries: e.target.value }))}
                        className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] text-[#888888] uppercase">Fatalities</label>
                      <input type="number" min="0" value={step2.fatalities} onChange={e => setStep2(p => ({ ...p, fatalities: e.target.value }))}
                        className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-[#888888] uppercase">Investigating Officer</label>
                    <input value={step2.investigating_officer} onChange={e => setStep2(p => ({ ...p, investigating_officer: e.target.value }))}
                      className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none" />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#888888] uppercase">Parties / Vehicle Details</label>
                    <textarea value={step2.parties_description} onChange={e => setStep2(p => ({ ...p, parties_description: e.target.value }))} rows={5}
                      placeholder="Enter vehicle/driver/passenger information for each party involved..."
                      className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none resize-none" />
                  </div>
                </>
              )}

              {/* Step 3: Narrative */}
              {wizardStep === 3 && (
                <div>
                  <label className="text-[10px] text-[#888888] uppercase">Narrative *</label>
                  <textarea value={step3.narrative} onChange={e => setStep3(p => ({ ...p, narrative: e.target.value }))} rows={10}
                    placeholder="Describe the crash in detail..."
                    className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none resize-none" />
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-between px-4 py-3 border-t border-[#222222]">
              <div>
                {wizardStep > 1 && (
                  <button onClick={() => setWizardStep(s => s - 1)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-xs text-[#888888] hover:text-white">
                    <ChevronLeft className="w-3.5 h-3.5" /> Back
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setWizardOpen(false)} className="px-3 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-xs text-[#888888] hover:text-white">Cancel</button>
                {wizardStep < 3 ? (
                  <button onClick={() => setWizardStep(s => s + 1)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-[#d4a017] text-black text-xs font-semibold rounded-[2px] hover:bg-[#b8891a]">
                    Next <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <button onClick={handleSubmit} disabled={submitting}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#d4a017] text-black text-xs font-semibold rounded-[2px] hover:bg-[#b8891a] disabled:opacity-50">
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
