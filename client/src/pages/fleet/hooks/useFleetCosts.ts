import { useCallback, useRef, useState } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import { useToast } from '../../../components/ToastProvider';
import type { CostSubTab } from '../FleetDetailPanel';
import { type CostCategory, type CostFormState, EMPTY_COST_FORM } from '../modals/FleetCostFormModal';
import type {
  FleetLoan, FleetInsurancePolicy, FleetAccessory, FleetUtilityCost, FleetOtherCost,
  FleetCostBudget, FleetCostSummary, FleetFuelSummary, FleetMaintenance,
} from '../../../types';

export interface FleetCostsResult {
  loans: FleetLoan[];
  insurancePolicies: FleetInsurancePolicy[];
  accessories: FleetAccessory[];
  utilities: FleetUtilityCost[];
  otherCosts: FleetOtherCost[];
  costSummary: FleetCostSummary | null;
  costSubTab: CostSubTab;
  setCostSubTab: (t: CostSubTab) => void;
  costModalOpen: boolean;
  costCategory: CostCategory;
  costMode: 'create' | 'edit';
  costInitial: CostFormState | null;
  editingCostId: string | number | null;
  savingCost: boolean;
  deletingCost: { category: CostCategory; record: any } | null;
  costPerMile: any;
  costPerMileLoading: boolean;
  handleAddCost: (c: CostCategory) => void;
  handleEditCost: (c: CostCategory, r: any) => void;
  handleDeleteCost: (c: CostCategory, r: any) => void;
  confirmDeleteCost: () => Promise<void>;
  cancelDeleteCost: () => void;
  handleSaveCost: (payload: Record<string, any>) => Promise<void>;
  handleSaveBudgets: (rows: { category: string; monthly_budget: number }[]) => Promise<void>;
  closeCostModal: () => void;
  loadCostPerMile: (id: string | number, silent?: boolean) => Promise<void>;
  clearCostPerMile: () => void;
  resetCosts: () => void;
  /** Hand this to `useVehicleDetail`'s `onLazyLoad` (via FleetPage's ref bridge).
   *  Stable for the lifetime of the hook, so it can never re-fire that effect. */
  onCostsLazyLoad: (tab: string, id: string | number) => void;
}

/** Cost-of-ownership state for the selected vehicle's Costs tab: the five
 *  category lists (loans/insurance/accessories/utilities/other-costs), the
 *  derived TCO `costSummary`, the cost-per-mile stat, and every handler the
 *  Costs tab + its edit/delete modals need.
 *
 *  **What it does:** fetches all five categories (plus cost-budgets and the
 *  trailing monthly-cost-averages) when the Costs tab becomes active,
 *  recomputes `costSummary` client-side from the results, and exposes CRUD
 *  handlers that re-fetch on success.
 *
 *  **How to use it:** pass the selected vehicle id plus `fuelSummary` and
 *  `maintenance` from `useVehicleDetail` (the summary needs their totals). Wire
 *  `onCostsLazyLoad` into `useVehicleDetail`'s `onLazyLoad`, and `resetCosts`
 *  into its `onCostsReset`, so cost data neither loads nor lingers on the wrong
 *  vehicle.
 *
 *  **What it depends on:** `apiFetch`, `useToast`.
 *
 *  ⚠️ This hook deliberately owns NO effect. The Costs-tab fetch is triggered by
 *  `useVehicleDetail` calling `onCostsLazyLoad` from inside its one
 *  skip-guarded lazy-load effect. An earlier revision ran its own
 *  `useEffect([selectedId, activeTab, fetchCosts])` here, which broke twice
 *  over: `fetchCosts`'s identity chains through `costPerMile` and `fuelSummary`,
 *  both of which settle AFTER the first fetch, so opening the tab issued the
 *  7-endpoint round THREE times (21 requests for 7); and being outside the guard,
 *  it also fired a full round on every vehicle switch, where pre-Phase-2
 *  behavior issued zero. Do not reintroduce an effect here. */
