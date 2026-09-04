// Investigative case tasks UI (v2 Phase 2). Two surfaces:
//   <CaseTasksTab>     — per-case task list + add/edit/complete (detail view)
//   <CaseMyTasksView>  — cross-case "assigned to me", with case links
// Both talk to /api/cases/:id/tasks and /api/cases/tasks/mine.
import { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2, Trash2, Check, RotateCcw, Clock, ExternalLink, ListChecks } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import PanelTitleBar from './PanelTitleBar';
import IconButton from './IconButton';
import { useToast } from './ToastProvider';
import { withAlpha } from '../utils/withAlpha';

export interface CaseTask {
  id: number;
  case_id: number;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  assignee_id?: number | null;
  assignee_name?: string | null;
  due_date?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
  // present only on /tasks/mine rows
  case_number?: string;
  case_title?: string;
  case_status?: string;
}

interface UserLite { id: number; full_name: string }

const PRIORITY_COLOR: Record<string, string> = {
  urgent: 'var(--sev-critical)', high: 'var(--sev-warn)', normal: 'var(--text-secondary)', low: 'var(--text-muted)',
};
const STATUS_LABEL: Record<string, string> = {
  open: 'Open', in_progress: 'In Progress', done: 'Done', canceled: 'Canceled',
};
const STATUS_COLOR: Record<string, string> = {
  open: 'var(--text-secondary)', in_progress: 'var(--sev-warn)', done: 'var(--sev-ok)', canceled: 'var(--text-muted)',
};

/** Pure: a task is overdue with a past due date and still actionable. */
export function isTaskOverdue(dueDate?: string | null, status?: string): boolean {
  if (!dueDate || status === 'done' || status === 'canceled') return false;
  const due = new Date(`${String(dueDate).slice(0, 10)}T23:59:59`);
  if (isNaN(due.getTime())) return false;
  return due.getTime() < Date.now();
}

