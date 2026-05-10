import React, { useState, useEffect, useCallback } from 'react';
import {
  Car, Plus, Search, X, Save, Loader2, Unlock, Package,
  AlertTriangle, Clock, Gavel, Ban,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import StatsCard from '../components/StatsCard';
import IconButton from '../components/IconButton';
import EmptyState from '../components/EmptyState';
import { apiFetch } from '../hooks/useApi';
import { useToast } from '../components/ToastProvider';

// ── Types ────────────────────────────────────────────────────────
interface Impound {
  id: number;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  vehicle_vin: string | null;
  license_plate: string | null;
  license_state: string | null;
  tow_company: string | null;
  tow_driver: string | null;
  lot_location: string | null;
  lot_space: string | null;
  impound_date: string;
  release_date: string | null;
  reason: string;
  authority: string | null;
  hold_flag: number;
  hold_reason: string | null;
  daily_fee: number;
  tow_fee: number;
  total_fees: number;
  status: string;
  owner_name: string | null;
  owner_phone: string | null;
  owner_notified: number;
  owner_notified_date: string | null;
  call_id: number | null;
  incident_id: number | null;
  officer_id: number | null;
  photos: string | null;
  property_inventory: string | null;
  notes: string | null;
  days_stored: number | null;
  released_to: string | null;
  release_notes: string | null;
  created_at: string;
  updated_at: string;
}

type ImpoundStatus = 'impounded' | 'hold' | 'released' | 'auction' | 'crushed' | 'abandoned';

// ── Constants ────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  impounded: 'text-amber-400',
  hold:      'text-red-400',
  released:  'text-green-400',
  auction:   'text-purple-400',
  crushed:   'text-neutral-500',
  abandoned: 'text-neutral-500',
};

const STATUS_LABELS: Record<string, string> = {
  impounded: 'Impounded',
  hold:      'On Hold',
  released:  'Released',
  auction:   'Pending Auction',
  crushed:   'Crushed',
  abandoned: 'Abandoned',
};

const TABS = [
  { key: '',         label: 'All' },
  { key: 'impounded', label: 'Active' },
  { key: 'hold',      label: 'On Hold' },
  { key: 'released',  label: 'Released' },
];

const EMPTY_FORM = {
  vehicle_year: '', vehicle_make: '', vehicle_model: '', vehicle_color: '',
  vehicle_vin: '', license_plate: '', license_state: '',
  tow_company: '', tow_driver: '', lot_location: '', lot_space: '',
  reason: '', authority: '', hold_flag: 0, hold_reason: '',
  daily_fee: '25', tow_fee: '150', status: 'impounded' as ImpoundStatus,
  owner_name: '', owner_phone: '', owner_notified: 0, owner_notified_date: '',
  call_id: '', incident_id: '', officer_id: '',
  photos: '', property_inventory: '', notes: '',
};

// ── Helpers ──────────────────────────────────────────────────────
function daysSince(dateStr: string): number {
  const d = new Date(dateStr);
  return Math.max(1, Math.ceil((Date.now() - d.getTime()) / 86400000));
}

function calcFees(row: Impound): string {
  if (row.total_fees) return `$${Number(row.total_fees).toFixed(2)}`;
  const days = daysSince(row.impound_date);
  return `$${((days * (row.daily_fee || 0)) + (row.tow_fee || 0)).toFixed(2)}`;
}

function ymm(row: Impound): string {
  return [row.vehicle_year, row.vehicle_make, row.vehicle_model].filter(Boolean).join(' ') || '—';
}

