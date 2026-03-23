import React, { useState, useEffect } from 'react';
import { Heart, Plus } from 'lucide-react';
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

export default function BenefitsTab({ userRole }: { userRole: string }) {
  const { addToast } = useToast();
  const [benefits, setBenefits] = useState<Benefit[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [officers, setOfficers] = useState<any[]>([]);
  const [form, setForm] = useState({ officer_id: '', benefit_type: 'health', plan_name: '', provider: '', coverage_level: 'individual', employee_cost: 0, employer_cost: 0, effective_date: '' });

  const isManager = ['admin', 'manager'].includes(userRole);

  const load = async () => {
    setLoading(true);
    try {
      try { const data = await apiFetch<any[]>('/hr/benefits'); setBenefits(data); } catch { /* handled */ }
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); apiFetch<any[]>('/personnel').then(d => setOfficers(d.filter((o: any) => o.status === 'active'))); }, []);

  const handleSubmit = async () => {
    if (!form.officer_id || !form.benefit_type) { addToast('Officer and type required', 'error'); return; }
    try { await apiFetch('/hr/benefits', { method: 'POST', body: JSON.stringify({ ...form, officer_id: Number(form.officer_id) }) }); addToast('Benefit added', 'success'); setShowForm(false); load(); } catch { /* handled */ }
  };

  // Group by officer
  const grouped = benefits.reduce<Record<string, Benefit[]>>((acc, b) => {
    const key = b.officer_name || `Officer ${b.officer_id}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(b);
    return acc;
  }, {});

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-white flex items-center gap-2"><Heart className="w-4 h-4" /> Benefits Enrollment</h2>
        {isManager && <button type="button" onClick={() => setShowForm(!showForm)} className="toolbar-btn toolbar-btn-success text-xs"><Plus className="w-3 h-3" /> Add Benefit</button>}
      </div>

      {showForm && isManager && (
        <div className="panel-beveled p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="field-label">Officer</label>
              <select value={form.officer_id} onChange={e => setForm(f => ({ ...f, officer_id: e.target.value }))} className="input-field w-full text-xs">
                <option value="">Select...</option>
                {officers.map(o => <option key={o.id} value={o.id}>{o.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">Type</label>
              <select value={form.benefit_type} onChange={e => setForm(f => ({ ...f, benefit_type: e.target.value }))} className="input-field w-full text-xs">
                {BENEFIT_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">Plan Name</label>
              <input value={form.plan_name} onChange={e => setForm(f => ({ ...f, plan_name: e.target.value }))} className="input-field w-full text-xs" />
            </div>
            <div>
              <label className="field-label">Provider</label>
              <input value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))} className="input-field w-full text-xs" />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="field-label">Coverage</label>
              <select value={form.coverage_level} onChange={e => setForm(f => ({ ...f, coverage_level: e.target.value }))} className="input-field w-full text-xs">
                <option value="individual">Individual</option>
                <option value="individual_spouse">Individual + Spouse</option>
                <option value="family">Family</option>
              </select>
            </div>
            <div>
              <label className="field-label">Employee Cost</label>
              <input type="number" value={form.employee_cost} onChange={e => setForm(f => ({ ...f, employee_cost: Number(e.target.value) }))} className="input-field w-full text-xs" />
            </div>
            <div>
              <label className="field-label">Employer Cost</label>
              <input type="number" value={form.employer_cost} onChange={e => setForm(f => ({ ...f, employer_cost: Number(e.target.value) }))} className="input-field w-full text-xs" />
            </div>
            <div>
              <label className="field-label">Effective Date</label>
              <input type="date" value={form.effective_date} onChange={e => setForm(f => ({ ...f, effective_date: e.target.value }))} className="input-field w-full text-xs" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={handleSubmit} className="toolbar-btn toolbar-btn-success text-xs">Save</button>
            <button type="button" onClick={() => setShowForm(false)} className="toolbar-btn text-xs">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center text-rmpg-400 py-8 text-xs">Loading...</div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="text-center text-rmpg-400 py-8 text-xs">No benefits records found</div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([name, bens]) => (
            <div key={name} className="panel-beveled p-3">
              <h3 className="text-xs font-bold text-white mb-2">{name}</h3>
              <div className="space-y-1">
                {bens.map(b => (
                  <div key={b.id} className="flex items-center justify-between text-[10px] py-1 border-b border-rmpg-700 last:border-0">
                    <div className="flex items-center gap-3">
                      <span className="text-white font-bold uppercase">{b.benefit_type}</span>
                      <span className="text-rmpg-300">{b.plan_name}</span>
                      <span className="text-rmpg-400">{b.provider}</span>
                      <span className="text-rmpg-400">{b.coverage_level}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-rmpg-300">EE: ${b.employee_cost}/mo</span>
                      <span className="text-rmpg-300">ER: ${b.employer_cost}/mo</span>
                      <span className={`px-1.5 py-0.5 ${b.status === 'active' ? 'bg-green-900/50 text-green-400' : 'bg-rmpg-700 text-rmpg-400'}`}>{b.status}</span>
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
