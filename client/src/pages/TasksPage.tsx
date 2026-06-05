import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import TaskFormModal, { TaskFormData } from '../components/TaskFormModal';
import { useToast } from '../components/ToastProvider';
import { useMenuActions } from '../utils/contextMenuActions';
import { ClipboardList, Clock, AlertTriangle, Plus, Pencil, Trash2, Eye } from 'lucide-react';

interface Task {
  id: number; task_title: string; priority: string; status: string;
  assigned_to_name: string; due_date: string; created_at: string;
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, pending: 0, overdue: 0 });
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Task | undefined>(undefined);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const { addToast } = useToast();
  const m = useMenuActions();

  const fetchData = useCallback(async () => {
    try {
      const r = await apiFetch<{ data: Task[] }>('/tasks');
      setTasks(r.data || []);
      const s = await apiFetch<{ total: number; pending: number; overdue: number }>('/tasks/stats');
      setStats(s);
    } catch { /* */ }
  }, []);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);

  const openNew = () => { setEditingRecord(undefined); setFormError(null); setFormOpen(true); };
  const openEdit = (rec: Task) => { setEditingRecord(rec); setFormError(null); setFormOpen(true); };

  const handleSubmit = async (data: TaskFormData) => {
    setFormSubmitting(true); setFormError(null);
    try {
      const body: Record<string, any> = { ...data };
      if (body.assigned_to) body.assigned_to = parseInt(body.assigned_to);
      if (body.linked_entity_id) body.linked_entity_id = parseInt(body.linked_entity_id);
      if (editingRecord) {
        await apiFetch(`/tasks/${editingRecord.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await apiFetch('/tasks', { method: 'POST', body: JSON.stringify(body) });
      }
      setFormOpen(false); setEditingRecord(undefined); fetchData();
      addToast(editingRecord ? 'Task updated' : 'Task created', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed';
      setFormError(msg); addToast(msg, 'error');
    } finally { setFormSubmitting(false); }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await apiFetch(`/tasks/${deleteId}`, { method: 'DELETE' });
      setDeleteId(null); fetchData(); addToast('Task deleted', 'success');
    } catch (err) { addToast(err instanceof Error ? err.message : 'Delete failed', 'error'); }
  };

  const columns = [
    { key: 'task_title', label: 'Task' },
    { key: 'priority', label: 'Priority' },
    { key: 'status', label: 'Status' },
    { key: 'assigned_to_name', label: 'Assigned To' },
    { key: 'due_date', label: 'Due Date' },
    { key: 'actions', label: '', width: '100px', render: (row: Task) => (
      <div className="flex gap-2">
        <button onClick={(e) => { e.stopPropagation(); openEdit(row); }} className="text-rmpg-400 hover:text-white"><Pencil size={12} /></button>
        <button onClick={(e) => { e.stopPropagation(); setDeleteId(row.id); }} className="text-red-500 hover:text-red-300"><Trash2 size={12} /></button>
      </div>
    )},
  ];

  if (loading) return <div className="p-6 text-[#888888]">Loading tasks...</div>;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="TASK MANAGEMENT" icon={ClipboardList}>
        <button onClick={openNew} className="toolbar-btn flex items-center gap-1.5" style={{ height: 28, padding: '0 10px' }}>
          <Plus size={13} /> New Task
        </button>
      </PanelTitleBar>
      <div className="grid grid-cols-3 gap-3">
        <StatsCard icon={ClipboardList} label="Total Tasks" value={stats.total} />
        <StatsCard icon={Clock} label="Pending" value={stats.pending} />
        <StatsCard icon={AlertTriangle} label="Overdue" value={stats.overdue} />
      </div>
      <DataTable
        columns={columns}
        data={tasks}
        emptyMessage="No tasks found"
        onRowClick={(row) => openEdit(row)}
        rowContextMenu={(row) => [
          m.action('Open / edit', () => openEdit(row), { icon: <Eye size={12} /> }),
          m.separator(),
          m.copy('Copy task', row.task_title),
          m.copyId(row.id),
          m.separator(),
          m.action('Delete', () => setDeleteId(row.id), { danger: true, icon: <Trash2 size={12} /> }),
        ]}
      />
      <TaskFormModal isOpen={formOpen} onClose={() => { setFormOpen(false); setEditingRecord(undefined); }}
        onSubmit={handleSubmit} isSubmitting={formSubmitting} editingRecord={editingRecord} submitError={formError} />
      {deleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setDeleteId(null)}>
          <div className="bg-surface-raised border border-red-800 p-6 max-w-sm w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-red-400 mb-2">Delete Task</h3>
            <p className="text-xs text-[#888888] mb-4">This permanently removes the task and all comments.</p>
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
