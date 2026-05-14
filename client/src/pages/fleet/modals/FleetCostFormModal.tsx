// ═══════════════════════════════════════════════════════════════
// RMPG Flex — Fleet Cost Form Modal
//
// One modal that handles all four cost categories — Loan, Insurance,
// Accessory, Utility — by switching the visible field set on the
// `category` prop. Keeping it consolidated means the open/close logic,
// validation, error display, and styling live in one place.
//
// The form payload is shaped to match the server's per-category
// fieldMap exactly (see registerCostCategoryRoutes() in fleet.ts), so
// the parent only needs a single `onSave(payload)` handler that POSTs
// to the right endpoint based on the category.
// ═══════════════════════════════════════════════════════════════

import React, { useEffect, useId, useState } from 'react';
import RichTextArea from '../../../components/RichTextArea';
import { Save, X as XIcon, AlertTriangle, CreditCard, Shield, Wrench, Zap } from 'lucide-react';
import PanelTitleBar from '../../../components/PanelTitleBar';

export type CostCategory = 'loan' | 'insurance' | 'accessory' | 'utility';

export interface CostFormState {
  // Common
  notes: string;
  // Loan
  lender: string;
  original_amount: string;
  current_balance: string;
  monthly_payment: string;
  interest_rate: string;
  term_months: string;
  start_date: string;
  payoff_date: string;
  loan_status: 'active' | 'paid_off' | 'refinanced' | 'defaulted';
  // Insurance
  carrier: string;
  policy_number: string;
  coverage_type: string;
  premium_amount: string;
  premium_frequency: 'monthly' | 'quarterly' | 'semi_annual' | 'annual';
  effective_from: string;
  expires_at: string;
  deductible: string;
  liability_limit: string;
  insurance_status: 'active' | 'expired' | 'cancelled';
  // Accessory
  name: string;
  accessory_category: string;
  installed_date: string;
  removed_date: string;
  cost: string;
  vendor: string;
  warranty_until: string;
  serial_number: string;
  accessory_status: 'installed' | 'removed' | 'replaced' | 'damaged';
  // Utility
  utility_category: string;
  provider: string;
  cost_amount: string;
  cost_frequency: 'one_time' | 'monthly' | 'quarterly' | 'semi_annual' | 'annual';
  period_start: string;
  period_end: string;
}

export const EMPTY_COST_FORM: CostFormState = {
  notes: '',
  lender: '', original_amount: '', current_balance: '', monthly_payment: '',
  interest_rate: '', term_months: '', start_date: '', payoff_date: '',
  loan_status: 'active',
  carrier: '', policy_number: '', coverage_type: '', premium_amount: '',
  premium_frequency: 'monthly', effective_from: '', expires_at: '',
  deductible: '', liability_limit: '', insurance_status: 'active',
  name: '', accessory_category: '', installed_date: '', removed_date: '',
  cost: '', vendor: '', warranty_until: '', serial_number: '',
  accessory_status: 'installed',
  utility_category: '', provider: '', cost_amount: '',
  cost_frequency: 'monthly', period_start: '', period_end: '',
};

const CATEGORY_META: Record<CostCategory, { title: string; icon: React.ComponentType<{ className?: string }> }> = {
  loan:      { title: 'LOAN PAYMENT',  icon: CreditCard },
  insurance: { title: 'INSURANCE',     icon: Shield },
  accessory: { title: 'ACCESSORY',     icon: Wrench },
  utility:   { title: 'UTILITY COST',  icon: Zap },
};

interface Props {
  isOpen: boolean;
  category: CostCategory;
  mode: 'create' | 'edit';
  form: CostFormState;
  onChange: (form: CostFormState) => void;
  onSave: (payload: Record<string, any>) => Promise<void>;
  onClose: () => void;
  saving: boolean;
}

/** Build the wire-format payload from the form state, picking only the
 *  fields the active category cares about. Numbers are parsed; empty
 *  strings become null so the server's `?? null` coercion works. */
