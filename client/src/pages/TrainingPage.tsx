// ============================================================
// RMPG Flex — Training Management System
// Unified training dashboard: compliance, records, requirements,
// and document management.
// ============================================================

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  GraduationCap, Plus, Search, CheckCircle, AlertTriangle, Clock,
  BookOpen, Loader2, X, Edit2, Trash2, Archive, Users, Shield,
  Calendar, BarChart3, Target, Award, FileText, ChevronDown,
  ChevronRight, RefreshCw, Filter,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { formatDateTime, formatDate, parseTimestamp } from '../utils/dateUtils';
import type { TrainingRecord, TrainingRequirement, TrainingCategory, TrainingStatus } from '../types';

// ── Constants ──────────────────────────────────────────────
const CATEGORIES: TrainingCategory[] = [
  'firearms', 'defensive_tactics', 'first_aid', 'legal',
  'communication', 'driving', 'technology', 'leadership', 'compliance', 'other',
];

const CATEGORY_COLORS: Record<string, string> = {
  firearms: 'bg-red-900/40 text-red-400 border-red-700/50',
  defensive_tactics: 'bg-amber-900/40 text-amber-400 border-amber-700/50',
  first_aid: 'bg-green-900/40 text-green-400 border-green-700/50',
  legal: 'bg-purple-900/40 text-purple-400 border-purple-700/50',
  communication: 'bg-blue-900/40 text-blue-400 border-blue-700/50',
  driving: 'bg-cyan-900/40 text-cyan-400 border-cyan-700/50',
  technology: 'bg-indigo-900/40 text-indigo-400 border-indigo-700/50',
  leadership: 'bg-brand-900/40 text-brand-400 border-brand-700/50',
  compliance: 'bg-amber-900/40 text-amber-400 border-amber-700/50',
  other: 'bg-rmpg-700/40 text-rmpg-300 border-rmpg-600/50',
};

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  completed: { bg: 'bg-green-900/50', text: 'text-green-400', border: 'border-green-700/50' },
  in_progress: { bg: 'bg-blue-900/50', text: 'text-blue-400', border: 'border-blue-700/50' },
  scheduled: { bg: 'bg-amber-900/50', text: 'text-amber-400', border: 'border-amber-700/50' },
  overdue: { bg: 'bg-red-900/50', text: 'text-red-400', border: 'border-red-700/50' },
  expired: { bg: 'bg-red-900/50', text: 'text-red-400', border: 'border-red-700/50' },
};

const ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher', 'contract_manager'];

type Tab = 'dashboard' | 'records' | 'requirements' | 'calendar';

interface Officer {
  id: string;
  full_name: string;
  badge_number?: string;
  role: string;
  status?: string;
}

// ── Main Component ─────────────────────────────────────────
const timeAgo = (date: string): string => {
  if (!date) return '—';
  const parsed = new Date(date).getTime();
  if (Number.isNaN(parsed)) return '—';
  const ms = Date.now() - parsed;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

export default function TrainingPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'supervisor';
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [requirements, setRequirements] = useState<TrainingRequirement[]>([]);
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');

  // Modal state
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [editRecord, setEditRecord] = useState<TrainingRecord | null>(null);
  const [showRequirementModal, setShowRequirementModal] = useState(false);
  const [editRequirement, setEditRequirement] = useState<TrainingRequirement | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const fetchData = useCallback(async () => {
    setFetchError('');
    try {
      setLoading(true);
      const [recs, reqs, users] = await Promise.all([
        apiFetch<TrainingRecord[]>('/personnel/training'),
        apiFetch<TrainingRequirement[]>('/personnel/training-requirements'),
        apiFetch<Officer[]>('/admin/users'),
      ]);
      if (!mountedRef.current) return;
      setRecords(recs || []);
      setRequirements(reqs || []);
      setOfficers((users || []).filter(u => u.status === 'active'));
    } catch (err: any) {
      console.error('Failed to load training data:', err);
      if (mountedRef.current) setFetchError(err?.message || 'Failed to load data');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useLiveSync('training', fetchData);

  // ── Record CRUD ──────────────────────────────────────
  const handleSaveRecord = async (data: Partial<TrainingRecord>) => {
    try {
      if (editRecord) {
        await apiFetch(`/personnel/training/${editRecord.id}`, { method: 'PUT', body: JSON.stringify(data) });
      } else {
        await apiFetch('/personnel/training', { method: 'POST', body: JSON.stringify(data) });
      }
      setShowRecordModal(false);
      setEditRecord(null);
      fetchData();
    } catch (err) {
      console.error('Save record error:', err);
    }
  };

  const handleDeleteRecord = async (id: string) => {
    if (!confirm('Delete this training record? This cannot be undone.')) return;
    try {
      await apiFetch(`/personnel/training/${id}`, { method: 'DELETE' });
      fetchData();
    } catch (err) {
      console.error('Delete record error:', err);
    }
  };

  // ── Requirement CRUD ─────────────────────────────────
  const handleSaveRequirement = async (data: Partial<TrainingRequirement>) => {
    try {
      if (editRequirement) {
        await apiFetch(`/personnel/training-requirements/${editRequirement.id}`, { method: 'PUT', body: JSON.stringify(data) });
      } else {
        await apiFetch('/personnel/training-requirements', { method: 'POST', body: JSON.stringify(data) });
      }
      setShowRequirementModal(false);
      setEditRequirement(null);
      fetchData();
    } catch (err) {
      console.error('Save requirement error:', err);
    }
  };

  const handleDeleteRequirement = async (id: string) => {
    if (!confirm('Delete this training requirement?')) return;
    try {
      await apiFetch(`/personnel/training-requirements/${id}`, { method: 'DELETE' });
      fetchData();
    } catch (err) {
      console.error('Delete requirement error:', err);
    }
  };

  const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'dashboard', label: 'Dashboard', icon: BarChart3 },
    { key: 'records', label: 'Records', icon: FileText },
    { key: 'requirements', label: 'Requirements', icon: Target },
    { key: 'calendar', label: 'Calendar', icon: Calendar },
  ];

  // Set document title
  useEffect(() => { document.title = 'Training Management \u2014 RMPG Flex'; }, []);

  // Keyboard shortcut: Escape to close modals
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowRecordModal(false); setEditRecord(null); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="flex flex-col h-full bg-surface-sunken">
      {fetchError && (
        <div className="mx-4 mt-2 p-2 bg-red-900/30 border border-red-700/50 rounded-sm text-red-400 text-xs flex items-center gap-2">
          <span>⚠ {fetchError}</span>
          <button type="button" onClick={() => setFetchError('')} className="ml-auto text-red-500 hover:text-red-300">✕</button>
        </div>
      )}
      {/* Header */}
      <div className="panel-beveled border-b border-rmpg-700 p-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <GraduationCap className="w-4 h-4 text-brand-400" />
          <h1 className="text-sm font-bold text-rmpg-100 uppercase tracking-wider">
            Training Management
          </h1>
          <span className="text-[9px] text-rmpg-500 font-mono ml-2">
            {records.length} records | {requirements.length} requirements
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={fetchData} className="toolbar-btn p-1.5" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          {isAdmin && (
            <button type="button"
              onClick={() => { setEditRecord(null); setShowRecordModal(true); }}
              className="toolbar-btn-primary text-[10px] px-3 py-1 flex items-center gap-1"
            >
              <Plus className="w-3 h-3" />
              Add Record
            </button>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="panel-inset mx-3 mt-3 p-1 flex items-center gap-1 flex-shrink-0" role="tablist" aria-label="Training management tabs">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button type="button"
            key={key}
            role="tab"
            aria-selected={activeTab === key}
            onClick={() => setActiveTab(key)}
            className={`text-[10px] px-3 py-1.5 flex items-center gap-1.5 transition-colors duration-150 ${
              activeTab === key ? 'toolbar-btn-primary' : 'toolbar-btn'
            }`}
          >
            <Icon className="w-3 h-3" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto scrollbar-dark" role="tabpanel">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-5 h-5 text-brand-400 animate-spin" role="status" aria-label="Loading" />
            <span className="ml-2 text-xs text-rmpg-400">Loading training data...</span>
          </div>
        ) : (
          <>
            {activeTab === 'dashboard' && (
              <DashboardTab records={records} requirements={requirements} officers={officers} />
            )}
            {activeTab === 'records' && (
              <RecordsTab
                records={records}
                officers={officers}
                isAdmin={isAdmin}
                onEdit={(r) => { setEditRecord(r); setShowRecordModal(true); }}
                onDelete={handleDeleteRecord}
              />
            )}
            {activeTab === 'requirements' && (
              <RequirementsTab
                requirements={requirements}
                records={records}
                officers={officers}
                isAdmin={isAdmin}
                onAdd={() => { setEditRequirement(null); setShowRequirementModal(true); }}
                onEdit={(r) => { setEditRequirement(r); setShowRequirementModal(true); }}
                onDelete={handleDeleteRequirement}
              />
            )}
            {activeTab === 'calendar' && (
              <CalendarTab records={records} requirements={requirements} />
            )}
          </>
        )}
      </div>

      {/* Modals */}
      {showRecordModal && (
        <RecordModal
          record={editRecord}
          officers={officers}
          requirements={requirements}
          onSave={handleSaveRecord}
          onClose={() => { setShowRecordModal(false); setEditRecord(null); }}
        />
      )}
      {showRequirementModal && (
        <RequirementModal
          requirement={editRequirement}
          onSave={handleSaveRequirement}
          onClose={() => { setShowRequirementModal(false); setEditRequirement(null); }}
        />
      )}
    </div>
  );
}

