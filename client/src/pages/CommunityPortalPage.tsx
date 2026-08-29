// ============================================================
// RMPG Flex — Community Portal Page (Internal Management View)
// ============================================================
// Dispatcher/admin view for managing community-submitted reports.
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import {
  Users, Search, X, Loader2, ChevronLeft, Copy, Download,
  AlertTriangle, Clock, CheckCircle, Eye,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';
import StatsCard from '../components/StatsCard';
import EmptyState from '../components/EmptyState';
import { apiFetch } from '../hooks/useApi';
import { useToast } from '../components/ToastProvider';
import { safeDateStr, safeDateTimeStr } from '../utils/dateUtils';
import { asArray } from '../utils/asArray';
import { toDisplayLabel } from '../utils/formatters';
import { communityReportsToCsv, downloadTextFile } from '../utils/rmsListExport';

// ─── Types ───────────────────────────────────────────────────

interface CommunityReport {
  id: number;
  tracking_number: string;
  report_type: ReportType;
  reporter_name: string;
  reporter_phone: string;
  reporter_email: string;
  anonymous: boolean;
  location: string;
  latitude: number | null;
  longitude: number | null;
  description: string;
  status: ReportStatus;
  assigned_to: string;
  assigned_officer_id: number | null;
  priority: string;
  resolution_notes: string;
  created_at: string;
  updated_at: string;
}

type ReportType = 'non_emergency' | 'noise' | 'graffiti' | 'abandoned_vehicle' | 'pothole' | 'other' | 'tip';
type ReportStatus = 'submitted' | 'reviewing' | 'assigned' | 'resolved' | 'closed' | 'rejected';

interface Officer {
  id: number;
  first_name: string;
  last_name: string;
  badge_number: string;
}

// ─── Constants ───────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  submitted: 'bg-amber-900/40 text-amber-400 border border-amber-700/40',
  reviewing: 'bg-blue-900/40 text-blue-400 border border-blue-700/40',
  assigned: 'bg-purple-900/40 text-purple-400 border border-purple-700/40',
  resolved: 'bg-green-900/40 text-green-400 border border-green-700/40',
  closed: 'bg-gray-900/40 text-rmpg-400 border border-gray-700/40',
  rejected: 'bg-red-900/40 text-red-400 border border-red-700/40',
};

const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  non_emergency: 'Non-Emergency',
  noise: 'Noise',
  graffiti: 'Graffiti',
  abandoned_vehicle: 'Abandoned Vehicle',
  pothole: 'Pothole',
  other: 'Other',
  tip: 'Tip',
};

const STATUS_OPTIONS: ReportStatus[] = ['submitted', 'reviewing', 'assigned', 'resolved', 'closed', 'rejected'];

