import { useState, useEffect } from 'react';
import { ClipboardCheck, Plus, AlertTriangle, Loader2, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { useToast } from '../../../components/ToastProvider';
import { useAuth } from '../../../context/AuthContext';
import { useContextMenu, type ContextMenuItem } from '../../../context/ContextMenuContext';
import { useMenuActions } from '../../../utils/contextMenuActions';
import { localToday, parseTimestamp } from '../../../utils/dateUtils';
import { toDisplayLabel, formatEnumValue } from '../../../utils/formatters';
import { coded } from '../../../utils/searchText';

interface AttendanceRecord {
  id: number;
  officer_id: number;
  officer_name: string;
  date: string;
  type: string;
  minutes_late: number;
  reason: string;
  excused: number;
  documented_by_name: string;
}

interface AttendancePage {
  records: AttendanceRecord[];
  page: number;
  page_size: number;
  has_more: boolean;
}

interface AttendanceSummary {
  officer_id: number;
  year: number;
  by_type: { type: string; count: number; excused_count: number }[];
  total_incidents: number;
  monday_friday_pattern: boolean;
  monday_friday_count: number;
}

const TYPE_COLORS: Record<string, string> = {
  absent: 'bg-red-900/50 text-red-400 border border-red-700/50',
  tardy: 'bg-amber-900/50 text-amber-400 border border-amber-700/50',
  early_departure: 'bg-surface-sunken/50 text-rmpg-400 border border-border-default/50',
  no_call_no_show: 'bg-red-900/60 text-red-300 border border-red-600/50',
};

export default function AttendanceTab({ userRole }: { userRole: string }) {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [officers, setOfficers] = useState<any[]>([]);
  const [selectedOfficer, setSelectedOfficer] = useState<number | null>(null);
  const [officerFilter, setOfficerFilter] = useState<number | null>(null);
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [form, setForm] = useState({ officer_id: '', date: localToday(), type: 'absent', minutes_late: 0, reason: '', excused: false });
  const [submitting, setSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const isManager = ['admin', 'manager', 'supervisor', 'human_resources'].includes(userRole);

  // ── Right-click context menu (read-only rows → copy-only) ──
  const { openMenu } = useContextMenu();
  const m = useMenuActions();

  const buildAttendanceMenu = (r: AttendanceRecord): ContextMenuItem[] => [
    m.copy('Copy officer name', r.officer_name),
    m.copy('Copy type', toDisplayLabel(r.type)),
    ...(r.reason ? [m.copy('Copy reason', r.reason)] : []),
    m.copyId(r.id),
  ];

  const load = async (p: number = 0) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p) });
      if (officerFilter) params.set('officer_id', String(officerFilter));
      const data = await apiFetch<AttendancePage>(`/hr/attendance?${params}`);
      setRecords(data.records ?? []);
      setPage(data.page ?? p);
      setHasMore(data.has_more ?? false);
    } catch {
      addToast('Failed to load attendance records', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadOfficers = async () => {
    try { const data = await apiFetch<any[]>('/personnel'); setOfficers(data.filter((o: any) => o.status === 'active')); } catch { /* officer list load failure handled silently */ }
  };

  const loadSummary = async (officerId: number) => {
    try { const data = await apiFetch<AttendanceSummary>(`/hr/attendance/summary/${officerId}`); setSummary(data); } catch { setSummary(null); }
  };

  useEffect(() => { load(0); loadOfficers(); }, [officerFilter]);
  useEffect(() => { if (selectedOfficer) loadSummary(selectedOfficer); }, [selectedOfficer]);

  // Escape to close form
  useEffect(() => {
    if (!showForm) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowForm(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showForm]);

  const handleSubmit = async () => {
    if (!form.officer_id) { addToast('Please select an officer', 'error'); return; }
    if (!form.date) { addToast('Date is required', 'error'); return; }
    if (!form.type) { addToast('Type is required', 'error'); return; }
    setSubmitting(true);
    try { await apiFetch('/hr/attendance', { method: 'POST', body: JSON.stringify({ ...form, officer_id: Number(form.officer_id), excused: form.excused ? 1 : 0 }) }); addToast('Attendance logged', 'success'); setShowForm(false); load(0); } catch { addToast('Failed to log attendance', 'error'); } finally { setSubmitting(false); }
  };

  const filtered = records.filter(r => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return r.officer_name.toLowerCase().includes(q) || r.reason?.toLowerCase().includes(q) || coded(r.type, formatEnumValue).includes(q);
    }
    return true;
  });

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-rmpg-100 flex items-center gap-2"><ClipboardCheck className="w-4 h-4" /> Attendance Tracking</h2>
        {isManager && <button type="button" data-hr-new-btn onClick={() => setShowForm(!showForm)} className="toolbar-btn toolbar-btn-success text-xs"><Plus className="w-3 h-3" /> Log Incident</button>}
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="panel-beveled p-2 text-center">
            <p className="field-label">Total Incidents</p>
            <p className="text-lg font-bold font-mono text-rmpg-100">{summary.total_incidents}</p>
          </div>
          {(summary.by_type ?? []).map(t => (
            <div key={t.type} className="panel-beveled p-2 text-center">
              <p className="field-label">{toDisplayLabel(t.type)}</p>
              <p className="text-lg font-bold font-mono text-rmpg-100">{t.count} <span className="text-[10px] text-rmpg-400">({t.excused_count} excused)</span></p>
            </div>
          ))}
          {summary.monday_friday_pattern && (
            <div className="panel-beveled p-2 text-center border-t-2 border-t-amber-500 col-span-full">
              <p className="text-[10px] text-amber-400 flex items-center justify-center gap-1"><AlertTriangle className="w-3 h-3" /> Monday/Friday pattern detected ({summary.monday_friday_count} incidents)</p>
            </div>
          )}
        </div>
      )}

      {showForm && isManager && (
        <div className="panel-beveled p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label htmlFor="ff-attendancetab-0" className="field-label">Officer</label>
              <select id="ff-attendancetab-0" value={form.officer_id} onChange={e => setForm(f => ({ ...f, officer_id: e.target.value }))} className="input-field w-full text-xs">
                <option value="">Select officer...</option>
                {officers.map(o => <option key={o.id} value={o.id}>{o.full_name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ff-attendancetab-1" className="field-label">Date</label>
              <input id="ff-attendancetab-1" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="input-field w-full text-xs" />
            </div>
            <div>
              <label htmlFor="ff-attendancetab-2" className="field-label">Type</label>
              <select id="ff-attendancetab-2" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="input-field w-full text-xs">
                <option value="absent">Absent</option>
                <option value="tardy">Tardy</option>
                <option value="early_departure">Early Departure</option>
                <option value="no_call_no_show">No Call / No Show</option>
              </select>
            </div>
            <div>
              <label htmlFor="ff-attendancetab-3" className="field-label">Minutes Late</label>
              <input id="ff-attendancetab-3" type="number" min="0" max="480" value={form.minutes_late} onChange={e => setForm(f => ({ ...f, minutes_late: Number(e.target.value) }))} className="input-field w-full text-xs tabular-nums" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ff-attendancetab-4" className="field-label">Reason</label>
              <input id="ff-attendancetab-4" value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} className="input-field w-full text-xs" />
            </div>
            <div className="flex items-center gap-2 pt-4">
              <input id="ff-attendancetab-5" type="checkbox" checked={form.excused} onChange={e => setForm(f => ({ ...f, excused: e.target.checked }))} className="w-3 h-3" />
              <label htmlFor="ff-attendancetab-5" className="text-xs text-rmpg-300">Excused</label>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={handleSubmit} disabled={submitting || !form.officer_id} className="toolbar-btn toolbar-btn-success text-xs disabled:opacity-50">{submitting ? <><Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> Saving...</> : 'Save'}</button>
            <button type="button" onClick={() => setShowForm(false)} disabled={submitting} className="toolbar-btn text-xs">Cancel</button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500 pointer-events-none" aria-hidden="true" />
          <input id="ff-attendancetab-6" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search records..." aria-label="Search attendance records by officer or reason" className="input-field text-xs py-1 pl-6 pr-2 w-48 focus:ring-1 focus:ring-brand-500/50 transition-shadow duration-150" />
        </div>
        <select id="ff-attendancetab-7" value={officerFilter ?? ''} onChange={e => { const v = e.target.value ? Number(e.target.value) : null; setOfficerFilter(v); setSelectedOfficer(v); }} className="input-field text-xs py-1 px-2">
          <option value="">All Officers</option>
          {officers.map(o => <option key={o.id} value={o.id}>{o.full_name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 text-rmpg-400 py-12 text-xs"><Loader2 className="w-5 h-5 animate-spin text-brand-400" role="status" aria-label="Loading attendance records" /> Loading attendance...</div>
      ) : (
        <>
          {!loading && filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-rmpg-500">
              <ClipboardCheck className="w-8 h-8 mb-2 opacity-40" aria-hidden="true" />
              <p className="text-sm font-medium">
                {searchQuery || officerFilter ? 'No records match your filters' : 'No attendance records logged this month'}
              </p>
            </div>
          ) : (
            <div className="space-y-1" role="list" aria-label="Attendance records">
              {filtered.map(r => (
                <div key={r.id} role="listitem" onContextMenu={(e) => openMenu(e, buildAttendanceMenu(r))} className="panel-beveled p-2.5 flex items-center justify-between hover:bg-surface-raised/30 hover:shadow-sm transition-all duration-150">
                  <div className="flex items-center gap-3">
                    <span className={`inline-flex px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase rounded-sm ${TYPE_COLORS[r.type] || TYPE_COLORS.absent}`}>{toDisplayLabel(r.type)}</span>
                    <span className="text-xs text-rmpg-100">{r.officer_name}</span>
                    <span className="text-[10px] text-rmpg-400">{r.date ? parseTimestamp(r.date).toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', year: 'numeric' }) : r.date}</span>
                    {r.minutes_late > 0 && <span className="text-[10px] text-amber-400">{r.minutes_late}m late</span>}
                    {r.reason && <span className="text-[10px] text-rmpg-400 italic truncate max-w-[200px]">{formatEnumValue(r.reason)}</span>}
                  </div>
                  <span className={`text-[10px] ${r.excused ? 'text-green-400' : 'text-red-400'}`}>{r.excused ? 'Excused' : 'Unexcused'}</span>
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {(page > 0 || hasMore) && (
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => load(page - 1)}
                disabled={page === 0}
                aria-label="Previous page"
                className="toolbar-btn text-xs flex items-center gap-1 disabled:opacity-40"
              >
                <ChevronLeft className="w-3 h-3" /> Prev
              </button>
              <span className="text-[10px] text-rmpg-500">Page {page + 1}</span>
              <button
                type="button"
                onClick={() => load(page + 1)}
                disabled={!hasMore}
                aria-label="Next page"
                className="toolbar-btn text-xs flex items-center gap-1 disabled:opacity-40"
              >
                Next <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