export function useFleetCosts(
  selectedId: string | number | null,
  fuelSummary: FleetFuelSummary | null,
  maintenance: FleetMaintenance[],
): FleetCostsResult {
  const { addToast } = useToast();
  const [loans, setLoans] = useState<FleetLoan[]>([]);
  const [insurancePolicies, setInsurancePolicies] = useState<FleetInsurancePolicy[]>([]);
  const [accessories, setAccessories] = useState<FleetAccessory[]>([]);
  const [utilities, setUtilities] = useState<FleetUtilityCost[]>([]);
  const [otherCosts, setOtherCosts] = useState<FleetOtherCost[]>([]);
  const [costSummary, setCostSummary] = useState<FleetCostSummary | null>(null);
  const [costSubTab, setCostSubTab] = useState<CostSubTab>('loan');
  const [costModalOpen, setCostModalOpen] = useState(false);
  const [costCategory, setCostCategory] = useState<CostCategory>('loan');
  const [costMode, setCostMode] = useState<'create' | 'edit'>('create');
  const [costInitial, setCostInitial] = useState<CostFormState | null>(null);
  const [editingCostId, setEditingCostId] = useState<string | number | null>(null);
  const [savingCost, setSavingCost] = useState(false);
  const [deletingCost, setDeletingCost] = useState<{ category: CostCategory; record: any } | null>(null);
  const [costPerMile, setCostPerMile] = useState<any>(null);
  const [costPerMileLoading, setCostPerMileLoading] = useState(false);

  // Endpoint suffix per category. Insurance pre-existed; loans/accessories/
  // utilities were added this pass. GET returns a bare array per category.
  const COST_PATH: Record<CostCategory, string> = {
    loan: 'loans', insurance: 'insurance', accessory: 'accessories', utility: 'utilities', other: 'other-costs',
  };

  /** @param silent suppress the failure toast — see the comment below. */
  const loadCostPerMile = useCallback(async (vehicleId: string | number, silent = false) => {
    setCostPerMileLoading(true);
    try {
      const data = await apiFetch<any>(`/fleet/cost-per-mile/${vehicleId}`);
      setCostPerMile(data);
    } catch (err) {
      // Previously swallowed to null, which made a failed click
      // indistinguishable from a dead button.
      setCostPerMile(null);
      // ...but only a click deserves a toast. fetchCosts also calls this to
      // populate the TCO/mile stat, guarded by `if (!costPerMile)` — and a
      // failure leaves costPerMile null, so that guard never stops the retry.
      // Toasting there meant a persistently-down endpoint nagged on every
      // single visit to the Costs tab. The stat still renders empty either
      // way, and the explicit Cost/Mi button still reports its own failure.
      if (!silent) {
        addToast(err instanceof Error ? `Failed to load cost per mile: ${err.message}` : 'Failed to load cost per mile', 'error');
      }
    } finally {
      setCostPerMileLoading(false);
    }
  }, [addToast]);

  const clearCostPerMile = useCallback(() => setCostPerMile(null), []);

  // Recompute the cost-of-ownership summary client-side from the four lists
  // plus the fuel/maintenance totals we already have, so the TCO header
  // reflects live edits without a dedicated summary endpoint.
  const recomputeCostSummary = useCallback((
    ln: FleetLoan[], ins: FleetInsurancePolicy[], acc: FleetAccessory[], util: FleetUtilityCost[],
    others: FleetOtherCost[], budgets: FleetCostBudget[],
    monthlyAverages?: { fuel_monthly?: unknown; maintenance_monthly?: unknown } | null,
  ) => {
    const num = (v: unknown): number => {
      if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
      if (typeof v === 'string') { const p = parseFloat(v); return Number.isFinite(p) ? p : 0; }
      return 0;
    };
    // Normalize a recurring cost to a monthly figure for the commitment stats.
    // one_time → 0 (excluded from run-rate); unknown frequency → monthly.
    const perMonth = (amount: number, freq: unknown): number => {
      switch (String(freq)) {
        case 'annual': return amount / 12;
        case 'semi_annual': return amount / 6;
        case 'quarterly': return amount / 3;
        case 'one_time': return 0;
        default: return amount; // monthly
      }
    };
    const fuelTotal = num(fuelSummary?.total_cost);
    const maintTotal = maintenance.reduce((s, m) => s + num((m as any).cost), 0);
    const loanTotal = ln.reduce((s, l) => s + num((l as any).original_amount), 0);
    const insTotal = ins.reduce((s, p) => s + num((p as any).premium ?? (p as any).premium_amount), 0);
    const accTotal = acc.reduce((s, a) => s + num((a as any).cost), 0);
    const utilTotal = util.reduce((s, u) => s + num((u as any).cost_amount), 0);
    const otherTotal = others.reduce((s, o) => s + num((o as any).amount), 0);
    const monthlyLoan = ln.filter((l) => String((l as any).status ?? 'active') === 'active').reduce((s, l) => s + num((l as any).monthly_payment), 0);
    const monthlyIns = ins.reduce((s, p) => s + perMonth(num((p as any).premium ?? (p as any).premium_amount), (p as any).premium_frequency), 0);
    const monthlyUtil = util.reduce((s, u) => s + perMonth(num((u as any).cost_amount), (u as any).cost_frequency), 0);
    const monthlyOther = others
      .filter((o) => String((o as any).status ?? 'active') !== 'cancelled' && String((o as any).status ?? 'active') !== 'inactive')
      .reduce((s, o) => s + perMonth(num((o as any).amount), (o as any).frequency), 0);
    const monthlyTotal = monthlyLoan + monthlyIns + monthlyUtil + monthlyOther;
    const totalMiles = num(costPerMile?.total_miles);
    const lifetime = fuelTotal + maintTotal + loanTotal + insTotal + accTotal + utilTotal + otherTotal;

    // Monthly "actual" per budgetable category. Recurring categories use their
    // normalized monthly figure. Fuel/maintenance use a TRUE trailing-period
    // monthly average from the /monthly-cost-averages endpoint (total ÷ months
    // actually spanned), falling back to 0 when that fetch failed — never a
    // misleading lifetime/12. Accessories are one-off purchases (lifetime).
    // Every value is coerced through num() so a sentinel "None" can't crash it.
    const actualByCat: Record<string, number> = {
      loan: monthlyLoan,
      insurance: monthlyIns,
      utility: monthlyUtil,
      other: monthlyOther,
      accessory: accTotal,
      fuel: num(monthlyAverages?.fuel_monthly),
      maintenance: num(monthlyAverages?.maintenance_monthly),
    };
    const budgetMap: Record<string, { budget: number; actual: number; over: boolean }> = {};
    for (const b of budgets) {
      const cat = String((b as any).category ?? '');
      const budget = num((b as any).monthly_budget);
      const actual = Math.round((actualByCat[cat] || 0) * 100) / 100;
      budgetMap[cat] = { budget, actual, over: actual > budget && budget > 0 };
    }

    setCostSummary({
      total_lifetime: Math.round(lifetime * 100) / 100,
      cost_per_mile: totalMiles > 0 ? Math.round((lifetime / totalMiles) * 1000) / 1000 : null,
      monthly_commitment: {
        loan: Math.round(monthlyLoan * 100) / 100,
        insurance: Math.round(monthlyIns * 100) / 100,
        utility: Math.round(monthlyUtil * 100) / 100,
        other: Math.round(monthlyOther * 100) / 100,
        total: Math.round(monthlyTotal * 100) / 100,
      },
      projected_annual: Math.round(monthlyTotal * 12 * 100) / 100,
      categories: {
        fuel: Math.round(fuelTotal * 100) / 100,
        maintenance: Math.round(maintTotal * 100) / 100,
        loans: Math.round(loanTotal * 100) / 100,
        insurance: Math.round(insTotal * 100) / 100,
        accessories: Math.round(accTotal * 100) / 100,
        utilities: Math.round(utilTotal * 100) / 100,
        other: Math.round(otherTotal * 100) / 100,
      },
      budgets: budgetMap,
    } as FleetCostSummary);
  }, [fuelSummary, maintenance, costPerMile]);

  const fetchCosts = useCallback(async (id: string | number) => {
    try {
      const [ln, ins, acc, util, others, budgets, monthlyAvgs] = await Promise.all([
        apiFetch<FleetLoan[]>(`/fleet/${id}/loans`).catch(() => []),
        apiFetch<FleetInsurancePolicy[]>(`/fleet/${id}/insurance`).catch(() => []),
        apiFetch<FleetAccessory[]>(`/fleet/${id}/accessories`).catch(() => []),
        apiFetch<FleetUtilityCost[]>(`/fleet/${id}/utilities`).catch(() => []),
        apiFetch<FleetOtherCost[]>(`/fleet/${id}/other-costs`).catch(() => []),
        apiFetch<FleetCostBudget[]>(`/fleet/${id}/cost-budgets`).catch(() => []),
        // True trailing-period fuel/maintenance monthly averages for Budget vs.
        // Actual. Null on failure → recompute falls back to 0 actuals.
        apiFetch<{ fuel_monthly?: number; maintenance_monthly?: number }>(`/fleet/${id}/monthly-cost-averages`).catch(() => null),
      ]);
      const lnA = Array.isArray(ln) ? ln : [];
      const insA = Array.isArray(ins) ? ins : [];
      const accA = Array.isArray(acc) ? acc : [];
      const utilA = Array.isArray(util) ? util : [];
      const otherA = Array.isArray(others) ? others : [];
      const budgetA = Array.isArray(budgets) ? budgets : [];
      const monthlyAvgsObj = (monthlyAvgs && typeof monthlyAvgs === 'object') ? monthlyAvgs : null;
      setLoans(lnA); setInsurancePolicies(insA); setAccessories(accA); setUtilities(utilA);
      setOtherCosts(otherA);
      recomputeCostSummary(lnA, insA, accA, utilA, otherA, budgetA, monthlyAvgsObj);
      // Cost-per-mile feeds the TCO/mile stat; fetch if not already loaded.
      if (!costPerMile) loadCostPerMile(id, true); // background populate: no toast
    } catch (err) {
      console.error('Failed to fetch cost data:', err);
    }
  }, [recomputeCostSummary, costPerMile, loadCostPerMile]);

  // Map a saved DB record back into the modal's CostFormState for editing.
  const costRecordToForm = (category: CostCategory, r: any): CostFormState => {
    const s = (v: unknown) => (v == null ? '' : String(v));
    const base = { ...EMPTY_COST_FORM, notes: s(r.notes) };
    switch (category) {
      case 'loan': return { ...base,
        lender: s(r.lender), original_amount: s(r.original_amount), current_balance: s(r.current_balance),
        monthly_payment: s(r.monthly_payment), interest_rate: s(r.interest_rate), term_months: s(r.term_months),
        start_date: s(r.start_date), payoff_date: s(r.payoff_date), loan_status: (r.status || 'active') };
      case 'insurance': return { ...base,
        carrier: s(r.carrier), policy_number: s(r.policy_number), coverage_type: s(r.coverage_type),
        premium_amount: s(r.premium ?? r.premium_amount), premium_frequency: (r.premium_frequency || 'monthly'),
        effective_from: s(r.effective_date ?? r.effective_from), expires_at: s(r.expiry_date ?? r.expires_at),
        deductible: s(r.deductible), liability_limit: s(r.liability_limit ?? r.coverage_amount),
        insurance_status: (r.status || 'active') };
      case 'accessory': return { ...base,
        name: s(r.name), accessory_category: s(r.category), installed_date: s(r.installed_date),
        removed_date: s(r.removed_date), cost: s(r.cost), vendor: s(r.vendor),
        warranty_until: s(r.warranty_expiry ?? r.warranty_until), serial_number: s(r.serial_number),
        accessory_status: (r.status || 'installed') };
      case 'utility': return { ...base,
        utility_category: s(r.category), provider: s(r.provider), cost_amount: s(r.cost_amount),
        cost_frequency: (r.cost_frequency || 'monthly'), period_start: s(r.period_start), period_end: s(r.period_end) };
      case 'other': return { ...base,
        other_cost_type: s(r.cost_type), other_provider: s(r.provider), other_amount: s(r.amount),
        other_frequency: (r.frequency || 'one_time'), other_incurred_date: s(r.incurred_date),
        other_period_end: s(r.period_end), other_status: (r.status || 'active') };
    }
  };

  // Auto-fill: seed a NEW cost entry with the "context" fields (who/how — not
  // amounts or dates) from the most recent entry of that category, so logging
  // a recurring cost doesn't mean re-typing the lender/carrier/provider every
  // time. Returns null when there's no prior record (→ empty form).
  const buildCostCarryOver = (category: CostCategory): CostFormState | null => {
    const s = (v: unknown) => (v == null ? '' : String(v));
    const latest = (arr: any[]): any | null => (Array.isArray(arr) && arr.length ? arr[0] : null);
    switch (category) {
      case 'loan': {
        const r = latest(loans); if (!r) return null;
        return { ...EMPTY_COST_FORM, lender: s(r.lender) };
      }
      case 'insurance': {
        const r = latest(insurancePolicies); if (!r) return null;
        return { ...EMPTY_COST_FORM, carrier: s(r.carrier), coverage_type: s(r.coverage_type),
          premium_frequency: (r.premium_frequency || 'monthly') };
      }
      case 'accessory': {
        const r = latest(accessories); if (!r) return null;
        return { ...EMPTY_COST_FORM, accessory_category: s(r.category), vendor: s(r.vendor) };
      }
      case 'utility': {
        const r = latest(utilities); if (!r) return null;
        return { ...EMPTY_COST_FORM, utility_category: s(r.category), provider: s(r.provider),
          cost_frequency: (r.cost_frequency || 'monthly') };
      }
      case 'other': {
        const r = latest(otherCosts); if (!r) return null;
        return { ...EMPTY_COST_FORM, other_provider: s(r.provider),
          other_frequency: (r.frequency || 'one_time') };
      }
    }
    return null;
  };

  const handleSaveBudgets = useCallback(async (rows: { category: string; monthly_budget: number }[]) => {
    if (selectedId == null) return;
    try {
      await apiFetch(`/fleet/${selectedId}/cost-budgets`, { method: 'PUT', body: JSON.stringify({ budgets: rows }) });
      addToast('Budgets saved', 'success');
      fetchCosts(selectedId);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to save budgets', 'error');
    }
  }, [selectedId, addToast, fetchCosts]);

  const handleAddCost = useCallback((category: CostCategory) => {
    setCostCategory(category); setCostMode('create'); setCostInitial(buildCostCarryOver(category));
    setEditingCostId(null); setCostModalOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loans, insurancePolicies, accessories, utilities, otherCosts]);

  const handleEditCost = useCallback((category: CostCategory, record: any) => {
    setCostCategory(category); setCostMode('edit'); setCostInitial(costRecordToForm(category, record));
    setEditingCostId(record.id); setCostModalOpen(true);
  }, []);

  const handleDeleteCost = useCallback((category: CostCategory, record: any) => {
    setDeletingCost({ category, record });
  }, []);

  const cancelDeleteCost = useCallback(() => setDeletingCost(null), []);

  const confirmDeleteCost = useCallback(async () => {
    if (!deletingCost || selectedId == null) return;
    const { category, record } = deletingCost;
    try {
      await apiFetch(`/fleet/${COST_PATH[category]}/${record.id}`, { method: 'DELETE' });
      addToast('Entry deleted', 'success');
      setDeletingCost(null);
      fetchCosts(selectedId);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to delete entry', 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deletingCost, selectedId, addToast, fetchCosts]);

  const handleSaveCost = useCallback(async (payload: Record<string, any>) => {
    if (selectedId == null) return;
    setSavingCost(true);
    try {
      if (costMode === 'edit' && editingCostId != null) {
        await apiFetch(`/fleet/${COST_PATH[costCategory]}/${editingCostId}`, { method: 'PUT', body: JSON.stringify(payload) });
        addToast('Entry updated', 'success');
      } else {
        await apiFetch(`/fleet/${selectedId}/${COST_PATH[costCategory]}`, { method: 'POST', body: JSON.stringify(payload) });
        addToast('Entry added', 'success');
      }
      setCostModalOpen(false);
      setEditingCostId(null);
      fetchCosts(selectedId);
    } catch (err) {
      // Re-throw so the modal surfaces the error inline (its submit() catches).
      throw err instanceof Error ? err : new Error('Save failed');
    } finally { setSavingCost(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, costMode, editingCostId, costCategory, addToast, fetchCosts]);

  const closeCostModal = useCallback(() => {
    setCostModalOpen(false);
    setEditingCostId(null);
  }, []);

  const resetCosts = useCallback(() => {
    setLoans([]);
    setInsurancePolicies([]);
    setAccessories([]);
    setUtilities([]);
    setOtherCosts([]);
    setCostSummary(null);
  }, []);

  // Read through a ref so `onCostsLazyLoad` below can have an EMPTY dep array
  // while still invoking the current `fetchCosts`. `fetchCosts` is intentionally
  // unstable (it closes over costPerMile), so exposing it — or anything derived
  // from it — to a dep array is what caused the 3x-refetch regression.
  const fetchCostsRef = useRef(fetchCosts);
  fetchCostsRef.current = fetchCosts;

  /** Costs-tab lazy load. Invoked by `useVehicleDetail` from INSIDE its
   *  skip-guarded lazy-load effect, so a vehicle switch (which resets the tab to
   *  'overview' and sets the skip flag) issues no cost requests at all — matching
   *  pre-Phase-2 behavior. The fuel-log half of the original Costs-tab fetch
   *  lives in that same effect, since only `useVehicleDetail` owns fuel state. */
  const onCostsLazyLoad = useCallback((tab: string, id: string | number) => {
    if (tab === 'costs') fetchCostsRef.current(id);
  }, []);

  return {
    onCostsLazyLoad,
    loans, insurancePolicies, accessories, utilities, otherCosts, costSummary,
    costSubTab, setCostSubTab,
    costModalOpen, costCategory, costMode, costInitial, editingCostId, savingCost, deletingCost,
    costPerMile, costPerMileLoading,
    handleAddCost, handleEditCost, handleDeleteCost, confirmDeleteCost, cancelDeleteCost,
    handleSaveCost, handleSaveBudgets, closeCostModal,
    loadCostPerMile, clearCostPerMile, resetCosts,
  };
}
