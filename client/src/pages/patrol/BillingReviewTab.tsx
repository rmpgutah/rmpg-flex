// client/src/pages/patrol/BillingReviewTab.tsx
import { useEffect, useState } from 'react';
import { ClipboardCheck, Check, X, FileOutput } from 'lucide-react';
import PanelTitleBar from '../../components/PanelTitleBar';
import { useServeCharges, type ServeCharge } from '../../hooks/usePsBilling';
import { formatUsd } from './psBillingHelpers';

// Replaced 2026-06-22: this file previously used window.prompt() three times
// (void reason + invoice from-date + invoice to-date). Native prompt has no
// calendar, no validation, no a11y, no clean cancel. The MileageAuditTab +
// TripManagerSection in this same folder already migrated away from prompt
// (see their inline-modal patterns); this is the last holdout.

export default function BillingReviewTab() {
  const { charges, loading, load, approve, voidCharge, generateInvoice } = useServeCharges();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState<string>('');
  useEffect(() => {
    load('pending_review');
    const id = setInterval(() => load('pending_review'), 30_000);
    return () => clearInterval(id);
  }, [load]);

  // Void-reason modal — inline replacement for window.prompt('Void reason?').
  const [voidChargeId, setVoidChargeId] = useState<number | null>(null);
  const [voidReason, setVoidReason] = useState('');

  // Invoice date-range modal — inline replacement for the two date prompts.
  // Defaults to "this month" so an admin can hit Generate without typing.
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [invoiceFrom, setInvoiceFrom] = useState('');
  const [invoiceTo, setInvoiceTo] = useState('');

  const openInvoiceModal = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
    setInvoiceFrom(`${y}-${m}-01`);
    setInvoiceTo(`${y}-${m}-${String(lastDay).padStart(2, '0')}`);
    setShowInvoiceModal(true);
  };

  const doApprove = async (ch: ServeCharge) => {
    setBusyId(ch.id);
    try { await approve(ch.id); await load('pending_review'); } finally { setBusyId(null); }
  };

  const requestVoid = (ch: ServeCharge) => { setVoidChargeId(ch.id); setVoidReason(''); };
  const confirmVoid = async () => {
    if (voidChargeId == null) return;
    setBusyId(voidChargeId);
    try {
      await voidCharge(voidChargeId, voidReason);
      setVoidChargeId(null);
      setVoidReason('');
      await load('pending_review');
    } finally { setBusyId(null); }
  };

  const confirmInvoice = async () => {
    if (!invoiceFrom || !invoiceTo) return;
    setShowInvoiceModal(false);
    const r = await generateInvoice({ from: invoiceFrom, to: invoiceTo });
    const invs = r?.data?.invoices ?? [];
    if (invs.length) {
      const skipped = r?.data?.skipped_no_contract ?? 0;
      setMsg(
        `Created ${invs.length} invoice(s): ${invs.map((i) => i.invoice_number).join(', ')}`
        + (skipped ? ` — ${skipped} charge(s) skipped (no contract)` : ''),
      );
      await load('pending_review');
    } else {
      setMsg('No billable approved charges in range.');
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <PanelTitleBar title={`BILLING REVIEW (${charges.length})`} icon={ClipboardCheck} />
        <button
          className="flex items-center gap-1 px-3 py-1 bg-[var(--brand-gold)] text-black text-[11px]"
          onClick={openInvoiceModal}
        >
          <FileOutput size={12} /> Generate Invoice (approved)
        </button>
      </div>
      {msg && <div className="text-[11px] text-[var(--brand-gold)]">{msg}</div>}
      {loading ? <div className="text-[11px] text-[var(--spm-text-muted)]">Loading…</div> : (
        <div className="overflow-x-auto"><table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-[9px] font-semibold text-[var(--spm-text-muted)] border-b border-border-default">
              <th className="py-[3px]">JOB</th><th>CLIENT/CONTRACT</th><th>LINES</th><th>SUBTOTAL</th><th></th>
            </tr>
          </thead>
          <tbody>
            {charges.map((ch) => (
              <tr key={ch.id} className="border-b border-border-subtle align-top">
                <td className="py-[3px] text-rmpg-300">{ch.defendant_name ?? ch.serve_queue_id} {ch.case_number ? <span className="text-rmpg-500">({ch.case_number})</span> : null}</td>
                <td className={ch.contract_id ? 'text-rmpg-300' : 'text-[var(--sev-critical)]'}>{ch.client_name ?? (ch.contract_id ? `Contract ${ch.contract_id}` : 'UNASSIGNED CONTRACT')}</td>
                <td className="text-[var(--spm-text-muted)]">
                  {(ch.lines ?? []).map((l, i) => (
                    <div key={i}>{l.description} — {l.quantity} × {formatUsd(l.unit_price)} = {formatUsd(l.line_total)}</div>
                  ))}
                </td>
                <td className="text-[var(--brand-gold)] font-semibold">{formatUsd(ch.subtotal)}</td>
                <td>
                  <div className="flex gap-2">
                    <button
                      className="flex items-center gap-1 text-green-500 disabled:opacity-50"
                      disabled={busyId === ch.id || !ch.contract_id}
                      title={!ch.contract_id ? 'Assign a contract first' : 'Approve'}
                      onClick={() => doApprove(ch)}
                    >
                      <Check size={12} /> Approve
                    </button>
                    <button
                      className="flex items-center gap-1 text-[var(--sev-critical)] disabled:opacity-50"
                      disabled={busyId === ch.id}
                      onClick={() => requestVoid(ch)}
                    >
                      <X size={12} /> Void
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {charges.length === 0 && (
              <tr><td colSpan={5} className="text-[var(--spm-text-muted)] py-2">Nothing awaiting review.</td></tr>
            )}
          </tbody>
        </table></div>
      )}

      {/* Void-reason inline modal — replaces window.prompt('Void reason?'). */}
      {voidChargeId != null && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
          style={{ background: 'rgba(0 0 0 / 0.55)' }}
          onClick={() => setVoidChargeId(null)}
        >
          <div
            className="panel-beveled bg-surface-base p-4 w-[360px] space-y-3 my-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="void-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="void-modal-title" className="text-[12px] font-bold uppercase text-rmpg-100">Void charge</h3>
            <label className="block text-[10px] text-rmpg-400 uppercase tracking-wider">Reason (optional)</label>
            <textarea
              autoFocus
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              className="w-full bg-surface-sunken border border-border-default px-2 py-1 text-[11px] text-rmpg-100 min-h-[64px]"
              placeholder="e.g. duplicate billing, written off, customer request"
            />
            <div className="flex justify-end gap-2">
              <button
                className="toolbar-btn text-[10px]"
                onClick={() => setVoidChargeId(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="toolbar-btn toolbar-btn-primary text-[10px]"
                onClick={confirmVoid}
                type="button"
              >
                Confirm void
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invoice date-range modal — replaces the two window.prompt() calls. */}
      {showInvoiceModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0 0 0 / 0.55)' }}
          onClick={() => setShowInvoiceModal(false)}
        >
          <div
            className="panel-beveled bg-surface-base p-4 w-[380px] space-y-3"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invoice-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="invoice-modal-title" className="text-[12px] font-bold uppercase text-rmpg-100">Generate invoice</h3>
            <p className="text-[10px] text-rmpg-400">
              Bundles every <em>approved</em> charge in this date range into invoices, grouped by contract.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-[10px] text-rmpg-400 uppercase tracking-wider mb-1">From</span>
                <input
                  type="date"
                  value={invoiceFrom}
                  onChange={(e) => setInvoiceFrom(e.target.value)}
                  className="w-full bg-surface-sunken border border-border-default px-2 py-1 text-[11px] text-rmpg-100"
                />
              </label>
              <label className="block">
                <span className="block text-[10px] text-rmpg-400 uppercase tracking-wider mb-1">To</span>
                <input
                  type="date"
                  value={invoiceTo}
                  onChange={(e) => setInvoiceTo(e.target.value)}
                  className="w-full bg-surface-sunken border border-border-default px-2 py-1 text-[11px] text-rmpg-100"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button
                className="toolbar-btn text-[10px]"
                onClick={() => setShowInvoiceModal(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="toolbar-btn toolbar-btn-primary text-[10px]"
                onClick={confirmInvoice}
                disabled={!invoiceFrom || !invoiceTo || invoiceFrom > invoiceTo}
                type="button"
              >
                Generate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