// ── DASHBOARD TAB ──────────────────────────────────────────
function DashboardTab({ records, requirements, officers }: {
  records: TrainingRecord[];
  requirements: TrainingRequirement[];
  officers: Officer[];
}) {
  const stats = useMemo(() => {
    const completed = records.filter(r => r.status === 'completed').length;
    const inProgress = records.filter(r => r.status === 'in_progress').length;
    const scheduled = records.filter(r => r.status === 'scheduled').length;
    const overdue = records.filter(r => r.status === 'overdue' || r.status === 'expired').length;
    const totalHours = records.reduce((sum, r) => sum + (r.hours || 0), 0);

    // Expiring within 30 days
    const now = new Date();
    const thirtyDays = new Date(now.getTime() + 30 * 86400000);
    const expiringSoon = records.filter(r => {
      if (!r.expiry_date) return false;
      const exp = parseTimestamp(r.expiry_date);
      return exp > now && exp < thirtyDays;
    }).length;

    // Per-officer compliance
    const mandatoryReqs = requirements.filter(r => r.is_mandatory);
    const officerCompliance = officers
      .filter(o => ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'].includes(o.role))
      .map(officer => {
        const officerRecs = records.filter(r => r.officer_id === officer.id);
        const completedCourses = new Set(
          officerRecs.filter(r => r.status === 'completed').map(r => r.course_name)
        );
        const requiredForRole = mandatoryReqs.filter(req =>
          req.required_for_roles.includes(officer.role)
        );
        const met = requiredForRole.filter(req => completedCourses.has(req.course_name)).length;
        const total = requiredForRole.length;
        return {
          ...officer,
          met,
          total,
          overdue: total - met,
          compliance: total > 0 ? Math.round((met / total) * 100) : 100,
        };
      })
      .sort((a, b) => a.compliance - b.compliance);

    const avgCompliance = officerCompliance.length > 0
      ? Math.round(officerCompliance.reduce((s, o) => s + o.compliance, 0) / officerCompliance.length)
      : 100;

    // Category breakdown
    const byCategory = CATEGORIES.map(cat => ({
      category: cat,
      total: records.filter(r => r.category === cat).length,
      completed: records.filter(r => r.category === cat && r.status === 'completed').length,
    })).filter(c => c.total > 0);

    const overduePersonnel = officerCompliance.filter(o => o.overdue > 0);
    const overduePercent = officerCompliance.length > 0
      ? Math.round((overduePersonnel.length / officerCompliance.length) * 100) : 0;

    return { completed, inProgress, scheduled, overdue, totalHours, expiringSoon, officerCompliance, avgCompliance, byCategory, overduePersonnel, overduePercent };
  }, [records, requirements, officers]);

  return (
    <div className="p-4 space-y-4">
      {/* Compliance Summary Banner */}
      <div className="panel-beveled p-3 border-l-2 border-l-brand-500" role="region" aria-label="Compliance summary">
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle className="w-3.5 h-3.5 text-brand-400" aria-hidden="true" />
          <span className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">Compliance Summary</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center" role="group" aria-label="Compliance metrics">
          <div>
            <p className="text-lg font-bold font-mono text-brand-300">{officers.length}</p>
            <p className="text-[8px] uppercase font-bold text-rmpg-500">Total Personnel</p>
          </div>
          <div>
            <p className="text-lg font-bold font-mono" style={{ color: stats.overduePersonnel.length > 0 ? '#ef4444' : '#22c55e' }}>{stats.overduePersonnel.length}</p>
            <p className="text-[8px] uppercase font-bold text-rmpg-500">Overdue Personnel ({stats.overduePercent}%)</p>
          </div>
          <div>
            <p className="text-lg font-bold font-mono text-orange-400">{stats.expiringSoon}</p>
            <p className="text-[8px] uppercase font-bold text-rmpg-500">Certs Expiring (30d)</p>
          </div>
          <div>
            <p className="text-lg font-bold font-mono" style={{ color: stats.avgCompliance >= 90 ? '#22c55e' : stats.avgCompliance >= 70 ? '#f59e0b' : '#ef4444' }}>{stats.avgCompliance}%</p>
            <p className="text-[8px] uppercase font-bold text-rmpg-500">Avg Compliance</p>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2">
        <StatCard value={records.length} label="Total Records" color="#6b8aad" borderColor="#4a6a8a" />
        <StatCard value={stats.completed} label="Completed" color="#22c55e" borderColor="#15803d" />
        <StatCard value={stats.inProgress} label="In Progress" color="#3b82f6" borderColor="#1d4ed8" />
        <StatCard value={stats.scheduled} label="Scheduled" color="#f59e0b" borderColor="#b45309" />
        <StatCard value={stats.overdue} label="Overdue" color="#ef4444" borderColor="#b91c1c" />
        <StatCard value={stats.expiringSoon} label="Expiring (30d)" color="#f97316" borderColor="#c2410c" />
        <StatCard value={`${stats.totalHours}h`} label="Total Hours" color="#8b5cf6" borderColor="#6d28d9" />
      </div>

      {/* Compliance Rate */}
      <div className="panel-beveled p-3">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-4 h-4 text-brand-400" />
          <span className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">Organization Compliance</span>
          <span className="ml-auto text-lg font-black font-mono" style={{
            color: stats.avgCompliance >= 90 ? '#22c55e' : stats.avgCompliance >= 70 ? '#f59e0b' : '#ef4444'
          }}>
            {stats.avgCompliance}%
          </span>
        </div>
        <div className="h-2 bg-rmpg-700 rounded-sm overflow-hidden">
          <div
            className="h-full transition-all duration-500"
            style={{
              width: `${stats.avgCompliance}%`,
              background: stats.avgCompliance >= 90 ? '#22c55e' : stats.avgCompliance >= 70 ? '#f59e0b' : '#ef4444',
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Category Breakdown */}
        <div className="panel-beveled p-3">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="w-3.5 h-3.5 text-brand-400" />
            <span className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">By Category</span>
          </div>
          <div className="space-y-2">
            {stats.byCategory.map(cat => {
              const pct = cat.total > 0 ? Math.round((cat.completed / cat.total) * 100) : 0;
              return (
                <div key={cat.category} className="flex items-center gap-3">
                  <span className={`w-24 text-[10px] font-bold uppercase border px-1.5 py-0.5 ${CATEGORY_COLORS[cat.category]}`}>
                    {cat.category.replace(/_/g, ' ')}
                  </span>
                  <div className="flex-1 h-1.5 bg-rmpg-700 rounded-sm overflow-hidden">
                    <div
                      className="h-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444',
                      }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-rmpg-300 w-16 text-right">
                    {cat.completed}/{cat.total}
                  </span>
                </div>
              );
            })}
            {stats.byCategory.length === 0 && (
              <p className="text-[11px] text-rmpg-500 text-center py-4">No training records yet.</p>
            )}
          </div>
        </div>

        {/* Officer Compliance Rankings */}
        <div className="panel-beveled p-3">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-3.5 h-3.5 text-brand-400" />
            <span className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">Officer Compliance</span>
          </div>
          <div className="space-y-1 max-h-[300px] overflow-y-auto">
            {stats.officerCompliance.map(o => (
              <div key={o.id} className="flex items-center gap-2 py-1 border-b border-rmpg-800/30">
                <span className="text-[11px] text-rmpg-100 flex-1 truncate">{o.full_name}</span>
                {o.badge_number && (
                  <span className="text-[9px] font-mono text-rmpg-500">{o.badge_number}</span>
                )}
                <div className="w-16 h-1 bg-rmpg-700 rounded-sm overflow-hidden">
                  <div
                    className="h-full"
                    style={{
                      width: `${o.compliance}%`,
                      background: o.compliance >= 90 ? '#22c55e' : o.compliance >= 70 ? '#f59e0b' : '#ef4444',
                    }}
                  />
                </div>
                <span className="text-[10px] font-mono w-10 text-right" style={{
                  color: o.compliance >= 90 ? '#22c55e' : o.compliance >= 70 ? '#f59e0b' : '#ef4444',
                }}>
                  {o.compliance}%
                </span>
              </div>
            ))}
            {stats.officerCompliance.length === 0 && (
              <p className="text-[11px] text-rmpg-500 text-center py-4">No active officers found.</p>
            )}
          </div>
        </div>
      </div>

      {/* Recent overdue / expiring alerts */}
      {(stats.overdue > 0 || stats.expiringSoon > 0) && (
        <div className="panel-beveled p-3 border-l-2 border-l-red-500">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
            <span className="text-[9px] text-red-400 uppercase font-bold tracking-wider">Attention Required</span>
          </div>
          <div className="space-y-1">
            {records
              .filter(r => r.status === 'overdue' || r.status === 'expired')
              .slice(0, 8)
              .map(r => (
                <div key={r.id} className="flex items-center gap-2 text-[11px]">
                  <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />
                  <span className="text-rmpg-100">{r.officer_name}</span>
                  <span className="text-rmpg-500">—</span>
                  <span className="text-rmpg-300">{r.course_name}</span>
                  <span className={`ml-auto text-[9px] font-bold uppercase px-1.5 py-0.5 ${STATUS_COLORS[r.status].bg} ${STATUS_COLORS[r.status].text} border ${STATUS_COLORS[r.status].border}`}>
                    {r.status}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Overdue Personnel Detail */}
      {stats.overduePersonnel.length > 0 && (
        <div className="panel-beveled p-3">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-3.5 h-3.5 text-red-400" />
            <span className="text-[9px] text-red-400 uppercase font-bold tracking-wider">
              Overdue Personnel ({stats.overduePersonnel.length})
            </span>
          </div>
          <div className="space-y-1.5 max-h-[250px] overflow-y-auto">
            {stats.overduePersonnel.map(o => (
              <div key={o.id} className="flex items-center gap-2 py-1 px-2 border border-rmpg-800/50 bg-red-900/5">
                <span className="text-[11px] text-rmpg-100 font-medium w-32 truncate">{o.full_name}</span>
                {o.badge_number && <span className="text-[9px] font-mono text-rmpg-500">{o.badge_number}</span>}
                <span className="text-[9px] text-red-400 font-bold">{o.overdue} missing</span>
                <span className="ml-auto text-[9px] font-mono" style={{
                  color: o.compliance >= 90 ? '#22c55e' : o.compliance >= 70 ? '#f59e0b' : '#ef4444',
                }}>{o.compliance}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feature 18: Training Materials Library */}
      <TrainingMaterialsPanel />

      {/* Feature 20: Mandatory Training Alerts */}
      <MandatoryTrainingAlerts />
    </div>
  );
}

// ── Feature 18: Training Materials Library Component ──
function TrainingMaterialsPanel() {
  const [materials, setMaterials] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fetchMaterials = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ data: any[] }>('/personnel/training-materials');
      setMaterials(res.data || []);
    } catch { setMaterials([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (expanded) fetchMaterials(); }, [expanded]);

  return (
    <div className="panel-beveled p-3">
      <div role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpanded(!expanded); }} className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-2">
          <BookOpen className="w-3.5 h-3.5 text-brand-400" />
          <span className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">Training Materials Library</span>
        </div>
        <ChevronRight className={`w-3 h-3 text-rmpg-500 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </div>
      {expanded && (
        <div className="mt-2">
          {loading ? (
            <div className="text-center py-4"><Loader2 className="w-4 h-4 animate-spin text-brand-400 mx-auto" role="status" aria-label="Loading" /></div>
          ) : materials.length === 0 ? (
            <p className="text-[11px] text-rmpg-500 text-center py-4">No training materials uploaded yet.</p>
          ) : (
            <div className="space-y-1 max-h-[200px] overflow-y-auto">
              {materials.map((m: any) => (
                <div key={m.id} className="flex items-center gap-2 py-1 px-2 border border-rmpg-800/30 bg-surface-sunken">
                  <FileText className="w-3 h-3 text-brand-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-rmpg-100 truncate">{m.title}</div>
                    {m.description && <div className="text-[9px] text-rmpg-500 truncate">{m.description}</div>}
                  </div>
                  <span className={`text-[8px] uppercase border px-1.5 py-0.5 ${CATEGORY_COLORS[m.category] || CATEGORY_COLORS.other}`}>
                    {m.category}
                  </span>
                  {m.file_url && (
                    <a href={m.file_url} target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:text-brand-300">
                      <Archive className="w-3 h-3" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Feature 20: Mandatory Training Alerts ──
function MandatoryTrainingAlerts() {
  const [alerts, setAlerts] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fetchAlerts = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<any>('/personnel/training-alerts');
      setAlerts(res);
    } catch { setAlerts(null); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (expanded) fetchAlerts(); }, [expanded]);

  return (
    <div className="panel-beveled p-3 border-l-2 border-l-amber-500">
      <div role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpanded(!expanded); }} className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-[9px] text-amber-400 uppercase font-bold tracking-wider">
            Mandatory Training Alerts {alerts ? `(${alerts.total_alerts})` : ''}
          </span>
        </div>
        <ChevronRight className={`w-3 h-3 text-rmpg-500 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </div>
      {expanded && (
        <div className="mt-2">
          {loading ? (
            <div className="text-center py-4"><Loader2 className="w-4 h-4 animate-spin text-brand-400 mx-auto" role="status" aria-label="Loading" /></div>
          ) : !alerts || alerts.total_alerts === 0 ? (
            <p className="text-[11px] text-green-400 text-center py-4">All officers are current on mandatory training!</p>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
                <div className="bg-red-900/20 border border-red-700/30 p-1.5 rounded-sm">
                  <div className="font-bold text-red-400">{alerts.expired}</div>
                  <div className="text-rmpg-400">Expired</div>
                </div>
                <div className="bg-amber-900/20 border border-amber-700/30 p-1.5 rounded-sm">
                  <div className="font-bold text-amber-400">{alerts.expiring_soon}</div>
                  <div className="text-rmpg-400">Expiring Soon</div>
                </div>
                <div className="bg-rmpg-800/20 border border-rmpg-700/30 p-1.5 rounded-sm">
                  <div className="font-bold text-rmpg-300">{alerts.never_completed}</div>
                  <div className="text-rmpg-400">Never Completed</div>
                </div>
              </div>
              <div className="max-h-[200px] overflow-y-auto space-y-1">
                {alerts.alerts.slice(0, 20).map((a: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-[10px] py-0.5">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      a.alert_type === 'expired' ? 'bg-red-500' : a.alert_type === 'expiring_soon' ? 'bg-amber-500' : 'bg-rmpg-500'
                    }`} />
                    <span className="text-rmpg-200 w-28 truncate">{a.officer_name}</span>
                    <span className="text-rmpg-400 flex-1 truncate">{a.course_name}</span>
                    <span className={`text-[9px] font-bold ${
                      a.alert_type === 'expired' ? 'text-red-400' : a.alert_type === 'expiring_soon' ? 'text-amber-400' : 'text-rmpg-500'
                    }`}>
                      {a.alert_type === 'expired' ? `${a.days_overdue}d overdue` :
                       a.alert_type === 'expiring_soon' ? `${Math.abs(a.days_overdue)}d left` :
                       'Never done'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ value, label, color, borderColor }: { value: string | number; label: string; color: string; borderColor: string }) {
  return (
    <div className="panel-beveled p-2.5 text-center" style={{ borderTopWidth: 2, borderTopColor: borderColor }}>
      <p className="text-lg font-bold font-mono" style={{ color }}>{value}</p>
      <p className="text-[8px] uppercase font-bold tracking-wider" style={{ color: `${color}99` }}>{label}</p>
    </div>
  );
}

// ── RECORDS TAB ────────────────────────────────────────────
function RecordsTab({ records, officers, isAdmin, onEdit, onDelete }: {
  records: TrainingRecord[];
  officers: Officer[];
  isAdmin: boolean;
  onEdit: (r: TrainingRecord) => void;
  onDelete: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | TrainingStatus | 'expiring_soon'>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | TrainingCategory>('all');
  const [officerFilter, setOfficerFilter] = useState<string>('all');

  const filtered = useMemo(() => {
    let result = records;
    if (statusFilter === 'expiring_soon') {
      const now = new Date();
      const thirtyDays = new Date();
      thirtyDays.setDate(thirtyDays.getDate() + 30);
      result = result.filter(r => {
        if (!r.expiry_date) return false;
        const exp = new Date(r.expiry_date);
        return exp > now && exp <= thirtyDays;
      });
    } else if (statusFilter !== 'all') {
      result = result.filter(r => r.status === statusFilter);
    }
    if (categoryFilter !== 'all') result = result.filter(r => r.category === categoryFilter);
    if (officerFilter !== 'all') result = result.filter(r => r.officer_id === officerFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(r =>
        r.course_name.toLowerCase().includes(q) ||
        r.officer_name?.toLowerCase().includes(q) ||
        r.provider?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [records, statusFilter, categoryFilter, officerFilter, search]);

  return (
    <div className="p-4 space-y-3">
      {/* Filters */}
      <div className="panel-inset p-2 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500" />
          <input
            type="text"
            placeholder="Search..." aria-label="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input-dark text-[11px] pl-6 pr-2 py-1 w-40 min-h-[36px]"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as any)}
          className="input-dark text-[10px] px-2 py-1 min-h-[36px]"
        >
          <option value="all">All Statuses</option>
          <option value="completed">Completed</option>
          <option value="in_progress">In Progress</option>
          <option value="scheduled">Scheduled</option>
          <option value="overdue">Overdue</option>
          <option value="expired">Expired</option>
          <option value="expiring_soon">Expiring in 30 Days</option>
        </select>
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value as any)}
          className="input-dark text-[10px] px-2 py-1 min-h-[36px]"
        >
          <option value="all">All Categories</option>
          {CATEGORIES.map(c => (
            <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <select
          value={officerFilter}
          onChange={e => setOfficerFilter(e.target.value)}
          className="input-dark text-[10px] px-2 py-1 min-h-[36px]"
        >
          <option value="all">All Officers</option>
          {officers.map(o => (
            <option key={o.id} value={o.id}>{o.full_name}</option>
          ))}
        </select>
        <span className="text-[10px] text-rmpg-500 ml-auto">{filtered.length} records</span>
      </div>

      {/* Records Table */}
      {filtered.length === 0 ? (
        <EmptyState icon={FileText} message="No training records found." />
      ) : (
        <div className="panel-beveled overflow-x-auto">
          <table className="table-dark w-full text-[11px]">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="text-left py-1.5 px-2">Officer</th>
                <th className="text-left py-1.5 px-2">Course</th>
                <th className="text-left py-1.5 px-2">Category</th>
                <th className="text-left py-1.5 px-2">Provider</th>
                <th className="text-left py-1.5 px-2">Completed</th>
                <th className="text-left py-1.5 px-2">Expiry</th>
                <th className="text-right py-1.5 px-2">Hours</th>
                <th className="text-right py-1.5 px-2">Score</th>
                <th className="text-left py-1.5 px-2">Status</th>
                {isAdmin && <th className="text-center py-1.5 px-2">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(record => (
                <tr key={record.id} className="border-t border-rmpg-800 hover:bg-rmpg-800/30 transition-colors">
                  <td className="py-1.5 px-2 text-rmpg-100">{record.officer_name}</td>
                  <td className="py-1.5 px-2 text-rmpg-100 font-medium">{record.course_name}</td>
                  <td className="py-1.5 px-2">
                    <span className={`inline-block px-1.5 py-0.5 text-[9px] font-bold uppercase border ${CATEGORY_COLORS[record.category] || CATEGORY_COLORS.other}`}>
                      {record.category.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-rmpg-400">{record.provider || '—'}</td>
                  <td className="py-1.5 px-2 text-rmpg-300 font-mono text-[10px]">
                    {record.completed_date ? formatDate(record.completed_date) : '—'}
                  </td>
                  <td className="py-1.5 px-2 text-rmpg-300 font-mono text-[10px]">
                    {record.expiry_date ? (
                      <span className="flex items-center gap-1">
                        <span className={
                          new Date(record.expiry_date) < new Date() ? 'text-red-400 font-bold' :
                          new Date(record.expiry_date) <= new Date(Date.now() + 30 * 86400000) ? 'text-amber-400' : ''
                        }>{formatDate(record.expiry_date)}</span>
                        {new Date(record.expiry_date) < new Date() && (
                          <span className="text-[8px] px-1 py-0 bg-red-900/50 text-red-400 border border-red-700/50 font-bold uppercase">EXPIRED</span>
                        )}
                        {new Date(record.expiry_date) >= new Date() && new Date(record.expiry_date) <= new Date(Date.now() + 30 * 86400000) && (
                          <span className="text-[8px] px-1 py-0 bg-amber-900/50 text-amber-400 border border-amber-700/50 font-bold uppercase">EXPIRING</span>
                        )}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="py-1.5 px-2 text-right text-rmpg-200 font-mono">{record.hours || 0}</td>
                  <td className="py-1.5 px-2 text-right text-rmpg-200 font-mono">{record.score ?? '—'}</td>
                  <td className="py-1.5 px-2">
                    <StatusBadge status={record.status} />
                  </td>
                  {isAdmin && (
                    <td className="py-1.5 px-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button type="button" onClick={() => onEdit(record)} className="toolbar-btn p-1" title="Edit">
                          <Edit2 className="w-3 h-3" />
                        </button>
                        <button type="button" onClick={() => onDelete(record.id)} className="toolbar-btn p-1 text-red-400 hover:text-red-300" title="Delete">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── REQUIREMENTS TAB ───────────────────────────────────────
function RequirementsTab({ requirements, records, officers, isAdmin, onAdd, onEdit, onDelete }: {
  requirements: TrainingRequirement[];
  records: TrainingRecord[];
  officers: Officer[];
  isAdmin: boolean;
  onAdd: () => void;
  onEdit: (r: TrainingRequirement) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">
          {requirements.length} Training Requirements
        </span>
        {isAdmin && (
          <button type="button" onClick={onAdd} className="toolbar-btn-primary text-[10px] px-3 py-1 flex items-center gap-1">
            <Plus className="w-3 h-3" />
            Add Requirement
          </button>
        )}
      </div>

      {requirements.length === 0 ? (
        <EmptyState icon={Target} message="No training requirements defined." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {requirements.map(req => {
            // Count how many officers have completed this
            const activeOfficers = officers.filter(o =>
              req.required_for_roles.includes(o.role)
            );
            const completedCount = activeOfficers.filter(o =>
              records.some(r => r.officer_id === o.id && r.course_name === req.course_name && r.status === 'completed')
            ).length;
            const pct = activeOfficers.length > 0 ? Math.round((completedCount / activeOfficers.length) * 100) : 0;

            return (
              <div key={req.id} className="panel-beveled p-3 bg-surface-base">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="text-sm font-bold text-rmpg-100">{req.course_name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`inline-block px-1.5 py-0.5 text-[9px] font-bold uppercase border ${CATEGORY_COLORS[req.category] || CATEGORY_COLORS.other}`}>
                        {req.category.replace(/_/g, ' ')}
                      </span>
                      {req.is_mandatory && (
                        <span className="text-[8px] font-bold uppercase bg-red-900/50 text-red-400 border border-red-700/50 px-1.5 py-0.5">
                          Mandatory
                        </span>
                      )}
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => onEdit(req)} className="toolbar-btn p-1" title="Edit">
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button type="button" onClick={() => onDelete(req.id)} className="toolbar-btn p-1 text-red-400" title="Delete">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>

                {req.description && (
                  <p className="text-[11px] text-rmpg-400 mb-2">{req.description}</p>
                )}

                <div className="grid grid-cols-3 gap-2 text-[10px] text-rmpg-400 mb-2">
                  <div>
                    <span className="text-rmpg-500">Roles: </span>
                    <span className="text-rmpg-300">{req.required_for_roles.map(r => r.replace(/_/g, ' ')).join(', ')}</span>
                  </div>
                  <div>
                    <span className="text-rmpg-500">Min Hours: </span>
                    <span className="text-rmpg-300 font-mono">{req.minimum_hours || '—'}</span>
                  </div>
                  <div>
                    <span className="text-rmpg-500">Renewal: </span>
                    <span className="text-rmpg-300 font-mono">{req.renewal_period_months ? `${req.renewal_period_months}mo` : 'None'}</span>
                  </div>
                </div>

                {/* Compliance bar */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-rmpg-700 rounded-sm overflow-hidden">
                    <div
                      className="h-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444',
                      }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-rmpg-300">
                    {completedCount}/{activeOfficers.length} ({pct}%)
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── CALENDAR TAB ───────────────────────────────────────────
function CalendarTab({ records, requirements }: {
  records: TrainingRecord[];
  requirements: TrainingRequirement[];
}) {
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const { year, month } = viewMonth;
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  // Events for this month
  const monthEvents = useMemo(() => {
    const events: { day: number; type: 'completed' | 'expiring' | 'scheduled'; record: TrainingRecord }[] = [];
    for (const r of records) {
      if (r.completed_date) {
        const d = parseTimestamp(r.completed_date);
        if (d.getFullYear() === year && d.getMonth() === month) {
          events.push({ day: d.getDate(), type: 'completed', record: r });
        }
      }
      if (r.expiry_date) {
        const d = parseTimestamp(r.expiry_date);
        if (d.getFullYear() === year && d.getMonth() === month) {
          events.push({ day: d.getDate(), type: 'expiring', record: r });
        }
      }
      if (r.status === 'scheduled' && r.created_at) {
        const d = parseTimestamp(r.created_at);
        if (d.getFullYear() === year && d.getMonth() === month) {
          events.push({ day: d.getDate(), type: 'scheduled', record: r });
        }
      }
    }
    return events;
  }, [records, year, month]);

  const prevMonth = () => {
    setViewMonth(v => v.month === 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: v.month - 1 });
  };
  const nextMonth = () => {
    setViewMonth(v => v.month === 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: v.month + 1 });
  };

  const monthName = new Date(year, month).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const today = new Date();
  const isToday = (day: number) => today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;

  const days: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);

  return (
    <div className="p-4 space-y-3">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <button type="button" onClick={prevMonth} className="toolbar-btn text-[10px] px-3 py-1">← Prev</button>
        <span className="text-sm font-bold text-rmpg-100">{monthName}</span>
        <button type="button" onClick={nextMonth} className="toolbar-btn text-[10px] px-3 py-1">Next →</button>
      </div>

      {/* Calendar grid */}
      <div className="panel-beveled">
        <div className="grid grid-cols-7">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider text-center py-2 border-b border-rmpg-700">
              {d}
            </div>
          ))}
          {days.map((day, i) => {
            const dayEvents = day ? monthEvents.filter(e => e.day === day) : [];
            return (
              <div
                key={i}
                className={`min-h-[80px] border-b border-r border-rmpg-800/30 p-1 ${
                  day && isToday(day) ? 'bg-brand-900/20' : day ? 'bg-surface-base' : 'bg-surface-sunken'
                }`}
              >
                {day && (
                  <>
                    <span className={`text-[10px] font-mono ${isToday(day) ? 'text-brand-400 font-bold' : 'text-rmpg-400'}`}>
                      {day}
                    </span>
                    <div className="space-y-0.5 mt-0.5">
                      {dayEvents.slice(0, 3).map((ev, j) => (
                        <div
                          key={j}
                          className={`text-[8px] px-1 py-0.5 truncate rounded-sm ${
                            ev.type === 'completed' ? 'bg-green-900/40 text-green-400' :
                            ev.type === 'expiring' ? 'bg-red-900/40 text-red-400' :
                            'bg-amber-900/40 text-amber-400'
                          }`}
                          title={`${ev.record.officer_name}: ${ev.record.course_name}`}
                        >
                          {ev.record.course_name}
                        </div>
                      ))}
                      {dayEvents.length > 3 && (
                        <span className="text-[8px] text-rmpg-500">+{dayEvents.length - 3} more</span>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px]">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-2 bg-green-900/60 rounded-sm" />
          <span className="text-rmpg-400">Completed</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-2 bg-red-900/60 rounded-sm" />
          <span className="text-rmpg-400">Expiring</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-2 bg-amber-900/60 rounded-sm" />
          <span className="text-rmpg-400">Scheduled</span>
        </div>
      </div>
    </div>
  );
}

// ── Shared Components ──────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const s = STATUS_COLORS[status] || STATUS_COLORS.scheduled;
  const icons: Record<string, React.ElementType> = {
    completed: CheckCircle,
    in_progress: Clock,
    scheduled: BookOpen,
    overdue: AlertTriangle,
    expired: AlertTriangle,
  };
  const Icon = icons[status] || BookOpen;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase ${s.bg} ${s.text} border ${s.border}`}>
      <Icon className="w-2.5 h-2.5" />
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function EmptyState({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div className="text-center py-16">
      <div className="w-14 h-14 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-base">
        <Icon className="w-7 h-7 text-rmpg-600" />
      </div>
      <p className="text-xs text-rmpg-500">{message}</p>
    </div>
  );
}

// ── RECORD MODAL ───────────────────────────────────────────
function RecordModal({ record, officers, requirements, onSave, onClose }: {
  record: TrainingRecord | null;
  officers: Officer[];
  requirements: TrainingRequirement[];
  onSave: (data: Partial<TrainingRecord>) => void;
  onClose: () => void;
}) {
  const isEdit = !!record;
  const [form, setForm] = useState({
    officer_id: record?.officer_id || '',
    course_name: record?.course_name || '',
    category: record?.category || 'other' as TrainingCategory,
    provider: record?.provider || '',
    completed_date: record?.completed_date || '',
    expiry_date: record?.expiry_date || '',
    score: record?.score ?? '',
    hours: record?.hours ?? 0,
    certificate_number: record?.certificate_number || '',
    status: record?.status || 'scheduled' as TrainingStatus,
    notes: record?.notes || '',
  });

  const update = (field: string, value: any) => setForm(prev => ({ ...prev, [field]: value }));

  const handleSubmit = () => {
    if (!form.officer_id || !form.course_name) return;
    onSave({
      ...form,
      score: form.score === '' ? undefined : Number(form.score),
      hours: Number(form.hours) || 0,
    } as any);
  };

  // Autofill from requirement selection
  const handleCourseSelect = (courseName: string) => {
    update('course_name', courseName);
    const req = requirements.find(r => r.course_name === courseName);
    if (req) {
      update('category', req.category);
      if (req.minimum_hours) update('hours', req.minimum_hours);
    }
  };

  return (
    <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="panel-beveled bg-surface-base w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-3 border-b border-rmpg-700">
          <h2 className="text-sm font-bold text-rmpg-100">
            {isEdit ? 'Edit Training Record' : 'Add Training Record'}
          </h2>
          <button type="button" onClick={onClose} className="toolbar-btn p-1" aria-label="Close" title="Close"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4 space-y-3">
          {/* Officer */}
          <div>
            <label className="field-label mb-1 block">Officer *</label>
            <select
              value={form.officer_id}
              onChange={e => update('officer_id', e.target.value)}
              className="input-dark w-full text-[11px] px-2 py-1.5 min-h-[36px]"
            >
              <option value="">Select officer...</option>
              {officers.map(o => (
                <option key={o.id} value={o.id}>{o.full_name} {o.badge_number ? `(${o.badge_number})` : ''}</option>
              ))}
            </select>
          </div>

          {/* Course Name (with requirement suggestions) */}
          <div>
            <label className="field-label mb-1 block">Course Name *</label>
            <input
              list="course-suggestions"
              type="text"
              value={form.course_name}
              onChange={e => handleCourseSelect(e.target.value)}
              className="input-dark w-full text-[11px] px-2 py-1.5 min-h-[36px]"
              placeholder="e.g. Firearms Qualification"
            />
            <datalist id="course-suggestions">
              {requirements.map(r => (
                <option key={r.id} value={r.course_name} />
              ))}
            </datalist>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Category */}
            <div>
              <label className="field-label mb-1 block">Category</label>
              <select
                value={form.category}
                onChange={e => update('category', e.target.value)}
                className="input-dark w-full text-[11px] px-2 py-1.5 min-h-[36px]"
              >
                {CATEGORIES.map(c => (
                  <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>

            {/* Status */}
            <div>
              <label className="field-label mb-1 block">Status</label>
              <select
                value={form.status}
                onChange={e => update('status', e.target.value)}
                className="input-dark w-full text-[11px] px-2 py-1.5 min-h-[36px]"
              >
                <option value="scheduled">Scheduled</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="overdue">Overdue</option>
                <option value="expired">Expired</option>
              </select>
            </div>
          </div>

          {/* Provider */}
          <div>
            <label className="field-label mb-1 block">Provider</label>
            <input
              type="text"
              value={form.provider}
              onChange={e => update('provider', e.target.value)}
              className="input-dark w-full text-[11px] px-2 py-1.5 min-h-[36px]"
              placeholder="e.g. Utah POST, RMPG Internal"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Completed Date */}
            <div>
              <label className="field-label mb-1 block">Completed Date</label>
              <input
                type="date"
                value={form.completed_date}
                onChange={e => update('completed_date', e.target.value)}
                className="input-dark w-full text-[11px] px-2 py-1.5 min-h-[36px]"
              />
            </div>
            {/* Expiry Date */}
            <div>
              <label className="field-label mb-1 block">Expiry Date</label>
              <input
                type="date"
                value={form.expiry_date}
                onChange={e => update('expiry_date', e.target.value)}
                className="input-dark w-full text-[11px] px-2 py-1.5 min-h-[36px]"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {/* Hours */}
            <div>
              <label className="field-label mb-1 block">Hours</label>
              <input
                type="number"
                value={form.hours}
                onChange={e => update('hours', e.target.value)}
                className="input-dark w-full text-[11px] px-2 py-1.5 min-h-[36px]"
                min="0"
                step="0.5"
              />
            </div>
            {/* Score */}
            <div>
              <label className="field-label mb-1 block">Score</label>
              <input
                type="number"
                value={form.score}
                onChange={e => update('score', e.target.value)}
                className="input-dark w-full text-[11px] px-2 py-1.5 min-h-[36px]"
                min="0"
                max="100"
              />
            </div>
            {/* Certificate Number */}
            <div>
              <label className="field-label mb-1 block">Cert #</label>
              <input
                type="text"
                value={form.certificate_number}
                onChange={e => update('certificate_number', e.target.value)}
                className="input-dark w-full text-[11px] px-2 py-1.5 min-h-[36px]"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="field-label mb-1 block">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => update('notes', e.target.value)}
              className="input-dark w-full text-[11px] px-2 py-1.5 h-16 resize-none min-h-[36px]"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-3 border-t border-rmpg-700">
          <button type="button" onClick={onClose} className="toolbar-btn text-[10px] px-4 py-1.5">Cancel</button>
          <button type="button"
            onClick={handleSubmit}
            disabled={!form.officer_id || !form.course_name}
            className="toolbar-btn-primary text-[10px] px-4 py-1.5"
          >
            {isEdit ? 'Save Changes' : 'Add Record'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── REQUIREMENT MODAL ──────────────────────────────────────
function RequirementModal({ requirement, onSave, onClose }: {
  requirement: TrainingRequirement | null;
  onSave: (data: Partial<TrainingRequirement>) => void;
  onClose: () => void;
}) {
  const isEdit = !!requirement;
  const [form, setForm] = useState({
    course_name: requirement?.course_name || '',
    category: requirement?.category || 'other' as TrainingCategory,
    required_for_roles: requirement?.required_for_roles || [] as string[],
    renewal_period_months: requirement?.renewal_period_months ?? '',
    minimum_hours: requirement?.minimum_hours ?? 0,
    is_mandatory: requirement?.is_mandatory ?? true,
    description: requirement?.description || '',
  });

  const update = (field: string, value: any) => setForm(prev => ({ ...prev, [field]: value }));

  const toggleRole = (role: string) => {
    setForm(prev => ({
      ...prev,
      required_for_roles: prev.required_for_roles.includes(role)
        ? prev.required_for_roles.filter(r => r !== role)
        : [...prev.required_for_roles, role],
    }));
  };

  const handleSubmit = () => {
    if (!form.course_name) return;
    onSave({
      ...form,
      renewal_period_months: form.renewal_period_months === '' ? 0 : Number(form.renewal_period_months),
      minimum_hours: Number(form.minimum_hours) || 0,
    } as any);
  };

  return (
    <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="panel-beveled bg-surface-base w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-3 border-b border-rmpg-700">
          <h2 className="text-sm font-bold text-rmpg-100">
            {isEdit ? 'Edit Requirement' : 'Add Training Requirement'}
          </h2>
          <button type="button" onClick={onClose} className="toolbar-btn p-1" aria-label="Close" title="Close"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4 space-y-3">
          {/* Course Name */}
          <div>
            <label className="field-label mb-1 block">Course Name *</label>
            <input
              type="text"
              value={form.course_name}
              onChange={e => update('course_name', e.target.value)}
              className="input-dark w-full text-[11px] px-2 py-1.5 min-h-[36px]"
              placeholder="e.g. Annual Firearms Qualification"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Category */}
            <div>
              <label className="field-label mb-1 block">Category</label>
              <select
                value={form.category}
                onChange={e => update('category', e.target.value)}
                className="input-dark w-full text-[11px] px-2 py-1.5 min-h-[36px]"
              >
                {CATEGORIES.map(c => (
                  <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>

            {/* Mandatory */}
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_mandatory}
                  onChange={e => update('is_mandatory', e.target.checked)}
                  className="accent-brand-500"
                />
                <span className="text-[11px] text-rmpg-300">Mandatory</span>
              </label>
            </div>
          </div>

          {/* Required for Roles */}
          <div>
            <label className="field-label mb-1 block">Required for Roles</label>
            <div className="flex flex-wrap gap-1.5">
              {ROLES.map(role => (
                <button type="button"
                  key={role}
                  onClick={() => toggleRole(role)}
                  className={`text-[10px] px-2 py-1 capitalize ${
                    form.required_for_roles.includes(role) ? 'toolbar-btn-primary' : 'toolbar-btn'
                  }`}
                >
                  {role.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Renewal Period */}
            <div>
              <label className="field-label mb-1 block">Renewal (months)</label>
              <input
                type="number"
                value={form.renewal_period_months}
                onChange={e => update('renewal_period_months', e.target.value)}
                className="input-dark w-full text-[11px] px-2 py-1.5 min-h-[36px]"
                min="0"
                placeholder="0 = no renewal"
              />
            </div>

            {/* Minimum Hours */}
            <div>
              <label className="field-label mb-1 block">Minimum Hours</label>
              <input
                type="number"
                value={form.minimum_hours}
                onChange={e => update('minimum_hours', e.target.value)}
                className="input-dark w-full text-[11px] px-2 py-1.5 min-h-[36px]"
                min="0"
                step="0.5"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="field-label mb-1 block">Description</label>
            <textarea
              value={form.description}
              onChange={e => update('description', e.target.value)}
              className="input-dark w-full text-[11px] px-2 py-1.5 h-16 resize-none min-h-[36px]"
              placeholder="Brief description of this requirement..."
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-3 border-t border-rmpg-700">
          <button type="button" onClick={onClose} className="toolbar-btn text-[10px] px-4 py-1.5">Cancel</button>
          <button type="button"
            onClick={handleSubmit}
            disabled={!form.course_name}
            className="toolbar-btn-primary text-[10px] px-4 py-1.5"
          >
            {isEdit ? 'Save Changes' : 'Add Requirement'}
          </button>
        </div>
      </div>
    </div>
  );
}
