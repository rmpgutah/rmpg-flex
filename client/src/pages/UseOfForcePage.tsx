import React, { useState, useEffect, useCallback } from 'react';
import { Shield, Plus, Search, Loader2, CheckCircle, XCircle } from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import SplitPanel from '../components/SplitPanel';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { formatDate, formatDateTime } from '../utils/dateUtils';

import RichTextArea from '../components/RichTextArea';
interface UofReport {
  id: number; incident_id?: number; officer_id: number; subject_person_id?: number;
  force_type: string; force_level?: string; justification?: string;
  subject_injuries?: string; officer_injuries?: string;
  de_escalation_attempted: number; de_escalation_details?: string;
  weapons_used?: string; body_camera_active: number; witness_officers?: string;
  status: string; reviewed_by?: number; reviewed_at?: string; narrative?: string;
  created_at: string; updated_at: string;
  officer_name?: string; officer_badge?: string;
  subject_first_name?: string; subject_last_name?: string; subject_dob?: string;
  incident_number?: string; incident_type?: string; reviewer_name?: string;
}

interface Stats { total: number; pending_review: number; reviewed: number; this_month: number; by_type: any[]; by_level: any[]; }

const FORCE_TYPES = ['verbal_command', 'physical_control', 'takedown', 'restraint', 'oc_spray', 'taser', 'baton', 'k9', 'less_lethal', 'firearm', 'vehicle', 'other'];
const FORCE_LEVELS = ['Level 1 - Cooperative', 'Level 2 - Resistive', 'Level 3 - Assaultive', 'Level 4 - Life Threatening'];
const STATUS_COLORS: Record<string, string> = { draft: '#888888', submitted: '#888888', reviewed: '#22c55e', returned: '#f59e0b' };

