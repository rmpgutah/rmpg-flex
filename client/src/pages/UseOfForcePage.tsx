import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield, Plus, Search, AlertTriangle, BarChart3,
  FileText, Eye, ChevronDown, Filter, X, RefreshCw,
  CheckCircle, Clock, XCircle, Users, Activity,
  Siren, Heart, Camera, Send,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import StatusBadge from '../components/StatusBadge';
import FormModal from '../components/FormModal';
import { usePersistedTab } from '../hooks/usePersistedState';
import { formatDateTime, formatDate } from '../utils/dateUtils';

const FORCE_LEVELS = [
  { value: 'level_1', label: 'Level 1 — Verbal / Presence', color: 'text-green-400' },
  { value: 'level_2', label: 'Level 2 — Soft Empty Hand', color: 'text-yellow-400' },
  { value: 'level_3', label: 'Level 3 — Hard Empty Hand / OC / Taser', color: 'text-orange-400' },
  { value: 'level_4', label: 'Level 4 — Impact Weapon / K9', color: 'text-red-400' },
  { value: 'lethal', label: 'Lethal Force — Firearm / Deadly', color: 'text-red-600' },
];

const FORCE_TYPES = [
  'Verbal commands', 'Physical presence', 'Escort / control hold', 'Takedown',
  'Strikes (hand/fist)', 'Kicks', 'OC spray', 'Taser (probe)', 'Taser (drive stun)',
  'Baton / impact weapon', 'K9 deployment', 'Less-lethal munitions',
  'Vehicle pursuit / PIT', 'Firearm pointed', 'Firearm discharged',
  'Neck restraint', 'Other',
];

const BEHAVIORS = [
  { value: 'cooperative', label: 'Cooperative' },
  { value: 'passive_resistance', label: 'Passive Resistance' },
  { value: 'active_resistance', label: 'Active Resistance' },
  { value: 'aggressive', label: 'Aggressive / Assaultive' },
  { value: 'life_threatening', label: 'Life-Threatening' },
  { value: 'fleeing', label: 'Fleeing' },
  { value: 'unknown', label: 'Unknown' },
];

const ARMED_OPTIONS = [
  { value: 'no', label: 'No' }, { value: 'firearm', label: 'Firearm' },
  { value: 'knife', label: 'Knife' }, { value: 'blunt_weapon', label: 'Blunt Weapon' },
  { value: 'vehicle', label: 'Vehicle' }, { value: 'other', label: 'Other' },
  { value: 'unknown', label: 'Unknown' },
];

type Tab = 'dashboard' | 'reports' | 'review';

