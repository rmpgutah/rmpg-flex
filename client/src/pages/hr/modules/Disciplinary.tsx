// ============================================================
// RMPG Flex — Disciplinary Module
// Two sub-tabs: Actions, Grievances
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle, Plus, RefreshCw, Filter, Edit2,
  ChevronDown, ChevronUp, FileWarning, UserCheck, Clock,
  CheckCircle, XCircle,
} from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import PanelTitleBar from '../../../components/PanelTitleBar';
import DisciplinaryActionModal from '../modals/DisciplinaryActionModal';
import GrievanceModal from '../modals/GrievanceModal';

// ─── Types ─────────────────────────────────────────────────

interface DisciplinaryAction {
  id: number;
  employee_id: string;
  employee_name: string;
  badge_number?: string;
  action_type: string;
  severity: string;
  incident_date: string;
  description: string;
  corrective_action: string;
  follow_up_date: string;
  status: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
  status_history?: { status: string; changed_at: string; changed_by_name: string; notes: string }[];
}

interface Grievance {
  id: number;
  grievance_number: string;
  filed_by_id: string;
  filed_by_name: string;
  against_user_id: string | null;
  against_user_name?: string;
  grievance_type: string;
  subject: string;
  description: string;
  priority: string;
  status: string;
  assigned_to_id?: string;
  assigned_to_name?: string;
  resolution?: string;
  created_at: string;
  resolved_at?: string;
}

const SUB_TABS = [
  { id: 'actions', label: 'Actions' },
  { id: 'grievances', label: 'Grievances' },
] as const;

const ACTION_TYPE_COLORS: Record<string, string> = {
  verbal_warning: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  written_warning: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
  suspension: 'bg-red-500/20 text-red-300 border-red-500/40',
  demotion: 'bg-red-600/20 text-red-400 border-red-600/40',
  termination: 'bg-red-700/20 text-red-400 border-red-700/40',
  probation: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  other: 'bg-gray-500/20 text-gray-400 border-gray-500/40',
};

const SEVERITY_COLORS: Record<string, string> = {
  minor: 'text-blue-300',
  moderate: 'text-yellow-300',
  major: 'text-orange-300',
  critical: 'text-red-300',
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  normal: 'bg-gray-500/20 text-gray-300 border-gray-500/40',
  high: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
  urgent: 'bg-red-500/20 text-red-300 border-red-500/40',
};

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  active: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  under_review: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  resolved: 'bg-green-500/20 text-green-300 border-green-500/40',
  closed: 'bg-gray-500/20 text-gray-400 border-gray-500/40',
  appealed: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
};

const formatLabel = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// ─── Component ─────────────────────────────────────────────

