// ============================================================
// RMPG Flex — Shift Plans Page
// Standalone shift planning management page. Officers/units are
// assigned to geographic areas (beats/zones) for each shift.
// Uses the useShiftPlanning() hook for all state/CRUD.
// ============================================================

import React, { useState, useMemo } from 'react';
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
} from 'lucide-react';
import { useShiftPlanning, SHIFT_TYPES } from '../hooks/useShiftPlanning';
import type { ShiftPlan, ShiftType, AreaAssignment } from '../hooks/useShiftPlanning';
import { useIsMobile } from '../hooks/useIsMobile';
import StatusBadge from '../components/StatusBadge';

// ── Date helpers ───────────────────────────────────────────

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
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
      className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5"
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
    >
      {status}
    </span>
  );
}

// ── Main Component ─────────────────────────────────────────

export default function ShiftPlansPage() {
  const isMobile = useIsMobile();
  const sp = useShiftPlanning();
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newPlanName, setNewPlanName] = useState('');
  const [newPlanShift, setNewPlanShift] = useState<ShiftType>('day');
  const [editingAssignment, setEditingAssignment] = useState<string | null>(null);
  const [assignOfficerIds, setAssignOfficerIds] = useState<string[]>([]);
  const [assignUnitIds, setAssignUnitIds] = useState<string[]>([]);
  const [assignNotes, setAssignNotes] = useState('');

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
    setSelectedDate(d.toISOString().split('T')[0]);
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
    sp.duplicatePlan(planId, nextDay.toISOString().split('T')[0]);
  };

  // ── Save to server ──
  const handleSave = async (planId: string) => {
    try {
      await sp.savePlanToServer(planId);
    } catch {
      // Error logged in hook
    }
  };

  return (
    <div className="h-full flex flex-col bg-surface-base text-white overflow-hidden">
      {/* ── DATE SELECTOR BAR ─────────────────────────────── */}
      <div
        className={`${isMobile ? 'flex flex-col gap-2 px-3 py-2' : 'flex items-center justify-between px-4 py-2'} flex-shrink-0`}
        style={{ background: '#0d1520', borderBottom: '1px solid #1e3048' }}
      >
        <div className="flex items-center gap-3">
          <Calendar style={{ width: 14, height: 14, color: '#3b82f6' }} />
          <button
            onClick={() => navigateDate(-1)}
            className="text-[10px] text-rmpg-400 hover:text-white px-1"
          >
            ◀
          </button>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="bg-transparent text-white text-[11px] font-mono border border-rmpg-600 px-2 py-0.5 focus:border-blue-500 focus:outline-none"
          />
          <button
            onClick={() => navigateDate(1)}
            className="text-[10px] text-rmpg-400 hover:text-white px-1"
          >
            ▶
          </button>
          <span className="text-[11px] font-semibold text-rmpg-300">{formatDate(selectedDate)}</span>
          <button
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

          <button
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
                <button onClick={() => setShowCreateForm(false)} className="text-rmpg-500 hover:text-white">
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
                  <button
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
              <button
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
                  <button
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
                    className="px-3 py-2.5 cursor-pointer transition-colors border-b border-rmpg-800/50"
                    style={{
                      background: isSelected ? 'rgba(59,130,246,0.08)' : 'transparent',
                      borderLeft: `3px solid ${shiftConfig?.color || '#5a6e80'}`,
                    }}
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
                    <button
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
                    <button
                      onClick={() => sp.updatePlanStatus(sp.activePlan!.id, 'active')}
                      className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase bg-green-900/50 text-green-400 border border-green-700/50 hover:bg-green-800/50"
                    >
                      <Play style={{ width: 9, height: 9 }} /> Activate
                    </button>
                  )}
                  {sp.activePlan.status === 'active' && (
                    <button
                      onClick={() => sp.updatePlanStatus(sp.activePlan!.id, 'completed')}
                      className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase bg-blue-900/50 text-blue-400 border border-blue-700/50 hover:bg-blue-800/50"
                    >
                      <CheckCircle style={{ width: 9, height: 9 }} /> Complete
                    </button>
                  )}
                  <button
                    onClick={() => handleSave(sp.activePlan!.id)}
                    className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase bg-brand-900/50 text-brand-400 border border-brand-700/50 hover:bg-brand-800/50"
                    title="Save to server"
                  >
                    <Save style={{ width: 9, height: 9 }} /> Save
                  </button>
                  <button
                    onClick={() => handleDuplicate(sp.activePlan!.id)}
                    className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase text-rmpg-400 border border-rmpg-600 hover:text-white hover:border-rmpg-400"
                    title="Duplicate for next day"
                  >
                    <Copy style={{ width: 9, height: 9 }} /> Duplicate
                  </button>
                  {sp.activePlan.status !== 'archived' && (
                    <button
                      onClick={() => sp.updatePlanStatus(sp.activePlan!.id, 'archived')}
                      className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase text-rmpg-500 border border-rmpg-600 hover:text-amber-400 hover:border-amber-600"
                      title="Archive"
                    >
                      <Archive style={{ width: 9, height: 9 }} />
                    </button>
                  )}
                  <button
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
                    <button
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
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr style={{ background: '#0f1a28' }} className="text-rmpg-500 text-[9px] uppercase tracking-wider">
                        <th className="text-left px-4 py-1.5 font-bold">Area</th>
                        <th className="text-left px-4 py-1.5 font-bold">Layer</th>
                        <th className="text-left px-4 py-1.5 font-bold">Officers</th>
                        <th className="text-left px-4 py-1.5 font-bold">Units</th>
                        <th className="text-left px-4 py-1.5 font-bold">Hours</th>
                        <th className="text-left px-4 py-1.5 font-bold">Notes</th>
                        <th className="text-right px-4 py-1.5 font-bold">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sp.activePlan.assignments.map((a) => (
                        <tr
                          key={a.id}
                          className="border-b border-rmpg-800/30 hover:bg-white/[0.02] transition-colors"
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
                                {a.officerNames.map((name, i) => (
                                  <span key={i} className="text-[9px] font-mono px-1 py-px bg-blue-900/30 text-blue-400 border border-blue-800/50">
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
                                {a.unitCallSigns.map((cs, i) => (
                                  <span key={i} className="text-[9px] font-mono px-1 py-px bg-green-900/30 text-green-400 border border-green-800/50">
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
                            <button
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
    </div>
  );
}
