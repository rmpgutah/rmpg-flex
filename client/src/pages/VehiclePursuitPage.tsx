import React, { useState, useEffect, useCallback } from 'react';
import {
  Navigation, Plus, Search, BarChart3, Eye, X,
  AlertTriangle, CheckCircle, Clock, Car, Activity,
  Shield, Gauge, MapPin, Users as UsersIcon, Siren,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import StatusBadge from '../components/StatusBadge';
import FormModal from '../components/FormModal';
import { usePersistedTab } from '../hooks/usePersistedState';
import { formatDateTime, formatDate } from '../utils/dateUtils';

const REASONS = [
  { value: 'felony_in_progress', label: 'Felony in Progress' },
  { value: 'stolen_vehicle', label: 'Stolen Vehicle' },
  { value: 'reckless_driving', label: 'Reckless Driving' },
  { value: 'dui', label: 'DUI' },
  { value: 'traffic_violation', label: 'Traffic Violation' },
  { value: 'warrant', label: 'Outstanding Warrant' },
  { value: 'other', label: 'Other' },
];

const OUTCOMES = [
  { value: 'apprehension', label: 'Apprehension', color: 'text-green-400' },
  { value: 'terminated_officer', label: 'Terminated (Officer)', color: 'text-yellow-400' },
  { value: 'terminated_supervisor', label: 'Terminated (Supervisor)', color: 'text-yellow-400' },
  { value: 'suspect_escaped', label: 'Suspect Escaped', color: 'text-red-400' },
  { value: 'suspect_crash', label: 'Suspect Crash', color: 'text-orange-400' },
  { value: 'suspect_surrendered', label: 'Suspect Surrendered', color: 'text-green-400' },
  { value: 'other', label: 'Other', color: 'text-gray-400' },
];

const ROAD_CONDITIONS = ['dry', 'wet', 'icy', 'snowy', 'gravel', 'other'];
const WEATHER_CONDITIONS = ['clear', 'rain', 'snow', 'fog', 'wind', 'other'];
const TRAFFIC_DENSITY = ['light', 'moderate', 'heavy'];
const AREA_TYPES = [
  { value: 'urban', label: 'Urban' },
  { value: 'suburban', label: 'Suburban' },
  { value: 'rural', label: 'Rural' },
  { value: 'highway', label: 'Highway' },
  { value: 'residential', label: 'Residential' },
  { value: 'school_zone', label: 'School Zone' },
];

// ─── Modal Component (proper component so hooks are valid) ──────

function PursuitModal({ editItem, personnel, loading, onSave, onClose }: {
  editItem: any; personnel: any[]; loading: boolean;
  onSave: (form: any) => void; onClose: () => void;
}) {
  const [form, setForm] = useState<any>(editItem || {
    pursuit_date: new Date().toISOString().split('T')[0],
    pursuit_time: '', initial_reason: '', start_location: '', end_location: '',
    suspect_name: '', suspect_vehicle_make: '', suspect_vehicle_model: '',
    suspect_vehicle_color: '', suspect_vehicle_plate: '',
    max_speed_mph: '', duration_minutes: '',
    road_conditions: '', weather_conditions: '', traffic_density: '', area_type: '',
    outcome: '', narrative: '',
    pit_maneuver: false, spike_strips: false,
    suspect_injured: false, officer_injured: false, bystander_injured: false,
    property_damage: false, supervisor_notified: false,
  });
  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }));

  return (
    <FormModal isOpen={true} title={editItem ? `Edit ${editItem.pursuit_number}` : 'New Vehicle Pursuit Report'}
      onClose={onClose}
      onSubmit={(e) => { e.preventDefault(); onSave(form); }} isSubmitting={loading}
      submitLabel={editItem ? 'Update' : form.status === 'submitted' ? 'Submit' : 'Save Draft'}>

      <fieldset className="space-y-3 border border-rmpg-600/30 p-3">
        <legend className="text-xs font-bold text-rmpg-300 px-2 uppercase">Pursuit Details</legend>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Date *</span>
            <input type="date" className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.pursuit_date} onChange={e => set('pursuit_date', e.target.value)} required />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Time</span>
            <input type="time" className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.pursuit_time} onChange={e => set('pursuit_time', e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Reason *</span>
            <select className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.initial_reason} onChange={e => set('initial_reason', e.target.value)} required>
              <option value="">Select reason...</option>
              {REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Initiating Officer</span>
            <select className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.initiating_officer_id || ''} onChange={e => set('initiating_officer_id', parseInt(e.target.value) || '')}>
              <option value="">Self</option>
              {personnel.map((p: any) => <option key={p.id} value={p.id}>{p.full_name} ({p.badge_number})</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Start Location *</span>
            <input className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.start_location} onChange={e => set('start_location', e.target.value)} required />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">End Location</span>
            <input className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.end_location || ''} onChange={e => set('end_location', e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Max Speed (mph)</span>
            <input type="number" className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.max_speed_mph || ''} onChange={e => set('max_speed_mph', parseInt(e.target.value) || '')} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Duration (min)</span>
            <input type="number" className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.duration_minutes || ''} onChange={e => set('duration_minutes', parseInt(e.target.value) || '')} />
          </label>
        </div>
      </fieldset>

      <fieldset className="space-y-3 border border-rmpg-600/30 p-3">
        <legend className="text-xs font-bold text-rmpg-300 px-2 uppercase">Suspect Vehicle</legend>
        <div className="grid grid-cols-3 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Make</span>
            <input className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.suspect_vehicle_make || ''} onChange={e => set('suspect_vehicle_make', e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Model</span>
            <input className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.suspect_vehicle_model || ''} onChange={e => set('suspect_vehicle_model', e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Color</span>
            <input className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.suspect_vehicle_color || ''} onChange={e => set('suspect_vehicle_color', e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Plate</span>
            <input className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.suspect_vehicle_plate || ''} onChange={e => set('suspect_vehicle_plate', e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Suspect Name</span>
            <input className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.suspect_name || ''} onChange={e => set('suspect_name', e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Passengers</span>
            <input type="number" className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.passenger_count || 0} onChange={e => set('passenger_count', parseInt(e.target.value) || 0)} />
          </label>
        </div>
      </fieldset>

      <fieldset className="space-y-3 border border-rmpg-600/30 p-3">
        <legend className="text-xs font-bold text-rmpg-300 px-2 uppercase">Conditions & Outcome</legend>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Road</span>
            <select className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.road_conditions || ''} onChange={e => set('road_conditions', e.target.value)}>
              <option value="">—</option>
              {ROAD_CONDITIONS.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Weather</span>
            <select className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.weather_conditions || ''} onChange={e => set('weather_conditions', e.target.value)}>
              <option value="">—</option>
              {WEATHER_CONDITIONS.map(w => <option key={w} value={w}>{w.charAt(0).toUpperCase() + w.slice(1)}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Traffic</span>
            <select className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.traffic_density || ''} onChange={e => set('traffic_density', e.target.value)}>
              <option value="">—</option>
              {TRAFFIC_DENSITY.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-rmpg-400">Area Type</span>
            <select className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.area_type || ''} onChange={e => set('area_type', e.target.value)}>
              <option value="">—</option>
              {AREA_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </label>
          <label className="col-span-2 space-y-1">
            <span className="text-xs text-rmpg-400">Outcome</span>
            <select className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5"
              value={form.outcome || ''} onChange={e => set('outcome', e.target.value)}>
              <option value="">—</option>
              {OUTCOMES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-3 gap-2 pt-1">
          {[
            { key: 'pit_maneuver', label: 'PIT Maneuver' },
            { key: 'spike_strips', label: 'Spike Strips' },
            { key: 'rolling_roadblock', label: 'Rolling Roadblock' },
            { key: 'suspect_injured', label: 'Suspect Injured' },
            { key: 'officer_injured', label: 'Officer Injured' },
            { key: 'bystander_injured', label: 'Bystander Injured' },
            { key: 'property_damage', label: 'Property Damage' },
            { key: 'supervisor_notified', label: 'Supervisor Notified' },
            { key: 'helicopter_assist', label: 'Helicopter Assist' },
          ].map(c => (
            <label key={c.key} className="flex items-center gap-2 text-xs text-rmpg-300">
              <input type="checkbox" checked={!!form[c.key]}
                onChange={e => set(c.key, e.target.checked)}
                className="accent-orange-500" />
              {c.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-3 border border-rmpg-600/30 p-3">
        <legend className="text-xs font-bold text-rmpg-300 px-2 uppercase">Narrative</legend>
        <textarea className="w-full bg-surface-base border border-rmpg-600/30 text-rmpg-200 text-sm px-2 py-1.5 h-24"
          placeholder="Detailed pursuit narrative..."
          value={form.narrative || ''} onChange={e => set('narrative', e.target.value)} />
      </fieldset>

      <div className="flex gap-2 pt-2">
        <button onClick={() => { set('status', 'draft'); }}
          className="text-xs text-rmpg-400 hover:text-rmpg-200 px-2 py-1 border border-rmpg-600/30">
          Save as Draft
        </button>
        <button onClick={() => { set('status', 'submitted'); }}
          className="text-xs text-orange-400 hover:text-orange-300 px-2 py-1 border border-orange-600/30">
          Submit for Review
        </button>
      </div>
    </FormModal>
  );
}

// ─── Main Page Component ─────────────────────────────────────────

export default function VehiclePursuitPage() {
  const [activeTab, setActiveTab] = usePersistedTab('pursuit-tab', 'dashboard');
  const [stats, setStats] = useState<any>(null);
  const [pursuits, setPursuits] = useState<any[]>([]);
  const [personnel, setPersonnel] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(365);

  const fetchStats = useCallback(async () => {
    try {
      const data = await apiFetch(`/api/vehicle-pursuits/stats?days=${days}`);
      setStats(data);
    } catch (e) { console.error('Failed to load pursuit stats:', e); }
  }, [days]);

  const fetchPursuits = useCallback(async () => {
    try {
      let url = '/api/vehicle-pursuits?';
      if (statusFilter) url += `status=${statusFilter}&`;
      if (outcomeFilter) url += `outcome=${outcomeFilter}&`;
      if (search) url += `search=${encodeURIComponent(search)}&`;
      const data = await apiFetch(url);
      setPursuits(data);
    } catch (e) { console.error('Failed to load pursuits:', e); }
  }, [statusFilter, outcomeFilter, search]);

  const fetchPersonnel = useCallback(async () => {
    try { setPersonnel(await apiFetch('/api/personnel')); } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchStats(); fetchPersonnel(); }, [days]);
  useEffect(() => { if (activeTab === 'reports') fetchPursuits(); }, [activeTab, fetchPursuits]);

  const save = async (form: any) => {
    setLoading(true);
    try {
      if (editItem?.id) {
        await apiFetch(`/api/vehicle-pursuits/${editItem.id}`, { method: 'PUT', body: JSON.stringify(form) });
      } else {
        await apiFetch('/api/vehicle-pursuits', { method: 'POST', body: JSON.stringify(form) });
      }
      setShowModal(false);
      setEditItem(null);
      fetchPursuits();
      fetchStats();
    } catch (e: any) { alert(e.message || 'Failed to save pursuit'); }
    finally { setLoading(false); }
  };

  // ─── Dashboard ───────────────────────────────────
  const renderDashboard = () => {
    if (!stats) return <div className="p-6 text-rmpg-400">Loading...</div>;

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-rmpg-200">Pursuit Analytics</h2>
          <select className="bg-surface-raised border border-rmpg-600/30 text-rmpg-300 text-xs px-2 py-1"
            value={days} onChange={e => setDays(parseInt(e.target.value))}>
            <option value={30}>Last 30 Days</option>
            <option value={90}>Last 90 Days</option>
            <option value={365}>Last Year</option>
          </select>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { icon: Navigation, label: 'Total Pursuits', value: stats.total, color: 'text-orange-400' },
            { icon: Gauge, label: 'Avg Max Speed', value: `${stats.avgSpeed} mph`, color: 'text-red-400' },
            { icon: CheckCircle, label: 'Apprehension Rate', value: `${stats.apprehensionRate}%`, color: 'text-green-400' },
            { icon: AlertTriangle, label: 'Injury Rate', value: `${stats.injuryRate}%`, color: stats.injuryRate > 0 ? 'text-red-400' : 'text-green-400' },
          ].map((s, i) => (
            <div key={i} className="bg-surface-raised border border-rmpg-600/30 p-3">
              <s.icon className={`w-5 h-5 ${s.color} mb-1`} />
              <div className="text-xs text-rmpg-400 uppercase">{s.label}</div>
              <div className="text-xl font-bold text-rmpg-100">{s.value}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="bg-surface-raised border border-rmpg-600/30 p-3">
            <Clock className="w-4 h-4 text-yellow-400 mb-1" />
            <div className="text-xs text-rmpg-400">Avg Duration</div>
            <div className="text-lg font-bold text-rmpg-100">{stats.avgDuration} min</div>
          </div>
          <div className="bg-surface-raised border border-rmpg-600/30 p-3">
            <Eye className="w-4 h-4 text-cyan-400 mb-1" />
            <div className="text-xs text-rmpg-400">Pending Review</div>
            <div className="text-lg font-bold text-rmpg-100">{stats.pendingReview}</div>
          </div>
          <div className="bg-surface-raised border border-rmpg-600/30 p-3">
            <Activity className="w-4 h-4 text-blue-400 mb-1" />
            <div className="text-xs text-rmpg-400">This Month</div>
            <div className="text-lg font-bold text-rmpg-100">
              {stats.monthly.length > 0 ? stats.monthly[stats.monthly.length - 1].count : 0}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* By Outcome */}
          <div className="bg-surface-raised border border-rmpg-600/30">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-rmpg-600/30">
              <BarChart3 className="w-4 h-4 text-orange-400" />
              <span className="text-xs font-bold text-rmpg-200 uppercase">Outcomes</span>
            </div>
            <div className="p-3 space-y-2">
              {stats.byOutcome.length === 0 && <div className="text-rmpg-500 text-sm">No data</div>}
              {stats.byOutcome.map((o: any) => {
                const out = OUTCOMES.find(x => x.value === o.outcome);
                return (
                  <div key={o.outcome} className="flex items-center justify-between py-1">
                    <span className={`text-xs ${out?.color || 'text-gray-400'}`}>{out?.label || o.outcome}</span>
                    <span className="text-xs text-rmpg-300 font-bold">{o.count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* By Reason */}
          <div className="bg-surface-raised border border-rmpg-600/30">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-rmpg-600/30">
              <Siren className="w-4 h-4 text-red-400" />
              <span className="text-xs font-bold text-rmpg-200 uppercase">Initiation Reasons</span>
            </div>
            <div className="p-3 space-y-2">
              {stats.byReason.length === 0 && <div className="text-rmpg-500 text-sm">No data</div>}
              {stats.byReason.map((r: any) => {
                const reason = REASONS.find(x => x.value === r.initial_reason);
                return (
                  <div key={r.initial_reason} className="flex items-center justify-between py-1">
                    <span className="text-xs text-rmpg-300">{reason?.label || r.initial_reason}</span>
                    <span className="text-xs text-rmpg-300 font-bold">{r.count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ─── Reports Tab ─────────────────────────────────
  const renderReports = () => (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-rmpg-500" />
          <input className="w-full bg-surface-raised border border-rmpg-600/30 text-rmpg-200 text-sm pl-8 pr-3 py-1.5"
            placeholder="Search pursuits..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="bg-surface-raised border border-rmpg-600/30 text-rmpg-300 text-xs py-1.5 px-2"
          value={outcomeFilter} onChange={e => setOutcomeFilter(e.target.value)}>
          <option value="">All Outcomes</option>
          {OUTCOMES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="bg-surface-raised border border-rmpg-600/30 text-rmpg-300 text-xs py-1.5 px-2"
          value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="submitted">Submitted</option>
          <option value="under_review">Under Review</option>
          <option value="approved">Approved</option>
        </select>
        <button onClick={() => { setEditItem(null); setShowModal(true); }}
          className="flex items-center gap-1 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold px-3 py-1.5">
          <Plus className="w-3.5 h-3.5" /> NEW PURSUIT
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-rmpg-600/30 text-rmpg-400 uppercase">
              <th className="text-left py-2 px-2">Pursuit #</th>
              <th className="text-left py-2 px-2">Date</th>
              <th className="text-left py-2 px-2">Officer</th>
              <th className="text-left py-2 px-2">Reason</th>
              <th className="text-left py-2 px-2">Max Speed</th>
              <th className="text-left py-2 px-2">Outcome</th>
              <th className="text-left py-2 px-2">Status</th>
              <th className="text-left py-2 px-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pursuits.length === 0 && (
              <tr><td colSpan={8} className="py-6 text-center text-rmpg-500">No pursuits found</td></tr>
            )}
            {pursuits.map((p: any) => {
              const out = OUTCOMES.find(o => o.value === p.outcome);
              const reason = REASONS.find(r => r.value === p.initial_reason);
              return (
                <tr key={p.id} className="border-b border-rmpg-700/30 hover:bg-rmpg-700/20">
                  <td className="py-2 px-2 font-mono text-rmpg-200">{p.pursuit_number}</td>
                  <td className="py-2 px-2 text-rmpg-400">{formatDate(p.pursuit_date)}</td>
                  <td className="py-2 px-2 text-rmpg-200">{p.officer_name}</td>
                  <td className="py-2 px-2 text-rmpg-300">{reason?.label || p.initial_reason}</td>
                  <td className="py-2 px-2 text-rmpg-300">{p.max_speed_mph ? `${p.max_speed_mph} mph` : '—'}</td>
                  <td className="py-2 px-2">
                    <span className={out?.color || 'text-gray-500'}>{out?.label || p.outcome || '—'}</span>
                  </td>
                  <td className="py-2 px-2"><StatusBadge status={p.status} /></td>
                  <td className="py-2 px-2">
                    <button onClick={() => { setEditItem(p); setShowModal(true); }}
                      className="p-1 hover:bg-rmpg-600/30 text-rmpg-400 hover:text-rmpg-200" title="Edit">
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
    { id: 'reports', label: 'Reports', icon: Navigation },
  ];

  return (
    <div className="p-2 md:p-4 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Navigation className="w-5 h-5 text-orange-400" />
        <span className="text-sm font-bold text-rmpg-200 uppercase tracking-wider">Vehicle Pursuit Tracking</span>
      </div>

      <div className="flex items-center gap-1 border-b border-rmpg-600/30 pb-1">
        {tabs.map(t => (
          <button key={t.id} onClick={() => { setActiveTab(t.id); setSearch(''); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase transition-colors
              ${activeTab === t.id
                ? 'text-orange-400 border-b-2 border-orange-400 bg-orange-900/10'
                : 'text-rmpg-400 hover:text-rmpg-200'}`}>
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      <div>
        {activeTab === 'dashboard' && renderDashboard()}
        {activeTab === 'reports' && renderReports()}
      </div>

      {showModal && (
        <PursuitModal
          editItem={editItem}
          personnel={personnel}
          loading={loading}
          onSave={save}
          onClose={() => { setShowModal(false); setEditItem(null); }}
        />
      )}
    </div>
  );
}
