import React, { useState, useEffect } from 'react';
import { TrendingUp, Plus, CheckCircle, X, Clock, Loader2, Search } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { useToast } from '../../../components/ToastProvider';

interface PIP {
  id: number;
  officer_id: number;
  officer_name: string;
  supervisor_name: string;
  start_date: string;
  end_date: string;
  reason: string;
  goals: { text: string; completed?: boolean }[];
  milestones: { date: string; description: string; completed?: boolean }[];
  status: string;
  outcome: string;
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-amber-900/50 text-amber-400 border border-amber-700/50',
  completed: 'bg-green-900/50 text-green-400 border border-green-700/50',
  extended: 'bg-blue-900/50 text-blue-400 border border-blue-700/50',
  failed: 'bg-red-900/50 text-red-400 border border-red-700/50',
  cancelled: 'bg-rmpg-700 text-rmpg-400 border border-rmpg-600',
};

function fmtDate(d: string | null | undefined): string {
  if (!d) return '';
  try { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return d; }
}

export default function PIPsTab({ userRole }: { userRole: string }) {
  const { addToast } = useToast();
  const [pips, setPips] = useState<PIP[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [officers, setOfficers] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [form, setForm] = useState({ officer_id: '', start_date: '', end_date: '', reason: '', goals: [''] });

  const isManager = ['admin', 'manager', 'supervisor'].includes(userRole);

  const load = async () => {
    setLoading(true);
    try {
      try { const data = await apiFetch<any[]>('/hr/pips'); setPips(data); } catch { addToast('Failed to load PIPs', 'error'); }
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); apiFetch<any[]>('/personnel').then(d => setOfficers(d.filter((o: any) => o.status === 'active'))).catch(() => {}); }, []);

  // Escape to close form
  useEffect(() => {
    if (!showForm) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowForm(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showForm]);

  const handleSubmit = async () => {
    if (!form.officer_id) { addToast('Please select an officer', 'error'); return; }
    if (!form.start_date) { addToast('Start date is required', 'error'); return; }
    if (!form.end_date) { addToast('End date is required', 'error'); return; }
    if (!form.reason.trim()) { addToast('Reason is required', 'error'); return; }
    if (form.start_date > form.end_date) { addToast('End date must be after start date', 'error'); return; }
    const goals = form.goals.filter(g => g.trim()).map(text => ({ text, completed: false }));
    if (goals.length === 0) { addToast('At least one goal is required', 'error'); return; }
    setSubmitting(true);
    try { await apiFetch('/hr/pips', { method: 'POST', body: JSON.stringify({ ...form, officer_id: Number(form.officer_id), goals }) }); addToast('PIP created', 'success'); setShowForm(false); setForm({ officer_id: '', start_date: '', end_date: '', reason: '', goals: [''] }); load(); } catch { addToast('Failed to create PIP', 'error'); } finally { setSubmitting(false); }
  };

  const updateStatus = async (id: number, status: string) => {
    if (status === 'failed' && !window.confirm('Mark this PIP as failed? This will be recorded permanently.')) return;
    try { await apiFetch(`/hr/pips/${id}`, { method: 'PUT', body: JSON.stringify({ status }) }); addToast('PIP updated', 'success'); load(); } catch { addToast('Failed to update PIP', 'error'); }
  };

  const daysRemaining = (endDate: string) => {
    const diff = new Date(endDate).getTime() - Date.now();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  const filtered = pips.filter(p => {
    if (filterStatus !== 'all' && p.status !== filterStatus) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return p.officer_name.toLowerCase().includes(q) || p.reason.toLowerCase().includes(q) || p.supervisor_name?.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-bold text-white flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Performance Improvement Plans</h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500" />
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search PIPs..." aria-label="Search PIPs..." className="input-field text-xs py-1 pl-6 pr-2 w-44" />
          </div>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="input-field text-xs py-1 px-2">
            <option value="all">All Statuses</option>
            {Object.keys(STATUS_COLORS).map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
          {isManager && <button type="button" onClick={() => setShowForm(!showForm)} className="toolbar-btn toolbar-btn-success text-xs"><Plus className="w-3 h-3" /> New PIP</button>}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="group" aria-label="PIP statistics">
        <div className="panel-beveled p-2.5 text-center border-t-2 border-t-amber-500 transition-colors duration-200 hover:brightness-110"><p className="field-label">Active</p><p className="text-lg font-bold font-mono text-amber-400">{pips.filter(p => p.status === 'active').length}</p></div>
        <div className="panel-beveled p-2.5 text-center border-t-2 border-t-green-500 transition-colors duration-200 hover:brightness-110"><p className="field-label">Completed</p><p className="text-lg font-bold font-mono text-green-400">{pips.filter(p => p.status === 'completed').length}</p></div>
        <div className="panel-beveled p-2.5 text-center border-t-2 border-t-red-500 transition-colors duration-200 hover:brightness-110"><p className="field-label">Failed</p><p className="text-lg font-bold font-mono text-red-400">{pips.filter(p => p.status === 'failed').length}</p></div>
        <div className="panel-beveled p-2.5 text-center border-t-2 border-t-rmpg-500 transition-colors duration-200 hover:brightness-110"><p className="field-label">Total</p><p className="text-lg font-bold font-mono text-white">{pips.length}</p></div>
      </div>

      {showForm && isManager && (
        <div className="panel-beveled p-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="field-label">Officer *</label>
              <select value={form.officer_id} onChange={e => setForm(f => ({ ...f, officer_id: e.target.value }))} className="input-field w-full text-xs">
                <option value="">Select...</option>
                {officers.map(o => <option key={o.id} value={o.id}>{o.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">Start Date *</label>
              <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} className="input-field w-full text-xs" />
            </div>
            <div>
              <label className="field-label">End Date *</label>
              <input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} className="input-field w-full text-xs" />
            </div>
          </div>
          <div>
            <label className="field-label">Reason *</label>
            <textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} className="input-field w-full text-xs" rows={3} placeholder="Describe the performance issues requiring improvement..." />
          </div>
          <div>
            <label className="field-label">Goals *</label>
            {form.goals.map((g, i) => (
              <div key={i} className="flex gap-2 mb-1">
                <input value={g} onChange={e => { const goals = [...form.goals]; goals[i] = e.target.value; setForm(f => ({ ...f, goals })); }} className="input-field flex-1 text-xs" placeholder={`Goal ${i + 1}`} />
                {form.goals.length > 1 && <button type="button" onClick={() => setForm(f => ({ ...f, goals: f.goals.filter((_, j) => j !== i) }))} className="toolbar-btn toolbar-btn-danger text-xs"><X className="w-3 h-3" /></button>}
              </div>
            ))}
            <button type="button" onClick={() => setForm(f => ({ ...f, goals: [...f.goals, ''] }))} className="toolbar-btn text-[9px] mt-1"><Plus className="w-3 h-3" /> Add Goal</button>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={handleSubmit} disabled={submitting || !form.officer_id || !form.start_date || !form.end_date} className="toolbar-btn toolbar-btn-success text-xs disabled:opacity-50">{submitting ? <><Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> Creating...</> : 'Create PIP'}</button>
            <button type="button" onClick={() => setShowForm(false)} disabled={submitting} className="toolbar-btn text-xs">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 text-rmpg-400 py-12 text-xs"><Loader2 className="w-5 h-5 animate-spin text-brand-400" role="status" aria-label="Loading PIPs" /> Loading PIPs...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16" role="status">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-sunken">
            <TrendingUp className="w-7 h-7 text-rmpg-600" />
          </div>
          <p className="text-sm text-rmpg-400 font-medium">{searchQuery || filterStatus !== 'all' ? 'No PIPs match your filters' : 'No PIPs found'}</p>
        </div>
      ) : (
        <div className="space-y-3" role="list" aria-label="Performance improvement plans">
          {filtered.map(p => {
            const days = daysRemaining(p.end_date);
            const goalsCompleted = p.goals.filter(g => g.completed).length;
            return (
              <div key={p.id} role="listitem" className="panel-beveled p-3 hover:bg-surface-raised/30 hover:shadow-sm transition-all duration-150">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`inline-flex px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase rounded-sm ${STATUS_COLORS[p.status] || STATUS_COLORS.active}`}>{p.status}</span>
                      <span className="text-xs font-bold text-white">{p.officer_name}</span>
                      {p.status === 'active' && <span className={`text-[10px] ${days <= 7 ? 'text-red-400' : days <= 14 ? 'text-amber-400' : 'text-rmpg-400'}`}><Clock className="w-3 h-3 inline" /> {days}d remaining</span>}
                    </div>
                    <p className="text-[10px] text-rmpg-300">{p.reason}</p>
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-rmpg-400">
                      <span>{fmtDate(p.start_date)} to {fmtDate(p.end_date)}</span>
                      <span>Supervisor: {p.supervisor_name}</span>
                      <span>Goals: {goalsCompleted}/{p.goals.length}</span>
                    </div>
                    {p.goals.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {p.goals.map((g, i) => (
                          <div key={i} className="flex items-center gap-2 text-[10px]">
                            <span className={g.completed ? 'text-green-400' : 'text-rmpg-400'}>{g.completed ? <CheckCircle className="w-3 h-3 inline" /> : '[ ]'}</span>
                            <span className={g.completed ? 'text-rmpg-400 line-through' : 'text-rmpg-200'}>{g.text}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {isManager && p.status === 'active' && (
                    <div className="flex gap-1">
                      <button type="button" onClick={() => updateStatus(p.id, 'completed')} className="toolbar-btn toolbar-btn-success text-[9px]">Complete</button>
                      <button type="button" onClick={() => updateStatus(p.id, 'extended')} className="toolbar-btn text-[9px]">Extend</button>
                      <button type="button" onClick={() => updateStatus(p.id, 'failed')} className="toolbar-btn toolbar-btn-danger text-[9px]">Fail</button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
