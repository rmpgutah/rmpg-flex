import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield, Plus, Search, BarChart3, FileText, Eye,
  ChevronDown, X, RefreshCw, CheckCircle, Clock,
  Users, AlertTriangle, Scale, UserX, Flag,
  Filter, ArrowRight, Gavel,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import StatusBadge from '../components/StatusBadge';
import { usePersistedTab } from '../hooks/usePersistedState';
import { formatDateTime, formatDate } from '../utils/dateUtils';

const CATEGORIES = [
  { value: 'excessive_force', label: 'Excessive Force', color: 'text-red-400' },
  { value: 'misconduct', label: 'Misconduct', color: 'text-orange-400' },
  { value: 'discourtesy', label: 'Discourtesy', color: 'text-yellow-400' },
  { value: 'neglect_of_duty', label: 'Neglect of Duty', color: 'text-amber-400' },
  { value: 'policy_violation', label: 'Policy Violation', color: 'text-blue-400' },
  { value: 'criminal_conduct', label: 'Criminal Conduct', color: 'text-red-600' },
  { value: 'discrimination', label: 'Discrimination', color: 'text-purple-400' },
  { value: 'harassment', label: 'Harassment', color: 'text-pink-400' },
  { value: 'truthfulness', label: 'Truthfulness', color: 'text-cyan-400' },
  { value: 'other', label: 'Other', color: 'text-neutral-400' },
];

const SEVERITIES = [
  { value: 'minor', label: 'Minor', color: 'bg-green-900/30 text-green-400' },
  { value: 'moderate', label: 'Moderate', color: 'bg-yellow-900/30 text-yellow-400' },
  { value: 'serious', label: 'Serious', color: 'bg-orange-900/30 text-orange-400' },
  { value: 'critical', label: 'Critical', color: 'bg-red-900/30 text-red-400' },
];

const FINDINGS = [
  { value: 'sustained', label: 'Sustained', desc: 'Allegation supported by evidence', color: 'text-red-400' },
  { value: 'not_sustained', label: 'Not Sustained', desc: 'Insufficient evidence', color: 'text-yellow-400' },
  { value: 'exonerated', label: 'Exonerated', desc: 'Actions were lawful and proper', color: 'text-green-400' },
  { value: 'unfounded', label: 'Unfounded', desc: 'Allegation did not occur', color: 'text-blue-400' },
  { value: 'policy_failure', label: 'Policy Failure', desc: 'Policy was inadequate', color: 'text-purple-400' },
];

const DISCIPLINES = [
  { value: 'none', label: 'None' }, { value: 'verbal_warning', label: 'Verbal Warning' },
  { value: 'written_reprimand', label: 'Written Reprimand' }, { value: 'suspension', label: 'Suspension' },
  { value: 'demotion', label: 'Demotion' }, { value: 'termination', label: 'Termination' },
  { value: 'training_required', label: 'Training Required' }, { value: 'counseling', label: 'Counseling' },
];

type Tab = 'dashboard' | 'cases' | 'active';

