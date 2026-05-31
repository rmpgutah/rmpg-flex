import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import AffairsFormModal, { AffairsFormData } from '../components/AffairsFormModal';
import { useToast } from '../components/ToastProvider';
import { ShieldAlert, FileText, Clock, Flag, Plus, Pencil, Trash2 } from 'lucide-react';

interface Complaint {
  id: number; complaint_number: string; complainant_name: string;
  complaint_type: string; status: string; subject_officer_name: string; created_at: string;
}

export default function AffairsPage() {
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total_complaints: 0, open_complaints: 0, unresolved_flags: 0 });
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Complaint | undefined>(undefined);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const { addToast } = useToast();

  const fetchData = useCallback(async () => {
    try {
      const r = await apiFetch<{ data: Complaint[] }>('/affairs/complaints');
      setComplaints(r.data || []);
      const s = await apiFetch<{ total_complaints: number; open_complaints: number; unresolved_flags: number }>('/affairs/stats');
      setStats(s);
    } catch { /* */ }
  }, []);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);

  const openNew = () => { setEditingRecord(undefined); setFormError(null); setFormOpen(true); };
  const openEdit = (rec: Complaint) => { setEditingRecord(rec); setFormError(null); setFormOpen(true); };

  const handleSubmit = async (data: AffairsFormData) => {
    setFormSubmitting(true); setFormError(null);
    try {
      const body: Record<string, any> = { ...data };
      if (body.subject_officer_id) body.subject_officer_id = parseInt(body.subject_officer_id);
      if (editingRecord) {
        await apiFetch(`/affairs/complaints/${editingRecord.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await apiFetch('/affairs/complaints', { method: 'POST', body: JSON.stringify(body) });
      }
      setFormOpen(false); setEditingRecord(undefined); fetchData();
      addToast(editingRecord ? 'Complaint updated' : 'Complaint filed', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed';
      setFormError(msg); addToast(msg, 'error');
    } finally { setFormSubmitting(false); }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await apiFetch(`/affairs/complaints/${deleteId}`, { method: 'DELETE' });
      setDeleteId(null); fetchData(); addToast('Complaint deleted', 'success');
    } catch (err) { addToast(err instanceof Error ? err.message : 'Delete failed', 'error'); }
  };

  const columns = [
    { key: 'complaint_number', label: 'Case #' },
    { key: 'complainant_name', label: 'Complainant' },
    { key: 'complaint_type', label: 'Type', render: (r: Complaint) => r.complaint_type?.replace(/_/g, ' ') },
    { key: 'subject_officer_name', label: 'Subject Officer' },
    { key: 'status', label: 'Status', render: (r: Complaint) => r.status?.replace(/_/g, ' ') },
    { key: 'created_at', label: 'Filed' },
    { key: 'actions', label: '', width: '100px', render: (row: Complaint) => (
      <div className="flex gap-2">
        <button onClick={(e) => { e.stopPropagation(); openEdit(row); }} className="text-rmpg-400 hover:text-white"><Pencil size={12} /></button>
        <button onClick={(e) => { e.stopPropagation(); setDeleteId(row.id); }} className="text-red-500 hover:text-red-300"><Trash2 size={12} /></button>
      </div>
    )},
  ];

  if (loading) return <div className="p-6 text-[#888888]">Loading internal affairs records...</div>;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="INTERNAL AFFAIRS" icon={ShieldAlert}>
        <button onClick={openNew} className="toolbar-btn flex items-center gap-1.5" style={{ height: 28, padding: '0 10px' }}>
          <Plus size={13} /> New Complaint
        </button>
      </PanelTitleBar>
      <div className="grid grid-cols-3 gap-3">
        <StatsCard icon={FileText} label="Total Complaints" value={stats.total_complaints} />
        <StatsCard icon={Clock} label="Open Complaints" value={stats.open_complaints} />
        <StatsCard icon={Flag} label="Active Flags" value={stats.unresolved_flags} />
      </div>
      <DataTable columns={columns} data={complaints} emptyMessage="No complaints found" onRowClick={(row) => openEdit(row)} />
      <AffairsFormModal isOpen={formOpen} onClose={() => { setFormOpen(false); setEditingRecord(undefined); }}
        onSubmit={handleSubmit} isSubmitting={formSubmitting} editingRecord={editingRecord} submitError={formError} />
      {deleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setDeleteId(null)}>
          <div className="bg-surface-raised border border-red-800 p-6 max-w-sm w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-red-400 mb-2">Delete Complaint</h3>
            <p className="text-xs text-[#888888] mb-4">This permanently removes the complaint and all investigations.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteId(null)} className="toolbar-btn px-4" style={{ height: 28 }}>Cancel</button>
              <button onClick={handleDelete} className="toolbar-btn-primary px-4" style={{ height: 28, borderColor: '#991b1b', color: '#f87171' }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
