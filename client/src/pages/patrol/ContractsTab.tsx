// client/src/pages/patrol/ContractsTab.tsx
import { useEffect, useState, useCallback } from 'react';
import { FileText, History } from 'lucide-react';
import PanelTitleBar from '../../components/PanelTitleBar';
import { apiFetch } from '../../hooks/useApi';
import { usePsPricing } from '../../hooks/usePsBilling';
import { formatUsd } from './psBillingHelpers';
import { toDisplayLabel } from '../../utils/formatters';

interface Contract { id: number; client_id: number; client_name?: string; contract_number: string | null; contract_type: string | null; status: string; start_date: string; end_date: string | null; }
interface Terms { contract_id: number; billing_trigger: string; sla_days: number | null; retainer_amount: number | null; rate_overrides_json: string | null; notes: string | null; }
interface AuditRow { id: number; action: string; details: string; created_at: string; user_name: string | null; }

export default function ContractsTab() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [selected, setSelected] = useState<Contract | null>(null);
  const [terms, setTerms] = useState<Terms | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const { items: pricing, load: loadPricing } = usePsPricing();

  const loadContracts = useCallback(async () => {
    const r = await apiFetch<{ data: Contract[] }>('/billing/contracts');
    setContracts((r?.data ?? []).filter((c) => (c.contract_type ?? '') === 'process_service' || c.contract_type === null));
  }, []);
  useEffect(() => { loadContracts(); loadPricing(); }, [loadContracts, loadPricing]);

  const openContract = async (c: Contract) => {
    setSelected(c);
    const t = await apiFetch<{ data: Terms }>(`/billing/contracts/${c.id}/ps-terms`);
    setTerms(t?.data ?? null);
    try { setOverrides(t?.data?.rate_overrides_json ? JSON.parse(t.data.rate_overrides_json) : {}); } catch { setOverrides({}); }
    const a = await apiFetch<{ data: AuditRow[] }>(`/billing/contracts/${c.id}/audit`);
    setAudit(a?.data ?? []);
  };

  const saveTerms = async () => {
    if (!selected || !terms) return;
    await apiFetch(`/billing/contracts/${selected.id}/ps-terms`, {
      method: 'PUT',
      body: JSON.stringify({ ...terms, rate_overrides: overrides }),
    });
    await openContract(selected);
  };

  return (
    <div className="p-4 grid grid-cols-[260px_1fr] gap-4">
      <div>
        <PanelTitleBar title="PS CONTRACTS" icon={FileText} />
        <ul className="mt-2 text-[11px]">
          {contracts.map((c) => (
            <li key={c.id}>
              <button type="button" className={`w-full text-left px-2 py-[3px] border-b border-border-subtle ${selected?.id === c.id ? 'text-[var(--brand-gold)]' : 'text-rmpg-300'}`} onClick={() => openContract(c)}>
                {c.contract_number ?? `#${c.id}`} — {c.client_name ?? c.client_id} <span className="text-rmpg-500">({c.status})</span>
              </button>
            </li>
          ))}
          {contracts.length === 0 && <li className="text-[var(--spm-text-muted)] px-2">No process-service contracts.</li>}
        </ul>
      </div>

      <div>
        {!selected ? <div className="text-[11px] text-[var(--spm-text-muted)]">Select a contract.</div> : (
          <div className="space-y-4">
            <PanelTitleBar title={`TERMS — ${selected.contract_number ?? selected.id}`} icon={FileText} />
            {terms && (
              <div className="space-y-2 text-[11px]">
                <label className="block">Billing trigger
                  <select className="ml-2 bg-surface-sunken border border-border-default px-1" value={terms.billing_trigger} onChange={(e) => setTerms({ ...terms, billing_trigger: e.target.value })}>
                    {['on_completion', 'on_service', 'per_attempt', 'manual'].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <label className="block">SLA days <input type="number" className="ml-2 bg-surface-sunken border border-border-default px-1 w-20" value={terms.sla_days ?? ''} onChange={(e) => setTerms({ ...terms, sla_days: e.target.value === '' ? null : Number(e.target.value) })} /></label>
                <label className="block">Retainer <input type="number" step="0.01" className="ml-2 bg-surface-sunken border border-border-default px-1 w-24" value={terms.retainer_amount ?? ''} onChange={(e) => setTerms({ ...terms, retainer_amount: e.target.value === '' ? null : Number(e.target.value) })} /></label>

                <div className="mt-2 font-semibold text-[var(--spm-text-muted)]">Per-contract rate overrides (blank = use rate card)</div>
                <div className="overflow-x-auto"><table className="w-full">
                  <tbody>
                    {pricing.filter((p) => p.is_active).map((p) => (
                      <tr key={p.code}>
                        <td className="text-rmpg-300">{p.label} <span className="text-rmpg-500">({formatUsd(p.amount)} default)</span></td>
                        <td className="text-right">
                          <input type="number" step="0.01" placeholder="—" className="bg-surface-sunken border border-border-default px-1 w-24 text-right"
                            value={overrides[p.code] ?? ''} onChange={(e) => {
                              const v = e.target.value;
                              setOverrides((o) => { const n = { ...o }; if (v === '') delete n[p.code]; else n[p.code] = Number(v); return n; });
                            }} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
                <button type="button" className="mt-2 px-3 py-1 bg-[var(--brand-gold)] text-black" onClick={saveTerms}>Save Terms</button>
              </div>
            )}

            <PanelTitleBar title="AUDIT HISTORY" icon={History} />
            <div className="overflow-x-auto"><table className="w-full text-[10px]">
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id} className="border-b border-border-subtle">
                    <td className="text-rmpg-500 py-[2px]">{a.created_at}</td>
                    <td className="text-[var(--brand-gold)]">{toDisplayLabel(a.action)}</td>
                    <td className="text-[var(--spm-text-muted)]">{a.user_name ?? '—'}</td>
                  </tr>
                ))}
                {audit.length === 0 && <tr><td className="text-[var(--spm-text-muted)] py-[2px]">No history yet.</td></tr>}
              </tbody>
            </table></div>
          </div>
        )}
      </div>
    </div>
  );
}