function buildPayload(category: CostCategory, f: CostFormState): { payload: Record<string, any>; error: string | null } {
  const num = (s: string): number | null => {
    if (!s) return null;
    const n = parseFloat(s);
    return isFinite(n) ? n : null;
  };
  const intOrNull = (s: string): number | null => {
    if (!s) return null;
    const n = parseInt(s, 10);
    return isFinite(n) ? n : null;
  };
  const str = (s: string) => (s.trim() === '' ? null : s.trim());

  switch (category) {
    case 'loan': {
      if (!num(f.original_amount) || !num(f.monthly_payment) || !f.start_date) {
        return { payload: {}, error: 'Original amount, monthly payment, and start date are required' };
      }
      return {
        payload: {
          lender: str(f.lender),
          original_amount: num(f.original_amount),
          current_balance: num(f.current_balance),
          monthly_payment: num(f.monthly_payment),
          interest_rate: num(f.interest_rate),
          term_months: intOrNull(f.term_months),
          start_date: f.start_date,
          payoff_date: f.payoff_date || null,
          status: f.loan_status,
          notes: str(f.notes),
        },
        error: null,
      };
    }
    case 'insurance': {
      if (!num(f.premium_amount) || !f.effective_from) {
        return { payload: {}, error: 'Premium amount and effective-from date are required' };
      }
      return {
        payload: {
          carrier: str(f.carrier),
          policy_number: str(f.policy_number),
          coverage_type: str(f.coverage_type),
          premium_amount: num(f.premium_amount),
          premium_frequency: f.premium_frequency,
          effective_from: f.effective_from,
          expires_at: f.expires_at || null,
          deductible: num(f.deductible),
          liability_limit: num(f.liability_limit),
          status: f.insurance_status,
          notes: str(f.notes),
        },
        error: null,
      };
    }
    case 'accessory': {
      if (!f.name.trim() || !f.installed_date) {
        return { payload: {}, error: 'Name and installed date are required' };
      }
      return {
        payload: {
          name: f.name.trim(),
          category: str(f.accessory_category),
          installed_date: f.installed_date,
          removed_date: f.removed_date || null,
          cost: num(f.cost) ?? 0,
          vendor: str(f.vendor),
          warranty_until: f.warranty_until || null,
          serial_number: str(f.serial_number),
          status: f.accessory_status,
          notes: str(f.notes),
        },
        error: null,
      };
    }
    case 'utility': {
      if (!f.utility_category.trim() || !num(f.cost_amount) || !f.period_start) {
        return { payload: {}, error: 'Category, cost amount, and period start date are required' };
      }
      return {
        payload: {
          category: f.utility_category.trim(),
          provider: str(f.provider),
          cost_amount: num(f.cost_amount),
          cost_frequency: f.cost_frequency,
          period_start: f.period_start,
          period_end: f.period_end || null,
          notes: str(f.notes),
        },
        error: null,
      };
    }
  }
}

