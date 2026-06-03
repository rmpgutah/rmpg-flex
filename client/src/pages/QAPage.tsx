import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { useToast } from '../components/ToastProvider';
import { useMenuActions } from '../utils/contextMenuActions';
import { CheckCircle, Star, ThumbsUp, Users, Plus, Pencil, Trash2 } from 'lucide-react';

export default function QAPage() {
  const [reviews, setReviews] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total_reviews: 0, avg_review_score: 0, avg_survey_rating: 0, total_surveys: 0 });
  const [editingRecord, setEditingRecord] = useState<Record<string, any> | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const { addToast } = useToast();
  const m = useMenuActions();

  const fetchData = useCallback(async () => {
    try {
      const r = await apiFetch<{ data: Record<string, any>[] }>('/qa/reviews');
      setReviews(r.data || []);
      const s = await apiFetch<{ total_reviews: number; avg_review_score: number; avg_survey_rating: number; total_surveys: number }>('/qa/stats');
      setStats(s);
    } catch { /* */ }
  }, []);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);

  const openNew = () => { setEditingRecord(null); setFormData({ review_type: 'call_audit', entity_type: '', entity_id: '', reviewed_officer_id: '', findings: '', recommendations: '' }); };
  const openEdit = (rec: Record<string, any>) => { setEditingRecord(rec); setFormData({ ...rec }); };
  const handleSave = async () => {
    setSubmitting(true);
    try {
      if (editingRecord) {
        await apiFetch(`/qa/reviews/${editingRecord.id}`, { method: 'PUT', body: JSON.stringify(formData) });
      } else {
        await apiFetch('/qa/reviews', { method: 'POST', body: JSON.stringify(formData) });
      }
      setEditingRecord(null); fetchData(); addToast(editingRecord ? 'Updated' : 'Created', 'success');
    } catch (err) { addToast(err instanceof Error ? err.message : 'Failed', 'error'); }
    finally { setSubmitting(false); }
  };
  const handleDelete = async () => {
    if (!deleteId) return;
    try { await apiFetch(`/qa/reviews/${deleteId}`, { method: 'DELETE' }); setDeleteId(null); fetchData(); addToast('Deleted', 'success'); }
    catch (err) { addToast(err instanceof Error ? err.message : 'Delete failed', 'error'); }
  };

  const showForm = editingRecord !== null;
  const columns = [
    { key: 'review_number', label: 'Review #' }, { key: 'review_type', label: 'Type' },
    { key: 'reviewer_name', label: 'Reviewer' }, { key: 'score', label: 'Score' },
    { key: 'status', label: 'Status' }, { key: 'created_at', label: 'Created' },
    { key: 'actions', label: '', width: '100px', render: (row: any) => (
      <div className="flex gap-2">
        <button onClick={(e) => { e.stopPropagation(); openEdit(row); }} className="text-rmpg-400 hover:text-white"><Pencil size={12} /></button>
        <button onClick={(e) => { e.stopPropagation(); setDeleteId(row.id); }} className="text-red-500 hover:text-red-300"><Trash2 size={12} /></button>
      </div>
    )},
  ];

  if (loading) return <div className="p-6 text-[#888888]">Loading QA records...</div>;
  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="QUALITY ASSURANCE" icon={CheckCircle}>
        <button onClick={openNew} className="toolbar-btn flex items-center gap-1.5" style={{ height: 28, padding: '0 10px' }}><Plus size={13} /> New Review</button>
      </PanelTitleBar>
      <div className="grid grid-cols-4 gap-3">
        <StatsCard icon={CheckCircle} label="Total Reviews" value={stats.total_reviews} />
        <StatsCard icon={Star} label="Avg Score" value={`${stats.avg_review_score}%`} />
        <StatsCard icon={ThumbsUp} label="Avg Rating" value={`${stats.avg_survey_rating}/5`} />
        <StatsCard icon={Users} label="Surveys" value={stats.total_surveys} />
      </div>
      <DataTable
        columns={columns}
        data={reviews}
        emptyMessage="No QA reviews found"
        onRowClick={(row) => openEdit(row)}
        rowContextMenu={(row) => [
          m.action('Open / Edit', () => openEdit(row), { icon: <Pencil size={12} /> }),
          m.separator(),
          m.copyId(row.id),
          m.action('Delete', () => setDeleteId(row.id), { danger: true, icon: <Trash2 size={12} /> }),
        ]}
      />
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setEditingRecord(null)}>
          <div className="bg-surface-raised border border-[#333] p-6 max-w-lg w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-white mb-4">{editingRecord ? 'Edit Review' : 'New Review'}</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Review Type <span className="text-red-500">*</span></label>
                  <select id="ff-qapage-0" className="select-dark mt-1" value={formData.review_type || 'call_audit'} onChange={e => setFormData({...formData, review_type: e.target.value})}>
                    {['call_audit','report_review','bodycam_audit','investigation_review','dispatch_audit','other'].map(t=><option key={t} value={t}>{t}</option>)}
                  </select></div>
                <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Officer ID</label>
                  <input id="ff-qapage-1" className="input-dark mt-1" value={formData.reviewed_officer_id || ''} onChange={e => setFormData({...formData, reviewed_officer_id: e.target.value})} /></div>
              </div>
              <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Findings</label>
                <textarea id="ff-qapage-2" rows={3} className="input-dark mt-1" value={formData.findings || ''} onChange={e => setFormData({...formData, findings: e.target.value})} /></div>
              <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Recommendations</label>
                <textarea id="ff-qapage-3" rows={2} className="input-dark mt-1" value={formData.recommendations || ''} onChange={e => setFormData({...formData, recommendations: e.target.value})} /></div>
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setEditingRecord(null)} className="toolbar-btn px-4" style={{ height: 28 }}>Cancel</button>
              <button onClick={handleSave} disabled={submitting} className="toolbar-btn-primary px-4" style={{ height: 28 }}>{submitting ? 'Saving...' : editingRecord ? 'Update' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}
      {deleteId !== null && (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setDeleteId(null)}><div className="bg-surface-raised border border-red-800 p-6 max-w-sm w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}><h3 className="text-sm font-bold text-red-400 mb-2">Delete Review</h3><p className="text-xs text-[#888888] mb-4">This permanently removes the review.</p><div className="flex justify-end gap-3"><button onClick={() => setDeleteId(null)} className="toolbar-btn px-4" style={{ height: 28 }}>Cancel</button><button onClick={handleDelete} className="toolbar-btn-primary px-4" style={{ height: 28, borderColor: '#991b1b', color: '#f87171' }}>Delete</button></div></div></div>)}
    </div>
  );
}