export default function UseOfForcePage() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [reports, setReports] = useState<UofReport[]>([]);
  const [selected, setSelected] = useState<UofReport | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reviewDialog, setReviewDialog] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [form, setForm] = useState({
    incident_id: '', subject_person_id: '', force_type: '', force_level: '',
    justification: '', subject_injuries: '', officer_injuries: '',
    de_escalation_attempted: false, de_escalation_details: '',
    weapons_used: '', body_camera_active: true, witness_officers: '',
    narrative: '',
  });

  const fetchReports = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), per_page: '50', ...(filterStatus ? { status: filterStatus } : {}), ...(searchQuery ? { search: searchQuery } : {}) });
      const res = await apiFetch<{ data: UofReport[]; pagination: any }>(`/use-of-force?${params}`);
      setReports(res.data || []);
      setTotalPages(res.pagination?.totalPages || 1);
    } catch (err: any) { setError(err?.message || 'Failed to load reports'); }
    finally { setLoading(false); }
  }, [page, filterStatus, searchQuery]);

  const fetchStats = useCallback(async () => {
    try { const s = await apiFetch<Stats>('/use-of-force/stats'); setStats(s); } catch { /* ok */ }
  }, []);

  useEffect(() => { fetchReports(); fetchStats(); }, [fetchReports, fetchStats]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.force_type) return;
    setSubmitting(true);
    try {
      const body = {
        ...form,
        incident_id: form.incident_id ? parseInt(form.incident_id, 10) : null,
        subject_person_id: form.subject_person_id ? parseInt(form.subject_person_id, 10) : null,
        witness_officers: form.witness_officers ? form.witness_officers.split(',').map(s => s.trim()).filter(Boolean) : [],
      };
      await apiFetch('/use-of-force', { method: 'POST', body: JSON.stringify(body) });
      setShowForm(false);
      setForm({ incident_id: '', subject_person_id: '', force_type: '', force_level: '', justification: '', subject_injuries: '', officer_injuries: '', de_escalation_attempted: false, de_escalation_details: '', weapons_used: '', body_camera_active: true, witness_officers: '', narrative: '' });
      await fetchReports({ silent: true });
      fetchStats();
    } catch (err: any) { setError(err?.message || 'Failed to submit report'); }
    finally { setSubmitting(false); }
  };

  const handleReview = async (decision: 'approved' | 'returned') => {
    if (!selected) return;
    try {
      await apiFetch(`/use-of-force/${selected.id}/review`, { method: 'PUT', body: JSON.stringify({ decision }) });
      setReviewDialog(false);
      await fetchReports({ silent: true });
      fetchStats();
      setSelected(null);
    } catch (err: any) { setError(err?.message || 'Review failed'); }
  };

  const isSuper = ['admin', 'manager', 'supervisor'].includes((user as any)?.role || '');

  // ── List Panel ──────────────────────────────────────
  const listContent = (
    <div className="flex flex-col h-full">
      {/* Stats bar */}
      {stats && (
        <div className="flex gap-3 px-3 py-2 border-b border-rmpg-700 bg-surface-sunken">
          {[
            { label: 'Total', value: stats.total, color: '#888888' },
            { label: 'Pending', value: stats.pending_review, color: '#f59e0b' },
            { label: 'Reviewed', value: stats.reviewed, color: '#22c55e' },
            { label: 'This Month', value: stats.this_month, color: '#888888' },
          ].map(s => (
            <div key={s.label} className="text-center">
              <div className="text-lg font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
              <div className="text-[8px] text-rmpg-500 uppercase">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 px-3 py-2 border-b border-rmpg-700">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500" />
          <input className="input-dark text-[10px] pl-7 w-full py-[3px]" placeholder="Search..." value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setPage(1); }} />
        </div>
        <select className="input-dark text-[10px] py-[3px] w-24" value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }}>
          <option value="">All Status</option>
          <option value="draft">Draft</option>
          <option value="submitted">Submitted</option>
          <option value="reviewed">Reviewed</option>
        </select>
        <button type="button" className="toolbar-btn toolbar-btn-primary text-[9px]" onClick={() => setShowForm(true)} style={{ padding: '2px 8px' }}>
          <Plus className="w-3 h-3" /> New
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-rmpg-400" /></div>}
        {!loading && reports.length === 0 && <EmptyState icon={Shield} title="No Reports" description="No use of force reports found" />}
        {reports.map(r => (
          <div
            key={r.id}
            role="button"
            tabIndex={0}
            onClick={() => setSelected(r)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setSelected(r);
              }
            }}
            className={`px-3 py-2 border-b border-rmpg-800 cursor-pointer transition-colors ${selected?.id === r.id ? 'bg-surface-raised border-l-2 border-l-red-500' : 'hover:bg-surface-raised'}`}>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 flex-shrink-0" style={{ background: STATUS_COLORS[r.status] || '#888', borderRadius: '1px' }} />
              <span className="text-[10px] font-bold text-white uppercase">{(r.force_type || '').replace(/_/g, ' ')}</span>
              <span className="ml-auto text-[9px] text-rmpg-500">{formatDate(r.created_at)}</span>
            </div>
            <div className="text-[9px] text-rmpg-400 mt-0.5">
              Officer: {r.officer_name || 'Unknown'} {r.force_level && `• ${r.force_level}`}
            </div>
            {r.subject_first_name && (
              <div className="text-[9px] text-rmpg-500">Subject: {r.subject_first_name} {r.subject_last_name}</div>
            )}
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 px-3 py-1.5 border-t border-rmpg-700 text-[9px] text-rmpg-400">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="toolbar-btn text-[9px]" style={{ padding: '1px 6px' }}>&larr;</button>
          <span>{page}/{totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="toolbar-btn text-[9px]" style={{ padding: '1px 6px' }}>&rarr;</button>
        </div>
      )}
    </div>
  );

  // ── Detail Panel ────────────────────────────────────
  const detailContent = selected ? (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <div className="flex items-center gap-2">
        <div className="w-3 h-3" style={{ background: STATUS_COLORS[selected.status] || '#888', borderRadius: '1px' }} />
        <h2 className="text-sm font-bold text-white uppercase">{(selected.force_type || '').replace(/_/g, ' ')} — UoF #{selected.id}</h2>
        <span className="ml-auto text-[9px] font-bold uppercase px-2 py-0.5 border" style={{ color: STATUS_COLORS[selected.status], borderColor: STATUS_COLORS[selected.status] + '60' }}>
          {selected.status?.replace(/_/g, ' ').toUpperCase() || 'UNKNOWN'}
        </span>
      </div>

      {/* Officer & Subject */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <div className="text-[9px] text-rmpg-500 uppercase font-bold">Reporting Officer</div>
          <div className="text-xs text-white">{selected.officer_name || 'Unknown'}</div>
          {selected.officer_badge && <div className="text-[9px] text-rmpg-400">Badge: {selected.officer_badge}</div>}
        </div>
        <div className="space-y-1">
          <div className="text-[9px] text-rmpg-500 uppercase font-bold">Subject</div>
          {selected.subject_first_name ? (
            <div className="text-xs text-white">{selected.subject_first_name} {selected.subject_last_name}</div>
          ) : <div className="text-xs text-rmpg-400">Not linked</div>}
        </div>
      </div>

      {/* Force Details */}
      <div className="border border-rmpg-700 bg-surface-sunken p-3 space-y-2">
        <div className="text-[9px] text-red-400 uppercase font-bold">Force Details</div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div><span className="text-rmpg-500 text-[9px]">Type:</span> <span className="text-white capitalize">{(selected.force_type || '').replace(/_/g, ' ')}</span></div>
          <div><span className="text-rmpg-500 text-[9px]">Level:</span> <span className="text-white">{selected.force_level || '—'}</span></div>
          <div><span className="text-rmpg-500 text-[9px]">Weapons Used:</span> <span className="text-white">{selected.weapons_used || 'None'}</span></div>
          <div><span className="text-rmpg-500 text-[9px]">Body Camera:</span> <span className={selected.body_camera_active ? 'text-green-400' : 'text-red-400'}>{selected.body_camera_active ? 'Active' : 'Inactive'}</span></div>
          <div><span className="text-rmpg-500 text-[9px]">De-escalation:</span> <span className={selected.de_escalation_attempted ? 'text-green-400' : 'text-amber-400'}>{selected.de_escalation_attempted ? 'Yes' : 'No'}</span></div>
          {selected.incident_number && <div><span className="text-rmpg-500 text-[9px]">Incident:</span> <span className="text-brand-400">{selected.incident_number}</span></div>}
        </div>
      </div>

      {/* Injuries */}
      {(selected.subject_injuries || selected.officer_injuries) && (
        <div className="border border-red-700/30 bg-red-900/10 p-3 space-y-2">
          <div className="text-[9px] text-red-400 uppercase font-bold">Injuries</div>
          {selected.subject_injuries && <div className="text-xs"><span className="text-rmpg-400">Subject:</span> <span className="text-white">{selected.subject_injuries}</span></div>}
          {selected.officer_injuries && <div className="text-xs"><span className="text-rmpg-400">Officer:</span> <span className="text-white">{selected.officer_injuries}</span></div>}
        </div>
      )}

      {/* Justification */}
      {selected.justification && (
        <div>
          <div className="text-[9px] text-rmpg-500 uppercase font-bold mb-1">Justification</div>
          <p className="text-xs text-rmpg-200 whitespace-pre-wrap">{selected.justification}</p>
        </div>
      )}

      {/* Narrative */}
      {selected.narrative && (
        <div>
          <div className="text-[9px] text-rmpg-500 uppercase font-bold mb-1">Narrative</div>
          <p className="text-xs text-rmpg-200 whitespace-pre-wrap">{selected.narrative}</p>
        </div>
      )}

      {/* Review Section */}
      {selected.reviewed_by && (
        <div className="border border-green-700/30 bg-green-900/10 p-3">
          <div className="text-[9px] text-green-400 uppercase font-bold mb-1">Supervisor Review</div>
          <div className="text-xs text-rmpg-200">Reviewed by {selected.reviewer_name} on {formatDateTime(selected.reviewed_at || '')}</div>
        </div>
      )}

      {/* Actions */}
      {isSuper && selected.status === 'submitted' && (
        <div className="flex gap-2 pt-2 border-t border-rmpg-700">
          <button type="button" className="toolbar-btn text-green-400 text-[9px]" onClick={() => handleReview('approved')} style={{ padding: '4px 12px' }}>
            <CheckCircle className="w-3 h-3" /> Approve
          </button>
          <button type="button" className="toolbar-btn text-amber-400 text-[9px]" onClick={() => handleReview('returned')} style={{ padding: '4px 12px' }}>
            <XCircle className="w-3 h-3" /> Return
          </button>
        </div>
      )}

      <div className="text-[8px] text-rmpg-600 pt-2">Created: {formatDateTime(selected.created_at)} | Updated: {formatDateTime(selected.updated_at)}</div>
    </div>
  ) : (
    <EmptyState icon={Shield} title="Select a Report" description="Click a use of force report to view details" />
  );

  return (
    <div className="p-4 space-y-3 h-full flex flex-col">
      <PanelTitleBar title="USE OF FORCE REPORTS" icon={Shield} />

      {error && <div className="px-3 py-2 bg-red-900/30 border border-red-700 text-red-400 text-xs">{error} <button className="ml-2 underline" onClick={() => setError('')}>dismiss</button></div>}

      <div className="flex-1 min-h-0">
        <SplitPanel left={listContent} right={detailContent} />
      </div>

      {/* Create Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setShowForm(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative w-full max-w-2xl mx-4 shadow-md panel-beveled" style={{ background: '#0a0a0a' }} onClick={e => e.stopPropagation()}>
            <div className="panel-title-bar">
              <div className="flex items-center gap-2">
                <Shield className="title-icon" />
                <span>NEW USE OF FORCE REPORT</span>
              </div>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Force Type <span className="text-red-400">*</span></label>
                  <select className="select-dark text-xs w-full mt-1" value={form.force_type} onChange={e => setForm(f => ({ ...f, force_type: e.target.value }))} required>
                    <option value="">-- Select --</option>
                    {FORCE_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ').toUpperCase()}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Force Level</label>
                  <select className="select-dark text-xs w-full mt-1" value={form.force_level} onChange={e => setForm(f => ({ ...f, force_level: e.target.value }))}>
                    <option value="">-- Select --</option>
                    {FORCE_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Linked Incident ID</label>
                  <input className="input-dark text-xs w-full mt-1" value={form.incident_id} onChange={e => setForm(f => ({ ...f, incident_id: e.target.value.replace(/\D/g, '') }))} placeholder="Optional" />
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Subject Person ID</label>
                  <input className="input-dark text-xs w-full mt-1" value={form.subject_person_id} onChange={e => setForm(f => ({ ...f, subject_person_id: e.target.value.replace(/\D/g, '') }))} placeholder="Optional" />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Justification</label>
                <RichTextArea className="input-dark text-xs w-full mt-1" rows={3} value={form.justification} onChange={e => setForm(f => ({ ...f, justification: e.target.value }))} placeholder="Legal justification for use of force..." />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Subject Injuries</label>
                  <input className="input-dark text-xs w-full mt-1" value={form.subject_injuries} onChange={e => setForm(f => ({ ...f, subject_injuries: e.target.value }))} placeholder="None, or describe" />
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Officer Injuries</label>
                  <input className="input-dark text-xs w-full mt-1" value={form.officer_injuries} onChange={e => setForm(f => ({ ...f, officer_injuries: e.target.value }))} placeholder="None, or describe" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Weapons Used</label>
                  <input className="input-dark text-xs w-full mt-1" value={form.weapons_used} onChange={e => setForm(f => ({ ...f, weapons_used: e.target.value }))} placeholder="None, taser, firearm, etc." />
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Witness Officers</label>
                  <input className="input-dark text-xs w-full mt-1" value={form.witness_officers} onChange={e => setForm(f => ({ ...f, witness_officers: e.target.value }))} placeholder="Comma-separated names" />
                </div>
              </div>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-xs text-rmpg-200 cursor-pointer">
                  <input type="checkbox" checked={form.de_escalation_attempted} onChange={e => setForm(f => ({ ...f, de_escalation_attempted: e.target.checked }))} className="w-4 h-4" />
                  De-escalation Attempted
                </label>
                <label className="flex items-center gap-2 text-xs text-rmpg-200 cursor-pointer">
                  <input type="checkbox" checked={form.body_camera_active} onChange={e => setForm(f => ({ ...f, body_camera_active: e.target.checked }))} className="w-4 h-4" />
                  Body Camera Active
                </label>
              </div>
              {form.de_escalation_attempted && (
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase font-semibold">De-escalation Details</label>
                  <RichTextArea className="input-dark text-xs w-full mt-1" rows={2} value={form.de_escalation_details} onChange={e => setForm(f => ({ ...f, de_escalation_details: e.target.value }))} />
                </div>
              )}
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Narrative</label>
                <RichTextArea className="input-dark text-xs w-full mt-1" rows={4} value={form.narrative} onChange={e => setForm(f => ({ ...f, narrative: e.target.value }))} placeholder="Detailed account of the incident..." />
              </div>
              <div className="flex justify-end gap-3 pt-3 border-t border-rmpg-700">
                <button type="button" onClick={() => setShowForm(false)} className="toolbar-btn" style={{ padding: '4px 12px' }}>Cancel</button>
                <button type="submit" className="toolbar-btn toolbar-btn-primary" disabled={submitting || !form.force_type} style={{ padding: '4px 12px' }}>
                  {submitting && <Loader2 className="w-3 h-3 animate-spin" />} Submit Report
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
