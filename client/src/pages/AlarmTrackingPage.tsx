import React, { useState, useEffect, useCallback } from 'react';
import {
  Bell, Plus, Search, X, Save, Loader2, Calendar, AlertTriangle,
  ShieldCheck, ShieldOff, Clock, Filter, ChevronLeft,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';
import EmptyState from '../components/EmptyState';
import StatsCard from '../components/StatsCard';
import { apiFetch } from '../hooks/useApi';
import { useToast } from '../components/ToastProvider';
import { safeDateStr, safeDateTimeStr } from '../utils/dateUtils';

// ─── Types ───────────────────────────────────────────────────

interface AlarmPermit {
  id: number;
  permit_number: string;
  location_name: string;
  location_address: string;
  alarm_company: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  alarm_type: string;
  status: 'active' | 'expired' | 'suspended' | 'revoked';
  false_alarm_count: number;
  billing_threshold: number;
  issued_date: string;
  expiration_date: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

interface AlarmActivation {
  id: number;
  permit_id: number;
  permit_number?: string;
  location_name?: string;
  location_address?: string;
  activation_date: string;
  alarm_type: string;
  is_false_alarm: boolean;
  cause: string;
  response_time_minutes: number | null;
  responding_officer: string;
  billed: boolean;
  billed_amount: number | null;
  notes: string;
  created_at: string;
}

// ─── Constants ───────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  active: 'text-green-400',
  expired: 'text-amber-400',
  suspended: 'text-red-400',
  revoked: 'text-red-500',
};

const STATUS_BG: Record<string, string> = {
  active: 'bg-green-900/40 border-green-700/40',
  expired: 'bg-amber-900/40 border-amber-700/40',
  suspended: 'bg-red-900/40 border-red-700/40',
  revoked: 'bg-red-900/60 border-red-600/40',
};

const ALARM_TYPES = [
  'Burglary', 'Fire', 'Panic/Duress', 'Medical', 'Holdup',
  'Environmental', 'Video Surveillance', 'Other',
];

const EMPTY_PERMIT_FORM = {
  permit_number: '',
  location_name: '',
  location_address: '',
  alarm_company: '',
  contact_name: '',
  contact_phone: '',
  contact_email: '',
  alarm_type: 'Burglary',
  billing_threshold: '3',
  expiration_date: '',
  notes: '',
};

const EMPTY_ACTIVATION_FORM = {
  permit_id: '',
  activation_date: new Date().toISOString().slice(0, 16),
  alarm_type: 'Burglary',
  is_false_alarm: false,
  cause: '',
  response_time_minutes: '',
  responding_officer: '',
  billed: false,
  billed_amount: '',
  notes: '',
};

// ─── Component ───────────────────────────────────────────────

export default function AlarmTrackingPage() {
  const { addToast } = useToast();

  // Tab state
  const [activeTab, setActiveTab] = useState<'permits' | 'activations'>('permits');

  // Permits state
  const [permits, setPermits] = useState<AlarmPermit[]>([]);
  const [loadingPermits, setLoadingPermits] = useState(true);
  const [permitSearch, setPermitSearch] = useState('');
  const [permitStatusFilter, setPermitStatusFilter] = useState<string>('all');
  const [selectedPermit, setSelectedPermit] = useState<AlarmPermit | null>(null);
  const [permitActivations, setPermitActivations] = useState<AlarmActivation[]>([]);
  const [loadingPermitActivations, setLoadingPermitActivations] = useState(false);

  // Permit form
  const [permitFormOpen, setPermitFormOpen] = useState(false);
  const [editingPermit, setEditingPermit] = useState<AlarmPermit | null>(null);
  const [permitForm, setPermitForm] = useState({ ...EMPTY_PERMIT_FORM });
  const [submittingPermit, setSubmittingPermit] = useState(false);

  // Activations state
  const [activations, setActivations] = useState<AlarmActivation[]>([]);
  const [loadingActivations, setLoadingActivations] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [falseAlarmOnly, setFalseAlarmOnly] = useState(false);

  // Activation form
  const [activationFormOpen, setActivationFormOpen] = useState(false);
  const [activationForm, setActivationForm] = useState({ ...EMPTY_ACTIVATION_FORM });
  const [submittingActivation, setSubmittingActivation] = useState(false);

  // Stats
  const [stats, setStats] = useState({ active: 0, expired: 0, suspended: 0 });

  // ─── Data Fetching ───────────────────────────────────────────

  const fetchPermits = useCallback(async () => {
    setLoadingPermits(true);
    try {
      const data = await apiFetch<AlarmPermit[]>('/api/alarm-tracking/permits');
      setPermits(data);
      setStats({
        active: data.filter(p => p.status === 'active').length,
        expired: data.filter(p => p.status === 'expired').length,
        suspended: data.filter(p => p.status === 'suspended').length,
      });
    } catch {
      addToast('Failed to load alarm permits', 'error');
    } finally {
      setLoadingPermits(false);
    }
  }, [addToast]);

  const fetchActivations = useCallback(async () => {
    setLoadingActivations(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);
      if (falseAlarmOnly) params.set('false_alarm', '1');
      const qs = params.toString();
      const data = await apiFetch<AlarmActivation[]>(`/api/alarm-tracking/activations${qs ? `?${qs}` : ''}`);
      setActivations(data);
    } catch {
      addToast('Failed to load activations', 'error');
    } finally {
      setLoadingActivations(false);
    }
  }, [addToast, dateFrom, dateTo, falseAlarmOnly]);

  const fetchPermitActivations = useCallback(async (permitId: number) => {
    setLoadingPermitActivations(true);
    try {
      const data = await apiFetch<AlarmActivation[]>(`/api/alarm-tracking/permits/${permitId}/activations`);
      setPermitActivations(data);
    } catch {
      addToast('Failed to load permit activations', 'error');
    } finally {
      setLoadingPermitActivations(false);
    }
  }, [addToast]);

  useEffect(() => { fetchPermits(); }, [fetchPermits]);
  useEffect(() => { if (activeTab === 'activations') fetchActivations(); }, [activeTab, fetchActivations]);

  // ─── Permit CRUD ─────────────────────────────────────────────

  const openNewPermit = () => {
    setEditingPermit(null);
    setPermitForm({ ...EMPTY_PERMIT_FORM });
    setPermitFormOpen(true);
  };

  const openEditPermit = (permit: AlarmPermit) => {
    setEditingPermit(permit);
    setPermitForm({
      permit_number: permit.permit_number,
      location_name: permit.location_name,
      location_address: permit.location_address,
      alarm_company: permit.alarm_company,
      contact_name: permit.contact_name,
      contact_phone: permit.contact_phone,
      contact_email: permit.contact_email,
      alarm_type: permit.alarm_type,
      billing_threshold: String(permit.billing_threshold),
      expiration_date: permit.expiration_date?.slice(0, 10) || '',
      notes: permit.notes || '',
    });
    setPermitFormOpen(true);
  };

  const handlePermitSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!permitForm.location_name.trim() || !permitForm.alarm_company.trim()) {
      addToast('Location and alarm company are required', 'error');
      return;
    }
    setSubmittingPermit(true);
    try {
      const payload = {
        ...permitForm,
        billing_threshold: parseInt(permitForm.billing_threshold, 10) || 3,
      };
      if (editingPermit) {
        await apiFetch(`/api/alarm-tracking/permits/${editingPermit.id}`, { method: 'PUT', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
        addToast('Permit updated', 'success');
      } else {
        await apiFetch('/api/alarm-tracking/permits', { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
        addToast('Permit created', 'success');
      }
      setPermitFormOpen(false);
      fetchPermits();
    } catch {
      addToast('Failed to save permit', 'error');
    } finally {
      setSubmittingPermit(false);
    }
  };

  const selectPermit = (permit: AlarmPermit) => {
    setSelectedPermit(permit);
    fetchPermitActivations(permit.id);
  };

  // ─── Activation CRUD ─────────────────────────────────────────

  const openNewActivation = () => {
    setActivationForm({ ...EMPTY_ACTIVATION_FORM });
    setActivationFormOpen(true);
  };

  const handleActivationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activationForm.permit_id) {
      addToast('Please select a permit', 'error');
      return;
    }
    setSubmittingActivation(true);
    try {
      const payload = {
        ...activationForm,
        permit_id: parseInt(String(activationForm.permit_id), 10),
        response_time_minutes: activationForm.response_time_minutes ? parseInt(String(activationForm.response_time_minutes), 10) : null,
        billed_amount: activationForm.billed_amount ? parseFloat(String(activationForm.billed_amount)) : null,
      };
      await apiFetch('/api/alarm-tracking/activations', { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
      addToast('Activation logged', 'success');
      setActivationFormOpen(false);
      fetchActivations();
      fetchPermits();
    } catch {
      addToast('Failed to log activation', 'error');
    } finally {
      setSubmittingActivation(false);
    }
  };

  // ─── Filtering ───────────────────────────────────────────────

  const filteredPermits = permits.filter(p => {
    if (permitStatusFilter !== 'all' && p.status !== permitStatusFilter) return false;
    if (permitSearch) {
      const q = permitSearch.toLowerCase();
      return (
        p.permit_number.toLowerCase().includes(q) ||
        p.location_name.toLowerCase().includes(q) ||
        p.location_address.toLowerCase().includes(q) ||
        p.alarm_company.toLowerCase().includes(q) ||
        p.contact_name.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // ─── Render helpers ──────────────────────────────────────────

  const statusBadge = (status: string) => (
    <span className={`inline-block px-1.5 py-0.5 text-[10px] font-semibold uppercase border ${STATUS_BG[status] || ''} ${STATUS_COLORS[status] || 'text-gray-400'}`}>
      {status}
    </span>
  );

  const falseAlarmText = (count: number, threshold: number) => (
    <span className={count >= threshold ? 'text-red-400 font-bold' : 'text-gray-300'}>
      {count}
    </span>
  );

  // ─── Permit Detail View ──────────────────────────────────────

  if (selectedPermit) {
    return (
      <div className="p-4 space-y-4 bg-[#0a0a0a] min-h-full">
        <PanelTitleBar title={`PERMIT ${selectedPermit.permit_number}`} icon={Bell}>
          <button
            onClick={() => setSelectedPermit(null)}
            className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-gray-300 hover:text-white border border-[#222222] bg-[#141414] hover:bg-[#1a1a1a] transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Back
          </button>
        </PanelTitleBar>

        {/* Permit info */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-[#141414] border border-[#222222] p-3">
            <p className="text-[9px] uppercase tracking-wider text-gray-500 mb-1">Location</p>
            <p className="text-[11px] text-gray-200">{selectedPermit.location_name}</p>
            <p className="text-[10px] text-gray-400">{selectedPermit.location_address}</p>
          </div>
          <div className="bg-[#141414] border border-[#222222] p-3">
            <p className="text-[9px] uppercase tracking-wider text-gray-500 mb-1">Alarm Company</p>
            <p className="text-[11px] text-gray-200">{selectedPermit.alarm_company}</p>
          </div>
          <div className="bg-[#141414] border border-[#222222] p-3">
            <p className="text-[9px] uppercase tracking-wider text-gray-500 mb-1">Contact</p>
            <p className="text-[11px] text-gray-200">{selectedPermit.contact_name}</p>
            <p className="text-[10px] text-gray-400">{selectedPermit.contact_phone}</p>
          </div>
          <div className="bg-[#141414] border border-[#222222] p-3">
            <p className="text-[9px] uppercase tracking-wider text-gray-500 mb-1">Status</p>
            <div className="mt-1">{statusBadge(selectedPermit.status)}</div>
            <p className="text-[10px] text-gray-400 mt-1">
              False alarms: {falseAlarmText(selectedPermit.false_alarm_count, selectedPermit.billing_threshold)} / {selectedPermit.billing_threshold} threshold
            </p>
          </div>
        </div>

        {/* Permit activations table */}
        <PanelTitleBar title="ACTIVATION HISTORY" icon={Clock} />
        <div className="border border-[#222222] bg-[#0a0a0a] overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[#222222]" style={{ background: 'linear-gradient(180deg, #1a1a1a, #141414)' }}>
                <th className="px-2 py-[3px] text-[9px] font-semibold uppercase tracking-wider text-gray-400">Date</th>
                <th className="px-2 py-[3px] text-[9px] font-semibold uppercase tracking-wider text-gray-400">Type</th>
                <th className="px-2 py-[3px] text-[9px] font-semibold uppercase tracking-wider text-gray-400">Response</th>
                <th className="px-2 py-[3px] text-[9px] font-semibold uppercase tracking-wider text-gray-400">False?</th>
                <th className="px-2 py-[3px] text-[9px] font-semibold uppercase tracking-wider text-gray-400">Cause</th>
                <th className="px-2 py-[3px] text-[9px] font-semibold uppercase tracking-wider text-gray-400">Billed</th>
              </tr>
            </thead>
            <tbody>
              {loadingPermitActivations ? (
                <tr><td colSpan={6} className="px-2 py-6 text-center text-[11px] text-gray-500"><Loader2 className="w-4 h-4 animate-spin inline-block mr-1" />Loading…</td></tr>
              ) : permitActivations.length === 0 ? (
                <tr><td colSpan={6} className="px-2 py-6 text-center text-[11px] text-gray-500">No activations recorded</td></tr>
              ) : permitActivations.map(a => (
                <tr key={a.id} className="border-b border-[#1a1a1a] hover:bg-[#141414] transition-colors">
                  <td className="px-2 py-[2px] text-[11px] text-gray-300 font-mono">{safeDateTimeStr(a.activation_date)}</td>
                  <td className="px-2 py-[2px] text-[11px] text-gray-300">{a.alarm_type}</td>
                  <td className="px-2 py-[2px] text-[11px] text-gray-300 font-mono">{a.response_time_minutes != null ? `${a.response_time_minutes} min` : '—'}</td>
                  <td className="px-2 py-[2px] text-[11px]">
                    {a.is_false_alarm ? <span className="text-red-400 font-bold">YES</span> : <span className="text-gray-500">No</span>}
                  </td>
                  <td className="px-2 py-[2px] text-[11px] text-gray-300">{a.cause || '—'}</td>
                  <td className="px-2 py-[2px] text-[11px]">
                    {a.billed ? <span className="text-amber-400">${a.billed_amount?.toFixed(2) ?? '—'}</span> : <span className="text-gray-500">No</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end">
          <button
            onClick={() => openEditPermit(selectedPermit)}
            className="px-3 py-1.5 text-[11px] font-semibold bg-[#141414] border border-[#222222] text-[#d4a017] hover:bg-[#1a1a1a] transition-colors"
          >
            Edit Permit
          </button>
        </div>
      </div>
    );
  }

  // ─── Main View ───────────────────────────────────────────────

  return (
    <div className="p-4 space-y-4 bg-[#0a0a0a] min-h-full">
      <PanelTitleBar title="ALARM TRACKING" icon={Bell} />

      {/* Tabs */}
      <div className="flex gap-0 border-b border-[#222222]">
        {(['permits', 'activations'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-[11px] font-semibold uppercase tracking-wider transition-colors border-b-2 ${
              activeTab === tab
                ? 'text-[#d4a017] border-[#d4a017] bg-[#141414]'
                : 'text-gray-500 border-transparent hover:text-gray-300 hover:bg-[#0f0f0f]'
            }`}
          >
            {tab === 'permits' ? 'Permits' : 'Activations'}
          </button>
        ))}
      </div>

      {/* ────── PERMITS TAB ────── */}
      {activeTab === 'permits' && (
        <div className="space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <StatsCard icon={ShieldCheck} label="Active Permits" value={stats.active} accent="green" />
            <StatsCard icon={Calendar} label="Expired" value={stats.expired} accent="amber" />
            <StatsCard icon={ShieldOff} label="Suspended" value={stats.suspended} accent="red" />
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
              <input
                type="text"
                placeholder="Search permits…"
                value={permitSearch}
                onChange={e => setPermitSearch(e.target.value)}
                className="w-full pl-7 pr-2 py-1.5 text-[11px] bg-[#141414] border border-[#222222] text-gray-200 placeholder-gray-600 focus:border-[#d4a017]/50 focus:outline-none"
              />
            </div>
            <select
              value={permitStatusFilter}
              onChange={e => setPermitStatusFilter(e.target.value)}
              className="px-2 py-1.5 text-[11px] bg-[#141414] border border-[#222222] text-gray-300 focus:outline-none"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="expired">Expired</option>
              <option value="suspended">Suspended</option>
              <option value="revoked">Revoked</option>
            </select>
            <button
              onClick={openNewPermit}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-[#d4a017] text-black hover:bg-[#b8891a] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> New Permit
            </button>
          </div>

          {/* Table */}
          <div className="border border-[#222222] bg-[#0a0a0a] overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[#222222]" style={{ background: 'linear-gradient(180deg, #1a1a1a, #141414)' }}>
                  <th className="px-2 py-[3px] text-[9px] font-semibold uppercase tracking-wider text-gray-400">Permit #</th>
                  <th className="px-2 py-[3px] text-[9px] font-semibold uppercase tracking-wider text-gray-400">Location</th>
                  <th className="px-2 py-[3px] text-[9px] font-semibold uppercase tracking-wider text-gray-400">Alarm Co</th>
                  <th className="px-2 py-[3px] text-[9px] font-semibold uppercase tracking-wider text-gray-400">Contact</th>
                  <th className="px-2 py-[3px] text-[9px] font-semibold uppercase tracking-wider text-gray-400">Type</th>
                  <th className="px-2 py-[3px] text-[9px] font-semibold uppercase tracking-wider text-gray-400">False Alarms</th>
                  <th className="px-2 py-[3px] text-[9px] font-semibold uppercase tracking-wider text-gray-400">Threshold</th>
                  <th className="px-2 py-[3px] text-[9px] font-semibold uppercase tracking-wider text-gray-400">Status</th>
                </tr>
              </thead>
              <tbody>
                {loadingPermits ? (
                  <tr><td colSpan={8} className="px-2 py-8 text-center text-[11px] text-gray-500"><Loader2 className="w-4 h-4 animate-spin inline-block mr-1" />Loading…</td></tr>
                ) : filteredPermits.length === 0 ? (
                  <tr><td colSpan={8}><EmptyState icon={Bell} title="No permits found" description="Create a new alarm permit to get started." /></td></tr>
                ) : filteredPermits.map(p => (
                  <tr
                    key={p.id}
                    onClick={() => selectPermit(p)}
                    className="border-b border-[#1a1a1a] hover:bg-[#141414] cursor-pointer transition-colors"
                  >
                    <td className="px-2 py-[2px] text-[11px] text-[#d4a017] font-mono font-semibold">{p.permit_number}</td>
                    <td className="px-2 py-[2px] text-[11px] text-gray-200">
                      <div>{p.location_name}</div>
                      <div className="text-[10px] text-gray-500">{p.location_address}</div>
                    </td>
                    <td className="px-2 py-[2px] text-[11px] text-gray-300">{p.alarm_company}</td>
                    <td className="px-2 py-[2px] text-[11px] text-gray-300">{p.contact_name}</td>
                    <td className="px-2 py-[2px] text-[11px] text-gray-300">{p.alarm_type}</td>
                    <td className="px-2 py-[2px] text-[11px] font-mono">{falseAlarmText(p.false_alarm_count, p.billing_threshold)}</td>
                    <td className="px-2 py-[2px] text-[11px] text-gray-400 font-mono">{p.billing_threshold}</td>
                    <td className="px-2 py-[2px]">{statusBadge(p.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ────── ACTIVATIONS TAB ────── */}
      {activeTab === 'activations' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-gray-500" />
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="px-2 py-1.5 text-[11px] bg-[#141414] border border-[#222222] text-gray-300 focus:outline-none"
                placeholder="From"
              />
              <span className="text-gray-600 text-[10px]">to</span>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="px-2 py-1.5 text-[11px] bg-[#141414] border border-[#222222] text-gray-300 focus:outline-none"
                placeholder="To"
              />
            </div>
            <label className="flex items-center gap-1.5 text-[11px] text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={falseAlarmOnly}
                onChange={e => setFalseAlarmOnly(e.target.checked)}
                className="accent-[#d4a017]"
              />
              <Filter className="w-3 h-3" />
              False alarms only
            </label>
            <div className="flex-1" />
            <button
              onClick={openNewActivation}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-[#d4a017] text-black hover:bg-[#b8891a] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Log Activation
            </button>
          </div>

          {/* Table */}
          <div className="border border-[#222222] bg-[#0a0a0a] overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[#222222]" style={{ background: 'linear-gradient(180deg, #1a1a1a, #141414)' }}>
                  <th className="px-2 py-[3px] text-[9px] font-semibold uppercase tracking-wider text-gray-400">Date</th>
                  <th className="px-2 py-[3px] text-[9px] font-semibold uppercase tracking-wider text-gray-400">Permit / Location</th>
                  <th className="px-2 py-[3px] text-[9px] font-semibold uppercase tracking-wider text-gray-400">Type</th>
                  <th className="px-2 py-[3px] text-[9px] font-semibold uppercase tracking-wider text-gray-400">Response Time</th>
                  <th className="px-2 py-[3px] text-[9px] font-semibold uppercase tracking-wider text-gray-400">False Alarm?</th>
                  <th className="px-2 py-[3px] text-[9px] font-semibold uppercase tracking-wider text-gray-400">Cause</th>
                  <th className="px-2 py-[3px] text-[9px] font-semibold uppercase tracking-wider text-gray-400">Billed</th>
                </tr>
              </thead>
              <tbody>
                {loadingActivations ? (
                  <tr><td colSpan={7} className="px-2 py-8 text-center text-[11px] text-gray-500"><Loader2 className="w-4 h-4 animate-spin inline-block mr-1" />Loading…</td></tr>
                ) : activations.length === 0 ? (
                  <tr><td colSpan={7}><EmptyState icon={Bell} title="No activations found" description="Log an alarm activation to begin tracking." /></td></tr>
                ) : activations.map(a => (
                  <tr key={a.id} className="border-b border-[#1a1a1a] hover:bg-[#141414] transition-colors">
                    <td className="px-2 py-[2px] text-[11px] text-gray-300 font-mono">{safeDateTimeStr(a.activation_date)}</td>
                    <td className="px-2 py-[2px] text-[11px]">
                      <span className="text-[#d4a017] font-mono">{a.permit_number || '—'}</span>
                      {a.location_name && <span className="text-gray-400 ml-1.5">{a.location_name}</span>}
                    </td>
                    <td className="px-2 py-[2px] text-[11px] text-gray-300">{a.alarm_type}</td>
                    <td className="px-2 py-[2px] text-[11px] text-gray-300 font-mono">{a.response_time_minutes != null ? `${a.response_time_minutes} min` : '—'}</td>
                    <td className="px-2 py-[2px] text-[11px]">
                      {a.is_false_alarm ? <span className="text-red-400 font-bold">YES</span> : <span className="text-gray-500">No</span>}
                    </td>
                    <td className="px-2 py-[2px] text-[11px] text-gray-300">{a.cause || '—'}</td>
                    <td className="px-2 py-[2px] text-[11px]">
                      {a.billed ? <span className="text-amber-400">${a.billed_amount?.toFixed(2) ?? '—'}</span> : <span className="text-gray-500">No</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ────── PERMIT FORM MODAL ────── */}
      {permitFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setPermitFormOpen(false)}>
          <div
            className="w-full max-w-lg bg-[#141414] border border-[#222222] shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2 border-b border-[#222222]" style={{ background: 'linear-gradient(180deg, #1a1a1a, #141414)' }}>
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#d4a017]">
                {editingPermit ? 'Edit Permit' : 'New Alarm Permit'}
              </h2>
              <IconButton onClick={() => setPermitFormOpen(false)} aria-label="Close permit form">
                <X className="w-4 h-4" />
              </IconButton>
            </div>
            <form onSubmit={handlePermitSubmit} className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[9px] uppercase tracking-wider text-gray-500">Permit #</span>
                  <input type="text" value={permitForm.permit_number} onChange={e => setPermitForm(f => ({ ...f, permit_number: e.target.value }))}
                    className="w-full mt-0.5 px-2 py-1.5 text-[11px] bg-[#0a0a0a] border border-[#222222] text-gray-200 focus:border-[#d4a017]/50 focus:outline-none" placeholder="Auto-generated if blank" />
                </label>
                <label className="block">
                  <span className="text-[9px] uppercase tracking-wider text-gray-500">Alarm Type</span>
                  <select value={permitForm.alarm_type} onChange={e => setPermitForm(f => ({ ...f, alarm_type: e.target.value }))}
                    className="w-full mt-0.5 px-2 py-1.5 text-[11px] bg-[#0a0a0a] border border-[#222222] text-gray-200 focus:outline-none">
                    {ALARM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="text-[9px] uppercase tracking-wider text-gray-500">Location Name *</span>
                <input type="text" value={permitForm.location_name} onChange={e => setPermitForm(f => ({ ...f, location_name: e.target.value }))}
                  className="w-full mt-0.5 px-2 py-1.5 text-[11px] bg-[#0a0a0a] border border-[#222222] text-gray-200 focus:border-[#d4a017]/50 focus:outline-none" required />
              </label>
              <label className="block">
                <span className="text-[9px] uppercase tracking-wider text-gray-500">Location Address</span>
                <input type="text" value={permitForm.location_address} onChange={e => setPermitForm(f => ({ ...f, location_address: e.target.value }))}
                  className="w-full mt-0.5 px-2 py-1.5 text-[11px] bg-[#0a0a0a] border border-[#222222] text-gray-200 focus:border-[#d4a017]/50 focus:outline-none" />
              </label>
              <label className="block">
                <span className="text-[9px] uppercase tracking-wider text-gray-500">Alarm Company *</span>
                <input type="text" value={permitForm.alarm_company} onChange={e => setPermitForm(f => ({ ...f, alarm_company: e.target.value }))}
                  className="w-full mt-0.5 px-2 py-1.5 text-[11px] bg-[#0a0a0a] border border-[#222222] text-gray-200 focus:border-[#d4a017]/50 focus:outline-none" required />
              </label>
              <div className="grid grid-cols-3 gap-3">
                <label className="block">
                  <span className="text-[9px] uppercase tracking-wider text-gray-500">Contact Name</span>
                  <input type="text" value={permitForm.contact_name} onChange={e => setPermitForm(f => ({ ...f, contact_name: e.target.value }))}
                    className="w-full mt-0.5 px-2 py-1.5 text-[11px] bg-[#0a0a0a] border border-[#222222] text-gray-200 focus:outline-none" />
                </label>
                <label className="block">
                  <span className="text-[9px] uppercase tracking-wider text-gray-500">Phone</span>
                  <input type="text" value={permitForm.contact_phone} onChange={e => setPermitForm(f => ({ ...f, contact_phone: e.target.value }))}
                    className="w-full mt-0.5 px-2 py-1.5 text-[11px] bg-[#0a0a0a] border border-[#222222] text-gray-200 focus:outline-none" />
                </label>
                <label className="block">
                  <span className="text-[9px] uppercase tracking-wider text-gray-500">Email</span>
                  <input type="text" value={permitForm.contact_email} onChange={e => setPermitForm(f => ({ ...f, contact_email: e.target.value }))}
                    className="w-full mt-0.5 px-2 py-1.5 text-[11px] bg-[#0a0a0a] border border-[#222222] text-gray-200 focus:outline-none" />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[9px] uppercase tracking-wider text-gray-500">Billing Threshold</span>
                  <input type="number" min="1" value={permitForm.billing_threshold} onChange={e => setPermitForm(f => ({ ...f, billing_threshold: e.target.value }))}
                    className="w-full mt-0.5 px-2 py-1.5 text-[11px] bg-[#0a0a0a] border border-[#222222] text-gray-200 focus:outline-none" />
                </label>
                <label className="block">
                  <span className="text-[9px] uppercase tracking-wider text-gray-500">Expiration Date</span>
                  <input type="date" value={permitForm.expiration_date} onChange={e => setPermitForm(f => ({ ...f, expiration_date: e.target.value }))}
                    className="w-full mt-0.5 px-2 py-1.5 text-[11px] bg-[#0a0a0a] border border-[#222222] text-gray-200 focus:outline-none" />
                </label>
              </div>
              <label className="block">
                <span className="text-[9px] uppercase tracking-wider text-gray-500">Notes</span>
                <textarea rows={2} value={permitForm.notes} onChange={e => setPermitForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full mt-0.5 px-2 py-1.5 text-[11px] bg-[#0a0a0a] border border-[#222222] text-gray-200 focus:outline-none resize-none" />
              </label>
              <div className="flex justify-end gap-2 pt-2 border-t border-[#222222]">
                <button type="button" onClick={() => setPermitFormOpen(false)}
                  className="px-3 py-1.5 text-[11px] text-gray-400 border border-[#222222] bg-[#0a0a0a] hover:bg-[#141414] transition-colors">Cancel</button>
                <button type="submit" disabled={submittingPermit}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-[#d4a017] text-black hover:bg-[#b8891a] disabled:opacity-50 transition-colors">
                  {submittingPermit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  {editingPermit ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ────── ACTIVATION FORM MODAL ────── */}
      {activationFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setActivationFormOpen(false)}>
          <div
            className="w-full max-w-lg bg-[#141414] border border-[#222222] shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2 border-b border-[#222222]" style={{ background: 'linear-gradient(180deg, #1a1a1a, #141414)' }}>
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#d4a017]">Log Alarm Activation</h2>
              <IconButton onClick={() => setActivationFormOpen(false)} aria-label="Close activation form">
                <X className="w-4 h-4" />
              </IconButton>
            </div>
            <form onSubmit={handleActivationSubmit} className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
              <label className="block">
                <span className="text-[9px] uppercase tracking-wider text-gray-500">Permit *</span>
                <select value={activationForm.permit_id} onChange={e => setActivationForm(f => ({ ...f, permit_id: e.target.value }))}
                  className="w-full mt-0.5 px-2 py-1.5 text-[11px] bg-[#0a0a0a] border border-[#222222] text-gray-200 focus:outline-none" required>
                  <option value="">Select permit…</option>
                  {permits.filter(p => p.status === 'active').map(p => (
                    <option key={p.id} value={p.id}>{p.permit_number} — {p.location_name}</option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[9px] uppercase tracking-wider text-gray-500">Date/Time</span>
                  <input type="datetime-local" value={activationForm.activation_date} onChange={e => setActivationForm(f => ({ ...f, activation_date: e.target.value }))}
                    className="w-full mt-0.5 px-2 py-1.5 text-[11px] bg-[#0a0a0a] border border-[#222222] text-gray-200 focus:outline-none" />
                </label>
                <label className="block">
                  <span className="text-[9px] uppercase tracking-wider text-gray-500">Alarm Type</span>
                  <select value={activationForm.alarm_type} onChange={e => setActivationForm(f => ({ ...f, alarm_type: e.target.value }))}
                    className="w-full mt-0.5 px-2 py-1.5 text-[11px] bg-[#0a0a0a] border border-[#222222] text-gray-200 focus:outline-none">
                    {ALARM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[9px] uppercase tracking-wider text-gray-500">Response Time (min)</span>
                  <input type="number" min="0" value={activationForm.response_time_minutes} onChange={e => setActivationForm(f => ({ ...f, response_time_minutes: e.target.value }))}
                    className="w-full mt-0.5 px-2 py-1.5 text-[11px] bg-[#0a0a0a] border border-[#222222] text-gray-200 focus:outline-none" />
                </label>
                <label className="block">
                  <span className="text-[9px] uppercase tracking-wider text-gray-500">Responding Officer</span>
                  <input type="text" value={activationForm.responding_officer} onChange={e => setActivationForm(f => ({ ...f, responding_officer: e.target.value }))}
                    className="w-full mt-0.5 px-2 py-1.5 text-[11px] bg-[#0a0a0a] border border-[#222222] text-gray-200 focus:outline-none" />
                </label>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-[11px] text-gray-300 cursor-pointer select-none">
                  <input type="checkbox" checked={activationForm.is_false_alarm} onChange={e => setActivationForm(f => ({ ...f, is_false_alarm: e.target.checked }))}
                    className="accent-red-500" />
                  <AlertTriangle className="w-3 h-3 text-red-400" />
                  False Alarm
                </label>
                <label className="flex items-center gap-1.5 text-[11px] text-gray-300 cursor-pointer select-none">
                  <input type="checkbox" checked={activationForm.billed} onChange={e => setActivationForm(f => ({ ...f, billed: e.target.checked }))}
                    className="accent-[#d4a017]" />
                  Billed
                </label>
                {activationForm.billed && (
                  <input type="number" step="0.01" min="0" placeholder="Amount" value={activationForm.billed_amount}
                    onChange={e => setActivationForm(f => ({ ...f, billed_amount: e.target.value }))}
                    className="w-24 px-2 py-1 text-[11px] bg-[#0a0a0a] border border-[#222222] text-gray-200 focus:outline-none" />
                )}
              </div>
              <label className="block">
                <span className="text-[9px] uppercase tracking-wider text-gray-500">Cause / Disposition</span>
                <input type="text" value={activationForm.cause} onChange={e => setActivationForm(f => ({ ...f, cause: e.target.value }))}
                  className="w-full mt-0.5 px-2 py-1.5 text-[11px] bg-[#0a0a0a] border border-[#222222] text-gray-200 focus:outline-none"
                  placeholder="e.g., User error, Equipment malfunction, Weather…" />
              </label>
              <label className="block">
                <span className="text-[9px] uppercase tracking-wider text-gray-500">Notes</span>
                <textarea rows={2} value={activationForm.notes} onChange={e => setActivationForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full mt-0.5 px-2 py-1.5 text-[11px] bg-[#0a0a0a] border border-[#222222] text-gray-200 focus:outline-none resize-none" />
              </label>
              <div className="flex justify-end gap-2 pt-2 border-t border-[#222222]">
                <button type="button" onClick={() => setActivationFormOpen(false)}
                  className="px-3 py-1.5 text-[11px] text-gray-400 border border-[#222222] bg-[#0a0a0a] hover:bg-[#141414] transition-colors">Cancel</button>
                <button type="submit" disabled={submittingActivation}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-[#d4a017] text-black hover:bg-[#b8891a] disabled:opacity-50 transition-colors">
                  {submittingActivation ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Log Activation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
