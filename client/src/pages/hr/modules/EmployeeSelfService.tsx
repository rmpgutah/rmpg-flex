// ============================================================
// RMPG Flex — Employee Self-Service Module
// Officer-facing view with cards for each HR area
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  CalendarOff, TrendingUp, Target, FileText, DollarSign,
  FileWarning, ChevronDown, ChevronUp, Plus, Star, Eye,
  Check, Clock, AlertCircle,
} from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { useAuth } from '../../../context/AuthContext';
import PanelTitleBar from '../../../components/PanelTitleBar';
import LeaveRequestModal from '../modals/LeaveRequestModal';
import GrievanceModal from '../modals/GrievanceModal';

// ─── Types ─────────────────────────────────────────────────

interface LeaveBalance {
  leave_type_id: number;
  leave_type_name: string;
  balance: number;
  used: number;
}

interface LeaveRequest {
  id: number;
  leave_type_name: string;
  start_date: string;
  end_date: string;
  hours_requested: number;
  reason: string;
  status: string;
  created_at: string;
}

interface MyReview {
  id: number;
  reviewer_name: string;
  review_date: string;
  overall_rating: number;
  strengths: string;
  status: string;
  acknowledged_at?: string;
}

interface MyGoal {
  id: number;
  title: string;
  description: string;
  target_date: string;
  progress: number;
  status: string;
}

interface MyDocument {
  id: number;
  document_name: string;
  requires_acknowledgment: boolean;
  acknowledged_at?: string;
  uploaded_at: string;
}

interface PayStub {
  id: number;
  period_name: string;
  period_start: string;
  period_end: string;
  gross_pay: number;
  total_deductions: number;
  net_pay: number;
  status: string;
}

interface MyGrievance {
  id: number;
  grievance_number: string;
  subject: string;
  grievance_type: string;
  priority: string;
  status: string;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  requested: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  approved: 'bg-green-500/20 text-green-300 border-green-500/40',
  denied: 'bg-red-500/20 text-red-300 border-red-500/40',
  cancelled: 'bg-gray-500/20 text-gray-400 border-gray-500/40',
  open: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  under_review: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  resolved: 'bg-green-500/20 text-green-300 border-green-500/40',
  closed: 'bg-gray-500/20 text-gray-400 border-gray-500/40',
  active: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  completed: 'bg-green-500/20 text-green-300 border-green-500/40',
  draft: 'bg-gray-500/20 text-gray-400 border-gray-500/40',
  submitted: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  acknowledged: 'bg-green-500/20 text-green-300 border-green-500/40',
};

const fmtCurrency = (v: number) => `$${v.toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,')}`;
const formatLabel = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// ─── Collapsible Section ─────────────────────────────────

