// ============================================================
// RMPG Flex — Leave Management Module
// Three sub-tabs: Requests, Balances, Types
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  CalendarOff, Plus, Check, XCircle, RefreshCw, Filter,
  Edit2, Trash2, ChevronDown, ChevronUp,
} from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import PanelTitleBar from '../../../components/PanelTitleBar';
import LeaveRequestModal from '../modals/LeaveRequestModal';

// ─── Types ─────────────────────────────────────────────────

interface LeaveRequest {
  id: number;
  user_id: string;
  employee_name: string;
  badge_number?: string;
  leave_type_id: number;
  leave_type_name: string;
  start_date: string;
  end_date: string;
  hours_requested: number;
  reason: string;
  status: string;
  reviewer_id?: string;
  reviewer_name?: string;
  reviewer_notes?: string;
  created_at: string;
  reviewed_at?: string;
}

interface LeaveBalance {
  user_id: string;
  employee_name: string;
  badge_number?: string;
  balances: { leave_type_id: number; leave_type_name: string; balance: number; used: number; }[];
}

interface LeaveType {
  id: number;
  name: string;
  code: string;
  accrual_rate: number;
  max_balance: number;
  is_active: boolean;
}

// ─── Sub-tab constants ─────────────────────────────────────

const SUB_TABS = [
  { id: 'requests', label: 'Requests' },
  { id: 'balances', label: 'Balances' },
  { id: 'types', label: 'Types' },
] as const;

const STATUS_COLORS: Record<string, string> = {
  requested: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  approved: 'bg-green-500/20 text-green-300 border-green-500/40',
  denied: 'bg-red-500/20 text-red-300 border-red-500/40',
  cancelled: 'bg-gray-500/20 text-gray-400 border-gray-500/40',
};

// ─── Component ─────────────────────────────────────────────

