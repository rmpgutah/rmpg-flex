import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { useToast } from '../components/ToastProvider';
import { Shield, AlertTriangle, ClipboardCheck, FileText, Plus, Pencil, Trash2 } from 'lucide-react';

export default function RiskPage() {
  const [assessments, setAssessments] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ active_assessments: 0, pending_inspections: 0, open_claims: 0 });
  const [editingRecord, setEditingRecord] = useState<Record<string, any> | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const { addToast } = useToast();

  const fetchData = useCallback(async () => {
    try {
      const r = await apiFetch<{ data: Record<string, any>[] }>('/risk/assessments');
      setAssessments(r.data || []);
      const s = await apiFetch<{ active_assessments: number; pending_inspections: number; open_claims: number }>('/risk/stats');
      setStats(s);
    } catch { /* */ }
  }, []);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);

  const openNew = () => { setEditingRecord(null); setFormData({ entity_type: '', risk_level: 'low', risk_category: '', description: '', mitigation_plan: '' }); };
  const openEdit = (rec: Record<string, any>) => { setEditingRecord(rec); setFormData({ ...rec }); };
  const handleSave = async () => {
    setSubmitting(true);
    try {
      if (editingRecord) {
        await apiFetch(`/risk/assessments/${editingRecord.id}`, { method: 'PUT', body: JSON.stringify(formData) });
      } else {
        await apiFetch('/risk/assessments', { method: 'POST', body: JSON.stringify(formData) });
      }
      setEditingRecord(null); fetchData(); addToast(editingRecord ? 'Updated' : 'Created', 'success');
    } catch (err) { addToast(err instanceof Error ? err.message : 'Failed', 'error'); }
    finally { setSubmitting(false); }
  };
  const handleDelete = async () => {
    if (!deleteId) return;
    try { await apiFetch(`/risk/assessments/${deleteId}`, { method: 'DELETE' }); setDeleteId(null); fetchData(); addToast('Deleted', 'success'); }
    catch (err) { addToast(err instanceof Error ? err.message : 'Delete failed', 'error'); }
  };

  const showForm = editingRecord !== null;
  const columns = [
    { key: 'assessment_number', label: 'Assessment #' }, { key: 'entity_type', label: 'Entity' },
    { key: 'risk_level', label: 'Risk Level' }, { key: 'risk_category', label: 'Category' },
    { key: 'assessed_date', label: 'Date' }, { key: 'status', label: 'Status' },
    { key: 'actions', label: '', width: '100px', render: (row: any) => (
      <div className="flex gap-2">
        <button onClick={(e) => { e.stopPropagation(); openEdit(row); }} className="text-rmpg-400 hover:text-white"><Pencil size={12} /></button>
        <button onClick={(e) => { e.stopPropagation(); setDeleteId(row.id); }} className="text-red-500 hover:text-red-300"><Trash2 size={12} /></button>
      </div>
    )},
  ];

  if (loading) return <div className="p-6 text-[#888888]">Loading risk records...</div>;
  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="RISK MANAGEMENT" icon={Shield}>
        <button onClick={openNew} className="toolbar-btn flex items-center gap-1.5" style={{ height: 28, padding: '0 10px' }}><Plus size={13} /> New Assessment</button>
      </PanelTitleBar>
      <div className="grid grid-cols-3 gap-3">
        <StatsCard icon={AlertTriangle} label="Active Assessments" value={stats.active_assessments} />
        <StatsCard icon={ClipboardCheck} label="Pending Inspections" value={stats.pending_inspections} />
        <StatsCard icon={FileText} label="Open Claims" value={stats.open_claims} />
      </div>
      <DataTable columns={columns} data={assessments} emptyMessage="No risk assessments found" onRowClick={(row) => openEdit(row)} />
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setEditingRecord(null)}>
          <div className="bg-surface-raised border border-[#333] p-6 max-w-lg w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-white mb-4">{editingRecord ? 'Edit Assessment' : 'New Assessment'}</h3>
            <div className="space-y-3">
              <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Entity Type <span className="text-red-500">*</span></label>
                <input id="ff-riskpage-0" className="input-dark mt-1" value={formData.entity_type || ''} onChange={e => setFormData({...formData, entity_type: e.target.value})} autoFocus placeholder="e.g. premise, officer, vehicle" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Risk Level</label>
                  <select id="ff-riskpage-1" className="select-dark mt-1" value={formData.risk_level || 'low'} onChange={e => setFormData({...formData, risk_level: e.target.value})}>
                    {['low','moderate','high','critical'].map(l=><option key={l} value={l}>{l}</option>)}
                  </select></div>
                <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Category</label>
                  <input id="ff-riskpage-2" className="input-dark mt-1" value={formData.risk_category || ''} onChange={e => setFormData({...formData, risk_category: e.target.value})} /></div>
              </div>
              <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Description <span className="text-red-500">*</span></label>
                <textarea id="ff-riskpage-3" rows={3} className="input-dark mt-1" value={formData.description || ''} onChange={e => setFormData({...formData, description: e.target.value})} /></div>
              <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Mitigation Plan</label>
                <textarea id="ff-riskpage-4" rows={2} className="input-dark mt-1" value={formData.mitigation_plan || ''} onChange={e => setFormData({...formData, mitigation_plan: e.target.value})} /></div>
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setEditingRecord(null)} className="toolbar-btn px-4" style={{ height: 28 }}>Cancel</button>
              <button onClick={handleSave} disabled={submitting} className="toolbar-btn-primary px-4" style={{ height: 28 }}>{submitting ? 'Saving...' : editingRecord ? 'Update' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}
      {deleteId !== null && (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setDeleteId(null)}><div className="bg-surface-raised border border-red-800 p-6 max-w-sm w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}><h3 className="text-sm font-bold text-red-400 mb-2">Delete Assessment</h3><p className="text-xs text-[#888888] mb-4">This permanently removes the assessment.</p><div className="flex justify-end gap-3"><button onClick={() => setDeleteId(null)} className="toolbar-btn px-4" style={{ height: 28 }}>Cancel</button><button onClick={handleDelete} className="toolbar-btn-primary px-4" style={{ height: 28, borderColor: '#991b1b', color: '#f87171' }}>Delete</button></div></div></div>)}
    </div>
  );
}
