// ═══════════════════════════════════════════════════════════════
// RMPG Flex — Fleet Costs Tab
//
// Consolidated cost-of-ownership dashboard. Shows lifetime TCO at a
// glance, plus per-category detailed lists (sub-tabs). Fuel and
// maintenance are integrated into both the summary stats and the
// monthly budget-vs-actual tracker. Budgets are edited inline — no
// modal — so the operator can adjust targets on the fly and
// immediately see the impact.
// ═══════════════════════════════════════════════════════════════

import React, { useState } from 'react';
import {
  CreditCard, Shield, Wrench, Zap, DollarSign, Calendar, Plus, Pencil, Trash2,
  AlertTriangle, Gauge, Receipt, TrendingUp, Target, Fuel, Check, X as XIcon, Save,
} from 'lucide-react';
import type {
  FleetLoan, FleetInsurancePolicy, FleetAccessory, FleetUtilityCost,
  FleetOtherCost, FleetCostSummary,
} from '../../../types';
import type { CostCategory } from '../modals/FleetCostFormModal';
import { parseTimestamp } from '../../../utils/dateUtils';
import { toDisplayLabel } from '../../../utils/formatters';
import { toNum, fmtFixed } from '../utils/fleetFormatters';

function isRealDate(d: unknown): d is string {
  if (typeof d !== 'string') return false;
  const t = d.trim();
  if (!t || t === 'None' || t === 'N/A' || t === '0') return false;
  return !isNaN(parseTimestamp(t).getTime());
}

type SubTab = 'loan' | 'insurance' | 'accessory' | 'utility' | 'other';

interface Props {
  loans: FleetLoan[];
  insurance: FleetInsurancePolicy[];
  accessories: FleetAccessory[];
  utilities: FleetUtilityCost[];
  other: FleetOtherCost[];
  summary: FleetCostSummary | null;
  subTab: SubTab;
  onSubTabChange: (t: SubTab) => void;
  onAdd: (category: CostCategory) => void;
  onEdit: (category: CostCategory, record: any) => void;
  onDelete: (category: CostCategory, record: any) => void;
  onSaveBudgets?: (rows: { category: string; monthly_budget: number }[]) => Promise<void>;
}

const SUB_TABS: { value: SubTab; label: string; icon: React.ComponentType<{ className?: string }>; color: string }[] = [
  { value: 'loan',      label: 'Loan',        icon: CreditCard, color: 'text-rmpg-400' },
  { value: 'insurance', label: 'Insurance',   icon: Shield,     color: 'text-green-400' },
  { value: 'accessory', label: 'Accessories', icon: Wrench,     color: 'text-amber-400' },
  { value: 'utility',   label: 'Utilities',   icon: Zap,        color: 'text-purple-400' },
  { value: 'other',     label: 'Other',       icon: Receipt,    color: 'text-brand-400' },
];

const BUDGET_CATEGORIES: { key: string; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'fuel',        label: 'Fuel',        icon: Fuel },
  { key: 'maintenance', label: 'Maintenance', icon: Wrench },
  { key: 'loan',        label: 'Loan',        icon: CreditCard },
  { key: 'insurance',   label: 'Insurance',   icon: Shield },
  { key: 'accessory',   label: 'Accessories', icon: Wrench },
  { key: 'utility',     label: 'Utilities',   icon: Zap },
  { key: 'other',       label: 'Other',       icon: Receipt },
];

function fmtCurrency(n: number | string | null | undefined, digits = 2): string {
  if (n == null || n === '') return '-';
  const v = toNum(n);
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  const colors: Record<string, string> = {
    active:     'bg-green-900/30 text-green-400 border-green-700/40',
    paid_off:   'bg-rmpg-800 text-rmpg-300 border-rmpg-700',
    refinanced: 'bg-surface-sunken/30 text-rmpg-400 border-border-default/40',
    defaulted:  'bg-red-900/30 text-red-400 border-red-700/40',
    expired:    'bg-amber-900/30 text-amber-400 border-amber-700/40',
    cancelled:  'bg-rmpg-800 text-rmpg-500 border-rmpg-700',
    installed:  'bg-green-900/30 text-green-400 border-green-700/40',
    removed:    'bg-rmpg-800 text-rmpg-500 border-rmpg-700',
    replaced:   'bg-surface-sunken/30 text-rmpg-400 border-border-default/40',
    damaged:    'bg-red-900/30 text-red-400 border-red-700/40',
    inactive:   'bg-rmpg-800 text-rmpg-500 border-rmpg-700',
  };
  return (
    <span className={`px-1 py-0.5 text-[8px] font-bold uppercase border ${colors[status] || 'bg-rmpg-800 text-rmpg-400 border-rmpg-700'}`}>
      {toDisplayLabel(status)}
    </span>
  );
}

