// ============================================================
// RMPG Flex — Performance Review Modal
// Create or edit a performance review for an employee
// ============================================================

import React, { useState, useEffect } from 'react';
import { X, TrendingUp, Star } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { localToday } from '../../../utils/dateUtils';

interface UserOption {
  id: string;
  full_name: string;
  badge_number?: string;
}

interface ReviewCycle {
  id: number;
  name: string;
  status: string;
}

interface PerformanceReview {
  id?: number;
  employee_id: string;
  cycle_id: number | null;
  review_date: string;
  overall_rating: number;
  strengths: string;
  areas_for_improvement: string;
  goals: string;
  comments: string;
  status: string;
}

interface PerformanceReviewModalProps {
  onClose: () => void;
  onSaved: () => void;
  review?: PerformanceReview | null;
}

export default function PerformanceReviewModal({ onClose, onSaved, review }: PerformanceReviewModalProps) {
  const [users, setUsers] = useState<UserOption[]>([]);
  const [cycles, setCycles] = useState<ReviewCycle[]>([]);
  const [employeeId, setEmployeeId] = useState(review?.employee_id || '');
  const [cycleId, setCycleId] = useState<number | null>(review?.cycle_id || null);
  const [reviewDate, setReviewDate] = useState(review?.review_date || localToday());
  const [overallRating, setOverallRating] = useState(review?.overall_rating || 0);
  const [strengths, setStrengths] = useState(review?.strengths || '');
  const [areasForImprovement, setAreasForImprovement] = useState(review?.areas_for_improvement || '');
  const [goals, setGoals] = useState(review?.goals || '');
  const [comments, setComments] = useState(review?.comments || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch<UserOption[]>('/hr/employees').then(setUsers).catch(err => { console.warn('[HR] Employee load failed:', err); setError('Failed to load employee list'); });
    apiFetch<ReviewCycle[]>('/hr/review-cycles').then(setCycles).catch(err => { console.warn('[HR] Review cycles load failed:', err); });
  }, []);

  const handleSubmit = async () => {
    if (!employeeId || !reviewDate || overallRating < 1) {
      setError('Employee, review date, and rating are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        employee_id: employeeId,
        cycle_id: cycleId,
        review_date: reviewDate,
        overall_rating: overallRating,
        strengths: strengths.trim(),
        areas_for_improvement: areasForImprovement.trim(),
        goals: goals.trim(),
        comments: comments.trim(),
      };
      if (review?.id) {
        await apiFetch(`/hr/performance-reviews/${review.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch('/hr/performance-reviews', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      onSaved();
    } catch (err: any) {
      setError(err.message || 'Failed to save review');
    } finally {
      setSaving(false);
    }
  };

  const inputClass = 'w-full bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1.5 text-xs text-white focus:border-brand-500 focus:outline-none';
  const labelClass = 'block text-xs text-rmpg-400 mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="bg-[#141e2b] border border-[#1e3048] rounded-sm w-full max-w-xl mx-4 max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-4 py-2 border-b border-[#1e3048] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-brand-400" />
            <h3 className="text-sm font-semibold text-white">
              {review?.id ? 'Edit Performance Review' : 'Create Performance Review'}
            </h3>
          </div>
          <button type="button" onClick={onClose} className="text-rmpg-500 hover:text-white" aria-label="Close" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-sm px-2 py-1.5">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Employee *</label>
              <select value={employeeId} onChange={e => setEmployeeId(e.target.value)} className={inputClass}>
                <option value="">Select employee...</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.full_name}{u.badge_number ? ` (${u.badge_number})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Review Cycle</label>
              <select value={cycleId ?? ''} onChange={e => setCycleId(e.target.value ? Number(e.target.value) : null)} className={inputClass}>
                <option value="">None</option>
                {cycles.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Review Date *</label>
              <input
                type="date"
                value={reviewDate}
                onChange={e => setReviewDate(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Overall Rating *</label>
              <div className="flex items-center gap-1 mt-1">
                {[1, 2, 3, 4, 5].map(n => (
                  <button type="button"
                    key={n}
                    type="button"
                    onClick={() => setOverallRating(n)}
                    className="focus:outline-none"
                  >
                    <Star
                      className={`w-5 h-5 ${n <= overallRating ? 'text-yellow-400 fill-yellow-400' : 'text-rmpg-600'}`}
                    />
                  </button>
                ))}
                <span className="ml-2 text-xs text-rmpg-400">{overallRating > 0 ? `${overallRating}/5` : ''}</span>
              </div>
            </div>
          </div>

          <div>
            <label className={labelClass}>Strengths</label>
            <textarea
              value={strengths}
              onChange={e => setStrengths(e.target.value)}
              className={`${inputClass} h-16 resize-none`}
              placeholder="Key strengths and accomplishments..."
            />
          </div>

          <div>
            <label className={labelClass}>Areas for Improvement</label>
            <textarea
              value={areasForImprovement}
              onChange={e => setAreasForImprovement(e.target.value)}
              className={`${inputClass} h-16 resize-none`}
              placeholder="Areas where the employee can grow..."
            />
          </div>

          <div>
            <label className={labelClass}>Goals</label>
            <textarea
              value={goals}
              onChange={e => setGoals(e.target.value)}
              className={`${inputClass} h-16 resize-none`}
              placeholder="Goals for the next review period..."
            />
          </div>

          <div>
            <label className={labelClass}>Additional Comments</label>
            <textarea
              value={comments}
              onChange={e => setComments(e.target.value)}
              className={`${inputClass} h-16 resize-none`}
              placeholder="Any additional notes or comments..."
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-[#1e3048] flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-rmpg-400 hover:text-white">
            Cancel
          </button>
          <button type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="px-3 py-1.5 text-xs bg-brand-500 text-white rounded-sm hover:bg-brand-600 disabled:opacity-50"
          >
            {saving ? 'Saving...' : review?.id ? 'Update Review' : 'Create Review'}
          </button>
        </div>
      </div>
    </div>
  );
}
