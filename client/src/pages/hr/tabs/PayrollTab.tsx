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
import { localToday } from '../../../utils/dateUtils';

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

interface OvertimeRequest {
  id: number;
  officer_id: number;
  officer_name: string;
  requested_date: string;
  hours_requested: number;
  reason: string | null;
  status: string;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
}

type SubTab = 'periods' | 'rates' | 'entries' | 'overtime' | 'leave';

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
  const date = new Date(d.includes('T') ? d : d + 'T00:00:00');
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

  // ─── Leave Balances ──────────────────────────────────────
  interface LeaveBalance { id: number; full_name: string; badge_number?: string; hire_date?: string; pto_used: number; sick_used: number; pto_pending: number; }
  const [leaveData, setLeaveData] = useState<LeaveBalance[]>([]);
  const [leaveLoading, setLeaveLoading] = useState(false);
  const PTO_ACCRUAL_PER_PAY_PERIOD = 4; // hours per bi-weekly pay period
  const PAY_PERIODS_PER_YEAR = 26;
  const ANNUAL_PTO_ALLOTMENT = PTO_ACCRUAL_PER_PAY_PERIOD * PAY_PERIODS_PER_YEAR; // 104 hours/year

  // ─── Overtime ─────────────────────────────────────────────
  const [otRequests, setOtRequests] = useState<OvertimeRequest[]>([]);
  const [showOtForm, setShowOtForm] = useState(false);
  const [otForm, setOtForm] = useState({ requested_date: '', hours_requested: '', reason: '' });

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
      const data = await apiFetch<PayPeriod[]>('/hr/payroll/periods');
      setPeriods(data);
    } catch { addToast('Failed to load pay periods', 'error'); }
    finally { setLoading(false); }
  }, [addToast]);

  const fetchRates = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<PayRate[]>('/hr/payroll/rates');
      setRates(data);
    } catch { addToast('Failed to load pay rates', 'error'); }
    finally { setLoading(false); }
  }, [addToast]);

  const fetchEntries = useCallback(async (periodId: number) => {
    setLoading(true);
    try {
      const data = await apiFetch<PayrollEntry[]>(`/hr/payroll/entries?pay_period_id=${periodId}`);
      setEntries(data);
    } catch { addToast('Failed to load entries', 'error'); }
    finally { setLoading(false); }
  }, [addToast]);

  const fetchOfficers = useCallback(async () => {
    try {
      const data = await apiFetch<any[]>('/personnel');
      setOfficers(data.map((o: any) => ({ id: o.id, full_name: o.full_name })));
    } catch { /* silent */ }
  }, []);

  const fetchOtRequests = useCallback(async () => {
    try {
      const data = await apiFetch<OvertimeRequest[]>('/hr/payroll/overtime');
      setOtRequests(data);
    } catch { /* silent */ }
  }, []);

  const fetchLeaveBalances = useCallback(async () => {
    setLeaveLoading(true);
    try {
      const personnel = await apiFetch<any[]>('/personnel');
      // Calculate leave balances from payroll entries across all closed periods
      const allEntries = await apiFetch<PayrollEntry[]>('/hr/payroll/entries?all=1').catch(() => [] as PayrollEntry[]);
      const balances: LeaveBalance[] = (personnel || []).map((p: any) => {
        const officerEntries = (allEntries || []).filter(e => e.user_id === p.id);
        const ptoUsed = officerEntries.reduce((sum, e) => sum + (e.pto_hours || 0), 0);
        const sickUsed = officerEntries.reduce((sum, e) => sum + (e.sick_hours || 0), 0);
        // Calculate accrued PTO based on hire date
        const hireDate = p.hire_date || p.start_date || p.created_at;
        let accrued = ANNUAL_PTO_ALLOTMENT;
        if (hireDate) {
          const hire = new Date(hireDate);
          const now = new Date();
          const yearStart = new Date(now.getFullYear(), 0, 1);
          const effectiveStart = hire > yearStart ? hire : yearStart;
          const weeksWorked = Math.floor((now.getTime() - effectiveStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
          const periodsWorked = Math.floor(weeksWorked / 2);
          accrued = Math.min(ANNUAL_PTO_ALLOTMENT, periodsWorked * PTO_ACCRUAL_PER_PAY_PERIOD);
        }
        return {
          id: p.id,
          full_name: p.full_name || `${p.first_name} ${p.last_name}`,
          badge_number: p.badge_number,
          hire_date: hireDate,
          pto_used: ptoUsed,
          sick_used: sickUsed,
          pto_pending: Math.max(0, accrued - ptoUsed),
        };
      });
      setLeaveData(balances);
    } catch { /* silent */ }
    finally { setLeaveLoading(false); }
  }, []);

  const handleRequestOt = async () => {
    if (!otForm.requested_date || !otForm.hours_requested) { addToast('Date and hours required', 'error'); return; }
    try {
      await apiFetch('/hr/payroll/overtime', { method: 'POST', body: JSON.stringify(otForm) });
      addToast('OT request submitted', 'success');
      setShowOtForm(false);
      setOtForm({ requested_date: '', hours_requested: '', reason: '' });
      fetchOtRequests();
    } catch { addToast('Failed to submit OT request', 'error'); }
  };

  const handleOtDecision = async (id: number, status: 'approved' | 'denied') => {
    try {
      await apiFetch(`/hr/payroll/overtime/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
      addToast(`OT request ${status}`, 'success');
      fetchOtRequests();
    } catch { addToast('Failed to update OT request', 'error'); }
  };

  useEffect(() => {
    fetchPeriods();
    fetchOfficers();
  }, [fetchPeriods, fetchOfficers]);

  useEffect(() => {
    if (subTab === 'rates') fetchRates();
    if (subTab === 'overtime') fetchOtRequests();
  }, [subTab, fetchRates, fetchOtRequests]);

  useEffect(() => {
    if (selectedPeriod) fetchEntries(selectedPeriod.id);
  }, [selectedPeriod, fetchEntries]);

  // ─── Handlers ─────────────────────────────────────────────

  const handleCreatePeriod = async () => {
    if (!periodForm.start_date || !periodForm.end_date || !periodForm.pay_date) {
      addToast('All dates are required', 'error'); return;
    }
    try {
      await apiFetch('/hr/payroll/periods', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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
      await apiFetch(`/hr/payroll/periods/${id}`, { method: 'DELETE' });
      addToast('Pay period deleted', 'success');
      if (selectedPeriod?.id === id) setSelectedPeriod(null);
      fetchPeriods();
    } catch (e: any) { addToast(e.message || 'Failed to delete', 'error'); }
  };

  const handleClosePeriod = async (id: number) => {
    try {
      await apiFetch(`/hr/payroll/periods/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'closed' }),
      });
      addToast('Pay period closed', 'success');
      fetchPeriods();
    } catch { addToast('Failed to close period', 'error'); }
  };

  const handlePopulatePeriod = async (id: number) => {
    try {
      const result = await apiFetch<{ created: number; total: number }>(`/hr/payroll/periods/${id}/populate`, { method: 'POST' });
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
      await apiFetch('/hr/payroll/rates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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
      await apiFetch(`/hr/payroll/entries/${entryId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
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
      await apiFetch(`/hr/payroll/entries/${entryId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
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
    const dateStr = localToday();
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
    { key: 'overtime', label: 'Overtime', icon: AlertTriangle },
    { key: 'leave', label: 'Leave Balances', icon: Banknote },
  ];

  // ─── Render ───────────────────────────────────────────────

  // Set document title
  useEffect(() => { document.title = 'HR - Payroll \u2014 RMPG Flex'; }, []);

  // Keyboard shortcut: Escape to close modals
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setEditingEntry(null); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-sm text-xs font-medium shadow-lg ${
          toast.type === 'success' ? 'bg-green-600 text-white' : toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-brand-600 text-white'
        }`}>{toast.msg}</div>
      )}

      {/* Sub-tab bar */}
      <div className="flex flex-wrap items-center gap-1 px-3 py-1.5 border-b border-rmpg-700 bg-surface-sunken">
        {SUB_TABS.map(t => {
          const Icon = t.icon;
          return (
            <button type="button" key={t.key} onClick={() => setSubTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-sm transition-colors ${
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
              <button type="button" onClick={() => setShowPeriodForm(!showPeriodForm)}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-green-400 bg-green-900/20 hover:bg-green-900/40 border border-green-700/40 rounded-sm transition-colors">
                <Plus size={12} /> New Period
              </button>
            )}
            <button type="button" onClick={fetchPeriods}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] text-rmpg-400 hover:text-white hover:bg-rmpg-700/30 rounded-sm transition-colors">
              <RefreshCw size={12} /> Refresh
            </button>
          </div>

          {/* Create form */}
          {showPeriodForm && (
            <div className="bg-surface-sunken border border-rmpg-700 rounded-sm p-4 space-y-3">
              <h4 className="text-xs font-semibold text-white">Create Pay Period</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="text-[10px] text-rmpg-400 block mb-1">Name (optional)</label>
                  <input value={periodForm.name} onChange={e => setPeriodForm(p => ({ ...p, name: e.target.value }))}
                    className="w-full bg-surface-base border border-rmpg-700 rounded-sm px-2 py-1.5 text-xs text-white" placeholder="e.g. March 1-15" />
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 block mb-1">Start Date *</label>
                  <input type="date" value={periodForm.start_date} onChange={e => setPeriodForm(p => ({ ...p, start_date: e.target.value }))}
                    className="w-full bg-surface-base border border-rmpg-700 rounded-sm px-2 py-1.5 text-xs text-white" />
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 block mb-1">End Date *</label>
                  <input type="date" value={periodForm.end_date} onChange={e => setPeriodForm(p => ({ ...p, end_date: e.target.value }))}
                    className="w-full bg-surface-base border border-rmpg-700 rounded-sm px-2 py-1.5 text-xs text-white" />
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 block mb-1">Pay Date *</label>
                  <input type="date" value={periodForm.pay_date} onChange={e => setPeriodForm(p => ({ ...p, pay_date: e.target.value }))}
                    className="w-full bg-surface-base border border-rmpg-700 rounded-sm px-2 py-1.5 text-xs text-white" />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowPeriodForm(false)} className="px-3 py-1 text-[11px] text-rmpg-400 hover:text-white">Cancel</button>
                <button type="button" onClick={handleCreatePeriod}
                  className="px-4 py-1 text-[11px] font-medium bg-brand-500 hover:bg-brand-600 text-white rounded-sm transition-colors">Create</button>
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
                  className={`border rounded-sm transition-all cursor-pointer ${
                    selectedPeriod?.id === period.id
                      ? 'border-brand-500/60 bg-brand-500/5'
                      : 'border-rmpg-700 bg-surface-base hover:border-rmpg-700'
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
                        }}>{(period.status || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</span>
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
                            <button type="button" onClick={() => handlePopulatePeriod(period.id)} title="Auto-populate employees"
                              className="p-1 text-rmpg-500 hover:text-cyan-400 transition-colors"><Users size={13} /></button>
                            <button type="button" onClick={() => handleClosePeriod(period.id)} title="Close period"
                              className="p-1 text-rmpg-500 hover:text-green-400 transition-colors"><Check size={13} /></button>
                            <button type="button" onClick={() => handleDeletePeriod(period.id)} title="Delete"
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
              <button type="button" onClick={() => setShowRateForm(!showRateForm)}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-green-400 bg-green-900/20 hover:bg-green-900/40 border border-green-700/40 rounded-sm transition-colors">
                <Plus size={12} /> Set Rate
              </button>
            )}
          </div>

          {/* Create rate form */}
          {showRateForm && (
            <div className="bg-surface-sunken border border-rmpg-700 rounded-sm p-4 space-y-3">
              <h4 className="text-xs font-semibold text-white">Set Pay Rate</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] text-rmpg-400 block mb-1">Employee *</label>
                  <select value={rateForm.user_id} onChange={e => setRateForm(r => ({ ...r, user_id: e.target.value }))}
                    className="w-full bg-surface-base border border-rmpg-700 rounded-sm px-2 py-1.5 text-xs text-white">
                    <option value="">Select employee...</option>
                    {officers.map(o => <option key={o.id} value={o.id}>{o.full_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 block mb-1">Pay Type</label>
                  <select value={rateForm.pay_type} onChange={e => setRateForm(r => ({ ...r, pay_type: e.target.value }))}
                    className="w-full bg-surface-base border border-rmpg-700 rounded-sm px-2 py-1.5 text-xs text-white">
                    <option value="hourly">Hourly</option>
                    <option value="salary">Salary</option>
                    <option value="contract">Contract</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 block mb-1">Rate ($/hr) *</label>
                  <input type="number" step="0.01" value={rateForm.rate} onChange={e => setRateForm(r => ({ ...r, rate: e.target.value }))}
                    className="w-full bg-surface-base border border-rmpg-700 rounded-sm px-2 py-1.5 text-xs text-white" placeholder="25.00" />
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 block mb-1">OT Multiplier</label>
                  <input type="number" step="0.1" value={rateForm.overtime_rate} onChange={e => setRateForm(r => ({ ...r, overtime_rate: e.target.value }))}
                    className="w-full bg-surface-base border border-rmpg-700 rounded-sm px-2 py-1.5 text-xs text-white" />
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 block mb-1">Holiday Multiplier</label>
                  <input type="number" step="0.1" value={rateForm.holiday_rate} onChange={e => setRateForm(r => ({ ...r, holiday_rate: e.target.value }))}
                    className="w-full bg-surface-base border border-rmpg-700 rounded-sm px-2 py-1.5 text-xs text-white" />
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 block mb-1">Effective Date *</label>
                  <input type="date" value={rateForm.effective_date} onChange={e => setRateForm(r => ({ ...r, effective_date: e.target.value }))}
                    className="w-full bg-surface-base border border-rmpg-700 rounded-sm px-2 py-1.5 text-xs text-white" />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowRateForm(false)} className="px-3 py-1 text-[11px] text-rmpg-400 hover:text-white">Cancel</button>
                <button type="button" onClick={handleCreateRate}
                  className="px-4 py-1 text-[11px] font-medium bg-brand-500 hover:bg-brand-600 text-white rounded-sm transition-colors">Save Rate</button>
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
                  <tr className="border-b border-rmpg-700">
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
                    <tr key={rate.id} className="border-b border-rmpg-700/50 hover:bg-brand-500/5">
                      <td className="px-3 py-2 text-white font-medium">{rate.officer_name}</td>
                      <td className="px-3 py-2">
                        <span className="px-1.5 py-0.5 text-[9px] rounded-sm bg-brand-500/15 text-brand-400 uppercase font-bold">{rate.pay_type}</span>
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
            }} className="bg-surface-base border border-rmpg-700 rounded-sm px-2 py-1 text-xs text-white">
              <option value="">Select pay period...</option>
              {periods.map(p => <option key={p.id} value={p.id}>{p.name} ({p.status})</option>)}
            </select>
            {selectedPeriod && entries.length > 0 && (
              <button type="button"
                onClick={handleExportCSV}
                className="flex items-center gap-1 px-2 py-1 text-[11px] text-rmpg-400 hover:text-white hover:bg-rmpg-700/30 rounded-sm transition-colors"
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
                  <tr className="border-b border-rmpg-700">
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
                      <tr key={entry.id} className={`border-b border-rmpg-700/50 ${isEditing ? 'bg-brand-500/5' : 'hover:bg-brand-500/5'}`}>
                        <td className="px-2 py-2 text-white font-medium whitespace-nowrap">{entry.officer_name}</td>
                        <td className="px-2 py-2 text-right text-rmpg-300 font-mono">{entry.hourly_rate ? formatCurrency(entry.hourly_rate) : '—'}</td>
                        {isEditing ? (
                          <>
                            {['regular_hours', 'overtime_hours', 'holiday_hours', 'pto_hours', 'sick_hours'].map(field => (
                              <td key={field} className="px-1 py-1">
                                <input type="number" step="0.5" min="0"
                                  value={editValues[field] ?? 0}
                                  onChange={e => setEditValues(v => ({ ...v, [field]: Number(e.target.value) }))}
                                  className="w-16 bg-surface-sunken border border-brand-500/40 rounded-sm px-1.5 py-0.5 text-xs text-white text-right font-mono" />
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
                          }}>{(entry.status || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</span>
                        </td>
                        <td className="px-2 py-2 text-center">
                          {isManager && entry.status !== 'approved' && (
                            <div className="flex items-center justify-center gap-1">
                              {isEditing ? (
                                <>
                                  <button type="button" onClick={() => handleSaveEntry(entry.id)} className="p-0.5 text-green-400 hover:text-green-300"><Check size={13} /></button>
                                  <button type="button" onClick={() => setEditingEntry(null)} className="p-0.5 text-rmpg-500 hover:text-white"><X size={13} /></button>
                                </>
                              ) : (
                                <>
                                  <button type="button" onClick={() => startEditing(entry)} className="p-0.5 text-rmpg-500 hover:text-brand-400" title="Edit hours"><Edit3 size={13} /></button>
                                  <button type="button" onClick={() => handleApproveEntry(entry.id)} className="p-0.5 text-rmpg-500 hover:text-green-400" title="Approve"><Check size={13} /></button>
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
                    <tr className="border-t-2 border-rmpg-700">
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

      {/* ═══════════════════════════════════════════════════════ */}
      {/* Overtime Requests */}
      {/* ═══════════════════════════════════════════════════════ */}
      {subTab === 'overtime' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <AlertTriangle size={15} /> Overtime Requests
            </h3>
            <div className="flex-1" />
            <button type="button" onClick={() => setShowOtForm(true)} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-brand-500/20 text-brand-300 border border-brand-500/30 hover:bg-brand-500/30 transition-colors">
              <Plus size={13} /> Request OT
            </button>
          </div>

          {/* OT Request Form */}
          {showOtForm && (
            <div className="p-3 border border-brand-500/30 bg-surface-base space-y-2">
              <div className="text-xs font-bold text-white uppercase">New OT Request</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="text-[9px] text-rmpg-400 uppercase">Date *</label>
                  <input type="date" value={otForm.requested_date} onChange={e => setOtForm(p => ({ ...p, requested_date: e.target.value }))} className="w-full px-2 py-1 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none" />
                </div>
                <div>
                  <label className="text-[9px] text-rmpg-400 uppercase">Hours *</label>
                  <input type="number" step="0.5" value={otForm.hours_requested} onChange={e => setOtForm(p => ({ ...p, hours_requested: e.target.value }))} className="w-full px-2 py-1 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none" />
                </div>
                <div>
                  <label className="text-[9px] text-rmpg-400 uppercase">Reason</label>
                  <input value={otForm.reason} onChange={e => setOtForm(p => ({ ...p, reason: e.target.value }))} className="w-full px-2 py-1 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none" />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={handleRequestOt} className="flex items-center gap-1 px-3 py-1 text-xs bg-brand-500/20 text-brand-300 border border-brand-500/30 hover:bg-brand-500/30">
                  <Check size={12} /> Submit Request
                </button>
                <button type="button" onClick={() => setShowOtForm(false)} className="px-3 py-1 text-xs text-rmpg-400 hover:text-white">Cancel</button>
              </div>
            </div>
          )}

          {/* OT Requests List */}
          {otRequests.length === 0 ? (
            <div className="text-center py-8 text-rmpg-500 text-xs">No overtime requests</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-surface-sunken text-rmpg-500 text-[10px] uppercase">
                    <th className="text-left px-2 py-1.5">Officer</th>
                    <th className="text-left px-2 py-1.5">Date</th>
                    <th className="text-left px-2 py-1.5">Hours</th>
                    <th className="text-left px-2 py-1.5">Reason</th>
                    <th className="text-left px-2 py-1.5">Status</th>
                    {isManager && <th className="text-left px-2 py-1.5">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {otRequests.map(ot => (
                    <tr key={ot.id} className="border-b border-rmpg-700 hover:bg-surface-base">
                      <td className="px-2 py-1.5 text-white">{ot.officer_name}</td>
                      <td className="px-2 py-1.5 text-rmpg-300">{formatDate(ot.requested_date)}</td>
                      <td className="px-2 py-1.5 text-rmpg-300 font-mono">{ot.hours_requested}h</td>
                      <td className="px-2 py-1.5 text-rmpg-400 max-w-[200px] truncate">{ot.reason || '-'}</td>
                      <td className="px-2 py-1.5">
                        <span className={`inline-flex px-1.5 py-0.5 text-[9px] font-bold uppercase rounded-sm ${
                          ot.status === 'approved' ? 'bg-green-900/50 text-green-400' :
                          ot.status === 'denied' ? 'bg-red-900/50 text-red-400' :
                          'bg-amber-900/50 text-amber-400'
                        }`}>{(ot.status || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</span>
                      </td>
                      {isManager && (
                        <td className="px-2 py-1.5">
                          {ot.status === 'requested' && (
                            <div className="flex gap-1">
                              <button type="button" onClick={() => handleOtDecision(ot.id, 'approved')} className="text-green-400 hover:text-green-300 text-[10px] font-bold">Approve</button>
                              <button type="button" onClick={() => handleOtDecision(ot.id, 'denied')} className="text-red-400 hover:text-red-300 text-[10px] font-bold">Deny</button>
                            </div>
                          )}
                          {ot.status !== 'requested' && ot.reviewed_by_name && (
                            <span className="text-[9px] text-rmpg-500">by {ot.reviewed_by_name}</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════ */}
      {/* Leave Balances */}
      {/* ═══════════════════════════════════════════════════════ */}
      {subTab === 'leave' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Banknote size={15} className="text-brand-400" /> PTO / Leave Balances
            </h3>
            <span className="text-[9px] text-rmpg-500">Accrual: {PTO_ACCRUAL_PER_PAY_PERIOD} hrs/pay period ({ANNUAL_PTO_ALLOTMENT} hrs/year)</span>
            <div className="flex-1" />
            <button type="button" onClick={fetchLeaveBalances}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] text-rmpg-400 hover:text-white hover:bg-rmpg-700/30 rounded-sm transition-colors">
              <RefreshCw size={12} /> Refresh
            </button>
          </div>

          {leaveLoading ? (
            <div className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin text-brand-400 mx-auto" role="status" aria-label="Loading" /></div>
          ) : leaveData.length === 0 ? (
            <div className="text-center py-8 text-rmpg-500 text-xs">
              <p>No leave data loaded. Click Refresh to calculate balances.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[9px] text-rmpg-400 uppercase tracking-wider border-b border-rmpg-700">
                    <th className="text-left py-2 px-3">Officer</th>
                    <th className="text-left py-2 px-3">Badge</th>
                    <th className="text-right py-2 px-3">PTO Accrued</th>
                    <th className="text-right py-2 px-3">PTO Used</th>
                    <th className="text-right py-2 px-3">PTO Remaining</th>
                    <th className="text-right py-2 px-3">Sick Used</th>
                  </tr>
                </thead>
                <tbody>
                  {leaveData.map(lb => {
                    const accrued = lb.pto_pending + lb.pto_used;
                    const pctUsed = accrued > 0 ? (lb.pto_used / accrued) * 100 : 0;
                    return (
                      <tr key={lb.id} className="border-b border-rmpg-700/50 hover:bg-surface-raised/30">
                        <td className="py-2 px-3 text-white font-medium">{lb.full_name}</td>
                        <td className="py-2 px-3 text-rmpg-400 font-mono">{lb.badge_number || '—'}</td>
                        <td className="py-2 px-3 text-right text-rmpg-300">{accrued.toFixed(1)}h</td>
                        <td className="py-2 px-3 text-right text-amber-400">{lb.pto_used.toFixed(1)}h</td>
                        <td className="py-2 px-3 text-right">
                          <span className={lb.pto_pending <= 8 ? 'text-red-400 font-bold' : lb.pto_pending <= 24 ? 'text-amber-400' : 'text-green-400'}>
                            {lb.pto_pending.toFixed(1)}h
                          </span>
                          <div className="w-full h-1 bg-surface-sunken rounded-full mt-0.5 overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${Math.min(100, pctUsed)}%`, background: pctUsed > 80 ? '#ef4444' : pctUsed > 50 ? '#f59e0b' : '#22c55e' }} />
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right text-rmpg-300">{lb.sick_used.toFixed(1)}h</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