export default function InternalAffairsPage() {
  const [activeTab, setActiveTab] = usePersistedTab<Tab>('ia-tab', 'dashboard', ['dashboard', 'cases', 'active']);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <PanelTitleBar title="INTERNAL AFFAIRS" icon={Scale} />
      <div className="flex items-center gap-0.5 px-3 py-1.5 bg-surface-raised border-b border-neutral-800">
        {([
          { id: 'dashboard' as Tab, label: 'Dashboard', icon: BarChart3 },
          { id: 'cases' as Tab, label: 'All Cases', icon: FileText },
          { id: 'active' as Tab, label: 'Active Investigations', icon: Search },
        ]).map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide transition-colors ${activeTab === id ? 'bg-brand-600/20 text-brand-400 border-b-2 border-brand-500' : 'text-neutral-500 hover:text-neutral-300'}`}>
            <Icon className="w-3 h-3" /> {label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto">
        {activeTab === 'dashboard' && <DashboardTab />}
        {activeTab === 'cases' && <CasesTab />}
        {activeTab === 'active' && <ActiveTab />}
      </div>
    </div>
  );
}

// ── Dashboard ──
function DashboardTab() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(365);

  useEffect(() => {
    setLoading(true);
    apiFetch(`/api/internal-affairs/stats?days=${days}`).then(setStats).catch(() => {}).finally(() => setLoading(false));
  }, [days]);

  if (loading) return <div className="p-8 text-center text-neutral-500">Loading...</div>;
  if (!stats) return <div className="p-8 text-center text-red-400">Failed to load statistics</div>;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-neutral-300 uppercase tracking-wide">Internal Affairs Overview</h2>
        <select value={days} onChange={(e) => setDays(+e.target.value)}
          className="bg-neutral-800 border border-neutral-700 text-xs text-neutral-300 px-2 py-1 rounded">
          <option value={30}>Last 30 Days</option><option value={90}>Last 90 Days</option><option value={365}>Last Year</option>
        </select>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Complaints" value={stats.total} icon={FileText} color="text-blue-400" />
        <StatCard label="Open Cases" value={stats.openCases} icon={Clock} color="text-amber-400" />
        <StatCard label="Sustained Rate" value={`${stats.sustainedRate}%`} icon={Flag} color="text-red-400" />
        <StatCard label="Avg Resolution" value={`${stats.avgResolutionDays}d`} icon={Scale} color="text-green-400" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* By Category */}
        <div className="panel-beveled overflow-hidden">
          <div className="panel-title-bar flex items-center gap-2"><AlertTriangle className="w-3 h-3 text-orange-400" /><span>BY CATEGORY</span></div>
          <div className="p-3 space-y-2">
            {CATEGORIES.map(cat => {
              const item = stats.byCategory?.find((c: any) => c.category === cat.value);
              const count = item?.count || 0;
              const pct = stats.total > 0 ? Math.round(100 * count / stats.total) : 0;
              if (count === 0) return null;
              return (
                <div key={cat.value} className="flex items-center gap-2 text-xs">
                  <span className={`w-28 truncate ${cat.color}`}>{cat.label}</span>
                  <div className="flex-1 bg-neutral-800 rounded-full h-2.5 overflow-hidden">
                    <div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-neutral-400 w-6 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* By Finding */}
        <div className="panel-beveled overflow-hidden">
          <div className="panel-title-bar flex items-center gap-2"><Gavel className="w-3 h-3 text-purple-400" /><span>FINDINGS</span></div>
          <div className="p-3 space-y-2">
            {FINDINGS.map(f => {
              const item = stats.byFinding?.find((x: any) => x.finding === f.value);
              const count = item?.count || 0;
              return (
                <div key={f.value} className="flex items-center justify-between text-xs py-1">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${f.color.replace('text-', 'bg-')}`} />
                    <span className={f.color}>{f.label}</span>
                  </div>
                  <span className="font-mono text-neutral-400">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Officers with most complaints */}
      {stats.byOfficer?.length > 0 && (
        <div className="panel-beveled overflow-hidden">
          <div className="panel-title-bar flex items-center gap-2"><UserX className="w-3 h-3 text-red-400" /><span>OFFICERS WITH MOST COMPLAINTS</span></div>
          <div className="p-2">
            <table className="w-full text-xs">
              <thead><tr className="text-neutral-500 border-b border-neutral-800">
                <th className="text-left py-1 px-2">Officer</th><th className="text-left py-1 px-2">Badge</th><th className="text-right py-1 px-2">Complaints</th>
              </tr></thead>
              <tbody>{stats.byOfficer.map((o: any, i: number) => (
                <tr key={i} className="border-b border-neutral-800/50 hover:bg-neutral-800/30">
                  <td className="py-1.5 px-2 text-neutral-300">{o.full_name}</td>
                  <td className="py-1.5 px-2 text-neutral-500">{o.badge_number}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-neutral-300">{o.count}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── All Cases ──
function CasesTab() {
  const [cases, setCases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editCase, setEditCase] = useState<any>(null);
  const [officers, setOfficers] = useState<any[]>([]);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (filterCategory) params.set('category', filterCategory);
    if (filterStatus) params.set('status', filterStatus);
    apiFetch(`/api/internal-affairs?${params}`).then(setCases).catch(() => {}).finally(() => setLoading(false));
  }, [search, filterCategory, filterStatus]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { apiFetch('/api/personnel').then(setOfficers).catch(() => {}); }, []);

  const handleSave = async (data: any) => {
    if (editCase?.id) {
      await apiFetch(`/api/internal-affairs/${editCase.id}`, { method: 'PUT', body: JSON.stringify(data) });
    } else {
      await apiFetch('/api/internal-affairs', { method: 'POST', body: JSON.stringify(data) });
    }
    setShowForm(false);
    setEditCase(null);
    load();
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-neutral-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search cases..."
            className="w-full bg-neutral-800 border border-neutral-700 rounded text-xs text-neutral-300 pl-7 pr-2 py-1.5" />
        </div>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
          className="bg-neutral-800 border border-neutral-700 text-xs text-neutral-300 px-2 py-1.5 rounded">
          <option value="">All Categories</option>
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="bg-neutral-800 border border-neutral-700 text-xs text-neutral-300 px-2 py-1.5 rounded">
          <option value="">All Statuses</option>
          <option value="received">Received</option><option value="assigned">Assigned</option>
          <option value="investigating">Investigating</option><option value="review">In Review</option>
          <option value="sustained">Sustained</option><option value="not_sustained">Not Sustained</option>
          <option value="exonerated">Exonerated</option><option value="unfounded">Unfounded</option>
          <option value="closed">Closed</option><option value="withdrawn">Withdrawn</option>
        </select>
        <button onClick={() => { setEditCase(null); setShowForm(true); }}
          className="flex items-center gap-1.5 bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold px-3 py-1.5 rounded">
          <Plus className="w-3 h-3" /> NEW COMPLAINT
        </button>
      </div>

      {loading ? <div className="text-center text-neutral-500 py-8">Loading...</div> : (
        <div className="panel-beveled overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-neutral-500 border-b border-neutral-700 text-left">
                <th className="py-2 px-3">Case #</th><th className="py-2 px-3">Date</th>
                <th className="py-2 px-3">Category</th><th className="py-2 px-3">Severity</th>
                <th className="py-2 px-3">Officer</th><th className="py-2 px-3">Status</th>
                <th className="py-2 px-3">Finding</th>
              </tr>
            </thead>
            <tbody>
              {cases.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-neutral-500">No cases found</td></tr>
              ) : cases.map(c => {
                const cat = CATEGORIES.find(x => x.value === c.category);
                const sev = SEVERITIES.find(x => x.value === c.severity);
                const finding = FINDINGS.find(x => x.value === c.finding);
                return (
                  <tr key={c.id} className="border-b border-neutral-800/50 hover:bg-neutral-800/30 cursor-pointer"
                    onClick={() => { setEditCase(c); setShowForm(true); }}>
                    <td className="py-2 px-3 font-mono text-brand-400">{c.case_number}</td>
                    <td className="py-2 px-3 text-neutral-400">{formatDate(c.incident_date || c.created_at)}</td>
                    <td className="py-2 px-3"><span className={cat?.color || ''}>{cat?.label || c.category}</span></td>
                    <td className="py-2 px-3"><span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${sev?.color || ''}`}>{c.severity}</span></td>
                    <td className="py-2 px-3 text-neutral-300">{c.accused_officer_name || c.officer_name || '—'}</td>
                    <td className="py-2 px-3"><StatusBadge status={c.status} /></td>
                    <td className="py-2 px-3">{finding ? <span className={finding.color}>{finding.label}</span> : <span className="text-neutral-600">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm && <IAFormModal complaint={editCase} officers={officers} onSave={handleSave}
        onClose={() => { setShowForm(false); setEditCase(null); }} />}
    </div>
  );
}

// ── Active Investigations ──
function ActiveTab() {
  const [cases, setCases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiFetch('/api/internal-affairs?status=assigned'),
      apiFetch('/api/internal-affairs?status=investigating'),
      apiFetch('/api/internal-affairs?status=review'),
    ]).then(([a, b, c]) => setCases([...a, ...b, ...c]))
      .catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-center text-neutral-500">Loading...</div>;

  return (
    <div className="p-4 space-y-3">
      <h2 className="text-sm font-bold text-neutral-300 uppercase tracking-wide">Active Investigations ({cases.length})</h2>
      {cases.length === 0 ? (
        <div className="panel-beveled p-8 text-center text-neutral-500 text-xs">
          <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-500/50" />
          No active investigations
        </div>
      ) : (
        <div className="space-y-2">
          {cases.map(c => {
            const cat = CATEGORIES.find(x => x.value === c.category);
            const sev = SEVERITIES.find(x => x.value === c.severity);
            const daysOpen = Math.round((Date.now() - new Date(c.created_at).getTime()) / 86400000);
            return (
              <div key={c.id} className="panel-beveled p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-brand-400 text-xs">{c.case_number}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${sev?.color || ''}`}>{c.severity}</span>
                    <span className={`text-xs ${cat?.color || ''}`}>{cat?.label}</span>
                    <StatusBadge status={c.status} />
                  </div>
                  <div className="flex items-center gap-2 text-xs text-neutral-500">
                    <Clock className="w-3 h-3" />
                    <span>{daysOpen} days open</span>
                  </div>
                </div>
                <div className="mt-2 text-xs text-neutral-400">
                  <span className="text-neutral-500">Officer:</span> {c.accused_officer_name || '—'}
                  {c.investigator_name && <> • <span className="text-neutral-500">Investigator:</span> {c.investigator_name}</>}
                </div>
                <p className="text-xs text-neutral-500 mt-1 line-clamp-2">{c.incident_description}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Form Modal ──
function IAFormModal({ complaint, officers, onSave, onClose }: {
  complaint: any; officers: any[]; onSave: (data: any) => void; onClose: () => void;
}) {
  const [form, setForm] = useState<any>(complaint || {
    complaint_type: 'citizen', category: 'misconduct', severity: 'minor',
    incident_description: '', complainant_anonymous: false,
  });

  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }));

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-neutral-900 border border-neutral-700 rounded-lg max-w-3xl w-full max-h-[85vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-3 border-b border-neutral-800">
          <span className="text-sm font-bold text-neutral-200">{complaint?.id ? `EDIT ${complaint.case_number}` : 'NEW COMPLAINT'}</span>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-4 text-xs">
          {/* Complaint Type */}
          <fieldset className="border border-neutral-800 rounded p-3 space-y-3">
            <legend className="text-neutral-500 font-bold uppercase px-1 text-[10px]">Complaint Details</legend>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="text-neutral-500 block mb-1">Type *</label>
                <select value={form.complaint_type} onChange={e => set('complaint_type', e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded text-neutral-300 px-2 py-1.5">
                  <option value="citizen">Citizen Complaint</option><option value="internal">Internal</option>
                  <option value="anonymous">Anonymous</option><option value="third_party">Third Party</option>
                </select></div>
              <div><label className="text-neutral-500 block mb-1">Category *</label>
                <select value={form.category} onChange={e => set('category', e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded text-neutral-300 px-2 py-1.5">
                  {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select></div>
              <div><label className="text-neutral-500 block mb-1">Severity *</label>
                <select value={form.severity} onChange={e => set('severity', e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded text-neutral-300 px-2 py-1.5">
                  {SEVERITIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-neutral-500 block mb-1">Incident Date</label>
                <input type="date" value={form.incident_date || ''} onChange={e => set('incident_date', e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded text-neutral-300 px-2 py-1.5" /></div>
              <div><label className="text-neutral-500 block mb-1">Location</label>
                <input value={form.incident_location || ''} onChange={e => set('incident_location', e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded text-neutral-300 px-2 py-1.5" /></div>
            </div>
            <div><label className="text-neutral-500 block mb-1">Description *</label>
              <textarea value={form.incident_description || ''} onChange={e => set('incident_description', e.target.value)} rows={4}
                className="w-full bg-neutral-800 border border-neutral-700 rounded text-neutral-300 px-2 py-1.5"
                placeholder="Describe the alleged misconduct..." /></div>
          </fieldset>

          {/* Complainant */}
          <fieldset className="border border-neutral-800 rounded p-3 space-y-3">
            <legend className="text-neutral-500 font-bold uppercase px-1 text-[10px]">Complainant</legend>
            <label className="flex items-center gap-1.5 mb-2">
              <input type="checkbox" checked={form.complainant_anonymous} onChange={e => set('complainant_anonymous', e.target.checked)}
                className="rounded border-neutral-600 bg-neutral-800 text-brand-500" />
              <span className="text-neutral-300">Anonymous complaint</span>
            </label>
            {!form.complainant_anonymous && (
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-neutral-500 block mb-1">Name</label>
                  <input value={form.complainant_name || ''} onChange={e => set('complainant_name', e.target.value)}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded text-neutral-300 px-2 py-1.5" /></div>
                <div><label className="text-neutral-500 block mb-1">Phone</label>
                  <input value={form.complainant_phone || ''} onChange={e => set('complainant_phone', e.target.value)}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded text-neutral-300 px-2 py-1.5" /></div>
                <div><label className="text-neutral-500 block mb-1">Email</label>
                  <input value={form.complainant_email || ''} onChange={e => set('complainant_email', e.target.value)}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded text-neutral-300 px-2 py-1.5" /></div>
                <div><label className="text-neutral-500 block mb-1">Address</label>
                  <input value={form.complainant_address || ''} onChange={e => set('complainant_address', e.target.value)}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded text-neutral-300 px-2 py-1.5" /></div>
              </div>
            )}
          </fieldset>

          {/* Accused Officer */}
          <fieldset className="border border-neutral-800 rounded p-3 space-y-3">
            <legend className="text-neutral-500 font-bold uppercase px-1 text-[10px]">Accused Officer</legend>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-neutral-500 block mb-1">Select Officer</label>
                <select value={form.accused_officer_id || ''} onChange={e => {
                  const off = officers.find(o => o.id === +e.target.value);
                  set('accused_officer_id', +e.target.value || null);
                  set('accused_officer_name', off?.full_name || '');
                }} className="w-full bg-neutral-800 border border-neutral-700 rounded text-neutral-300 px-2 py-1.5">
                  <option value="">— Select —</option>
                  {officers.map(o => <option key={o.id} value={o.id}>{o.full_name} ({o.badge_number})</option>)}
                </select></div>
              <div><label className="text-neutral-500 block mb-1">Investigator</label>
                <select value={form.assigned_investigator_id || ''} onChange={e => set('assigned_investigator_id', +e.target.value || null)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded text-neutral-300 px-2 py-1.5">
                  <option value="">— Unassigned —</option>
                  {officers.filter(o => ['admin', 'manager', 'supervisor'].includes(o.role)).map(o => (
                    <option key={o.id} value={o.id}>{o.full_name}</option>
                  ))}
                </select></div>
            </div>
          </fieldset>

          {/* Investigation (only for editing) */}
          {complaint?.id && (
            <fieldset className="border border-neutral-800 rounded p-3 space-y-3">
              <legend className="text-neutral-500 font-bold uppercase px-1 text-[10px]">Investigation & Finding</legend>
              <div><label className="text-neutral-500 block mb-1">Investigation Notes</label>
                <textarea value={form.investigation_notes || ''} onChange={e => set('investigation_notes', e.target.value)} rows={3}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded text-neutral-300 px-2 py-1.5" /></div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="text-neutral-500 block mb-1">Status</label>
                  <select value={form.status || ''} onChange={e => set('status', e.target.value)}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded text-neutral-300 px-2 py-1.5">
                    <option value="received">Received</option><option value="assigned">Assigned</option>
                    <option value="investigating">Investigating</option><option value="review">In Review</option>
                    <option value="sustained">Sustained</option><option value="not_sustained">Not Sustained</option>
                    <option value="exonerated">Exonerated</option><option value="unfounded">Unfounded</option>
                    <option value="closed">Closed</option><option value="withdrawn">Withdrawn</option>
                  </select></div>
                <div><label className="text-neutral-500 block mb-1">Finding</label>
                  <select value={form.finding || ''} onChange={e => set('finding', e.target.value || null)}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded text-neutral-300 px-2 py-1.5">
                    <option value="">— No Finding —</option>
                    {FINDINGS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select></div>
                <div><label className="text-neutral-500 block mb-1">Discipline</label>
                  <select value={form.discipline_type || ''} onChange={e => set('discipline_type', e.target.value || null)}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded text-neutral-300 px-2 py-1.5">
                    <option value="">— None —</option>
                    {DISCIPLINES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select></div>
              </div>
            </fieldset>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-800">
            <button onClick={onClose} className="text-neutral-400 hover:text-neutral-200 text-xs px-3 py-1.5">Cancel</button>
            <button onClick={() => onSave(form)}
              className="bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold px-3 py-1.5 rounded">
              {complaint?.id ? 'Update' : 'Create'} Complaint
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Stat Card ──
function StatCard({ label, value, icon: Icon, color }: { label: string; value: string | number; icon: any; color: string }) {
  return (
    <div className="panel-beveled p-3 flex items-center gap-3">
      <div className={`p-2 rounded-lg bg-neutral-800 ${color}`}><Icon className="w-4 h-4" /></div>
      <div>
        <div className="text-neutral-500 text-[10px] uppercase tracking-wide">{label}</div>
        <div className={`text-lg font-bold ${color}`}>{value}</div>
      </div>
    </div>
  );
}
