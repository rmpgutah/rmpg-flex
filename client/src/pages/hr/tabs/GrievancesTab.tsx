import React, { useState, useEffect } from 'react';
import { Plus, AlertOctagon, Clock, CheckCircle, Search, Loader2 } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { useToast } from '../../../components/ToastProvider';
import { useAuth } from '../../../context/AuthContext';
import { useFormDraft } from '../../../hooks/useFormDraft';
import UnsavedChangesGuard from '../../../components/UnsavedChangesGuard';
import FloatingSaveBar from '../../../components/FloatingSaveBar';

interface Grievance {
  id: number;
  officer_id: number;
  officer_name: string;
  type: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  assigned_to: number | null;
  assigned_to_name: string | null;
  resolution: string | null;
  filed_at: string;
  resolved_at: string | null;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  filed: 'bg-gray-900/50 text-gray-400 border border-gray-700/50',
  under_review: 'bg-amber-900/50 text-amber-400 border border-amber-700/50',
  investigation: 'bg-purple-900/50 text-purple-400 border border-purple-700/50',
  mediation: 'bg-gray-900/50 text-gray-400 border border-gray-700/50',
  resolved: 'bg-green-900/50 text-green-400 border border-green-700/50',
  dismissed: 'bg-rmpg-700 text-rmpg-400 border border-rmpg-700',
  appealed: 'bg-red-900/50 text-red-400 border border-red-700/50',
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'text-rmpg-400',
  normal: 'text-gray-400',
  high: 'text-amber-400',
  urgent: 'text-red-400',
};

function fmtDate(d: string | null | undefined): string {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return d.substring(0, 10); }
}

const EMPTY_FORM = { type: 'general', subject: '', description: '', priority: 'normal' };