export default function UseOfForcePage() {
  const [activeTab, setActiveTab] = usePersistedTab<Tab>('uof-tab', 'dashboard', ['dashboard', 'reports', 'review']);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <PanelTitleBar title="USE OF FORCE" icon={Shield} />
      <div className="flex items-center gap-0.5 px-3 py-1.5 bg-surface-raised border-b border-neutral-800">
        {([
          { id: 'dashboard' as Tab, label: 'Dashboard', icon: BarChart3 },
          { id: 'reports' as Tab, label: 'Reports', icon: FileText },
          { id: 'review' as Tab, label: 'Review Queue', icon: CheckCircle },
        ]).map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide transition-colors ${activeTab === id ? 'bg-brand-600/20 text-brand-400 border-b-2 border-brand-500' : 'text-neutral-500 hover:text-neutral-300'}`}>
            <Icon className="w-3 h-3" /> {label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto">
        {activeTab === 'dashboard' && <DashboardTab />}
        {activeTab === 'reports' && <ReportsTab />}
        {activeTab === 'review' && <ReviewTab />}
      </div>
    </div>
  );
}

// ── Dashboard ──
function DashboardTab() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(365);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch(`/api/use-of-force/stats?days=${days}`).then(setStats).catch(() => {}).finally(() => setLoading(false));
  }, [days]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-8 text-center text-neutral-500">Loading...</div>;
  if (!stats) return <div className="p-8 text-center text-red-400">Failed to load statistics</div>;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-neutral-300 uppercase tracking-wide">Use of Force Analytics</h2>
        <select value={days} onChange={(e) => setDays(+e.target.value)}
          className="bg-neutral-800 border border-neutral-700 text-xs text-neutral-300 px-2 py-1 rounded">
          <option value={30}>Last 30 Days</option>
          <option value={90}>Last 90 Days</option>
          <option value={365}>Last Year</option>
        </select>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Incidents" value={stats.total} icon={Shield} color="text-blue-400" />
        <StatCard label="Pending Review" value={stats.pendingReview} icon={Clock} color="text-amber-400" />
        <StatCard label="De-escalation Rate" value={`${stats.deEscalationRate}%`} icon={Activity} color="text-green-400" />
        <StatCard label="Subject Injury Rate" value={`${stats.subjectInjuryRate}%`} icon={Heart} color="text-red-400" />
      </div>

      {/* Force Level Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="panel-beveled overflow-hidden">
          <div className="panel-title-bar flex items-center gap-2">
            <AlertTriangle className="w-3 h-3 text-orange-400" />
            <span>FORCE LEVEL DISTRIBUTION</span>
          </div>
          <div className="p-3 space-y-2">
            {FORCE_LEVELS.map(level => {
              const item = stats.byForceLevel?.find((f: any) => f.force_level === level.value);
              const count = item?.count || 0;
              const pct = stats.total > 0 ? Math.round(100 * count / stats.total) : 0;
              return (
                <div key={level.value} className="flex items-center gap-2 text-xs">
                  <span className={`w-36 truncate ${level.color}`}>{level.label.split('—')[1]?.trim() || level.label}</span>
                  <div className="flex-1 bg-neutral-800 rounded-full h-3 overflow-hidden">
                    <div className={`h-full rounded-full ${level.value === 'lethal' ? 'bg-red-600' : level.value === 'level_4' ? 'bg-red-500' : level.value === 'level_3' ? 'bg-orange-500' : level.value === 'level_2' ? 'bg-yellow-500' : 'bg-green-500'}`}
                      style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-neutral-400 w-8 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top Officers */}
        <div className="panel-beveled overflow-hidden">
          <div className="panel-title-bar flex items-center gap-2">
            <Users className="w-3 h-3 text-blue-400" />
            <span>OFFICERS WITH MOST REPORTS</span>
          </div>
          <div className="p-2">
            {stats.byOfficer?.length ? (
              <table className="w-full text-xs">
                <thead><tr className="text-neutral-500 border-b border-neutral-800">
                  <th className="text-left py-1 px-2">Officer</th><th className="text-left py-1 px-2">Badge</th><th className="text-right py-1 px-2">Count</th>
                </tr></thead>
                <tbody>{stats.byOfficer.map((o: any, i: number) => (
                  <tr key={i} className="border-b border-neutral-800/50 hover:bg-neutral-800/30">
                    <td className="py-1.5 px-2 text-neutral-300">{o.full_name}</td>
                    <td className="py-1.5 px-2 text-neutral-500">{o.badge_number}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-neutral-300">{o.count}</td>
                  </tr>
                ))}</tbody>
              </table>
            ) : <div className="p-4 text-center text-neutral-500 text-xs">No data</div>}
          </div>
        </div>
      </div>

      {/* Monthly Trend */}
      {stats.monthly?.length > 0 && (
        <div className="panel-beveled overflow-hidden">
          <div className="panel-title-bar flex items-center gap-2">
            <Activity className="w-3 h-3 text-blue-400" />
            <span>MONTHLY TREND</span>
          </div>
          <div className="p-3 flex items-end gap-1 h-32">
            {stats.monthly.map((m: any) => {
              const max = Math.max(...stats.monthly.map((x: any) => x.count), 1);
              const pct = (m.count / max) * 100;
              return (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[9px] text-neutral-400">{m.count}</span>
                  <div className="w-full bg-brand-600/60 rounded-t" style={{ height: `${pct}%`, minHeight: '2px' }} />
                  <span className="text-[8px] text-neutral-500">{m.month.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Reports Tab ──
function ReportsTab() {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterLevel, setFilterLevel] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editReport, setEditReport] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (filterLevel) params.set('force_level', filterLevel);
    if (filterStatus) params.set('status', filterStatus);
    apiFetch(`/api/use-of-force?${params}`).then(setReports).catch(() => {}).finally(() => setLoading(false));
  }, [search, filterLevel, filterStatus]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (data: any) => {
    if (editReport?.id) {
      await apiFetch(`/api/use-of-force/${editReport.id}`, { method: 'PUT', body: JSON.stringify(data) });
    } else {
      await apiFetch('/api/use-of-force', { method: 'POST', body: JSON.stringify(data) });
    }
    setShowForm(false);
    setEditReport(null);
    load();
  };

  return (
    <div className="p-4 space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-neutral-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search reports..."
            className="w-full bg-neutral-800 border border-neutral-700 rounded text-xs text-neutral-300 pl-7 pr-2 py-1.5" />
        </div>
        <select value={filterLevel} onChange={e => setFilterLevel(e.target.value)}
          className="bg-neutral-800 border border-neutral-700 text-xs text-neutral-300 px-2 py-1.5 rounded">
          <option value="">All Levels</option>
          {FORCE_LEVELS.map(l => <option key={l.value} value={l.value}>{l.label.split('—')[0].trim()}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="bg-neutral-800 border border-neutral-700 text-xs text-neutral-300 px-2 py-1.5 rounded">
          <option value="">All Statuses</option>
          <option value="draft">Draft</option><option value="submitted">Submitted</option>
          <option value="under_review">Under Review</option><option value="approved">Approved</option>
          <option value="returned">Returned</option><option value="ia_referral">IA Referral</option>
        </select>
        <button onClick={() => { setEditReport(null); setShowForm(true); }}
          className="flex items-center gap-1.5 bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold px-3 py-1.5 rounded">
          <Plus className="w-3 h-3" /> NEW REPORT
        </button>
      </div>

      {/* Table */}
      {loading ? <div className="text-center text-neutral-500 py-8">Loading...</div> : (
        <div className="panel-beveled overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-neutral-500 border-b border-neutral-700 text-left">
                <th className="py-2 px-3">Report #</th><th className="py-2 px-3">Date</th>
                <th className="py-2 px-3">Officer</th><th className="py-2 px-3">Subject</th>
                <th className="py-2 px-3">Force Level</th><th className="py-2 px-3">Status</th>
                <th className="py-2 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reports.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-neutral-500">No reports found</td></tr>
              ) : reports.map(r => (
                <tr key={r.id} className="border-b border-neutral-800/50 hover:bg-neutral-800/30 cursor-pointer" onClick={() => setDetail(r)}>
                  <td className="py-2 px-3 font-mono text-brand-400">{r.report_number}</td>
                  <td className="py-2 px-3 text-neutral-400">{formatDate(r.incident_date)}</td>
                  <td className="py-2 px-3 text-neutral-300">{r.officer_name}</td>
                  <td className="py-2 px-3 text-neutral-300">{r.subject_name}</td>
                  <td className="py-2 px-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      r.force_level === 'lethal' ? 'bg-red-900/40 text-red-400' :
                      r.force_level === 'level_4' ? 'bg-red-900/30 text-red-400' :
                      r.force_level === 'level_3' ? 'bg-orange-900/30 text-orange-400' :
                      r.force_level === 'level_2' ? 'bg-yellow-900/30 text-yellow-400' :
                      'bg-green-900/30 text-green-400'
                    }`}>{r.force_level?.replace('_', ' ')}</span>
                  </td>
                  <td className="py-2 px-3"><StatusBadge status={r.status} /></td>
                  <td className="py-2 px-3 text-right">
                    <button onClick={(e) => { e.stopPropagation(); setEditReport(r); setShowForm(true); }}
                      className="text-neutral-500 hover:text-neutral-300"><FileText className="w-3.5 h-3.5" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail Modal */}
      {detail && <DetailModal report={detail} onClose={() => setDetail(null)} />}

      {/* Form Modal */}
      {showForm && <UofFormModal report={editReport} onSave={handleSave} onClose={() => { setShowForm(false); setEditReport(null); }} />}
    </div>
  );
}

