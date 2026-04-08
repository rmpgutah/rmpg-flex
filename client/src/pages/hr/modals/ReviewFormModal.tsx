// ============================================================
// RMPG Flex — Performance Review Form Modal
// Create or edit performance reviews with star-rated categories
// ============================================================

import { useState, useEffect, useMemo } from 'react';
import { X, Star, Loader2 } from 'lucide-react';
import { REVIEW_CATEGORIES, RATING_LABELS } from '../utils/hrConstants';
import type { PerformanceReview, ReviewType } from '../../../types';

interface ReviewFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: any) => Promise<void>;
  editReview?: PerformanceReview | null;
  officers: Array<{ id: number; full_name: string }>;
}

const REVIEW_TYPES: { value: ReviewType; label: string }[] = [
  { value: 'annual', label: 'Annual' },
  { value: 'probationary', label: 'Probationary' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'improvement_plan', label: 'Improvement Plan' },
];

function StarPicker({
  rating,
  onChange,
  max = 5,
}: {
  rating: number;
  onChange: (val: number) => void;
  max?: number;
}) {
  const [hover, setHover] = useState(0);

  return (
    <div className="flex items-center gap-1">
      <div className="flex items-center gap-0.5">
        {Array.from({ length: max }, (_, i) => {
          const val = i + 1;
          const filled = val <= (hover || rating);
          return (
            <button
              key={i}
              type="button"
              onClick={() => onChange(val)}
              onMouseEnter={() => setHover(val)}
              onMouseLeave={() => setHover(0)}
              className="focus:outline-none transition-colors"
            >
              <Star
                size={18}
                className={
                  filled
                    ? 'text-yellow-400 fill-yellow-400'
                    : 'text-rmpg-600 hover:text-yellow-400/50'
                }
              />
            </button>
          );
        })}
      </div>
      {(hover || rating) > 0 && (
        <span className="ml-2 text-xs text-rmpg-400">
          {RATING_LABELS[hover || rating]}
        </span>
      )}
    </div>
  );
}

