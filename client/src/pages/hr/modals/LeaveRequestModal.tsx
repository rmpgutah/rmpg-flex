// ============================================================
// RMPG Flex — Leave Request Modal
// Create new leave requests or review pending ones (HR view)
// ============================================================

import React, { useState, useEffect } from 'react';
import { X, CalendarOff, Check, XCircle } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';

interface LeaveType {
  id: number;
  name: string;
  code: string;
}

interface LeaveRequest {
  id: number;
  user_id: string;
  employee_name?: string;
  leave_type_id: number;
  leave_type_name?: string;
  start_date: string;
  end_date: string;
  hours_requested: number;
  reason: string;
  status: string;
  reviewer_notes?: string;
  created_at: string;
}

interface LeaveRequestModalProps {
  onClose: () => void;
  onSaved: () => void;
  /** If provided, we're reviewing an existing request (HR view) */
  request?: LeaveRequest | null;
  /** If true, show review controls instead of create form */
  reviewMode?: boolean;
}

export default function LeaveRequestModal({ onClose, onSaved, request, reviewMode }: LeaveRequestModalProps) {
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [leaveTypeId, setLeaveTypeId] = useState<number>(request?.leave_type_id || 0);
  const [startDate, setStartDate] = useState(request?.start_date || '');
  const [endDate, setEndDate] = useState(request?.end_date || '');
  const [hoursRequested, setHoursRequested] = useState<number>(request?.hours_requested || 8);
  const [reason, setReason] = useState(request?.reason || '');
  const [reviewerNotes, setReviewerNotes] = useState(request?.reviewer_notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch<LeaveType[]>('/hr/leave-types').then(setLeaveTypes).catch(err => console.warn('[HR] Failed to load data:', err));
  }, []);

  useEffect(() => {
    if (leaveTypes.length > 0 && !leaveTypeId) {
      setLeaveTypeId(leaveTypes[0].id);
    }
  }, [leaveTypes, leaveTypeId]);

  const handleSubmit = async () => {
    if (!leaveTypeId || !startDate || !endDate || !reason.trim()) {
      setError('Please fill in all required fields.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await apiFetch('/hr/leave-requests', {
        method: 'POST',
        body: JSON.stringify({
          leave_type_id: leaveTypeId,
          start_date: startDate,
          end_date: endDate,
          hours_requested: hoursRequested,
          reason: reason.trim(),
        }),
      });
      onSaved();
    } catch (err: any) {
      setError(err.message || 'Failed to submit request');
    } finally {
      setSaving(false);
    }
  };

  const handleReview = async (action: 'approved' | 'denied') => {
    if (!request) return;
    setSaving(true);
    setError('');
    try {
      await apiFetch(`/hr/leave-requests/${request.id}/review`, {
        method: 'PUT',
        body: JSON.stringify({
          status: action,
          reviewer_notes: reviewerNotes.trim(),
        }),
      });
      onSaved();
    } catch (err: any) {
      setError(err.message || 'Failed to process review');
    } finally {
      setSaving(false);
    }
  };

  const inputClass = 'w-full bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1.5 text-xs text-white focus:border-brand-500 focus:outline-none';
  const labelClass = 'block text-xs text-rmpg-400 mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-[#141e2b] border border-[#1e3048] rounded-sm w-full max-w-lg mx-4 max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-4 py-2 border-b border-[#1e3048] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarOff className="w-4 h-4 text-brand-400" />
            <h3 className="text-sm font-semibold text-white">
              {reviewMode ? 'Review Leave Request' : 'Request Time Off'}
            </h3>
          </div>
          <button onClick={onClose} className="text-rmpg-500 hover:text-white">
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

          {reviewMode && request ? (
            <>
              {/* Review mode — show request details */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className={labelClass}>Employee</span>
                  <p className="text-xs text-white">{request.employee_name || 'N/A'}</p>
                </div>
                <div>
                  <span className={labelClass}>Leave Type</span>
                  <p className="text-xs text-white">{request.leave_type_name || 'N/A'}</p>
                </div>
                <div>
                  <span className={labelClass}>Start Date</span>
                  <p className="text-xs text-white">{request.start_date}</p>
                </div>
                <div>
                  <span className={labelClass}>End Date</span>
                  <p className="text-xs text-white">{request.end_date}</p>
                </div>
                <div>
                  <span className={labelClass}>Hours Requested</span>
                  <p className="text-xs text-white">{request.hours_requested}</p>
                </div>
                <div>
                  <span className={labelClass}>Status</span>
                  <p className="text-xs text-white capitalize">{request.status}</p>
                </div>
              </div>
              <div>
                <span className={labelClass}>Reason</span>
                <p className="text-xs text-white bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1.5 whitespace-pre-wrap">
                  {request.reason}
                </p>
              </div>
              <div>
                <label className={labelClass}>Review Notes</label>
                <textarea
                  value={reviewerNotes}
                  onChange={e => setReviewerNotes(e.target.value)}
                  className={`${inputClass} h-20 resize-none`}
                  placeholder="Optional notes for the employee..."
                />
              </div>
            </>
          ) : (
            <>
              {/* Create mode */}
              <div>
                <label className={labelClass}>Leave Type *</label>
                <select
                  value={leaveTypeId}
                  onChange={e => setLeaveTypeId(Number(e.target.value))}
                  className={inputClass}
                >
                  {leaveTypes.map(lt => (
                    <option key={lt.id} value={lt.id}>{lt.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Start Date *</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>End Date *</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={e => setEndDate(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>Hours Requested *</label>
                <input
                  type="number"
                  value={hoursRequested}
                  onChange={e => setHoursRequested(Number(e.target.value))}
                  min={0}
                  step={0.5}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Reason *</label>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  className={`${inputClass} h-20 resize-none`}
                  placeholder="Reason for time off..."
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-[#1e3048] flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-rmpg-400 hover:text-white">
            Cancel
          </button>
          {reviewMode && request?.status === 'requested' ? (
            <>
              <button
                onClick={() => handleReview('denied')}
                disabled={saving}
                className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-sm hover:bg-red-700 disabled:opacity-50 flex items-center gap-1"
              >
                <XCircle className="w-3 h-3" /> Deny
              </button>
              <button
                onClick={() => handleReview('approved')}
                disabled={saving}
                className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-sm hover:bg-green-700 disabled:opacity-50 flex items-center gap-1"
              >
                <Check className="w-3 h-3" /> Approve
              </button>
            </>
          ) : !reviewMode ? (
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="px-3 py-1.5 text-xs bg-brand-500 text-white rounded-sm hover:bg-brand-600 disabled:opacity-50"
            >
              {saving ? 'Submitting...' : 'Submit Request'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
