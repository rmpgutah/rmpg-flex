import { useState, useEffect, useCallback } from 'react';
import {
  DollarSign, RefreshCw, CheckCircle, XCircle, AlertTriangle,
  ChevronDown, ChevronUp, ChevronRight, Search,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import PanelTitleBar from '../../components/PanelTitleBar';
import { useServeCharges, type ServeCharge, type ServeChargeLine } from '../../hooks/usePsBilling';
import { useToast } from '../../components/ToastProvider';
import { formatEnumValue } from '../../utils/formatters';
import { safeDateStr } from '../../utils/dateUtils';

// ── Types ──────────────────────────────────────────────────────────────────

type ChargeStatus = 'pending_review' | 'approved' | 'invoiced' | 'voided' | 'all';

interface ChargeWithLines extends ServeCharge {
  lines?: ServeChargeLine[];
  _expanded?: boolean;
}

interface Totals { count: number; subtotal: number; tax: number; total: number }

// ── Helpers ────────────────────────────────────────────────────────────────

function usd(n: number | null | undefined) {
  if (n == null) return '—';
  return `$${n.toFixed(2)}`;
}

function paymentBadge(status: string) {
  const cfg: Record<string, string> = {
    pending_review: 'bg-amber-900 text-amber-300',
    approved: 'bg-rmpg-800 text-rmpg-200',
    invoiced: 'bg-blue-900 text-blue-300',
    voided: 'bg-surface-raised text-text-secondary',
  };
  return (
    <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-[2px] rounded-[2px] ${cfg[status] ?? 'bg-surface-raised text-text-secondary'}`}>
      {formatEnumValue(status.replace('_', ' '))}
    </span>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3 bg-surface-raised border border-border-subtle rounded-[2px]">
      <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'var(--field-label-color)' }}>{label}</span>
      <span className="text-[16px] font-semibold text-text-primary">{value}</span>
      {sub && <span className="text-[10px] text-text-secondary">{sub}</span>}
    </div>
  );
}

// ── Line item detail row ───────────────────────────────────────────────────

function ChargeLines({ lines }: { lines: ServeChargeLine[] }) {
  if (!lines.length) return <div className="px-4 py-2 text-[11px] text-text-secondary italic">No line items</div>;
  return (
    <div className="border-t border-border-subtle bg-surface-raised">
      <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-0 text-[9px] font-semibold uppercase tracking-wider text-text-secondary px-4 py-[4px] border-b border-border-subtle">
        <span>Description</span><span className="text-right">Qty</span><span className="text-right">Unit</span><span className="text-right">Total</span>
      </div>
      {lines.map((l, i) => (
        <div key={l.id ?? i} className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-0 px-4 py-[3px] border-b border-border-subtle last:border-0 hover:bg-surface-hover">
          <span className="text-[11px] text-text-primary">
            {l.pricing_code && <span className="font-mono text-[9px] text-text-secondary mr-2">{l.pricing_code}</span>}
            {l.description}
          </span>
          <span className="text-[11px] text-text-secondary text-right">{l.quantity}</span>
          <span className="text-[11px] text-text-secondary text-right">{usd(l.unit_price)}</span>
          <span className="text-[11px] text-text-primary text-right font-semibold">{usd(l.line_total)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function CollectionDatabaseTab() {
  const { charges, loading, load, approve, voidCharge } = useServeCharges();
  const { addToast } = useToast();
  const [status, setStatus] = useState<ChargeStatus>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [sortCol, setSortCol] = useState<'computed_at' | 'subtotal' | 'defendant_name' | 'client_name'>('computed_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [voidId, setVoidId] = useState<number | null>(null);
  const [voidNotes, setVoidNotes] = useState('');

  const reload = useCallback(() => load(status === 'all' ? 'all' : status), [load, status]);
  useEffect(() => { reload(); }, [reload]);

  const filtered = charges.filter(c => {
    const q = search.toLowerCase();
    return (
      (c.defendant_name ?? '').toLowerCase().includes(q) ||
      (c.case_number ?? '').toLowerCase().includes(q) ||
      (c.client_name ?? '').toLowerCase().includes(q)
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    let av: string | number = a[sortCol] ?? '';
    let bv: string | number = b[sortCol] ?? '';
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    return sortDir === 'asc' ? (av < bv ? -1 : av > bv ? 1 : 0) : (av > bv ? -1 : av < bv ? 1 : 0);
  });

  const totals: Totals = filtered.reduce<Totals>((acc, c) => ({
    count: acc.count + 1,
    subtotal: acc.subtotal + (c.subtotal ?? 0),
    tax: acc.tax + (c.tax_amount ?? 0),
    total: acc.total + (c.subtotal ?? 0) + (c.tax_amount ?? 0),
  }), { count: 0, subtotal: 0, tax: 0, total: 0 });

  const pendingTotal = charges.filter(c => c.status === 'pending_review').reduce((s, c) => s + (c.subtotal ?? 0) + (c.tax_amount ?? 0), 0);
  const approvedTotal = charges.filter(c => c.status === 'approved').reduce((s, c) => s + (c.subtotal ?? 0) + (c.tax_amount ?? 0), 0);
  const invoicedTotal = charges.filter(c => c.status === 'invoiced').reduce((s, c) => s + (c.subtotal ?? 0) + (c.tax_amount ?? 0), 0);

  function toggleSort(col: typeof sortCol) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  }

  function SortIcon({ col }: { col: typeof sortCol }) {
    if (sortCol !== col) return null;
    return sortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />;
  }

  async function handleApprove(id: number) {
    try {
      await approve(id);
      addToast('Charge approved', 'success');
      reload();
    } catch {
      addToast('Failed to approve charge', 'error');
    }
  }

  async function handleVoid() {
    if (voidId == null) return;
    try {
      await voidCharge(voidId, voidNotes);
      addToast('Charge voided', 'success');
      setVoidId(null);
      setVoidNotes('');
      reload();
    } catch {
      addToast('Failed to void charge', 'error');
    }
  }

  const STATUS_TABS: { value: ChargeStatus; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'pending_review', label: 'Pending Review' },
    { value: 'approved', label: 'Approved' },
    { value: 'invoiced', label: 'Invoiced' },
    { value: 'voided', label: 'Voided' },
  ];

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 py-3 border-b border-border-subtle flex items-center justify-between gap-4 flex-wrap bg-surface-raised">
        <PanelTitleBar title="COLLECTION DATABASE" icon={DollarSign} />
        <div className="flex items-center gap-2">
          <button
            onClick={reload}
            className="flex items-center gap-1 px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary border border-border-subtle rounded-[2px] transition-colors"
          >
            <RefreshCw size={10} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-4 gap-3 px-4 py-3 border-b border-border-subtle bg-surface-base">
        <StatCard label="Pending Review" value={usd(pendingTotal)} sub={`${charges.filter(c => c.status === 'pending_review').length} charges`} />
        <StatCard label="Approved / Ready" value={usd(approvedTotal)} sub={`${charges.filter(c => c.status === 'approved').length} charges`} />
        <StatCard label="Invoiced" value={usd(invoicedTotal)} sub={`${charges.filter(c => c.status === 'invoiced').length} charges`} />
        <StatCard label="Showing Total" value={usd(totals.total)} sub={`${totals.count} charges`} />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border-subtle bg-surface-base flex-wrap">
        <div className="flex border border-border-subtle rounded-[2px] overflow-hidden">
          {STATUS_TABS.map(t => (
            <button
              key={t.value}
              onClick={() => setStatus(t.value)}
              className={`px-3 py-1 text-[10px] font-medium transition-colors ${
                status === t.value ? 'bg-rmpg-700 text-rmpg-100' : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 px-2 py-1 bg-surface-raised rounded-[2px] border border-border-subtle">
          <Search size={11} className="text-text-secondary shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Defendant, case #, client…"
            className="w-44 bg-transparent text-[11px] text-text-primary placeholder-text-secondary outline-none"
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && (
          <div className="flex items-center justify-center py-12 gap-2 text-[12px] text-text-secondary">
            <RefreshCw size={14} className="animate-spin" /> Loading…
          </div>
        )}

        {!loading && sorted.length === 0 && (
          <div className="flex items-center justify-center py-12 text-[12px] text-text-secondary">
            No charges match the current filter
          </div>
        )}

        {!loading && sorted.length > 0 && (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-surface-raised border-b border-border-subtle">
              <tr>
                <th className="w-6 px-2" />
                <th
                  className="text-left px-3 py-[5px] text-[9px] font-semibold uppercase tracking-wider text-text-secondary cursor-pointer hover:text-text-primary select-none"
                  onClick={() => toggleSort('defendant_name')}
                >
                  <span className="flex items-center gap-1">Defendant <SortIcon col="defendant_name" /></span>
                </th>
                <th className="text-left px-3 py-[5px] text-[9px] font-semibold uppercase tracking-wider text-text-secondary">Case #</th>
                <th
                  className="text-left px-3 py-[5px] text-[9px] font-semibold uppercase tracking-wider text-text-secondary cursor-pointer hover:text-text-primary select-none"
                  onClick={() => toggleSort('client_name')}
                >
                  <span className="flex items-center gap-1">Client <SortIcon col="client_name" /></span>
                </th>
                <th className="text-left px-3 py-[5px] text-[9px] font-semibold uppercase tracking-wider text-text-secondary">Status</th>
                <th
                  className="text-right px-3 py-[5px] text-[9px] font-semibold uppercase tracking-wider text-text-secondary cursor-pointer hover:text-text-primary select-none"
                  onClick={() => toggleSort('subtotal')}
                >
                  <span className="flex items-center justify-end gap-1">Amount <SortIcon col="subtotal" /></span>
                </th>
                <th
                  className="text-left px-3 py-[5px] text-[9px] font-semibold uppercase tracking-wider text-text-secondary cursor-pointer hover:text-text-primary select-none"
                  onClick={() => toggleSort('computed_at')}
                >
                  <span className="flex items-center gap-1">Computed <SortIcon col="computed_at" /></span>
                </th>
                <th className="text-left px-3 py-[5px] text-[9px] font-semibold uppercase tracking-wider text-text-secondary">Invoice</th>
                <th className="px-3 py-[5px] text-[9px] font-semibold uppercase tracking-wider text-text-secondary text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(c => {
                const isExpanded = expanded.has(c.id);
                return (
                  <>
                    <tr
                      key={c.id}
                      className="border-b border-border-subtle hover:bg-surface-hover transition-colors"
                    >
                      <td className="px-2">
                        <button
                          onClick={() => setExpanded(prev => {
                            const next = new Set(prev);
                            next.has(c.id) ? next.delete(c.id) : next.add(c.id);
                            return next;
                          })}
                          className="text-text-secondary hover:text-text-primary"
                        >
                          {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                        </button>
                      </td>
                      <td className="px-3 py-[5px] text-[11px] text-text-primary font-medium">{c.defendant_name ?? '—'}</td>
                      <td className="px-3 py-[5px] text-[10px] text-text-secondary font-mono">{c.case_number ?? '—'}</td>
                      <td className="px-3 py-[5px] text-[11px] text-text-secondary">{c.client_name ?? '—'}</td>
                      <td className="px-3 py-[5px]">{paymentBadge(c.status)}</td>
                      <td className="px-3 py-[5px] text-[11px] text-text-primary text-right font-semibold">{usd((c.subtotal ?? 0) + (c.tax_amount ?? 0))}</td>
                      <td className="px-3 py-[5px] text-[10px] text-text-secondary">{safeDateStr(c.computed_at)}</td>
                      <td className="px-3 py-[5px] text-[10px] text-text-secondary font-mono">{c.invoice_id ?? '—'}</td>
                      <td className="px-3 py-[5px]">
                        <div className="flex items-center justify-end gap-1">
                          {c.status === 'pending_review' && (
                            <>
                              <button
                                onClick={() => handleApprove(c.id)}
                                className="flex items-center gap-1 px-2 py-[2px] text-[9px] font-medium text-green-300 border border-green-800 rounded-[2px] hover:bg-green-900/30 transition-colors"
                              >
                                <CheckCircle size={9} /> Approve
                              </button>
                              <button
                                onClick={() => setVoidId(c.id)}
                                className="flex items-center gap-1 px-2 py-[2px] text-[9px] font-medium text-red-300 border border-red-900 rounded-[2px] hover:bg-red-900/30 transition-colors"
                              >
                                <XCircle size={9} /> Void
                              </button>
                            </>
                          )}
                          {c.status === 'approved' && (
                            <button
                              onClick={() => setVoidId(c.id)}
                              className="flex items-center gap-1 px-2 py-[2px] text-[9px] font-medium text-red-300 border border-red-900 rounded-[2px] hover:bg-red-900/30 transition-colors"
                            >
                              <XCircle size={9} /> Void
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${c.id}-lines`} className="border-b border-border-subtle">
                        <td colSpan={9} className="p-0">
                          <ChargeLines lines={c.lines ?? []} />
                          <div className="px-4 py-2 bg-surface-raised flex items-center gap-6 text-[10px] text-text-secondary border-t border-border-subtle">
                            <span>Subtotal: <strong className="text-text-primary">{usd(c.subtotal)}</strong></span>
                            <span>Tax: <strong className="text-text-primary">{usd(c.tax_amount)}</strong></span>
                            <span>Total: <strong className="text-text-primary">{usd((c.subtotal ?? 0) + (c.tax_amount ?? 0))}</strong></span>
                            {c.notes && <span className="text-text-secondary italic truncate">{c.notes}</span>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
            {/* Footer totals */}
            <tfoot className="sticky bottom-0 bg-surface-raised border-t-2 border-border-subtle">
              <tr>
                <td colSpan={5} className="px-3 py-2 text-[10px] font-semibold text-text-secondary">
                  {totals.count} charges shown
                </td>
                <td className="px-3 py-2 text-[12px] font-semibold text-text-primary text-right">
                  {usd(totals.total)}
                </td>
                <td colSpan={3} className="px-3 py-2 text-[10px] text-text-secondary">
                  Sub {usd(totals.subtotal)} + Tax {usd(totals.tax)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* Void confirmation modal */}
      {voidId != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-surface-raised border border-border-subtle rounded-[2px] p-6 w-96 space-y-4 shadow-xl">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-red-400" />
              <span className="text-[13px] font-semibold text-text-primary">Void Charge</span>
            </div>
            <p className="text-[11px] text-text-secondary">This action cannot be undone. Provide a reason:</p>
            <textarea
              value={voidNotes}
              onChange={e => setVoidNotes(e.target.value)}
              className="w-full bg-surface-base border border-border-subtle rounded-[2px] text-[11px] text-text-primary p-2 outline-none resize-none h-20"
              placeholder="Reason for voiding…"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setVoidId(null); setVoidNotes(''); }}
                className="px-3 py-1 text-[11px] text-text-secondary border border-border-subtle rounded-[2px] hover:bg-surface-hover transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleVoid}
                disabled={!voidNotes.trim()}
                className="px-3 py-1 text-[11px] font-medium text-red-300 bg-red-900/40 border border-red-800 rounded-[2px] disabled:opacity-40 hover:bg-red-900/60 transition-colors"
              >
                Void Charge
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