function StatusPill({ status }: { status: string }) {
  const color = STATUS_COLOR[status] || 'var(--text-secondary)';
  return (
    <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 border" style={{ color, borderColor: withAlpha(color, '66') }}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}

// ── Per-case Tasks tab ──────────────────────────────────────
export function CaseTasksTab({ caseId, users, onChanged }: { caseId: number; users: UserLite[]; onChanged?: () => void }) {
  const [tasks, setTasks] = useState<CaseTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', priority: 'normal', assignee_id: '', due_date: '' });
  const { addToast } = useToast();

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<{ data: CaseTask[] }>(`/cases/${caseId}/tasks`)
      .then((r) => setTasks(Array.isArray(r) ? r : (r?.data || [])))
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }, [caseId]);
  useEffect(load, [load]);
  useLiveSync('records', load);

  const refresh = () => { load(); onChanged?.(); };

  const create = async () => {
    if (!form.title.trim()) { addToast('Task title is required', 'error'); return; }
    setBusy(true);
    try {
      await apiFetch(`/cases/${caseId}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          priority: form.priority,
          assignee_id: form.assignee_id ? Number(form.assignee_id) : undefined,
          due_date: form.due_date || undefined,
        }),
      });
      setForm({ title: '', description: '', priority: 'normal', assignee_id: '', due_date: '' });
      setShowForm(false);
      refresh();
      addToast('Task added', 'success');
    } catch (e) { addToast(e instanceof Error ? e.message : 'Failed to add task', 'error'); }
    finally { setBusy(false); }
  };

  const setStatus = async (t: CaseTask, status: string) => {
    try { await apiFetch(`/cases/${caseId}/tasks/${t.id}`, { method: 'PUT', body: JSON.stringify({ status }) }); refresh(); }
    catch (e) { addToast(e instanceof Error ? e.message : 'Update failed', 'error'); }
  };
  const remove = async (t: CaseTask) => {
    try { await apiFetch(`/cases/${caseId}/tasks/${t.id}`, { method: 'DELETE' }); refresh(); addToast('Task removed', 'success'); }
    catch (e) { addToast(e instanceof Error ? e.message : 'Delete failed', 'error'); }
  };
  const applyTemplate = async () => {
    try {
      const r = await apiFetch<{ added: number }>(`/cases/${caseId}/tasks/apply-template`, { method: 'POST' });
      addToast(r?.added ? `${r.added} standard task${r.added === 1 ? '' : 's'} added` : 'Standard tasks already present', 'success');
      refresh();
    } catch (e) { addToast(e instanceof Error ? e.message : 'Failed to apply template', 'error'); }
  };

  const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'canceled');
  const closed = tasks.filter((t) => t.status === 'done' || t.status === 'canceled');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-mono text-fg-secondary uppercase">Tasks &amp; Leads ({open.length} open)</div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={applyTemplate} className="toolbar-btn text-[10px]" title="Add this case type's standard investigative tasks">
            <ListChecks style={{ width: 10, height: 10 }} /> Template
          </button>
          <button type="button" onClick={() => setShowForm((s) => !s)} className="toolbar-btn text-[10px]">
            <Plus style={{ width: 10, height: 10 }} /> Add task
          </button>
        </div>
      </div>

      {showForm && (
        <div className="panel-beveled p-3 space-y-2">
          <input
            value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
            placeholder="Task title (e.g. Canvass for witnesses)" aria-label="Task title"
            className="w-full px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none"
          />
          <textarea
            value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            placeholder="Details (optional)" aria-label="Task details" rows={2}
            className="w-full px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 outline-none"
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <select value={form.priority} onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))} aria-label="Priority"
              className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-1 py-1.5 outline-none">
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
            <select value={form.assignee_id} onChange={(e) => setForm((p) => ({ ...p, assignee_id: e.target.value }))} aria-label="Assignee"
              className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-1 py-1.5 outline-none">
              <option value="">Unassigned</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
            <input type="date" value={form.due_date} onChange={(e) => setForm((p) => ({ ...p, due_date: e.target.value }))} aria-label="Due date"
              className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-1 py-1.5 outline-none" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="toolbar-btn text-[10px]">Cancel</button>
            <button type="button" onClick={create} disabled={busy} className="toolbar-btn toolbar-btn-primary text-[10px]">
              {busy ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Saving" /> : <Plus style={{ width: 10, height: 10 }} />} Add
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-[10px] text-fg-muted p-3"><Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> Loading tasks...</div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-6 text-fg-muted text-xs">No tasks for this case yet</div>
      ) : (
        <div className="space-y-1.5">
          {[...open, ...closed].map((t) => {
            const overdue = isTaskOverdue(t.due_date, t.status);
            const dimmed = t.status === 'done' || t.status === 'canceled';
            return (
              <div key={t.id} className={`panel-beveled p-2 flex items-start gap-2 ${dimmed ? 'opacity-60' : ''}`}>
                <span className="mt-0.5 inline-block w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: PRIORITY_COLOR[t.priority] || '#888' }} title={`${t.priority} priority`} />
                <div className="flex-1 min-w-0">
                  <div className={`text-[11px] font-bold ${dimmed ? 'line-through text-rmpg-400' : 'text-rmpg-100'}`}>{t.title}</div>
                  {t.description && <div className="text-[9px] text-rmpg-400 mt-0.5">{t.description}</div>}
                  <div className="flex items-center gap-2 mt-1 flex-wrap text-[9px] text-fg-muted">
                    <StatusPill status={t.status} />
                    {t.assignee_name && <span>{t.assignee_name}</span>}
                    {t.due_date && (
                      <span className={`flex items-center gap-0.5 ${overdue ? 'text-red-400 font-bold' : ''}`}>
                        <Clock style={{ width: 9, height: 9 }} /> {t.due_date}{overdue ? ' • OVERDUE' : ''}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <select value={t.status} onChange={(e) => setStatus(t, e.target.value)} aria-label={`Status for ${t.title}`}
                    className="text-[9px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-1 py-0.5 outline-none">
                    <option value="open">Open</option>
                    <option value="in_progress">In Progress</option>
                    <option value="done">Done</option>
                    <option value="canceled">Canceled</option>
                  </select>
                  {t.status !== 'done' ? (
                    <IconButton onClick={() => setStatus(t, 'done')} className="text-green-400 hover:text-green-300" aria-label="Mark done"><Check style={{ width: 12, height: 12 }} /></IconButton>
                  ) : (
                    <IconButton onClick={() => setStatus(t, 'open')} className="text-rmpg-400 hover:text-rmpg-100" aria-label="Reopen"><RotateCcw style={{ width: 12, height: 12 }} /></IconButton>
                  )}
                  <IconButton onClick={() => remove(t)} className="text-red-400 hover:text-red-300" aria-label="Delete task"><Trash2 style={{ width: 12, height: 12 }} /></IconButton>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Cross-case "My Tasks" view ──────────────────────────────
export function CaseMyTasksView({ onOpenCase }: { onOpenCase: (caseId: number) => void }) {
  const [tasks, setTasks] = useState<CaseTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'active' | 'overdue' | 'done'>('active');
  const { addToast } = useToast();

  const load = useCallback(() => {
    setLoading(true);
    const qs = filter === 'overdue' ? '?overdue=true' : filter === 'done' ? '?status=done' : '';
    apiFetch<{ data: CaseTask[] }>(`/cases/tasks/mine${qs}`)
      .then((r) => setTasks(Array.isArray(r) ? r : (r?.data || [])))
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }, [filter]);
  useEffect(load, [load]);
  useLiveSync('records', load);

  const complete = async (t: CaseTask) => {
    try { await apiFetch(`/cases/${t.case_id}/tasks/${t.id}`, { method: 'PUT', body: JSON.stringify({ status: 'done' }) }); load(); }
    catch (e) { addToast(e instanceof Error ? e.message : 'Update failed', 'error'); }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-surface-base">
      <PanelTitleBar title="My Tasks" icon={Clock}>
        <span className="text-[9px] font-mono text-fg-muted">{tasks.length}</span>
      </PanelTitleBar>
      <div className="flex gap-1 p-1.5 border-b border-rmpg-700 bg-surface-sunken">
        {(['active', 'overdue', 'done'] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={`px-3 py-1 text-[10px] font-mono uppercase border ${filter === f ? 'bg-brand-900/40 border-brand-600/50 text-brand-300' : 'border-transparent text-fg-muted hover:text-rmpg-300'}`}>
            {f === 'active' ? 'Active' : f === 'overdue' ? 'Overdue' : 'Completed'}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-700 scrollbar-track-transparent p-3 space-y-1.5">
        {loading ? (
          <div className="flex items-center gap-2 text-[10px] text-fg-muted p-3"><Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> Loading tasks...</div>
        ) : tasks.length === 0 ? (
          <div className="text-center py-10 text-fg-muted text-xs">No {filter} tasks assigned to you</div>
        ) : (
          tasks.map((t) => {
            const overdue = isTaskOverdue(t.due_date, t.status);
            return (
              <div key={t.id} className="panel-beveled p-2 flex items-start gap-2">
                <span className="mt-0.5 inline-block w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: PRIORITY_COLOR[t.priority] || '#888' }} title={`${t.priority} priority`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-bold text-rmpg-100">{t.title}</div>
                  <button type="button" onClick={() => onOpenCase(t.case_id)} className="text-[9px] text-brand-400 hover:text-brand-300 flex items-center gap-0.5 mt-0.5">
                    <ExternalLink style={{ width: 9, height: 9 }} /> {t.case_number || `Case #${t.case_id}`}{t.case_title ? ` — ${t.case_title}` : ''}
                  </button>
                  <div className="flex items-center gap-2 mt-1 flex-wrap text-[9px] text-fg-muted">
                    <StatusPill status={t.status} />
                    {t.due_date && (
                      <span className={`flex items-center gap-0.5 ${overdue ? 'text-red-400 font-bold' : ''}`}>
                        <Clock style={{ width: 9, height: 9 }} /> {t.due_date}{overdue ? ' • OVERDUE' : ''}
                      </span>
                    )}
                  </div>
                </div>
                {t.status !== 'done' && (
                  <IconButton onClick={() => complete(t)} className="text-green-400 hover:text-green-300 flex-shrink-0" aria-label="Mark done"><Check style={{ width: 12, height: 12 }} /></IconButton>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
