// ============================================================
// RMPG Flex — Leave / PTO Tab
// Officer: balance cards, request form, request history
// Manager+: pending approvals, team balances, all requests
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import {
  CalendarDays, Plus, Loader2, X, Check, Clock,
  Palmtree, Thermometer, User, Filter,
} from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { useToast } from '../../../components/ToastProvider';
import { useAuth } from '../../../context/AuthContext';
import { LEAVE_TYPE_COLORS, LEAVE_STATUS_COLORS } from '../utils/hrConstants';
import type { LeaveRequest, LeaveBalance } from '../../../types';
import LeaveRequestModal, { type LeaveFormData } from '../modals/LeaveRequestModal';
import ExportButton from '../../../components/ExportButton';

// ─── Helpers ────────────────────────────────────────────────

const MANAGER_ROLES = ['admin', 'manager', 'supervisor'];

const LEAVE_TYPE_LABELS: Record<string, string> = {
  vacation: 'Vacation',
  sick: 'Sick',
  personal: 'Personal',
  bereavement: 'Bereavement',
  training: 'Training',
  unpaid: 'Unpaid',
};

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ─── Balance Card ───────────────────────────────────────────

function BalanceCard({
  label,
  icon: Icon,
  used,
  total,
  color,
}: {
  label: string;
  icon: React.ElementType;
  used: number;
  total: number;
  color: string;
}) {
  const remaining = Math.max(total - used, 0);
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;

  return (
    <div className="bg-[#141e2b] border border-[#1e3048] rounded-sm p-4 transition-all duration-200 hover:border-[#2a3f5a] hover:brightness-105">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} style={{ color }} aria-hidden="true" />
        <span className="text-xs text-rmpg-400 uppercase tracking-wide font-medium">{label}</span>
      </div>
      <div className="text-xl font-bold text-white mb-0.5 font-mono">
        {remaining} <span className="text-sm font-normal text-rmpg-400 font-sans">of {total} hrs remaining</span>
      </div>
      <div className="h-2 bg-[#0d1520] rounded-full overflow-hidden mt-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${label}: ${pct}% used`}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }}
        />
      </div>
      <div className="text-xs text-rmpg-500 mt-1">{used} hrs used</div>
    </div>
  );
}

// ─── Status Badge ───────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const color = LEAVE_STATUS_COLORS[status] || '#6b7280';
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-xs font-medium uppercase tracking-wide"
      style={{ backgroundColor: color + '22', color, border: `1px solid ${color}44` }}
    >
      {status}
    </span>
  );
}

// ─── Leave Type Pill ────────────────────────────────────────

function TypePill({ type }: { type: string }) {
  const color = LEAVE_TYPE_COLORS[type] || '#6b7280';
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs"
    >
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
      {LEAVE_TYPE_LABELS[type] || type}
    </span>
  );
}

// ─── Main Component ─────────────────────────────────────────

