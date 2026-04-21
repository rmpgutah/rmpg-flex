// ═══════════════════════════════════════════════════════════════
// RMPG Flex — Fleet Costs Tab
//
// Single tab that consolidates the four operating-cost categories
// (Loan / Insurance / Accessories / Utilities) under a sub-navigation
// strip. The cost-of-ownership summary at the top stays visible
// regardless of which sub-tab is active so the operator always sees
// the full TCO context.
//
// Each sub-list renders a compact row per record with category-specific
// fields, an Edit button (when handler wired), and a Delete (archive)
// button (admin/manager only — the parent decides whether to wire the
// callback). Empty states call out the action you can take.
// ═══════════════════════════════════════════════════════════════

import React from 'react';
import {
  CreditCard, Shield, Wrench, Zap, DollarSign, Calendar,
  Plus, Pencil, Trash2, AlertTriangle, TrendingUp, Gauge,
} from 'lucide-react';
import type {
  FleetLoan, FleetInsurancePolicy, FleetAccessory, FleetUtilityCost, FleetCostSummary,
} from '../../../types';
import type { CostCategory } from '../modals/FleetCostFormModal';

type SubTab = 'loan' | 'insurance' | 'accessory' | 'utility';

interface Props {
  loans: FleetLoan[];
  insurance: FleetInsurancePolicy[];
  accessories: FleetAccessory[];
  utilities: FleetUtilityCost[];
  summary: FleetCostSummary | null;
  /** Active sub-tab. Lifted to the parent so it survives re-mounts when
   *  the user switches outer tabs and back. */
  subTab: SubTab;
  onSubTabChange: (t: SubTab) => void;
  onAdd: (category: CostCategory) => void;
  onEdit: (category: CostCategory, record: any) => void;
  onDelete: (category: CostCategory, record: any) => void;
}

const SUB_TABS: { value: SubTab; label: string; icon: React.ComponentType<{ className?: string }>; color: string }[] = [
  { value: 'loan',      label: 'Loan',        icon: CreditCard, color: 'text-gray-400' },
  { value: 'insurance', label: 'Insurance',   icon: Shield,     color: 'text-green-400' },
  { value: 'accessory', label: 'Accessories', icon: Wrench,     color: 'text-amber-400' },
  { value: 'utility',   label: 'Utilities',   icon: Zap,        color: 'text-purple-400' },
];

