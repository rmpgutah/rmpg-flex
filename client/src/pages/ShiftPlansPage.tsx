// ============================================================
// RMPG Flex — Shift Plans Page
// Standalone shift planning management page. Officers/units are
// assigned to geographic areas (beats/zones) for each shift.
// Uses the useShiftPlanning() hook for all state/CRUD.
// ============================================================

import React, {useState, useMemo, useEffect} from 'react';
import {
  Calendar,
  Plus,
  Trash2,
  Copy,
  Play,
  CheckCircle,
  Archive,
  Users,
  MapPin,
  Clock,
  ChevronRight,
  X,
  Shield,
  BarChart3,
  Save,
  AlertTriangle,
  ArrowRightLeft,
  Bell,
  TrendingUp,
} from 'lucide-react';
import { useShiftPlanning, SHIFT_TYPES } from '../hooks/useShiftPlanning';
import type { ShiftPlan, ShiftType, AreaAssignment } from '../hooks/useShiftPlanning';
import { useIsMobile } from '../hooks/useIsMobile';
import StatusBadge from '../components/StatusBadge';
import { useToast } from '../components/ToastProvider';
import ExportButton from '../components/ExportButton';
import { apiFetch } from '../hooks/useApi';
import { localToday, dateToLocalYMD } from '../utils/dateUtils';

// ── Date helpers ───────────────────────────────────────────

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function todayStr() {
  return localToday();
}

// ── Status badge helper ────────────────────────────────────

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  draft:     { bg: 'rgba(107,114,128,0.15)', text: '#9ca3af', border: '#4b5563' },
  active:    { bg: 'rgba(34,197,94,0.15)',    text: '#22c55e', border: '#16a34a' },
  completed: { bg: 'rgba(59,130,246,0.15)',   text: '#3b82f6', border: '#2563eb' },
  archived:  { bg: 'rgba(100,116,139,0.15)',  text: '#94a3b8', border: '#64748b' },
};

function PlanStatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.draft;
  return (
    <span
      className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 transition-colors duration-150"
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
      role="status"
    >
      {status}
    </span>
  );
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

