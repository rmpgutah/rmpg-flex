import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, Search, ShieldAlert, Package, CheckCircle, AlertTriangle, Flag,
  X, Save, Loader2, RotateCcw, Store,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import StatsCard from '../components/StatsCard';
import IconButton from '../components/IconButton';
import ViewOnMapLink from '../components/ViewOnMapLink';
import { apiFetch } from '../hooks/useApi';
import { asArray } from '../utils/asArray';
import { formatEnumValue } from '../utils/formatters';
import { pawnItemsToCsv, downloadTextFile } from '../utils/rmsListExport';
import { copyToClipboard } from '../utils/clipboard';

// ─── Types ───────────────────────────────────────────────────
interface PawnTransaction {
  id: number;
  shop_name: string;
  shop_address: string;
  transaction_date: string;
  transaction_type: string;
  item_description: string;
  item_category: string;
  serial_number: string;
  brand: string;
  model: string;
  color: string;
  seller_first_name: string;
  seller_last_name: string;
  seller_dob: string;
  seller_id_type: string;
  seller_id_number: string;
  seller_address: string;
  seller_phone: string;
  hold_period_days: number;
  hold_expires: string;
  status: string;
  flagged_stolen: number;
  matched_evidence_id: number | null;
  amount: number;
  notes: string;
  entered_by: string;
  created_at: string;
  updated_at: string;
}

type PawnStatus = 'held' | 'released' | 'flagged' | 'seized' | 'returned';

// ─── Constants ───────────────────────────────────────────────
const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'held', label: 'Held' },
  { value: 'released', label: 'Released' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'seized', label: 'Seized' },
  { value: 'returned', label: 'Returned' },
];

const STATUS_BADGES: Record<string, string> = {
  held: 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  released: 'bg-green-900/50 text-green-400 border-green-700/50',
  flagged: 'bg-red-900/50 text-red-400 border-red-700/50',
  seized: 'bg-red-900/60 text-red-300 border-red-600/50',
  returned: 'bg-blue-900/50 text-blue-400 border-blue-700/50',
};

const EMPTY_FORM = {
  shop_name: '',
  shop_address: '',
  transaction_date: new Date().toISOString().slice(0, 10),
  transaction_type: 'pawn',
  item_description: '',
  item_category: '',
  serial_number: '',
  brand: '',
  model: '',
  color: '',
  seller_first_name: '',
  seller_last_name: '',
  seller_dob: '',
  seller_id_type: '',
  seller_id_number: '',
  seller_address: '',
  seller_phone: '',
  hold_period_days: 30,
  amount: '',
  status: 'held',
  notes: '',
  entered_by: '',
};

