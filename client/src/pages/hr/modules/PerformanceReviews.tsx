// ============================================================
// RMPG Flex — Performance Reviews Module
// Three sub-tabs: Reviews, Cycles, Goals
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp, Plus, Star, RefreshCw, Filter, Edit2,
  ChevronDown, ChevronUp, Calendar, Target, CheckCircle, Clock,
} from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import PanelTitleBar from '../../../components/PanelTitleBar';
import PerformanceReviewModal from '../modals/PerformanceReviewModal';

// ─── Types ─────────────────────────────────────────────────

interface PerformanceReview {
  id: number;
  employee_id: string;
  employee_name: string;
  badge_number?: string;
  reviewer_id: string;
  reviewer_name: string;
  cycle_id: number | null;
  cycle_name?: string;
  review_date: string;
  overall_rating: number;
  strengths: string;
  areas_for_improvement: string;
  goals: string;
  comments: string;
  status: string;
  acknowledged_at?: string;
  created_at: string;
}

interface ReviewCycle {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
  created_at: string;
}

interface EmployeeGoal {
  id: number;
  user_id: string;
  employee_name: string;
  title: string;
  description: string;
  target_date: string;
  progress: number;
  status: string;
  created_at: string;
}

const SUB_TABS = [
  { id: 'reviews', label: 'Reviews' },
  { id: 'cycles', label: 'Cycles' },
  { id: 'goals', label: 'Goals' },
] as const;

const REVIEW_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-500/20 text-gray-400 border-gray-500/40',
  submitted: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  acknowledged: 'bg-green-500/20 text-green-300 border-green-500/40',
  completed: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
};

const CYCLE_STATUS_COLORS: Record<string, string> = {
  open: 'bg-green-500/20 text-green-300 border-green-500/40',
  closed: 'bg-gray-500/20 text-gray-400 border-gray-500/40',
  planning: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
};

const GOAL_STATUS_COLORS: Record<string, string> = {
  active: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  completed: 'bg-green-500/20 text-green-300 border-green-500/40',
  cancelled: 'bg-gray-500/20 text-gray-400 border-gray-500/40',
  overdue: 'bg-red-500/20 text-red-300 border-red-500/40',
};

// ─── Component ─────────────────────────────────────────────

