import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { useMenuActions } from '../utils/contextMenuActions';
import { useAuth } from '../context/AuthContext';
import { formatDateTime } from '../utils/dateUtils';
import { CheckCircle, Star, ThumbsUp, Users, Plus, Pencil, Trash2 } from 'lucide-react';
import OfficerPicker from '../components/OfficerPicker';
import { formatEnumValue } from '../utils/formatters';
import { qaReviewsToCsv, downloadTextFile } from '../utils/rmsListExport';

interface QAStats {
  total_reviews: number;
  avg_review_score: number;
  avg_survey_rating: number;
  total_surveys: number;
}

export default function QAPage() {
  const [reviews, setReviews] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<QAStats>({
    total_reviews: 0, avg_review_score: 0, avg_survey_rating: 0, total_surveys: 0,
  });
  const [editingRecord, setEditingRecord] = useState<Record<string, any> | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [loadError, setLoadError] = useState<string | null>(null);
  const { addToast } = useToast();
  const { user } = useAuth();
  const m = useMenuActions();
  const [searchParams, setSearchParams] = useSearchParams();

  // Role gates: admin/manager/supervisor can create & edit; only admin/manager can delete
  const canWrite = ['admin', 'manager', 'supervisor'].includes(user?.role ?? '');
  const canDelete = ['admin', 'manager'].includes(user?.role ?? '');

  const fetchData = useCallback(async () => {
    try {
      setLoadError(null);
      const r = await apiFetch<{ data: Record<string, any>[] }>('/qa/reviews');
      setReviews(r.data ?? []);
      const s = await apiFetch<QAStats>('/qa/stats');
      setStats(s);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load QA reviews');
    }
  }, []);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  // Deep-link: ?qa_id=<id> or ?review_id=<id> — open that review on mount
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (loading || deepLinkHandled.current) return;
    const qaId = searchParams.get('qa_id') ?? searchParams.get('review_id');
    if (!qaId) return;
    deepLinkHandled.current = true;
    const next = new URLSearchParams(searchParams);
    next.delete('qa_id');
    next.delete('review_id');
    setSearchParams(next, { replace: true });
    const target = reviews.find((r) => String(r.id) === qaId);
    if (target) openEdit(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, reviews, searchParams]);

  // N shortcut — open New Review modal when not in an input field
  // Esc cascade — close form modal or delete dialog
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag);
      if ((e.key === 'N' || e.key === 'n') && !inInput && !formOpen && canWrite) {
        openNew();
        return;
      }
      if (e.key === 'Escape') {
        if (formOpen) {
          e.stopPropagation();
          closeForm();
        } else if (deleteId !== null) {
          e.stopPropagation();
          setDeleteId(null);
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formOpen, deleteId, canWrite]);

  const openNew = () => {
    setEditingRecord(null);
    setFormData({
      review_type: 'call_audit', entity_type: '', entity_id: '',
      reviewed_officer_id: '', findings: '', recommendations: '',
    });
    setFormOpen(true);
  };
  const openEdit = (rec: Record<string, any>) => {
    setEditingRecord(rec);
    setFormData({ ...rec });
    setFormOpen(true);
  };
  const closeForm = () => {
    setFormOpen(false);
    setEditingRecord(null);
  };

  const handleSave = async () => {
    setSubmitting(true);
    try {
      if (editingRecord) {
        await apiFetch(`/qa/reviews/${editingRecord.id}`, { method: 'PUT', body: JSON.stringify(formData) });
      } else {
        await apiFetch('/qa/reviews', { method: 'POST', body: JSON.stringify(formData) });
      }
      closeForm();
      fetchData();
      addToast(editingRecord ? 'Review updated' : 'Review created', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to save', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleteLoading(true);
    try {
      await apiFetch(`/qa/reviews/${deleteId}`, { method: 'DELETE' });
      setDeleteId(null);
      fetchData();
      addToast('Review deleted', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally {
      setDeleteLoading(false);
    }
  };

  const deleteTarget = reviews.find((r) => r.id === deleteId);

  const columns = [
    { key: 'review_number', label: 'Review #' },
    { key: 'review_type', label: 'Type' },
    { key: 'reviewer_name', label: 'Reviewer' },
    { key: 'score', label: 'Score' },
    { key: 'status', label: 'Status' },
    {
      key: 'created_at',
      label: 'Created',
      render: (row: any) => formatDateTime(row.created_at),
    },
    ...(canWrite ? [{
      key: 'actions',
      label: '',
      width: '80px',
      render: (row: any) => (
        <div className="flex gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); openEdit(row); }}
            className="text-rmpg-400 hover:text-rmpg-100"
            aria-label="Edit review"
          >
            <Pencil size={12} />
          </button>
          {canDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); setDeleteId(row.id); }}
              className="text-red-500 hover:text-red-300"
              aria-label="Delete review"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      ),
    }] : []),
  ];

  const reviewTypes = Array.from(new Set(reviews.map((r) => String(r.review_type || '')).filter(Boolean))).sort();
  const visibleReviews = typeFilter === 'ALL' ? reviews : reviews.filter((r) => r.review_type === typeFilter);
  const emptyMessage = loading
    ? 'Loading QA records…'
    : reviews.length === 0
      ? 'No QA reviews on record'
      : 'No reviews match this type filter';
  const emptyDescription = loading
    ? undefined
    : reviews.length === 0
      ? 'Quality assurance reviews will appear here once created.'
      : 'Pick All types or another review type.';

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="QUALITY ASSURANCE" icon={CheckCircle}>
        <div className="flex items-center gap-2">
          <select
            aria-label="Filter by review type"
            className="select-dark text-[11px]"
            style={{ height: 28 }}
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="ALL">All types</option>
            {reviewTypes.map((t) => (
              <option key={t} value={t}>{formatEnumValue(t)}</option>
            ))}
          </select>
          <button
            type="button"
            className="toolbar-btn"
            style={{ height: 28, padding: '0 10px' }}
            disabled={visibleReviews.length === 0}
            onClick={() => downloadTextFile('qa-reviews.csv', qaReviewsToCsv(visibleReviews))}
          >
            CSV
          </button>
          {canWrite && (
            <button
              onClick={openNew}
              className="toolbar-btn flex items-center gap-1.5"
              style={{ height: 28, padding: '0 10px' }}
              title="New Review (N)"
            >
              <Plus size={13} /> New Review
            </button>
          )}
        </div>
      </PanelTitleBar>
      {loadError && (
        <div className="border border-red-700/40 bg-red-900/20 text-red-400 text-[11px] px-3 py-2 flex items-center justify-between" role="alert">
          <span>{loadError}</span>
          <button type="button" className="toolbar-btn" style={{ height: 26 }} onClick={() => { setLoading(true); fetchData().finally(() => setLoading(false)); }}>Retry</button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatsCard icon={CheckCircle} label="Total Reviews" value={stats.total_reviews} />
        <StatsCard icon={Star} label="Avg Score" value={`${stats.avg_review_score}%`} />
        <StatsCard icon={ThumbsUp} label="Avg Rating" value={`${stats.avg_survey_rating}/5`} />
        <StatsCard icon={Users} label="Surveys" value={stats.total_surveys} />
      </div>

      <DataTable
        columns={columns}
        data={visibleReviews}
        loading={loading}
        emptyMessage={emptyMessage}
        emptyDescription={emptyDescription}
        onRowClick={(row) => openEdit(row)}
        rowContextMenu={(row) => [
          m.action('Open / Edit', () => openEdit(row), { icon: <Pencil size={12} /> }),
          m.separator(),
          m.copyId(row.id),
          m.copy('Copy findings', row.findings ?? ''),
          ...(canDelete
            ? [m.action('Delete', () => setDeleteId(row.id), { danger: true, icon: <Trash2 size={12} /> })]
            : []),
        ]}
      />

      {/* Review form modal */}
      {formOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 overflow-y-auto p-4"
          onClick={closeForm}
        >
          <div
            className="bg-surface-raised border border-rmpg-700 p-6 max-w-lg w-full my-auto"
            style={{ borderRadius: 2 }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); closeForm(); } }}
          >
            <h3 className="text-sm font-bold text-rmpg-100 mb-4">
              {editingRecord ? 'Edit Review' : 'New Review'}
            </h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ff-qapage-0" className="text-[10px] text-rmpg-400 uppercase font-semibold">
                    Review Type <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="ff-qapage-0"
                    className="select-dark mt-1"
                    value={formData.review_type || 'call_audit'}
                    onChange={(e) => setFormData({ ...formData, review_type: e.target.value })}
                  >
                    {['call_audit', 'report_review', 'bodycam_audit', 'investigation_review', 'dispatch_audit', 'other'].map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase font-semibold">
                    Reviewed Officer
                  </label>
                  <div className="mt-1">
                    <OfficerPicker
                      id="ff-qapage-1"
                      value={formData.reviewed_officer_id ? Number(formData.reviewed_officer_id) : null}
                      onChange={(id) => setFormData({ ...formData, reviewed_officer_id: id ? String(id) : '' })}
                      placeholder="Search officer by name, badge…"
                    />
                  </div>
                </div>
              </div>
              <div>
                <label htmlFor="ff-qapage-2" className="text-[10px] text-rmpg-400 uppercase font-semibold">
                  Findings
                </label>
                <textarea
                  id="ff-qapage-2"
                  rows={3}
                  className="input-dark mt-1"
                  value={formData.findings || ''}
                  onChange={(e) => setFormData({ ...formData, findings: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="ff-qapage-3" className="text-[10px] text-rmpg-400 uppercase font-semibold">
                  Recommendations
                </label>
                <textarea
                  id="ff-qapage-3"
                  rows={2}
                  className="input-dark mt-1"
                  value={formData.recommendations || ''}
                  onChange={(e) => setFormData({ ...formData, recommendations: e.target.value })}
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={closeForm} className="toolbar-btn px-4" style={{ height: 28 }}>
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={submitting}
                className="toolbar-btn toolbar-btn-primary px-4"
                style={{ height: 28 }}
              >
                {submitting ? 'Saving…' : editingRecord ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation via shared ConfirmDialog */}
      <ConfirmDialog
        isOpen={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Review"
        message="This permanently removes the QA review and all associated scores. This action cannot be undone."
        details={deleteTarget ? (
          <>
            <div><span className="text-rmpg-400">Review #:</span> {deleteTarget.review_number}</div>
            <div><span className="text-rmpg-400">Type:</span> {formatEnumValue(deleteTarget.review_type)}</div>
            {deleteTarget.reviewer_name && (
              <div><span className="text-rmpg-400">Reviewer:</span> {deleteTarget.reviewer_name}</div>
            )}
          </>
        ) : undefined}
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={deleteLoading}
      />
    </div>
  );
}
