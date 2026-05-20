// ═══════════════════════════════════════════════════════════════
// RMPG Flex — Fleet Expenses Tab
//
// Displays vehicle-specific expenses (registration, tolls, parking,
// car wash, tickets, towing, permits, misc) with add/edit/delete
// capabilities and PDF report export.
// ═══════════════════════════════════════════════════════════════

import React, { useEffect, useState } from 'react';
import {
  Plus, Trash2, Pencil, FileText, Receipt, Car, ParkingCircle,
  AlertTriangle, Truck, FileCheck, MoreHorizontal, DollarSign,
  Shield, Wrench, Paintbrush, Warehouse, LifeBuoy, ClipboardCheck, Cpu, Package,
} from 'lucide-react';
import IconButton from '../../../components/IconButton';
import { apiFetch } from '../../../hooks/useApi';
import type { FleetVehicle, FleetExpense, FleetExpenseCategory } from '../../../types';
import { generateFleetExpensesReportPdf } from '../utils/fleetExpensesReportPdf';

interface Props {
  vehicle: FleetVehicle;
  canManage: boolean;
}

const CATEGORY_META: Record<FleetExpenseCategory, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  registration:        { label: 'Registration/Renewal',  icon: FileCheck,      color: 'text-blue-400' },
  tolls:               { label: 'Tolls',                  icon: Car,            color: 'text-amber-400' },
  parking:             { label: 'Parking',                icon: ParkingCircle,  color: 'text-purple-400' },
  car_wash:            { label: 'Car Wash/Cleaning',      icon: Car,            color: 'text-cyan-400' },
  tickets:             { label: 'Tickets/Fines',          icon: AlertTriangle,  color: 'text-red-400' },
  towing:              { label: 'Towing',                 icon: Truck,          color: 'text-orange-400' },
  permits:             { label: 'Permits',                icon: FileCheck,      color: 'text-green-400' },
  insurance:           { label: 'Insurance',              icon: Shield,         color: 'text-indigo-400' },
  equipment:           { label: 'Equipment',              icon: Wrench,         color: 'text-yellow-400' },
  decals_wraps:        { label: 'Decals/Wraps',           icon: Paintbrush,     color: 'text-pink-400' },
  storage:             { label: 'Storage',                icon: Warehouse,      color: 'text-stone-400' },
  roadside_assistance: { label: 'Roadside Assistance',    icon: LifeBuoy,       color: 'text-emerald-400' },
  inspection:          { label: 'Inspection',             icon: ClipboardCheck, color: 'text-teal-400' },
  electronics:         { label: 'Electronics',            icon: Cpu,            color: 'text-violet-400' },
  accessories:         { label: 'Accessories',            icon: Package,        color: 'text-lime-400' },
  misc:                { label: 'Miscellaneous',          icon: MoreHorizontal, color: 'text-gray-400' },
};

const CATEGORIES = Object.keys(CATEGORY_META) as FleetExpenseCategory[];

