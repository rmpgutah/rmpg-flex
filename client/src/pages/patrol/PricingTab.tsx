// client/src/pages/patrol/PricingTab.tsx
import { useEffect, useState } from 'react';
import { DollarSign, Save } from 'lucide-react';
import PanelTitleBar from '../../components/PanelTitleBar';
import { usePsPricing } from '../../hooks/usePsBilling';
import { applyPricingEdit, formatUsd, type PricingRow } from './psBillingHelpers';

const UNITS = ['per_serve', 'per_attempt', 'per_mile', 'per_hour', 'flat'];

export default function PricingTab() {
  const { items, setItems, loading, load, save } = usePsPricing();
  const [savingId, setSavingId] = useState<number | null>(null);
  useEffect(() => { load(); }, [load]);

  const edit = <K extends keyof PricingRow>(id: number, field: K, value: PricingRow[K]) =>
    setItems((rows) => applyPricingEdit(rows, id, field, value));

  const saveRow = async (row: PricingRow) => {
    setSavingId(row.id);
    try { await save(row); } finally { setSavingId(null); }
  };

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="PROCESS SERVICE PRICING" icon={DollarSign} />
      <p className="text-[10px] text-[var(--spm-text-muted)]">Dynamic rate card. Edits apply to NEW charges only — existing charges keep their snapshotted amounts.</p>
      {loading ? <div className="text-[11px] text-[var(--spm-text-muted)]">Loading…</div> : (
        <div className="overflow-x-auto"><table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-[9px] font-semibold text-[var(--spm-text-muted)] border-b border-border-default">
              <th className="py-[3px]">CODE</th><th>LABEL</th><th>UNIT</th><th>AMOUNT</th>
              <th>TAX</th><th>ATTEMPTS INCL.</th><th>ACTIVE</th><th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-b border-border-subtle">
                <td className="py-[2px] font-mono text-[var(--brand-gold)]">{r.code}</td>
                <td><input className="bg-surface-sunken border border-border-default px-1 w-full" value={r.label} onChange={(e) => edit(r.id, 'label', e.target.value)} /></td>
                <td>
                  <select className="bg-surface-sunken border border-border-default px-1" value={r.unit} onChange={(e) => edit(r.id, 'unit', e.target.value)}>
                    {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </td>
                <td><input type="number" step="0.01" className="bg-surface-sunken border border-border-default px-1 w-20 text-right" value={r.amount} onChange={(e) => edit(r.id, 'amount', Number(e.target.value))} /> <span className="text-rmpg-500">{formatUsd(r.amount)}</span></td>
                <td><input type="checkbox" checked={!!r.taxable} onChange={(e) => edit(r.id, 'taxable', e.target.checked ? 1 : 0)} /></td>
                <td><input type="number" className="bg-surface-sunken border border-border-default px-1 w-14 text-right" value={r.attempts_included} onChange={(e) => edit(r.id, 'attempts_included', Number(e.target.value))} /></td>
                <td><input type="checkbox" checked={!!r.is_active} onChange={(e) => edit(r.id, 'is_active', e.target.checked ? 1 : 0)} /></td>
                <td>
                  <button type="button" className="flex items-center gap-1 text-[var(--brand-gold)] disabled:opacity-50" disabled={savingId === r.id} onClick={() => saveRow(r)}>
                    <Save size={12} /> {savingId === r.id ? 'Saving…' : 'Save'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}