export default function FleetCostFormModal({
  isOpen, category, mode, form, onChange, onSave, onClose, saving,
}: Props) {
  const titleId = useId();
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, saving, onClose]);

  if (!isOpen) return null;
  const meta = CATEGORY_META[category];
  const set = (k: keyof CostFormState, v: string) => onChange({ ...form, [k]: v });

  const submit = async () => {
    setLocalError('');
    const { payload, error } = buildPayload(category, form);
    if (error) { setLocalError(error); return; }
    try {
      await onSave(payload);
    } catch (e: any) {
      setLocalError(e?.message || 'Save failed');
    }
  };

  return (
    <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center"
      role="dialog" aria-modal="true" aria-labelledby={titleId}
      style={{ background: 'rgba(0,0,0,0.6)' }} onClick={saving ? undefined : onClose}>
      <div className="panel-beveled w-[560px] max-w-full mx-4 max-h-[90vh] flex flex-col bg-surface-raised"
        onClick={(e) => e.stopPropagation()}>
        <PanelTitleBar title={`${mode === 'edit' ? 'EDIT' : 'NEW'} ${meta.title}`} icon={meta.icon} id={titleId}>
          <button type="button" className="toolbar-btn text-[9px]" onClick={onClose}>X</button>
        </PanelTitleBar>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {localError && (
            <div className="panel-beveled p-2 border border-red-700/40 bg-red-900/20">
              <div className="flex items-center gap-1.5 text-[10px] text-red-400"><AlertTriangle className="w-3 h-3" />{localError}</div>
            </div>
          )}

          {/* ── Loan fields ──────────────────────────────────── */}
          {category === 'loan' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Lender">
                <input className="input-dark w-full text-[11px] min-h-[36px]" value={form.lender}
                  onChange={(e) => set('lender', e.target.value)} placeholder="e.g. Wells Fargo Auto" />
              </Field>
              <Field label="Status">
                <select className="select-dark w-full text-[11px] min-h-[36px]" value={form.loan_status}
                  onChange={(e) => set('loan_status', e.target.value as CostFormState['loan_status'])}>
                  <option value="active">Active</option>
                  <option value="paid_off">Paid Off</option>
                  <option value="refinanced">Refinanced</option>
                  <option value="defaulted">Defaulted</option>
                </select>
              </Field>
              <Field label="Original Amount ($) *">
                <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="number" step="0.01" min="0"
                  value={form.original_amount} onChange={(e) => set('original_amount', e.target.value)} placeholder="35000" />
              </Field>
              <Field label="Current Balance ($)">
                <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="number" step="0.01" min="0"
                  value={form.current_balance} onChange={(e) => set('current_balance', e.target.value)} placeholder="22340" />
              </Field>
              <Field label="Monthly Payment ($) *">
                <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="number" step="0.01" min="0"
                  value={form.monthly_payment} onChange={(e) => set('monthly_payment', e.target.value)} placeholder="589.42" />
              </Field>
              <Field label="Interest Rate (%)">
                <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="number" step="0.01" min="0" max="100"
                  value={form.interest_rate} onChange={(e) => set('interest_rate', e.target.value)} placeholder="5.99" />
              </Field>
              <Field label="Term (months)">
                <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="number" step="1" min="0"
                  value={form.term_months} onChange={(e) => set('term_months', e.target.value)} placeholder="60" />
              </Field>
              <div />
              <Field label="Start Date *">
                <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="date"
                  value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />
              </Field>
              <Field label="Payoff Date">
                <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="date"
                  value={form.payoff_date} onChange={(e) => set('payoff_date', e.target.value)} />
              </Field>
            </div>
          )}

          {/* ── Insurance fields ─────────────────────────────── */}
          {category === 'insurance' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Carrier">
                <input className="input-dark w-full text-[11px] min-h-[36px]" value={form.carrier}
                  onChange={(e) => set('carrier', e.target.value)} placeholder="e.g. State Farm" />
              </Field>
              <Field label="Policy #">
                <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" value={form.policy_number}
                  onChange={(e) => set('policy_number', e.target.value)} placeholder="POL-12345-A" />
              </Field>
              <Field label="Coverage Type">
                <input className="input-dark w-full text-[11px] min-h-[36px]" value={form.coverage_type}
                  onChange={(e) => set('coverage_type', e.target.value)} placeholder="e.g. Liability + Collision" />
              </Field>
              <Field label="Status">
                <select className="select-dark w-full text-[11px] min-h-[36px]" value={form.insurance_status}
                  onChange={(e) => set('insurance_status', e.target.value as CostFormState['insurance_status'])}>
                  <option value="active">Active</option>
                  <option value="expired">Expired</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </Field>
              <Field label="Premium Amount ($) *">
                <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="number" step="0.01" min="0"
                  value={form.premium_amount} onChange={(e) => set('premium_amount', e.target.value)} placeholder="125.00" />
              </Field>
              <Field label="Billing Frequency *">
                <select className="select-dark w-full text-[11px] min-h-[36px]" value={form.premium_frequency}
                  onChange={(e) => set('premium_frequency', e.target.value as CostFormState['premium_frequency'])}>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="semi_annual">Semi-Annual</option>
                  <option value="annual">Annual</option>
                </select>
              </Field>
              <Field label="Effective From *">
                <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="date"
                  value={form.effective_from} onChange={(e) => set('effective_from', e.target.value)} />
              </Field>
              <Field label="Expires At">
                <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="date"
                  value={form.expires_at} onChange={(e) => set('expires_at', e.target.value)} />
              </Field>
              <Field label="Deductible ($)">
                <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="number" step="0.01" min="0"
                  value={form.deductible} onChange={(e) => set('deductible', e.target.value)} placeholder="500" />
              </Field>
              <Field label="Liability Limit ($)">
                <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="number" step="0.01" min="0"
                  value={form.liability_limit} onChange={(e) => set('liability_limit', e.target.value)} placeholder="100000" />
              </Field>
            </div>
          )}

          {/* ── Accessory fields ─────────────────────────────── */}
          {category === 'accessory' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name *">
                <input className="input-dark w-full text-[11px] min-h-[36px]" value={form.name}
                  onChange={(e) => set('name', e.target.value)} placeholder="e.g. Whelen Edge 9M Light Bar" />
              </Field>
              <Field label="Category">
                <input className="input-dark w-full text-[11px] min-h-[36px]" value={form.accessory_category}
                  onChange={(e) => set('accessory_category', e.target.value)}
                  placeholder="e.g. Lighting / Radio / Cage" list="accessory-cats" />
                <datalist id="accessory-cats">
                  <option value="Lighting" />
                  <option value="Radio" />
                  <option value="Camera" />
                  <option value="Prisoner Cage" />
                  <option value="Push Bumper" />
                  <option value="Decals" />
                  <option value="Computer/MDT" />
                  <option value="GPS" />
                </datalist>
              </Field>
              <Field label="Installed Date *">
                <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="date"
                  value={form.installed_date} onChange={(e) => set('installed_date', e.target.value)} />
              </Field>
              <Field label="Cost ($)">
                <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="number" step="0.01" min="0"
                  value={form.cost} onChange={(e) => set('cost', e.target.value)} />
              </Field>
              <Field label="Vendor">
                <input className="input-dark w-full text-[11px] min-h-[36px]" value={form.vendor}
                  onChange={(e) => set('vendor', e.target.value)} placeholder="e.g. Galls" />
              </Field>
              <Field label="Status">
                <select className="select-dark w-full text-[11px] min-h-[36px]" value={form.accessory_status}
                  onChange={(e) => set('accessory_status', e.target.value as CostFormState['accessory_status'])}>
                  <option value="installed">Installed</option>
                  <option value="removed">Removed</option>
                  <option value="replaced">Replaced</option>
                  <option value="damaged">Damaged</option>
                </select>
              </Field>
              <Field label="Warranty Until">
                <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="date"
                  value={form.warranty_until} onChange={(e) => set('warranty_until', e.target.value)} />
              </Field>
              <Field label="Serial Number">
                <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" value={form.serial_number}
                  onChange={(e) => set('serial_number', e.target.value)} />
              </Field>
              <Field label="Removed Date">
                <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="date"
                  value={form.removed_date} onChange={(e) => set('removed_date', e.target.value)} />
              </Field>
            </div>
          )}

          {/* ── Utility fields ───────────────────────────────── */}
          {category === 'utility' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category *">
                <input className="input-dark w-full text-[11px] min-h-[36px]" value={form.utility_category}
                  onChange={(e) => set('utility_category', e.target.value)}
                  placeholder="e.g. Charging / Storage / Parking" list="utility-cats" />
                <datalist id="utility-cats">
                  <option value="Charging Electricity" />
                  <option value="Storage Rent" />
                  <option value="Parking" />
                  <option value="Garage Allocation" />
                  <option value="Wash / Detailing" />
                  <option value="Toll Account" />
                </datalist>
              </Field>
              <Field label="Provider">
                <input className="input-dark w-full text-[11px] min-h-[36px]" value={form.provider}
                  onChange={(e) => set('provider', e.target.value)} placeholder="e.g. Rocky Mountain Power" />
              </Field>
              <Field label="Cost Amount ($) *">
                <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="number" step="0.01" min="0"
                  value={form.cost_amount} onChange={(e) => set('cost_amount', e.target.value)} />
              </Field>
              <Field label="Frequency *">
                <select className="select-dark w-full text-[11px] min-h-[36px]" value={form.cost_frequency}
                  onChange={(e) => set('cost_frequency', e.target.value as CostFormState['cost_frequency'])}>
                  <option value="one_time">One-time</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="semi_annual">Semi-Annual</option>
                  <option value="annual">Annual</option>
                </select>
              </Field>
              <Field label="Period Start *">
                <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="date"
                  value={form.period_start} onChange={(e) => set('period_start', e.target.value)} />
              </Field>
              <Field label="Period End">
                <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="date"
                  value={form.period_end} onChange={(e) => set('period_end', e.target.value)} />
              </Field>
            </div>
          )}

          {/* ── Notes (shared) ───────────────────────────────── */}
          <div>
            <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Notes</label>
            <RichTextArea className="input-dark w-full text-[10px] h-14 resize-none min-h-[36px]" value={form.notes}
              onChange={(e) => set('notes', e.target.value)} maxLength={2000} />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-rmpg-700">
          <button type="button" className="toolbar-btn" onClick={onClose} disabled={saving}>
            <XIcon className="w-3 h-3" /> Cancel
          </button>
          <button type="button" className="toolbar-btn toolbar-btn-primary" onClick={submit} disabled={saving}>
            <Save className="w-3 h-3" /> {saving ? 'Saving...' : mode === 'edit' ? 'Update' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">{label}</label>
      {children}
    </div>
  );
}
