import React, { useState, useEffect, useCallback } from 'react';
import {
  Building2, Plus, Edit2, Trash2, Users, Loader2, X, Search,
  ChevronRight, UserCircle,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import ConfirmDialog from '../../components/ConfirmDialog';
import type { User } from '../../types';

// ============================================================
// Department & Division Management Tab
// ============================================================

interface Department {
  id: string;
  name: string;
  code?: string;
  description?: string;
  parent_id?: number;
  parent_name?: string;
  manager_id?: number;
  manager_name?: string;
  is_active: number;
  user_count: number;
  created_at: string;
  updated_at: string;
}

interface Props {
  users: (User & { last_login_display?: string })[];
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

const emptyForm = { name: '', code: '', description: '', parent_id: '', manager_id: '', is_active: 1 };

export default function AdminDepartmentsTab({ users, LoadingSpinner, error, setError }: Props) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchDepartments = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Department[]>('/admin/departments');
      setDepartments(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load departments');
    } finally {
      setLoading(false);
    }
  }, [setError]);

  useEffect(() => { fetchDepartments(); }, [fetchDepartments]);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (d: Department) => {
    setEditing(d);
    setForm({
      name: d.name, code: d.code || '', description: d.description || '',
      parent_id: d.parent_id ? String(d.parent_id) : '',
      manager_id: d.manager_id ? String(d.manager_id) : '',
      is_active: d.is_active,
    });
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setError('Department name is required');
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        name: form.name.trim(),
        code: form.code.trim() || null,
        description: form.description.trim() || null,
        parent_id: form.parent_id ? parseInt(form.parent_id, 10) : null,
        manager_id: form.manager_id ? parseInt(form.manager_id, 10) : null,
        is_active: form.is_active,
      };
      if (editing) {
        await apiFetch(`/admin/departments/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await apiFetch('/admin/departments', { method: 'POST', body: JSON.stringify(body) });
      }
      setShowForm(false);
      setEditing(null);
      await fetchDepartments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save department');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await apiFetch(`/admin/departments/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      await fetchDepartments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete department');
    } finally {
      setDeleteLoading(false);
    }
  };

  const filtered = departments.filter((d) =>
    !search || d.name.toLowerCase().includes(search.toLowerCase()) || (d.code || '').toLowerCase().includes(search.toLowerCase())
  );

  // Build hierarchy for display
  const topLevel = filtered.filter((d) => !d.parent_id);
  const children = (parentId: string) => filtered.filter((d) => String(d.parent_id) === parentId);

  const activeUsers = users.filter((u) => u.is_active);

  if (loading && departments.length === 0) return <LoadingSpinner />;

  return (
    <div className="p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-brand-400" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-rmpg-200">Departments & Divisions</h2>
          <span className="text-[10px] text-rmpg-500 ml-1">({departments.length} total)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="input-dark text-[10px] pl-6 pr-2 py-1 w-40"
            />
          </div>
          <button onClick={openNew} className="toolbar-btn-primary text-[10px] flex items-center gap-1">
            <Plus className="w-3 h-3" />
            New Department
          </button>
        </div>
      </div>

      {/* Departments Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {topLevel.length === 0 && (
          <div className="col-span-2 text-center py-8 text-rmpg-500 text-xs">
            No departments found. Create one to get started.
          </div>
        )}
        {topLevel.map((dept) => {
          const subs = children(dept.id);
          return (
            <div key={dept.id} className={`panel-beveled bg-surface-base p-3 ${!dept.is_active ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-brand-400" />
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-rmpg-100">{dept.name}</span>
                      {dept.code && <span className="text-[9px] text-rmpg-500 font-mono">({dept.code})</span>}
                      {!dept.is_active && <span className="text-[9px] text-rmpg-500 italic">Inactive</span>}
                    </div>
                    {dept.description && <p className="text-[10px] text-rmpg-400 mt-0.5">{dept.description}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => openEdit(dept)} className="toolbar-btn p-1"><Edit2 className="w-3 h-3" /></button>
                  <button onClick={() => setDeleteTarget(dept)} className="toolbar-btn p-1 text-red-400 hover:text-red-300"><Trash2 className="w-3 h-3" /></button>
                </div>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-rmpg-400">
                {dept.manager_name && (
                  <span className="flex items-center gap-1"><UserCircle className="w-3 h-3" />{dept.manager_name}</span>
                )}
                <span className="flex items-center gap-1"><Users className="w-3 h-3" />{dept.user_count} personnel</span>
              </div>
              {subs.length > 0 && (
                <div className="mt-2 ml-4 space-y-1 border-l border-rmpg-700 pl-3">
                  {subs.map((sub) => (
                    <div key={sub.id} className="flex items-center justify-between bg-surface-sunken px-2 py-1 rounded-sm">
                      <div className="flex items-center gap-1.5">
                        <ChevronRight className="w-3 h-3 text-rmpg-600" />
                        <span className="text-[10px] text-rmpg-200 font-medium">{sub.name}</span>
                        {sub.code && <span className="text-[9px] text-rmpg-500 font-mono">({sub.code})</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] text-rmpg-500">{sub.user_count} personnel</span>
                        <button onClick={() => openEdit(sub)} className="toolbar-btn p-0.5"><Edit2 className="w-2.5 h-2.5" /></button>
                        <button onClick={() => setDeleteTarget(sub)} className="toolbar-btn p-0.5 text-red-400"><Trash2 className="w-2.5 h-2.5" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowForm(false)}>
          <div className="bg-surface-base panel-beveled w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-rmpg-700">
              <h3 className="text-xs font-bold uppercase tracking-wider text-rmpg-200">
                {editing ? 'Edit Department' : 'New Department'}
              </h3>
              <button onClick={() => setShowForm(false)} className="text-rmpg-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-1 block">Name *</label>
                <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="input-dark w-full text-xs" placeholder="e.g. Patrol Division" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-1 block">Code</label>
                  <input type="text" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} className="input-dark w-full text-xs font-mono" placeholder="e.g. PAT" maxLength={10} />
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-1 block">Parent Dept</label>
                  <select value={form.parent_id} onChange={(e) => setForm((f) => ({ ...f, parent_id: e.target.value }))} className="select-dark w-full text-xs">
                    <option value="">None (Top-level)</option>
                    {departments.filter((d) => d.id !== editing?.id).map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-1 block">Manager</label>
                <select value={form.manager_id} onChange={(e) => setForm((f) => ({ ...f, manager_id: e.target.value }))} className="select-dark w-full text-xs">
                  <option value="">No Manager</option>
                  {activeUsers.map((u) => (
                    <option key={u.id} value={u.id}>{u.first_name} {u.last_name} {u.badge_number ? `(${u.badge_number})` : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-1 block">Description</label>
                <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="input-dark w-full text-xs min-h-[60px] resize-y" placeholder="Department description..." />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-rmpg-700">
              <button onClick={() => setShowForm(false)} className="toolbar-btn text-[10px]">Cancel</button>
              <button onClick={handleSubmit} disabled={submitting} className="toolbar-btn-primary text-[10px] flex items-center gap-1">
                {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
                {editing ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Department"
        message={`Are you sure you want to delete "${deleteTarget?.name}"?${deleteTarget && deleteTarget.user_count > 0 ? ' This department has assigned personnel.' : ''}`}
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={deleteLoading}
      />
    </div>
  );
}
