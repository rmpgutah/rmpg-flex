import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { useToast } from '../components/ToastProvider';
import { Award, CheckCircle, Clock, FileText, Plus, Pencil, Trash2 } from 'lucide-react';

interface Standard { id: number; standard_number: string; standard_name: string; category: string; description: string; compliance_status: string; last_reviewed: string; next_review: string; notes: string; }
interface AccStats { standardsTotal: number; standardsCompliant: number; compliancePct: number; nextAssessment: string; }

const EMPTY_FORM = { standard_number: '', standard_name: '', category: '', description: '', compliance_status: 'pending', last_reviewed: '', next_review: '', notes: '' };

export default function AccreditationPage() {
  const [standards, setStandards] = useState<Standard[]>([]);
  const [stats, setStats] = useState<AccStats>({ standardsTotal: 0, standardsCompliant: 0, compliancePct: 0, nextAssessment: '' });
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Standard | null>(null);
  const [formData, setFormData] = useState<any>(EMPTY_FORM);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const { addToast } = useToast();

  const fetchData = useCallback(async () => {
    try {
      const [s, st] = await Promise.all([
        apiFetch<Standard[]>('/accreditation/standards').catch(() => []),
        apiFetch<AccStats>('/accreditation/stats').catch(() => ({ standardsTotal: 0, standardsCompliant: 0, compliancePct: 0, nextAssessment: '' })),
      ]);
      setStandards(s); setStats(st);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openNew = () => { setEditingRecord(null); setFormData({ ...EMPTY_FORM }); setFormError(null); setFormOpen(true); };
  const openEdit = (rec: Standard) => { setEditingRecord(rec); setFormData({ ...rec }); setFormError(null); setFormOpen(true); };

  const handleSave = async () => {
    setFormSubmitting(true); setFormError(null);
    try {
      if (editingRecord) {
        await apiFetch(`/accreditation/standards/${editingRecord.id}`, { method: 'PUT', body: JSON.stringify(formData) });
        addToast('Standard updated', 'success');
      } else {
        await apiFetch('/accreditation/standards', { method: 'POST', body: JSON.stringify(formData) });
        addToast('Standard added', 'success');
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
      await apiFetch(`/accreditation/standards/${deleteId}`, { method: 'DELETE' });
      setDeleteId(null); fetchData();
      addToast('Standard deleted', 'success');
    } catch (err) { addToast(err instanceof Error ? err.message : 'Delete failed', 'error'); }
  };

  const columns = [
    { key: 'standard_number', label: 'Standard #' },
    { key: 'standard_name', label: 'Name' },
    { key: 'category', label: 'Category' },
    { key: 'compliance_status', label: 'Status', render: (r: Standard) => <span className={`badge ${r.compliance_status === 'compliant' ? 'badge-available' : r.compliance_status === 'non_compliant' ? 'badge-busy' : 'badge-pending'}`}>{r.compliance_status?.replace(/_/g, ' ')}</span> },
    { key: 'last_reviewed', label: 'Last Reviewed', render: (r: Standard) => r.last_reviewed || '--' },
    { key: 'next_review', label: 'Next Review', render: (r: Standard) => r.next_review || '--' },
    { key: 'actions', label: '', width: '80px', render: (r: Standard) => (
      <div className="flex gap-2">
        <button onClick={(e) => { e.stopPropagation(); openEdit(r); }} className="text-rmpg-400 hover:text-white" title="Edit"><Pencil size={12} /></button>
        <button onClick={(e) => { e.stopPropagation(); setDeleteId(r.id); }} className="text-red-500 hover:text-red-300" title="Delete"><Trash2 size={12} /></button>
      </div>
    )},
  ];

  if (loading) return <div className="p-6 text-[#888888]">Loading accreditation data...</div>;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="ACCREDITATION" icon={Award}>
        <button onClick={openNew} className="toolbar-btn flex items-center gap-1.5" style={{ height: 28, padding: '0 10px' }}>
          <Plus size={13} /> New Standard
        </button>
      </PanelTitleBar>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatsCard label="TOTAL STANDARDS" value={String(stats.standardsTotal)} icon={FileText} />
        <StatsCard label="COMPLIANT" value={String(stats.standardsCompliant)} icon={CheckCircle} />
        <StatsCard label="COMPLIANCE RATE" value={`${stats.compliancePct}%`} icon={Award} />
        <StatsCard label="NEXT ASSESSMENT" value={stats.nextAssessment || 'N/A'} icon={Clock} />
      </div>

      <DataTable columns={columns} data={standards} emptyMessage="No accreditation standards" onRowClick={openEdit} />

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setFormOpen(false)}>
          <div className="bg-surface-raised border border-rmpg-700 p-6 max-w-lg w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-rmpg-100 mb-4">{editingRecord ? 'Edit Standard' : 'New Standard'}</h3>
            {formError && <div className="text-xs text-red-400 mb-2">{formError}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Standard # *</label><input id="ff-accreditationpage-0" value={formData.standard_number} onChange={e => setFormData({...formData, standard_number: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Name *</label><input id="ff-accreditationpage-1" value={formData.standard_name} onChange={e => setFormData({...formData, standard_name: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Category</label><input id="ff-accreditationpage-2" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Status</label><select id="ff-accreditationpage-3" value={formData.compliance_status} onChange={e => setFormData({...formData, compliance_status: e.target.value})} className="input-dark w-full mt-1 text-xs"><option value="pending">Pending</option><option value="in_progress">In Progress</option><option value="compliant">Compliant</option><option value="non_compliant">Non-Compliant</option></select></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Last Reviewed</label><input id="ff-accreditationpage-4" type="date" value={formData.last_reviewed} onChange={e => setFormData({...formData, last_reviewed: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Next Review</label><input id="ff-accreditationpage-5" type="date" value={formData.next_review} onChange={e => setFormData({...formData, next_review: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
            </div>
            <div className="mt-3"><label className="text-[9px] text-rmpg-400 uppercase font-bold">Description</label><textarea id="ff-accreditationpage-6" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="input-dark w-full mt-1 text-xs" rows={2} /></div>
            <div className="mt-3"><label className="text-[9px] text-rmpg-400 uppercase font-bold">Notes</label><textarea id="ff-accreditationpage-7" value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} className="input-dark w-full mt-1 text-xs" rows={2} /></div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setFormOpen(false)} className="toolbar-btn px-4" style={{ height: 28 }}>Cancel</button>
              <button onClick={handleSave} disabled={formSubmitting || !formData.standard_number || !formData.standard_name} className="toolbar-btn-primary px-4" style={{ height: 28 }}>{formSubmitting ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {deleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setDeleteId(null)}>
          <div className="bg-surface-raised border border-red-800 p-6 max-w-sm w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-red-400 mb-2">Delete Standard</h3>
            <p className="text-xs text-[#888888] mb-4">This permanently removes this accreditation standard. This cannot be undone.</p>
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