export default function PerformanceReviews() {
  const [subTab, setSubTab] = useState<string>('reviews');

  return (
    <div className="flex flex-col h-full">
      <PanelTitleBar title="Performance Reviews" icon={TrendingUp}>
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
        {subTab === 'reviews' && <ReviewsTab />}
        {subTab === 'cycles' && <CyclesTab />}
        {subTab === 'goals' && <GoalsTab />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Reviews Tab
// ═══════════════════════════════════════════════════════════

function ReviewsTab() {
  const [reviews, setReviews] = useState<PerformanceReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editReview, setEditReview] = useState<PerformanceReview | null>(null);

  const loadReviews = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<PerformanceReview[]>('/hr/performance-reviews');
      setReviews(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadReviews(); }, [loadReviews]);

  const handleModalSaved = () => {
    setModalOpen(false);
    setEditReview(null);
    loadReviews();
  };

  const renderStars = (rating: number) => (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <Star
          key={n}
          className={`w-3 h-3 ${n <= rating ? 'text-yellow-400 fill-yellow-400' : 'text-rmpg-600'}`}
        />
      ))}
    </div>
  );

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-rmpg-400">{reviews.length} reviews</span>
          <button onClick={loadReviews} className="text-rmpg-500 hover:text-white p-1" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-brand-500 text-white rounded-sm hover:bg-brand-600"
        >
          <Plus className="w-3.5 h-3.5" /> Create Review
        </button>
      </div>

      {loading ? (
        <div className="text-xs text-rmpg-500 text-center py-8">Loading reviews...</div>
      ) : reviews.length === 0 ? (
        <div className="text-xs text-rmpg-500 text-center py-8">No performance reviews found.</div>
      ) : (
        <div className="border border-[#1e3048] rounded-sm overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#0d1520] text-rmpg-400">
                <th className="text-left px-3 py-2 font-medium">Employee</th>
                <th className="text-left px-3 py-2 font-medium">Reviewer</th>
                <th className="text-center px-3 py-2 font-medium">Rating</th>
                <th className="text-center px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Date</th>
                <th className="text-center px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reviews.map(rev => (
                <React.Fragment key={rev.id}>
                  <tr
                    className="border-t border-[#1e3048] hover:bg-[#1a2636] cursor-pointer transition-colors"
                    onClick={() => setExpandedId(expandedId === rev.id ? null : rev.id)}
                  >
                    <td className="px-3 py-2 text-white">
                      <div className="flex items-center gap-1">
                        {expandedId === rev.id ? <ChevronUp className="w-3 h-3 text-rmpg-500" /> : <ChevronDown className="w-3 h-3 text-rmpg-500" />}
                        {rev.employee_name}
                        {rev.badge_number && <span className="text-rmpg-500 ml-1">#{rev.badge_number}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-rmpg-300">{rev.reviewer_name}</td>
                    <td className="px-3 py-2 text-center">{renderStars(rev.overall_rating)}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-block px-2 py-0.5 text-[10px] font-medium rounded-sm border ${REVIEW_STATUS_COLORS[rev.status] || REVIEW_STATUS_COLORS.draft}`}>
                        {rev.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-rmpg-300 font-mono">{rev.review_date}</td>
                    <td className="px-3 py-2 text-center" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => setEditReview(rev)}
                        className="p-1 text-brand-400 hover:text-brand-300 hover:bg-brand-500/10 rounded-sm"
                        title="Edit review"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                  {expandedId === rev.id && (
                    <tr className="border-t border-[#1e3048]/50">
                      <td colSpan={6} className="px-6 py-3 bg-[#0d1520]/50">
                        <div className="grid grid-cols-2 gap-4 text-xs">
                          {rev.strengths && (
                            <div>
                              <span className="text-rmpg-500 font-medium">Strengths:</span>
                              <p className="text-rmpg-300 mt-0.5 whitespace-pre-wrap">{rev.strengths}</p>
                            </div>
                          )}
                          {rev.areas_for_improvement && (
                            <div>
                              <span className="text-rmpg-500 font-medium">Areas for Improvement:</span>
                              <p className="text-rmpg-300 mt-0.5 whitespace-pre-wrap">{rev.areas_for_improvement}</p>
                            </div>
                          )}
                          {rev.goals && (
                            <div>
                              <span className="text-rmpg-500 font-medium">Goals:</span>
                              <p className="text-rmpg-300 mt-0.5 whitespace-pre-wrap">{rev.goals}</p>
                            </div>
                          )}
                          {rev.comments && (
                            <div>
                              <span className="text-rmpg-500 font-medium">Comments:</span>
                              <p className="text-rmpg-300 mt-0.5 whitespace-pre-wrap">{rev.comments}</p>
                            </div>
                          )}
                          {rev.cycle_name && (
                            <div>
                              <span className="text-rmpg-500 font-medium">Cycle:</span>
                              <p className="text-rmpg-300 mt-0.5">{rev.cycle_name}</p>
                            </div>
                          )}
                          {rev.acknowledged_at && (
                            <div>
                              <span className="text-rmpg-500 font-medium">Acknowledged:</span>
                              <p className="text-rmpg-300 mt-0.5">{new Date(rev.acknowledged_at).toLocaleString()}</p>
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
        <PerformanceReviewModal onClose={() => setModalOpen(false)} onSaved={handleModalSaved} />
      )}
      {editReview && (
        <PerformanceReviewModal
          onClose={() => setEditReview(null)}
          onSaved={handleModalSaved}
          review={editReview}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// Cycles Tab
// ═══════════════════════════════════════════════════════════

function CyclesTab() {
  const [cycles, setCycles] = useState<ReviewCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [formData, setFormData] = useState({ name: '', start_date: '', end_date: '' });
  const [saving, setSaving] = useState(false);

  const loadCycles = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<ReviewCycle[]>('/hr/review-cycles');
      setCycles(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadCycles(); }, [loadCycles]);

  const handleCreate = async () => {
    if (!formData.name.trim() || !formData.start_date || !formData.end_date) return;
    setSaving(true);
    try {
      await apiFetch('/hr/review-cycles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      setShowCreate(false);
      setFormData({ name: '', start_date: '', end_date: '' });
      loadCycles();
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleToggleStatus = async (cycle: ReviewCycle) => {
    const newStatus = cycle.status === 'open' ? 'closed' : 'open';
    try {
      await apiFetch(`/hr/review-cycles/${cycle.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      loadCycles();
    } catch { /* ignore */ }
  };

  const inputClass = 'bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1.5 text-xs text-white focus:border-brand-500 focus:outline-none';

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-rmpg-400">{cycles.length} review cycles</span>
          <button onClick={loadCycles} className="text-rmpg-500 hover:text-white p-1" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-brand-500 text-white rounded-sm hover:bg-brand-600"
        >
          <Plus className="w-3.5 h-3.5" /> New Cycle
        </button>
      </div>

      {showCreate && (
        <div className="bg-[#0d1520] border border-[#1e3048] rounded-sm p-3 mb-3">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] text-rmpg-500 mb-0.5">Name</label>
              <input
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className={inputClass + ' w-full'}
                placeholder="e.g. Q1 2026 Review"
              />
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-500 mb-0.5">Start Date</label>
              <input
                type="date"
                value={formData.start_date}
                onChange={e => setFormData({ ...formData, start_date: e.target.value })}
                className={inputClass + ' w-full'}
              />
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-500 mb-0.5">End Date</label>
              <input
                type="date"
                value={formData.end_date}
                onChange={e => setFormData({ ...formData, end_date: e.target.value })}
                className={inputClass + ' w-full'}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={() => setShowCreate(false)} className="px-2.5 py-1 text-xs text-rmpg-400 hover:text-white">
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={saving}
              className="px-2.5 py-1 text-xs bg-brand-500 text-white rounded-sm hover:bg-brand-600 disabled:opacity-50"
            >
              {saving ? 'Creating...' : 'Create Cycle'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-xs text-rmpg-500 text-center py-8">Loading cycles...</div>
      ) : cycles.length === 0 ? (
        <div className="text-xs text-rmpg-500 text-center py-8">No review cycles found.</div>
      ) : (
        <div className="space-y-2">
          {cycles.map(c => (
            <div key={c.id} className="bg-[#0d1520] border border-[#1e3048] rounded-sm p-3 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5 text-brand-400" />
                  <span className="text-sm text-white font-medium">{c.name}</span>
                  <span className={`px-2 py-0.5 text-[10px] font-medium rounded-sm border ${CYCLE_STATUS_COLORS[c.status] || CYCLE_STATUS_COLORS.closed}`}>
                    {c.status.toUpperCase()}
                  </span>
                </div>
                <p className="text-[10px] text-rmpg-400 mt-1 font-mono">
                  {c.start_date} to {c.end_date}
                </p>
              </div>
              <button
                onClick={() => handleToggleStatus(c)}
                className={`px-2.5 py-1 text-xs rounded-sm border ${
                  c.status === 'open'
                    ? 'border-red-500/40 text-red-300 hover:bg-red-500/10'
                    : 'border-green-500/40 text-green-300 hover:bg-green-500/10'
                }`}
              >
                {c.status === 'open' ? 'Close Cycle' : 'Reopen'}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// Goals Tab
// ═══════════════════════════════════════════════════════════

function GoalsTab() {
  const [goals, setGoals] = useState<EmployeeGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [editingGoalId, setEditingGoalId] = useState<number | null>(null);
  const [editProgress, setEditProgress] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [employees, setEmployees] = useState<{ id: string; full_name: string }[]>([]);
  const [newGoal, setNewGoal] = useState({ user_id: '', title: '', description: '', target_date: '' });
  const [saving, setSaving] = useState(false);

  const loadGoals = useCallback(async () => {
    setLoading(true);
    try {
      const params = statusFilter !== 'all' ? `?status=${statusFilter}` : '';
      const data = await apiFetch<EmployeeGoal[]>(`/hr/goals${params}`);
      setGoals(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { loadGoals(); }, [loadGoals]);

  useEffect(() => {
    apiFetch<{ id: string; full_name: string }[]>('/hr/employees').then(setEmployees).catch(() => {});
  }, []);

  const handleUpdateProgress = async (goalId: number) => {
    try {
      await apiFetch(`/hr/goals/${goalId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ progress: editProgress }),
      });
      setEditingGoalId(null);
      loadGoals();
    } catch { /* ignore */ }
  };

  const handleCreateGoal = async () => {
    if (!newGoal.user_id || !newGoal.title.trim()) return;
    setSaving(true);
    try {
      await apiFetch('/hr/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newGoal),
      });
      setShowCreate(false);
      setNewGoal({ user_id: '', title: '', description: '', target_date: '' });
      loadGoals();
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleCompleteGoal = async (goalId: number) => {
    try {
      await apiFetch(`/hr/goals/${goalId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed', progress: 100 }),
      });
      loadGoals();
    } catch { /* ignore */ }
  };

  const inputClass = 'bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1.5 text-xs text-white focus:border-brand-500 focus:outline-none';

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-rmpg-500" />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1 text-xs text-white"
          >
            <option value="all">All Goals</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <button onClick={loadGoals} className="text-rmpg-500 hover:text-white p-1" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-brand-500 text-white rounded-sm hover:bg-brand-600"
        >
          <Plus className="w-3.5 h-3.5" /> Add Goal
        </button>
      </div>

      {showCreate && (
        <div className="bg-[#0d1520] border border-[#1e3048] rounded-sm p-3 mb-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-rmpg-500 mb-0.5">Employee</label>
              <select
                value={newGoal.user_id}
                onChange={e => setNewGoal({ ...newGoal, user_id: e.target.value })}
                className={inputClass + ' w-full'}
              >
                <option value="">Select...</option>
                {employees.map(u => (
                  <option key={u.id} value={u.id}>{u.full_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-500 mb-0.5">Target Date</label>
              <input
                type="date"
                value={newGoal.target_date}
                onChange={e => setNewGoal({ ...newGoal, target_date: e.target.value })}
                className={inputClass + ' w-full'}
              />
            </div>
          </div>
          <div className="mt-2">
            <label className="block text-[10px] text-rmpg-500 mb-0.5">Title</label>
            <input
              value={newGoal.title}
              onChange={e => setNewGoal({ ...newGoal, title: e.target.value })}
              className={inputClass + ' w-full'}
              placeholder="Goal title..."
            />
          </div>
          <div className="mt-2">
            <label className="block text-[10px] text-rmpg-500 mb-0.5">Description</label>
            <textarea
              value={newGoal.description}
              onChange={e => setNewGoal({ ...newGoal, description: e.target.value })}
              className={inputClass + ' w-full h-14 resize-none'}
              placeholder="Goal details..."
            />
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={() => setShowCreate(false)} className="px-2.5 py-1 text-xs text-rmpg-400 hover:text-white">
              Cancel
            </button>
            <button
              onClick={handleCreateGoal}
              disabled={saving}
              className="px-2.5 py-1 text-xs bg-brand-500 text-white rounded-sm hover:bg-brand-600 disabled:opacity-50"
            >
              {saving ? 'Creating...' : 'Create Goal'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-xs text-rmpg-500 text-center py-8">Loading goals...</div>
      ) : goals.length === 0 ? (
        <div className="text-xs text-rmpg-500 text-center py-8">No goals found.</div>
      ) : (
        <div className="space-y-2">
          {goals.map(g => (
            <div key={g.id} className="bg-[#0d1520] border border-[#1e3048] rounded-sm p-3">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Target className="w-3.5 h-3.5 text-brand-400 shrink-0" />
                    <span className="text-xs text-white font-medium truncate">{g.title}</span>
                    <span className={`px-2 py-0.5 text-[10px] font-medium rounded-sm border shrink-0 ${GOAL_STATUS_COLORS[g.status] || GOAL_STATUS_COLORS.active}`}>
                      {g.status.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-[10px] text-rmpg-400 mt-0.5 ml-5">
                    {g.employee_name} | Target: {g.target_date || 'N/A'}
                  </p>
                  {g.description && (
                    <p className="text-[10px] text-rmpg-300 mt-1 ml-5">{g.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 ml-2 shrink-0">
                  {g.status === 'active' && (
                    <button
                      onClick={() => handleCompleteGoal(g.id)}
                      className="p-1 text-green-400 hover:bg-green-500/10 rounded-sm"
                      title="Mark complete"
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              <div className="mt-2 ml-5 flex items-center gap-2">
                <div className="flex-1 bg-[#141e2b] rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full bg-brand-500 rounded-full transition-all"
                    style={{ width: `${Math.min(g.progress, 100)}%` }}
                  />
                </div>
                {editingGoalId === g.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={editProgress}
                      onChange={e => setEditProgress(Math.min(100, Math.max(0, Number(e.target.value))))}
                      min={0}
                      max={100}
                      className="w-14 bg-[#141e2b] border border-[#1e3048] rounded-sm px-1 py-0.5 text-[10px] text-white text-center"
                    />
                    <button onClick={() => handleUpdateProgress(g.id)} className="text-green-400 hover:text-green-300">
                      <Check className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setEditingGoalId(g.id); setEditProgress(g.progress); }}
                    className="text-[10px] text-rmpg-400 hover:text-white font-mono min-w-[36px] text-right"
                  >
                    {g.progress}%
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
