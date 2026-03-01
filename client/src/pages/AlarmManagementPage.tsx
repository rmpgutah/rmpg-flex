import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Bell, Plus, Search, AlertTriangle, DollarSign,
  BarChart3, ChevronDown, FileText, Building, Phone,
  Shield, Clock, Filter, X, RefreshCw,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import StatusBadge from '../components/StatusBadge';
import FormModal from '../components/FormModal';
import { usePersistedTab } from '../hooks/usePersistedState';
import { formatDateTime } from '../utils/dateUtils';

type Tab = 'dashboard' | 'permits' | 'responses' | 'fees';

export default function AlarmManagementPage() {
  const [activeTab, setActiveTab] = usePersistedTab<Tab>('alarms-tab', 'dashboard', ['dashboard', 'permits', 'responses', 'fees']);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Title Bar */}
      <PanelTitleBar title="ALARM MANAGEMENT" icon={Bell} />

      {/* Tab Bar */}
      <div className="flex items-center gap-0.5 px-3 py-1.5 bg-surface-raised border-b border-neutral-800">
        {([
          { id: 'dashboard' as Tab, label: 'Dashboard', icon: BarChart3 },
          { id: 'permits' as Tab, label: 'Permits', icon: Shield },
          { id: 'responses' as Tab, label: 'Responses', icon: FileText },
          { id: 'fees' as Tab, label: 'Fees', icon: DollarSign },
        ]).map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide transition-colors ${activeTab === id ? 'bg-brand-600/20 text-brand-400 border-b-2 border-brand-500' : 'text-neutral-500 hover:text-neutral-300'}`}>
            <Icon className="w-3 h-3" /> {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'dashboard' && <DashboardTab />}
        {activeTab === 'permits' && <PermitsTab />}
        {activeTab === 'responses' && <ResponsesTab />}
        {activeTab === 'fees' && <FeesTab />}
      </div>
    </div>
  );
}

// ── Dashboard Tab ──
function DashboardTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/alarms/dashboard').then(setData).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;
  if (!data) return <Error />;

  return (
    <div className="p-4 space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Active Permits" value={data.permits?.active || 0} icon={Shield} color="text-green-400" />
        <StatCard label="False Alarms (30d)" value={data.responses_30d?.false_alarms || 0} icon={AlertTriangle} color="text-red-400" />
        <StatCard label="Legitimate (30d)" value={data.responses_30d?.legitimate || 0} icon={Bell} color="text-blue-400" />
        <StatCard label="Unpaid Fees" value={`$${(data.fees?.unpaid_amount || 0).toLocaleString()}`} icon={DollarSign} color="text-amber-400" />
      </div>

      {/* Top False Alarm Properties */}
      {data.top_false_alarms?.length > 0 && (
        <div className="panel-beveled overflow-hidden">
          <div className="panel-title-bar flex items-center gap-2">
            <AlertTriangle className="w-3 h-3 text-red-400" />
            <span>TOP FALSE ALARM LOCATIONS (90 DAYS)</span>
          </div>
          <div className="p-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[9px] uppercase tracking-wide text-neutral-500 border-b border-neutral-700">
                  <th className="text-left p-1.5">Permit</th>
                  <th className="text-left p-1.5">Property</th>
                  <th className="text-left p-1.5">Alarm Company</th>
                  <th className="text-right p-1.5">False Alarms</th>
                </tr>
              </thead>
              <tbody>
                {data.top_false_alarms.map((r: any, i: number) => (
                  <tr key={i} className="border-b border-neutral-800 hover:bg-neutral-800/50">
                    <td className="p-1.5 font-mono text-brand-400">{r.permit_number}</td>
                    <td className="p-1.5 text-white">{r.property_name}</td>
                    <td className="p-1.5 text-neutral-400">{r.alarm_company}</td>
                    <td className="p-1.5 text-right">
                      <span className={`font-bold ${r.false_alarm_count >= 5 ? 'text-red-400' : r.false_alarm_count >= 3 ? 'text-amber-400' : 'text-neutral-300'}`}>
                        {r.false_alarm_count}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Permits Tab ──
function PermitsTab() {
  const [permits, setPermits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<any>(`/api/alarms/permits?limit=100${search ? `&search=${encodeURIComponent(search)}` : ''}`);
      setPermits(res.data || []);
    } catch {} finally { setLoading(false); }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (formData: Record<string, any>) => {
    await apiFetch('/api/alarms/permits', { method: 'POST', body: JSON.stringify(formData) });
    setShowForm(false);
    load();
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-500" />
          <input className="input-dark h-8 pl-7 text-xs" placeholder="Search permits..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button onClick={() => setShowForm(true)} className="toolbar-btn toolbar-btn-primary text-[10px] flex items-center gap-1">
          <Plus className="w-3 h-3" /> New Permit
        </button>
      </div>

      {loading ? <Loading /> : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[9px] uppercase tracking-wide text-neutral-500 border-b border-neutral-700">
              <th className="text-left p-1.5">Permit #</th>
              <th className="text-left p-1.5">Property</th>
              <th className="text-left p-1.5">Address</th>
              <th className="text-left p-1.5">Alarm Co.</th>
              <th className="text-left p-1.5">Type</th>
              <th className="text-left p-1.5">Holder</th>
              <th className="text-left p-1.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {permits.map(p => (
              <tr key={p.id} className="border-b border-neutral-800 hover:bg-neutral-800/50 cursor-pointer">
                <td className="p-1.5 font-mono text-brand-400">{p.permit_number}</td>
                <td className="p-1.5 text-white font-medium">{p.property_name}</td>
                <td className="p-1.5 text-neutral-400">{p.property_address}</td>
                <td className="p-1.5 text-neutral-400">{p.alarm_company || '—'}</td>
                <td className="p-1.5 text-neutral-400">{p.alarm_type}</td>
                <td className="p-1.5 text-neutral-400">{p.permit_holder_name || '—'}</td>
                <td className="p-1.5"><StatusBadge status={p.status} size="xs" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showForm && (
        <PermitFormModal onSave={handleCreate} onClose={() => setShowForm(false)} />
      )}
    </div>
  );
}

// ── Permit Form Modal (proper children-based FormModal) ──
function PermitFormModal({ onSave, onClose }: {
  onSave: (data: Record<string, any>) => void; onClose: () => void;
}) {
  const [form, setForm] = useState<Record<string, any>>({
    property_name: '', property_address: '', alarm_company: '', alarm_company_phone: '',
    alarm_type: 'burglar', permit_holder_name: '', permit_holder_phone: '', permit_holder_email: '',
    monitoring_account: '', passcode: '', zones: '', notes: '',
  });
  const set = (k: string, v: any) => setForm(p => ({ ...p, [k]: v }));
  const cls = 'w-full bg-surface-base border border-neutral-700 text-neutral-200 text-xs px-2 py-1.5';

  return (
    <FormModal isOpen={true} title="New Alarm Permit" onClose={onClose}
      onSubmit={(e) => { e.preventDefault(); onSave(form); }} maxWidth="lg">
      <fieldset className="space-y-3 border border-neutral-700 p-3">
        <legend className="text-[10px] font-bold text-neutral-400 px-2 uppercase">Property Info</legend>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-[10px] text-neutral-500">Property Name *</span>
            <input className={cls} value={form.property_name} onChange={e => set('property_name', e.target.value)} required />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-neutral-500">Address</span>
            <input className={cls} value={form.property_address} onChange={e => set('property_address', e.target.value)} />
          </label>
        </div>
      </fieldset>
      <fieldset className="space-y-3 border border-neutral-700 p-3">
        <legend className="text-[10px] font-bold text-neutral-400 px-2 uppercase">Alarm System</legend>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-[10px] text-neutral-500">Alarm Company</span>
            <input className={cls} value={form.alarm_company} onChange={e => set('alarm_company', e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-neutral-500">Alarm Co. Phone</span>
            <input className={cls} value={form.alarm_company_phone} onChange={e => set('alarm_company_phone', e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-neutral-500">Alarm Type</span>
            <select className={cls} value={form.alarm_type} onChange={e => set('alarm_type', e.target.value)}>
              <option value="burglar">Burglar</option>
              <option value="fire">Fire</option>
              <option value="panic">Panic</option>
              <option value="medical">Medical</option>
              <option value="hold_up">Hold-Up</option>
              <option value="environmental">Environmental</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-neutral-500">Monitoring Account #</span>
            <input className={cls} value={form.monitoring_account} onChange={e => set('monitoring_account', e.target.value)} />
          </label>
          <label className="space-y-1 col-span-2">
            <span className="text-[10px] text-neutral-500">Passcode / Verbal</span>
            <input className={cls} value={form.passcode} onChange={e => set('passcode', e.target.value)} />
          </label>
        </div>
      </fieldset>
      <fieldset className="space-y-3 border border-neutral-700 p-3">
        <legend className="text-[10px] font-bold text-neutral-400 px-2 uppercase">Permit Holder</legend>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-[10px] text-neutral-500">Name</span>
            <input className={cls} value={form.permit_holder_name} onChange={e => set('permit_holder_name', e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-neutral-500">Phone</span>
            <input className={cls} value={form.permit_holder_phone} onChange={e => set('permit_holder_phone', e.target.value)} />
          </label>
          <label className="space-y-1 col-span-2">
            <span className="text-[10px] text-neutral-500">Email</span>
            <input className={cls} value={form.permit_holder_email} onChange={e => set('permit_holder_email', e.target.value)} />
          </label>
        </div>
      </fieldset>
      <label className="space-y-1">
        <span className="text-[10px] text-neutral-500">Zone Info</span>
        <textarea className={`${cls} h-12`} value={form.zones} onChange={e => set('zones', e.target.value)} />
      </label>
      <label className="space-y-1">
        <span className="text-[10px] text-neutral-500">Notes</span>
        <textarea className={`${cls} h-12`} value={form.notes} onChange={e => set('notes', e.target.value)} />
      </label>
    </FormModal>
  );
}

// ── Responses Tab ──
function ResponsesTab() {
  const [responses, setResponses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<any>('/api/alarms/responses?limit=100')
      .then(r => setResponses(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-4">
      {loading ? <Loading /> : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[9px] uppercase tracking-wide text-neutral-500 border-b border-neutral-700">
              <th className="text-left p-1.5">Response #</th>
              <th className="text-left p-1.5">Date</th>
              <th className="text-left p-1.5">Permit</th>
              <th className="text-left p-1.5">Property</th>
              <th className="text-left p-1.5">Type</th>
              <th className="text-left p-1.5">Officer</th>
              <th className="text-left p-1.5">False?</th>
              <th className="text-left p-1.5">Disposition</th>
            </tr>
          </thead>
          <tbody>
            {responses.map(r => (
              <tr key={r.id} className="border-b border-neutral-800 hover:bg-neutral-800/50">
                <td className="p-1.5 font-mono text-brand-400">{r.response_number}</td>
                <td className="p-1.5 text-neutral-400">{formatDateTime(r.response_date)}</td>
                <td className="p-1.5 text-neutral-400">{r.permit_number || '—'}</td>
                <td className="p-1.5 text-white">{r.property_name || '—'}</td>
                <td className="p-1.5 text-neutral-400">{r.alarm_type}</td>
                <td className="p-1.5 text-neutral-400">{r.officer_name || '—'}</td>
                <td className="p-1.5">
                  {r.is_false_alarm ? (
                    <span className="text-[9px] px-1.5 py-0.5 bg-red-900/50 text-red-300 font-bold">FALSE</span>
                  ) : (
                    <span className="text-[9px] px-1.5 py-0.5 bg-green-900/50 text-green-300 font-bold">LEGIT</span>
                  )}
                </td>
                <td className="p-1.5 text-neutral-400">{r.disposition || '—'}</td>
              </tr>
            ))}
            {responses.length === 0 && (
              <tr><td colSpan={8} className="p-4 text-center text-neutral-500">No alarm responses recorded</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Fees Tab ──
function FeesTab() {
  const [fees, setFees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<any>('/api/alarms/fees?limit=100')
      .then(r => setFees(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-4">
      {loading ? <Loading /> : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[9px] uppercase tracking-wide text-neutral-500 border-b border-neutral-700">
              <th className="text-left p-1.5">Fee #</th>
              <th className="text-left p-1.5">Permit</th>
              <th className="text-left p-1.5">Property</th>
              <th className="text-left p-1.5">Holder</th>
              <th className="text-left p-1.5">Reason</th>
              <th className="text-right p-1.5">Amount</th>
              <th className="text-left p-1.5">Status</th>
              <th className="text-left p-1.5">Assessed</th>
            </tr>
          </thead>
          <tbody>
            {fees.map(f => (
              <tr key={f.id} className="border-b border-neutral-800 hover:bg-neutral-800/50">
                <td className="p-1.5 font-mono text-brand-400">{f.fee_number}</td>
                <td className="p-1.5 text-neutral-400">{f.permit_number || '—'}</td>
                <td className="p-1.5 text-white">{f.property_name || '—'}</td>
                <td className="p-1.5 text-neutral-400">{f.permit_holder_name || '—'}</td>
                <td className="p-1.5 text-neutral-400">{f.reason || '—'}</td>
                <td className="p-1.5 text-right font-bold text-amber-400">${(f.fee_amount || 0).toFixed(2)}</td>
                <td className="p-1.5"><StatusBadge status={f.status} size="xs" /></td>
                <td className="p-1.5 text-neutral-500">{f.assessed_date}</td>
              </tr>
            ))}
            {fees.length === 0 && (
              <tr><td colSpan={8} className="p-4 text-center text-neutral-500">No alarm fees assessed</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Shared Components ──
function StatCard({ label, value, icon: Icon, color }: { label: string; value: any; icon: any; color: string }) {
  return (
    <div className="panel-beveled p-3 text-center">
      <Icon className={`w-4 h-4 mx-auto mb-1 ${color}`} />
      <div className="text-xl font-bold text-white">{value}</div>
      <div className="text-[9px] uppercase tracking-wide text-neutral-500">{label}</div>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="w-5 h-5 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
    </div>
  );
}

function Error() {
  return (
    <div className="flex items-center justify-center py-12 text-red-400 text-xs">
      <AlertTriangle className="w-4 h-4 mr-2" /> Failed to load data
    </div>
  );
}