function fmtCurrency(n: number | null | undefined): string {
  if (n == null) return '-';
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface FormState {
  expense_date: string;
  category: FleetExpenseCategory;
  amount: string;
  vendor: string;
  description: string;
  odometer_reading: string;
  recurring: boolean;
  recurring_frequency: string;
  notes: string;
}

const emptyForm: FormState = {
  expense_date: new Date().toISOString().slice(0, 10),
  category: 'misc',
  amount: '',
  vendor: '',
  description: '',
  odometer_reading: '',
  recurring: false,
  recurring_frequency: 'monthly',
  notes: '',
};

export default function FleetExpensesTab({ vehicle, canManage }: Props) {
  const [expenses, setExpenses] = useState<FleetExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchExpenses = () => {
    apiFetch<{ data: FleetExpense[] }>(`/api/fleet/${vehicle.id}/expenses`)
      .then(r => setExpenses(r.data || []))
      .catch(() => setExpenses([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchExpenses(); }, [vehicle.id]);

  const handleSave = async () => {
    if (!form.expense_date || !form.amount) { setError('Date and amount are required'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = {
        expense_date: form.expense_date,
        category: form.category,
        amount: Number(form.amount),
        vendor: form.vendor || null,
        description: form.description || null,
        odometer_reading: form.odometer_reading ? Number(form.odometer_reading) : null,
        recurring: form.recurring,
        recurring_frequency: form.recurring ? form.recurring_frequency : null,
        notes: form.notes || null,
      };
      if (editingId) {
        await apiFetch(`/api/fleet/expenses/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiFetch(`/api/fleet/${vehicle.id}/expenses`, { method: 'POST', body: JSON.stringify(payload) });
      }
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm);
      fetchExpenses();
    } catch (err: any) {
      setError(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string | number) => {
    if (!confirm('Archive this expense?')) return;
    try {
      await apiFetch(`/api/fleet/expenses/${id}`, { method: 'DELETE' });
      fetchExpenses();
    } catch { /* ignore */ }
  };

  const handleEdit = (expense: FleetExpense) => {
    setEditingId(expense.id || null);
    setForm({
      expense_date: expense.expense_date ? expense.expense_date.slice(0, 10) : '',
      category: expense.category,
      amount: String(expense.amount || ''),
      vendor: expense.vendor || '',
      description: expense.description || '',
      odometer_reading: expense.odometer_reading ? String(expense.odometer_reading) : '',
      recurring: !!(expense.recurring),
      recurring_frequency: expense.recurring_frequency || 'monthly',
      notes: expense.notes || '',
    });
    setShowForm(true);
  };

  const handlePdfExport = () => {
    generateFleetExpensesReportPdf({ vehicle, expenses });
  };

  // Category summary
  const catSummary: Record<string, number> = {};
  let total = 0;
  for (const e of expenses) {
    catSummary[e.category] = (catSummary[e.category] || 0) + e.amount;
    total += e.amount;
  }

  if (loading) return <div className="p-4 text-rmpg-500 text-xs">Loading expenses...</div>;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {/* Summary strip */}
      <div className="panel-beveled bg-surface-sunken p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-[#d4a017]" />
            <span className="text-[9px] font-bold text-rmpg-400 uppercase tracking-wider">Expense Summary</span>
          </div>
          <span className="text-sm font-bold text-white">{fmtCurrency(total)}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
          {Object.entries(catSummary).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([cat, amt]) => {
            const meta = CATEGORY_META[cat as FleetExpenseCategory];
            return (
              <div key={cat} className="bg-surface-base p-1.5 border border-[#222222]">
                <div className={`text-[8px] ${meta?.color || 'text-rmpg-400'} font-bold uppercase`}>{meta?.label || cat}</div>
                <div className="text-xs text-white font-mono">{fmtCurrency(amt)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-2">
        {canManage && (
          <button
            onClick={() => { setShowForm(true); setEditingId(null); setForm(emptyForm); }}
            className="flex items-center gap-1 px-2 py-1 text-[10px] bg-[#d4a017]/20 text-[#d4a017] border border-[#d4a017]/40 hover:bg-[#d4a017]/30"
          >
            <Plus className="w-3 h-3" /> Add Expense
          </button>
        )}
        {expenses.length > 0 && (
          <button
            onClick={handlePdfExport}
            className="flex items-center gap-1 px-2 py-1 text-[10px] bg-surface-raised text-rmpg-300 border border-[#222222] hover:bg-surface-base"
          >
            <FileText className="w-3 h-3" /> PDF Report
          </button>
        )}
      </div>

      {/* Add/Edit form */}
      {showForm && (
        <div className="panel-beveled bg-surface-raised p-3 border border-[#222222] space-y-2">
          <div className="text-[10px] font-bold text-[#d4a017] uppercase">
            {editingId ? 'Edit Expense' : 'New Expense'}
          </div>
          {error && <div className="text-[9px] text-red-400">{error}</div>}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <div>
              <label className="block text-[8px] text-rmpg-500 uppercase mb-0.5">Date *</label>
              <input type="date" value={form.expense_date}
                onChange={e => setForm(f => ({ ...f, expense_date: e.target.value }))}
                className="w-full px-1.5 py-1 text-xs bg-surface-sunken border border-[#222222] text-white" />
            </div>
            <div>
              <label className="block text-[8px] text-rmpg-500 uppercase mb-0.5">Category *</label>
              <select value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value as FleetExpenseCategory }))}
                className="w-full px-1.5 py-1 text-xs bg-surface-sunken border border-[#222222] text-white">
                {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_META[c].label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[8px] text-rmpg-500 uppercase mb-0.5">Amount *</label>
              <input type="number" step="0.01" value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                className="w-full px-1.5 py-1 text-xs bg-surface-sunken border border-[#222222] text-white" placeholder="0.00" />
            </div>
            <div>
              <label className="block text-[8px] text-rmpg-500 uppercase mb-0.5">Vendor</label>
              <input type="text" value={form.vendor}
                onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))}
                className="w-full px-1.5 py-1 text-xs bg-surface-sunken border border-[#222222] text-white" />
            </div>
            <div>
              <label className="block text-[8px] text-rmpg-500 uppercase mb-0.5">Description</label>
              <input type="text" value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full px-1.5 py-1 text-xs bg-surface-sunken border border-[#222222] text-white" />
            </div>
            <div>
              <label className="block text-[8px] text-rmpg-500 uppercase mb-0.5">Odometer</label>
              <input type="number" value={form.odometer_reading}
                onChange={e => setForm(f => ({ ...f, odometer_reading: e.target.value }))}
                className="w-full px-1.5 py-1 text-xs bg-surface-sunken border border-[#222222] text-white" />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1 text-[9px] text-rmpg-400 cursor-pointer">
              <input type="checkbox" checked={form.recurring}
                onChange={e => setForm(f => ({ ...f, recurring: e.target.checked }))}
                className="accent-[#d4a017]" />
              Recurring
            </label>
            {form.recurring && (
              <select value={form.recurring_frequency}
                onChange={e => setForm(f => ({ ...f, recurring_frequency: e.target.value }))}
                className="px-1.5 py-0.5 text-xs bg-surface-sunken border border-[#222222] text-white">
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="semi_annual">Semi-Annual</option>
                <option value="annual">Annual</option>
              </select>
            )}
          </div>
          <div>
            <label className="block text-[8px] text-rmpg-500 uppercase mb-0.5">Notes</label>
            <textarea value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="w-full px-1.5 py-1 text-xs bg-surface-sunken border border-[#222222] text-white resize-none" />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button onClick={handleSave} disabled={saving}
              className="px-3 py-1 text-[10px] bg-[#d4a017] text-black font-bold hover:bg-[#d4a017]/80 disabled:opacity-50">
              {saving ? 'Saving...' : editingId ? 'Update' : 'Save'}
            </button>
            <button onClick={() => { setShowForm(false); setEditingId(null); setError(''); }}
              className="px-3 py-1 text-[10px] bg-surface-sunken text-rmpg-400 border border-[#222222] hover:bg-surface-base">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Expense list */}
      {expenses.length === 0 ? (
        <div className="text-center py-8 text-rmpg-500 text-xs">
          <Receipt className="w-8 h-8 mx-auto mb-2 opacity-30" />
          No expenses recorded. {canManage && 'Click "Add Expense" to log one.'}
        </div>
      ) : (
        <div className="space-y-1">
          {expenses.map(expense => {
            const meta = CATEGORY_META[expense.category as FleetExpenseCategory] || CATEGORY_META.misc;
            const Icon = meta.icon;
            return (
              <div key={expense.id} className="panel-beveled bg-surface-raised p-2 border border-[#222222] flex items-center gap-3">
                <Icon className={`w-4 h-4 ${meta.color} flex-shrink-0`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-white font-bold">{meta.label}</span>
                    {expense.recurring ? <span className="text-[7px] text-purple-400 font-bold uppercase">Recurring</span> : null}
                  </div>
                  <div className="text-[8px] text-rmpg-500 truncate">
                    {expense.expense_date ? expense.expense_date.slice(0, 10) : ''}
                    {expense.vendor ? ` - ${expense.vendor}` : ''}
                    {expense.description ? ` - ${expense.description}` : ''}
                  </div>
                </div>
                <span className="text-xs font-mono text-white font-bold">{fmtCurrency(expense.amount)}</span>
                {canManage && (
                  <div className="flex items-center gap-0.5">
                    <IconButton onClick={() => handleEdit(expense)} aria-label={`Edit expense ${expense.id}`} className="p-1 text-rmpg-500 hover:text-white">
                      <Pencil className="w-3 h-3" />
                    </IconButton>
                    <IconButton onClick={() => handleDelete(expense.id!)} aria-label={`Delete expense ${expense.id}`} className="p-1 text-rmpg-500 hover:text-red-400">
                      <Trash2 className="w-3 h-3" />
                    </IconButton>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
