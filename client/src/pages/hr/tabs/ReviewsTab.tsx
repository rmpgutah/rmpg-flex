// ============================================================
// RMPG Flex — Performance Reviews Tab
// Manager view: CRUD reviews, stats, filters
// Officer view: read-only reviews, acknowledge, rating trend
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import {
  Star, Plus, Pencil, Trash2, Loader2, Search, TrendingUp, TrendingDown,
  Minus, Clock, AlertTriangle, BarChart3, MessageSquare, Check,
} from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { useToast } from '../../../components/ToastProvider';
import { REVIEW_CATEGORIES, RATING_LABELS } from '../utils/hrConstants';
import ReviewFormModal from '../modals/ReviewFormModal';
import ExportButton from '../../../components/ExportButton';
import type { PerformanceReview, ReviewType, ReviewStatus } from '../../../types';

const MANAGER_ROLES = ['admin', 'manager', 'supervisor'];

// ── Star rating display ────────────────────────────────────
function StarRating({ rating, max = 5, size = 14 }: { rating: number; max?: number; size?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: max }, (_, i) => (
        <Star key={i} size={size} className={i < rating ? 'text-yellow-400 fill-yellow-400' : 'text-rmpg-600'} />
      ))}
    </div>
  );
}

// ── Badge helpers ──────────────────────────────────────────
const TYPE_COLORS: Record<ReviewType, string> = {
  annual: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  probationary: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  quarterly: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  improvement_plan: 'bg-red-500/20 text-red-400 border-red-500/30',
};

const TYPE_LABELS: Record<ReviewType, string> = {
  annual: 'Annual',
  probationary: 'Probationary',
  quarterly: 'Quarterly',
  improvement_plan: 'Improvement Plan',
};

const STATUS_COLORS: Record<ReviewStatus, string> = {
  draft: 'bg-rmpg-700/50 text-rmpg-400 border-rmpg-600/30',
  submitted: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  acknowledged: 'bg-green-500/20 text-green-400 border-green-500/30',
  completed: 'bg-green-500/20 text-green-400 border-green-500/30',
};

const STATUS_LABELS: Record<ReviewStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  acknowledged: 'Acknowledged',
  completed: 'Completed',
};