export default function CommunityPortalPage() {
  const { addToast } = useToast();

  const [reports, setReports] = useState<CommunityReport[]>([]);
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [anonFilter, setAnonFilter] = useState<'all' | 'anon' | 'named'>('all');
  const [selected, setSelected] = useState<CommunityReport | null>(null);
  const [saving, setSaving] = useState(false);
  const [editStatus, setEditStatus] = useState<ReportStatus>('submitted');
  const [editAssignee, setEditAssignee] = useState<string>('');
  const [editResolution, setEditResolution] = useState('');

  // ─── Stats ───────────────────────────────────────────────
  const stats = {
    submitted: reports.filter(r => r.status === 'submitted').length,
    reviewing: reports.filter(r => r.status === 'reviewing').length,
    assigned: reports.filter(r => r.status === 'assigned').length,
    resolved: reports.filter(r => r.status === 'resolved').length,
  };

  // ─── Fetch ─────────────────────────────────────────────────

  const fetchReports = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (typeFilter) params.set('type', typeFilter);
      const qs = params.toString();
      const data = await apiFetch<CommunityReport[]>(`/api/community-reports${qs ? `?${qs}` : ''}`);
      setReports(asArray<CommunityReport>(data));
    } catch {
      addToast('Failed to load community reports', 'error');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter, addToast]);

  const fetchOfficers = useCallback(async () => {
    try {
      const data = await apiFetch<Officer[]>('/api/personnel?role=officer');
      setOfficers(asArray<Officer>(data));
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { fetchReports(); }, [fetchReports]);
  useEffect(() => { fetchOfficers(); }, [fetchOfficers]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  // ─── Detail panel ─────────────────────────────────────────

  const openDetail = (r: CommunityReport) => {
    setSelected(r);
    setEditStatus(r.status);
    setEditAssignee(r.assigned_officer_id ? String(r.assigned_officer_id) : '');
    setEditResolution(r.resolution_notes || '');
  };

  const saveChanges = async () => {
    if (!selected) return;
    try {
      setSaving(true);
      await apiFetch(`/api/community-reports/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: editStatus,
          assigned_officer_id: editAssignee ? Number(editAssignee) : null,
          resolution_notes: editResolution,
        }),
      });
      addToast('Report updated', 'success');
      setSelected(null);
      fetchReports();
    } catch {
      addToast('Failed to update report', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ─── Filtered list ────────────────────────────────────────

  const filtered = reports.filter(r => {
    if (anonFilter === 'anon' && !r.anonymous) return false;
    if (anonFilter === 'named' && r.anonymous) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    const nameMatch = !r.anonymous && r.reporter_name.toLowerCase().includes(q);
    return (
      r.tracking_number.toLowerCase().includes(q) ||
      nameMatch ||
      r.location.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q)
    );
  });

  // ─── Render ────────────────────────────────────────────────

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="COMMUNITY REPORTS" icon={Users} />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatsCard icon={AlertTriangle} label="Submitted" value={stats.submitted} accent="amber" />
        <StatsCard icon={Eye} label="Reviewing" value={stats.reviewing} accent="blue" />
        <StatsCard icon={Clock} label="Assigned" value={stats.assigned} accent="purple" />
        <StatsCard icon={CheckCircle} label="Resolved" value={stats.resolved} accent="green" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-rmpg-500" />
          <input
            type="text"
            placeholder="Search tracking #, reporter, location…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-surface-base border border-border-default rounded-sm text-xs text-rmpg-200 placeholder-rmpg-500 focus:[border-color:var(--field-label-color)] focus:outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="bg-surface-base border border-border-default rounded-sm text-xs text-rmpg-300 px-2 py-1.5 focus:[border-color:var(--field-label-color)] focus:outline-none"
        >
          <option value="">All Statuses</option>
          {STATUS_OPTIONS.map(s => (
            <option key={s} value={s}>{toDisplayLabel(s).toUpperCase()}</option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="bg-surface-base border border-border-default rounded-sm text-xs text-rmpg-300 px-2 py-1.5 focus:[border-color:var(--field-label-color)] focus:outline-none"
        >
          <option value="">All Types</option>
          {Object.entries(REPORT_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={anonFilter}
          onChange={e => setAnonFilter(e.target.value as 'all' | 'anon' | 'named')}
          className="bg-surface-base border border-border-default rounded-sm text-xs text-rmpg-300 px-2 py-1.5 focus:[border-color:var(--field-label-color)] focus:outline-none"
        >
          <option value="all">All reporters</option>
          <option value="anon">Anonymous only</option>
          <option value="named">Named only</option>
        </select>
        <button
          type="button"
          disabled={filtered.length === 0}
          onClick={() => downloadTextFile('community-reports.csv', communityReportsToCsv(filtered))}
          className="flex items-center gap-1 px-2 py-1.5 text-xs border border-border-default rounded-sm text-rmpg-200 disabled:opacity-40"
        >
          <Download className="w-3 h-3" /> CSV
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-rmpg-500"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Users} title="No community reports found" />
      ) : (
        <div className="overflow-x-auto border border-border-default rounded-sm">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-surface-base border-b border-border-default text-rmpg-400 font-semibold text-[9px] uppercase tracking-wider">
                <th className="text-left px-2 py-[3px]">Tracking #</th>
                <th className="text-left px-2 py-[3px]">Date</th>
                <th className="text-left px-2 py-[3px]">Type</th>
                <th className="text-left px-2 py-[3px]">Reporter</th>
                <th className="text-left px-2 py-[3px]">Location</th>
                <th className="text-left px-2 py-[3px]">Description</th>
                <th className="text-left px-2 py-[3px]">Status</th>
                <th className="text-left px-2 py-[3px]">Assigned To</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr
                  key={r.id}
                  onClick={() => openDetail(r)}
                  className="border-b border-border-default hover:bg-surface-raised cursor-pointer transition-colors"
                >
                  <td className="px-2 py-[2px] [color:var(--panel-header-color)] font-mono">{r.tracking_number}</td>
                  <td className="px-2 py-[2px] text-rmpg-400">{safeDateStr(r.created_at)}</td>
                  <td className="px-2 py-[2px] text-rmpg-300">{REPORT_TYPE_LABELS[r.report_type] || r.report_type}</td>
                  <td className="px-2 py-[2px] text-rmpg-300">{r.anonymous ? 'Anonymous' : r.reporter_name}</td>
                  <td className="px-2 py-[2px] text-rmpg-400 max-w-[160px] truncate">{r.location}</td>
                  <td className="px-2 py-[2px] text-rmpg-400 max-w-[200px] truncate">{r.description}</td>
                  <td className="px-2 py-[2px]">
                    <span className={`inline-block px-1.5 py-0.5 rounded-sm text-[10px] ${STATUS_COLORS[r.status] || 'text-rmpg-400'}`}>
                      {toDisplayLabel(r.status).toUpperCase()}
                    </span>
                  </td>
                  <td className="px-2 py-[2px] text-rmpg-400">{r.assigned_to || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail Panel */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-surface-sunken border border-border-default rounded-sm w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-lg">
            <div className="flex items-center justify-between px-4 py-2 border-b border-border-default bg-surface-raised">
              <div className="flex items-center gap-2">
                <IconButton aria-label="Close detail" onClick={() => setSelected(null)}>
                  <ChevronLeft className="w-4 h-4" />
                </IconButton>
                <span className="[color:var(--panel-header-color)] text-xs font-semibold">{selected.tracking_number}</span>
                <IconButton aria-label="Copy tracking number" onClick={() => navigator.clipboard.writeText(selected.tracking_number).catch(() => undefined)}>
                  <Copy className="w-4 h-4" />
                </IconButton>
              </div>
              <IconButton aria-label="Close detail panel" onClick={() => setSelected(null)}>
                <X className="w-4 h-4" />
              </IconButton>
            </div>

            <div className="p-4 space-y-3 text-xs text-rmpg-300">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[9px] uppercase text-rmpg-500 font-semibold">Type</label>
                  <p>{REPORT_TYPE_LABELS[selected.report_type] || selected.report_type}</p>
                </div>
                <div>
                  <label className="text-[9px] uppercase text-rmpg-500 font-semibold">Priority</label>
                  <p>{selected.priority || '—'}</p>
                </div>
                <div>
                  <label className="text-[9px] uppercase text-rmpg-500 font-semibold">Reporter</label>
                  <p>{selected.anonymous ? 'Anonymous' : selected.reporter_name}</p>
                </div>
                <div>
                  <label className="text-[9px] uppercase text-rmpg-500 font-semibold">Contact</label>
                  <p>{selected.anonymous ? '—' : (selected.reporter_phone || selected.reporter_email || '—')}</p>
                </div>
                <div className="col-span-2">
                  <label className="text-[9px] uppercase text-rmpg-500 font-semibold">Location</label>
                  <p>{selected.location}</p>
                </div>
                <div className="col-span-2">
                  <label className="text-[9px] uppercase text-rmpg-500 font-semibold">Description</label>
                  <p className="whitespace-pre-wrap">{selected.description}</p>
                </div>
                <div>
                  <label className="text-[9px] uppercase text-rmpg-500 font-semibold">Submitted</label>
                  <p>{safeDateTimeStr(selected.created_at)}</p>
                </div>
                <div>
                  <label className="text-[9px] uppercase text-rmpg-500 font-semibold">Last Updated</label>
                  <p>{safeDateTimeStr(selected.updated_at)}</p>
                </div>
              </div>

              <hr className="border-border-default" />

              {/* Status change */}
              <div className="space-y-2">
                <div>
                  <label className="text-[9px] uppercase text-rmpg-500 font-semibold">Status</label>
                  <select
                    value={editStatus}
                    onChange={e => setEditStatus(e.target.value as ReportStatus)}
                    className="w-full bg-surface-base border border-border-default rounded-sm text-xs text-rmpg-300 px-2 py-1.5 mt-1 focus:[border-color:var(--field-label-color)] focus:outline-none"
                  >
                    {STATUS_OPTIONS.map(s => (
                      <option key={s} value={s}>{toDisplayLabel(s).toUpperCase()}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[9px] uppercase text-rmpg-500 font-semibold">Assign To Officer</label>
                  <select
                    value={editAssignee}
                    onChange={e => setEditAssignee(e.target.value)}
                    className="w-full bg-surface-base border border-border-default rounded-sm text-xs text-rmpg-300 px-2 py-1.5 mt-1 focus:[border-color:var(--field-label-color)] focus:outline-none"
                  >
                    <option value="">— Unassigned —</option>
                    {officers.map(o => (
                      <option key={o.id} value={String(o.id)}>
                        {o.last_name}, {o.first_name} ({o.badge_number})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[9px] uppercase text-rmpg-500 font-semibold">Resolution Notes</label>
                  <textarea
                    value={editResolution}
                    onChange={e => setEditResolution(e.target.value)}
                    rows={3}
                    className="w-full bg-surface-base border border-border-default rounded-sm text-xs text-rmpg-300 px-2 py-1.5 mt-1 focus:[border-color:var(--field-label-color)] focus:outline-none resize-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setSelected(null)}
                  className="px-3 py-1.5 text-xs text-rmpg-400 bg-surface-base border border-border-default rounded-sm hover:bg-surface-raised"
                >
                  Cancel
                </button>
                <button
                  onClick={saveChanges}
                  disabled={saving}
                  className="px-3 py-1.5 text-xs text-white bg-brand-600 rounded-sm hover:bg-brand-700 disabled:opacity-50 flex items-center gap-1"
                >
                  {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