export default function ReviewFormModal({
  isOpen,
  onClose,
  onSubmit,
  editReview,
  officers,
}: ReviewFormModalProps) {
  const [officerId, setOfficerId] = useState('');
  const [type, setType] = useState<ReviewType>('annual');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [reviewDate, setReviewDate] = useState('');
  const [categories, setCategories] = useState<Record<string, number>>({});
  const [strengths, setStrengths] = useState('');
  const [areasForImprovement, setAreasForImprovement] = useState('');
  const [goals, setGoals] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Reset form when modal opens or editReview changes
  useEffect(() => {
    if (isOpen) {
      if (editReview) {
        setOfficerId(String(editReview.officer_id));
        setType(editReview.type);
        setPeriodStart(editReview.review_period_start);
        setPeriodEnd(editReview.review_period_end);
        setReviewDate(editReview.review_date ?? '');
        setCategories(editReview.categories ?? {});
        setStrengths(editReview.strengths ?? '');
        setAreasForImprovement(editReview.areas_for_improvement ?? '');
        setGoals(editReview.goals ?? '');
      } else {
        setOfficerId('');
        setType('annual');
        setPeriodStart('');
        setPeriodEnd('');
        setReviewDate('');
        setCategories({});
        setStrengths('');
        setAreasForImprovement('');
        setGoals('');
      }
    }
  }, [isOpen, editReview]);

  const overallRating = useMemo(() => {
    const vals = Object.values(categories).filter((v) => v > 0);
    if (vals.length === 0) return 0;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }, [categories]);

  const handleCategoryRating = (cat: string, val: number) => {
    setCategories((prev) => ({ ...prev, [cat]: val }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit({
        officer_id: Number(officerId),
        type,
        review_period_start: periodStart,
        review_period_end: periodEnd,
        review_date: reviewDate || null,
        categories,
        overall_rating: overallRating || null,
        strengths: strengths || null,
        areas_for_improvement: areasForImprovement || null,
        goals: goals || null,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-2xl mx-4 bg-surface-base border border-rmpg-700 rounded-sm shadow-md flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-700">
          <h2 className="text-sm font-semibold text-white">
            {editReview ? 'Edit Performance Review' : 'New Performance Review'}
          </h2>
          <button type="button"
            onClick={onClose}
            className="text-rmpg-400 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable content */}
        <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden">
          <div className="overflow-y-auto p-4 space-y-4">
            {/* Officer + Type */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-rmpg-400 mb-1 block">
                  Officer <span className="text-red-400">*</span>
                </span>
                <select
                  required
                  value={officerId}
                  onChange={(e) => setOfficerId(e.target.value)}
                  className="w-full bg-surface-sunken border border-rmpg-700 rounded-sm px-2.5 py-1.5 text-sm text-white focus:border-brand-500 focus:outline-none"
                >
                  <option value="">Select officer...</option>
                  {officers.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.full_name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-xs text-rmpg-400 mb-1 block">
                  Review Type
                </span>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as ReviewType)}
                  className="w-full bg-surface-sunken border border-rmpg-700 rounded-sm px-2.5 py-1.5 text-sm text-white focus:border-brand-500 focus:outline-none"
                >
                  {REVIEW_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Dates */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-rmpg-400 mb-1 block">
                  Period Start <span className="text-red-400">*</span>
                </span>
                <input
                  type="date"
                  required
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  className="w-full bg-surface-sunken border border-rmpg-700 rounded-sm px-2.5 py-1.5 text-sm text-white focus:border-brand-500 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="text-xs text-rmpg-400 mb-1 block">
                  Period End <span className="text-red-400">*</span>
                </span>
                <input
                  type="date"
                  required
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                  className="w-full bg-surface-sunken border border-rmpg-700 rounded-sm px-2.5 py-1.5 text-sm text-white focus:border-brand-500 focus:outline-none"
                />
              </label>
            </div>

            <label className="block">
              <span className="text-xs text-rmpg-400 mb-1 block">
                Review Date
              </span>
              <input
                type="date"
                value={reviewDate}
                onChange={(e) => setReviewDate(e.target.value)}
                className="w-full bg-surface-sunken border border-rmpg-700 rounded-sm px-2.5 py-1.5 text-sm text-white focus:border-brand-500 focus:outline-none sm:max-w-[50%]"
              />
            </label>

            {/* Category ratings */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-rmpg-300 uppercase tracking-wider">
                Category Ratings
              </h3>
              <div className="space-y-2 bg-surface-sunken border border-rmpg-700 rounded-sm p-3">
                {REVIEW_CATEGORIES.map((cat) => (
                  <div
                    key={cat}
                    className="flex items-center justify-between gap-4"
                  >
                    <span className="text-xs text-rmpg-300 min-w-[140px]">
                      {cat}
                    </span>
                    <StarPicker
                      rating={categories[cat] ?? 0}
                      onChange={(val) => handleCategoryRating(cat, val)}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Overall rating (auto-calculated) */}
            {overallRating > 0 && (
              <div className="flex items-center gap-3 bg-surface-sunken border border-rmpg-700 rounded-sm p-3">
                <span className="text-xs font-semibold text-rmpg-300 uppercase tracking-wider">
                  Overall Rating
                </span>
                <div className="flex items-center gap-0.5">
                  {Array.from({ length: 5 }, (_, i) => (
                    <Star
                      key={i}
                      size={18}
                      className={
                        i < overallRating
                          ? 'text-yellow-400 fill-yellow-400'
                          : 'text-rmpg-600'
                      }
                    />
                  ))}
                </div>
                <span className="text-xs text-rmpg-400">
                  {RATING_LABELS[overallRating]}
                </span>
              </div>
            )}

            {/* Narrative fields */}
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs text-rmpg-400 mb-1 block">
                  Strengths
                </span>
                <textarea
                  value={strengths}
                  onChange={(e) => setStrengths(e.target.value)}
                  rows={3}
                  className="w-full bg-surface-sunken border border-rmpg-700 rounded-sm px-2.5 py-1.5 text-sm text-white focus:border-brand-500 focus:outline-none resize-y"
                  placeholder="Notable strengths observed during this review period..."
                />
              </label>
              <label className="block">
                <span className="text-xs text-rmpg-400 mb-1 block">
                  Areas for Improvement
                </span>
                <textarea
                  value={areasForImprovement}
                  onChange={(e) => setAreasForImprovement(e.target.value)}
                  rows={3}
                  className="w-full bg-surface-sunken border border-rmpg-700 rounded-sm px-2.5 py-1.5 text-sm text-white focus:border-brand-500 focus:outline-none resize-y"
                  placeholder="Areas where improvement is expected..."
                />
              </label>
              <label className="block">
                <span className="text-xs text-rmpg-400 mb-1 block">Goals</span>
                <textarea
                  value={goals}
                  onChange={(e) => setGoals(e.target.value)}
                  rows={3}
                  className="w-full bg-surface-sunken border border-rmpg-700 rounded-sm px-2.5 py-1.5 text-sm text-white focus:border-brand-500 focus:outline-none resize-y"
                  placeholder="Goals for the next review period..."
                />
              </label>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-rmpg-700">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-rmpg-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium bg-brand-600 hover:bg-brand-500 text-white rounded-sm transition-colors disabled:opacity-50"
            >
              {submitting && <Loader2 size={12} className="animate-spin" />}
              {editReview ? 'Update Review' : 'Create Review'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
