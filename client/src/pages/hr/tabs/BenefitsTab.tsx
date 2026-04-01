import React, { useState, useEffect } from 'react';
import { Heart, Plus, Loader2, Search } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { useToast } from '../../../components/ToastProvider';

interface Benefit {
  id: number;
  officer_id: number;
  officer_name: string;
  benefit_type: string;
  plan_name: string;
  provider: string;
  coverage_level: string;
  employee_cost: number;
  employer_cost: number;
  effective_date: string;
  end_date: string;
  status: string;
}

const BENEFIT_TYPES = ['health', 'dental', 'vision', 'life', '401k', 'hsa', 'fsa', 'disability', 'other'];

const COVERAGE_LABELS: Record<string, string> = {
  individual: 'Individual',
  individual_spouse: 'Individual + Spouse',
  family: 'Family',
};

export default function BenefitsTab({ userRole }: { userRole: string }) {
  const { addToast } = useToast();
  const [benefits, setBenefits] = useState<Benefit[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [officers, setOfficers] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [form, setForm] = useState({ officer_id: '', benefit_type: 'health', plan_name: '', provider: '', coverage_level: 'individual', employee_cost: 0, employer_cost: 0, effective_date: '' });

  const isManager = ['admin', 'manager'].includes(userRole);

  const load = async () => {
    setLoading(true);
    try {
      try { const data = await apiFetch<any[]>('/hr/benefits'); setBenefits(data); } catch { addToast('Failed to load benefits', 'error'); }
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
    if (!form.benefit_type) { addToast('Benefit type is required', 'error'); return; }
    setSubmitting(true);
    try { await apiFetch('/hr/benefits', { method: 'POST', body: JSON.stringify({ ...form, officer_id: Number(form.officer_id) }) }); addToast('Benefit added', 'success'); setShowForm(false); setForm({ officer_id: '', benefit_type: 'health', plan_name: '', provider: '', coverage_level: 'individual', employee_cost: 0, employer_cost: 0, effective_date: '' }); load(); } catch { addToast('Failed to add benefit', 'error'); } finally { setSubmitting(false); }
  };

  // Filter then group by officer
  const filteredBenefits = benefits.filter(b => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return b.officer_name?.toLowerCase().includes(q) || b.benefit_type.toLowerCase().includes(q) || b.plan_name?.toLowerCase().includes(q) || b.provider?.toLowerCase().includes(q);
  });

  const grouped = filteredBenefits.reduce<Record<string, Benefit[]>>((acc, b) => {
    const key = b.officer_name || `Officer ${b.officer_id}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(b);
    return acc;
  }, {});

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-bold text-white flex items-center gap-2"><Heart className="w-4 h-4" /> Benefits Enrollment</h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500 pointer-events-none" aria-hidden="true" />
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search benefits..." aria-label="Search benefits by officer, type, or plan" className="input-field text-xs py-1 pl-6 pr-2 w-48 focus:ring-1 focus:ring-brand-500/50 transition-shadow duration-150" />
          </div>
          {isManager && <button type="button" onClick={() => setShowForm(!showForm)} className="toolbar-btn toolbar-btn-success text-xs"><Plus className="w-3 h-3" /> Add Benefit</button>}
        </div>
      </div>

      {showForm && isManager && (
        <div className="panel-beveled p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="field-label">Officer *</label>
              <select value={form.officer_id} onChange={e => setForm(f => ({ ...f, officer_id: e.target.value }))} className="input-field w-full text-xs">
                <option value="">Select...</option>
                {officers.map(o => <option key={o.id} value={o.id}>{o.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">Type *</label>
              <select value={form.benefit_type} onChange={e => setForm(f => ({ ...f, benefit_type: e.target.value }))} className="input-field w-full text-xs">
                {BENEFIT_TYPES.map(t => <option key={t} value={t}>{t === '401k' ? '401(k)' : t === 'hsa' ? 'HSA' : t === 'fsa' ? 'FSA' : t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">Plan Name</label>
              <input value={form.plan_name} onChange={e => setForm(f => ({ ...f, plan_name: e.target.value }))} className="input-field w-full text-xs" placeholder="e.g. Blue Cross PPO" />
            </div>
            <div>
              <label className="field-label">Provider</label>
              <input value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))} className="input-field w-full text-xs" placeholder="e.g. Blue Cross" />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="field-label">Coverage</label>
              <select value={form.coverage_level} onChange={e => setForm(f => ({ ...f, coverage_level: e.target.value }))} className="input-field w-full text-xs">
                <option value="individual">Individual</option>
                <option value="individual_spouse">Individual + Spouse</option>
                <option value="family">Family</option>
              </select>
            </div>
            <div>
              <label className="field-label">Employee Cost ($/mo)</label>
              <input type="number" min="0" step="0.01" value={form.employee_cost} onChange={e => setForm(f => ({ ...f, employee_cost: Number(e.target.value) }))} className="input-field w-full text-xs tabular-nums" />
            </div>
            <div>
              <label className="field-label">Employer Cost ($/mo)</label>
              <input type="number" min="0" step="0.01" value={form.employer_cost} onChange={e => setForm(f => ({ ...f, employer_cost: Number(e.target.value) }))} className="input-field w-full text-xs tabular-nums" />
            </div>
            <div>
              <label className="field-label">Effective Date</label>
              <input type="date" value={form.effective_date} onChange={e => setForm(f => ({ ...f, effective_date: e.target.value }))} className="input-field w-full text-xs" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={handleSubmit} disabled={submitting || !form.officer_id} className="toolbar-btn toolbar-btn-success text-xs disabled:opacity-50">{submitting ? <><Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> Saving...</> : 'Save'}</button>
            <button type="button" onClick={() => setShowForm(false)} disabled={submitting} className="toolbar-btn text-xs">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 text-rmpg-400 py-12 text-xs"><Loader2 className="w-5 h-5 animate-spin text-brand-400" role="status" aria-label="Loading benefits" /> Loading benefits...</div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="text-center py-16" role="status">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-sunken">
            <Heart className="w-7 h-7 text-rmpg-600" />
          </div>
          <p className="text-sm text-rmpg-400 font-medium">{searchQuery ? 'No benefits match your search' : 'No benefits records found'}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([name, bens]) => (
            <div key={name} className="panel-beveled p-3">
              <h3 className="text-xs font-bold text-white mb-2">{name}</h3>
              <div className="space-y-1">
                {bens.map(b => (
                  <div key={b.id} className="flex items-center justify-between text-[10px] py-1.5 border-b border-rmpg-700 last:border-0 hover:bg-surface-raised/30 transition-colors duration-150">
                    <div className="flex items-center gap-3">
                      <span className="text-white font-bold uppercase">{b.benefit_type === '401k' ? '401(k)' : b.benefit_type === 'hsa' ? 'HSA' : b.benefit_type === 'fsa' ? 'FSA' : b.benefit_type}</span>
                      <span className="text-rmpg-300">{b.plan_name}</span>
                      <span className="text-rmpg-400">{b.provider}</span>
                      <span className="text-rmpg-400">{COVERAGE_LABELS[b.coverage_level] || b.coverage_level}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-rmpg-300 tabular-nums">EE: ${b.employee_cost.toFixed(2)}/mo</span>
                      <span className="text-rmpg-300 tabular-nums">ER: ${b.employer_cost.toFixed(2)}/mo</span>
                      <span className={`px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase rounded-sm ${b.status === 'active' ? 'bg-green-900/50 text-green-400 border border-green-700/50' : 'bg-rmpg-700 text-rmpg-400 border border-rmpg-700'}`}>{(b.status || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
