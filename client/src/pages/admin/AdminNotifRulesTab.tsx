import React, { useState, useEffect, useCallback } from 'react';
import {
  Bell, Plus, Edit2, Trash2, Zap, Loader2, X, Search,
  Play, CheckCircle2, AlertTriangle, Mail, Smartphone,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import ConfirmDialog from '../../components/ConfirmDialog';
import type { User } from '../../types';

// ============================================================
// Notification Rules / Alert Engine Tab
// ============================================================

interface NotificationRule {
  id: string;
  name: string;
  description?: string;
  trigger_event: string;
  conditions: string;
  target_roles: string;
  target_user_ids: string;
  notification_type: 'in_app' | 'email' | 'both';
  is_active: number;
  created_by: number;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
}

interface Props {
  users: (User & { last_login_display?: string })[];
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

const TRIGGER_EVENTS = [
  { value: 'call_created_p1', label: 'P1 Call Created', desc: 'When a Priority 1 call is created' },
  { value: 'call_created_p2', label: 'P2 Call Created', desc: 'When a Priority 2 call is created' },
  { value: 'warrant_created', label: 'Warrant Created', desc: 'When a new warrant is entered' },
  { value: 'warrant_served', label: 'Warrant Served', desc: 'When a warrant is served' },
  { value: 'credential_expiring', label: 'Credential Expiring', desc: 'When an officer credential is about to expire' },
  { value: 'unit_panic', label: 'Panic Button', desc: 'When a unit activates panic' },
  { value: 'shift_unattended', label: 'Shift Unattended', desc: 'When a scheduled shift has no clock-in' },
  { value: 'invoice_overdue', label: 'Invoice Overdue', desc: 'When an invoice passes its due date' },
  { value: 'incident_submitted', label: 'Incident Submitted', desc: 'When an incident report is submitted for review' },
  { value: 'bolo_created', label: 'BOLO Created', desc: 'When a new BOLO is issued' },
  { value: 'login_failed_threshold', label: 'Login Failures', desc: 'When login failures exceed threshold' },
  { value: 'training_expiring', label: 'Training Expiring', desc: 'When training certification is about to expire' },
  { value: 'vehicle_maintenance_due', label: 'Vehicle Service Due', desc: 'When a fleet vehicle needs maintenance' },
];

const ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'];

const NOTIF_TYPE_ICONS: Record<string, React.ElementType> = {
  in_app: Smartphone,
  email: Mail,
  both: Bell,
};

const emptyForm: {
  name: string; description: string; trigger_event: string;
  conditions: string; target_roles: string; target_user_ids: string;
  notification_type: NotificationRule['notification_type']; is_active: number;
} = {
  name: '', description: '', trigger_event: 'call_created_p1',
  conditions: '{}', target_roles: '[]', target_user_ids: '[]',
  notification_type: 'in_app', is_active: 1,
};

export default function AdminNotifRulesTab({ users, LoadingSpinner, error, setError }: Props) {
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<NotificationRule | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<NotificationRule[]>('/admin/notification-rules');
      setRules(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notification rules');
    } finally {
      setLoading(false);
    }
  }, [setError]);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (r: NotificationRule) => {
    setEditing(r);
    setForm({
      name: r.name, description: r.description || '', trigger_event: r.trigger_event,
      conditions: r.conditions || '{}', target_roles: r.target_roles || '[]',
      target_user_ids: r.target_user_ids || '[]',
      notification_type: r.notification_type, is_active: r.is_active,
    });
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) { setError('Rule name is required'); return; }
    setSubmitting(true);
    try {
      if (editing) {
        await apiFetch(`/admin/notification-rules/${editing.id}`, { method: 'PUT', body: JSON.stringify(form) });
      } else {
        await apiFetch('/admin/notification-rules', { method: 'POST', body: JSON.stringify(form) });
      }
      setShowForm(false);
      setEditing(null);
      await fetchRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save rule');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleteLoading(true);
    try {
      await apiFetch(`/admin/notification-rules/${deleteId}`, { method: 'DELETE' });
      setDeleteId(null);
      await fetchRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete rule');
    } finally {
      setDeleteLoading(false);
    }
  };

  const testRule = async (ruleId: string) => {
    setTesting(ruleId);
    try {
      await apiFetch(`/admin/notification-rules/${ruleId}/test`, { method: 'POST' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send test notification');
    } finally {
      setTimeout(() => setTesting(null), 2000);
    }
  };

  const toggleActive = async (r: NotificationRule) => {
    try {
      await apiFetch(`/admin/notification-rules/${r.id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: r.is_active ? 0 : 1 }),
      });
      await fetchRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle rule');
    }
  };

  const filtered = rules.filter((r) =>
    !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.trigger_event.includes(search.toLowerCase())
  );

  const selectedRoles = (() => { try { return JSON.parse(form.target_roles) as string[]; } catch { return []; } })();
  const toggleRole = (role: string) => {
    const next = selectedRoles.includes(role) ? selectedRoles.filter((r) => r !== role) : [...selectedRoles, role];
    setForm((f) => ({ ...f, target_roles: JSON.stringify(next) }));
  };

  if (loading && rules.length === 0) return <LoadingSpinner />;

  // Keyboard shortcut: Escape to close modals
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setEditing(null); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-brand-400" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-rmpg-200">Notification Rules</h2>
          <span className="text-[10px] text-rmpg-500 ml-1">({rules.filter((r) => r.is_active).length} active)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..." aria-label="Search notification rules" className="input-dark text-[10px] pl-6 pr-2 py-1 w-40 min-h-[36px]" />
          </div>
          <button type="button" onClick={openNew} className="toolbar-btn-primary text-[10px] flex items-center gap-1">
            <Plus className="w-3 h-3" />
            New Rule
          </button>
        </div>
      </div>

      {/* Rules List */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-rmpg-500 text-xs gap-2">
            <Zap className="w-6 h-6 text-rmpg-600" />
            <span>No notification rules configured.</span>
          </div>
        ) : filtered.map((r) => {
          const trigger = TRIGGER_EVENTS.find((t) => t.value === r.trigger_event);
          const NotifIcon = NOTIF_TYPE_ICONS[r.notification_type] || Bell;
          const roles = (() => { try { return JSON.parse(r.target_roles || '[]') as string[]; } catch { return []; } })();

          return (
            <div key={r.id} className={`panel-beveled bg-surface-base p-3 border-l-[3px] ${r.is_active ? 'border-l-brand-500' : 'border-l-rmpg-700 opacity-60'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <div className="p-1 rounded-sm bg-surface-sunken border border-rmpg-700">
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-bold text-rmpg-100">{r.name}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded-sm bg-surface-sunken text-rmpg-300 font-mono">
                        {trigger?.label || r.trigger_event}
                      </span>
                      <span className="flex items-center gap-0.5 text-[9px] text-rmpg-400">
                        <NotifIcon className="w-2.5 h-2.5" />
                        {r.notification_type}
                      </span>
                    </div>
                    {r.description && <p className="text-[10px] text-rmpg-400">{r.description}</p>}
                    <div className="flex items-center gap-3 mt-1 text-[9px] text-rmpg-500">
                      {roles.length > 0 && <span>Targets: {roles.join(', ')}</span>}
                      <span>By {r.created_by_name || 'System'}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button"
                    onClick={() => testRule(r.id)}
                    disabled={testing === r.id}
                    className="toolbar-btn p-1"
                    title="Send test notification"
                  >
                    {testing === r.id ? <CheckCircle2 className="w-3 h-3 text-green-400" /> : <Play className="w-3 h-3" />}
                  </button>
                  <button type="button" onClick={() => toggleActive(r)} className="toolbar-btn p-1" title={r.is_active ? 'Disable' : 'Enable'}>
                    <span className={`text-[9px] font-bold ${r.is_active ? 'text-green-400' : 'text-rmpg-500'}`}>
                      {r.is_active ? 'ON' : 'OFF'}
                    </span>
                  </button>
                  <button type="button" onClick={() => openEdit(r)} className="toolbar-btn p-1"><Edit2 className="w-3 h-3" /></button>
                  <button type="button" onClick={() => setDeleteId(r.id)} className="toolbar-btn p-1 text-red-400 hover:text-red-300"><Trash2 className="w-3 h-3" /></button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in" onClick={() => setShowForm(false)} role="dialog" aria-modal="true" aria-label={editing ? 'Edit notification rule' : 'New notification rule'}>
          <div className="bg-surface-base panel-beveled w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-rmpg-700">
              <h3 className="text-xs font-bold uppercase tracking-wider text-rmpg-200">
                {editing ? 'Edit Notification Rule' : 'New Notification Rule'}
              </h3>
              <button type="button" onClick={() => setShowForm(false)} className="p-0.5 text-rmpg-400 hover:text-white hover:bg-rmpg-700 transition-colors rounded-sm" aria-label="Close dialog"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-1 block">Rule Name *</label>
                <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="input-dark w-full text-xs min-h-[36px]" placeholder="e.g. Alert supervisors on P1 calls" />
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-1 block">Description</label>
                <input type="text" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="input-dark w-full text-xs min-h-[36px]" placeholder="Optional description..." />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-1 block">Trigger Event *</label>
                  <select value={form.trigger_event} onChange={(e) => setForm((f) => ({ ...f, trigger_event: e.target.value }))} className="select-dark w-full text-xs">
                    {TRIGGER_EVENTS.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                  <p className="text-[9px] text-rmpg-500 mt-0.5">{TRIGGER_EVENTS.find((t) => t.value === form.trigger_event)?.desc}</p>
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-1 block">Delivery Method</label>
                  <select value={form.notification_type} onChange={(e) => setForm((f) => ({ ...f, notification_type: e.target.value as any }))} className="select-dark w-full text-xs">
                    <option value="in_app">In-App Only</option>
                    <option value="email">Email Only</option>
                    <option value="both">In-App + Email</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-1 block">
                  Target Roles <span className="text-rmpg-500 font-normal">(who receives this alert)</span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {ROLES.map((role) => (
                    <button type="button"
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
              <button type="button" onClick={() => setShowForm(false)} className="toolbar-btn text-[10px]">Cancel</button>
              <button type="button" onClick={handleSubmit} disabled={submitting} className="toolbar-btn-primary text-[10px] flex items-center gap-1">
                {submitting && <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" />}
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
        title="Delete Notification Rule"
        message="Are you sure you want to delete this notification rule?"
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={deleteLoading}
      />
    </div>
  );
}
