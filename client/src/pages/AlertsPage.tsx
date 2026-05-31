import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { useToast } from '../components/ToastProvider';
import { Megaphone, FileText, Send, CheckCircle, Plus, Pencil, Trash2 } from 'lucide-react';

export default function AlertsPage() {
  const [templates, setTemplates] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ templates: 0, batches: 0, sent_batches: 0 });
  const [editingRecord, setEditingRecord] = useState<Record<string, any> | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const { addToast } = useToast();

  const fetchData = useCallback(async () => {
    try {
      const r = await apiFetch<{ data: Record<string, any>[] }>('/alerts/templates');
      setTemplates(r.data || []);
      const s = await apiFetch<{ templates: number; batches: number; sent_batches: number }>('/alerts/stats');
      setStats(s);
    } catch { /* */ }
  }, []);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);

  const openNew = () => { setEditingRecord(null); setFormData({ template_name: '', subject: '', body: '', channel: 'email', category: 'general' }); };
  const openEdit = (rec: Record<string, any>) => { setEditingRecord(rec); setFormData({ ...rec }); };
  const handleSave = async () => {
    setSubmitting(true);
    try {
      if (editingRecord) {
        await apiFetch(`/alerts/templates/${editingRecord.id}`, { method: 'PUT', body: JSON.stringify(formData) });
      } else {
        await apiFetch('/alerts/templates', { method: 'POST', body: JSON.stringify(formData) });
      }
      setEditingRecord(null); fetchData(); addToast(editingRecord ? 'Updated' : 'Created', 'success');
    } catch (err) { addToast(err instanceof Error ? err.message : 'Failed', 'error'); }
    finally { setSubmitting(false); }
  };
  const handleDelete = async () => {
    if (!deleteId) return;
    try { await apiFetch(`/alerts/templates/${deleteId}`, { method: 'DELETE' }); setDeleteId(null); fetchData(); addToast('Deleted', 'success'); }
    catch (err) { addToast(err instanceof Error ? err.message : 'Delete failed', 'error'); }
  };

  const showForm = editingRecord !== null;
  const columns = [
    { key: 'template_name', label: 'Template' }, { key: 'subject', label: 'Subject' },
    { key: 'channel', label: 'Channel' }, { key: 'category', label: 'Category' }, { key: 'created_at', label: 'Created' },
    { key: 'actions', label: '', width: '100px', render: (row: any) => (
      <div className="flex gap-2">
        <button onClick={(e) => { e.stopPropagation(); openEdit(row); }} className="text-rmpg-400 hover:text-white"><Pencil size={12} /></button>
        <button onClick={(e) => { e.stopPropagation(); setDeleteId(row.id); }} className="text-red-500 hover:text-red-300"><Trash2 size={12} /></button>
      </div>
    )},
  ];

  if (loading) return <div className="p-6 text-[#888888]">Loading notification system...</div>;
  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="MASS NOTIFICATION" icon={Megaphone}>
        <button onClick={openNew} className="toolbar-btn flex items-center gap-1.5" style={{ height: 28, padding: '0 10px' }}><Plus size={13} /> New Template</button>
      </PanelTitleBar>
      <div className="grid grid-cols-3 gap-3">
        <StatsCard icon={FileText} label="Templates" value={stats.templates} />
        <StatsCard icon={Send} label="Batches" value={stats.batches} />
        <StatsCard icon={CheckCircle} label="Sent" value={stats.sent_batches} />
      </div>
      <DataTable columns={columns} data={templates} emptyMessage="No notification templates" onRowClick={(row) => openEdit(row)} />
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setEditingRecord(null)}>
          <div className="bg-surface-raised border border-[#333] p-6 max-w-lg w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-white mb-4">{editingRecord ? 'Edit Template' : 'New Template'}</h3>
            <div className="space-y-3">
              <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Name <span className="text-red-500">*</span></label>
                <input className="input-dark mt-1" value={formData.template_name || ''} onChange={e => setFormData({...formData, template_name: e.target.value})} autoFocus /></div>
              <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Subject</label>
                <input className="input-dark mt-1" value={formData.subject || ''} onChange={e => setFormData({...formData, subject: e.target.value})} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Channel</label>
                  <select className="select-dark mt-1" value={formData.channel || 'email'} onChange={e => setFormData({...formData, channel: e.target.value})}>
                    {['email','sms','push','all'].map(c=><option key={c} value={c}>{c}</option>)}
                  </select></div>
                <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Category</label>
                  <input className="input-dark mt-1" value={formData.category || ''} onChange={e => setFormData({...formData, category: e.target.value})} /></div>
              </div>
              <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Body <span className="text-red-500">*</span></label>
                <textarea rows={4} className="input-dark mt-1" value={formData.body || ''} onChange={e => setFormData({...formData, body: e.target.value})} /></div>
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setEditingRecord(null)} className="toolbar-btn px-4" style={{ height: 28 }}>Cancel</button>
              <button onClick={handleSave} disabled={submitting} className="toolbar-btn-primary px-4" style={{ height: 28 }}>{submitting ? 'Saving...' : editingRecord ? 'Update' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}
      {deleteId !== null && (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setDeleteId(null)}><div className="bg-surface-raised border border-red-800 p-6 max-w-sm w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}><h3 className="text-sm font-bold text-red-400 mb-2">Delete Template</h3><p className="text-xs text-[#888888] mb-4">This permanently removes the template.</p><div className="flex justify-end gap-3"><button onClick={() => setDeleteId(null)} className="toolbar-btn px-4" style={{ height: 28 }}>Cancel</button><button onClick={handleDelete} className="toolbar-btn-primary px-4" style={{ height: 28, borderColor: '#991b1b', color: '#f87171' }}>Delete</button></div></div></div>)}
    </div>
  );
}