// ── Review Queue ──
function ReviewTab() {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch('/api/use-of-force?status=submitted').then(r => {
      apiFetch('/api/use-of-force?status=under_review').then(r2 => {
        setReports([...r, ...r2]);
      });
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleReview = async (id: number, status: string, notes: string) => {
    await apiFetch(`/api/use-of-force/${id}/review`, {
      method: 'PUT', body: JSON.stringify({ status, review_notes: notes }),
    });
    load();
  };

  if (loading) return <div className="p-8 text-center text-neutral-500">Loading...</div>;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-neutral-300 uppercase tracking-wide">Pending Review ({reports.length})</h2>
        <button onClick={load} className="text-neutral-500 hover:text-neutral-300"><RefreshCw className="w-4 h-4" /></button>
      </div>
      {reports.length === 0 ? (
        <div className="panel-beveled p-8 text-center text-neutral-500 text-xs">
          <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-500/50" />
          All reports have been reviewed
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map(r => (
            <ReviewCard key={r.id} report={r} onReview={handleReview} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Review Card ──
function ReviewCard({ report: r, onReview }: { report: any; onReview: (id: number, status: string, notes: string) => void }) {
  const [notes, setNotes] = useState('');
  const [expanded, setExpanded] = useState(false);

  const level = FORCE_LEVELS.find(l => l.value === r.force_level);

  return (
    <div className="panel-beveled overflow-hidden">
      <div className="p-3 cursor-pointer hover:bg-neutral-800/30" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-mono text-brand-400 text-xs">{r.report_number}</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${level?.color || ''}`}>
              {r.force_level?.replace('_', ' ')}
            </span>
            <span className="text-neutral-400 text-xs">{r.officer_name} ({r.badge_number})</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <span>{formatDate(r.incident_date)}</span>
            <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </div>
        </div>
        {!expanded && <p className="text-neutral-500 text-xs mt-1 line-clamp-1">{r.narrative}</p>}
      </div>

      {expanded && (
        <div className="border-t border-neutral-800 p-3 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div><span className="text-neutral-500">Subject:</span> <span className="text-neutral-300">{r.subject_name}</span></div>
            <div><span className="text-neutral-500">Behavior:</span> <span className="text-neutral-300">{r.subject_behavior}</span></div>
            <div><span className="text-neutral-500">Armed:</span> <span className="text-neutral-300">{r.subject_armed}</span></div>
            <div><span className="text-neutral-500">Location:</span> <span className="text-neutral-300">{r.location_address || 'N/A'}</span></div>
            <div><span className="text-neutral-500">De-escalation:</span> <span className={r.de_escalation_attempted ? 'text-green-400' : 'text-red-400'}>{r.de_escalation_attempted ? 'Yes' : 'No'}</span></div>
            <div><span className="text-neutral-500">Body Cam:</span> <span className={r.body_camera_active ? 'text-green-400' : 'text-red-400'}>{r.body_camera_active ? 'Active' : 'Off'}</span></div>
            <div><span className="text-neutral-500">Subject Injured:</span> <span className={r.subject_medical_treatment ? 'text-red-400' : 'text-green-400'}>{r.subject_medical_treatment ? 'Yes' : 'No'}</span></div>
            <div><span className="text-neutral-500">Officer Injured:</span> <span className={r.officer_medical_treatment ? 'text-red-400' : 'text-green-400'}>{r.officer_medical_treatment ? 'Yes' : 'No'}</span></div>
          </div>
          <div className="text-xs text-neutral-400 bg-neutral-900/50 p-2 rounded max-h-32 overflow-auto">
            <strong className="text-neutral-500">Narrative:</strong> {r.narrative}
          </div>
          {r.force_types?.length > 0 && (
            <div className="text-xs"><span className="text-neutral-500">Force Used:</span> <span className="text-neutral-300">{r.force_types.join(', ')}</span></div>
          )}

          {/* Review Actions */}
          <div className="flex items-center gap-2 pt-2 border-t border-neutral-800">
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Review notes (optional)..."
              className="flex-1 bg-neutral-800 border border-neutral-700 rounded text-xs text-neutral-300 px-2 py-1.5" />
            <button onClick={() => onReview(r.id, 'approved', notes)}
              className="flex items-center gap-1 bg-green-800 hover:bg-green-700 text-green-200 text-xs font-bold px-3 py-1.5 rounded">
              <CheckCircle className="w-3 h-3" /> Approve
            </button>
            <button onClick={() => onReview(r.id, 'returned', notes)}
              className="flex items-center gap-1 bg-yellow-800 hover:bg-yellow-700 text-yellow-200 text-xs font-bold px-3 py-1.5 rounded">
              <XCircle className="w-3 h-3" /> Return
            </button>
            <button onClick={() => onReview(r.id, 'ia_referral', notes)}
              className="flex items-center gap-1 bg-red-800 hover:bg-red-700 text-red-200 text-xs font-bold px-3 py-1.5 rounded">
              <Siren className="w-3 h-3" /> IA Referral
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Detail Modal ──
function DetailModal({ report: r, onClose }: { report: any; onClose: () => void }) {
  const level = FORCE_LEVELS.find(l => l.value === r.force_level);
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-neutral-900 border border-neutral-700 rounded-lg max-w-2xl w-full max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-3 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-brand-400" />
            <span className="font-mono text-brand-400 text-sm font-bold">{r.report_number}</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${level?.color || ''}`}>{r.force_level?.replace('_', ' ')}</span>
            <StatusBadge status={r.status} />
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-neutral-500">Officer</label><div className="text-neutral-200">{r.officer_name} ({r.badge_number})</div></div>
            <div><label className="text-neutral-500">Date/Time</label><div className="text-neutral-200">{formatDate(r.incident_date)} {r.incident_time || ''}</div></div>
            <div><label className="text-neutral-500">Subject</label><div className="text-neutral-200">{r.subject_name}</div></div>
            <div><label className="text-neutral-500">Behavior</label><div className="text-neutral-200">{BEHAVIORS.find(b => b.value === r.subject_behavior)?.label || r.subject_behavior}</div></div>
            <div><label className="text-neutral-500">Armed</label><div className="text-neutral-200">{ARMED_OPTIONS.find(a => a.value === r.subject_armed)?.label || r.subject_armed}</div></div>
            <div><label className="text-neutral-500">Location</label><div className="text-neutral-200">{r.location_address || 'N/A'}</div></div>
          </div>
          {r.force_types?.length > 0 && (
            <div><label className="text-neutral-500">Force Types Used</label>
              <div className="flex flex-wrap gap-1 mt-1">{r.force_types.map((f: string) => (
                <span key={f} className="px-2 py-0.5 bg-neutral-800 rounded text-neutral-300 text-[10px]">{f}</span>
              ))}</div>
            </div>
          )}
          <div><label className="text-neutral-500">Narrative</label><div className="text-neutral-300 mt-1 bg-neutral-800/50 p-2 rounded whitespace-pre-wrap">{r.narrative}</div></div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="text-neutral-500">De-escalation</label><div className={r.de_escalation_attempted ? 'text-green-400' : 'text-red-400'}>{r.de_escalation_attempted ? 'Yes' : 'No'}</div></div>
            <div><label className="text-neutral-500">Body Camera</label><div className={r.body_camera_active ? 'text-green-400' : 'text-red-400'}>{r.body_camera_active ? 'Active' : 'Off'}</div></div>
            <div><label className="text-neutral-500">Verbal Commands</label><div className={r.verbal_commands_given ? 'text-green-400' : 'text-red-400'}>{r.verbal_commands_given ? 'Yes' : 'No'}</div></div>
          </div>
          {r.subject_injuries && <div><label className="text-neutral-500">Subject Injuries</label><div className="text-red-400">{r.subject_injuries}</div></div>}
          {r.officer_injuries && <div><label className="text-neutral-500">Officer Injuries</label><div className="text-red-400">{r.officer_injuries}</div></div>}
          {r.review_notes && <div><label className="text-neutral-500">Review Notes</label><div className="text-neutral-300 bg-neutral-800/50 p-2 rounded">{r.review_notes}</div></div>}
        </div>
      </div>
    </div>
  );
}

// ── Form Modal ──
function UofFormModal({ report, onSave, onClose }: { report: any; onSave: (data: any) => void; onClose: () => void }) {
  const [form, setForm] = useState<any>(report || {
    subject_name: '', incident_date: new Date().toISOString().slice(0, 10),
    force_level: 'level_1', force_types: [], narrative: '',
    de_escalation_attempted: true, verbal_commands_given: true,
    body_camera_active: true, subject_behavior: 'unknown',
    subject_armed: 'no', subject_impairment: 'unknown',
  });

  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }));
  const toggleForceType = (t: string) => {
    const types = form.force_types || [];
    set('force_types', types.includes(t) ? types.filter((x: string) => x !== t) : [...types, t]);
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-neutral-900 border border-neutral-700 rounded-lg max-w-3xl w-full max-h-[85vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-3 border-b border-neutral-800">
          <span className="text-sm font-bold text-neutral-200">{report?.id ? 'EDIT' : 'NEW'} USE OF FORCE REPORT</span>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-4 text-xs">
          {/* Incident Info */}
          <fieldset className="border border-neutral-800 rounded p-3 space-y-3">
            <legend className="text-neutral-500 font-bold uppercase px-1 text-[10px]">Incident Information</legend>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-neutral-500 block mb-1">Date *</label>
                <input type="date" value={form.incident_date || ''} onChange={e => set('incident_date', e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded text-neutral-300 px-2 py-1.5" /></div>
              <div><label className="text-neutral-500 block mb-1">Time</label>
                <input type="time" value={form.incident_time || ''} onChange={e => set('incident_time', e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded text-neutral-300 px-2 py-1.5" /></div>
            </div>
            <div><label className="text-neutral-500 block mb-1">Location</label>
              <input value={form.location_address || ''} onChange={e => set('location_address', e.target.value)}
                className="w-full bg-neutral-800 border border-neutral-700 rounded text-neutral-300 px-2 py-1.5" placeholder="Address" /></div>
          </fieldset>

          {/* Subject Info */}
          <fieldset className="border border-neutral-800 rounded p-3 space-y-3">
            <legend className="text-neutral-500 font-bold uppercase px-1 text-[10px]">Subject Information</legend>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-neutral-500 block mb-1">Name *</label>
                <input value={form.subject_name || ''} onChange={e => set('subject_name', e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded text-neutral-300 px-2 py-1.5" /></div>
              <div><label className="text-neutral-500 block mb-1">DOB</label>
                <input type="date" value={form.subject_dob || ''} onChange={e => set('subject_dob', e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded text-neutral-300 px-2 py-1.5" /></div>
              <div><label className="text-neutral-500 block mb-1">Behavior *</label>
                <select value={form.subject_behavior || ''} onChange={e => set('subject_behavior', e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded text-neutral-300 px-2 py-1.5">
                  {BEHAVIORS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
                </select></div>
              <div><label className="text-neutral-500 block mb-1">Armed</label>
                <select value={form.subject_armed || 'no'} onChange={e => set('subject_armed', e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded text-neutral-300 px-2 py-1.5">
                  {ARMED_OPTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select></div>
            </div>
          </fieldset>

          {/* Force Details */}
          <fieldset className="border border-neutral-800 rounded p-3 space-y-3">
            <legend className="text-neutral-500 font-bold uppercase px-1 text-[10px]">Force Used</legend>
            <div><label className="text-neutral-500 block mb-1">Force Level *</label>
              <select value={form.force_level || ''} onChange={e => set('force_level', e.target.value)}
                className="w-full bg-neutral-800 border border-neutral-700 rounded text-neutral-300 px-2 py-1.5">
                {FORCE_LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select></div>
            <div><label className="text-neutral-500 block mb-2">Force Types (select all that apply)</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {FORCE_TYPES.map(t => (
                  <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={form.force_types?.includes(t)} onChange={() => toggleForceType(t)}
                      className="rounded border-neutral-600 bg-neutral-800 text-brand-500" />
                    <span className="text-neutral-300">{t}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={form.de_escalation_attempted} onChange={e => set('de_escalation_attempted', e.target.checked)}
                  className="rounded border-neutral-600 bg-neutral-800 text-brand-500" />
                <span className="text-neutral-300">De-escalation attempted</span>
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={form.verbal_commands_given} onChange={e => set('verbal_commands_given', e.target.checked)}
                  className="rounded border-neutral-600 bg-neutral-800 text-brand-500" />
                <span className="text-neutral-300">Verbal commands given</span>
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={form.body_camera_active} onChange={e => set('body_camera_active', e.target.checked)}
                  className="rounded border-neutral-600 bg-neutral-800 text-brand-500" />
                <span className="text-neutral-300">Body camera active</span>
              </label>
            </div>
          </fieldset>

          {/* Narrative */}
          <div><label className="text-neutral-500 block mb-1">Narrative *</label>
            <textarea value={form.narrative || ''} onChange={e => set('narrative', e.target.value)} rows={5}
              className="w-full bg-neutral-800 border border-neutral-700 rounded text-neutral-300 px-2 py-1.5"
              placeholder="Describe the circumstances, actions taken, and justification..." /></div>

          {/* Injuries */}
          <fieldset className="border border-neutral-800 rounded p-3 space-y-3">
            <legend className="text-neutral-500 font-bold uppercase px-1 text-[10px]">Injuries</legend>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-neutral-500 block mb-1">Subject Injuries</label>
                <input value={form.subject_injuries || ''} onChange={e => set('subject_injuries', e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded text-neutral-300 px-2 py-1.5" placeholder="Describe or 'None'" /></div>
              <div><label className="text-neutral-500 block mb-1">Officer Injuries</label>
                <input value={form.officer_injuries || ''} onChange={e => set('officer_injuries', e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded text-neutral-300 px-2 py-1.5" placeholder="Describe or 'None'" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={form.subject_medical_treatment} onChange={e => set('subject_medical_treatment', e.target.checked)}
                  className="rounded border-neutral-600 bg-neutral-800 text-brand-500" />
                <span className="text-neutral-300">Subject received medical treatment</span>
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={form.officer_medical_treatment} onChange={e => set('officer_medical_treatment', e.target.checked)}
                  className="rounded border-neutral-600 bg-neutral-800 text-brand-500" />
                <span className="text-neutral-300">Officer received medical treatment</span>
              </label>
            </div>
          </fieldset>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-800">
            <button onClick={onClose} className="text-neutral-400 hover:text-neutral-200 text-xs px-3 py-1.5">Cancel</button>
            <button onClick={() => onSave({ ...form, status: 'draft' })}
              className="bg-neutral-700 hover:bg-neutral-600 text-neutral-200 text-xs font-bold px-3 py-1.5 rounded">
              Save Draft
            </button>
            <button onClick={() => onSave({ ...form, status: 'submitted' })}
              className="bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold px-3 py-1.5 rounded flex items-center gap-1">
              <Send className="w-3 h-3" /> Submit for Review
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