export default function LeaveManagement() {
  const [subTab, setSubTab] = useState<string>('requests');

  return (
    <div className="flex flex-col h-full">
      <PanelTitleBar title="Leave Management" icon={CalendarOff}>
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
        {subTab === 'requests' && <RequestsTab />}
        {subTab === 'balances' && <BalancesTab />}
        {subTab === 'types' && <TypesTab />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Requests Tab
// ═══════════════════════════════════════════════════════════

function RequestsTab() {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [reviewRequest, setReviewRequest] = useState<LeaveRequest | null>(null);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    try {
      const params = statusFilter !== 'all' ? `?status=${statusFilter}` : '';
      const data = await apiFetch<LeaveRequest[]>(`/hr/leave-requests${params}`);
      setRequests(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  const handleQuickAction = async (id: number, action: 'approved' | 'denied') => {
    try {
      await apiFetch(`/hr/leave-requests/${id}/review`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: action, reviewer_notes: '' }),
      });
      loadRequests();
    } catch { /* ignore */ }
  };

  const handleModalSaved = () => {
    setModalOpen(false);
    setReviewRequest(null);
    loadRequests();
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
            <option value="requested">Pending</option>
            <option value="approved">Approved</option>
            <option value="denied">Denied</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <button onClick={loadRequests} className="text-rmpg-500 hover:text-white p-1" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-brand-500 text-white rounded-sm hover:bg-brand-600"
        >
          <Plus className="w-3.5 h-3.5" /> New Request
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-xs text-rmpg-500 text-center py-8">Loading leave requests...</div>
      ) : requests.length === 0 ? (
        <div className="text-xs text-rmpg-500 text-center py-8">No leave requests found.</div>
      ) : (
        <div className="border border-[#1e3048] rounded-sm overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#0d1520] text-rmpg-400">
                <th className="text-left px-3 py-2 font-medium">Employee</th>
                <th className="text-left px-3 py-2 font-medium">Type</th>
                <th className="text-left px-3 py-2 font-medium">Dates</th>
                <th className="text-right px-3 py-2 font-medium">Hours</th>
                <th className="text-center px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Requested</th>
                <th className="text-center px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.map(req => (
                <React.Fragment key={req.id}>
                  <tr
                    className="border-t border-[#1e3048] hover:bg-[#1a2636] cursor-pointer transition-colors"
                    onClick={() => setExpandedId(expandedId === req.id ? null : req.id)}
                  >
                    <td className="px-3 py-2 text-white">
                      <div className="flex items-center gap-1">
                        {expandedId === req.id ? <ChevronUp className="w-3 h-3 text-rmpg-500" /> : <ChevronDown className="w-3 h-3 text-rmpg-500" />}
                        {req.employee_name}
                        {req.badge_number && <span className="text-rmpg-500 ml-1">#{req.badge_number}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-rmpg-300">{req.leave_type_name}</td>
                    <td className="px-3 py-2 text-rmpg-300 font-mono">
                      {req.start_date}{req.start_date !== req.end_date ? ` - ${req.end_date}` : ''}
                    </td>
                    <td className="px-3 py-2 text-right text-white font-mono">{req.hours_requested}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-block px-2 py-0.5 text-[10px] font-medium rounded-sm border ${STATUS_COLORS[req.status] || STATUS_COLORS.cancelled}`}>
                        {req.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-rmpg-400 font-mono">
                      {new Date(req.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2 text-center" onClick={e => e.stopPropagation()}>
                      {req.status === 'requested' ? (
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handleQuickAction(req.id, 'approved')}
                            className="p-1 text-green-400 hover:text-green-300 hover:bg-green-500/10 rounded-sm"
                            title="Approve"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleQuickAction(req.id, 'denied')}
                            className="p-1 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-sm"
                            title="Deny"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setReviewRequest(req)}
                            className="p-1 text-brand-400 hover:text-brand-300 hover:bg-brand-500/10 rounded-sm"
                            title="Review with notes"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setReviewRequest(req)}
                          className="p-1 text-rmpg-500 hover:text-white"
                          title="View details"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                  {/* Expanded detail row */}
                  {expandedId === req.id && (
                    <tr className="border-t border-[#1e3048]/50">
                      <td colSpan={7} className="px-6 py-3 bg-[#0d1520]/50">
                        <div className="grid grid-cols-2 gap-4 text-xs">
                          <div>
                            <span className="text-rmpg-500">Reason:</span>
                            <p className="text-rmpg-300 mt-0.5 whitespace-pre-wrap">{req.reason}</p>
                          </div>
                          {req.reviewer_name && (
                            <div>
                              <span className="text-rmpg-500">Reviewed by:</span>
                              <p className="text-rmpg-300 mt-0.5">
                                {req.reviewer_name} on {req.reviewed_at ? new Date(req.reviewed_at).toLocaleDateString() : 'N/A'}
                              </p>
                              {req.reviewer_notes && (
                                <>
                                  <span className="text-rmpg-500 mt-1 block">Notes:</span>
                                  <p className="text-rmpg-300 mt-0.5">{req.reviewer_notes}</p>
                                </>
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
        <LeaveRequestModal onClose={() => setModalOpen(false)} onSaved={handleModalSaved} />
      )}
      {reviewRequest && (
        <LeaveRequestModal
          onClose={() => setReviewRequest(null)}
          onSaved={handleModalSaved}
          request={reviewRequest}
          reviewMode
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// Balances Tab
// ═══════════════════════════════════════════════════════════

function BalancesTab() {
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(true);
  const [adjustModal, setAdjustModal] = useState<{ userId: string; leaveTypeId: number; name: string } | null>(null);
  const [adjustAmount, setAdjustAmount] = useState<number>(0);
  const [adjustReason, setAdjustReason] = useState('');
  const [adjusting, setAdjusting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [bal, types] = await Promise.all([
        apiFetch<LeaveBalance[]>('/hr/leave-balances'),
        apiFetch<LeaveType[]>('/hr/leave-types'),
      ]);
      setBalances(bal);
      setLeaveTypes(types.filter(t => t.is_active));
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleAdjust = async () => {
    if (!adjustModal || adjustAmount === 0) return;
    setAdjusting(true);
    try {
      await apiFetch('/hr/leave-balances/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: adjustModal.userId,
          leave_type_id: adjustModal.leaveTypeId,
          adjustment: adjustAmount,
          reason: adjustReason.trim(),
        }),
      });
      setAdjustModal(null);
      setAdjustAmount(0);
      setAdjustReason('');
      loadData();
    } catch { /* ignore */ }
    setAdjusting(false);
  };

  if (loading) {
    return <div className="text-xs text-rmpg-500 text-center py-8">Loading balances...</div>;
  }

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-rmpg-400">{balances.length} employees</span>
        <button onClick={loadData} className="text-rmpg-500 hover:text-white p-1" title="Refresh">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {balances.length === 0 ? (
        <div className="text-xs text-rmpg-500 text-center py-8">No balance data available.</div>
      ) : (
        <div className="border border-[#1e3048] rounded-sm overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#0d1520] text-rmpg-400">
                <th className="text-left px-3 py-2 font-medium sticky left-0 bg-[#0d1520] z-10">Employee</th>
                <th className="text-left px-3 py-2 font-medium">Badge</th>
                {leaveTypes.map(lt => (
                  <th key={lt.id} className="text-center px-3 py-2 font-medium whitespace-nowrap">{lt.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {balances.map(emp => (
                <tr key={emp.user_id} className="border-t border-[#1e3048] hover:bg-[#1a2636]">
                  <td className="px-3 py-2 text-white sticky left-0 bg-inherit">{emp.employee_name}</td>
                  <td className="px-3 py-2 text-rmpg-400 font-mono">{emp.badge_number || '-'}</td>
                  {leaveTypes.map(lt => {
                    const bal = emp.balances.find(b => b.leave_type_id === lt.id);
                    return (
                      <td key={lt.id} className="px-3 py-2 text-center">
                        <button
                          onClick={() => setAdjustModal({ userId: emp.user_id, leaveTypeId: lt.id, name: `${emp.employee_name} - ${lt.name}` })}
                          className="hover:bg-brand-500/10 rounded-sm px-1.5 py-0.5"
                          title="Click to adjust"
                        >
                          <span className="text-white font-mono">{bal?.balance ?? 0}</span>
                          <span className="text-rmpg-500 mx-0.5">/</span>
                          <span className="text-rmpg-400 font-mono">{bal?.used ?? 0}</span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-2 text-[10px] text-rmpg-600">
        Format: Available / Used. Click a cell to adjust balance.
      </div>

      {/* Adjust Balance Modal */}
      {adjustModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setAdjustModal(null)}>
          <div className="bg-[#141e2b] border border-[#1e3048] rounded-sm w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-2 border-b border-[#1e3048]">
              <h3 className="text-sm font-semibold text-white">Adjust Balance</h3>
              <p className="text-[10px] text-rmpg-400 mt-0.5">{adjustModal.name}</p>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs text-rmpg-400 mb-1">Adjustment (hours)</label>
                <input
                  type="number"
                  value={adjustAmount}
                  onChange={e => setAdjustAmount(Number(e.target.value))}
                  step={0.5}
                  className="w-full bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1.5 text-xs text-white focus:border-brand-500 focus:outline-none"
                  placeholder="Positive to add, negative to subtract"
                />
              </div>
              <div>
                <label className="block text-xs text-rmpg-400 mb-1">Reason</label>
                <input
                  type="text"
                  value={adjustReason}
                  onChange={e => setAdjustReason(e.target.value)}
                  className="w-full bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1.5 text-xs text-white focus:border-brand-500 focus:outline-none"
                  placeholder="Reason for adjustment..."
                />
              </div>
            </div>
            <div className="px-4 py-2 border-t border-[#1e3048] flex justify-end gap-2">
              <button onClick={() => setAdjustModal(null)} className="px-3 py-1.5 text-xs text-rmpg-400 hover:text-white">
                Cancel
              </button>
              <button
                onClick={handleAdjust}
                disabled={adjusting || adjustAmount === 0}
                className="px-3 py-1.5 text-xs bg-brand-500 text-white rounded-sm hover:bg-brand-600 disabled:opacity-50"
              >
                {adjusting ? 'Saving...' : 'Apply'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// Types Tab (HR Admin only — CRUD leave types)
// ═══════════════════════════════════════════════════════════

function TypesTab() {
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState({ name: '', code: '', accrual_rate: 0, max_balance: 0 });
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadTypes = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<LeaveType[]>('/hr/leave-types');
      setTypes(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadTypes(); }, [loadTypes]);

  const startEdit = (lt: LeaveType) => {
    setEditingId(lt.id);
    setFormData({ name: lt.name, code: lt.code, accrual_rate: lt.accrual_rate, max_balance: lt.max_balance });
    setShowCreate(false);
  };

  const startCreate = () => {
    setEditingId(null);
    setFormData({ name: '', code: '', accrual_rate: 0, max_balance: 0 });
    setShowCreate(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.code.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        await apiFetch(`/hr/leave-types/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });
      } else {
        await apiFetch('/hr/leave-types', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });
      }
      setEditingId(null);
      setShowCreate(false);
      loadTypes();
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleToggleActive = async (lt: LeaveType) => {
    try {
      await apiFetch(`/hr/leave-types/${lt.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...lt, is_active: !lt.is_active }),
      });
      loadTypes();
    } catch { /* ignore */ }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this leave type? This cannot be undone.')) return;
    try {
      await apiFetch(`/hr/leave-types/${id}`, { method: 'DELETE' });
      loadTypes();
    } catch { /* ignore */ }
  };

  const inputClass = 'bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1.5 text-xs text-white focus:border-brand-500 focus:outline-none';

  if (loading) {
    return <div className="text-xs text-rmpg-500 text-center py-8">Loading leave types...</div>;
  }

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-rmpg-400">{types.length} leave types</span>
        <button
          onClick={startCreate}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-brand-500 text-white rounded-sm hover:bg-brand-600"
        >
          <Plus className="w-3.5 h-3.5" /> Add Type
        </button>
      </div>

      {/* Create / Edit inline form */}
      {(showCreate || editingId !== null) && (
        <div className="bg-[#0d1520] border border-[#1e3048] rounded-sm p-3 mb-3">
          <div className="grid grid-cols-4 gap-2">
            <div>
              <label className="block text-[10px] text-rmpg-500 mb-0.5">Name</label>
              <input
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className={inputClass + ' w-full'}
                placeholder="e.g. Vacation"
              />
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-500 mb-0.5">Code</label>
              <input
                value={formData.code}
                onChange={e => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                className={inputClass + ' w-full'}
                placeholder="e.g. VAC"
              />
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-500 mb-0.5">Accrual Rate (hrs/mo)</label>
              <input
                type="number"
                value={formData.accrual_rate}
                onChange={e => setFormData({ ...formData, accrual_rate: Number(e.target.value) })}
                step={0.5}
                min={0}
                className={inputClass + ' w-full'}
              />
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-500 mb-0.5">Max Balance (hrs)</label>
              <input
                type="number"
                value={formData.max_balance}
                onChange={e => setFormData({ ...formData, max_balance: Number(e.target.value) })}
                step={1}
                min={0}
                className={inputClass + ' w-full'}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <button
              onClick={() => { setEditingId(null); setShowCreate(false); }}
              className="px-2.5 py-1 text-xs text-rmpg-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-2.5 py-1 text-xs bg-brand-500 text-white rounded-sm hover:bg-brand-600 disabled:opacity-50"
            >
              {saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* Types list */}
      <div className="border border-[#1e3048] rounded-sm overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-[#0d1520] text-rmpg-400">
              <th className="text-left px-3 py-2 font-medium">Name</th>
              <th className="text-left px-3 py-2 font-medium">Code</th>
              <th className="text-right px-3 py-2 font-medium">Accrual Rate</th>
              <th className="text-right px-3 py-2 font-medium">Max Balance</th>
              <th className="text-center px-3 py-2 font-medium">Status</th>
              <th className="text-center px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {types.map(lt => (
              <tr key={lt.id} className="border-t border-[#1e3048] hover:bg-[#1a2636]">
                <td className="px-3 py-2 text-white">{lt.name}</td>
                <td className="px-3 py-2 text-rmpg-300 font-mono">{lt.code}</td>
                <td className="px-3 py-2 text-right text-rmpg-300 font-mono">{lt.accrual_rate} hrs/mo</td>
                <td className="px-3 py-2 text-right text-rmpg-300 font-mono">{lt.max_balance} hrs</td>
                <td className="px-3 py-2 text-center">
                  <button
                    onClick={() => handleToggleActive(lt)}
                    className={`px-2 py-0.5 text-[10px] font-medium rounded-sm border ${
                      lt.is_active
                        ? 'bg-green-500/20 text-green-300 border-green-500/40'
                        : 'bg-gray-500/20 text-gray-400 border-gray-500/40'
                    }`}
                  >
                    {lt.is_active ? 'ACTIVE' : 'INACTIVE'}
                  </button>
                </td>
                <td className="px-3 py-2 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <button
                      onClick={() => startEdit(lt)}
                      className="p-1 text-brand-400 hover:text-brand-300 hover:bg-brand-500/10 rounded-sm"
                      title="Edit"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(lt.id)}
                      className="p-1 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-sm"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