function formatDate(d: string | null): string {
  if (!d) return '--';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ── Main component ────────────────────────────────────────

interface ReviewsTabProps {
  userRole: string;
  userId: string;
}

export default function ReviewsTab({ userRole, userId }: ReviewsTabProps) {
  const isManager = MANAGER_ROLES.includes(userRole);
  const { addToast } = useToast();

  const [reviews, setReviews] = useState<PerformanceReview[]>([]);
  const [officers, setOfficers] = useState<Array<{ id: number; full_name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editReview, setEditReview] = useState<PerformanceReview | null>(null);

  // Filters (manager only)
  const [filterOfficer, setFilterOfficer] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Acknowledge state (officer only)
  const [ackComment, setAckComment] = useState<Record<number, string>>({});
  const [ackLoading, setAckLoading] = useState<number | null>(null);

  // Certification expiry tracking
  const [expiringCerts, setExpiringCerts] = useState<any[]>([]);
  const [certsLoading, setCertsLoading] = useState(false);

  // ── Data fetching ─────────────────────────────────────
  const fetchReviews = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterOfficer) params.set('officer_id', filterOfficer);
      if (filterType) params.set('type', filterType);
      if (filterStatus) params.set('status', filterStatus);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const res = await apiFetch<PerformanceReview[]>(`/hr/reviews${qs}`);
      if (Array.isArray(res)) setReviews(res);
    } catch {
      addToast('Failed to load reviews', 'error');
    } finally {
      setLoading(false);
    }
  }, [filterOfficer, filterType, filterStatus]);

  const fetchOfficers = useCallback(async () => {
    try {
      const res = await apiFetch<any[]>('/personnel');
      if (Array.isArray(res)) {
        setOfficers(
          res.map((p: any) => ({
            id: p.id,
            full_name: p.full_name || `${p.first_name} ${p.last_name}`,
          })),
        );
      }
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  useEffect(() => {
    if (isManager) fetchOfficers();
  }, [isManager, fetchOfficers]);

  // Fetch expiring certifications (manager only)
  const fetchExpiringCerts = useCallback(async () => {
    setCertsLoading(true);
    try {
      const data = await apiFetch<any[]>('/personnel/credentials');
      const now = new Date();
      const ninetyDays = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
      const expiring = (data || []).filter((c: any) => {
        if (!c.expiry_date) return false;
        const exp = new Date(c.expiry_date);
        return exp <= ninetyDays;
      }).sort((a: any, b: any) => new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime());
      setExpiringCerts(expiring);
    } catch { setExpiringCerts([]); }
    finally { setCertsLoading(false); }
  }, []);

  useEffect(() => {
    if (isManager) fetchExpiringCerts();
  }, [isManager, fetchExpiringCerts]);

  // ── Handlers ──────────────────────────────────────────
  const handleCreate = async (data: any) => {
    await apiFetch('/hr/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    addToast('Review created', 'success');
    fetchReviews();
  };

  const handleUpdate = async (data: any) => {
    if (!editReview) return;
    await apiFetch(`/hr/reviews/${editReview.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    addToast('Review updated', 'success');
    setEditReview(null);
    fetchReviews();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this draft review?')) return;
    try {
      await apiFetch(`/hr/reviews/${id}`, { method: 'DELETE' });
      addToast('Review deleted', 'success');
      fetchReviews();
    } catch {
      addToast('Failed to delete review', 'error');
    }
  };

  const handleAcknowledge = async (reviewId: number) => {
    setAckLoading(reviewId);
    try {
      await apiFetch(`/hr/reviews/${reviewId}/acknowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ officer_comments: ackComment[reviewId] || '' }),
      });
      addToast('Review acknowledged', 'success');
      fetchReviews();
    } catch {
      addToast('Failed to acknowledge review', 'error');
    } finally {
      setAckLoading(null);
    }
  };

  // ── Stats (manager view) ──────────────────────────────
  const stats = isManager
    ? {
        upcoming: reviews.filter(
          (r) => r.status === 'draft' && new Date(r.review_period_end) > new Date(),
        ).length,
        overdue: reviews.filter(
          (r) =>
            (r.status === 'draft' || r.status === 'submitted') &&
            new Date(r.review_period_end) < new Date(),
        ).length,
        avgRating: (() => {
          const rated = reviews.filter((r) => r.overall_rating && r.overall_rating > 0);
          if (rated.length === 0) return 0;
          return (
            rated.reduce((s, r) => s + (r.overall_rating ?? 0), 0) / rated.length
          ).toFixed(1);
        })(),
      }
    : null;

  // ── Rating trend (officer view) ───────────────────────
  const trendIndicator = !isManager && reviews.length >= 2
    ? (() => {
        const sorted = [...reviews]
          .filter((r) => r.overall_rating != null)
          .sort((a, b) => a.review_period_end.localeCompare(b.review_period_end));
        if (sorted.length < 2) return null;
        const prev = sorted[sorted.length - 2].overall_rating ?? 0;
        const curr = sorted[sorted.length - 1].overall_rating ?? 0;
        if (curr > prev) return { icon: TrendingUp, color: 'text-green-400', label: 'Improving' };
        if (curr < prev) return { icon: TrendingDown, color: 'text-red-400', label: 'Declining' };
        return { icon: Minus, color: 'text-rmpg-400', label: 'Stable' };
      })()
    : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin text-brand-500" />
      </div>
    );
  }

  // ════════════════════════════════════════════════════════
  // OFFICER VIEW
  // ════════════════════════════════════════════════════════
  if (!isManager) {
    return (
      <div className="p-4 space-y-4">
        {/* Trend indicator */}
        {trendIndicator && (
          <div className="flex items-center gap-2 px-3 py-2 bg-[#141e2b] border border-[#1e3048] rounded-sm">
            <trendIndicator.icon size={16} className={trendIndicator.color} />
            <span className="text-xs text-rmpg-300">
              Performance trend: <span className={trendIndicator.color}>{trendIndicator.label}</span>
            </span>
          </div>
        )}

        {reviews.length === 0 ? (
          <div className="text-center py-12 text-rmpg-500 text-sm">
            No performance reviews found.
          </div>
        ) : (
          <div className="space-y-3">
            {reviews.map((review) => (
              <div
                key={review.id}
                className="bg-[#141e2b] border border-[#1e3048] rounded-sm p-4 space-y-3"
              >
                {/* Header */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-white font-medium">
                      {formatDate(review.review_period_start)} &ndash;{' '}
                      {formatDate(review.review_period_end)}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 text-[10px] font-medium rounded-sm border ${TYPE_COLORS[review.type]}`}
                    >
                      {TYPE_LABELS[review.type]}
                    </span>
                  </div>
                  {review.overall_rating != null && review.overall_rating > 0 && (
                    <div className="flex items-center gap-2">
                      <StarRating rating={review.overall_rating} size={16} />
                      <span className="text-xs text-rmpg-400">
                        {RATING_LABELS[review.overall_rating]}
                      </span>
                    </div>
                  )}
                </div>

                {/* Category breakdown */}
                {review.categories && Object.keys(review.categories).length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {REVIEW_CATEGORIES.map((cat) => {
                      const val = review.categories[cat];
                      if (!val) return null;
                      return (
                        <div key={cat} className="flex flex-col gap-0.5">
                          <span className="text-[10px] text-rmpg-500 truncate">{cat}</span>
                          <StarRating rating={val} size={10} />
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Narrative */}
                {review.strengths && (
                  <div>
                    <span className="text-[10px] text-rmpg-500 uppercase tracking-wider">Strengths</span>
                    <p className="text-xs text-rmpg-300 mt-0.5">{review.strengths}</p>
                  </div>
                )}
                {review.areas_for_improvement && (
                  <div>
                    <span className="text-[10px] text-rmpg-500 uppercase tracking-wider">
                      Areas for Improvement
                    </span>
                    <p className="text-xs text-rmpg-300 mt-0.5">{review.areas_for_improvement}</p>
                  </div>
                )}

                {/* Acknowledge section */}
                {review.status === 'submitted' && (
                  <div className="border-t border-[#1e3048] pt-3 mt-3 space-y-2">
                    <textarea
                      value={ackComment[review.id] ?? ''}
                      onChange={(e) =>
                        setAckComment((prev) => ({ ...prev, [review.id]: e.target.value }))
                      }
                      rows={2}
                      placeholder="Optional comments before acknowledging..."
                      className="w-full bg-[#0d1520] border border-[#1e3048] rounded-sm px-2.5 py-1.5 text-xs text-white focus:border-brand-500 focus:outline-none resize-y"
                    />
                    <button
                      onClick={() => handleAcknowledge(review.id)}
                      disabled={ackLoading === review.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-600/80 hover:bg-green-600 text-white rounded-sm transition-colors disabled:opacity-50"
                    >
                      {ackLoading === review.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Check size={12} />
                      )}
                      Acknowledge
                    </button>
                  </div>
                )}

                {/* Officer comments (if already acknowledged) */}
                {review.officer_comments && review.status !== 'submitted' && (
                  <div className="border-t border-[#1e3048] pt-2 mt-2">
                    <span className="text-[10px] text-rmpg-500 uppercase tracking-wider flex items-center gap-1">
                      <MessageSquare size={10} /> Your Comments
                    </span>
                    <p className="text-xs text-rmpg-300 mt-0.5">{review.officer_comments}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ════════════════════════════════════════════════════════
  // MANAGER / ADMIN VIEW
  // ════════════════════════════════════════════════════════
  return (
    <div className="p-4 space-y-4">
      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-[#141e2b] border border-[#1e3048] rounded-sm p-3 flex items-center gap-3">
            <Clock size={18} className="text-blue-400 shrink-0" />
            <div>
              <div className="text-lg font-bold text-white">{stats.upcoming}</div>
              <div className="text-[10px] text-rmpg-400">Upcoming Reviews</div>
            </div>
          </div>
          <div className="bg-[#141e2b] border border-[#1e3048] rounded-sm p-3 flex items-center gap-3">
            <AlertTriangle size={18} className="text-amber-400 shrink-0" />
            <div>
              <div className="text-lg font-bold text-white">{stats.overdue}</div>
              <div className="text-[10px] text-rmpg-400">Overdue</div>
            </div>
          </div>
          <div className="bg-[#141e2b] border border-[#1e3048] rounded-sm p-3 flex items-center gap-3">
            <BarChart3 size={18} className="text-yellow-400 shrink-0" />
            <div>
              <div className="text-lg font-bold text-white">{stats.avgRating || '--'}</div>
              <div className="text-[10px] text-rmpg-400">Avg Rating</div>
            </div>
          </div>
        </div>
      )}

      {/* Certification Expiry Dashboard */}
      {isManager && expiringCerts.length > 0 && (
        <div className="bg-[#141e2b] border border-[#1e3048] rounded-sm overflow-hidden">
          <div className="px-3 py-2 border-b border-[#1e3048] flex items-center gap-2 bg-[#0d1520]">
            <AlertTriangle size={13} className="text-amber-400" />
            <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">Certification Expiry Alert</span>
            <span className="text-[9px] text-rmpg-500 ml-auto">{expiringCerts.length} expiring within 90 days</span>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {expiringCerts.map((cert: any) => {
              const now = new Date();
              const exp = new Date(cert.expiry_date);
              const daysLeft = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
              const isExpired = daysLeft < 0;
              const urgencyColor = isExpired ? 'text-red-400 bg-red-900/30' : daysLeft <= 30 ? 'text-red-400 bg-red-900/20' : daysLeft <= 60 ? 'text-amber-400 bg-amber-900/20' : 'text-yellow-400 bg-yellow-900/20';
              return (
                <div key={cert.id} className={`flex items-center gap-3 px-3 py-1.5 border-b border-[#1e3048]/50 ${urgencyColor}`}>
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isExpired ? 'bg-red-500' : daysLeft <= 30 ? 'bg-red-500 animate-pulse' : daysLeft <= 60 ? 'bg-amber-500' : 'bg-yellow-500'}`} />
                  <span className="text-[11px] text-white font-medium flex-shrink-0 w-36 truncate">{cert.officer_name || cert.full_name || '—'}</span>
                  <span className="text-[10px] text-rmpg-300 flex-1 truncate">{cert.type} — {cert.credential_number || ''}</span>
                  <span className="text-[10px] font-bold flex-shrink-0">
                    {isExpired ? `EXPIRED ${Math.abs(daysLeft)}d ago` : `${daysLeft}d remaining`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filter bar + Create button */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 text-rmpg-400">
          <Search size={14} />
        </div>
        <select
          value={filterOfficer}
          onChange={(e) => setFilterOfficer(e.target.value)}
          className="bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1 text-xs text-white focus:border-brand-500 focus:outline-none"
        >
          <option value="">All Officers</option>
          {officers.map((o) => (
            <option key={o.id} value={o.id}>
              {o.full_name}
            </option>
          ))}
        </select>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1 text-xs text-white focus:border-brand-500 focus:outline-none"
        >
          <option value="">All Types</option>
          {Object.entries(TYPE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1 text-xs text-white focus:border-brand-500 focus:outline-none"
        >
          <option value="">All Statuses</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>

        <div className="flex-1" />

        <ExportButton exportUrl="/api/hr/reviews/export/csv" exportFilename="reviews.csv" />
        <button
          onClick={() => {
            setEditReview(null);
            setModalOpen(true);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-brand-600 hover:bg-brand-500 text-white rounded-sm transition-colors"
        >
          <Plus size={14} />
          Create Review
        </button>
      </div>

      {/* Review list */}
      {reviews.length === 0 ? (
        <div className="text-center py-12 text-rmpg-500 text-sm">
          No reviews found matching filters.
        </div>
      ) : (
        <div className="space-y-2">
          {reviews.map((review) => (
            <div
              key={review.id}
              className="bg-[#141e2b] border border-[#1e3048] rounded-sm p-3 flex items-start gap-3"
            >
              {/* Avatar initial */}
              <div className="w-8 h-8 rounded-sm bg-brand-600/30 border border-brand-500/30 flex items-center justify-center text-xs font-bold text-brand-400 shrink-0">
                {(review.officer_name ?? '?')[0].toUpperCase()}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-white font-medium">
                    {review.officer_name ?? `Officer #${review.officer_id}`}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 text-[10px] font-medium rounded-sm border ${TYPE_COLORS[review.type]}`}
                  >
                    {TYPE_LABELS[review.type]}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 text-[10px] font-medium rounded-sm border ${STATUS_COLORS[review.status]}`}
                  >
                    {STATUS_LABELS[review.status]}
                  </span>
                </div>

                <div className="text-xs text-rmpg-400">
                  {formatDate(review.review_period_start)} &ndash;{' '}
                  {formatDate(review.review_period_end)}
                </div>

                {review.overall_rating != null && review.overall_rating > 0 && (
                  <div className="flex items-center gap-2 mt-1">
                    <StarRating rating={review.overall_rating} size={14} />
                    <span className="text-xs text-rmpg-400">
                      {RATING_LABELS[review.overall_rating]}
                    </span>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                {(review.status === 'draft' || review.status === 'submitted') && (
                  <button
                    onClick={() => {
                      setEditReview(review);
                      setModalOpen(true);
                    }}
                    className="p-1.5 text-rmpg-400 hover:text-white transition-colors"
                    title="Edit"
                  >
                    <Pencil size={14} />
                  </button>
                )}
                {userRole === 'admin' && review.status === 'draft' && (
                  <button
                    onClick={() => handleDelete(review.id)}
                    className="p-1.5 text-rmpg-400 hover:text-red-400 transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      <ReviewFormModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditReview(null);
        }}
        onSubmit={editReview ? handleUpdate : handleCreate}
        editReview={editReview}
        officers={officers}
      />
    </div>
  );
}