export default function FleetCostsTab({
  loans, insurance, accessories, utilities, other, summary,
  subTab, onSubTabChange, onAdd, onEdit, onDelete, onSaveBudgets,
}: Props) {
  const monthly = summary?.monthly_commitment || {};
  const alerts = computeAlerts(insurance, loans, accessories, other);
  const [alertsOpen, setAlertsOpen] = useState(true);

  // Compute total monthly including fuel + maintenance from budget actuals.
  const budgets = summary?.budgets || {};
  const fuelMonthly = toNum(budgets.fuel?.actual);
  const maintMonthly = toNum(budgets.maintenance?.actual);
  const totalMonthly = toNum(monthly.total) + fuelMonthly + maintMonthly;

  return (
    <div className="p-4 space-y-3">
      {/* ── Upcoming-renewals alerts strip (next 60 days) ──────── */}
      {alerts.length > 0 && (
        <div className="panel-beveled bg-surface-sunken overflow-hidden">
          <button type="button"
            onClick={() => setAlertsOpen(!alertsOpen)}
            className="w-full flex items-center justify-between p-2 text-[9px] text-amber-400 uppercase font-bold tracking-wider hover:bg-rmpg-800/30 transition-colors">
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3" />
              Upcoming (next 60 days) — {alerts.length} item{alerts.length !== 1 ? 's' : ''}
            </span>
            <span className="text-rmpg-500">{alertsOpen ? '▲' : '▼'}</span>
          </button>
          {alertsOpen && (
            <div className="px-2 pb-2 space-y-1">
              {alerts.map((a, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px] text-amber-300 font-mono">
                  <span className="w-32 text-amber-400">{a.kind}</span>
                  <span className="min-w-0 flex-1 truncate">{a.label}</span>
                  <span className="text-rmpg-400">{a.date}</span>
                  <span className="text-amber-500 w-16 text-right">{a.days}d</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Budget vs. Actual — inline-editable rows ────────── */}
      {onSaveBudgets && summary && (
        <InlineBudgetEditor summary={summary} onSaveBudgets={onSaveBudgets} />
      )}

      {/* ── Cost Breakdown by Category ─────────────────────────── */}
      {summary && (
        <div className="panel-beveled bg-surface-sunken p-2">
          <div className="text-[8px] text-rmpg-500 uppercase font-bold tracking-wider mb-1">Lifetime Cost Breakdown</div>
          <CostBreakdown summary={summary} />
        </div>
      )}

      {/* ── Sub-tabs ──────────────────────────────────────────── */}
      <div className="panel-beveled bg-surface-sunken p-1 flex items-center gap-0.5">
        {SUB_TABS.map((t) => {
          const Icon = t.icon;
          const counts: Record<SubTab, number> = {
            loan: loans.length, insurance: insurance.length,
            accessory: accessories.length, utility: utilities.length,
            other: other.length,
          };
          const isActive = subTab === t.value;
          return (
            <button key={t.value} type="button"
              onClick={() => onSubTabChange(t.value)}
              className={`flex-1 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5 ${
                isActive ? `${t.color} bg-surface-base border border-rmpg-700` : 'text-rmpg-500 hover:text-rmpg-300 hover:bg-rmpg-800'
              }`}>
              <Icon className="w-3 h-3" />
              {t.label}
              <span className={`text-[8px] font-mono ${isActive ? t.color : 'text-rmpg-600'}`}>({counts[t.value]})</span>
            </button>
          );
        })}
      </div>

      {/* ── Active sub-tab list ───────────────────────────────── */}
      {subTab === 'loan'      && <LoanList      records={loans}        onAdd={() => onAdd('loan')}      onEdit={(r) => onEdit('loan', r)}      onDelete={(r) => onDelete('loan', r)} />}
      {subTab === 'insurance' && <InsuranceList records={insurance}    onAdd={() => onAdd('insurance')} onEdit={(r) => onEdit('insurance', r)} onDelete={(r) => onDelete('insurance', r)} />}
      {subTab === 'accessory' && <AccessoryList records={accessories}  onAdd={() => onAdd('accessory')} onEdit={(r) => onEdit('accessory', r)} onDelete={(r) => onDelete('accessory', r)} />}
      {subTab === 'utility'   && <UtilityList   records={utilities}    onAdd={() => onAdd('utility')}   onEdit={(r) => onEdit('utility', r)}   onDelete={(r) => onDelete('utility', r)} />}
      {subTab === 'other'     && <OtherList     records={other}        onAdd={() => onAdd('other')}     onEdit={(r) => onEdit('other', r)}     onDelete={(r) => onDelete('other', r)} />}
    </div>
  );
}

// ── Alerts ───────────────────────────────────────────────────────

interface AlertItem { kind: string; label: string; date: string; days: number; }

function computeAlerts(
  insurance: FleetInsurancePolicy[],
  loans: FleetLoan[],
  accessories: FleetAccessory[],
  other: FleetOtherCost[],
): AlertItem[] {
  const out: AlertItem[] = [];
  const within = (d: unknown): number | null => {
    if (!isRealDate(d)) return null;
    const days = Math.round((parseTimestamp(d).getTime() - Date.now()) / 86400_000);
    return Number.isFinite(days) && days >= 0 && days <= 60 ? days : null;
  };
  for (const p of insurance) {
    const days = within(p.expires_at);
    if (days != null) out.push({ kind: 'Insurance renews', label: p.carrier || '(policy)', date: p.expires_at || '', days });
  }
  for (const l of loans) {
    const days = within(l.payoff_date);
    if (days != null) out.push({ kind: 'Loan payoff', label: l.lender || '(loan)', date: l.payoff_date || '', days });
  }
  for (const a of accessories) {
    const w = a.warranty_until ?? a.warranty_expiry;
    const days = within(w);
    if (days != null) out.push({ kind: 'Warranty expires', label: a.name || '(accessory)', date: w || '', days });
  }
  for (const o of other) {
    const days = within(o.period_end);
    if (days != null) out.push({ kind: toDisplayLabel(o.cost_type || 'Other'), label: o.provider || o.cost_type || '(cost)', date: o.period_end || '', days });
  }
  return out.sort((a, b) => a.days - b.days);
}

// ── Stat ─────────────────────────────────────────────────────────

function Stat({ icon: Icon, label, value, color }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="panel-beveled p-2.5 text-center bg-surface-sunken">
      <Icon className={`w-3.5 h-3.5 mx-auto ${color} mb-1`} />
      <div className={`text-sm font-bold font-mono tabular-nums ${color}`}>{value}</div>
      <div className="text-[7px] text-rmpg-500 uppercase">{label}</div>
    </div>
  );
}

// ── Cost Breakdown ───────────────────────────────────────────────

function CostBreakdown({ summary }: { summary: FleetCostSummary }) {
  const total = toNum(summary.total_lifetime) || 1;
  const cat = summary.categories || {};
  const rows: { label: string; value: number; color: string }[] = [
    { label: 'Fuel',        value: toNum(cat.fuel),        color: 'bg-rmpg-600' },
    { label: 'Maintenance', value: toNum(cat.maintenance), color: 'bg-amber-600' },
    { label: 'Loan',        value: toNum(cat.loans),       color: 'bg-gray-600' },
    { label: 'Insurance',   value: toNum(cat.insurance),   color: 'bg-green-600' },
    { label: 'Accessories', value: toNum(cat.accessories), color: 'bg-purple-600' },
    { label: 'Utilities',   value: toNum(cat.utilities),   color: 'bg-pink-600' },
    { label: 'Other',       value: toNum(cat.other),       color: 'bg-yellow-600' },
  ];
  return (
    <div className="space-y-1">
      {rows.map((r) => {
        const pct = (r.value / total) * 100;
        return (
          <div key={r.label} className="flex items-center gap-2 text-[9px] font-mono">
            <span className="text-rmpg-400 w-20">{r.label}</span>
            <div className="flex-1 h-2 bg-surface-base border border-rmpg-800 overflow-hidden">
              <div className={`h-full ${r.color}`} style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
            <span className="text-rmpg-300 w-20 text-right">{fmtCurrency(r.value)}</span>
            <span className="text-rmpg-500 w-12 text-right">{pct.toFixed(1)}%</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Inline Budget Editor ─────────────────────────────────────────
// Replaces the modal-based editor with inline rows. Each category
// shows budget, actual, a bar, and an edit field. Saving is debounced
// per-row or bulk-saved from the top "Save All" button.

function InlineBudgetEditor({ summary, onSaveBudgets }: {
  summary: FleetCostSummary;
  onSaveBudgets: (rows: { category: string; monthly_budget: number }[]) => Promise<void>;
}) {
  const budgets = summary.budgets || {};
  const [editing, setEditing] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const c of BUDGET_CATEGORIES) {
      const b = budgets[c.key];
      init[c.key] = b && b.budget ? String(b.budget) : '';
    }
    return init;
  });
  const [saving, setSaving] = useState(false);

  const saveAll = async () => {
    setSaving(true);
    try {
      const rows = BUDGET_CATEGORIES.map((c) => ({ category: c.key, monthly_budget: parseFloat(vals[c.key]) || 0 }));
      await onSaveBudgets(rows);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    const init: Record<string, string> = {};
    for (const c of BUDGET_CATEGORIES) {
      const b = budgets[c.key];
      init[c.key] = b && b.budget ? String(b.budget) : '';
    }
    setVals(init);
    setEditing(false);
  };

  const hasAnySet = BUDGET_CATEGORIES.some((c) => {
    const b = budgets[c.key];
    return b && toNum(b.budget) > 0;
  });

  if (!editing && !hasAnySet) {
    return (
      <div className="panel-beveled bg-surface-sunken p-3 text-center">
        <p className="text-[9px] text-rmpg-500 mb-2">No monthly budgets set. Set targets to track spending per category.</p>
        <button type="button" className="toolbar-btn toolbar-btn-primary text-[9px]" onClick={() => setEditing(true)}>
          <Target className="w-3 h-3" /> Set Monthly Budgets
        </button>
      </div>
    );
  }

  return (
    <div className="panel-beveled bg-surface-sunken p-2">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1 text-[8px] text-rmpg-500 uppercase font-bold tracking-wider">
          <Target className="w-3 h-3 text-brand-400" /> Monthly Budget vs. Actual
        </div>
        <div className="p-4 space-y-2">
          {BUDGET_CATEGORIES.map((c) => (
            <div key={c.key} className="flex items-center gap-2">
              <label className="text-[10px] text-rmpg-400 w-28 uppercase">{c.label}</label>
              <input id="ff-fleetcoststab-0" type="number" step="0.01" min="0" className="input-dark flex-1 text-[11px] font-mono min-h-[32px]"
                value={vals[c.key]} onChange={(e) => setVals({ ...vals, [c.key]: e.target.value })} placeholder="0.00" />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-rmpg-700">
          <button type="button" className="toolbar-btn" onClick={cancel} disabled={saving}>
            <XIcon className="w-3 h-3" /> Cancel
          </button>
          <button type="button" className="toolbar-btn toolbar-btn-primary" onClick={saveAll} disabled={saving}>
            <Save className="w-3 h-3" /> {saving ? 'Saving...' : 'Save Budgets'}
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        {BUDGET_CATEGORIES.map((c) => {
          const raw = budgets[c.key];
          const budget = raw ? toNum(raw.budget) : 0;
          const actual = raw ? toNum(raw.actual) : 0;
          const over = raw?.over;
          const pct = budget > 0 ? (actual / budget) * 100 : 0;
          const barColor = over ? 'bg-red-600' : budget > 0 ? 'bg-green-600' : 'bg-rmpg-700';
          const Icon = c.icon;
          return (
            <div key={c.key} className="flex items-center gap-2 text-[9px] font-mono">
              <span className="text-rmpg-400 w-24 flex items-center gap-1">
                <Icon className="w-2.5 h-2.5" />{c.label}
              </span>
              {editing ? (
                <input type="number" step="0.01" min="0"
                  className="input-dark w-20 text-[10px] font-mono py-0.5 px-1 min-h-[24px]"
                  value={vals[c.key]}
                  onChange={(e) => setVals({ ...vals, [c.key]: e.target.value })}
                  placeholder="0.00" />
              ) : (
                <span className="text-rmpg-300 w-20 text-right">{fmtCurrency(budget)}</span>
              )}
              <div className="flex-1 h-2 bg-surface-base border border-rmpg-800 overflow-hidden">
                {budget > 0 && <div className={`h-full ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />}
              </div>
              <span className={`w-20 text-right ${over ? 'text-red-400' : 'text-rmpg-300'}`}>{fmtCurrency(actual)}</span>
              {budget > 0 && (
                <span className={`w-10 text-right text-[8px] uppercase font-bold ${over ? 'text-red-400' : 'text-green-400'}`}>
                  {over ? 'OVER' : pct < 50 ? 'Low' : 'OK'}
                </span>
              )}
              {!budget && <span className="w-10" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Per-category list components ─────────────────────────────────

function EmptyState({ icon: Icon, label, action, onAdd }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  action: string;
  onAdd: () => void;
}) {
  return (
    <div className="text-center py-10 panel-beveled bg-surface-base">
      <div className="w-14 h-14 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center" style={{ background: 'var(--surface-deep)' }}>
        <Icon className="w-7 h-7 text-rmpg-600" />
      </div>
      <p className="text-xs text-rmpg-400 font-semibold">{label}</p>
      <button type="button" className="toolbar-btn toolbar-btn-primary mt-3" onClick={onAdd}>
        <Plus className="w-3 h-3" /> {action}
      </button>
    </div>
  );
}

function ActionBar({ count, label, onAdd, addLabel, total }: { count: number; label: string; onAdd: () => void; addLabel: string; total?: string }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider flex items-center gap-2">
        <span>{label} ({count})</span>
        {total && <span className="text-green-400 font-mono normal-case">{total}</span>}
      </h3>
      <button type="button" className="toolbar-btn toolbar-btn-primary print:hidden" onClick={onAdd}>
        <Plus className="w-3 h-3" /> {addLabel}
      </button>
    </div>
  );
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex-shrink-0 flex items-center gap-1">
      <button type="button" onClick={(e) => { e.stopPropagation(); onEdit(); }}
        className="p-1 text-rmpg-500 hover:text-brand-400 hover:bg-rmpg-700 rounded-sm transition-colors" title="Edit">
        <Pencil className="w-3 h-3" />
      </button>
      <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="p-1 text-rmpg-500 hover:text-red-400 hover:bg-red-900/20 rounded-sm transition-colors" title="Archive">
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

// — Loan list —
function LoanList({ records, onAdd, onEdit, onDelete }: {
  records: FleetLoan[]; onAdd: () => void; onEdit: (r: FleetLoan) => void; onDelete: (r: FleetLoan) => void;
}) {
  if (records.length === 0) return <EmptyState icon={CreditCard} label="No Loans Recorded" action="Add Loan" onAdd={onAdd} />;
  return (
    <div className="space-y-2">
      <ActionBar count={records.length} label="Loans" onAdd={onAdd} addLabel="Add Loan"
        total={`Σ ${fmtCurrency(records.reduce((s, l) => s + toNum((l as any).monthly_payment), 0))}/mo`} />
      <div className="space-y-1.5">
        {records.map((l) => (
          <div key={l.id} className="panel-beveled p-2.5 flex items-center gap-3 bg-surface-base">
            <div className="flex-shrink-0 w-8 h-8 rounded-sm flex items-center justify-center bg-surface-sunken/20 border border-border-default/40">
              <CreditCard className="w-4 h-4 text-rmpg-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] text-rmpg-200 font-bold">{l.lender || '(no lender)'}</span>
                <StatusBadge status={l.status} />
                <span className="text-[10px] text-rmpg-400 font-mono">{fmtCurrency(l.monthly_payment)}/mo</span>
                {fmtFixed(l.interest_rate, 2, '') !== '' && (
                  <span className="text-[9px] font-mono text-rmpg-500">{fmtFixed(l.interest_rate, 2)}% APR</span>
                )}
                {l.term_months != null && (
                  <span className="text-[9px] font-mono text-rmpg-500">{l.term_months} mo</span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-[9px] text-rmpg-500 font-mono">
                <span>Original: {fmtCurrency(l.original_amount)}</span>
                {l.current_balance != null && <span>Balance: {fmtCurrency(l.current_balance)}</span>}
                <span>Started: {l.start_date}</span>
                {l.payoff_date && <span>Payoff: {l.payoff_date}</span>}
              </div>
              {l.notes && <p className="text-[9px] text-rmpg-400 mt-0.5">{l.notes}</p>}
            </div>
            <RowActions onEdit={() => onEdit(l)} onDelete={() => onDelete(l)} />
          </div>
        ))}
      </div>
    </div>
  );
}

// — Insurance list —
function InsuranceList({ records, onAdd, onEdit, onDelete }: {
  records: FleetInsurancePolicy[]; onAdd: () => void; onEdit: (r: FleetInsurancePolicy) => void; onDelete: (r: FleetInsurancePolicy) => void;
}) {
  if (records.length === 0) return <EmptyState icon={Shield} label="No Insurance Policies" action="Add Policy" onAdd={onAdd} />;
  const soon = (d: string | null) => {
    if (!d) return false;
    const diff = (parseTimestamp(d).getTime() - Date.now()) / 86400_000;
    return diff > 0 && diff < 30;
  };
  return (
    <div className="space-y-2">
      <ActionBar count={records.length} label="Insurance Policies" onAdd={onAdd} addLabel="Add Policy"
        total={`Σ ${fmtCurrency(records.reduce((s, p) => s + toNum((p as any).premium_amount ?? (p as any).premium), 0))} prem.`} />
      <div className="space-y-1.5">
        {records.map((p) => {
          const expSoon = soon(p.expires_at);
          return (
            <div key={p.id} className={`panel-beveled p-2.5 flex items-center gap-3 ${expSoon ? 'bg-amber-900/10 border border-amber-700/30' : 'bg-surface-base'}`}>
              <div className="flex-shrink-0 w-8 h-8 rounded-sm flex items-center justify-center bg-green-900/20 border border-green-700/40">
                <Shield className="w-4 h-4 text-green-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] text-rmpg-200 font-bold">{p.carrier || '(no carrier)'}</span>
                  <StatusBadge status={p.status} />
                  {p.policy_number && <span className="text-[9px] text-rmpg-500 font-mono">#{p.policy_number}</span>}
                  <span className="text-[10px] text-green-400 font-mono">{fmtCurrency(p.premium_amount)} {toDisplayLabel(p.premium_frequency)}</span>
                  {expSoon && (
                    <span className="text-[8px] font-bold uppercase text-amber-400 flex items-center gap-0.5">
                      <AlertTriangle className="w-2.5 h-2.5" /> Renews soon
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-[9px] text-rmpg-500 font-mono">
                  {p.coverage_type && <span>{toDisplayLabel(p.coverage_type)}</span>}
                  <span>From: {p.effective_from}</span>
                  {p.expires_at && <span>Expires: {p.expires_at}</span>}
                  {p.deductible != null && <span>Deductible: {fmtCurrency(p.deductible)}</span>}
                </div>
                {p.notes && <p className="text-[9px] text-rmpg-400 mt-0.5">{p.notes}</p>}
              </div>
              <RowActions onEdit={() => onEdit(p)} onDelete={() => onDelete(p)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// — Accessory list —
function AccessoryList({ records, onAdd, onEdit, onDelete }: {
  records: FleetAccessory[]; onAdd: () => void; onEdit: (r: FleetAccessory) => void; onDelete: (r: FleetAccessory) => void;
}) {
  if (records.length === 0) return <EmptyState icon={Wrench} label="No Accessories Tracked" action="Add Accessory" onAdd={onAdd} />;
  return (
    <div className="space-y-2">
      <ActionBar count={records.length} label="Accessories" onAdd={onAdd} addLabel="Add Accessory"
        total={`Σ ${fmtCurrency(records.reduce((s, a) => s + toNum((a as any).cost), 0))}`} />
      <div className="space-y-1.5">
        {records.map((a) => (
          <div key={a.id} className="panel-beveled p-2.5 flex items-center gap-3 bg-surface-base">
            <div className="flex-shrink-0 w-8 h-8 rounded-sm flex items-center justify-center bg-amber-900/20 border border-amber-700/40">
              <Wrench className="w-4 h-4 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] text-rmpg-200 font-bold">{a.name}</span>
                {a.category && <span className="text-[8px] font-bold uppercase text-amber-400 bg-amber-900/20 border border-amber-700/30 px-1 py-0.5">{toDisplayLabel(a.category)}</span>}
                <StatusBadge status={a.status} />
                <span className="text-[10px] text-amber-400 font-mono">{fmtCurrency(a.cost)}</span>
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-[9px] text-rmpg-500 font-mono">
                <span>Installed: {a.installed_date}</span>
                {a.removed_date && <span>Removed: {a.removed_date}</span>}
                {a.warranty_until && <span>Warranty until: {a.warranty_until}</span>}
                {a.vendor && <span>Vendor: {a.vendor}</span>}
                {a.serial_number && <span>S/N: {a.serial_number}</span>}
              </div>
              {a.notes && <p className="text-[9px] text-rmpg-400 mt-0.5">{a.notes}</p>}
            </div>
            <RowActions onEdit={() => onEdit(a)} onDelete={() => onDelete(a)} />
          </div>
        ))}
      </div>
    </div>
  );
}

// — Utility list —
function UtilityList({ records, onAdd, onEdit, onDelete }: {
  records: FleetUtilityCost[]; onAdd: () => void; onEdit: (r: FleetUtilityCost) => void; onDelete: (r: FleetUtilityCost) => void;
}) {
  if (records.length === 0) return <EmptyState icon={Zap} label="No Utility Costs Recorded" action="Add Utility" onAdd={onAdd} />;
  return (
    <div className="space-y-2">
      <ActionBar count={records.length} label="Utility Costs" onAdd={onAdd} addLabel="Add Utility"
        total={`Σ ${fmtCurrency(records.reduce((s, u) => s + toNum((u as any).cost_amount), 0))}`} />
      <div className="space-y-1.5">
        {records.map((u) => (
          <div key={u.id} className="panel-beveled p-2.5 flex items-center gap-3 bg-surface-base">
            <div className="flex-shrink-0 w-8 h-8 rounded-sm flex items-center justify-center bg-purple-900/20 border border-purple-700/40">
              <Zap className="w-4 h-4 text-purple-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] text-rmpg-200 font-bold">{toDisplayLabel(u.category)}</span>
                <span className="text-[10px] text-purple-400 font-mono">{fmtCurrency(u.cost_amount)} {toDisplayLabel(u.cost_frequency)}</span>
                {u.vehicle_id == null && (
                  <span className="text-[8px] font-bold uppercase text-rmpg-400 bg-rmpg-800 border border-rmpg-700 px-1 py-0.5">fleet-wide</span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-[9px] text-rmpg-500 font-mono">
                {u.provider && <span>{u.provider}</span>}
                <span>Period: {u.period_start}{u.period_end ? ` to ${u.period_end}` : ''}</span>
              </div>
              {u.notes && <p className="text-[9px] text-rmpg-400 mt-0.5">{u.notes}</p>}
            </div>
            <RowActions onEdit={() => onEdit(u)} onDelete={() => onDelete(u)} />
          </div>
        ))}
      </div>
    </div>
  );
}

// — Other (user-defined) list —
function OtherList({ records, onAdd, onEdit, onDelete }: {
  records: FleetOtherCost[]; onAdd: () => void; onEdit: (r: FleetOtherCost) => void; onDelete: (r: FleetOtherCost) => void;
}) {
  if (records.length === 0) return <EmptyState icon={Receipt} label="No Other Costs Recorded" action="Add Cost" onAdd={onAdd} />;
  return (
    <div className="space-y-2">
      <ActionBar count={records.length} label="Other Costs" onAdd={onAdd} addLabel="Add Cost"
        total={`Σ ${fmtCurrency(records.reduce((s, o) => s + toNum((o as any).amount), 0))}`} />
      <div className="space-y-1.5">
        {records.map((o) => (
          <div key={o.id} className="panel-beveled p-2.5 flex items-center gap-3 bg-surface-base">
            <div className="flex-shrink-0 w-8 h-8 rounded-sm flex items-center justify-center bg-brand-900/20 border border-brand-700/40">
              <Receipt className="w-4 h-4 text-brand-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] text-rmpg-200 font-bold">{toDisplayLabel(o.cost_type || '')}</span>
                <StatusBadge status={o.status} />
                <span className="text-[10px] text-brand-400 font-mono">{fmtCurrency(o.amount)} {toDisplayLabel(o.frequency || '')}</span>
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-[9px] text-rmpg-500 font-mono">
                {o.provider && <span>{o.provider}</span>}
                {o.incurred_date && <span>Incurred: {o.incurred_date}</span>}
                {o.period_end && <span>Until: {o.period_end}</span>}
              </div>
              {o.notes && <p className="text-[9px] text-rmpg-400 mt-0.5">{o.notes}</p>}
            </div>
            <RowActions onEdit={() => onEdit(o)} onDelete={() => onDelete(o)} />
          </div>
        ))}
      </div>
    </div>
  );
}