export default function ShiftPlansPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const sp = useShiftPlanning();
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newPlanName, setNewPlanName] = useState('');
  const [newPlanShift, setNewPlanShift] = useState<ShiftType>('day');
  const [editingAssignment, setEditingAssignment] = useState<string | null>(null);
  const [assignOfficerIds, setAssignOfficerIds] = useState<string[]>([]);
  const [assignUnitIds, setAssignUnitIds] = useState<string[]>([]);
  const [assignNotes, setAssignNotes] = useState('');

  // ── Enhanced: Swap requests, overtime, staffing, conflicts, notifications ──
  const [swapRequests, setSwapRequests] = useState<any[]>([]);
  const [overtimeData, setOvertimeData] = useState<any>(null);
  const [staffingLevels, setStaffingLevels] = useState<any>(null);
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [shiftNotifs, setShiftNotifs] = useState<any[]>([]);

  useEffect(() => {
    apiFetch('/api/shift-plans/shift-swaps?status=pending').then(r => Array.isArray(r) ? setSwapRequests(r) : null).catch(() => {});
    apiFetch('/api/shift-plans/shift-notifications').then((r: any) => r?.notifications && setShiftNotifs(r.notifications)).catch(() => {});
  }, []);

  useEffect(() => {
    apiFetch(`/api/shift-plans/staffing-levels?date=${selectedDate}`).then((r: any) => r && setStaffingLevels(r)).catch(() => {});
    apiFetch(`/api/shift-plans/shift-plans/conflicts/${selectedDate}`).then((r: any) => r?.conflicts && setConflicts(r.conflicts)).catch(() => {});
    apiFetch(`/api/shift-plans/shift-overtime?week_start=${selectedDate}`).then((r: any) => r && setOvertimeData(r)).catch(() => {});
  }, [selectedDate]);

  // ── Computed ──
  const plansForDate = useMemo(() =>
    sp.plans.filter(p => p.date === selectedDate)
      .sort((a, b) => {
        const order = ['active', 'draft', 'completed', 'archived'];
        return order.indexOf(a.status) - order.indexOf(b.status);
      }),
    [sp.plans, selectedDate]
  );

  const stats = sp.getCoverageStats();

  // ── Date navigation ──
  const navigateDate = (delta: number) => {
    const d = new Date(selectedDate + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    setSelectedDate(dateToLocalYMD(d));
  };

  // ── Create plan ──
  const handleCreate = () => {
    if (!newPlanName.trim()) return;
    sp.createPlan(newPlanName.trim(), selectedDate, newPlanShift);
    setNewPlanName('');
    setShowCreateForm(false);
  };

  // ── Duplicate plan ──
  const handleDuplicate = (planId: string) => {
    const nextDay = new Date(selectedDate + 'T12:00:00');
    nextDay.setDate(nextDay.getDate() + 1);
    sp.duplicatePlan(planId, dateToLocalYMD(nextDay));
  };

  // ── Save to server ──
  const handleSave = async (planId: string) => {
    try {
      await sp.savePlanToServer(planId);
      addToast('Shift plan saved', 'success');
    } catch {
      addToast('Failed to save shift plan', 'error');
    }
  };

  // Set document title
  useEffect(() => { document.title = 'Shift Plans \u2014 RMPG Flex'; }, []);

  // Keyboard shortcut: Escape to close modals
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowCreateForm(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="h-full flex flex-col bg-surface-base text-white overflow-hidden">
      {/* ── DATE SELECTOR BAR ─────────────────────────────── */}
      <div
        className={`${isMobile ? 'flex flex-col gap-2 px-3 py-2' : 'flex items-center justify-between px-4 py-2'} flex-shrink-0`}
        style={{ background: '#0d1520', borderBottom: '1px solid #1e3048' }}
      >
        <div className="flex items-center gap-3">
          <Calendar style={{ width: 14, height: 14, color: '#3b82f6' }} />
          <button type="button"
            onClick={() => navigateDate(-1)}
            className="text-[10px] text-rmpg-400 hover:text-white px-1"
          >
            ◀
          </button>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            aria-label="Select shift date"
            className="bg-transparent text-white text-[11px] font-mono border border-rmpg-600 px-2 py-0.5 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30 transition-colors"
          />
          <button type="button"
            onClick={() => navigateDate(1)}
            className="text-[10px] text-rmpg-400 hover:text-white px-1"
          >
            ▶
          </button>
          <span className="text-[11px] font-semibold text-rmpg-300">{formatDate(selectedDate)}</span>
          <button type="button"
            onClick={() => setSelectedDate(todayStr())}
            className="text-[9px] text-blue-400 hover:text-blue-300 uppercase font-bold tracking-wider"
          >
            Today
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Coverage stats */}
          {sp.activePlan && (
            <div className="flex items-center gap-3 text-[9px] text-rmpg-400 mr-4">
              <span className="flex items-center gap-1">
                <MapPin style={{ width: 9, height: 9 }} />
                {stats.assigned} Areas
              </span>
              <span className="flex items-center gap-1">
                <Users style={{ width: 9, height: 9 }} />
                {stats.officers} Officers
              </span>
              <span className="flex items-center gap-1">
                <Shield style={{ width: 9, height: 9 }} />
                {stats.units} Units
              </span>
            </div>
          )}

          <ExportButton exportUrl="/api/shift-plans/export/csv" exportFilename="shift-plans.csv" />
          <button type="button"
            onClick={() => setShowCreateForm(true)}
            className="flex items-center gap-1 px-3 py-1 text-[9px] font-bold uppercase tracking-wider bg-blue-900/50 text-blue-400 border border-blue-700/50 hover:bg-blue-800/50 transition-colors"
          >
            <Plus style={{ width: 10, height: 10 }} />
            New Plan
          </button>
        </div>
      </div>

      {/* ── MAIN CONTENT ────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        {/* ── LEFT: Plan List ── */}
        <div className={`${isMobile ? (sp.activePlanId ? 'hidden' : 'w-full') : 'w-1/3'} flex flex-col border-r border-rmpg-700/50 overflow-hidden`}>
          <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider px-3 py-2" style={{ background: '#0f1a28', borderBottom: '1px solid #1e3048' }}>
            Plans for {formatDate(selectedDate)} ({plansForDate.length})
          </div>

          {/* Create form */}
          {showCreateForm && (
            <div className="p-3 border-b border-rmpg-700/50" style={{ background: 'rgba(59,130,246,0.06)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-blue-400 uppercase">New Shift Plan</span>
                <button type="button" onClick={() => setShowCreateForm(false)} className="text-rmpg-500 hover:text-white">
                  <X style={{ width: 10, height: 10 }} />
                </button>
              </div>
              <input
                type="text"
                value={newPlanName}
                onChange={(e) => setNewPlanName(e.target.value)}
                placeholder="Plan name..."
                className="w-full bg-surface-base border border-rmpg-600 text-white text-[10px] px-2 py-1 mb-2 focus:border-blue-500 focus:outline-none"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
              <div className="flex items-center gap-2 mb-2">
                {(Object.entries(SHIFT_TYPES) as [ShiftType, typeof SHIFT_TYPES[ShiftType]][]).map(([key, val]) => (
                  <button type="button"
                    key={key}
                    onClick={() => setNewPlanShift(key)}
                    className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                    style={{
                      background: newPlanShift === key ? val.color : 'transparent',
                      color: newPlanShift === key ? '#000' : val.color,
                      border: `1px solid ${val.color}`,
                    }}
                  >
                    {val.label}
                  </button>
                ))}
              </div>
              <button type="button"
                onClick={handleCreate}
                disabled={!newPlanName.trim()}
                className="w-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider bg-blue-900/50 text-blue-400 border border-blue-700/50 hover:bg-blue-800/50 transition-colors disabled:opacity-40"
              >
                Create Plan
              </button>
            </div>
          )}

          {/* Plan cards */}
          <div className="flex-1 overflow-auto">
            {plansForDate.length === 0 ? (
              <div className="flex items-center justify-center h-full text-rmpg-500 text-[10px]">
                <div className="text-center">
                  <Calendar className="w-8 h-8 mx-auto mb-2 text-rmpg-600" />
                  <p>No shift plans for this date</p>
                  <button type="button"
                    onClick={() => setShowCreateForm(true)}
                    className="text-blue-400 hover:text-blue-300 text-[10px] mt-2"
                  >
                    + Create one
                  </button>
                </div>
              </div>
            ) : (
              plansForDate.map(plan => {
                const shiftConfig = SHIFT_TYPES[plan.shiftType];
                const isSelected = sp.activePlanId === plan.id;
                return (
                  <div
                    key={plan.id}
                    onClick={() => sp.setActivePlanId(plan.id)}
                    className="px-3 py-2.5 cursor-pointer transition-all duration-150 border-b border-rmpg-800/50 hover:brightness-110"
                    style={{
                      background: isSelected ? 'rgba(59,130,246,0.08)' : 'transparent',
                      borderLeft: `3px solid ${shiftConfig?.color || '#5a6e80'}`,
                    }}
                    role="button"
                    tabIndex={0}
                    aria-selected={isSelected}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') sp.setActivePlanId(plan.id); }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold text-white">{plan.name}</span>
                        <PlanStatusBadge status={plan.status} />
                      </div>
                      {isSelected && <ChevronRight style={{ width: 10, height: 10, color: '#3b82f6' }} />}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[9px] text-rmpg-400">
                      <span style={{ color: shiftConfig?.color }}>{shiftConfig?.label}</span>
                      <span>{shiftConfig?.defaultStart} – {shiftConfig?.defaultEnd}</span>
                      <span>{plan.assignments.length} assignments</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── CENTER + RIGHT: Plan Detail & Assignments ── */}
        <div className={`${isMobile ? (sp.activePlanId ? 'w-full' : 'hidden') : 'flex-1'} flex flex-col overflow-hidden`}>
          {sp.activePlan ? (
            <>
              {/* Plan header with actions */}
              <div
                className={`${isMobile ? 'flex flex-col gap-2 px-3 py-2' : 'flex items-center justify-between px-4 py-2'} flex-shrink-0`}
                style={{ background: '#0f1a28', borderBottom: '1px solid #1e3048' }}
              >
                <div>
                  {isMobile && (
                    <button type="button"
                      onClick={() => sp.setActivePlanId(null)}
                      className="text-rmpg-400 hover:text-white text-[10px] font-bold uppercase tracking-wider mb-1"
                    >
                      ◀ Back to Plans
                    </button>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-bold text-white">{sp.activePlan.name}</span>
                    <PlanStatusBadge status={sp.activePlan.status} />
                    <span className="text-[9px] text-rmpg-500">
                      {SHIFT_TYPES[sp.activePlan.shiftType]?.label}
                    </span>
                  </div>
                  <div className="text-[9px] text-rmpg-500 mt-0.5">
                    Updated {new Date(sp.activePlan.updatedAt).toLocaleString()}
                  </div>
                </div>

                <div className={`flex items-center gap-1 ${isMobile ? 'overflow-x-auto' : ''}`}>
                  {sp.activePlan.status === 'draft' && (
                    <button type="button"
                      onClick={() => sp.updatePlanStatus(sp.activePlan!.id, 'active')}
                      className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase bg-green-900/50 text-green-400 border border-green-700/50 hover:bg-green-800/50"
                    >
                      <Play style={{ width: 9, height: 9 }} /> Activate
                    </button>
                  )}
                  {sp.activePlan.status === 'active' && (
                    <button type="button"
                      onClick={() => sp.updatePlanStatus(sp.activePlan!.id, 'completed')}
                      className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase bg-blue-900/50 text-blue-400 border border-blue-700/50 hover:bg-blue-800/50"
                    >
                      <CheckCircle style={{ width: 9, height: 9 }} /> Complete
                    </button>
                  )}
                  <button type="button"
                    onClick={() => handleSave(sp.activePlan!.id)}
                    className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase bg-brand-900/50 text-brand-400 border border-brand-700/50 hover:bg-brand-800/50"
                    title="Save to server"
                  >
                    <Save style={{ width: 9, height: 9 }} /> Save
                  </button>
                  <button type="button"
                    onClick={() => handleDuplicate(sp.activePlan!.id)}
                    className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase text-rmpg-400 border border-rmpg-600 hover:text-white hover:border-rmpg-400"
                    title="Duplicate for next day"
                  >
                    <Copy style={{ width: 9, height: 9 }} /> Duplicate
                  </button>
                  {sp.activePlan.status !== 'archived' && (
                    <button type="button"
                      onClick={() => sp.updatePlanStatus(sp.activePlan!.id, 'archived')}
                      className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase text-rmpg-500 border border-rmpg-600 hover:text-amber-400 hover:border-amber-600"
                      title="Archive"
                    >
                      <Archive style={{ width: 9, height: 9 }} />
                    </button>
                  )}
                  <button type="button"
                    onClick={() => { if (confirm('Delete this shift plan?')) sp.deletePlan(sp.activePlan!.id); }}
                    className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase text-rmpg-500 border border-rmpg-600 hover:text-red-400 hover:border-red-600"
                    title="Delete"
                  >
                    <Trash2 style={{ width: 9, height: 9 }} />
                  </button>
                </div>
              </div>

              {/* Assignments table */}
              <div className="flex-1 overflow-auto">
                <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider px-4 py-2 flex items-center justify-between"
                  style={{ background: '#0d1520', borderBottom: '1px solid #1e3048' }}
                >
                  <span>Area Assignments ({sp.activePlan.assignments.length})</span>
                  {sp.activePlan.assignments.length > 0 && (
                    <button type="button"
                      onClick={() => { if (confirm('Remove all assignments?')) sp.removeAllAssignments(); }}
                      className="text-red-500 hover:text-red-400"
                    >
                      Clear All
                    </button>
                  )}
                </div>

                {sp.activePlan.assignments.length === 0 ? (
                  <div className="flex items-center justify-center py-16 text-rmpg-500 text-[10px]">
                    <div className="text-center">
                      <MapPin className="w-8 h-8 mx-auto mb-2 text-rmpg-600" />
                      <p>No area assignments yet</p>
                      <p className="text-[9px] text-rmpg-600 mt-1">Use the Map page's shift planning overlay to select areas</p>
                    </div>
                  </div>
                ) : (
                  <div className={isMobile ? 'overflow-x-auto' : ''}>
                  <table className="w-full text-[10px]" role="table">
                    <thead className="sticky top-0 z-10">
                      <tr style={{ background: '#0f1a28' }} className="text-rmpg-500 text-[9px] uppercase tracking-wider">
                        <th className="text-left px-4 py-2 font-bold whitespace-nowrap" scope="col">Area</th>
                        <th className="text-left px-4 py-2 font-bold whitespace-nowrap" scope="col">Layer</th>
                        <th className="text-left px-4 py-2 font-bold whitespace-nowrap" scope="col">Officers</th>
                        <th className="text-left px-4 py-2 font-bold whitespace-nowrap" scope="col">Units</th>
                        <th className="text-left px-4 py-2 font-bold whitespace-nowrap" scope="col">Hours</th>
                        <th className="text-left px-4 py-2 font-bold whitespace-nowrap" scope="col">Notes</th>
                        <th className="text-right px-4 py-2 font-bold whitespace-nowrap" scope="col">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sp.activePlan.assignments.map((a) => (
                        <tr
                          key={a.id}
                          className="border-b border-rmpg-700/30 hover:bg-surface-raised/30 transition-colors"
                        >
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-1.5">
                              <MapPin style={{ width: 9, height: 9, color: a.color || '#3b82f6' }} />
                              <span className="font-semibold text-white">{a.label}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2 text-rmpg-400 capitalize">{a.layerId}</td>
                          <td className="px-4 py-2">
                            {a.officerNames.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {a.officerNames.map((name) => (
                                  <span key={name} className="text-[9px] font-mono px-1 py-px bg-blue-900/30 text-blue-400 border border-blue-800/50">
                                    {name}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-rmpg-600">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            {a.unitCallSigns.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {a.unitCallSigns.map((cs) => (
                                  <span key={cs} className="text-[9px] font-mono px-1 py-px bg-green-900/30 text-green-400 border border-green-800/50">
                                    {cs}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-rmpg-600">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-rmpg-400 font-mono">
                            {a.shiftStart && a.shiftEnd ? `${a.shiftStart}–${a.shiftEnd}` : '—'}
                          </td>
                          <td className="px-4 py-2 text-rmpg-400 truncate max-w-[120px]">{a.notes || '—'}</td>
                          <td className="px-4 py-2 text-right">
                            <button type="button"
                              onClick={() => sp.removeAssignment(a.id)}
                              className="text-rmpg-600 hover:text-red-400 transition-colors"
                              title="Remove assignment"
                            >
                              <X style={{ width: 10, height: 10 }} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                )}

                {/* Summary panel */}
                {sp.activePlan.assignments.length > 0 && (
                  <div className="px-4 py-3" style={{ background: '#0d1520', borderTop: '1px solid #1e3048' }}>
                    <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-2">Coverage Summary</div>
                    <div className={`grid ${isMobile ? 'grid-cols-2' : 'grid-cols-4'} gap-4`}>
                      <div className="p-2" style={{ background: '#0f1a28', border: '1px solid #1e3048' }}>
                        <div className="text-[18px] font-black text-blue-400">{stats.assigned}</div>
                        <div className="text-[9px] text-rmpg-500 uppercase">Areas Covered</div>
                      </div>
                      <div className="p-2" style={{ background: '#0f1a28', border: '1px solid #1e3048' }}>
                        <div className="text-[18px] font-black text-green-400">{stats.officers}</div>
                        <div className="text-[9px] text-rmpg-500 uppercase">Officers Assigned</div>
                      </div>
                      <div className="p-2" style={{ background: '#0f1a28', border: '1px solid #1e3048' }}>
                        <div className="text-[18px] font-black text-purple-400">{stats.units}</div>
                        <div className="text-[9px] text-rmpg-500 uppercase">Units Deployed</div>
                      </div>
                      <div className="p-2" style={{ background: '#0f1a28', border: '1px solid #1e3048' }}>
                        <div className="text-[18px] font-black text-amber-400">
                          {SHIFT_TYPES[sp.activePlan.shiftType]?.defaultStart}
                        </div>
                        <div className="text-[9px] text-rmpg-500 uppercase">Shift Start</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-rmpg-500">
              <div className="text-center">
                <BarChart3 className="w-10 h-10 mx-auto mb-3 text-rmpg-600" />
                <p className="text-sm">Select a shift plan to view details</p>
                <p className="text-[10px] text-rmpg-600 mt-1">or create a new plan for {formatDate(selectedDate)}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Enhanced Panels: Notifications, Staffing, Conflicts, OT, Swaps ── */}
      <div className="flex-shrink-0 border-t border-rmpg-700 bg-surface-sunken p-3 space-y-2 max-h-[240px] overflow-y-auto">
        {/* Shift Notifications */}
        {shiftNotifs.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {shiftNotifs.slice(0, 6).map((n: any, i: number) => (
              <span key={i} className={`text-[9px] px-2 py-0.5 rounded ${n.severity === 'critical' ? 'bg-red-900/30 text-red-400' : n.severity === 'warning' ? 'bg-amber-900/30 text-amber-400' : 'bg-blue-900/30 text-blue-400'}`}>
                {n.message}
              </span>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {/* Staffing Levels */}
          {staffingLevels?.levels?.map((level: any) => (
            <div key={level.shift_type || level.plan_id} className={`p-2 rounded border text-center ${level.is_understaffed ? 'bg-red-900/20 border-red-800/30' : 'bg-surface-base border-rmpg-700'}`}>
              <div className="text-[8px] text-rmpg-500 uppercase">{level.shift_type} shift</div>
              <div className={`text-sm font-bold font-mono ${level.is_understaffed ? 'text-red-400' : 'text-green-400'}`}>
                {level.staff_count}/{level.min_required}
              </div>
              <div className={`text-[8px] ${level.is_understaffed ? 'text-red-400' : 'text-green-400'}`}>{level.staffing_status}</div>
            </div>
          ))}

          {/* Conflicts for today */}
          {conflicts.length > 0 && (
            <div className="p-2 rounded border bg-amber-900/20 border-amber-800/30 text-center">
              <AlertTriangle className="w-3 h-3 text-amber-400 mx-auto mb-0.5" />
              <div className="text-sm font-bold font-mono text-amber-400">{conflicts.length}</div>
              <div className="text-[8px] text-amber-400">Conflicts</div>
            </div>
          )}

          {/* Pending Swap Requests */}
          {swapRequests.length > 0 && (
            <div className="p-2 rounded border bg-blue-900/20 border-blue-800/30 text-center">
              <ArrowRightLeft className="w-3 h-3 text-blue-400 mx-auto mb-0.5" />
              <div className="text-sm font-bold font-mono text-blue-400">{swapRequests.length}</div>
              <div className="text-[8px] text-blue-400">Swap Requests</div>
            </div>
          )}

          {/* Weekly Overtime */}
          {overtimeData?.officers?.filter((o: any) => o.is_overtime).length > 0 && (
            <div className="p-2 rounded border bg-amber-900/20 border-amber-800/30 text-center">
              <TrendingUp className="w-3 h-3 text-amber-400 mx-auto mb-0.5" />
              <div className="text-sm font-bold font-mono text-amber-400">
                {overtimeData.officers.filter((o: any) => o.is_overtime).length}
              </div>
              <div className="text-[8px] text-amber-400">In OT This Week</div>
            </div>
          )}
        </div>

        {/* Conflict Details */}
        {conflicts.length > 0 && (
          <div className="space-y-0.5">
            {conflicts.map((c: any, i: number) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1 bg-amber-900/20 rounded text-[9px] text-amber-400">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                <span className="font-bold">{c.officer_name}</span>
                <span>assigned to {c.shift_count} shifts</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