export default function Disciplinary() {
  const [subTab, setSubTab] = useState<string>('actions');

  return (
    <div className="flex flex-col h-full">
      <PanelTitleBar title="Disciplinary" icon={AlertTriangle}>
        <div className="flex items-center gap-0.5">
          {SUB_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className={`px-2.5 py-1 text-[11px] rounded-sm transition-colors ${
                subTab === t.id
                  ? 'bg-brand-500/25 text-white'
                  : 'text-rmpg-400 hover:text-white hover:bg-[#1a2636]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </PanelTitleBar>

      <div className="flex-1 overflow-auto p-3">
        {subTab === 'actions' && <ActionsTab />}
        {subTab === 'grievances' && <GrievancesTab />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Actions Tab
// ═══════════════════════════════════════════════════════════

function ActionsTab() {
  const [actions, setActions] = useState<DisciplinaryAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editAction, setEditAction] = useState<DisciplinaryAction | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');

  const loadActions = useCallback(async () => {
    setLoading(true);
    try {
      const params = statusFilter !== 'all' ? `?status=${statusFilter}` : '';
      const data = await apiFetch<DisciplinaryAction[]>(`/hr/disciplinary-actions${params}`);
      setActions(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { loadActions(); }, [loadActions]);

  const handleStatusChange = async (id: number, newStatus: string) => {
    try {
      await apiFetch(`/hr/disciplinary-actions/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      loadActions();
    } catch { /* ignore */ }
  };

  const handleModalSaved = () => {
    setModalOpen(false);
    setEditAction(null);
    loadActions();
  };

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-rmpg-500" />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1 text-xs text-white"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="resolved">Resolved</option>
            <option value="appealed">Appealed</option>
            <option value="closed">Closed</option>
          </select>
          <button onClick={loadActions} className="text-rmpg-500 hover:text-white p-1" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-brand-500 text-white rounded-sm hover:bg-brand-600"
        >
          <Plus className="w-3.5 h-3.5" /> New Action
        </button>
      </div>

      {loading ? (
        <div className="text-xs text-rmpg-500 text-center py-8">Loading disciplinary actions...</div>
      ) : actions.length === 0 ? (
        <div className="text-xs text-rmpg-500 text-center py-8">No disciplinary actions found.</div>
      ) : (
        <div className="border border-[#1e3048] rounded-sm overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#0d1520] text-rmpg-400">
                <th className="text-left px-3 py-2 font-medium">Employee</th>
                <th className="text-center px-3 py-2 font-medium">Type</th>
                <th className="text-center px-3 py-2 font-medium">Severity</th>
                <th className="text-left px-3 py-2 font-medium">Date</th>
                <th className="text-center px-3 py-2 font-medium">Status</th>
                <th className="text-center px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {actions.map(act => (
                <React.Fragment key={act.id}>
                  <tr
                    className="border-t border-[#1e3048] hover:bg-[#1a2636] cursor-pointer transition-colors"
                    onClick={() => setExpandedId(expandedId === act.id ? null : act.id)}
                  >
                    <td className="px-3 py-2 text-white">
                      <div className="flex items-center gap-1">
                        {expandedId === act.id ? <ChevronUp className="w-3 h-3 text-rmpg-500" /> : <ChevronDown className="w-3 h-3 text-rmpg-500" />}
                        {act.employee_name}
                        {act.badge_number && <span className="text-rmpg-500 ml-1">#{act.badge_number}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-block px-2 py-0.5 text-[10px] font-medium rounded-sm border ${ACTION_TYPE_COLORS[act.action_type] || ACTION_TYPE_COLORS.other}`}>
                        {formatLabel(act.action_type)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-[10px] font-medium uppercase ${SEVERITY_COLORS[act.severity] || 'text-rmpg-400'}`}>
                        {act.severity}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-rmpg-300 font-mono">{act.incident_date}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-block px-2 py-0.5 text-[10px] font-medium rounded-sm border ${STATUS_COLORS[act.status] || STATUS_COLORS.open}`}>
                        {formatLabel(act.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => setEditAction(act)}
                          className="p-1 text-brand-400 hover:text-brand-300 hover:bg-brand-500/10 rounded-sm"
                          title="Edit"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        {act.status === 'active' && (
                          <button
                            onClick={() => handleStatusChange(act.id, 'resolved')}
                            className="p-1 text-green-400 hover:text-green-300 hover:bg-green-500/10 rounded-sm"
                            title="Resolve"
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expandedId === act.id && (
                    <tr className="border-t border-[#1e3048]/50">
                      <td colSpan={6} className="px-6 py-3 bg-[#0d1520]/50">
                        <div className="space-y-2 text-xs">
                          <div>
                            <span className="text-rmpg-500 font-medium">Description:</span>
                            <p className="text-rmpg-300 mt-0.5 whitespace-pre-wrap">{act.description}</p>
                          </div>
                          {act.corrective_action && (
                            <div>
                              <span className="text-rmpg-500 font-medium">Corrective Action:</span>
                              <p className="text-rmpg-300 mt-0.5 whitespace-pre-wrap">{act.corrective_action}</p>
                            </div>
                          )}
                          <div className="flex gap-4">
                            {act.follow_up_date && (
                              <div>
                                <span className="text-rmpg-500">Follow-up:</span>
                                <span className="text-rmpg-300 ml-1 font-mono">{act.follow_up_date}</span>
                              </div>
                            )}
                            <div>
                              <span className="text-rmpg-500">Issued by:</span>
                              <span className="text-rmpg-300 ml-1">{act.created_by_name}</span>
                            </div>
                          </div>
                          {/* Status timeline */}
                          {act.status_history && act.status_history.length > 0 && (
                            <div className="mt-2 border-t border-[#1e3048]/50 pt-2">
                              <span className="text-rmpg-500 font-medium text-[10px]">Status History:</span>
                              <div className="mt-1 space-y-1">
                                {act.status_history.map((sh, i) => (
                                  <div key={i} className="flex items-center gap-2 text-[10px]">
                                    <Clock className="w-3 h-3 text-rmpg-600" />
                                    <span className="text-rmpg-400 font-mono">{new Date(sh.changed_at).toLocaleString()}</span>
                                    <span className={`px-1.5 py-0.5 rounded-sm border ${STATUS_COLORS[sh.status] || STATUS_COLORS.open}`}>
                                      {formatLabel(sh.status)}
                                    </span>
                                    <span className="text-rmpg-400">by {sh.changed_by_name}</span>
                                    {sh.notes && <span className="text-rmpg-500 italic">- {sh.notes}</span>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <DisciplinaryActionModal onClose={() => setModalOpen(false)} onSaved={handleModalSaved} />
      )}
      {editAction && (
        <DisciplinaryActionModal
          onClose={() => setEditAction(null)}
          onSaved={handleModalSaved}
          action={editAction}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// Grievances Tab
// ═══════════════════════════════════════════════════════════

function GrievancesTab() {
  const [grievances, setGrievances] = useState<Grievance[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [employees, setEmployees] = useState<{ id: string; full_name: string }[]>([]);
  const [assignModal, setAssignModal] = useState<number | null>(null);
  const [assignTo, setAssignTo] = useState('');
  const [resolveModal, setResolveModal] = useState<number | null>(null);
  const [resolution, setResolution] = useState('');

  const loadGrievances = useCallback(async () => {
    setLoading(true);
    try {
      const params = statusFilter !== 'all' ? `?status=${statusFilter}` : '';
      const data = await apiFetch<Grievance[]>(`/hr/grievances${params}`);
      setGrievances(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { loadGrievances(); }, [loadGrievances]);

  useEffect(() => {
    apiFetch<{ id: string; full_name: string }[]>('/hr/employees').then(setEmployees).catch(() => {});
  }, []);

  const handleModalSaved = () => {
    setModalOpen(false);
    loadGrievances();
  };

  const handleAssign = async () => {
    if (!assignModal || !assignTo) return;
    try {
      await apiFetch(`/hr/grievances/${assignModal}/assign`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigned_to_id: assignTo }),
      });
      setAssignModal(null);
      setAssignTo('');
      loadGrievances();
    } catch { /* ignore */ }
  };

  const handleResolve = async () => {
    if (!resolveModal) return;
    try {
      await apiFetch(`/hr/grievances/${resolveModal}/resolve`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution: resolution.trim() }),
      });
      setResolveModal(null);
      setResolution('');
      loadGrievances();
    } catch { /* ignore */ }
  };

  const inputClass = 'w-full bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1.5 text-xs text-white focus:border-brand-500 focus:outline-none';

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-rmpg-500" />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1 text-xs text-white"
          >
            <option value="all">All Statuses</option>
            <option value="open">Open</option>
            <option value="under_review">Under Review</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
          <button onClick={loadGrievances} className="text-rmpg-500 hover:text-white p-1" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-brand-500 text-white rounded-sm hover:bg-brand-600"
        >
          <Plus className="w-3.5 h-3.5" /> File Grievance
        </button>
      </div>

      {loading ? (
        <div className="text-xs text-rmpg-500 text-center py-8">Loading grievances...</div>
      ) : grievances.length === 0 ? (
        <div className="text-xs text-rmpg-500 text-center py-8">No grievances found.</div>
      ) : (
        <div className="border border-[#1e3048] rounded-sm overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#0d1520] text-rmpg-400">
                <th className="text-left px-3 py-2 font-medium">Number</th>
                <th className="text-left px-3 py-2 font-medium">Filed By</th>
                <th className="text-center px-3 py-2 font-medium">Type</th>
                <th className="text-left px-3 py-2 font-medium">Subject</th>
                <th className="text-center px-3 py-2 font-medium">Priority</th>
                <th className="text-center px-3 py-2 font-medium">Status</th>
                <th className="text-center px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {grievances.map(g => (
                <React.Fragment key={g.id}>
                  <tr
                    className="border-t border-[#1e3048] hover:bg-[#1a2636] cursor-pointer transition-colors"
                    onClick={() => setExpandedId(expandedId === g.id ? null : g.id)}
                  >
                    <td className="px-3 py-2 text-white font-mono">
                      <div className="flex items-center gap-1">
                        {expandedId === g.id ? <ChevronUp className="w-3 h-3 text-rmpg-500" /> : <ChevronDown className="w-3 h-3 text-rmpg-500" />}
                        {g.grievance_number}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-rmpg-300">{g.filed_by_name}</td>
                    <td className="px-3 py-2 text-center text-rmpg-300">{formatLabel(g.grievance_type)}</td>
                    <td className="px-3 py-2 text-white truncate max-w-[200px]">{g.subject}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-block px-2 py-0.5 text-[10px] font-medium rounded-sm border ${PRIORITY_COLORS[g.priority] || PRIORITY_COLORS.normal}`}>
                        {g.priority.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-block px-2 py-0.5 text-[10px] font-medium rounded-sm border ${STATUS_COLORS[g.status] || STATUS_COLORS.open}`}>
                        {formatLabel(g.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        {(g.status === 'open' || g.status === 'under_review') && (
                          <>
                            <button
                              onClick={() => setAssignModal(g.id)}
                              className="p-1 text-brand-400 hover:text-brand-300 hover:bg-brand-500/10 rounded-sm"
                              title="Assign"
                            >
                              <UserCheck className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setResolveModal(g.id)}
                              className="p-1 text-green-400 hover:text-green-300 hover:bg-green-500/10 rounded-sm"
                              title="Resolve"
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expandedId === g.id && (
                    <tr className="border-t border-[#1e3048]/50">
                      <td colSpan={7} className="px-6 py-3 bg-[#0d1520]/50">
                        <div className="space-y-2 text-xs">
                          <div>
                            <span className="text-rmpg-500 font-medium">Description:</span>
                            <p className="text-rmpg-300 mt-0.5 whitespace-pre-wrap">{g.description}</p>
                          </div>
                          <div className="flex gap-4 flex-wrap">
                            {g.against_user_name && (
                              <div>
                                <span className="text-rmpg-500">Against:</span>
                                <span className="text-rmpg-300 ml-1">{g.against_user_name}</span>
                              </div>
                            )}
                            {g.assigned_to_name && (
                              <div>
                                <span className="text-rmpg-500">Assigned to:</span>
                                <span className="text-rmpg-300 ml-1">{g.assigned_to_name}</span>
                              </div>
                            )}
                            <div>
                              <span className="text-rmpg-500">Filed:</span>
                              <span className="text-rmpg-300 ml-1 font-mono">{new Date(g.created_at).toLocaleDateString()}</span>
                            </div>
                          </div>
                          {g.resolution && (
                            <div>
                              <span className="text-rmpg-500 font-medium">Resolution:</span>
                              <p className="text-rmpg-300 mt-0.5 whitespace-pre-wrap">{g.resolution}</p>
                              {g.resolved_at && (
                                <p className="text-[10px] text-rmpg-500 mt-0.5 font-mono">
                                  Resolved: {new Date(g.resolved_at).toLocaleString()}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {modalOpen && (
        <GrievanceModal onClose={() => setModalOpen(false)} onSaved={handleModalSaved} />
      )}

      {/* Assign Modal */}
      {assignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setAssignModal(null)}>
          <div className="bg-[#141e2b] border border-[#1e3048] rounded-sm w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-2 border-b border-[#1e3048]">
              <h3 className="text-sm font-semibold text-white">Assign Grievance</h3>
            </div>
            <div className="p-4">
              <label className="block text-xs text-rmpg-400 mb-1">Assign to</label>
              <select value={assignTo} onChange={e => setAssignTo(e.target.value)} className={inputClass}>
                <option value="">Select person...</option>
                {employees.map(u => (
                  <option key={u.id} value={u.id}>{u.full_name}</option>
                ))}
              </select>
            </div>
            <div className="px-4 py-2 border-t border-[#1e3048] flex justify-end gap-2">
              <button onClick={() => setAssignModal(null)} className="px-3 py-1.5 text-xs text-rmpg-400 hover:text-white">Cancel</button>
              <button onClick={handleAssign} disabled={!assignTo} className="px-3 py-1.5 text-xs bg-brand-500 text-white rounded-sm hover:bg-brand-600 disabled:opacity-50">
                Assign
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resolve Modal */}
      {resolveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setResolveModal(null)}>
          <div className="bg-[#141e2b] border border-[#1e3048] rounded-sm w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-2 border-b border-[#1e3048]">
              <h3 className="text-sm font-semibold text-white">Resolve Grievance</h3>
            </div>
            <div className="p-4">
              <label className="block text-xs text-rmpg-400 mb-1">Resolution</label>
              <textarea
                value={resolution}
                onChange={e => setResolution(e.target.value)}
                className={`${inputClass} h-24 resize-none`}
                placeholder="Describe how this grievance was resolved..."
              />
            </div>
            <div className="px-4 py-2 border-t border-[#1e3048] flex justify-end gap-2">
              <button onClick={() => setResolveModal(null)} className="px-3 py-1.5 text-xs text-rmpg-400 hover:text-white">Cancel</button>
              <button onClick={handleResolve} className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-sm hover:bg-green-700">
                Resolve
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
