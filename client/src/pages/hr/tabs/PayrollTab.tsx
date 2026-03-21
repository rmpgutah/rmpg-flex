// ============================================================
// RMPG Flex — Payroll Tab
// Pay periods, pay rates, payroll entries
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import {
  DollarSign, Calendar, Plus, RefreshCw, Loader2, Users, Clock,
  ChevronDown, ChevronRight, Edit3, Trash2, Check, X, AlertTriangle,
  Banknote, TrendingUp, FileText, Download,
} from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';

// ─── Types ────────────────────────────────────────────────────

interface PayPeriod {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  pay_date: string;
  status: string;
  created_by_name?: string;
  entry_count: number;
  total_gross: number;
  total_net: number;
}

interface PayRate {
  id: number;
  user_id: number;
  officer_name: string;
  pay_type: string;
  rate: number;
  overtime_rate: number;
  holiday_rate: number;
  effective_date: string;
  notes?: string;
}

interface PayrollEntry {
  id: number;
  user_id: number;
  officer_name: string;
  badge_number?: string;
  pay_rate_id?: number;
  pay_type?: string;
  hourly_rate?: number;
  regular_hours: number;
  overtime_hours: number;
  holiday_hours: number;
  pto_hours: number;
  sick_hours: number;
  other_hours: number;
  other_hours_description?: string;
  base_pay: number;
  overtime_pay: number;
  holiday_pay: number;
  gross_pay: number;
  total_deductions: number;
  net_pay: number;
  status: string;
  approved_by_name?: string;
  notes?: string;
}

interface Officer { id: number; full_name: string; }

type SubTab = 'periods' | 'rates' | 'entries';

