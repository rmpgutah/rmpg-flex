import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { useToast } from '../components/ToastProvider';
import { Share2, Building2, FileText, ArrowRightLeft, Plus, Pencil, Trash2 } from 'lucide-react';

export default function InteragencyPage() {
  const [partners, setPartners] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ partners: 0, active_agreements: 0, total_exchanges: 0 });
  const [editingRecord, setEditingRecord] = useState<Record<string, any> | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const { addToast } = useToast();

  const fetchData = useCallback(async () => {
    try {
      const r = await apiFetch<{ data: Record<string, any>[] }>('/interagency/partners');
      setPartners(r.data || []);
      const s = await apiFetch<{ partners: number; active_agreements: number; total_exchanges: number }>('/interagency/stats');
      setStats(s);
    } catch { /* */ }
  }, []);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);

  const openNew = () => { setEditingRecord(null); setFormData({ agency_name: '', agency_type: '', jurisdiction: '', contact_name: '', contact_email: '', contact_phone: '', data_share_level: 'none' }); };
  const openEdit = (rec: Record<string, any>) => { setEditingRecord(rec); setFormData({ ...rec }); };
  const handleSave = async () => {
    setSubmitting(true);
    try {
      if (editingRecord) {
        await apiFetch(`/interagency/partners/${editingRecord.id}`, { method: 'PUT', body: JSON.stringify(formData) });
      } else {
        await apiFetch('/interagency/partners', { method: 'POST', body: JSON.stringify(formData) });
      }
      setEditingRecord(null); fetchData(); addToast(editingRecord ? 'Updated' : 'Created', 'success');
    } catch (err) { addToast(err instanceof Error ? err.message : 'Failed', 'error'); }
    finally { setSubmitting(false); }
  };
  const handleDelete = async () => {
    if (!deleteId) return;
    try { await apiFetch(`/interagency/partners/${deleteId}`, { method: 'DELETE' }); setDeleteId(null); fetchData(); addToast('Deleted', 'success'); }
    catch (err) { addToast(err instanceof Error ? err.message : 'Delete failed', 'error'); }
  };

  const showForm = editingRecord !== null;
  const columns = [
    { key: 'agency_name', label: 'Agency' }, { key: 'agency_type', label: 'Type' },
    { key: 'jurisdiction', label: 'Jurisdiction' }, { key: 'data_share_level', label: 'Share Level' }, { key: 'status', label: 'Status' },
    { key: 'actions', label: '', width: '100px', render: (row: any) => (
      <div className="flex gap-2">
        <button onClick={(e) => { e.stopPropagation(); openEdit(row); }} className="text-rmpg-400 hover:text-white"><Pencil size={12} /></button>
        <button onClick={(e) => { e.stopPropagation(); setDeleteId(row.id); }} className="text-red-500 hover:text-red-300"><Trash2 size={12} /></button>
      </div>
    )},
  ];

  if (loading) return <div className="p-6 text-[#888888]">Loading interagency records...</div>;
  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="INTERAGENCY DATA SHARING" icon={Share2}>
        <button onClick={openNew} className="toolbar-btn flex items-center gap-1.5" style={{ height: 28, padding: '0 10px' }}><Plus size={13} /> New Partner</button>
      </PanelTitleBar>
      <div className="grid grid-cols-3 gap-3">
        <StatsCard icon={Building2} label="Partner Agencies" value={stats.partners} />
        <StatsCard icon={FileText} label="Active Agreements" value={stats.active_agreements} />
        <StatsCard icon={ArrowRightLeft} label="Data Exchanges" value={stats.total_exchanges} />
      </div>
      <DataTable columns={columns} data={partners} emptyMessage="No interagency partners found" onRowClick={(row) => openEdit(row)} />
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setEditingRecord(null)}>
          <div className="bg-surface-raised border border-[#333] p-6 max-w-lg w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-white mb-4">{editingRecord ? 'Edit Partner' : 'New Partner'}</h3>
            <div className="space-y-3">
              <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Agency Name <span className="text-red-500">*</span></label>
                <input className="input-dark mt-1" value={formData.agency_name || ''} onChange={e => setFormData({...formData, agency_name: e.target.value})} autoFocus /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Type</label>
                  <input className="input-dark mt-1" value={formData.agency_type || ''} onChange={e => setFormData({...formData, agency_type: e.target.value})} placeholder="e.g. PD, Sheriff" /></div>
                <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Jurisdiction</label>
                  <input className="input-dark mt-1" value={formData.jurisdiction || ''} onChange={e => setFormData({...formData, jurisdiction: e.target.value})} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Contact Name</label>
                  <input className="input-dark mt-1" value={formData.contact_name || ''} onChange={e => setFormData({...formData, contact_name: e.target.value})} /></div>
                <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Contact Email</label>
                  <input className="input-dark mt-1" value={formData.contact_email || ''} onChange={e => setFormData({...formData, contact_email: e.target.value})} /></div>
              </div>
              <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Phone</label>
                <input className="input-dark mt-1" value={formData.contact_phone || ''} onChange={e => setFormData({...formData, contact_phone: e.target.value})} /></div>
              <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Share Level</label>
                <select className="select-dark mt-1" value={formData.data_share_level || 'none'} onChange={e => setFormData({...formData, data_share_level: e.target.value})}>
                  {['none','basic','partial','full'].map(l=><option key={l} value={l}>{l}</option>)}
                </select></div>
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setEditingRecord(null)} className="toolbar-btn px-4" style={{ height: 28 }}>Cancel</button>
              <button onClick={handleSave} disabled={submitting} className="toolbar-btn-primary px-4" style={{ height: 28 }}>{submitting ? 'Saving...' : editingRecord ? 'Update' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}
      {deleteId !== null && (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setDeleteId(null)}><div className="bg-surface-raised border border-red-800 p-6 max-w-sm w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}><h3 className="text-sm font-bold text-red-400 mb-2">Delete Partner</h3><p className="text-xs text-[#888888] mb-4">This permanently removes the partner agency.</p><div className="flex justify-end gap-3"><button onClick={() => setDeleteId(null)} className="toolbar-btn px-4" style={{ height: 28 }}>Cancel</button><button onClick={handleDelete} className="toolbar-btn-primary px-4" style={{ height: 28, borderColor: '#991b1b', color: '#f87171' }}>Delete</button></div></div></div>)}
    </div>
  );
}
