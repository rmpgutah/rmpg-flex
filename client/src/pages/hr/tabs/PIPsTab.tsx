import React, { useState, useEffect } from 'react';
import { TrendingUp, Plus, CheckCircle, X, Clock } from 'lucide-react';
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

export default function PIPsTab({ userRole }: { userRole: string }) {
  const { addToast } = useToast();
  const [pips, setPips] = useState<PIP[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [officers, setOfficers] = useState<any[]>([]);
  const [form, setForm] = useState({ officer_id: '', start_date: '', end_date: '', reason: '', goals: [''] });

  const isManager = ['admin', 'manager', 'supervisor'].includes(userRole);

  const load = async () => {
    setLoading(true);
    try {
      try { const data = await apiFetch<any[]>('/hr/pips'); setPips(data); } catch { /* handled */ }
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); apiFetch<any[]>('/personnel').then(d => setOfficers(d.filter((o: any) => o.status === 'active'))); }, []);

  const handleSubmit = async () => {
    if (!form.officer_id || !form.start_date || !form.end_date || !form.reason) { addToast('All fields required', 'error'); return; }
    const goals = form.goals.filter(g => g.trim()).map(text => ({ text, completed: false }));
    try { await apiFetch('/hr/pips', { method: 'POST', body: JSON.stringify({ ...form, officer_id: Number(form.officer_id), goals }) }); addToast('PIP created', 'success'); setShowForm(false); setForm({ officer_id: '', start_date: '', end_date: '', reason: '', goals: [''] }); load(); } catch { /* handled */ }
  };

  const updateStatus = async (id: number, status: string) => {
    try { await apiFetch(`/hr/pips/${id}`, { method: 'PUT', body: JSON.stringify({ status }) }); addToast('PIP updated', 'success'); load(); } catch { /* handled */ }
  };

  const daysRemaining = (endDate: string) => {
    const diff = new Date(endDate).getTime() - Date.now();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-white flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Performance Improvement Plans</h2>
        {isManager && <button onClick={() => setShowForm(!showForm)} className="toolbar-btn toolbar-btn-success text-xs"><Plus className="w-3 h-3" /> New PIP</button>}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-2">
        <div className="panel-beveled p-2 text-center"><p className="field-label">Active</p><p className="text-lg font-bold font-mono text-amber-400">{pips.filter(p => p.status === 'active').length}</p></div>
        <div className="panel-beveled p-2 text-center"><p className="field-label">Completed</p><p className="text-lg font-bold font-mono text-green-400">{pips.filter(p => p.status === 'completed').length}</p></div>
        <div className="panel-beveled p-2 text-center"><p className="field-label">Failed</p><p className="text-lg font-bold font-mono text-red-400">{pips.filter(p => p.status === 'failed').length}</p></div>
        <div className="panel-beveled p-2 text-center"><p className="field-label">Total</p><p className="text-lg font-bold font-mono text-white">{pips.length}</p></div>
      </div>

      {showForm && isManager && (
        <div className="panel-beveled p-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="field-label">Officer</label>
              <select value={form.officer_id} onChange={e => setForm(f => ({ ...f, officer_id: e.target.value }))} className="input-field w-full text-xs">
                <option value="">Select...</option>
                {officers.map(o => <option key={o.id} value={o.id}>{o.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">Start Date</label>
              <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} className="input-field w-full text-xs" />
            </div>
            <div>
              <label className="field-label">End Date</label>
              <input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} className="input-field w-full text-xs" />
            </div>
          </div>
          <div>
            <label className="field-label">Reason</label>
            <textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} className="input-field w-full text-xs" rows={3} />
          </div>
          <div>
            <label className="field-label">Goals</label>
            {form.goals.map((g, i) => (
              <div key={i} className="flex gap-2 mb-1">
                <input value={g} onChange={e => { const goals = [...form.goals]; goals[i] = e.target.value; setForm(f => ({ ...f, goals })); }} className="input-field flex-1 text-xs" placeholder={`Goal ${i + 1}`} />
                {form.goals.length > 1 && <button onClick={() => setForm(f => ({ ...f, goals: f.goals.filter((_, j) => j !== i) }))} className="toolbar-btn toolbar-btn-danger text-xs"><X className="w-3 h-3" /></button>}
              </div>
            ))}
            <button onClick={() => setForm(f => ({ ...f, goals: [...f.goals, ''] }))} className="toolbar-btn text-[9px] mt-1"><Plus className="w-3 h-3" /> Add Goal</button>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSubmit} className="toolbar-btn toolbar-btn-success text-xs">Create PIP</button>
            <button onClick={() => setShowForm(false)} className="toolbar-btn text-xs">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center text-rmpg-400 py-8 text-xs">Loading...</div>
      ) : pips.length === 0 ? (
        <div className="text-center text-rmpg-400 py-8 text-xs">No PIPs found</div>
      ) : (
        <div className="space-y-3">
          {pips.map(p => {
            const days = daysRemaining(p.end_date);
            const goalsCompleted = p.goals.filter(g => g.completed).length;
            return (
              <div key={p.id} className="panel-beveled p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`inline-flex px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_COLORS[p.status] || STATUS_COLORS.active}`}>{p.status}</span>
                      <span className="text-xs font-bold text-white">{p.officer_name}</span>
                      {p.status === 'active' && <span className={`text-[10px] ${days <= 7 ? 'text-red-400' : days <= 14 ? 'text-amber-400' : 'text-rmpg-400'}`}><Clock className="w-3 h-3 inline" /> {days}d remaining</span>}
                    </div>
                    <p className="text-[10px] text-rmpg-300">{p.reason}</p>
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-rmpg-400">
                      <span>{p.start_date} to {p.end_date}</span>
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
                      <button onClick={() => updateStatus(p.id, 'completed')} className="toolbar-btn toolbar-btn-success text-[9px]">Complete</button>
                      <button onClick={() => updateStatus(p.id, 'extended')} className="toolbar-btn text-[9px]">Extend</button>
                      <button onClick={() => updateStatus(p.id, 'failed')} className="toolbar-btn toolbar-btn-danger text-[9px]">Fail</button>
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
