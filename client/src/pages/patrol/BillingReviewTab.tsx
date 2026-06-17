// client/src/pages/patrol/BillingReviewTab.tsx
import { useEffect, useState } from 'react';
import { ClipboardCheck, Check, X, FileOutput } from 'lucide-react';
import PanelTitleBar from '../../components/PanelTitleBar';
import { useServeCharges, type ServeCharge } from '../../hooks/usePsBilling';
import { formatUsd } from './psBillingHelpers';

export default function BillingReviewTab() {
  const { charges, loading, load, approve, voidCharge, generateInvoice } = useServeCharges();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState<string>('');
  useEffect(() => { load('pending_review'); }, [load]);

  const doApprove = async (ch: ServeCharge) => { setBusyId(ch.id); try { await approve(ch.id); await load('pending_review'); } finally { setBusyId(null); } };
  const doVoid = async (ch: ServeCharge) => {
    const reason = window.prompt('Void reason?') ?? '';
    setBusyId(ch.id); try { await voidCharge(ch.id, reason); await load('pending_review'); } finally { setBusyId(null); }
  };
  const doInvoice = async () => {
    const from = window.prompt('Invoice from date (YYYY-MM-DD)?') ?? '';
    const to = window.prompt('Invoice to date (YYYY-MM-DD)?') ?? '';
    if (!from || !to) return;
    const r = await generateInvoice({ from, to });
    const invs = r?.data?.invoices ?? [];
    if (invs.length) {
      const skipped = r?.data?.skipped_no_contract ?? 0;
      setMsg(`Created ${invs.length} invoice(s): ${invs.map((i) => i.invoice_number).join(', ')}${skipped ? ` — ${skipped} charge(s) skipped (no contract)` : ''}`);
      await load('pending_review');
    } else {
      setMsg('No billable approved charges in range.');
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <PanelTitleBar title={`BILLING REVIEW (${charges.length})`} icon={ClipboardCheck} />
        <button className="flex items-center gap-1 px-3 py-1 bg-[#d4a017] text-black text-[11px]" onClick={doInvoice}>
          <FileOutput size={12} /> Generate Invoice (approved)
        </button>
      </div>
      {msg && <div className="text-[11px] text-[#d4a017]">{msg}</div>}
      {loading ? <div className="text-[11px] text-[#888]">Loading…</div> : (
        <div className="overflow-x-auto"><table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-[9px] font-semibold text-[#888] border-b border-border-default">
              <th className="py-[3px]">JOB</th><th>CLIENT/CONTRACT</th><th>LINES</th><th>SUBTOTAL</th><th></th>
            </tr>
          </thead>
          <tbody>
            {charges.map((ch) => (
              <tr key={ch.id} className="border-b border-border-subtle align-top">
                <td className="py-[3px] text-rmpg-300">{ch.defendant_name ?? ch.serve_queue_id} {ch.case_number ? <span className="text-rmpg-500">({ch.case_number})</span> : null}</td>
                <td className={ch.contract_id ? 'text-rmpg-300' : 'text-[#e0533d]'}>{ch.client_name ?? (ch.contract_id ? `Contract ${ch.contract_id}` : 'UNASSIGNED CONTRACT')}</td>
                <td className="text-[#888]">
                  {(ch.lines ?? []).map((l, i) => (
                    <div key={i}>{l.description} — {l.quantity} × {formatUsd(l.unit_price)} = {formatUsd(l.line_total)}</div>
                  ))}
                </td>
                <td className="text-[#d4a017] font-semibold">{formatUsd(ch.subtotal)}</td>
                <td>
                  <div className="flex gap-2">
                    <button className="flex items-center gap-1 text-green-500 disabled:opacity-50" disabled={busyId === ch.id || !ch.contract_id} title={!ch.contract_id ? 'Assign a contract first' : 'Approve'} onClick={() => doApprove(ch)}><Check size={12} /> Approve</button>
                    <button className="flex items-center gap-1 text-[#e0533d] disabled:opacity-50" disabled={busyId === ch.id} onClick={() => doVoid(ch)}><X size={12} /> Void</button>
                  </div>
                </td>
              </tr>
            ))}
            {charges.length === 0 && <tr><td colSpan={5} className="text-[#888] py-2">Nothing awaiting review.</td></tr>}
          </tbody>
        </table></div>
      )}
    </div>
  );
}