const STATUS_COLORS: Record<string, string> = {
  open: '#3b82f6',
  processing: '#f59e0b',
  closed: '#22c55e',
  draft: '#6b7280',
  approved: '#22c55e',
};

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function formatDate(d: string): string {
  if (!d) return '—';
  const date = new Date(d + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

interface ToastFn {
  (message: string, type?: 'success' | 'error' | 'info'): void;
}

// ─── Component ────────────────────────────────────────────────

export default function PayrollTab({ userRole }: { userRole: string }) {
  const [subTab, setSubTab] = useState<SubTab>('periods');
  const [periods, setPeriods] = useState<PayPeriod[]>([]);
  const [rates, setRates] = useState<PayRate[]>([]);
  const [entries, setEntries] = useState<PayrollEntry[]>([]);
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<PayPeriod | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);

  // ─── Forms ────────────────────────────────────────────────
  const [showPeriodForm, setShowPeriodForm] = useState(false);
  const [showRateForm, setShowRateForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<Record<string, number>>({});

  // Period form
  const [periodForm, setPeriodForm] = useState({ name: '', start_date: '', end_date: '', pay_date: '' });

  // Rate form
  const [rateForm, setRateForm] = useState({ user_id: '', pay_type: 'hourly', rate: '', overtime_rate: '1.5', holiday_rate: '1.5', effective_date: '', notes: '' });

  const addToast = useCallback<ToastFn>((msg, type = 'info') => {
    setToast({ msg, type: type || 'info' });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const isManager = ['admin', 'manager'].includes(userRole);

  // ─── Fetch ────────────────────────────────────────────────

  const fetchPeriods = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<PayPeriod[]>('/api/hr/payroll/periods');
      setPeriods(data);
    } catch { addToast('Failed to load pay periods', 'error'); }
    finally { setLoading(false); }
  }, [addToast]);

  const fetchRates = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<PayRate[]>('/api/hr/payroll/rates');
      setRates(data);
    } catch { addToast('Failed to load pay rates', 'error'); }
    finally { setLoading(false); }
  }, [addToast]);

  const fetchEntries = useCallback(async (periodId: number) => {
    setLoading(true);
    try {
      const data = await apiFetch<PayrollEntry[]>(`/api/hr/payroll/entries?pay_period_id=${periodId}`);
      setEntries(data);
    } catch { addToast('Failed to load entries', 'error'); }
    finally { setLoading(false); }
  }, [addToast]);

  const fetchOfficers = useCallback(async () => {
    try {
      const data = await apiFetch<any[]>('/api/personnel');
      setOfficers(data.map((o: any) => ({ id: o.id, full_name: o.full_name })));
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchPeriods();
    fetchOfficers();
  }, [fetchPeriods, fetchOfficers]);

  useEffect(() => {
    if (subTab === 'rates') fetchRates();
  }, [subTab, fetchRates]);

  useEffect(() => {
    if (selectedPeriod) fetchEntries(selectedPeriod.id);
  }, [selectedPeriod, fetchEntries]);

  // ─── Handlers ─────────────────────────────────────────────

  const handleCreatePeriod = async () => {
    if (!periodForm.start_date || !periodForm.end_date || !periodForm.pay_date) {
      addToast('All dates are required', 'error'); return;
    }
    try {
      await apiFetch('/api/hr/payroll/periods', {
        body: JSON.stringify(periodForm),
      });
      addToast('Pay period created', 'success');
      setShowPeriodForm(false);
      setPeriodForm({ name: '', start_date: '', end_date: '', pay_date: '' });
      fetchPeriods();
    } catch { addToast('Failed to create pay period', 'error'); }
  };

  const handleDeletePeriod = async (id: number) => {
    if (!confirm('Delete this pay period and all its entries?')) return;
    try {
      await apiFetch(`/api/hr/payroll/periods/${id}`, { method: 'DELETE' });
      addToast('Pay period deleted', 'success');
      if (selectedPeriod?.id === id) setSelectedPeriod(null);
      fetchPeriods();
    } catch (e: any) { addToast(e.message || 'Failed to delete', 'error'); }
  };

  const handleClosePeriod = async (id: number) => {
    try {
      await apiFetch(`/api/hr/payroll/periods/${id}`, {
        body: JSON.stringify({ status: 'closed' }),
      });
      addToast('Pay period closed', 'success');
      fetchPeriods();
    } catch { addToast('Failed to close period', 'error'); }
  };

  const handlePopulatePeriod = async (id: number) => {
    try {
      const result = await apiFetch<{ created: number; total: number }>(`/api/hr/payroll/periods/${id}/populate`, { method: 'POST' });
      addToast(`Created ${result.created} entries (${result.total} total employees)`, 'success');
      if (selectedPeriod?.id === id) fetchEntries(id);
      fetchPeriods();
    } catch { addToast('Failed to populate entries', 'error'); }
  };

  const handleCreateRate = async () => {
    if (!rateForm.user_id || !rateForm.rate || !rateForm.effective_date) {
      addToast('Employee, rate, and effective date are required', 'error'); return;
    }
    try {
      await apiFetch('/api/hr/payroll/rates', {
        body: JSON.stringify({
          user_id: Number(rateForm.user_id), pay_type: rateForm.pay_type,
          rate: Number(rateForm.rate), overtime_rate: Number(rateForm.overtime_rate),
          holiday_rate: Number(rateForm.holiday_rate), effective_date: rateForm.effective_date,
          notes: rateForm.notes || undefined,
        }),
      });
      addToast('Pay rate set', 'success');
      setShowRateForm(false);
      setRateForm({ user_id: '', pay_type: 'hourly', rate: '', overtime_rate: '1.5', holiday_rate: '1.5', effective_date: '', notes: '' });
      fetchRates();
    } catch { addToast('Failed to set pay rate', 'error'); }
  };

  const handleSaveEntry = async (entryId: number) => {
    try {
      await apiFetch(`/api/hr/payroll/entries/${entryId}`, {
        body: JSON.stringify(editValues),
      });
      addToast('Entry updated', 'success');
      setEditingEntry(null);
      if (selectedPeriod) fetchEntries(selectedPeriod.id);
      fetchPeriods();
    } catch { addToast('Failed to update entry', 'error'); }
  };

  const handleApproveEntry = async (entryId: number) => {
    try {
      await apiFetch(`/api/hr/payroll/entries/${entryId}`, {
        body: JSON.stringify({ status: 'approved' }),
      });
      addToast('Entry approved', 'success');
      if (selectedPeriod) fetchEntries(selectedPeriod.id);
    } catch { addToast('Failed to approve', 'error'); }
  };

  const startEditing = (entry: PayrollEntry) => {
    setEditingEntry(entry.id);
    setEditValues({
      regular_hours: entry.regular_hours,
      overtime_hours: entry.overtime_hours,
      holiday_hours: entry.holiday_hours,
      pto_hours: entry.pto_hours,
      sick_hours: entry.sick_hours,
    });
  };

  // ─── CSV Export ──────────────────────────────────────────
  const handleExportCSV = useCallback(() => {
    if (!entries.length || !selectedPeriod) return;
    const headers = ['Employee','Badge','Rate','Reg Hours','OT Hours','Holiday Hours','PTO Hours','Sick Hours','Base Pay','OT Pay','Holiday Pay','Gross Pay','Status'];
    const rows = entries.map(e => [
      e.officer_name,
      e.badge_number || '',
      e.hourly_rate ? e.hourly_rate.toFixed(2) : '',
      e.regular_hours.toString(),
      e.overtime_hours.toString(),
      e.holiday_hours.toString(),
      e.pto_hours.toString(),
      e.sick_hours.toString(),
      e.base_pay.toFixed(2),
      e.overtime_pay.toFixed(2),
      e.holiday_pay.toFixed(2),
      e.gross_pay.toFixed(2),
      e.status,
    ]);
    // Totals row
    const totals = [
      'TOTALS','','',
      entries.reduce((s, e) => s + e.regular_hours, 0).toString(),
      entries.reduce((s, e) => s + e.overtime_hours, 0).toString(),
      entries.reduce((s, e) => s + e.holiday_hours, 0).toString(),
      entries.reduce((s, e) => s + e.pto_hours, 0).toString(),
      entries.reduce((s, e) => s + e.sick_hours, 0).toString(),
      entries.reduce((s, e) => s + e.base_pay, 0).toFixed(2),
      entries.reduce((s, e) => s + e.overtime_pay, 0).toFixed(2),
      entries.reduce((s, e) => s + e.holiday_pay, 0).toFixed(2),
      entries.reduce((s, e) => s + e.gross_pay, 0).toFixed(2),
      '',
    ];
    rows.push(totals);

    const escapeCsv = (val: string) => val.includes(',') || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val;
    const csv = [headers.map(escapeCsv).join(','), ...rows.map(r => r.map(escapeCsv).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const periodName = (selectedPeriod.name || 'period').replace(/[^a-zA-Z0-9_-]/g, '_');
    const dateStr = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll-${periodName}-${dateStr}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [entries, selectedPeriod]);

  // ─── Sub-tabs ─────────────────────────────────────────────

  const SUB_TABS: { key: SubTab; label: string; icon: typeof DollarSign }[] = [
    { key: 'periods', label: 'Pay Periods', icon: Calendar },
    { key: 'rates', label: 'Pay Rates', icon: TrendingUp },
    { key: 'entries', label: 'Timesheet', icon: Clock },
  ];

  // ─── Render ───────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg text-xs font-medium shadow-lg ${
          toast.type === 'success' ? 'bg-green-600 text-white' : toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-brand-600 text-white'
        }`}>{toast.msg}</div>
      )}

      {/* Sub-tab bar */}
      <div className="flex flex-wrap items-center gap-1 px-3 py-1.5 border-b border-[#1e3048] bg-[#0d1520]">
        {SUB_TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setSubTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded transition-colors ${
                subTab === t.key
                  ? 'text-white bg-brand-500/20 border border-brand-500/40'
                  : 'text-rmpg-400 hover:text-white hover:bg-rmpg-700/30'
              }`}>
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
        <div className="flex-1" />
        {loading && <Loader2 size={14} className="animate-spin text-brand-400" />}
      </div>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* Pay Periods */}
      {/* ═══════════════════════════════════════════════════════ */}
      {subTab === 'periods' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Action bar */}
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Calendar size={15} className="text-brand-400" /> Pay Periods
            </h3>
            <div className="flex-1" />
            {isManager && (
              <button onClick={() => setShowPeriodForm(!showPeriodForm)}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-green-400 bg-green-900/20 hover:bg-green-900/40 border border-green-700/40 rounded transition-colors">
                <Plus size={12} /> New Period
              </button>
            )}
            <button onClick={fetchPeriods}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] text-rmpg-400 hover:text-white hover:bg-rmpg-700/30 rounded transition-colors">
              <RefreshCw size={12} /> Refresh
            </button>
          </div>

          {/* Create form */}
          {showPeriodForm && (
            <div className="bg-[#0d1520] border border-[#1e3048] rounded-lg p-4 space-y-3">
              <h4 className="text-xs font-semibold text-white">Create Pay Period</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="text-[10px] text-rmpg-400 block mb-1">Name (optional)</label>
                  <input value={periodForm.name} onChange={e => setPeriodForm(p => ({ ...p, name: e.target.value }))}
                    className="w-full bg-[#141e2b] border border-[#1e3048] rounded px-2 py-1.5 text-xs text-white" placeholder="e.g. March 1-15" />
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 block mb-1">Start Date *</label>
                  <input type="date" value={periodForm.start_date} onChange={e => setPeriodForm(p => ({ ...p, start_date: e.target.value }))}
                    className="w-full bg-[#141e2b] border border-[#1e3048] rounded px-2 py-1.5 text-xs text-white" />
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 block mb-1">End Date *</label>
                  <input type="date" value={periodForm.end_date} onChange={e => setPeriodForm(p => ({ ...p, end_date: e.target.value }))}
                    className="w-full bg-[#141e2b] border border-[#1e3048] rounded px-2 py-1.5 text-xs text-white" />
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 block mb-1">Pay Date *</label>
                  <input type="date" value={periodForm.pay_date} onChange={e => setPeriodForm(p => ({ ...p, pay_date: e.target.value }))}
                    className="w-full bg-[#141e2b] border border-[#1e3048] rounded px-2 py-1.5 text-xs text-white" />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowPeriodForm(false)} className="px-3 py-1 text-[11px] text-rmpg-400 hover:text-white">Cancel</button>
                <button onClick={handleCreatePeriod}
                  className="px-4 py-1 text-[11px] font-medium bg-brand-500 hover:bg-brand-600 text-white rounded transition-colors">Create</button>
              </div>
            </div>
          )}

          {/* Period list */}
          {periods.length === 0 && !loading ? (
            <div className="text-center py-12 text-rmpg-500">
              <Banknote size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No pay periods yet</p>
              <p className="text-xs text-rmpg-600 mt-1">Create your first pay period to get started</p>
            </div>
          ) : (
            <div className="space-y-2">
              {periods.map(period => (
                <div key={period.id}
                  className={`border rounded-lg transition-all cursor-pointer ${
                    selectedPeriod?.id === period.id
                      ? 'border-brand-500/60 bg-brand-500/5'
                      : 'border-[#1e3048] bg-[#141e2b] hover:border-rmpg-600'
                  }`}
                  onClick={() => { setSelectedPeriod(period); setSubTab('entries'); }}
                >
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-shrink-0">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[period.status] || '#6b7280' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-white truncate">{period.name}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium" style={{
                          backgroundColor: (STATUS_COLORS[period.status] || '#6b7280') + '20',
                          color: STATUS_COLORS[period.status] || '#6b7280'
                        }}>{period.status}</span>
                      </div>
                      <div className="text-[10px] text-rmpg-500 mt-0.5">
                        {formatDate(period.start_date)} — {formatDate(period.end_date)} • Pay: {formatDate(period.pay_date)}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-xs font-semibold text-green-400">{formatCurrency(period.total_gross)}</div>
                      <div className="text-[10px] text-rmpg-500">{period.entry_count} entries</div>
                    </div>
                    {isManager && (
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        {period.status === 'open' && (
                          <>
                            <button onClick={() => handlePopulatePeriod(period.id)} title="Auto-populate employees"
                              className="p-1 text-rmpg-500 hover:text-cyan-400 transition-colors"><Users size={13} /></button>
                            <button onClick={() => handleClosePeriod(period.id)} title="Close period"
                              className="p-1 text-rmpg-500 hover:text-green-400 transition-colors"><Check size={13} /></button>
                            <button onClick={() => handleDeletePeriod(period.id)} title="Delete"
                              className="p-1 text-rmpg-500 hover:text-red-400 transition-colors"><Trash2 size={13} /></button>
                          </>
                        )}
                        <ChevronRight size={14} className="text-rmpg-600" />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════ */}
      {/* Pay Rates */}
      {/* ═══════════════════════════════════════════════════════ */}
      {subTab === 'rates' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <TrendingUp size={15} className="text-brand-400" /> Active Pay Rates
            </h3>
            <div className="flex-1" />
            {isManager && (
              <button onClick={() => setShowRateForm(!showRateForm)}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-green-400 bg-green-900/20 hover:bg-green-900/40 border border-green-700/40 rounded transition-colors">
                <Plus size={12} /> Set Rate
              </button>
            )}
          </div>

          {/* Create rate form */}
          {showRateForm && (
            <div className="bg-[#0d1520] border border-[#1e3048] rounded-lg p-4 space-y-3">
              <h4 className="text-xs font-semibold text-white">Set Pay Rate</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] text-rmpg-400 block mb-1">Employee *</label>
                  <select value={rateForm.user_id} onChange={e => setRateForm(r => ({ ...r, user_id: e.target.value }))}
                    className="w-full bg-[#141e2b] border border-[#1e3048] rounded px-2 py-1.5 text-xs text-white">
                    <option value="">Select employee...</option>
                    {officers.map(o => <option key={o.id} value={o.id}>{o.full_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 block mb-1">Pay Type</label>
                  <select value={rateForm.pay_type} onChange={e => setRateForm(r => ({ ...r, pay_type: e.target.value }))}
                    className="w-full bg-[#141e2b] border border-[#1e3048] rounded px-2 py-1.5 text-xs text-white">
                    <option value="hourly">Hourly</option>
                    <option value="salary">Salary</option>
                    <option value="contract">Contract</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 block mb-1">Rate ($/hr) *</label>
                  <input type="number" step="0.01" value={rateForm.rate} onChange={e => setRateForm(r => ({ ...r, rate: e.target.value }))}
                    className="w-full bg-[#141e2b] border border-[#1e3048] rounded px-2 py-1.5 text-xs text-white" placeholder="25.00" />
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 block mb-1">OT Multiplier</label>
                  <input type="number" step="0.1" value={rateForm.overtime_rate} onChange={e => setRateForm(r => ({ ...r, overtime_rate: e.target.value }))}
                    className="w-full bg-[#141e2b] border border-[#1e3048] rounded px-2 py-1.5 text-xs text-white" />
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 block mb-1">Holiday Multiplier</label>
                  <input type="number" step="0.1" value={rateForm.holiday_rate} onChange={e => setRateForm(r => ({ ...r, holiday_rate: e.target.value }))}
                    className="w-full bg-[#141e2b] border border-[#1e3048] rounded px-2 py-1.5 text-xs text-white" />
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 block mb-1">Effective Date *</label>
                  <input type="date" value={rateForm.effective_date} onChange={e => setRateForm(r => ({ ...r, effective_date: e.target.value }))}
                    className="w-full bg-[#141e2b] border border-[#1e3048] rounded px-2 py-1.5 text-xs text-white" />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowRateForm(false)} className="px-3 py-1 text-[11px] text-rmpg-400 hover:text-white">Cancel</button>
                <button onClick={handleCreateRate}
                  className="px-4 py-1 text-[11px] font-medium bg-brand-500 hover:bg-brand-600 text-white rounded transition-colors">Save Rate</button>
              </div>
            </div>
          )}

          {/* Rates table */}
          {rates.length === 0 && !loading ? (
            <div className="text-center py-12 text-rmpg-500">
              <TrendingUp size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No pay rates configured</p>
              <p className="text-xs text-rmpg-600 mt-1">Set pay rates for employees to enable payroll calculations</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#1e3048]">
                    <th className="px-3 py-2 text-left text-rmpg-400 font-medium">Employee</th>
                    <th className="px-3 py-2 text-left text-rmpg-400 font-medium">Type</th>
                    <th className="px-3 py-2 text-right text-rmpg-400 font-medium">Rate</th>
                    <th className="px-3 py-2 text-right text-rmpg-400 font-medium">OT</th>
                    <th className="px-3 py-2 text-right text-rmpg-400 font-medium">Holiday</th>
                    <th className="px-3 py-2 text-left text-rmpg-400 font-medium">Effective</th>
                  </tr>
                </thead>
                <tbody>
                  {rates.map(rate => (
                    <tr key={rate.id} className="border-b border-[#1e3048]/50 hover:bg-brand-500/5">
                      <td className="px-3 py-2 text-white font-medium">{rate.officer_name}</td>
                      <td className="px-3 py-2">
                        <span className="px-1.5 py-0.5 text-[9px] rounded bg-brand-500/15 text-brand-400 uppercase font-bold">{rate.pay_type}</span>
                      </td>
                      <td className="px-3 py-2 text-right text-green-400 font-mono">{formatCurrency(rate.rate)}</td>
                      <td className="px-3 py-2 text-right text-rmpg-300 font-mono">{rate.overtime_rate}x</td>
                      <td className="px-3 py-2 text-right text-rmpg-300 font-mono">{rate.holiday_rate}x</td>
                      <td className="px-3 py-2 text-rmpg-400">{formatDate(rate.effective_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════ */}
      {/* Timesheet / Entries */}
      {/* ═══════════════════════════════════════════════════════ */}
      {subTab === 'entries' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Period selector */}
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Clock size={15} className="text-brand-400" /> Timesheet
            </h3>
            <select value={selectedPeriod?.id ?? ''} onChange={e => {
              const p = periods.find(pp => pp.id === Number(e.target.value));
              setSelectedPeriod(p || null);
            }} className="bg-[#141e2b] border border-[#1e3048] rounded px-2 py-1 text-xs text-white">
              <option value="">Select pay period...</option>
              {periods.map(p => <option key={p.id} value={p.id}>{p.name} ({p.status})</option>)}
            </select>
            {selectedPeriod && entries.length > 0 && (
              <button
                onClick={handleExportCSV}
                className="flex items-center gap-1 px-2 py-1 text-[11px] text-rmpg-400 hover:text-white hover:bg-rmpg-700/30 rounded transition-colors"
              >
                <Download size={12} /> Export CSV
              </button>
            )}
            <div className="flex-1" />
            {selectedPeriod && (
              <div className="flex items-center gap-3 text-[10px]">
                <span className="text-rmpg-400">Gross: <span className="text-green-400 font-semibold">{formatCurrency(selectedPeriod.total_gross)}</span></span>
                <span className="text-rmpg-400">Entries: <span className="text-white font-semibold">{selectedPeriod.entry_count}</span></span>
              </div>
            )}
          </div>

          {!selectedPeriod ? (
            <div className="text-center py-12 text-rmpg-500">
              <FileText size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">Select a pay period to view timesheet</p>
            </div>
          ) : entries.length === 0 && !loading ? (
            <div className="text-center py-12 text-rmpg-500">
              <Users size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No entries for this period</p>
              <p className="text-xs text-rmpg-600 mt-1">Use "Auto-populate" on the pay period to add employees</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#1e3048]">
                    <th className="px-2 py-2 text-left text-rmpg-400 font-medium">Employee</th>
                    <th className="px-2 py-2 text-right text-rmpg-400 font-medium">Rate</th>
                    <th className="px-2 py-2 text-right text-rmpg-400 font-medium">Reg Hrs</th>
                    <th className="px-2 py-2 text-right text-rmpg-400 font-medium">OT Hrs</th>
                    <th className="px-2 py-2 text-right text-rmpg-400 font-medium">Hol Hrs</th>
                    <th className="px-2 py-2 text-right text-rmpg-400 font-medium">PTO</th>
                    <th className="px-2 py-2 text-right text-rmpg-400 font-medium">Sick</th>
                    <th className="px-2 py-2 text-right text-rmpg-400 font-medium">Gross</th>
                    <th className="px-2 py-2 text-center text-rmpg-400 font-medium">Status</th>
                    <th className="px-2 py-2 text-center text-rmpg-400 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(entry => {
                    const isEditing = editingEntry === entry.id;
                    return (
                      <tr key={entry.id} className={`border-b border-[#1e3048]/50 ${isEditing ? 'bg-brand-500/5' : 'hover:bg-brand-500/5'}`}>
                        <td className="px-2 py-2 text-white font-medium whitespace-nowrap">{entry.officer_name}</td>
                        <td className="px-2 py-2 text-right text-rmpg-300 font-mono">{entry.hourly_rate ? formatCurrency(entry.hourly_rate) : '—'}</td>
                        {isEditing ? (
                          <>
                            {['regular_hours', 'overtime_hours', 'holiday_hours', 'pto_hours', 'sick_hours'].map(field => (
                              <td key={field} className="px-1 py-1">
                                <input type="number" step="0.5" min="0"
                                  value={editValues[field] ?? 0}
                                  onChange={e => setEditValues(v => ({ ...v, [field]: Number(e.target.value) }))}
                                  className="w-16 bg-[#0d1520] border border-brand-500/40 rounded px-1.5 py-0.5 text-xs text-white text-right font-mono" />
                              </td>
                            ))}
                          </>
                        ) : (
                          <>
                            <td className="px-2 py-2 text-right text-white font-mono">{entry.regular_hours}</td>
                            <td className="px-2 py-2 text-right text-amber-400 font-mono">{entry.overtime_hours || '—'}</td>
                            <td className="px-2 py-2 text-right text-cyan-400 font-mono">{entry.holiday_hours || '—'}</td>
                            <td className="px-2 py-2 text-right text-rmpg-400 font-mono">{entry.pto_hours || '—'}</td>
                            <td className="px-2 py-2 text-right text-rmpg-400 font-mono">{entry.sick_hours || '—'}</td>
                          </>
                        )}
                        <td className="px-2 py-2 text-right text-green-400 font-mono font-semibold">{formatCurrency(entry.gross_pay)}</td>
                        <td className="px-2 py-2 text-center">
                          <span className="px-1.5 py-0.5 text-[9px] rounded-full font-medium" style={{
                            backgroundColor: (STATUS_COLORS[entry.status] || '#6b7280') + '20',
                            color: STATUS_COLORS[entry.status] || '#6b7280'
                          }}>{entry.status}</span>
                        </td>
                        <td className="px-2 py-2 text-center">
                          {isManager && entry.status !== 'approved' && (
                            <div className="flex items-center justify-center gap-1">
                              {isEditing ? (
                                <>
                                  <button onClick={() => handleSaveEntry(entry.id)} className="p-0.5 text-green-400 hover:text-green-300"><Check size={13} /></button>
                                  <button onClick={() => setEditingEntry(null)} className="p-0.5 text-rmpg-500 hover:text-white"><X size={13} /></button>
                                </>
                              ) : (
                                <>
                                  <button onClick={() => startEditing(entry)} className="p-0.5 text-rmpg-500 hover:text-brand-400" title="Edit hours"><Edit3 size={13} /></button>
                                  <button onClick={() => handleApproveEntry(entry.id)} className="p-0.5 text-rmpg-500 hover:text-green-400" title="Approve"><Check size={13} /></button>
                                </>
                              )}
                            </div>
                          )}
                          {entry.status === 'approved' && <Check size={13} className="text-green-500 mx-auto" />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {entries.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-[#1e3048]">
                      <td className="px-2 py-2 text-white font-bold">Totals</td>
                      <td className="px-2 py-2" />
                      <td className="px-2 py-2 text-right text-white font-mono font-bold">{entries.reduce((s, e) => s + e.regular_hours, 0)}</td>
                      <td className="px-2 py-2 text-right text-amber-400 font-mono font-bold">{entries.reduce((s, e) => s + e.overtime_hours, 0) || '—'}</td>
                      <td className="px-2 py-2 text-right text-cyan-400 font-mono font-bold">{entries.reduce((s, e) => s + e.holiday_hours, 0) || '—'}</td>
                      <td className="px-2 py-2 text-right text-rmpg-400 font-mono">{entries.reduce((s, e) => s + e.pto_hours, 0) || '—'}</td>
                      <td className="px-2 py-2 text-right text-rmpg-400 font-mono">{entries.reduce((s, e) => s + e.sick_hours, 0) || '—'}</td>
                      <td className="px-2 py-2 text-right text-green-400 font-mono font-bold">{formatCurrency(entries.reduce((s, e) => s + e.gross_pay, 0))}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
