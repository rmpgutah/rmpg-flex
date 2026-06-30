// ============================================================
// RMPG Flex — Accreditations & Compliance Page
// ============================================================
// Tracks officer accreditations, certifications, and compliance
// with expiration monitoring and reminder automation.
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import {
  Shield, Plus, Search, X, Save, Loader2, Bell, Calendar,
  AlertTriangle, CheckCircle, Clock, Filter,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';
import StatsCard from '../components/StatsCard';
import EmptyState from '../components/EmptyState';
import { apiFetch } from '../hooks/useApi';
import { useToast } from '../components/ToastProvider';
import { safeDateStr, localToday } from '../utils/dateUtils';

// ─── Types ───────────────────────────────────────────────────

interface Accreditation {
  id: number;
  officer_id: number;
  officer_name: string;
  badge_number: string;
  type: string;
  issuing_body: string;
  certificate_number: string;
  issued_date: string;
  expiration_date: string;
  status: AccreditationStatus;
  reminders_sent: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

type AccreditationStatus = 'active' | 'expired' | 'pending_renewal' | 'revoked' | 'suspended';

interface Officer {
  id: number;
  first_name: string;
  last_name: string;
  badge_number: string;
}

// ─── Constants ───────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-900/40 text-green-400 border border-green-700/40',
  expired: 'bg-red-900/40 text-red-400 border border-red-700/40',
  pending_renewal: 'bg-amber-900/40 text-amber-400 border border-amber-700/40',
  revoked: 'bg-red-900/60 text-red-400 border border-red-600/40',
  suspended: 'bg-amber-900/40 text-amber-400 border border-amber-700/40',
};

const STATUS_OPTIONS: AccreditationStatus[] = ['active', 'expired', 'pending_renewal', 'revoked', 'suspended'];

const EMPTY_FORM = {
  officer_id: '',
  type: '',
  issuing_body: '',
  certificate_number: '',
  issued_date: '',
  expiration_date: '',
  notes: '',
};

const EXPIRY_DAYS_OPTIONS = [
  { value: '', label: 'All' },
  { value: '30', label: '30 days' },
  { value: '60', label: '60 days' },
  { value: '90', label: '90 days' },
];

export default function AccreditationsPage() {
  const { addToast } = useToast();

  const [records, setRecords] = useState<Accreditation[]>([]);
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [officerFilter, setOfficerFilter] = useState<string>('');
  const [expiringFilter, setExpiringFilter] = useState<string>('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [checkingReminders, setCheckingReminders] = useState(false);

  // ─── Derived stats ────────────────────────────────────────

  const today = localToday();

  const isExpiringSoon = (d: string) => {
    if (!d) return false;
    const exp = new Date(d);
    const now = new Date(today);
    const diff = (exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 60;
  };

  const stats = {
    active: records.filter(r => r.status === 'active').length,
    expiring: records.filter(r => r.status === 'active' && isExpiringSoon(r.expiration_date)).length,
    expired: records.filter(r => r.status === 'expired').length,
    pending: records.filter(r => r.status === 'pending_renewal').length,
  };

  // ─── Fetch ─────────────────────────────────────────────────

  const fetchRecords = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (officerFilter) params.set('officer_id', officerFilter);
      if (expiringFilter) params.set('expiring_within_days', expiringFilter);
      const qs = params.toString();
      const data = await apiFetch<Accreditation[]>(`/api/accreditations${qs ? `?${qs}` : ''}`);
      setRecords(data);
    } catch {
      addToast('Failed to load accreditations', 'error');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, officerFilter, expiringFilter, addToast]);

  const fetchOfficers = useCallback(async () => {
    try {
      const data = await apiFetch<Officer[]>('/api/users?role=officer');
      setOfficers(data);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);
  useEffect(() => { fetchOfficers(); }, [fetchOfficers]);

  // ─── Actions ───────────────────────────────────────────────

  const handleAdd = async () => {
    if (!form.officer_id || !form.type || !form.issuing_body) {
      addToast('Officer, type, and issuing body are required', 'error');
      return;
    }
    try {
      setSaving(true);
      await apiFetch('/api/accreditations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          officer_id: Number(form.officer_id),
        }),
      });
      addToast('Accreditation added', 'success');
      setShowForm(false);
      setForm(EMPTY_FORM);
      fetchRecords();
    } catch {
      addToast('Failed to add accreditation', 'error');
    } finally {
      setSaving(false);
    }
  };

  const checkReminders = async () => {
    try {
      setCheckingReminders(true);
      const res = await apiFetch<{ sent: number }>('/api/accreditations/check-reminders', { method: 'POST' });
      addToast(`Reminders checked — ${res.sent ?? 0} sent`, 'success');
      fetchRecords();
    } catch {
      addToast('Failed to check reminders', 'error');
    } finally {
      setCheckingReminders(false);
    }
  };

  // ─── Row highlighting ────────────────────────────────────

  const rowHighlight = (r: Accreditation) => {
    if (r.status === 'expired') return 'bg-red-950/20';
    if (r.status === 'active' && isExpiringSoon(r.expiration_date)) return 'bg-amber-950/20';
    return '';
  };

  // ─── Filtered list ────────────────────────────────────────

  const filtered = records.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.officer_name.toLowerCase().includes(q) ||
      r.type.toLowerCase().includes(q) ||
      r.issuing_body.toLowerCase().includes(q) ||
      r.certificate_number.toLowerCase().includes(q)
    );
  });

  // ─── Form field helper ────────────────────────────────────

  const updateForm = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }));

  // ─── Render ────────────────────────────────────────────────

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="ACCREDITATION & COMPLIANCE" icon={Shield} />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatsCard icon={CheckCircle} label="Active" value={stats.active} accent="green" />
        <StatsCard icon={AlertTriangle} label="Expiring Soon" value={stats.expiring} accent="amber" />
        <StatsCard icon={Calendar} label="Expired" value={stats.expired} accent="red" />
        <StatsCard icon={Clock} label="Pending Renewal" value={stats.pending} accent="amber" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search officer, type, issuing body…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-[#141414] border border-[#222] rounded-sm text-xs text-gray-200 placeholder-gray-600 focus:border-[#d4a017] focus:outline-none"
          />
        </div>
        <select
          value={officerFilter}
          onChange={e => setOfficerFilter(e.target.value)}
          className="bg-[#141414] border border-[#222] rounded-sm text-xs text-gray-300 px-2 py-1.5 focus:border-[#d4a017] focus:outline-none"
        >
          <option value="">All Officers</option>
          {officers.map(o => (
            <option key={o.id} value={String(o.id)}>{o.last_name}, {o.first_name}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="bg-[#141414] border border-[#222] rounded-sm text-xs text-gray-300 px-2 py-1.5 focus:border-[#d4a017] focus:outline-none"
        >
          <option value="">All Statuses</option>
          {STATUS_OPTIONS.map(s => (
            <option key={s} value={s}>{s.replace(/_/g, ' ').toUpperCase()}</option>
          ))}
        </select>
        <select
          value={expiringFilter}
          onChange={e => setExpiringFilter(e.target.value)}
          className="bg-[#141414] border border-[#222] rounded-sm text-xs text-gray-300 px-2 py-1.5 focus:border-[#d4a017] focus:outline-none"
        >
          {EXPIRY_DAYS_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>Expiring: {o.label}</option>
          ))}
        </select>
        <button
          onClick={checkReminders}
          disabled={checkingReminders}
          className="px-3 py-1.5 text-xs text-gray-300 bg-[#141414] border border-[#222] rounded-sm hover:bg-[#1a1a1a] flex items-center gap-1 disabled:opacity-50"
        >
          {checkingReminders ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bell className="w-3 h-3" />}
          Check Reminders
        </button>
        <button
          onClick={() => { setShowForm(true); setForm(EMPTY_FORM); }}
          className="px-3 py-1.5 text-xs text-black bg-[#d4a017] rounded-sm hover:bg-[#b8891a] flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> Add Accreditation
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-500"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Shield} title="No accreditations found" />
      ) : (
        <div className="overflow-x-auto border border-[#222] rounded-sm">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-[#141414] border-b border-[#222] text-gray-400 font-semibold text-[9px] uppercase tracking-wider">
                <th className="text-left px-2 py-[3px]">Officer</th>
                <th className="text-left px-2 py-[3px]">Type</th>
                <th className="text-left px-2 py-[3px]">Issuing Body</th>
                <th className="text-left px-2 py-[3px]">Certificate #</th>
                <th className="text-left px-2 py-[3px]">Issued</th>
                <th className="text-left px-2 py-[3px]">Expires</th>
                <th className="text-left px-2 py-[3px]">Status</th>
                <th className="text-left px-2 py-[3px]">Reminders Sent</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr
                  key={r.id}
                  className={`border-b border-[#1a1a1a] hover:bg-[#1a1a1a] transition-colors ${rowHighlight(r)}`}
                >
                  <td className="px-2 py-[2px] text-gray-300">{r.officer_name} <span className="text-gray-600">({r.badge_number})</span></td>
                  <td className="px-2 py-[2px] text-gray-300">{r.type}</td>
                  <td className="px-2 py-[2px] text-gray-400">{r.issuing_body}</td>
                  <td className="px-2 py-[2px] text-[#d4a017] font-mono">{r.certificate_number}</td>
                  <td className="px-2 py-[2px] text-gray-400">{safeDateStr(r.issued_date)}</td>
                  <td className="px-2 py-[2px] text-gray-400">{safeDateStr(r.expiration_date)}</td>
                  <td className="px-2 py-[2px]">
                    <span className={`inline-block px-1.5 py-0.5 rounded-sm text-[10px] ${STATUS_COLORS[r.status] || 'text-gray-400'}`}>
                      {r.status.replace(/_/g, ' ').toUpperCase()}
                    </span>
                  </td>
                  <td className="px-2 py-[2px] text-gray-400 text-center">{r.reminders_sent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-[#0a0a0a] border border-[#222] rounded-sm w-full max-w-lg shadow-lg">
            <div className="flex items-center justify-between px-4 py-2 border-b border-[#222] bg-gradient-to-r from-[#1a1a1a] to-[#242424]">
              <span className="text-[#d4a017] text-xs font-semibold">ADD ACCREDITATION</span>
              <IconButton aria-label="Close form" onClick={() => setShowForm(false)}>
                <X className="w-4 h-4" />
              </IconButton>
            </div>

            <div className="p-4 space-y-3 text-xs">
              <div>
                <label className="text-[9px] uppercase text-gray-500 font-semibold">Officer *</label>
                <select
                  value={form.officer_id}
                  onChange={e => updateForm('officer_id', e.target.value)}
                  className="w-full bg-[#141414] border border-[#222] rounded-sm text-xs text-gray-300 px-2 py-1.5 mt-1 focus:border-[#d4a017] focus:outline-none"
                >
                  <option value="">— Select Officer —</option>
                  {officers.map(o => (
                    <option key={o.id} value={String(o.id)}>{o.last_name}, {o.first_name} ({o.badge_number})</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[9px] uppercase text-gray-500 font-semibold">Type *</label>
                  <input
                    value={form.type}
                    onChange={e => updateForm('type', e.target.value)}
                    placeholder="e.g. POST Certification"
                    className="w-full bg-[#141414] border border-[#222] rounded-sm text-xs text-gray-300 px-2 py-1.5 mt-1 focus:border-[#d4a017] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[9px] uppercase text-gray-500 font-semibold">Issuing Body *</label>
                  <input
                    value={form.issuing_body}
                    onChange={e => updateForm('issuing_body', e.target.value)}
                    placeholder="e.g. Utah POST"
                    className="w-full bg-[#141414] border border-[#222] rounded-sm text-xs text-gray-300 px-2 py-1.5 mt-1 focus:border-[#d4a017] focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="text-[9px] uppercase text-gray-500 font-semibold">Certificate #</label>
                <input
                  value={form.certificate_number}
                  onChange={e => updateForm('certificate_number', e.target.value)}
                  className="w-full bg-[#141414] border border-[#222] rounded-sm text-xs text-gray-300 px-2 py-1.5 mt-1 focus:border-[#d4a017] focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[9px] uppercase text-gray-500 font-semibold">Issued Date</label>
                  <input
                    type="date"
                    value={form.issued_date}
                    onChange={e => updateForm('issued_date', e.target.value)}
                    className="w-full bg-[#141414] border border-[#222] rounded-sm text-xs text-gray-300 px-2 py-1.5 mt-1 focus:border-[#d4a017] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[9px] uppercase text-gray-500 font-semibold">Expiration Date</label>
                  <input
                    type="date"
                    value={form.expiration_date}
                    onChange={e => updateForm('expiration_date', e.target.value)}
                    className="w-full bg-[#141414] border border-[#222] rounded-sm text-xs text-gray-300 px-2 py-1.5 mt-1 focus:border-[#d4a017] focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="text-[9px] uppercase text-gray-500 font-semibold">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={e => updateForm('notes', e.target.value)}
                  rows={2}
                  className="w-full bg-[#141414] border border-[#222] rounded-sm text-xs text-gray-300 px-2 py-1.5 mt-1 focus:border-[#d4a017] focus:outline-none resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setShowForm(false)}
                  className="px-3 py-1.5 text-xs text-gray-400 bg-[#141414] border border-[#222] rounded-sm hover:bg-[#1a1a1a]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAdd}
                  disabled={saving}
                  className="px-3 py-1.5 text-xs text-black bg-[#d4a017] rounded-sm hover:bg-[#b8891a] disabled:opacity-50 flex items-center gap-1"
                >
                  {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                  <Save className="w-3 h-3" /> Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
