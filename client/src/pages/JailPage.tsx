import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import JailFormModal, { JailFormData } from '../components/JailFormModal';
import { useToast } from '../components/ToastProvider';
import { useMenuActions } from '../utils/contextMenuActions';
import type { ContextMenuItem } from '../context/ContextMenuContext';
import { Building2, Users, DoorOpen, ClipboardList, Plus, Pencil, Trash2, Eye } from 'lucide-react';

interface Inmate {
  id: number; booking_number: string; last_name: string; first_name: string;
  status: string; housing_unit: string; booking_date: string; gender: string; dob: string;
}

export default function JailPage() {
  const [inmates, setInmates] = useState<Inmate[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, housed: 0, booked: 0 });
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Inmate | undefined>(undefined);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const { addToast } = useToast();
  const m = useMenuActions();

  const fetchInmates = useCallback(async () => {
    try {
      const r = await apiFetch<{ data: Inmate[]; pagination: any }>('/jail/inmates');
      setInmates(r.data || []);
    } catch { /* ignore */ }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const r = await apiFetch<{ total: number; housed: number; booked: number }>('/jail/stats');
      setStats(r);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    Promise.all([fetchInmates(), fetchStats()]).finally(() => setLoading(false));
  }, [fetchInmates, fetchStats]);

  const openNew = () => { setEditingRecord(undefined); setFormError(null); setFormOpen(true); };
  const openEdit = (rec: Inmate) => { setEditingRecord(rec); setFormError(null); setFormOpen(true); };

  const handleFormSubmit = async (data: JailFormData) => {
    setFormSubmitting(true); setFormError(null);
    try {
      const body: Record<string, any> = { ...data };
      if (body.height_inches) body.height_inches = parseInt(body.height_inches);
      if (body.weight_lbs) body.weight_lbs = parseInt(body.weight_lbs);
      if (body.arresting_officer_id) body.arresting_officer_id = parseInt(body.arresting_officer_id);
      if (body.arrest_incident_id) body.arrest_incident_id = parseInt(body.arrest_incident_id);
      if (body.bail_amount) body.bail_amount = parseFloat(body.bail_amount);

      if (editingRecord) {
        await apiFetch(`/jail/inmates/${editingRecord.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await apiFetch('/jail/inmates', { method: 'POST', body: JSON.stringify(body) });
      }
      setFormOpen(false); setEditingRecord(undefined);
      fetchInmates(); fetchStats();
      addToast(editingRecord ? 'Inmate updated' : 'Inmate booked', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save inmate';
      setFormError(msg); addToast(msg, 'error');
    } finally { setFormSubmitting(false); }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await apiFetch(`/jail/inmates/${deleteId}`, { method: 'DELETE' });
      setDeleteId(null); fetchInmates(); fetchStats();
      addToast('Inmate record deleted', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  };

  const columns = [
    { key: 'booking_number', label: 'Booking #' },
    { key: 'last_name', label: 'Last Name' },
    { key: 'first_name', label: 'First Name' },
    { key: 'status', label: 'Status' },
    { key: 'housing_unit', label: 'Housing' },
    { key: 'booking_date', label: 'Booking Date' },
    {
      key: 'actions', label: '', width: '100px', render: (row: Inmate) => (
        <div className="flex gap-2">
          <button onClick={(e) => { e.stopPropagation(); openEdit(row); }} className="text-rmpg-400 hover:text-white" title="Edit"><Pencil size={12} /></button>
          <button onClick={(e) => { e.stopPropagation(); setDeleteId(row.id); }} className="text-red-500 hover:text-red-300" title="Delete"><Trash2 size={12} /></button>
        </div>
      ),
    },
  ];

  if (loading) return <div className="p-6 text-[#888888]">Loading jail records...</div>;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="JAIL MANAGEMENT" icon={Building2}>
        <button onClick={openNew} className="toolbar-btn flex items-center gap-1.5" style={{ height: 28, padding: '0 10px' }}>
          <Plus size={13} /> New Inmate
        </button>
      </PanelTitleBar>
      <div className="grid grid-cols-3 gap-3">
        <StatsCard icon={Users} label="Total Inmates" value={stats.total} />
        <StatsCard icon={DoorOpen} label="Currently Housed" value={stats.housed} />
        <StatsCard icon={ClipboardList} label="Booked (Intake)" value={stats.booked} />
      </div>
      <DataTable
        columns={columns}
        data={inmates}
        emptyMessage="No inmates in custody"
        onRowClick={(row) => openEdit(row)}
        rowContextMenu={(row): ContextMenuItem[] => [
          m.action('Open', () => openEdit(row), { icon: <Eye size={12} /> }),
          m.action('Edit', () => openEdit(row), { icon: <Pencil size={12} /> }),
          m.separator(),
          m.copyId(row.id),
          m.action('Delete', () => setDeleteId(row.id), { danger: true, icon: <Trash2 size={12} /> }),
        ]}
      />

      <JailFormModal isOpen={formOpen} onClose={() => { setFormOpen(false); setEditingRecord(undefined); }}
        onSubmit={handleFormSubmit} isSubmitting={formSubmitting}
        editingRecord={editingRecord} submitError={formError} />

      {deleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setDeleteId(null)}>
          <div className="bg-surface-raised border border-red-800 p-6 max-w-sm w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-red-400 mb-2">Delete Inmate Record</h3>
            <p className="text-xs text-[#888888] mb-4">This permanently removes the inmate and all associated records. This cannot be undone.</p>
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
