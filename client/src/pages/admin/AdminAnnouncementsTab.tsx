import React, { useState, useEffect, useCallback } from 'react';
import {
  Megaphone, Plus, Edit2, Trash2, Eye, EyeOff, AlertTriangle,
  Info, Wrench, ArrowUpCircle, FileText, Clock, Loader2, X,
  CheckCircle2, Search,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { formatDateTime } from '../../utils/dateUtils';
import ConfirmDialog from '../../components/ConfirmDialog';

// ============================================================
// System Announcements Management Tab
// ============================================================

interface Announcement {
  id: string;
  title: string;
  body: string;
  type: 'info' | 'warning' | 'maintenance' | 'update' | 'policy';
  priority: 'normal' | 'high' | 'critical';
  target_roles: string;
  is_active: number;
  starts_at?: string;
  expires_at?: string;
  created_by: number;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
}

interface Props {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

const TYPE_ICONS: Record<string, React.ElementType> = {
  info: Info,
  warning: AlertTriangle,
  maintenance: Wrench,
  update: ArrowUpCircle,
  policy: FileText,
};

const TYPE_COLORS: Record<string, string> = {
  info: 'text-blue-400 bg-blue-950/30 border-blue-800/40',
  warning: 'text-amber-400 bg-amber-950/30 border-amber-800/40',
  maintenance: 'text-orange-400 bg-orange-950/30 border-orange-800/40',
  update: 'text-green-400 bg-green-950/30 border-green-800/40',
  policy: 'text-purple-400 bg-purple-950/30 border-purple-800/40',
};

const PRIORITY_COLORS: Record<string, string> = {
  normal: 'text-rmpg-300 bg-rmpg-700',
  high: 'text-amber-300 bg-amber-900/50',
  critical: 'text-red-300 bg-red-900/50',
};

const ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'];

const emptyForm: {
  title: string; body: string; type: Announcement['type']; priority: Announcement['priority'];
  target_roles: string; starts_at: string; expires_at: string; is_active: number;
} = {
  title: '', body: '', type: 'info', priority: 'normal',
  target_roles: '[]', starts_at: '', expires_at: '', is_active: 1,
};

export default function AdminAnnouncementsTab({ LoadingSpinner, error, setError }: Props) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchAnnouncements = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Announcement[]>('/admin/announcements/all');
      setAnnouncements(data || []);
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Failed to load announcements');
    } finally {
      setLoading(false);
    }
  }, [setError]);

  useEffect(() => { fetchAnnouncements(); }, [fetchAnnouncements]);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (a: Announcement) => {
    setEditing(a);
    setForm({
      title: a.title, body: a.body, type: a.type, priority: a.priority,
      target_roles: a.target_roles || '[]', starts_at: a.starts_at || '',
      expires_at: a.expires_at || '', is_active: a.is_active,
    });
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.body.trim()) {
      setError('Title and body are required');
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        ...form,
        starts_at: form.starts_at || null,
        expires_at: form.expires_at || null,
      };
      if (editing) {
        await apiFetch(`/admin/announcements/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await apiFetch('/admin/announcements', { method: 'POST', body: JSON.stringify(body) });
      }
      setShowForm(false);
      setEditing(null);
      await fetchAnnouncements();
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Failed to save announcement');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleteLoading(true);
    try {
      await apiFetch(`/admin/announcements/${deleteId}`, { method: 'DELETE' });
      setDeleteId(null);
      await fetchAnnouncements();
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Failed to delete announcement');
    } finally {
      setDeleteLoading(false);
    }
  };

  const toggleActive = async (a: Announcement) => {
    try {
      await apiFetch(`/admin/announcements/${a.id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: a.is_active ? 0 : 1 }),
      });
      await fetchAnnouncements();
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Failed to toggle announcement');
    }
  };

  const filtered = announcements.filter((a) =>
    !search || a.title.toLowerCase().includes(search.toLowerCase()) || a.body.toLowerCase().includes(search.toLowerCase())
  );

  const selectedRoles = (() => {
    try { return JSON.parse(form.target_roles) as string[]; } catch { return []; }
  })();

  const toggleRole = (role: string) => {
    const next = selectedRoles.includes(role) ? selectedRoles.filter((r) => r !== role) : [...selectedRoles, role];
    setForm((f) => ({ ...f, target_roles: JSON.stringify(next) }));
  };

  if (loading && announcements.length === 0) return <LoadingSpinner />;

  return (
    <div className="p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Megaphone className="w-4 h-4 text-brand-400" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-rmpg-200">System Announcements</h2>
          <span className="text-[10px] text-rmpg-500 ml-1">({announcements.filter((a) => a.is_active).length} active)</span>
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
            New Announcement
          </button>
        </div>
      </div>

      {/* Announcements List */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="text-center py-8 text-rmpg-500 text-xs">No announcements found.</div>
        ) : filtered.map((a) => {
          const TypeIcon = TYPE_ICONS[a.type] || Info;
          const typeColor = TYPE_COLORS[a.type] || TYPE_COLORS.info;
          const priorityColor = PRIORITY_COLORS[a.priority] || PRIORITY_COLORS.normal;
          const roles = (() => { try { return JSON.parse(a.target_roles || '[]'); } catch { return []; } })();

          return (
            <div
              key={a.id}
              className={`panel-beveled bg-surface-base p-3 border-l-[3px] ${a.is_active ? 'border-l-brand-500' : 'border-l-rmpg-700 opacity-60'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <div className={`p-1 rounded-sm border ${typeColor}`}>
                    <TypeIcon className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-bold text-rmpg-100 truncate">{a.title}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-sm font-bold uppercase ${priorityColor}`}>{a.priority}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-sm uppercase ${typeColor}`}>{a.type}</span>
                      {!a.is_active && <span className="text-[9px] text-rmpg-500 italic">Inactive</span>}
                    </div>
                    <p className="text-[10px] text-rmpg-300 line-clamp-2">{a.body}</p>
                    <div className="flex items-center gap-3 mt-1 text-[9px] text-rmpg-500">
                      <span>By {a.created_by_name || 'System'}</span>
                      <span>Created {formatDateTime(a.created_at)}</span>
                      {a.expires_at && <span className="flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" />Expires {formatDateTime(a.expires_at)}</span>}
                      {roles.length > 0 && <span>Targets: {roles.join(', ')}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => toggleActive(a)} className="toolbar-btn p-1" title={a.is_active ? 'Deactivate' : 'Activate'}>
                    {a.is_active ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  </button>
                  <button onClick={() => openEdit(a)} className="toolbar-btn p-1" title="Edit">
                    <Edit2 className="w-3 h-3" />
                  </button>
                  <button onClick={() => setDeleteId(a.id)} className="toolbar-btn p-1 text-red-400 hover:text-red-300" title="Delete">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowForm(false)}>
          <div className="bg-surface-base panel-beveled w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-rmpg-700">
              <h3 className="text-xs font-bold uppercase tracking-wider text-rmpg-200">
                {editing ? 'Edit Announcement' : 'New Announcement'}
              </h3>
              <button onClick={() => setShowForm(false)} className="text-rmpg-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-1 block">Title</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className="input-dark w-full text-xs"
                  placeholder="Announcement title..."
                />
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-1 block">Body</label>
                <textarea
                  value={form.body}
                  onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                  className="input-dark w-full text-xs min-h-[80px] resize-y"
                  placeholder="Announcement message..."
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-1 block">Type</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as any }))}
                    className="select-dark w-full text-xs"
                  >
                    <option value="info">Info</option>
                    <option value="warning">Warning</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="update">Update</option>
                    <option value="policy">Policy</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-1 block">Priority</label>
                  <select
                    value={form.priority}
                    onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as any }))}
                    className="select-dark w-full text-xs"
                  >
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-1 block">Starts At</label>
                  <input
                    type="datetime-local"
                    value={form.starts_at}
                    onChange={(e) => setForm((f) => ({ ...f, starts_at: e.target.value }))}
                    className="input-dark w-full text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-1 block">Expires At</label>
                  <input
                    type="datetime-local"
                    value={form.expires_at}
                    onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))}
                    className="input-dark w-full text-xs"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-1 block">
                  Target Roles <span className="text-rmpg-500 font-normal">(empty = all users)</span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {ROLES.map((role) => (
                    <button
                      key={role}
                      onClick={() => toggleRole(role)}
                      className={`text-[10px] px-2 py-0.5 rounded-sm border transition-colors ${
                        selectedRoles.includes(role)
                          ? 'bg-brand-600/30 border-brand-500 text-brand-300'
                          : 'bg-surface-sunken border-rmpg-700 text-rmpg-400 hover:border-rmpg-500'
                      }`}
                    >
                      {role}
                    </button>
                  ))}
                </div>
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
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Announcement"
        message="Are you sure you want to permanently delete this announcement?"
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={deleteLoading}
      />
    </div>
  );
}