// ── Component ────────────────────────────────────────────────────
export default function ImpoundPage() {
  const { addToast } = useToast();

  const [rows, setRows] = useState<Impound[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [tab, setTab] = useState('');
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Impound | null>(null);
  const [formData, setFormData] = useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [releaseId, setReleaseId] = useState<number | null>(null);
  const [releaseTo, setReleaseTo] = useState('');
  const [releaseNotes, setReleaseNotes] = useState('');

  // ── Fetch ──
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = tab ? `?status=${tab}` : '';
      const [list, statRows] = await Promise.all([
        apiFetch<Impound[]>(`/impounds${params}`),
        apiFetch<{ status: string; count: number }[]>('/impounds/stats'),
      ]);
      setRows(list);
      const m: Record<string, number> = {};
      statRows.forEach((r) => { m[r.status] = r.count; });
      setStats(m);
    } catch (err: any) {
      addToast(err?.message || 'Failed to load impounds', 'error');
    } finally {
      setLoading(false);
    }
  }, [tab, addToast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Search filter (client-side on already-fetched rows) ──
  const filtered = rows.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (r.vehicle_vin || '').toLowerCase().includes(q) ||
      (r.license_plate || '').toLowerCase().includes(q) ||
      (r.owner_name || '').toLowerCase().includes(q) ||
      ymm(r).toLowerCase().includes(q)
    );
  });

  // ── Form helpers ──
  const openNew = () => {
    setEditing(null);
    setFormData({ ...EMPTY_FORM });
    setFormOpen(true);
  };

  const openEdit = (row: Impound) => {
    setEditing(row);
    setFormData({
      vehicle_year: row.vehicle_year || '',
      vehicle_make: row.vehicle_make || '',
      vehicle_model: row.vehicle_model || '',
      vehicle_color: row.vehicle_color || '',
      vehicle_vin: row.vehicle_vin || '',
      license_plate: row.license_plate || '',
      license_state: row.license_state || '',
      tow_company: row.tow_company || '',
      tow_driver: row.tow_driver || '',
      lot_location: row.lot_location || '',
      lot_space: row.lot_space || '',
      reason: row.reason || '',
      authority: row.authority || '',
      hold_flag: row.hold_flag || 0,
      hold_reason: row.hold_reason || '',
      daily_fee: String(row.daily_fee ?? 25),
      tow_fee: String(row.tow_fee ?? 150),
      status: row.status as ImpoundStatus,
      owner_name: row.owner_name || '',
      owner_phone: row.owner_phone || '',
      owner_notified: row.owner_notified || 0,
      owner_notified_date: row.owner_notified_date || '',
      call_id: row.call_id ? String(row.call_id) : '',
      incident_id: row.incident_id ? String(row.incident_id) : '',
      officer_id: row.officer_id ? String(row.officer_id) : '',
      photos: row.photos || '',
      property_inventory: row.property_inventory || '',
      notes: row.notes || '',
    });
    setFormOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.reason) { addToast('Reason is required', 'error'); return; }
    setSubmitting(true);
    try {
      const body = {
        ...formData,
        daily_fee: parseFloat(formData.daily_fee) || 25,
        tow_fee: parseFloat(formData.tow_fee) || 150,
        call_id: formData.call_id ? parseInt(formData.call_id, 10) : null,
        incident_id: formData.incident_id ? parseInt(formData.incident_id, 10) : null,
        officer_id: formData.officer_id ? parseInt(formData.officer_id, 10) : null,
      };
      if (editing) {
        await apiFetch(`/impounds/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) });
        addToast('Impound updated', 'success');
      } else {
        await apiFetch('/impounds', { method: 'POST', body: JSON.stringify(body) });
        addToast('Impound created', 'success');
      }
      setFormOpen(false);
      fetchData();
    } catch (err: any) {
      addToast(err?.message || 'Save failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Release ──
  const handleRelease = async () => {
    if (releaseId == null) return;
    setSubmitting(true);
    try {
      const res = await apiFetch<{ days: number; total_fees: number }>(`/impounds/${releaseId}/release`, {
        method: 'PUT',
        body: JSON.stringify({ released_to: releaseTo, release_notes: releaseNotes }),
      });
      addToast(`Released — ${res.days} day(s), $${res.total_fees.toFixed(2)} total fees`, 'success');
      setReleaseId(null);
      setReleaseTo('');
      setReleaseNotes('');
      fetchData();
    } catch (err: any) {
      addToast(err?.message || 'Release failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const setField = (key: string, value: string | number) =>
    setFormData((prev) => ({ ...prev, [key]: value }));

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="p-4 space-y-4">
      {/* Title */}
      <PanelTitleBar title="IMPOUND LOT MANAGEMENT" icon={Car}>
        <button onClick={openNew} className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold bg-[#d4a017] text-black hover:brightness-110 transition">
          <Plus className="w-3.5 h-3.5" /> New Impound
        </button>
      </PanelTitleBar>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatsCard icon={Package} label="Total Impounded" value={stats.impounded || 0} accent="amber" />
        <StatsCard icon={Ban} label="On Hold" value={stats.hold || 0} accent="red" />
        <StatsCard icon={Unlock} label="Released" value={stats.released || 0} accent="green" />
        <StatsCard icon={Gavel} label="Pending Auction" value={stats.auction || 0} accent="purple" />
      </div>

      {/* Tabs + Search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex border border-[#222222] overflow-hidden" style={{ borderRadius: 2 }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1 text-[11px] font-semibold transition ${
                tab === t.key
                  ? 'bg-[#d4a017] text-black'
                  : 'bg-[#141414] text-[#888888] hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 flex-1 min-w-[200px] bg-[#141414] border border-[#222222] px-2 py-1" style={{ borderRadius: 2 }}>
          <Search className="w-3.5 h-3.5 text-[#888888]" />
          <input
            type="text"
            placeholder="Search VIN, plate, owner…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent text-[11px] text-white placeholder-[#555] flex-1 outline-none"
          />
          {search && (
            <IconButton onClick={() => setSearch('')} aria-label="Clear search" className="text-[#888888] hover:text-white">
              <X className="w-3 h-3" />
            </IconButton>
          )}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-[#888888]">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Car} title="No impound records" description="Click New Impound to add a record." action={{ label: 'New Impound', onClick: openNew }} />
      ) : (
        <div className="overflow-x-auto border border-[#222222]" style={{ borderRadius: 2 }}>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[#222222]" style={{ background: 'linear-gradient(180deg,#1a1a1a,#242424)' }}>
                {['Impound Date', 'Year/Make/Model', 'Color', 'Plate', 'Tow Company', 'Lot Space', 'Days', 'Fees', 'Status', ''].map((h) => (
                  <th key={h} className="px-2 py-[3px] text-[9px] font-semibold uppercase tracking-wider text-[#d4a017]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => openEdit(r)}
                  className="border-b border-[#1a1a1a] hover:bg-[#141414] cursor-pointer transition-colors"
                >
                  <td className="px-2 py-[2px] text-[11px] text-white font-mono">{r.impound_date?.slice(0, 10) || '—'}</td>
                  <td className="px-2 py-[2px] text-[11px] text-white">{ymm(r)}</td>
                  <td className="px-2 py-[2px] text-[11px] text-[#888888]">{r.vehicle_color || '—'}</td>
                  <td className="px-2 py-[2px] text-[11px] text-white font-mono">{r.license_plate || '—'}{r.license_state ? ` (${r.license_state})` : ''}</td>
                  <td className="px-2 py-[2px] text-[11px] text-[#888888]">{r.tow_company || '—'}</td>
                  <td className="px-2 py-[2px] text-[11px] text-[#888888]">{r.lot_space || '—'}</td>
                  <td className="px-2 py-[2px] text-[11px] text-white font-mono">{r.days_stored ?? daysSince(r.impound_date)}</td>
                  <td className="px-2 py-[2px] text-[11px] text-white font-mono">{calcFees(r)}</td>
                  <td className="px-2 py-[2px] text-[11px]">
                    <span className={STATUS_COLORS[r.status] || 'text-[#888888]'}>{STATUS_LABELS[r.status] || r.status}</span>
                  </td>
                  <td className="px-2 py-[2px] text-right" onClick={(e) => e.stopPropagation()}>
                    {r.status === 'impounded' && (
                      <button
                        onClick={() => { setReleaseId(r.id); setReleaseTo(''); setReleaseNotes(''); }}
                        className="text-[10px] px-2 py-0.5 bg-green-900/40 text-green-400 border border-green-700/40 hover:brightness-125 transition"
                        style={{ borderRadius: 2 }}
                      >
                        Release
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Release Modal ── */}
      {releaseId != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setReleaseId(null)}>
          <div className="bg-[#141414] border border-[#222222] w-full max-w-md p-4 space-y-3" style={{ borderRadius: 2 }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#d4a017]">Release Vehicle</h3>
              <IconButton onClick={() => setReleaseId(null)} aria-label="Close release dialog">
                <X className="w-4 h-4 text-[#888888]" />
              </IconButton>
            </div>
            <label className="block text-[10px] text-[#888888] uppercase tracking-wider">
              Released To
              <input
                value={releaseTo}
                onChange={(e) => setReleaseTo(e.target.value)}
                className="mt-1 w-full bg-[#0a0a0a] border border-[#222222] px-2 py-1 text-[11px] text-white outline-none focus:border-[#d4a017]"
                style={{ borderRadius: 2 }}
              />
            </label>
            <label className="block text-[10px] text-[#888888] uppercase tracking-wider">
              Release Notes
              <textarea
                value={releaseNotes}
                onChange={(e) => setReleaseNotes(e.target.value)}
                rows={3}
                className="mt-1 w-full bg-[#0a0a0a] border border-[#222222] px-2 py-1 text-[11px] text-white outline-none focus:border-[#d4a017] resize-none"
                style={{ borderRadius: 2 }}
              />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setReleaseId(null)} className="px-3 py-1 text-[11px] text-[#888888] border border-[#222222] hover:text-white transition" style={{ borderRadius: 2 }}>
                Cancel
              </button>
              <button onClick={handleRelease} disabled={submitting} className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-semibold bg-green-700 text-white hover:brightness-110 transition disabled:opacity-50" style={{ borderRadius: 2 }}>
                {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Unlock className="w-3 h-3" />} Release
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Form Modal ── */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setFormOpen(false)}>
          <div className="bg-[#141414] border border-[#222222] w-full max-w-2xl max-h-[85vh] overflow-y-auto p-4 space-y-4 scrollbar-dark" style={{ borderRadius: 2 }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#d4a017]">{editing ? 'Edit Impound' : 'New Impound'}</h3>
              <IconButton onClick={() => setFormOpen(false)} aria-label="Close form">
                <X className="w-4 h-4 text-[#888888]" />
              </IconButton>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Vehicle Info */}
              <fieldset className="border border-[#222222] p-3 space-y-2" style={{ borderRadius: 2 }}>
                <legend className="text-[10px] font-semibold text-[#d4a017] uppercase tracking-wider px-1">Vehicle Info</legend>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {renderInput('Year', 'vehicle_year', formData.vehicle_year, setField)}
                  {renderInput('Make', 'vehicle_make', formData.vehicle_make, setField)}
                  {renderInput('Model', 'vehicle_model', formData.vehicle_model, setField)}
                  {renderInput('Color', 'vehicle_color', formData.vehicle_color, setField)}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {renderInput('VIN', 'vehicle_vin', formData.vehicle_vin, setField)}
                  {renderInput('Plate', 'license_plate', formData.license_plate, setField)}
                  {renderInput('State', 'license_state', formData.license_state, setField)}
                </div>
              </fieldset>

              {/* Tow Info */}
              <fieldset className="border border-[#222222] p-3 space-y-2" style={{ borderRadius: 2 }}>
                <legend className="text-[10px] font-semibold text-[#d4a017] uppercase tracking-wider px-1">Tow Info</legend>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {renderInput('Tow Company', 'tow_company', formData.tow_company, setField)}
                  {renderInput('Tow Driver', 'tow_driver', formData.tow_driver, setField)}
                  {renderInput('Lot Location', 'lot_location', formData.lot_location, setField)}
                  {renderInput('Lot Space', 'lot_space', formData.lot_space, setField)}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {renderInput('Reason *', 'reason', formData.reason, setField)}
                  {renderInput('Authority', 'authority', formData.authority, setField)}
                  {renderInput('Daily Fee ($)', 'daily_fee', formData.daily_fee, setField, 'number')}
                  {renderInput('Tow Fee ($)', 'tow_fee', formData.tow_fee, setField, 'number')}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  <label className="block text-[10px] text-[#888888] uppercase tracking-wider">
                    Status
                    <select
                      value={formData.status}
                      onChange={(e) => setField('status', e.target.value)}
                      className="mt-1 w-full bg-[#0a0a0a] border border-[#222222] px-2 py-1 text-[11px] text-white outline-none focus:border-[#d4a017]"
                      style={{ borderRadius: 2 }}
                    >
                      {Object.entries(STATUS_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-[10px] text-[#888888] uppercase tracking-wider pt-4">
                    <input
                      type="checkbox"
                      checked={!!formData.hold_flag}
                      onChange={(e) => setField('hold_flag', e.target.checked ? 1 : 0)}
                      className="accent-[#d4a017]"
                    />
                    Hold Flag
                  </label>
                </div>
                {!!formData.hold_flag && (
                  <div className="grid grid-cols-1 gap-2">
                    {renderInput('Hold Reason', 'hold_reason', formData.hold_reason, setField)}
                  </div>
                )}
              </fieldset>

              {/* Owner Info */}
              <fieldset className="border border-[#222222] p-3 space-y-2" style={{ borderRadius: 2 }}>
                <legend className="text-[10px] font-semibold text-[#d4a017] uppercase tracking-wider px-1">Owner Info</legend>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {renderInput('Owner Name', 'owner_name', formData.owner_name, setField)}
                  {renderInput('Owner Phone', 'owner_phone', formData.owner_phone, setField)}
                  <label className="flex items-center gap-2 text-[10px] text-[#888888] uppercase tracking-wider pt-4">
                    <input
                      type="checkbox"
                      checked={!!formData.owner_notified}
                      onChange={(e) => setField('owner_notified', e.target.checked ? 1 : 0)}
                      className="accent-[#d4a017]"
                    />
                    Owner Notified
                  </label>
                </div>
                {!!formData.owner_notified && (
                  <div className="grid grid-cols-1 gap-2">
                    {renderInput('Notified Date', 'owner_notified_date', formData.owner_notified_date, setField, 'date')}
                  </div>
                )}
              </fieldset>

              {/* Notes */}
              <fieldset className="border border-[#222222] p-3 space-y-2" style={{ borderRadius: 2 }}>
                <legend className="text-[10px] font-semibold text-[#d4a017] uppercase tracking-wider px-1">Notes</legend>
                <label className="block text-[10px] text-[#888888] uppercase tracking-wider">
                  Property Inventory
                  <textarea
                    value={formData.property_inventory}
                    onChange={(e) => setField('property_inventory', e.target.value)}
                    rows={2}
                    className="mt-1 w-full bg-[#0a0a0a] border border-[#222222] px-2 py-1 text-[11px] text-white outline-none focus:border-[#d4a017] resize-none"
                    style={{ borderRadius: 2 }}
                  />
                </label>
                <label className="block text-[10px] text-[#888888] uppercase tracking-wider">
                  Notes
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setField('notes', e.target.value)}
                    rows={3}
                    className="mt-1 w-full bg-[#0a0a0a] border border-[#222222] px-2 py-1 text-[11px] text-white outline-none focus:border-[#d4a017] resize-none"
                    style={{ borderRadius: 2 }}
                  />
                </label>
              </fieldset>

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setFormOpen(false)} className="px-3 py-1 text-[11px] text-[#888888] border border-[#222222] hover:text-white transition" style={{ borderRadius: 2 }}>
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-semibold bg-[#d4a017] text-black hover:brightness-110 transition disabled:opacity-50" style={{ borderRadius: 2 }}>
                  {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} {editing ? 'Update' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared input helper ──
function renderInput(
  label: string,
  key: string,
  value: string | number,
  setField: (k: string, v: string) => void,
  type: string = 'text',
) {
  return (
    <label key={key} className="block text-[10px] text-[#888888] uppercase tracking-wider">
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => setField(key, e.target.value)}
        className="mt-1 w-full bg-[#0a0a0a] border border-[#222222] px-2 py-1 text-[11px] text-white outline-none focus:border-[#d4a017]"
        style={{ borderRadius: 2 }}
      />
    </label>
  );
}