export default function GrievancesTab() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [grievances, setGrievances] = useState<Grievance[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const {
    form,
    setForm,
    isDirty,
    wasRestored,
    clearDraft,
    snapshot,
  } = useFormDraft<typeof EMPTY_FORM>({
    storageKey: 'rmpg_hr_grievance_tab_form',
    defaultValue: EMPTY_FORM,
    isActive: showForm,
  });

  const isManager = ['admin', 'manager', 'supervisor'].includes(user?.role || '');

  const load = async () => {
    setLoading(true);
    try {
      const params = filterStatus !== 'all' ? `?status=${filterStatus}` : '';
      const data = await apiFetch<Grievance[]>(`/hr/grievances${params}`);
      setGrievances(data);
    } catch { /* handled */ } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [filterStatus]);

  // Escape to close form
  useEffect(() => {
    if (!showForm) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowForm(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showForm]);

  const handleSubmit = async () => {
    if (!form.subject.trim()) { addToast('Subject is required', 'error'); return; }
    if (!form.description.trim()) { addToast('Description is required', 'error'); return; }
    setSubmitting(true);
    try {
      await apiFetch('/hr/grievances', { method: 'POST', body: JSON.stringify(form) });
      addToast('Grievance filed successfully', 'success'); setShowForm(false); clearDraft(); load();
    } catch { addToast('Failed to file grievance', 'error'); } finally { setSubmitting(false); }
  };

  const updateStatus = async (id: number, status: string) => {
    if (status === 'dismissed' && !window.confirm('Dismiss this grievance? This action cannot be undone.')) return;
    try {
      await apiFetch(`/hr/grievances/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
      addToast('Status updated', 'success'); load();
    } catch { addToast('Failed to update status', 'error'); }
  };

  // Client-side search filter
  const filtered = grievances.filter(g => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return g.subject.toLowerCase().includes(q) || g.officer_name.toLowerCase().includes(q) || g.description.toLowerCase().includes(q) || g.type.toLowerCase().includes(q);
  });

  return (
    <div className="p-4 space-y-4">
      <UnsavedChangesGuard hasUnsavedChanges={isDirty} />
      <FloatingSaveBar
        visible={showForm && isDirty}
        onSave={handleSubmit}
        onCancel={() => { if (isDirty && !window.confirm('Discard unsaved changes?')) return; setShowForm(false); clearDraft(); }}
        isSaving={submitting}
        saveLabel="Submit Grievance"
      />
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-bold text-white flex items-center gap-2"><AlertOctagon className="w-4 h-4" /> Grievances</h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500 pointer-events-none" aria-hidden="true" />
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search grievances..." aria-label="Search grievances by subject, officer, or type" className="input-field text-xs py-1 pl-6 pr-2 w-48 focus:ring-1 focus:ring-brand-500/50 transition-shadow duration-150" />
          </div>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="input-field text-xs py-1 px-2">
            <option value="all">All Statuses</option>
            {Object.keys(STATUS_COLORS).map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
          <button type="button" onClick={() => { setShowForm(!showForm); if (!showForm) snapshot(); }} className="toolbar-btn toolbar-btn-success text-xs"><Plus className="w-3 h-3" /> File Grievance</button>
        </div>
      </div>

      {showForm && (
        <div className="panel-beveled p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Type</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="input-field w-full text-xs">
                <option value="general">General</option>
                <option value="workplace">Workplace</option>
                <option value="harassment">Harassment</option>
                <option value="discrimination">Discrimination</option>
                <option value="safety">Safety</option>
                <option value="policy">Policy</option>
              </select>
            </div>
            <div>
              <label className="field-label">Priority</label>
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className="input-field w-full text-xs">
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>
          <div>
            <label className="field-label">Subject *</label>
            <input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} className="input-field w-full text-xs" placeholder="Brief subject line" maxLength={200} required autoComplete="off" onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }} />
          </div>
          <div>
            <label className="field-label">Description *</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="input-field w-full text-xs" rows={4} placeholder="Detailed description of the grievance..." />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={handleSubmit} disabled={submitting || !form.subject.trim() || !form.description.trim()} className="toolbar-btn toolbar-btn-success text-xs disabled:opacity-50">{submitting ? <><Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> Submitting...</> : 'Submit Grievance'}</button>
            <button type="button" onClick={() => setShowForm(false)} disabled={submitting} className="toolbar-btn text-xs">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 text-rmpg-400 py-12 text-xs"><Loader2 className="w-5 h-5 animate-spin text-brand-400" role="status" aria-label="Loading grievances" /> Loading grievances...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16" role="status">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-sunken">
            <AlertOctagon className="w-7 h-7 text-rmpg-600" />
          </div>
          <p className="text-sm text-rmpg-400 font-medium">{searchQuery ? 'No grievances match your search' : 'No grievances found'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(g => (
            <div key={g.id} className="panel-beveled p-3 hover:bg-surface-raised/50 hover:shadow-sm transition-all duration-200 hover:border-rmpg-500" role="article" aria-label={`Grievance: ${g.subject}`}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`inline-flex px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase rounded-sm ${STATUS_COLORS[g.status] || STATUS_COLORS.filed}`}>{g.status.replace(/_/g, ' ')}</span>
                    <span className="text-[10px] text-rmpg-400 uppercase">{g.type}</span>
                    <span className={`text-[10px] font-medium ${PRIORITY_COLORS[g.priority] || 'text-rmpg-500'}`}>{g.priority}</span>
                  </div>
                  <h3 className="text-xs font-bold text-white truncate max-w-md">{g.subject}</h3>
                  <p className="text-[10px] text-rmpg-300 mt-1 line-clamp-2">{g.description}</p>
                  <div className="flex items-center gap-3 mt-2 text-[10px] text-rmpg-400">
                    <span>Filed by: {g.officer_name}</span>
                    <span>Date: {fmtDate(g.filed_at)}</span>
                    {g.assigned_to_name && <span>Assigned: {g.assigned_to_name}</span>}
                    {g.resolved_at && <span>Resolved: {fmtDate(g.resolved_at)}</span>}
                  </div>
                </div>
                {isManager && g.status !== 'resolved' && g.status !== 'dismissed' && (
                  <div className="flex gap-1">
                    {g.status === 'filed' && <button type="button" onClick={() => updateStatus(g.id, 'under_review')} className="toolbar-btn text-[9px]">Review</button>}
                    {g.status === 'under_review' && <button type="button" onClick={() => updateStatus(g.id, 'investigation')} className="toolbar-btn text-[9px]">Investigate</button>}
                    <button type="button" onClick={() => updateStatus(g.id, 'resolved')} className="toolbar-btn toolbar-btn-success text-[9px]"><CheckCircle className="w-3 h-3" /></button>
                    <button type="button" onClick={() => updateStatus(g.id, 'dismissed')} className="toolbar-btn toolbar-btn-danger text-[9px]">Dismiss</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