export default function PawnTrackingPage() {
  const [transactions, setTransactions] = useState<PawnTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);

  const [stolenMatches, setStolenMatches] = useState<PawnTransaction[] | null>(null);
  const [stolenLoading, setStolenLoading] = useState(false);

  // ── Fetch ──────────────────────────────────────────────────
  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      if (searchQuery) params.set('search', searchQuery);
      const qs = params.toString();
      const rows = await apiFetch<PawnTransaction[]>(`/pawn${qs ? `?${qs}` : ''}`);
      setTransactions(asArray<PawnTransaction>(rows));
    } catch (err: any) {
      setError(err?.message || 'Failed to load pawn transactions');
    } finally {
      setLoading(false);
    }
  }, [filterStatus, searchQuery]);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  // ── Stats ──────────────────────────────────────────────────
  const stats = {
    total: transactions.length,
    held: transactions.filter(t => t.status === 'held').length,
    released: transactions.filter(t => t.status === 'released').length,
    flagged: transactions.filter(t => t.status === 'flagged').length,
  };

  // ── Form helpers ───────────────────────────────────────────
  const openNewForm = () => {
    setEditingId(null);
    setFormData({ ...EMPTY_FORM, transaction_date: new Date().toISOString().slice(0, 10) });
    setFormOpen(true);
  };

  const openEditForm = (txn: PawnTransaction) => {
    setEditingId(txn.id);
    setFormData({
      shop_name: txn.shop_name || '',
      shop_address: txn.shop_address || '',
      transaction_date: txn.transaction_date || '',
      transaction_type: txn.transaction_type || 'pawn',
      item_description: txn.item_description || '',
      item_category: txn.item_category || '',
      serial_number: txn.serial_number || '',
      brand: txn.brand || '',
      model: txn.model || '',
      color: txn.color || '',
      seller_first_name: txn.seller_first_name || '',
      seller_last_name: txn.seller_last_name || '',
      seller_dob: txn.seller_dob || '',
      seller_id_type: txn.seller_id_type || '',
      seller_id_number: txn.seller_id_number || '',
      seller_address: txn.seller_address || '',
      seller_phone: txn.seller_phone || '',
      hold_period_days: txn.hold_period_days || 30,
      amount: txn.amount != null ? String(txn.amount) : '',
      status: txn.status || 'held',
      notes: txn.notes || '',
      entered_by: txn.entered_by || '',
    });
    setFormOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        ...formData,
        amount: formData.amount ? parseFloat(formData.amount as string) : null,
        hold_period_days: Number(formData.hold_period_days),
      };
      if (editingId) {
        await apiFetch(`/pawn/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/pawn', { method: 'POST', body: JSON.stringify(payload) });
      }
      setFormOpen(false);
      fetchTransactions();
    } catch (err: any) {
      setError(err?.message || 'Save failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFlag = async (id: number) => {
    if (!confirm('Flag this transaction as stolen property?')) return;
    try {
      await apiFetch(`/pawn/${id}/flag`, { method: 'POST', body: JSON.stringify({}) });
      fetchTransactions();
    } catch (err: any) {
      setError(err?.message || 'Flag failed');
    }
  };

  const handleCrossReference = async () => {
    setStolenLoading(true);
    try {
      const matches = await apiFetch<PawnTransaction[]>('/pawn/search/stolen');
      setStolenMatches(asArray<PawnTransaction>(matches));
    } catch (err: any) {
      setError(err?.message || 'Cross-reference failed');
    } finally {
      setStolenLoading(false);
    }
  };

  const setField = (field: string, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="PAWN TRACKING" icon={Store}>
        <button
          onClick={handleCrossReference}
          disabled={stolenLoading}
          className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold bg-red-900/40 text-red-400 border border-red-700/50 hover:bg-red-900/60 transition-colors"
          style={{ borderRadius: 2 }}
        >
          {stolenLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldAlert className="w-3.5 h-3.5" />}
          Cross-Reference
        </button>
        <button
          onClick={openNewForm}
          className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold bg-accent-silver-500/20 text-accent-silver-500 border border-accent-silver-600/40 hover:bg-accent-silver-500/30 transition-colors"
          style={{ borderRadius: 2 }}
        >
          <Plus className="w-3.5 h-3.5" />
          New Transaction
        </button>
      </PanelTitleBar>

      {/* ── Stats Bar ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatsCard icon={Package} label="Total" value={stats.total} accent="blue" />
        <StatsCard icon={AlertTriangle} label="Held" value={stats.held} accent="amber" />
        <StatsCard icon={CheckCircle} label="Released" value={stats.released} accent="green" />
        <StatsCard icon={Flag} label="Flagged" value={stats.flagged} accent="red" />
      </div>

      {/* ── Stolen Matches Panel ── */}
      {stolenMatches !== null && (
        <div className="border border-red-700/50 bg-red-900/20 p-3" style={{ borderRadius: 2 }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-red-400 text-[11px] font-bold uppercase tracking-wider">
              Stolen Property Matches ({stolenMatches.length})
            </span>
            <IconButton onClick={() => setStolenMatches(null)} aria-label="Close stolen matches">
              <X className="w-4 h-4 text-red-400" />
            </IconButton>
          </div>
          {stolenMatches.length === 0 ? (
            <p className="text-[11px] text-rmpg-400">No matches found against evidence records.</p>
          ) : (
            <div className="space-y-1">
              {stolenMatches.map(m => (
                <div key={m.id} className="flex items-center gap-3 text-[11px] text-red-300 bg-red-900/30 px-2 py-1 border border-red-800/40" style={{ borderRadius: 2 }}>
                  <span className="font-mono">{m.serial_number}</span>
                  <span>{m.item_description}</span>
                  <span className="text-rmpg-400">{m.shop_name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Search & Filter ── */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-accent-silver-500" />
          <input
            type="text"
            placeholder="Search serial #, seller name, shop name…"
            aria-label="Search pawn records by serial, seller, or shop"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-[11px] bg-surface-raised border border-border-default text-rmpg-200 placeholder-rmpg-500 focus:border-accent-silver-600/50 focus:outline-none"
            style={{ borderRadius: 2 }}
          />
        </div>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="px-2.5 py-1.5 text-[11px] bg-surface-raised border border-border-default text-rmpg-200 focus:border-accent-silver-600/50 focus:outline-none"
          style={{ borderRadius: 2 }}
        >
          {STATUS_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <IconButton onClick={fetchTransactions} aria-label="Refresh transactions">
          <RotateCcw className="w-4 h-4 text-accent-silver-500" />
        </IconButton>
        <button
          type="button"
          className="px-2 py-1 text-[11px] border border-border-default"
          disabled={transactions.length === 0}
          onClick={() => downloadTextFile('pawn-items.csv', pawnItemsToCsv(transactions))}
        >CSV</button>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="text-red-400 text-[11px] bg-red-900/20 border border-red-700/40 px-3 py-2 flex items-center justify-between" style={{ borderRadius: 2 }}>
          <span>{error}</span>
          <button type="button" className="px-2 py-1 border border-border-default text-[10px]" onClick={() => void fetchTransactions()}>Retry</button>
        </div>
      )}

      {/* ── Table ── */}
      <div className="border border-border-default overflow-x-auto" style={{ borderRadius: 2 }}>
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-surface-raised border-b border-border-subtle">
              {['Date', 'Shop', 'Item', 'Serial #', 'Seller', 'Amount', 'Hold Expires', 'Status', 'Actions'].map(h => (
                <th key={h} className="text-left text-[9px] font-semibold uppercase tracking-wider text-rmpg-400 px-3 py-[3px]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="text-center py-8 text-rmpg-500"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
            ) : transactions.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-8 text-rmpg-500">{searchQuery || filterStatus ? 'No transactions match the current filter.' : 'No pawn transactions found.'}</td></tr>
            ) : (
              transactions.map(txn => (
                <tr
                  key={txn.id}
                  onClick={() => openEditForm(txn)}
                  className="border-b border-border-subtle hover:bg-surface-hover cursor-pointer transition-colors"
                >
                  <td className="px-3 py-[2px] text-rmpg-200 font-mono whitespace-nowrap">{txn.transaction_date}</td>
                  <td className="px-3 py-[2px] text-rmpg-200">{txn.shop_name}</td>
                  <td className="px-3 py-[2px] text-rmpg-200 max-w-[200px] truncate">{txn.item_description}</td>
                  <td className="px-3 py-[2px] text-rmpg-200 font-mono">
                    {txn.serial_number || '—'}
                    {txn.serial_number && (
                      <button type="button" className="ml-1 text-[9px] border border-border-default px-1" onClick={(e) => { e.stopPropagation(); void copyToClipboard(txn.serial_number); }}>Copy</button>
                    )}
                  </td>
                  <td className="px-3 py-[2px] text-rmpg-200 whitespace-nowrap">
                    {txn.seller_last_name ? `${txn.seller_last_name}, ${txn.seller_first_name || ''}`.trim() : '—'}
                  </td>
                  <td className="px-3 py-[2px] text-rmpg-200 font-mono text-right">
                    {txn.amount != null ? `$${Number(txn.amount).toFixed(2)}` : '—'}
                  </td>
                  <td className="px-3 py-[2px] text-rmpg-200 font-mono whitespace-nowrap">{txn.hold_expires || '—'}</td>
                  <td className="px-3 py-[2px]">
                    <span
                      className={`inline-block px-1.5 py-[1px] text-[10px] font-semibold uppercase border ${STATUS_BADGES[txn.status] || 'text-rmpg-400 border-rmpg-600'}`}
                      style={{ borderRadius: 2 }}
                    >
                      {formatEnumValue(txn.status)}
                    </span>
                  </td>
                  <td className="px-3 py-[2px]" onClick={e => e.stopPropagation()}>
                    {txn.status !== 'flagged' && (
                      <button
                        onClick={() => handleFlag(txn.id)}
                        className="flex items-center gap-1 px-1.5 py-[1px] text-[10px] font-semibold text-red-400 bg-red-900/30 border border-red-700/40 hover:bg-red-900/50 transition-colors"
                        style={{ borderRadius: 2 }}
                      >
                        <Flag className="w-3 h-3" />
                        Flag
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Form Modal ── */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setFormOpen(false)}>
          <div
            className="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-surface-base border border-border-default shadow-xl"
            style={{ borderRadius: 2 }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle bg-surface-raised">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[color:var(--panel-header-color)]">
                {editingId ? 'Edit Transaction' : 'New Transaction'}
              </span>
              <IconButton onClick={() => setFormOpen(false)} aria-label="Close form">
                <X className="w-4 h-4 text-accent-silver-500" />
              </IconButton>
            </div>
            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              {/* Shop Info */}
              <fieldset className="space-y-2">
                <legend className="text-[9px] font-bold uppercase tracking-wider text-rmpg-400 mb-1">Shop Information</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <FormField label="Shop Name *" value={formData.shop_name} onChange={v => setField('shop_name', v)} required />
                  <div>
                    <FormField label="Shop Address" value={formData.shop_address} onChange={v => setField('shop_address', v)} />
                    <ViewOnMapLink address={formData.shop_address} label={formData.shop_name} className="mt-1" />
                  </div>
                </div>
              </fieldset>

              {/* Transaction Details */}
              <fieldset className="space-y-2">
                <legend className="text-[9px] font-bold uppercase tracking-wider text-rmpg-400 mb-1">Transaction Details</legend>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <FormField label="Date *" type="date" value={formData.transaction_date} onChange={v => setField('transaction_date', v)} required />
                  <div>
                    <label className="block text-[9px] font-semibold uppercase text-rmpg-400 mb-0.5">Type</label>
                    <select
                      value={formData.transaction_type}
                      onChange={e => setField('transaction_type', e.target.value)}
                      className="w-full px-2 py-1 text-[11px] bg-surface-raised border border-border-default text-rmpg-200 focus:border-accent-silver-600/50 focus:outline-none"
                      style={{ borderRadius: 2 }}
                    >
                      <option value="pawn">Pawn</option>
                      <option value="buy">Buy</option>
                      <option value="consignment">Consignment</option>
                    </select>
                  </div>
                  <FormField label="Amount ($)" type="number" value={formData.amount as string} onChange={v => setField('amount', v)} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <FormField label="Hold Period (days)" type="number" value={String(formData.hold_period_days)} onChange={v => setField('hold_period_days', Number(v))} />
                  <div>
                    <label className="block text-[9px] font-semibold uppercase text-rmpg-400 mb-0.5">Status</label>
                    <select
                      value={formData.status}
                      onChange={e => setField('status', e.target.value)}
                      className="w-full px-2 py-1 text-[11px] bg-surface-raised border border-border-default text-rmpg-200 focus:border-accent-silver-600/50 focus:outline-none"
                      style={{ borderRadius: 2 }}
                    >
                      <option value="held">Held</option>
                      <option value="released">Released</option>
                      <option value="flagged">Flagged</option>
                      <option value="seized">Seized</option>
                      <option value="returned">Returned</option>
                    </select>
                  </div>
                </div>
              </fieldset>

              {/* Item Details */}
              <fieldset className="space-y-2">
                <legend className="text-[9px] font-bold uppercase tracking-wider text-rmpg-400 mb-1">Item Details</legend>
                <FormField label="Description *" value={formData.item_description} onChange={v => setField('item_description', v)} required />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <FormField label="Category" value={formData.item_category} onChange={v => setField('item_category', v)} />
                  <FormField label="Serial #" value={formData.serial_number} onChange={v => setField('serial_number', v)} />
                  <FormField label="Brand" value={formData.brand} onChange={v => setField('brand', v)} />
                  <FormField label="Model" value={formData.model} onChange={v => setField('model', v)} />
                </div>
                <FormField label="Color" value={formData.color} onChange={v => setField('color', v)} />
              </fieldset>

              {/* Seller Details */}
              <fieldset className="space-y-2">
                <legend className="text-[9px] font-bold uppercase tracking-wider text-rmpg-400 mb-1">Seller Information</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <FormField label="First Name" value={formData.seller_first_name} onChange={v => setField('seller_first_name', v)} />
                  <FormField label="Last Name" value={formData.seller_last_name} onChange={v => setField('seller_last_name', v)} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <FormField label="DOB" type="date" value={formData.seller_dob} onChange={v => setField('seller_dob', v)} />
                  <FormField label="ID Type" value={formData.seller_id_type} onChange={v => setField('seller_id_type', v)} />
                  <FormField label="ID Number" value={formData.seller_id_number} onChange={v => setField('seller_id_number', v)} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <FormField label="Address" value={formData.seller_address} onChange={v => setField('seller_address', v)} />
                    <ViewOnMapLink address={formData.seller_address} label={`${formData.seller_first_name} ${formData.seller_last_name}`.trim()} className="mt-1" />
                  </div>
                  <FormField label="Phone" value={formData.seller_phone} onChange={v => setField('seller_phone', v)} />
                </div>
              </fieldset>

              {/* Notes */}
              <fieldset className="space-y-2">
                <legend className="text-[9px] font-bold uppercase tracking-wider text-rmpg-400 mb-1">Additional</legend>
                <FormField label="Entered By" value={formData.entered_by} onChange={v => setField('entered_by', v)} />
                <div>
                  <label className="block text-[9px] font-semibold uppercase text-rmpg-400 mb-0.5">Notes</label>
                  <textarea
                    value={formData.notes}
                    onChange={e => setField('notes', e.target.value)}
                    rows={3}
                    className="w-full px-2 py-1 text-[11px] bg-surface-raised border border-border-default text-rmpg-200 placeholder-rmpg-500 focus:border-accent-silver-600/50 focus:outline-none resize-none"
                    style={{ borderRadius: 2 }}
                  />
                </div>
              </fieldset>

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-2 border-t border-border-subtle">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-rmpg-400 bg-surface-raised border border-border-default hover:bg-surface-hover transition-colors"
                  style={{ borderRadius: 2 }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-accent-silver-500 bg-accent-silver-500/20 border border-accent-silver-600/40 hover:bg-accent-silver-500/30 transition-colors disabled:opacity-50"
                  style={{ borderRadius: 2 }}
                >
                  {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  {editingId ? 'Update' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Reusable form field ─────────────────────────────────────
function FormField({
  label, value, onChange, type = 'text', required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-[9px] font-semibold uppercase text-rmpg-400 mb-0.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
        className="w-full px-2 py-1 text-[11px] bg-surface-raised border border-border-default text-rmpg-200 placeholder-rmpg-500 focus:border-accent-silver-600/50 focus:outline-none"
        style={{ borderRadius: 2 }}
      />
    </div>
  );
}