function CollapsibleCard({
  title,
  icon: Icon,
  badge,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: React.ElementType;
  badge?: string | number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="bg-[#0d1520] border border-[#1e3048] rounded-sm">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2.5 flex items-center justify-between hover:bg-[#141e2b] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-brand-400" />
          <span className="text-xs text-white font-medium">{title}</span>
          {badge !== undefined && (
            <span className="text-[10px] text-rmpg-500 bg-[#141e2b] px-1.5 py-0.5 rounded-sm">
              {badge}
            </span>
          )}
        </div>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-rmpg-500" /> : <ChevronDown className="w-3.5 h-3.5 text-rmpg-500" />}
      </button>
      {open && (
        <div className="px-3 pb-3 border-t border-[#1e3048]/50">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Component ─────────────────────────────────────────────

export default function EmployeeSelfService() {
  const { user } = useAuth();
  const [leaveBalances, setLeaveBalances] = useState<LeaveBalance[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [reviews, setReviews] = useState<MyReview[]>([]);
  const [goals, setGoals] = useState<MyGoal[]>([]);
  const [documents, setDocuments] = useState<MyDocument[]>([]);
  const [payStubs, setPayStubs] = useState<PayStub[]>([]);
  const [grievances, setGrievances] = useState<MyGrievance[]>([]);
  const [loading, setLoading] = useState(true);
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const [grievanceModalOpen, setGrievanceModalOpen] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [bal, req, rev, gl, docs, stubs, grv] = await Promise.all([
        apiFetch<LeaveBalance[]>('/hr/my/leave-balances').catch(() => []),
        apiFetch<LeaveRequest[]>('/hr/my/leave-requests').catch(() => []),
        apiFetch<MyReview[]>('/hr/my/reviews').catch(() => []),
        apiFetch<MyGoal[]>('/hr/my/goals').catch(() => []),
        apiFetch<MyDocument[]>('/hr/my/documents').catch(() => []),
        apiFetch<PayStub[]>('/hr/my/pay-stubs').catch(() => []),
        apiFetch<MyGrievance[]>('/hr/my/grievances').catch(() => []),
      ]);
      setLeaveBalances(bal as LeaveBalance[]);
      setLeaveRequests(req as LeaveRequest[]);
      setReviews(rev as MyReview[]);
      setGoals(gl as MyGoal[]);
      setDocuments(docs as MyDocument[]);
      setPayStubs(stubs as PayStub[]);
      setGrievances(grv as MyGrievance[]);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleAcknowledgeReview = async (reviewId: number) => {
    try {
      await apiFetch(`/hr/my/reviews/${reviewId}/acknowledge`, { method: 'PUT' });
      loadData();
    } catch { /* ignore */ }
  };

  const handleAcknowledgeDoc = async (docId: number) => {
    try {
      await apiFetch(`/hr/my/documents/${docId}/acknowledge`, { method: 'PUT' });
      loadData();
    } catch { /* ignore */ }
  };

  const renderStars = (rating: number) => (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <Star key={n} className={`w-3 h-3 ${n <= rating ? 'text-yellow-400 fill-yellow-400' : 'text-rmpg-600'}`} />
      ))}
    </div>
  );

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <PanelTitleBar title="My HR Portal" icon={CalendarOff} />
        <div className="flex-1 flex items-center justify-center">
          <span className="text-xs text-rmpg-500">Loading your HR information...</span>
        </div>
      </div>
    );
  }

  const pendingDocs = documents.filter(d => d.requires_acknowledgment && !d.acknowledged_at);

  return (
    <div className="flex flex-col h-full">
      <PanelTitleBar title="My HR Portal" icon={CalendarOff}>
        <span className="text-[10px] text-rmpg-400">
          {user?.first_name} {user?.last_name}
          {user?.badge_number && ` | #${user.badge_number}`}
        </span>
      </PanelTitleBar>

      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* Alerts */}
        {pendingDocs.length > 0 && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-sm px-3 py-2 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-yellow-400 shrink-0" />
            <span className="text-xs text-yellow-300">
              You have {pendingDocs.length} document{pendingDocs.length > 1 ? 's' : ''} requiring acknowledgment.
            </span>
          </div>
        )}

        {/* ─── My Leave ──────────────────────────────── */}
        <CollapsibleCard title="My Leave" icon={CalendarOff} badge={leaveBalances.length > 0 ? `${leaveBalances.length} types` : undefined}>
          {/* Balances */}
          {leaveBalances.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mt-2 mb-3">
              {leaveBalances.map(b => (
                <div key={b.leave_type_id} className="bg-[#141e2b] border border-[#1e3048]/50 rounded-sm p-2 text-center">
                  <p className="text-[10px] text-rmpg-500 uppercase">{b.leave_type_name}</p>
                  <p className="text-lg font-mono text-white font-bold mt-0.5">{b.balance}</p>
                  <p className="text-[10px] text-rmpg-500">{b.used} used</p>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between mb-2 mt-2">
            <span className="text-[10px] text-rmpg-500 uppercase font-medium">Recent Requests</span>
            <button
              onClick={() => setLeaveModalOpen(true)}
              className="flex items-center gap-1 px-2 py-1 text-[10px] bg-brand-500 text-white rounded-sm hover:bg-brand-600"
            >
              <Plus className="w-3 h-3" /> Request Time Off
            </button>
          </div>
          {leaveRequests.length === 0 ? (
            <p className="text-xs text-rmpg-500 text-center py-2">No leave requests.</p>
          ) : (
            <div className="space-y-1">
              {leaveRequests.slice(0, 10).map(lr => (
                <div key={lr.id} className="flex items-center justify-between py-1.5 px-2 hover:bg-[#141e2b] rounded-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-white">{lr.leave_type_name}</span>
                    <span className="text-[10px] text-rmpg-400 font-mono">{lr.start_date}</span>
                    <span className="text-[10px] text-rmpg-500">{lr.hours_requested}h</span>
                  </div>
                  <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-sm border ${STATUS_COLORS[lr.status] || ''}`}>
                    {lr.status.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CollapsibleCard>

        {/* ─── My Reviews ──────────────────────────── */}
        <CollapsibleCard title="My Reviews" icon={TrendingUp} badge={reviews.length} defaultOpen={false}>
          {reviews.length === 0 ? (
            <p className="text-xs text-rmpg-500 text-center py-2 mt-2">No performance reviews.</p>
          ) : (
            <div className="space-y-2 mt-2">
              {reviews.map(rev => (
                <div key={rev.id} className="bg-[#141e2b] border border-[#1e3048]/50 rounded-sm p-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {renderStars(rev.overall_rating)}
                      <span className="text-xs text-rmpg-400">by {rev.reviewer_name}</span>
                      <span className="text-[10px] text-rmpg-500 font-mono">{rev.review_date}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-sm border ${STATUS_COLORS[rev.status] || ''}`}>
                        {formatLabel(rev.status)}
                      </span>
                      {!rev.acknowledged_at && rev.status === 'submitted' && (
                        <button
                          onClick={() => handleAcknowledgeReview(rev.id)}
                          className="flex items-center gap-1 px-2 py-0.5 text-[10px] bg-brand-500 text-white rounded-sm hover:bg-brand-600"
                        >
                          <Check className="w-3 h-3" /> Acknowledge
                        </button>
                      )}
                    </div>
                  </div>
                  {rev.strengths && (
                    <p className="text-[10px] text-rmpg-400 mt-1.5 line-clamp-2">{rev.strengths}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CollapsibleCard>

        {/* ─── My Goals ──────────────────────────── */}
        <CollapsibleCard title="My Goals" icon={Target} badge={goals.filter(g => g.status === 'active').length} defaultOpen={false}>
          {goals.length === 0 ? (
            <p className="text-xs text-rmpg-500 text-center py-2 mt-2">No goals assigned.</p>
          ) : (
            <div className="space-y-2 mt-2">
              {goals.map(g => (
                <div key={g.id} className="bg-[#141e2b] border border-[#1e3048]/50 rounded-sm p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white font-medium">{g.title}</span>
                    <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-sm border ${STATUS_COLORS[g.status] || ''}`}>
                      {g.status.toUpperCase()}
                    </span>
                  </div>
                  {g.description && (
                    <p className="text-[10px] text-rmpg-400 mt-0.5">{g.description}</p>
                  )}
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="flex-1 bg-[#0d1520] rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${g.progress >= 100 ? 'bg-green-500' : 'bg-brand-500'}`}
                        style={{ width: `${Math.min(g.progress, 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-rmpg-400 font-mono">{g.progress}%</span>
                  </div>
                  {g.target_date && (
                    <p className="text-[10px] text-rmpg-500 mt-1">Target: {g.target_date}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CollapsibleCard>

        {/* ─── My Documents ──────────────────────── */}
        <CollapsibleCard
          title="My Documents"
          icon={FileText}
          badge={pendingDocs.length > 0 ? `${pendingDocs.length} pending` : documents.length}
          defaultOpen={pendingDocs.length > 0}
        >
          {documents.length === 0 ? (
            <p className="text-xs text-rmpg-500 text-center py-2 mt-2">No documents.</p>
          ) : (
            <div className="space-y-1 mt-2">
              {documents.map(doc => (
                <div key={doc.id} className="flex items-center justify-between py-1.5 px-2 hover:bg-[#141e2b] rounded-sm">
                  <div className="flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5 text-rmpg-500" />
                    <span className="text-xs text-white">{doc.document_name}</span>
                    <span className="text-[10px] text-rmpg-500 font-mono">{new Date(doc.uploaded_at).toLocaleDateString()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {doc.requires_acknowledgment && !doc.acknowledged_at && (
                      <button
                        onClick={() => handleAcknowledgeDoc(doc.id)}
                        className="flex items-center gap-1 px-2 py-0.5 text-[10px] bg-yellow-600 text-white rounded-sm hover:bg-yellow-700"
                      >
                        <Check className="w-3 h-3" /> Acknowledge
                      </button>
                    )}
                    {doc.requires_acknowledgment && doc.acknowledged_at && (
                      <span className="text-[10px] text-green-400">Acknowledged</span>
                    )}
                    <a
                      href={`/api/hr/documents/${doc.id}/download`}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1 text-brand-400 hover:text-brand-300"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CollapsibleCard>

        {/* ─── My Pay Stubs ──────────────────────── */}
        <CollapsibleCard title="My Pay Stubs" icon={DollarSign} badge={payStubs.length} defaultOpen={false}>
          {payStubs.length === 0 ? (
            <p className="text-xs text-rmpg-500 text-center py-2 mt-2">No pay stubs available.</p>
          ) : (
            <div className="space-y-1 mt-2">
              {payStubs.map(ps => (
                <div key={ps.id} className="flex items-center justify-between py-1.5 px-2 hover:bg-[#141e2b] rounded-sm">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-white font-medium">{ps.period_name}</span>
                    <span className="text-[10px] text-rmpg-400 font-mono">{ps.period_start} - {ps.period_end}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-rmpg-500">Gross: {fmtCurrency(ps.gross_pay)}</span>
                    <span className="text-[10px] text-red-400">Ded: -{fmtCurrency(ps.total_deductions)}</span>
                    <span className="text-xs text-green-300 font-mono font-medium">{fmtCurrency(ps.net_pay)}</span>
                    <a
                      href={`/api/hr/my/pay-stubs/${ps.id}/pdf`}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1 text-brand-400 hover:text-brand-300"
                      title="View pay stub"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CollapsibleCard>

        {/* ─── My Grievances ─────────────────────── */}
        <CollapsibleCard title="My Grievances" icon={FileWarning} badge={grievances.length} defaultOpen={false}>
          <div className="flex items-center justify-end mt-2 mb-1">
            <button
              onClick={() => setGrievanceModalOpen(true)}
              className="flex items-center gap-1 px-2 py-1 text-[10px] bg-brand-500 text-white rounded-sm hover:bg-brand-600"
            >
              <Plus className="w-3 h-3" /> File Grievance
            </button>
          </div>
          {grievances.length === 0 ? (
            <p className="text-xs text-rmpg-500 text-center py-2">No grievances filed.</p>
          ) : (
            <div className="space-y-1">
              {grievances.map(g => (
                <div key={g.id} className="flex items-center justify-between py-1.5 px-2 hover:bg-[#141e2b] rounded-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-rmpg-400 font-mono">{g.grievance_number}</span>
                    <span className="text-xs text-white">{g.subject}</span>
                    <span className="text-[10px] text-rmpg-500">{formatLabel(g.grievance_type)}</span>
                  </div>
                  <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-sm border ${STATUS_COLORS[g.status] || ''}`}>
                    {formatLabel(g.status)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CollapsibleCard>
      </div>

      {/* Modals */}
      {leaveModalOpen && (
        <LeaveRequestModal
          onClose={() => setLeaveModalOpen(false)}
          onSaved={() => { setLeaveModalOpen(false); loadData(); }}
        />
      )}
      {grievanceModalOpen && (
        <GrievanceModal
          onClose={() => setGrievanceModalOpen(false)}
          onSaved={() => { setGrievanceModalOpen(false); loadData(); }}
        />
      )}
    </div>
  );
}
