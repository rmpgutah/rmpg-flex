import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  UserCheck, Plus, Search, LogOut, Clock, Building, Car,
  BarChart3, Users, UserPlus, Filter, RefreshCw, Badge,
  AlertTriangle, CheckCircle, ChevronDown,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import StatusBadge from '../components/StatusBadge';
import FormModal from '../components/FormModal';
import { usePersistedTab } from '../hooks/usePersistedState';
import { formatDateTime, formatShortTime } from '../utils/dateUtils';

type Tab = 'active' | 'log' | 'stats';

export default function VisitorLogPage() {
  const [activeTab, setActiveTab] = usePersistedTab<Tab>('visitors-tab', 'active', ['active', 'log', 'stats']);
  const [properties, setProperties] = useState<any[]>([]);

  useEffect(() => {
    apiFetch<any>('/api/records/properties?limit=200').then(r => setProperties(r.data || [])).catch(() => {});
  }, []);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <PanelTitleBar title="VISITOR / ACCESS LOG" icon={UserCheck} />

      {/* Tab Bar */}
      <div className="flex items-center gap-0.5 px-3 py-1.5 bg-surface-raised border-b border-neutral-800">
        {([
          { id: 'active' as Tab, label: 'Active Visitors', icon: Users },
          { id: 'log' as Tab, label: 'Visitor Log', icon: Clock },
          { id: 'stats' as Tab, label: 'Statistics', icon: BarChart3 },
        ]).map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide transition-colors ${activeTab === id ? 'bg-brand-600/20 text-brand-400 border-b-2 border-brand-500' : 'text-neutral-500 hover:text-neutral-300'}`}>
            <Icon className="w-3 h-3" /> {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {activeTab === 'active' && <ActiveVisitorsTab properties={properties} />}
        {activeTab === 'log' && <VisitorLogTab properties={properties} />}
        {activeTab === 'stats' && <StatsTab />}
      </div>
    </div>
  );
}

// ── Active Visitors Tab ──
function ActiveVisitorsTab({ properties }: { properties: any[] }) {
  const [visitors, setVisitors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSignIn, setShowSignIn] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<any>('/api/visitors/active');
      setVisitors(res.data || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  const handleSignIn = async (formData: Record<string, any>) => {
    await apiFetch('/api/visitors', { method: 'POST', body: JSON.stringify(formData) });
    setShowSignIn(false);
    load();
  };

  const handleSignOut = async (id: number) => {
    await apiFetch(`/api/visitors/${id}/sign-out`, { method: 'POST', body: JSON.stringify({}) });
    load();
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-neutral-400">
          <Users className="w-3.5 h-3.5 inline mr-1" />
          <span className="font-bold text-white">{visitors.length}</span> currently signed in
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="toolbar-btn text-[10px] flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
          <button onClick={() => setShowSignIn(true)} className="toolbar-btn toolbar-btn-primary text-[10px] flex items-center gap-1">
            <UserPlus className="w-3 h-3" /> Sign In Visitor
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="w-5 h-5 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
        </div>
      ) : visitors.length === 0 ? (
        <div className="text-center py-12 text-neutral-500">
          <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-500" />
          <p className="text-sm text-green-400 font-medium">No Active Visitors</p>
          <p className="text-xs">All visitors have been signed out</p>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {visitors.map(v => (
            <div key={v.id} className="panel-beveled p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-white text-sm">{v.visitor_name}</div>
                <span className="text-[9px] px-1.5 py-0.5 bg-green-900/50 text-green-300 border border-green-800 font-bold">
                  IN
                </span>
              </div>

              {v.visitor_company && (
                <div className="text-xs text-neutral-400 flex items-center gap-1">
                  <Building className="w-3 h-3" /> {v.visitor_company}
                </div>
              )}
              {v.property_name && (
                <div className="text-xs text-neutral-400 flex items-center gap-1">
                  <Building className="w-3 h-3 text-brand-400" /> {v.property_name}
                </div>
              )}
              {v.purpose && (
                <div className="text-xs text-neutral-500">Purpose: {v.purpose}</div>
              )}
              {v.vehicle_plate && (
                <div className="text-xs text-neutral-400 flex items-center gap-1">
                  <Car className="w-3 h-3" /> {v.vehicle_plate} {v.vehicle_description && `— ${v.vehicle_description}`}
                </div>
              )}
              {v.badge_number && (
                <div className="text-xs text-neutral-400 flex items-center gap-1">
                  <Badge className="w-3 h-3" /> Badge: {v.badge_number}
                </div>
              )}

              <div className="flex items-center justify-between pt-1 border-t border-neutral-700">
                <div className="text-[10px] text-neutral-500 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> In: {formatShortTime(v.sign_in_time)}
                </div>
                <button onClick={() => handleSignOut(v.id)}
                  className="toolbar-btn text-[10px] flex items-center gap-1 text-amber-400 hover:text-amber-300">
                  <LogOut className="w-3 h-3" /> Sign Out
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showSignIn && (
        <SignInFormModal properties={properties} onSave={handleSignIn} onClose={() => setShowSignIn(false)} />
      )}
    </div>
  );
}

// ── Sign-In Form Modal (proper children-based FormModal) ──
function SignInFormModal({ properties, onSave, onClose }: {
  properties: any[]; onSave: (data: Record<string, any>) => void; onClose: () => void;
}) {
  const [form, setForm] = useState<Record<string, any>>({
    visitor_name: '', property_id: '', visitor_company: '', visitor_type: 'visitor',
    purpose: '', destination: '', vehicle_plate: '', vehicle_description: '',
    badge_number: '', escort_name: '', id_type: '', id_number: '',
    id_verified: false, visitor_phone: '', notes: '',
  });
  const set = (k: string, v: any) => setForm(p => ({ ...p, [k]: v }));
  const cls = 'w-full bg-surface-base border border-neutral-700 text-neutral-200 text-xs px-2 py-1.5';

  return (
    <FormModal isOpen={true} title="Sign In Visitor" onClose={onClose}
      onSubmit={(e) => { e.preventDefault(); onSave(form); }} maxWidth="lg">
      <fieldset className="space-y-3 border border-neutral-700 p-3">
        <legend className="text-[10px] font-bold text-neutral-400 px-2 uppercase">Visitor Info</legend>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-[10px] text-neutral-500">Visitor Name *</span>
            <input className={cls} value={form.visitor_name} onChange={e => set('visitor_name', e.target.value)} required />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-neutral-500">Property *</span>
            <select className={cls} value={form.property_id} onChange={e => set('property_id', e.target.value)} required>
              <option value="">Select property...</option>
              {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-neutral-500">Company / Organization</span>
            <input className={cls} value={form.visitor_company} onChange={e => set('visitor_company', e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-neutral-500">Visitor Type</span>
            <select className={cls} value={form.visitor_type} onChange={e => set('visitor_type', e.target.value)}>
              {['visitor','contractor','delivery','vendor','employee','government','emergency','other'].map(t =>
                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
              )}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-neutral-500">Purpose of Visit</span>
            <input className={cls} value={form.purpose} onChange={e => set('purpose', e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-neutral-500">Destination / Department</span>
            <input className={cls} value={form.destination} onChange={e => set('destination', e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-neutral-500">Phone</span>
            <input className={cls} value={form.visitor_phone} onChange={e => set('visitor_phone', e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-neutral-500">Escort Name</span>
            <input className={cls} value={form.escort_name} onChange={e => set('escort_name', e.target.value)} />
          </label>
        </div>
      </fieldset>
      <fieldset className="space-y-3 border border-neutral-700 p-3">
        <legend className="text-[10px] font-bold text-neutral-400 px-2 uppercase">Vehicle & Badge</legend>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-[10px] text-neutral-500">Vehicle Plate</span>
            <input className={cls} value={form.vehicle_plate} onChange={e => set('vehicle_plate', e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-neutral-500">Vehicle Description</span>
            <input className={cls} value={form.vehicle_description} onChange={e => set('vehicle_description', e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-neutral-500">Badge / Pass Number</span>
            <input className={cls} value={form.badge_number} onChange={e => set('badge_number', e.target.value)} />
          </label>
        </div>
      </fieldset>
      <fieldset className="space-y-3 border border-neutral-700 p-3">
        <legend className="text-[10px] font-bold text-neutral-400 px-2 uppercase">Identification</legend>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-[10px] text-neutral-500">ID Type</span>
            <select className={cls} value={form.id_type} onChange={e => set('id_type', e.target.value)}>
              <option value="">None</option>
              <option value="drivers_license">Driver's License</option>
              <option value="state_id">State ID</option>
              <option value="passport">Passport</option>
              <option value="military_id">Military ID</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-neutral-500">ID Number</span>
            <input className={cls} value={form.id_number} onChange={e => set('id_number', e.target.value)} />
          </label>
          <label className="flex items-center gap-2 col-span-2">
            <input type="checkbox" checked={form.id_verified}
              onChange={e => set('id_verified', e.target.checked)} className="accent-brand-500" />
            <span className="text-xs text-neutral-400">ID Verified</span>
          </label>
        </div>
      </fieldset>
      <label className="space-y-1">
        <span className="text-[10px] text-neutral-500">Notes</span>
        <textarea className={`${cls} h-16`} value={form.notes} onChange={e => set('notes', e.target.value)} />
      </label>
    </FormModal>
  );
}

// ── Visitor Log Tab ──
function VisitorLogTab({ properties }: { properties: any[] }) {
  const [visitors, setVisitors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [propertyFilter, setPropertyFilter] = useState('');

  const load = useCallback(async () => {
    let url = '/api/visitors?limit=100';
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (propertyFilter) url += `&property_id=${propertyFilter}`;
    try {
      const res = await apiFetch<any>(url);
      setVisitors(res.data || []);
    } catch {} finally { setLoading(false); }
  }, [search, propertyFilter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-500" />
          <input className="input-dark h-8 pl-7 text-xs" placeholder="Search visitors..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input-dark h-8 text-xs w-48" value={propertyFilter}
          onChange={e => setPropertyFilter(e.target.value)}>
          <option value="">All Properties</option>
          {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="w-5 h-5 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
        </div>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[9px] uppercase tracking-wide text-neutral-500 border-b border-neutral-700">
              <th className="text-left p-1.5">Entry #</th>
              <th className="text-left p-1.5">Visitor</th>
              <th className="text-left p-1.5">Company</th>
              <th className="text-left p-1.5">Property</th>
              <th className="text-left p-1.5">Type</th>
              <th className="text-left p-1.5">Purpose</th>
              <th className="text-left p-1.5">Vehicle</th>
              <th className="text-left p-1.5">Sign In</th>
              <th className="text-left p-1.5">Sign Out</th>
              <th className="text-left p-1.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {visitors.map(v => (
              <tr key={v.id} className="border-b border-neutral-800 hover:bg-neutral-800/50">
                <td className="p-1.5 font-mono text-brand-400">{v.entry_number}</td>
                <td className="p-1.5 text-white font-medium">{v.visitor_name}</td>
                <td className="p-1.5 text-neutral-400">{v.visitor_company || '—'}</td>
                <td className="p-1.5 text-neutral-400">{v.property_name || '—'}</td>
                <td className="p-1.5 text-neutral-400">{v.visitor_type}</td>
                <td className="p-1.5 text-neutral-400 truncate max-w-[120px]">{v.purpose || '—'}</td>
                <td className="p-1.5 text-neutral-400">{v.vehicle_plate || '—'}</td>
                <td className="p-1.5 text-neutral-400">{formatShortTime(v.sign_in_time)}</td>
                <td className="p-1.5 text-neutral-400">{v.sign_out_time ? formatShortTime(v.sign_out_time) : '—'}</td>
                <td className="p-1.5">
                  {v.sign_out_time ? (
                    <span className="text-[9px] px-1.5 py-0.5 bg-neutral-700 text-neutral-300">OUT</span>
                  ) : (
                    <span className="text-[9px] px-1.5 py-0.5 bg-green-900/50 text-green-300 font-bold">IN</span>
                  )}
                </td>
              </tr>
            ))}
            {visitors.length === 0 && (
              <tr><td colSpan={10} className="p-4 text-center text-neutral-500">No visitor records found</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Stats Tab ──
function StatsTab() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<any>('/api/visitors/stats?days=30')
      .then(setStats).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center py-12">
      <div className="w-5 h-5 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
    </div>
  );

  if (!stats) return (
    <div className="flex items-center justify-center py-12 text-red-400 text-xs">
      <AlertTriangle className="w-4 h-4 mr-2" /> Failed to load stats
    </div>
  );

  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Total Visits (30d)', value: stats.stats?.total_visitors || 0, color: 'text-blue-400' },
          { label: 'Unique Visitors', value: stats.stats?.unique_visitors || 0, color: 'text-green-400' },
          { label: 'Currently In', value: stats.stats?.currently_signed_in || 0, color: 'text-amber-400' },
          { label: 'Companies', value: stats.stats?.unique_companies || 0, color: 'text-cyan-400' },
          { label: 'Properties', value: stats.stats?.properties_visited || 0, color: 'text-purple-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="panel-beveled p-3 text-center">
            <div className={`text-xl font-bold ${color}`}>{value}</div>
            <div className="text-[9px] uppercase tracking-wide text-neutral-500">{label}</div>
          </div>
        ))}
      </div>

      {/* By Type */}
      {stats.by_type?.length > 0 && (
        <div className="panel-beveled overflow-hidden">
          <div className="panel-title-bar flex items-center gap-2">
            <Filter className="w-3 h-3" /><span>VISITS BY TYPE</span>
          </div>
          <div className="p-3 flex flex-wrap gap-2">
            {stats.by_type.map((t: any) => (
              <div key={t.visitor_type} className="px-3 py-1.5 bg-neutral-800 text-xs">
                <span className="text-neutral-400">{t.visitor_type}:</span>
                <span className="ml-1 font-bold text-white">{t.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* By Property */}
      {stats.by_property?.length > 0 && (
        <div className="panel-beveled overflow-hidden">
          <div className="panel-title-bar flex items-center gap-2">
            <Building className="w-3 h-3" /><span>TOP PROPERTIES</span>
          </div>
          <div className="p-2">
            {stats.by_property.map((p: any, i: number) => (
              <div key={i} className="flex items-center justify-between px-2 py-1.5 text-xs border-b border-neutral-800 last:border-b-0">
                <span className="text-white">{p.property_name || 'Unknown'}</span>
                <span className="font-bold text-brand-400">{p.visit_count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
