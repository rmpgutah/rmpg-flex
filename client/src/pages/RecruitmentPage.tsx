import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { useToast } from '../components/ToastProvider';
import { UserPlus, Users, CheckCircle, GraduationCap, Clock, Plus, Pencil, Trash2 } from 'lucide-react';

interface Candidate { id: number; candidate_name: string; email: string; phone: string; position: string; stage: string; applied_date: string; notes: string; }
interface RecruitStats { applicants: number; inProcess: number; hired: number; academyClasses: number; }

const EMPTY_FORM = { candidate_name: '', email: '', phone: '', position: '', stage: 'applied', applied_date: new Date().toISOString().slice(0, 10), notes: '' };

const STAGES = ['applied', 'screening', 'testing', 'oral_board', 'background', 'conditional_offer', 'academy', 'fto', 'hired', 'rejected', 'withdrawn'];

export default function RecruitmentPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [stats, setStats] = useState<RecruitStats>({ applicants: 0, inProcess: 0, hired: 0, academyClasses: 0 });
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Candidate | null>(null);
  const [formData, setFormData] = useState<any>(EMPTY_FORM);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const { addToast } = useToast();

  const fetchData = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([
        apiFetch<Candidate[]>('/recruitment/candidates').catch(() => []),
        apiFetch<RecruitStats>('/recruitment/stats').catch(() => ({ applicants: 0, inProcess: 0, hired: 0, academyClasses: 0 })),
      ]);
      setCandidates(c); setStats(s);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openNew = () => { setEditingRecord(null); setFormData({ ...EMPTY_FORM }); setFormError(null); setFormOpen(true); };
  const openEdit = (rec: Candidate) => { setEditingRecord(rec); setFormData({ ...rec }); setFormError(null); setFormOpen(true); };

  const handleSave = async () => {
    setFormSubmitting(true); setFormError(null);
    try {
      if (editingRecord) {
        await apiFetch(`/recruitment/candidates/${editingRecord.id}`, { method: 'PUT', body: JSON.stringify(formData) });
        addToast('Candidate updated', 'success');
      } else {
        await apiFetch('/recruitment/candidates', { method: 'POST', body: JSON.stringify(formData) });
        addToast('Candidate added', 'success');
      }
      setFormOpen(false); fetchData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setFormError(msg); addToast(msg, 'error');
    } finally { setFormSubmitting(false); }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await apiFetch(`/recruitment/candidates/${deleteId}`, { method: 'DELETE' });
      setDeleteId(null); fetchData();
      addToast('Candidate deleted', 'success');
    } catch (err) { addToast(err instanceof Error ? err.message : 'Delete failed', 'error'); }
  };

  const columns = [
    { key: 'candidate_name', label: 'Name' },
    { key: 'position', label: 'Position' },
    { key: 'email', label: 'Email' },
    { key: 'stage', label: 'Stage', render: (r: Candidate) => <span className={`badge ${r.stage === 'hired' ? 'badge-available' : r.stage === 'rejected' || r.stage === 'withdrawn' ? 'badge-busy' : 'badge-pending'}`}>{r.stage?.replace(/_/g, ' ')}</span> },
    { key: 'applied_date', label: 'Applied' },
    { key: 'actions', label: '', width: '80px', render: (r: Candidate) => (
      <div className="flex gap-2">
        <button onClick={(e) => { e.stopPropagation(); openEdit(r); }} className="text-rmpg-400 hover:text-white" title="Edit"><Pencil size={12} /></button>
        <button onClick={(e) => { e.stopPropagation(); setDeleteId(r.id); }} className="text-red-500 hover:text-red-300" title="Delete"><Trash2 size={12} /></button>
      </div>
    )},
  ];

  if (loading) return <div className="p-6 text-[#888888]">Loading recruitment data...</div>;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="RECRUITMENT" icon={UserPlus}>
        <button onClick={openNew} className="toolbar-btn flex items-center gap-1.5" style={{ height: 28, padding: '0 10px' }}>
          <Plus size={13} /> New Candidate
        </button>
      </PanelTitleBar>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatsCard label="TOTAL APPLICANTS" value={String(stats.applicants)} icon={Users} />
        <StatsCard label="IN PROCESS" value={String(stats.inProcess)} icon={Clock} />
        <StatsCard label="HIRED (YTD)" value={String(stats.hired)} icon={CheckCircle} />
        <StatsCard label="ACADEMY CLASSES" value={String(stats.academyClasses)} icon={GraduationCap} />
      </div>

      <DataTable columns={columns} data={candidates} emptyMessage="No candidates in pipeline" onRowClick={openEdit} />

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setFormOpen(false)}>
          <div className="bg-surface-raised border border-rmpg-700 p-6 max-w-lg w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-rmpg-100 mb-4">{editingRecord ? 'Edit Candidate' : 'New Candidate'}</h3>
            {formError && <div className="text-xs text-red-400 mb-2">{formError}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Name *</label><input value={formData.candidate_name} onChange={e => setFormData({...formData, candidate_name: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Position</label><input value={formData.position} onChange={e => setFormData({...formData, position: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Email</label><input value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Phone</label><input value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Stage</label><select value={formData.stage} onChange={e => setFormData({...formData, stage: e.target.value})} className="input-dark w-full mt-1 text-xs">{STAGES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Applied Date</label><input type="date" value={formData.applied_date} onChange={e => setFormData({...formData, applied_date: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
            </div>
            <div className="mt-3"><label className="text-[9px] text-rmpg-400 uppercase font-bold">Notes</label><textarea value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} className="input-dark w-full mt-1 text-xs" rows={3} /></div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setFormOpen(false)} className="toolbar-btn px-4" style={{ height: 28 }}>Cancel</button>
              <button onClick={handleSave} disabled={formSubmitting || !formData.candidate_name} className="toolbar-btn-primary px-4" style={{ height: 28 }}>{formSubmitting ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {deleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setDeleteId(null)}>
          <div className="bg-surface-raised border border-red-800 p-6 max-w-sm w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-red-400 mb-2">Delete Candidate</h3>
            <p className="text-xs text-[#888888] mb-4">This permanently removes this candidate record. This cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteId(null)} className="toolbar-btn px-4" style={{ height: 28 }}>Cancel</button>
              <button onClick={handleDelete} className="toolbar-btn-primary px-4 text-red-400 border-red-800" style={{ height: 28, borderColor: '#991b1b' }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
