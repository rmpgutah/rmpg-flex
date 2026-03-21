// ============================================================
// RMPG Flex — Payroll & Accounting Module
// Four sub-tabs: Pay Periods, Payroll, Pay Rates, Deductions
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  DollarSign, Plus, RefreshCw, Filter, Edit2, Check,
  Calculator, CheckCircle, Clock, ArrowRight,
  ChevronDown, ChevronUp, Trash2,
} from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { localToday } from '../../../utils/dateUtils';
import PanelTitleBar from '../../../components/PanelTitleBar';

// ─── Types ─────────────────────────────────────────────────

interface PayPeriod {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  status: string; // draft, processing, finalized, paid
  created_at: string;
}

interface PayrollEntry {
  id: number;
  pay_period_id: number;
  user_id: string;
  employee_name: string;
  badge_number?: string;
  regular_hours: number;
  overtime_hours: number;
  gross_pay: number;
  total_deductions: number;
  net_pay: number;
  status: string; // pending, calculated, approved
  hourly_rate?: number;
}

interface PayRate {
  id: number;
  user_id: string;
  employee_name: string;
  badge_number?: string;
  rate_type: string; // hourly, salary
  hourly_rate: number;
  overtime_multiplier: number;
  effective_date: string;
  end_date?: string;
  is_current: boolean;
}

interface Deduction {
  id: number;
  user_id: string;
  employee_name: string;
  deduction_name: string;
  deduction_type: string; // federal_tax, state_tax, insurance, retirement, garnishment, other
  amount: number;
  is_percentage: boolean;
  is_pretax: boolean;
  is_active: boolean;
}

const SUB_TABS = [
  { id: 'periods', label: 'Pay Periods' },
  { id: 'payroll', label: 'Payroll' },
  { id: 'rates', label: 'Pay Rates' },
  { id: 'deductions', label: 'Deductions' },
] as const;

const PERIOD_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-500/20 text-gray-400 border-gray-500/40',
  processing: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  finalized: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  paid: 'bg-green-500/20 text-green-300 border-green-500/40',
};

const ENTRY_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-500/20 text-gray-400 border-gray-500/40',
  calculated: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  approved: 'bg-green-500/20 text-green-300 border-green-500/40',
};

const fmtCurrency = (v: number) => `$${v.toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,')}`;

// ─── Component ─────────────────────────────────────────────