export default function LeaveTab() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const userRole = user?.role ?? 'officer';
  const userId = user?.id ?? '';
  const isManager = MANAGER_ROLES.includes(userRole);

  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editRequest, setEditRequest] = useState<LeaveRequest | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});

  // Manager filters
  const [filterOfficer, setFilterOfficer] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');

  // ─── Data Fetching ──────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterOfficer) params.set('officer_id', filterOfficer);
      if (filterStatus) params.set('status', filterStatus);
      if (filterType) params.set('type', filterType);
      const qs = params.toString() ? `?${params}` : '';

      const year = new Date().getFullYear();
      const [reqs, bals] = await Promise.all([
        apiFetch<LeaveRequest[]>(`/hr/leave${qs}`),
        apiFetch<LeaveBalance[]>(`/hr/leave/balances?year=${year}`),
      ]);
      setRequests(reqs);
      setBalances(Array.isArray(bals) ? bals : [bals].filter(Boolean));
    } catch (err: any) {
      addToast(err?.message || 'Failed to load leave data', 'error');
    } finally {
      setLoading(false);
    }
  }, [filterOfficer, filterStatus, filterType, addToast]);

  useEffect(() => { loadData(); }, [loadData]);

  // ─── Actions ────────────────────────────────────────────

  const handleSubmitRequest = async (data: LeaveFormData) => {
    try {
      if (editRequest) {
        await apiFetch(`/hr/leave/${editRequest.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        addToast('Leave request updated', 'success');
      } else {
        await apiFetch('/hr/leave', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        addToast('Leave request submitted', 'success');
      }
      setModalOpen(false);
      setEditRequest(null);
      loadData();
    } catch (err: any) {
      addToast(err?.message || 'Failed to submit leave request', 'error');
      throw err;
    }
  };

  const handleCancel = async (id: number) => {
    try {
      await apiFetch(`/hr/leave/${id}`, { method: 'DELETE' });
      addToast('Leave request cancelled', 'success');
      loadData();
    } catch (err: any) {
      addToast(err?.message || 'Failed to cancel leave request', 'error');
    }
  };

  const handleApprove = async (id: number) => {
    try {
      await apiFetch(`/hr/leave/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_notes: reviewNotes[id] || '' }),
      });
      addToast('Leave request approved', 'success');
      setReviewNotes(prev => { const n = { ...prev }; delete n[id]; return n; });
      loadData();
    } catch (err: any) {
      addToast(err?.message || 'Failed to approve request', 'error');
    }
  };

  const handleDeny = async (id: number) => {
    try {
      await apiFetch(`/hr/leave/${id}/deny`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_notes: reviewNotes[id] || '' }),
      });
      addToast('Leave request denied', 'success');
      setReviewNotes(prev => { const n = { ...prev }; delete n[id]; return n; });
      loadData();
    } catch (err: any) {
      addToast(err?.message || 'Failed to deny request', 'error');
    }
  };

  // ─── Derived Data ───────────────────────────────────────

  const pendingRequests = requests.filter(r => r.status === 'pending');
  const myBalance = balances.length === 1 ? balances[0] : balances.find(b => String(b.officer_id) === String(userId));

  // Unique officers from balances (for filter dropdown)
  const officerOptions = balances
    .filter(b => b.officer_name)
    .map(b => ({ id: b.officer_id, name: b.officer_name! }))
    .filter((v, i, arr) => arr.findIndex(x => x.id === v.id) === i)
    .sort((a, b) => a.name.localeCompare(b.name));

  // ─── Loading State ─────────────────────────────────────

  if (loading && requests.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={20} className="animate-spin text-rmpg-400" />
      </div>
    );
  }

  // ─── Officer View ──────────────────────────────────────

  if (!isManager) {
    return (
      <div className="p-4 space-y-4">
        {/* Balance Cards */}
        {myBalance && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <BalanceCard
              label="Vacation"
              icon={Palmtree}
              used={myBalance.vacation_used}
              total={myBalance.vacation_total}
              color={LEAVE_TYPE_COLORS.vacation}
            />
            <BalanceCard
              label="Sick"
              icon={Thermometer}
              used={myBalance.sick_used}
              total={myBalance.sick_total}
              color={LEAVE_TYPE_COLORS.sick}
            />
            <BalanceCard
              label="Personal"
              icon={User}
              used={myBalance.personal_used}
              total={myBalance.personal_total}
              color={LEAVE_TYPE_COLORS.personal}
            />
          </div>
        )}

        {/* Request Time Off Button */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-white">My Requests</h3>
          <button type="button"
            onClick={() => { setEditRequest(null); setModalOpen(true); }}
            className="toolbar-btn toolbar-btn-primary flex items-center gap-1.5"
          >
            <Plus size={12} />
            Request Time Off
          </button>
        </div>

        {/* Request History Table */}
        <div className="bg-[#141e2b] border border-[#1e3048] rounded-sm overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#1e3048] bg-[#0d1520]">
                <th className="text-left px-3 py-2 text-rmpg-400 font-medium">Type</th>
                <th className="text-left px-3 py-2 text-rmpg-400 font-medium">Dates</th>
                <th className="text-left px-3 py-2 text-rmpg-400 font-medium">Hours</th>
                <th className="text-left px-3 py-2 text-rmpg-400 font-medium">Status</th>
                <th className="text-left px-3 py-2 text-rmpg-400 font-medium">Submitted</th>
                <th className="text-right px-3 py-2 text-rmpg-400 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-rmpg-500">
                    No leave requests yet
                  </td>
                </tr>
              ) : (
                requests.map((req, i) => (
                  <tr
                    key={req.id}
                    className={`border-b border-[#1e3048] ${i % 2 === 0 ? 'bg-[#141e2b]' : 'bg-[#121a27]'}`}
                  >
                    <td className="px-3 py-2 text-white"><TypePill type={req.type} /></td>
                    <td className="px-3 py-2 text-rmpg-200">
                      {formatDate(req.start_date)} &ndash; {formatDate(req.end_date)}
                    </td>
                    <td className="px-3 py-2 text-white">{req.hours_requested}</td>
                    <td className="px-3 py-2"><StatusBadge status={req.status} /></td>
                    <td className="px-3 py-2 text-rmpg-400">{formatDateTime(req.created_at)}</td>
                    <td className="px-3 py-2 text-right">
                      {req.status === 'pending' && (
                        <div className="flex items-center justify-end gap-1">
                          <button type="button"
                            onClick={() => { setEditRequest(req); setModalOpen(true); }}
                            className="toolbar-btn text-xs"
                            title="Edit"
                          >
                            Edit
                          </button>
                          <button type="button"
                            onClick={() => handleCancel(req.id)}
                            className="toolbar-btn text-xs text-red-400 hover:text-red-300"
                            title="Cancel request"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <LeaveRequestModal
          isOpen={modalOpen}
          onClose={() => { setModalOpen(false); setEditRequest(null); }}
          onSubmit={handleSubmitRequest}
          editRequest={editRequest}
        />
      </div>
    );
  }

  // ─── Manager View ──────────────────────────────────────

  // Set document title
  useEffect(() => { document.title = 'HR - Leave \u2014 RMPG Flex'; }, []);

  // Keyboard shortcut: Escape to close modals
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setModalOpen(false); setEditRequest(null); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="p-4 space-y-4">
      {/* ── Pending Approvals ─────────────────────────────── */}
      {pendingRequests.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-white flex items-center gap-2">
            <Clock size={14} className="text-amber-400" />
            Pending Approvals
            <span
              className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold"
              style={{ backgroundColor: '#f59e0b22', color: '#f59e0b' }}
            >
              {pendingRequests.length}
            </span>
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {pendingRequests.map(req => (
              <div
                key={req.id}
                className="bg-[#141e2b] border border-[#1e3048] rounded-sm p-4 space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm font-medium text-white">{req.officer_name}</div>
                    <div className="flex items-center gap-3 mt-1">
                      <TypePill type={req.type} />
                      <span className="text-xs text-rmpg-400">
                        {formatDate(req.start_date)} &ndash; {formatDate(req.end_date)}
                      </span>
                      <span className="text-xs text-rmpg-300 font-medium">{req.hours_requested} hrs</span>
                    </div>
                  </div>
                  <StatusBadge status={req.status} />
                </div>
                {req.reason && (
                  <p className="text-xs text-rmpg-300 bg-[#0d1520] border border-[#1e3048] rounded-sm p-2">
                    {req.reason}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Notes (optional)"
                    value={reviewNotes[req.id] || ''}
                    onChange={e => setReviewNotes(prev => ({ ...prev, [req.id]: e.target.value }))}
                    className="flex-1 bg-[#0d1520] border border-[#1e3048] text-white text-xs px-2 py-1.5 rounded-sm focus:outline-none focus:border-brand-500"
                  />
                  <button type="button"
                    onClick={() => handleApprove(req.id)}
                    className="toolbar-btn flex items-center gap-1 text-xs"
                    style={{ color: '#22c55e', borderColor: '#22c55e44' }}
                  >
                    <Check size={12} />
                    Approve
                  </button>
                  <button type="button"
                    onClick={() => handleDeny(req.id)}
                    className="toolbar-btn flex items-center gap-1 text-xs"
                    style={{ color: '#ef4444', borderColor: '#ef444444' }}
                  >
                    <X size={12} />
                    Deny
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Team Balances ─────────────────────────────────── */}
      {balances.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-white flex items-center gap-2">
            <CalendarDays size={14} className="text-blue-400" />
            Team Balances ({new Date().getFullYear()})
          </h3>
          <div className="bg-[#141e2b] border border-[#1e3048] rounded-sm overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#1e3048] bg-[#0d1520]">
                  <th className="text-left px-3 py-2 text-rmpg-400 font-medium">Officer</th>
                  <th className="text-left px-3 py-2 text-rmpg-400 font-medium">Vacation</th>
                  <th className="text-left px-3 py-2 text-rmpg-400 font-medium">Sick</th>
                  <th className="text-left px-3 py-2 text-rmpg-400 font-medium">Personal</th>
                </tr>
              </thead>
              <tbody>
                {balances.map((bal, i) => (
                  <tr
                    key={bal.id}
                    className={`border-b border-[#1e3048] ${i % 2 === 0 ? 'bg-[#141e2b]' : 'bg-[#121a27]'}`}
                  >
                    <td className="px-3 py-2 text-white font-medium">{bal.officer_name || `Officer #${bal.officer_id}`}</td>
                    <td className="px-3 py-2">
                      <BalanceCell used={bal.vacation_used} total={bal.vacation_total} color={LEAVE_TYPE_COLORS.vacation} />
                    </td>
                    <td className="px-3 py-2">
                      <BalanceCell used={bal.sick_used} total={bal.sick_total} color={LEAVE_TYPE_COLORS.sick} />
                    </td>
                    <td className="px-3 py-2">
                      <BalanceCell used={bal.personal_used} total={bal.personal_total} color={LEAVE_TYPE_COLORS.personal} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── All Requests with Filters ─────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-white flex items-center gap-2">
            <Filter size={14} className="text-rmpg-400" />
            All Leave Requests
          </h3>
          <ExportButton exportUrl="/api/hr/leave/export/csv" exportFilename="leave-requests.csv" />
          <button type="button"
            onClick={() => { setEditRequest(null); setModalOpen(true); }}
            className="toolbar-btn toolbar-btn-primary flex items-center gap-1.5"
          >
            <Plus size={12} />
            New Request
          </button>
        </div>

        {/* Filter Bar */}
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={filterOfficer}
            onChange={e => setFilterOfficer(e.target.value)}
            className="bg-[#0d1520] border border-[#1e3048] text-white text-xs px-2 py-1.5 rounded-sm focus:outline-none focus:border-brand-500"
          >
            <option value="">All Officers</option>
            {officerOptions.map(o => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="bg-[#0d1520] border border-[#1e3048] text-white text-xs px-2 py-1.5 rounded-sm focus:outline-none focus:border-brand-500"
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="denied">Denied</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="bg-[#0d1520] border border-[#1e3048] text-white text-xs px-2 py-1.5 rounded-sm focus:outline-none focus:border-brand-500"
          >
            <option value="">All Types</option>
            {Object.entries(LEAVE_TYPE_LABELS).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
          {(filterOfficer || filterStatus || filterType) && (
            <button type="button"
              onClick={() => { setFilterOfficer(''); setFilterStatus(''); setFilterType(''); }}
              className="toolbar-btn text-xs text-rmpg-400 hover:text-white flex items-center gap-1"
            >
              <X size={10} />
              Clear
            </button>
          )}
        </div>

        {/* All Requests Table */}
        <div className="bg-[#141e2b] border border-[#1e3048] rounded-sm overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#1e3048] bg-[#0d1520]">
                <th className="text-left px-3 py-2 text-rmpg-400 font-medium">Officer</th>
                <th className="text-left px-3 py-2 text-rmpg-400 font-medium">Type</th>
                <th className="text-left px-3 py-2 text-rmpg-400 font-medium">Dates</th>
                <th className="text-left px-3 py-2 text-rmpg-400 font-medium">Hours</th>
                <th className="text-left px-3 py-2 text-rmpg-400 font-medium">Status</th>
                <th className="text-left px-3 py-2 text-rmpg-400 font-medium">Submitted</th>
                <th className="text-right px-3 py-2 text-rmpg-400 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-rmpg-500">
                    No leave requests found
                  </td>
                </tr>
              ) : (
                requests.map((req, i) => (
                  <tr
                    key={req.id}
                    className={`border-b border-[#1e3048] ${i % 2 === 0 ? 'bg-[#141e2b]' : 'bg-[#121a27]'}`}
                  >
                    <td className="px-3 py-2 text-white">{req.officer_name || `#${req.officer_id}`}</td>
                    <td className="px-3 py-2"><TypePill type={req.type} /></td>
                    <td className="px-3 py-2 text-rmpg-200">
                      {formatDate(req.start_date)} &ndash; {formatDate(req.end_date)}
                    </td>
                    <td className="px-3 py-2 text-white">{req.hours_requested}</td>
                    <td className="px-3 py-2"><StatusBadge status={req.status} /></td>
                    <td className="px-3 py-2 text-rmpg-400">{formatDateTime(req.created_at)}</td>
                    <td className="px-3 py-2 text-right">
                      {req.status === 'pending' && String(req.officer_id) === String(userId) && (
                        <button type="button"
                          onClick={() => handleCancel(req.id)}
                          className="toolbar-btn text-xs text-red-400 hover:text-red-300"
                          title="Cancel request"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <LeaveRequestModal
        isOpen={modalOpen}
        onClose={() => { setModalOpen(false); setEditRequest(null); }}
        onSubmit={handleSubmitRequest}
        editRequest={editRequest}
      />
    </div>
  );
}

// ─── Balance Cell (for team balances table) ─────────────────

function BalanceCell({ used, total, color }: { used: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;
  return (
    <div className="min-w-[100px]">
      <div className="text-xs text-rmpg-200 mb-0.5">
        {used} / {total}
      </div>
      <div className="h-1.5 bg-[#0d1520] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
