import { useState, useCallback } from 'react';
import { apiFetch } from './useApi';
import type { PricingRow } from '../pages/patrol/psBillingHelpers';

export interface ServeChargeLine { id?: number; pricing_code: string | null; description: string; quantity: number; unit_price: number; line_total: number; taxable: number; }
export interface ServeCharge {
  id: number; serve_queue_id: number; contract_id: number | null; status: string;
  subtotal: number; tax_amount: number; computed_at: string; invoice_id: number | null; notes: string | null;
  defendant_name?: string; case_number?: string; client_name?: string; lines?: ServeChargeLine[];
}

export function usePsPricing() {
  const [items, setItems] = useState<PricingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await apiFetch<{ data: PricingRow[] }>('/billing/ps-pricing/items'); setItems(r?.data ?? []); }
    catch { /* surfaced by caller */ }
    setLoading(false);
  }, []);
  const save = useCallback(async (row: PricingRow) => {
    await apiFetch(`/billing/ps-pricing/items/${row.id}`, { method: 'PUT', body: JSON.stringify(row) });
  }, []);
  const create = useCallback(async (row: Partial<PricingRow>) => {
    await apiFetch('/billing/ps-pricing/items', { method: 'POST', body: JSON.stringify(row) });
  }, []);
  return { items, setItems, loading, load, save, create };
}

export function useServeCharges() {
  const [charges, setCharges] = useState<ServeCharge[]>([]);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async (status = 'pending_review') => {
    setLoading(true);
    try { const r = await apiFetch<{ data: ServeCharge[] }>(`/billing/serve-charges?status=${status}`); setCharges(r?.data ?? []); }
    catch { /* surfaced by caller */ }
    setLoading(false);
  }, []);
  const approve = useCallback(async (id: number) => { await apiFetch(`/billing/serve-charges/${id}/approve`, { method: 'POST' }); }, []);
  const voidCharge = useCallback(async (id: number, notes: string) => { await apiFetch(`/billing/serve-charges/${id}/void`, { method: 'POST', body: JSON.stringify({ notes }) }); }, []);
  const saveLines = useCallback(async (id: number, payload: { contract_id?: number | null; lines: ServeChargeLine[] }) => {
    await apiFetch(`/billing/serve-charges/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  }, []);
  const generateInvoice = useCallback(async (payload: { contract_id?: number; client_id?: number; from: string; to: string }) => {
    return apiFetch<{ data: { invoice_id: number; invoice_number: string } }>('/billing/invoices/from-serve-charges', { method: 'POST', body: JSON.stringify(payload) });
  }, []);
  return { charges, loading, load, approve, voidCharge, saveLines, generateInvoice };
}