export default function PayrollAccounting() {
  const [subTab, setSubTab] = useState<string>('periods');

  return (
    <div className="flex flex-col h-full">
      <PanelTitleBar title="Payroll & Accounting" icon={DollarSign}>
        <div className="flex items-center gap-0.5">
          {SUB_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className={`px-2.5 py-1 text-[11px] rounded-sm transition-colors ${
                subTab === t.id
                  ? 'bg-brand-500/25 text-white'
                  : 'text-rmpg-400 hover:text-white hover:bg-[#1a2636]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </PanelTitleBar>

      <div className="flex-1 overflow-auto p-3">
        {subTab === 'periods' && <PayPeriodsTab />}
        {subTab === 'payroll' && <PayrollTab />}
        {subTab === 'rates' && <PayRatesTab />}
        {subTab === 'deductions' && <DeductionsTab />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Pay Periods Tab
// ═══════════════════════════════════════════════════════════

function PayPeriodsTab() {
  const [periods, setPeriods] = useState<PayPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [formData, setFormData] = useState({ name: '', start_date: '', end_date: '' });
  const [saving, setSaving] = useState(false);

  const loadPeriods = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<PayPeriod[]>('/hr/payroll/periods');
      setPeriods(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadPeriods(); }, [loadPeriods]);

  const handleCreate = async () => {
    if (!formData.name.trim() || !formData.start_date || !formData.end_date) return;
    setSaving(true);
    try {
      await apiFetch('/hr/payroll/periods', {
        method: 'POST',
        body: JSON.stringify(formData),
      });
      setShowCreate(false);
      setFormData({ name: '', start_date: '', end_date: '' });
      loadPeriods();
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleStatusChange = async (id: number, status: string) => {
    try {
      await apiFetch(`/hr/payroll/periods/${id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      loadPeriods();
    } catch { /* ignore */ }
  };

  const statusWorkflow: Record<string, { next: string; label: string }> = {
    draft: { next: 'processing', label: 'Process' },
    processing: { next: 'finalized', label: 'Finalize' },
    finalized: { next: 'paid', label: 'Mark Paid' },
  };

  const inputClass = 'bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1.5 text-xs text-white focus:border-brand-500 focus:outline-none';

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-rmpg-400">{periods.length} pay periods</span>
          <button onClick={loadPeriods} className="text-rmpg-500 hover:text-white p-1" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-brand-500 text-white rounded-sm hover:bg-brand-600"
        >
          <Plus className="w-3.5 h-3.5" /> New Period
        </button>
      </div>

      {showCreate && (
        <div className="bg-[#0d1520] border border-[#1e3048] rounded-sm p-3 mb-3">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] text-rmpg-500 mb-0.5">Name</label>
              <input
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className={inputClass + ' w-full'}
                placeholder="e.g. Mar 1-15 2026"
              />
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-500 mb-0.5">Start Date</label>
              <input
                type="date"
                value={formData.start_date}
                onChange={e => setFormData({ ...formData, start_date: e.target.value })}
                className={inputClass + ' w-full'}
              />
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-500 mb-0.5">End Date</label>
              <input
                type="date"
                value={formData.end_date}
                onChange={e => setFormData({ ...formData, end_date: e.target.value })}
                className={inputClass + ' w-full'}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={() => setShowCreate(false)} className="px-2.5 py-1 text-xs text-rmpg-400 hover:text-white">Cancel</button>
            <button onClick={handleCreate} disabled={saving} className="px-2.5 py-1 text-xs bg-brand-500 text-white rounded-sm hover:bg-brand-600 disabled:opacity-50">
              {saving ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-xs text-rmpg-500 text-center py-8">Loading pay periods...</div>
      ) : periods.length === 0 ? (
        <div className="text-xs text-rmpg-500 text-center py-8">No pay periods found.</div>
      ) : (
        <div className="space-y-2">
          {periods.map(p => (
            <div key={p.id} className="bg-[#0d1520] border border-[#1e3048] rounded-sm p-3 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-brand-400" />
                  <span className="text-xs text-white font-medium">{p.name}</span>
                  <span className={`px-2 py-0.5 text-[10px] font-medium rounded-sm border ${PERIOD_STATUS_COLORS[p.status] || PERIOD_STATUS_COLORS.draft}`}>
                    {p.status.toUpperCase()}
                  </span>
                </div>
                <p className="text-[10px] text-rmpg-400 mt-0.5 ml-5 font-mono">
                  {p.start_date} to {p.end_date}
                </p>
              </div>
              {statusWorkflow[p.status] && (
                <button
                  onClick={() => handleStatusChange(p.id, statusWorkflow[p.status].next)}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs text-brand-300 border border-brand-500/40 rounded-sm hover:bg-brand-500/10"
                >
                  {statusWorkflow[p.status].label}
                  <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// Payroll Tab
// ═══════════════════════════════════════════════════════════

function PayrollTab() {
  const [periods, setPeriods] = useState<PayPeriod[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<number>(0);
  const [entries, setEntries] = useState<PayrollEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [calculating, setCalculating] = useState(false);

  useEffect(() => {
    apiFetch<PayPeriod[]>('/hr/payroll/periods').then(setPeriods).catch(err => console.warn('[HR] Failed to load data:', err));
  }, []);

  const loadEntries = useCallback(async (periodId: number) => {
    if (!periodId) return;
    setLoading(true);
    try {
      const data = await apiFetch<PayrollEntry[]>(`/hr/payroll/entries?period_id=${periodId}`);
      setEntries(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (selectedPeriod) loadEntries(selectedPeriod);
  }, [selectedPeriod, loadEntries]);

  const handleCalculate = async () => {
    if (!selectedPeriod) return;
    setCalculating(true);
    try {
      await apiFetch(`/hr/payroll/entries/calculate`, {
        method: 'POST',
        body: JSON.stringify({ pay_period_id: selectedPeriod }),
      });
      loadEntries(selectedPeriod);
    } catch { /* ignore */ }
    setCalculating(false);
  };

  const handleApproveEntry = async (entryId: number) => {
    try {
      await apiFetch(`/hr/payroll/entries/${entryId}/approve`, {
        method: 'PUT',
      });
      loadEntries(selectedPeriod);
    } catch { /* ignore */ }
  };

  const handleBulkApprove = async () => {
    try {
      await apiFetch(`/hr/payroll/entries/bulk-approve`, {
        method: 'PUT',
        body: JSON.stringify({ pay_period_id: selectedPeriod }),
      });
      loadEntries(selectedPeriod);
    } catch { /* ignore */ }
  };

  const totals = entries.reduce(
    (acc, e) => ({
      regular: acc.regular + e.regular_hours,
      overtime: acc.overtime + e.overtime_hours,
      gross: acc.gross + e.gross_pay,
      deductions: acc.deductions + e.total_deductions,
      net: acc.net + e.net_pay,
    }),
    { regular: 0, overtime: 0, gross: 0, deductions: 0, net: 0 }
  );

  const allCalculated = entries.length > 0 && entries.every(e => e.status !== 'pending');
  const allApproved = entries.length > 0 && entries.every(e => e.status === 'approved');

  return (
    <>
      <div className="flex items-center gap-3 mb-3">
        <label className="text-xs text-rmpg-400">Pay Period:</label>
        <select
          value={selectedPeriod}
          onChange={e => setSelectedPeriod(Number(e.target.value))}
          className="bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1.5 text-xs text-white w-64"
        >
          <option value={0}>Select period...</option>
          {periods.map(p => (
            <option key={p.id} value={p.id}>{p.name} ({p.status})</option>
          ))}
        </select>
        {selectedPeriod > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={handleCalculate}
              disabled={calculating}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-yellow-600 text-white rounded-sm hover:bg-yellow-700 disabled:opacity-50"
            >
              <Calculator className="w-3.5 h-3.5" /> {calculating ? 'Calculating...' : 'Calculate'}
            </button>
            {allCalculated && !allApproved && (
              <button
                onClick={handleBulkApprove}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-green-600 text-white rounded-sm hover:bg-green-700"
              >
                <CheckCircle className="w-3.5 h-3.5" /> Approve All
              </button>
            )}
          </div>
        )}
      </div>

      {!selectedPeriod ? (
        <div className="text-xs text-rmpg-500 text-center py-8">Select a pay period to view payroll.</div>
      ) : loading ? (
        <div className="text-xs text-rmpg-500 text-center py-8">Loading payroll...</div>
      ) : entries.length === 0 ? (
        <div className="text-xs text-rmpg-500 text-center py-8">
          No payroll entries. Click "Calculate" to generate entries from time records.
        </div>
      ) : (
        <div className="border border-[#1e3048] rounded-sm overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#0d1520] text-rmpg-400">
                <th className="text-left px-3 py-2 font-medium">Employee</th>
                <th className="text-right px-3 py-2 font-medium">Reg Hrs</th>
                <th className="text-right px-3 py-2 font-medium">OT Hrs</th>
                <th className="text-right px-3 py-2 font-medium">Gross</th>
                <th className="text-right px-3 py-2 font-medium">Deductions</th>
                <th className="text-right px-3 py-2 font-medium">Net</th>
                <th className="text-center px-3 py-2 font-medium">Status</th>
                <th className="text-center px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id} className="border-t border-[#1e3048] hover:bg-[#1a2636]">
                  <td className="px-3 py-2 text-white">
                    {e.employee_name}
                    {e.badge_number && <span className="text-rmpg-500 ml-1">#{e.badge_number}</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-rmpg-300 font-mono">{e.regular_hours.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right text-rmpg-300 font-mono">{e.overtime_hours.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right text-white font-mono">{fmtCurrency(e.gross_pay)}</td>
                  <td className="px-3 py-2 text-right text-red-300 font-mono">-{fmtCurrency(e.total_deductions)}</td>
                  <td className="px-3 py-2 text-right text-green-300 font-mono font-medium">{fmtCurrency(e.net_pay)}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`inline-block px-2 py-0.5 text-[10px] font-medium rounded-sm border ${ENTRY_STATUS_COLORS[e.status] || ENTRY_STATUS_COLORS.pending}`}>
                      {e.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {e.status === 'calculated' && (
                      <button
                        onClick={() => handleApproveEntry(e.id)}
                        className="p-1 text-green-400 hover:text-green-300 hover:bg-green-500/10 rounded-sm"
                        title="Approve"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {/* Totals row */}
              <tr className="border-t-2 border-brand-500/40 bg-[#0d1520]">
                <td className="px-3 py-2 text-white font-medium">TOTALS</td>
                <td className="px-3 py-2 text-right text-white font-mono font-medium">{totals.regular.toFixed(1)}</td>
                <td className="px-3 py-2 text-right text-white font-mono font-medium">{totals.overtime.toFixed(1)}</td>
                <td className="px-3 py-2 text-right text-white font-mono font-medium">{fmtCurrency(totals.gross)}</td>
                <td className="px-3 py-2 text-right text-red-300 font-mono font-medium">-{fmtCurrency(totals.deductions)}</td>
                <td className="px-3 py-2 text-right text-green-300 font-mono font-bold">{fmtCurrency(totals.net)}</td>
                <td colSpan={2}></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// Pay Rates Tab
// ═══════════════════════════════════════════════════════════

function PayRatesTab() {
  const [rates, setRates] = useState<PayRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [employees, setEmployees] = useState<{ id: string; full_name: string }[]>([]);
  const [formData, setFormData] = useState({
    user_id: '', rate_type: 'hourly', hourly_rate: 0, overtime_multiplier: 1.5, effective_date: '',
  });
  const [saving, setSaving] = useState(false);

  const loadRates = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<PayRate[]>('/hr/payroll/rates');
      setRates(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadRates(); }, [loadRates]);

  useEffect(() => {
    apiFetch<{ id: string; full_name: string }[]>('/hr/employees').then(setEmployees).catch(err => console.warn('[HR] Failed to load data:', err));
  }, []);

  const startCreate = () => {
    setFormData({ user_id: '', rate_type: 'hourly', hourly_rate: 0, overtime_multiplier: 1.5, effective_date: localToday() });
    setEditingId(null);
    setShowCreate(true);
  };

  const startEdit = (r: PayRate) => {
    setFormData({
      user_id: r.user_id,
      rate_type: r.rate_type,
      hourly_rate: r.hourly_rate,
      overtime_multiplier: r.overtime_multiplier,
      effective_date: r.effective_date,
    });
    setEditingId(r.id);
    setShowCreate(true);
  };

  const handleSave = async () => {
    if (!formData.user_id || !formData.effective_date || formData.hourly_rate <= 0) return;
    setSaving(true);
    try {
      if (editingId) {
        await apiFetch(`/hr/payroll/rates/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(formData),
        });
      } else {
        await apiFetch('/hr/payroll/rates', {
          method: 'POST',
          body: JSON.stringify(formData),
        });
      }
      setShowCreate(false);
      setEditingId(null);
      loadRates();
    } catch { /* ignore */ }
    setSaving(false);
  };

  const inputClass = 'bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1.5 text-xs text-white focus:border-brand-500 focus:outline-none';

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-rmpg-400">{rates.length} pay rates</span>
          <button onClick={loadRates} className="text-rmpg-500 hover:text-white p-1" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        <button
          onClick={startCreate}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-brand-500 text-white rounded-sm hover:bg-brand-600"
        >
          <Plus className="w-3.5 h-3.5" /> Add Rate
        </button>
      </div>

      {showCreate && (
        <div className="bg-[#0d1520] border border-[#1e3048] rounded-sm p-3 mb-3">
          <div className="grid grid-cols-5 gap-2">
            <div>
              <label className="block text-[10px] text-rmpg-500 mb-0.5">Employee</label>
              <select value={formData.user_id} onChange={e => setFormData({ ...formData, user_id: e.target.value })} className={inputClass + ' w-full'}>
                <option value="">Select...</option>
                {employees.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-500 mb-0.5">Type</label>
              <select value={formData.rate_type} onChange={e => setFormData({ ...formData, rate_type: e.target.value })} className={inputClass + ' w-full'}>
                <option value="hourly">Hourly</option>
                <option value="salary">Salary</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-500 mb-0.5">Hourly Rate ($)</label>
              <input
                type="number"
                value={formData.hourly_rate}
                onChange={e => setFormData({ ...formData, hourly_rate: Number(e.target.value) })}
                step={0.25}
                min={0}
                className={inputClass + ' w-full'}
              />
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-500 mb-0.5">OT Multiplier</label>
              <input
                type="number"
                value={formData.overtime_multiplier}
                onChange={e => setFormData({ ...formData, overtime_multiplier: Number(e.target.value) })}
                step={0.1}
                min={1}
                className={inputClass + ' w-full'}
              />
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-500 mb-0.5">Effective Date</label>
              <input
                type="date"
                value={formData.effective_date}
                onChange={e => setFormData({ ...formData, effective_date: e.target.value })}
                className={inputClass + ' w-full'}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={() => { setShowCreate(false); setEditingId(null); }} className="px-2.5 py-1 text-xs text-rmpg-400 hover:text-white">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="px-2.5 py-1 text-xs bg-brand-500 text-white rounded-sm hover:bg-brand-600 disabled:opacity-50">
              {saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-xs text-rmpg-500 text-center py-8">Loading pay rates...</div>
      ) : rates.length === 0 ? (
        <div className="text-xs text-rmpg-500 text-center py-8">No pay rates configured.</div>
      ) : (
        <div className="border border-[#1e3048] rounded-sm overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#0d1520] text-rmpg-400">
                <th className="text-left px-3 py-2 font-medium">Employee</th>
                <th className="text-center px-3 py-2 font-medium">Type</th>
                <th className="text-right px-3 py-2 font-medium">Rate</th>
                <th className="text-right px-3 py-2 font-medium">OT Multi</th>
                <th className="text-left px-3 py-2 font-medium">Effective</th>
                <th className="text-center px-3 py-2 font-medium">Current</th>
                <th className="text-center px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rates.map(r => (
                <tr key={r.id} className="border-t border-[#1e3048] hover:bg-[#1a2636]">
                  <td className="px-3 py-2 text-white">
                    {r.employee_name}
                    {r.badge_number && <span className="text-rmpg-500 ml-1">#{r.badge_number}</span>}
                  </td>
                  <td className="px-3 py-2 text-center text-rmpg-300 capitalize">{r.rate_type}</td>
                  <td className="px-3 py-2 text-right text-white font-mono">{fmtCurrency(r.hourly_rate)}/hr</td>
                  <td className="px-3 py-2 text-right text-rmpg-300 font-mono">{r.overtime_multiplier}x</td>
                  <td className="px-3 py-2 text-rmpg-300 font-mono">{r.effective_date}</td>
                  <td className="px-3 py-2 text-center">
                    {r.is_current && (
                      <span className="px-1.5 py-0.5 text-[10px] bg-green-500/20 text-green-300 border border-green-500/40 rounded-sm">
                        CURRENT
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => startEdit(r)}
                      className="p-1 text-brand-400 hover:text-brand-300 hover:bg-brand-500/10 rounded-sm"
                      title="Edit"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// Deductions Tab
// ═══════════════════════════════════════════════════════════

function DeductionsTab() {
  const [deductions, setDeductions] = useState<Deduction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [employees, setEmployees] = useState<{ id: string; full_name: string }[]>([]);
  const [formData, setFormData] = useState({
    user_id: '', deduction_name: '', deduction_type: 'other',
    amount: 0, is_percentage: false, is_pretax: false,
  });
  const [saving, setSaving] = useState(false);

  const DEDUCTION_TYPES = [
    'federal_tax', 'state_tax', 'insurance', 'retirement', 'garnishment', 'other',
  ];

  const loadDeductions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Deduction[]>('/hr/payroll/deductions');
      setDeductions(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadDeductions(); }, [loadDeductions]);

  useEffect(() => {
    apiFetch<{ id: string; full_name: string }[]>('/hr/employees').then(setEmployees).catch(err => console.warn('[HR] Failed to load data:', err));
  }, []);

  const startCreate = () => {
    setFormData({ user_id: '', deduction_name: '', deduction_type: 'other', amount: 0, is_percentage: false, is_pretax: false });
    setEditingId(null);
    setShowCreate(true);
  };

  const startEdit = (d: Deduction) => {
    setFormData({
      user_id: d.user_id,
      deduction_name: d.deduction_name,
      deduction_type: d.deduction_type,
      amount: d.amount,
      is_percentage: d.is_percentage,
      is_pretax: d.is_pretax,
    });
    setEditingId(d.id);
    setShowCreate(true);
  };

  const handleSave = async () => {
    if (!formData.user_id || !formData.deduction_name.trim() || formData.amount <= 0) return;
    setSaving(true);
    try {
      if (editingId) {
        await apiFetch(`/hr/payroll/deductions/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(formData),
        });
      } else {
        await apiFetch('/hr/payroll/deductions', {
          method: 'POST',
          body: JSON.stringify(formData),
        });
      }
      setShowCreate(false);
      setEditingId(null);
      loadDeductions();
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleToggleActive = async (d: Deduction) => {
    try {
      await apiFetch(`/hr/payroll/deductions/${d.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...d, is_active: !d.is_active }),
      });
      loadDeductions();
    } catch { /* ignore */ }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this deduction?')) return;
    try {
      await apiFetch(`/hr/payroll/deductions/${id}`, { method: 'DELETE' });
      loadDeductions();
    } catch { /* ignore */ }
  };

  const formatLabel = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const inputClass = 'bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1.5 text-xs text-white focus:border-brand-500 focus:outline-none';

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-rmpg-400">{deductions.length} deductions</span>
          <button onClick={loadDeductions} className="text-rmpg-500 hover:text-white p-1" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        <button
          onClick={startCreate}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-brand-500 text-white rounded-sm hover:bg-brand-600"
        >
          <Plus className="w-3.5 h-3.5" /> Add Deduction
        </button>
      </div>

      {showCreate && (
        <div className="bg-[#0d1520] border border-[#1e3048] rounded-sm p-3 mb-3">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] text-rmpg-500 mb-0.5">Employee</label>
              <select value={formData.user_id} onChange={e => setFormData({ ...formData, user_id: e.target.value })} className={inputClass + ' w-full'}>
                <option value="">Select...</option>
                {employees.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-500 mb-0.5">Name</label>
              <input
                value={formData.deduction_name}
                onChange={e => setFormData({ ...formData, deduction_name: e.target.value })}
                className={inputClass + ' w-full'}
                placeholder="e.g. Health Insurance"
              />
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-500 mb-0.5">Type</label>
              <select value={formData.deduction_type} onChange={e => setFormData({ ...formData, deduction_type: e.target.value })} className={inputClass + ' w-full'}>
                {DEDUCTION_TYPES.map(t => <option key={t} value={t}>{formatLabel(t)}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-2">
            <div>
              <label className="block text-[10px] text-rmpg-500 mb-0.5">Amount</label>
              <input
                type="number"
                value={formData.amount}
                onChange={e => setFormData({ ...formData, amount: Number(e.target.value) })}
                step={0.01}
                min={0}
                className={inputClass + ' w-full'}
              />
            </div>
            <div className="flex items-end gap-3 pb-1">
              <label className="flex items-center gap-1 text-[10px] text-rmpg-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.is_percentage}
                  onChange={e => setFormData({ ...formData, is_percentage: e.target.checked })}
                  className="accent-brand-500"
                />
                Is Percentage
              </label>
              <label className="flex items-center gap-1 text-[10px] text-rmpg-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.is_pretax}
                  onChange={e => setFormData({ ...formData, is_pretax: e.target.checked })}
                  className="accent-brand-500"
                />
                Pre-Tax
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={() => { setShowCreate(false); setEditingId(null); }} className="px-2.5 py-1 text-xs text-rmpg-400 hover:text-white">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="px-2.5 py-1 text-xs bg-brand-500 text-white rounded-sm hover:bg-brand-600 disabled:opacity-50">
              {saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-xs text-rmpg-500 text-center py-8">Loading deductions...</div>
      ) : deductions.length === 0 ? (
        <div className="text-xs text-rmpg-500 text-center py-8">No deductions configured.</div>
      ) : (
        <div className="border border-[#1e3048] rounded-sm overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#0d1520] text-rmpg-400">
                <th className="text-left px-3 py-2 font-medium">Employee</th>
                <th className="text-left px-3 py-2 font-medium">Name</th>
                <th className="text-left px-3 py-2 font-medium">Type</th>
                <th className="text-right px-3 py-2 font-medium">Amount</th>
                <th className="text-center px-3 py-2 font-medium">Pre-Tax</th>
                <th className="text-center px-3 py-2 font-medium">Status</th>
                <th className="text-center px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {deductions.map(d => (
                <tr key={d.id} className="border-t border-[#1e3048] hover:bg-[#1a2636]">
                  <td className="px-3 py-2 text-white">{d.employee_name}</td>
                  <td className="px-3 py-2 text-rmpg-300">{d.deduction_name}</td>
                  <td className="px-3 py-2 text-rmpg-400">{formatLabel(d.deduction_type)}</td>
                  <td className="px-3 py-2 text-right text-white font-mono">
                    {d.is_percentage ? `${d.amount}%` : fmtCurrency(d.amount)}
                  </td>
                  <td className="px-3 py-2 text-center text-rmpg-400">
                    {d.is_pretax ? 'Yes' : 'No'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => handleToggleActive(d)}
                      className={`px-1.5 py-0.5 text-[10px] rounded-sm border ${
                        d.is_active
                          ? 'bg-green-500/20 text-green-300 border-green-500/40'
                          : 'bg-gray-500/20 text-gray-400 border-gray-500/40'
                      }`}
                    >
                      {d.is_active ? 'ACTIVE' : 'INACTIVE'}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => startEdit(d)}
                        className="p-1 text-brand-400 hover:text-brand-300 hover:bg-brand-500/10 rounded-sm"
                        title="Edit"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(d.id)}
                        className="p-1 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-sm"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