function fmtCurrency(n: number | null | undefined, digits = 2): string {
  if (n == null) return '-';
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  const colors: Record<string, string> = {
    active:     'bg-green-900/30 text-green-400 border-green-700/40',
    paid_off:   'bg-rmpg-800 text-rmpg-300 border-rmpg-700',
    refinanced: 'bg-gray-900/30 text-gray-400 border-gray-700/40',
    defaulted:  'bg-red-900/30 text-red-400 border-red-700/40',
    expired:    'bg-amber-900/30 text-amber-400 border-amber-700/40',
    cancelled:  'bg-rmpg-800 text-rmpg-500 border-rmpg-700',
    installed:  'bg-green-900/30 text-green-400 border-green-700/40',
    removed:    'bg-rmpg-800 text-rmpg-500 border-rmpg-700',
    replaced:   'bg-gray-900/30 text-gray-400 border-gray-700/40',
    damaged:    'bg-red-900/30 text-red-400 border-red-700/40',
  };
  return (
    <span className={`px-1 py-0.5 text-[8px] font-bold uppercase border ${colors[status] || 'bg-rmpg-800 text-rmpg-400 border-rmpg-700'}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

export default function FleetCostsTab({
  loans, insurance, accessories, utilities, summary,
  subTab, onSubTabChange, onAdd, onEdit, onDelete,
}: Props) {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {/* ── Cost-of-ownership summary ─────────────────────────── */}
      {summary && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat icon={DollarSign} color="text-gray-400" label="Lifetime Cost" value={fmtCurrency(summary.total_lifetime)} />
            <Stat icon={Gauge}      color="text-brand-400" label="Cost / Mile"  value={summary.cost_per_mile != null ? fmtCurrency(summary.cost_per_mile, 3) : '-'} />
            <Stat icon={Calendar}   color="text-amber-400" label="Monthly Loan" value={fmtCurrency(summary.monthly_commitment.loan)} />
            <Stat icon={Shield}     color="text-green-400" label="Monthly Ins." value={fmtCurrency(summary.monthly_commitment.insurance)} />
          </div>
          <div className="panel-beveled bg-surface-sunken p-2">
            <div className="text-[8px] text-rmpg-500 uppercase font-bold tracking-wider mb-1">Cost Breakdown by Category</div>
            <CostBreakdown summary={summary} />
          </div>
        </>
      )}

      {/* ── Sub-tabs ──────────────────────────────────────────── */}
      <div className="panel-beveled bg-surface-sunken p-1 flex items-center gap-0.5">
        {SUB_TABS.map((t) => {
          const Icon = t.icon;
          const counts: Record<SubTab, number> = {
            loan: loans.length, insurance: insurance.length,
            accessory: accessories.length, utility: utilities.length,
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
    </div>
  );
}

// ── Stat & breakdown helpers ─────────────────────────────────────

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

function CostBreakdown({ summary }: { summary: FleetCostSummary }) {
  const total = summary.total_lifetime || 1;
  const rows: { label: string; value: number; color: string }[] = [
    { label: 'Fuel',        value: summary.categories.fuel,        color: 'bg-gray-600' },
    { label: 'Maintenance', value: summary.categories.maintenance, color: 'bg-amber-600' },
    { label: 'Loan',        value: summary.categories.loans,       color: 'bg-gray-600' },
    { label: 'Insurance',   value: summary.categories.insurance,   color: 'bg-green-600' },
    { label: 'Accessories', value: summary.categories.accessories, color: 'bg-purple-600' },
    { label: 'Utilities',   value: summary.categories.utilities,   color: 'bg-pink-600' },
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

// ── Per-category list components ─────────────────────────────────

function EmptyState({ icon: Icon, label, action, onAdd }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  action: string;
  onAdd: () => void;
}) {
  return (
    <div className="text-center py-10 panel-beveled bg-surface-base">
      <div className="w-14 h-14 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center" style={{ background: '#050505' }}>
        <Icon className="w-7 h-7 text-rmpg-600" />
      </div>
      <p className="text-xs text-rmpg-400 font-semibold">{label}</p>
      <button type="button" className="toolbar-btn toolbar-btn-primary mt-3" onClick={onAdd}>
        <Plus className="w-3 h-3" /> {action}
      </button>
    </div>
  );
}

function ActionBar({ count, label, onAdd, addLabel }: { count: number; label: string; onAdd: () => void; addLabel: string }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider">{label} ({count})</h3>
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
      <ActionBar count={records.length} label="Loans" onAdd={onAdd} addLabel="Add Loan" />
      <div className="space-y-1.5">
        {records.map((l) => (
          <div key={l.id} className="panel-beveled p-2.5 flex items-center gap-3 bg-surface-base">
            <div className="flex-shrink-0 w-8 h-8 rounded-sm flex items-center justify-center bg-gray-900/20 border border-gray-700/40">
              <CreditCard className="w-4 h-4 text-gray-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] text-rmpg-200 font-bold">{l.lender || '(no lender)'}</span>
                <StatusBadge status={l.status} />
                <span className="text-[10px] text-gray-400 font-mono">{fmtCurrency(l.monthly_payment)}/mo</span>
                {l.interest_rate != null && (
                  <span className="text-[9px] font-mono text-rmpg-500">{l.interest_rate.toFixed(2)}% APR</span>
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
  // Highlight policies expiring in the next 30 days.
  const soon = (d: string | null) => {
    if (!d) return false;
    const diff = (new Date(d).getTime() - Date.now()) / 86400_000;
    return diff > 0 && diff < 30;
  };
  return (
    <div className="space-y-2">
      <ActionBar count={records.length} label="Insurance Policies" onAdd={onAdd} addLabel="Add Policy" />
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
                  <span className="text-[10px] text-green-400 font-mono">{fmtCurrency(p.premium_amount)} {p.premium_frequency.replace('_', '-')}</span>
                  {expSoon && (
                    <span className="text-[8px] font-bold uppercase text-amber-400 flex items-center gap-0.5">
                      <AlertTriangle className="w-2.5 h-2.5" /> Renews soon
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-[9px] text-rmpg-500 font-mono">
                  {p.coverage_type && <span>{p.coverage_type}</span>}
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
      <ActionBar count={records.length} label="Accessories" onAdd={onAdd} addLabel="Add Accessory" />
      <div className="space-y-1.5">
        {records.map((a) => (
          <div key={a.id} className="panel-beveled p-2.5 flex items-center gap-3 bg-surface-base">
            <div className="flex-shrink-0 w-8 h-8 rounded-sm flex items-center justify-center bg-amber-900/20 border border-amber-700/40">
              <Wrench className="w-4 h-4 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] text-rmpg-200 font-bold">{a.name}</span>
                {a.category && <span className="text-[8px] font-bold uppercase text-amber-400 bg-amber-900/20 border border-amber-700/30 px-1 py-0.5">{a.category}</span>}
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
      <ActionBar count={records.length} label="Utility Costs" onAdd={onAdd} addLabel="Add Utility" />
      <div className="space-y-1.5">
        {records.map((u) => (
          <div key={u.id} className="panel-beveled p-2.5 flex items-center gap-3 bg-surface-base">
            <div className="flex-shrink-0 w-8 h-8 rounded-sm flex items-center justify-center bg-purple-900/20 border border-purple-700/40">
              <Zap className="w-4 h-4 text-purple-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] text-rmpg-200 font-bold">{u.category}</span>
                <span className="text-[10px] text-purple-400 font-mono">{fmtCurrency(u.cost_amount)} {u.cost_frequency.replace('_', '-')}</span>
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
