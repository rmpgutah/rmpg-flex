// ═══════════════════════════════════════════════════════════════
// Tasks page — Spillman Flex Task Management surface.
// ───────────────────────────────────────────────────────────────
// Page 47 of the full-app frontend audit. The pre-audit page was a
// 127-line minimum-viable view: list + new/edit/delete + three
// stats cards. The backend exposed filtering (status / priority /
// assignee / linked-entity / overdue) plus an assigner column +
// `completed_at` timestamp, none of which the UI surfaced.
//
// What this version adds (vs the prior file):
//   • URL deep-link contract — `?task_id=` highlights + opens the
//     row in its edit modal, `?status=`, `?priority=`, `?assignee=`,
//     `?entity_type=`, `?overdue=true` hydrate the filter bar. All
//     consumed params are stripped after first paint so a refresh
//     doesn't re-pin the operator to a stale link. `task_id` is
//     mirrored back via the row's "Copy deep-link" context-menu
//     action so a supervisor can paste a task link straight to a
//     squad in chat.
//   • Filter bar — status / priority / overdue-only toggle + an
//     OfficerPicker for assignee, mirroring the backend `?…=`
//     params that already shipped.
//   • Court-style PDF export — new client/src/utils/taskPdf.ts
//     (gold banner, filter snapshot, paginated landscape rows
//     with overdue accent + zebra striping, signature block for
//     exporting + reviewing supervisor). Same visual contract as
//     auditLogPdf / bodycam / FI / evidence PDFs.
//   • Linked-entity navigation — reuses `getAuditEntityRoute`
//     (same util the Audit Log uses) so a task linked to
//     warrant 47 / case 12 / incident 8 surfaces an
//     ExternalLink glyph in the Linked column and a click opens
//     that page via the established `?<entity>_id=` contract.
//     Non-routable types still render but as plain text.
//   • Due-date countdown — new pure util taskDueCountdown.ts
//     (`describeDueDate` → `OVERDUE 3d` / `Due today` / `Due
//     tomorrow` / `Due in 5d` / `Due 2026-07-15`) colour-coded
//     red / amber / brand / muted so a supervisor can scan a
//     squad's workload at a glance instead of reading dates.
//   • Empty-state distinction — branches on `hasActiveFilters`:
//     "No tasks yet" (truly empty queue) vs "No tasks match the
//     active filters" with a one-click "Clear all filters" button.
//   • Esc smart-cascade — close-newest-open-first: confirm dialog →
//     form modal → row highlight → error banner → active filter
//     set. Skips while typing in an input/textarea/select.
//   • `N` shortcut for new task (skip while modal open or typing).
//   • `ConfirmDialog` for deletion — replaces the bespoke inline
//     overlay so the destructive flow matches the rest of the app
//     (pre-focused Cancel button, no global Enter binding, body
//     scroll lock, etc.).
//   • Row context-menu — assignee summary, deep-link copy,
//     quick "Mark complete" / "Reopen" toggles (PUT /tasks/:id),
//     and the existing Copy / Delete actions.
//   • Inline supervisor metadata — assigner ("by Sgt. X") rendered
//     under the assignee so chain-of-assignment is visible without
//     opening the edit modal.
//   • Audit-visible failure — the prior page silently swallowed
//     fetch errors with an empty `catch { /* */ }`. The new version
//     surfaces a dismissable error banner so an operator can see
//     when /tasks is degraded instead of staring at an empty list.
//   • Icon-only buttons use `<IconButton>` so the required
//     `aria-label` prop catches missing labels at the type level
//     instead of waiting for a screen-reader audit to find them.
//
// Out of scope for this PR (deferred):
//   • Per-user "my tasks" cache key — the form draft hook is
//     globally scoped throughout the app; reworking just Tasks
//     would diverge from the system-wide pattern. The /cases page
//     already exposes `/cases/tasks/mine` which is the canonical
//     "tasks assigned to me" surface; a future merge could collapse
//     the two task tables (`task_assignments` and `case_tasks`)
//     into a unified queue, but that's its own program.
//   • Inline task-comments thread — backend POST /tasks/:id/comments
//     exists; surfacing it inside the edit modal needs design work
//     to fit the comment thread + form fields without ballooning
//     the modal. Tracked separately.
// ═══════════════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import IconButton from '../components/IconButton';
import ConfirmDialog from '../components/ConfirmDialog';
import TaskFormModal, { TaskFormData } from '../components/TaskFormModal';
import OfficerPicker from '../components/OfficerPicker';
import { useToast } from '../components/ToastProvider';
import { useMenuActions } from '../utils/contextMenuActions';
import { getAuditEntityRoute } from '../utils/auditEntityRoute';
import { describeDueDate, dueToneTextClass } from '../utils/taskDueCountdown';
import { generateTasksPdf } from '../utils/taskPdf';
import { toDisplayLabel } from '../utils/formatters';
import { safeDateStr } from '../utils/dateUtils';
import { tasksToCsv, downloadTextFile } from '../utils/rmsListExport';
import {
  ClipboardList, Clock, AlertTriangle, Plus, Pencil, Trash2, Eye,
  FileText, X, CheckCircle2, RotateCcw, ExternalLink,
} from 'lucide-react';

interface Task {
  id: number;
  task_title: string;
  description?: string | null;
  priority: string;
  status: string;
  assigned_to?: number | null;
  assigned_to_name?: string | null;
  assigned_by?: number | null;
  assigned_by_name?: string | null;
  due_date?: string | null;
  linked_entity_type?: string | null;
  linked_entity_id?: number | string | null;
  notes?: string | null;
  completed_at?: string | null;
  created_at: string;
}

interface TaskFilters {
  status: string;
  priority: string;
  assigned_to: string;
  entity_type: string;
  overdue: boolean;
}

const EMPTY_FILTERS: TaskFilters = {
  status: '', priority: '', assigned_to: '', entity_type: '', overdue: false,
};

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export default function TasksPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const m = useMenuActions();
  const { user } = useAuth();

  // Backend role gates:
  //   DELETE — admin | manager only
  //   PUT    — admin | manager | supervisor | officer
  //   POST   — admin | manager | supervisor | officer
  // Mirror these client-side so a dispatcher/viewer doesn't see actions
  // that will 403 on the server.
  const canDelete = user?.role === 'admin' || user?.role === 'manager';
  const canCreate = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'supervisor';
  const canAssign = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'supervisor';

  // ── State ──────────────────────────────────────────────────────
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ total: 0, pending: 0, overdue: 0 });
  const [filters, setFilters] = useState<TaskFilters>(() => ({
    status:      searchParams.get('status') || '',
    priority:    searchParams.get('priority') || '',
    assigned_to: searchParams.get('assignee') || searchParams.get('assigned_to') || '',
    entity_type: searchParams.get('entity_type') || '',
    overdue:     searchParams.get('overdue') === 'true' || searchParams.get('overdue') === '1',
  }));
  const [assigneeName, setAssigneeName] = useState<string>('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Task | undefined>(undefined);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());

  // Capture the ?task_id= on the first render so subsequent setSearchParams
  // calls (filter changes) don't lose the deep-link before the open-row
  // effect runs.
  const pendingTaskIdRef = useRef<string | null>(searchParams.get('task_id'));

  // ── Build the GET /tasks querystring from the active filters. The
  // backend accepts these as repeated `?status=…&priority=…` params.
  const apiQuery = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.status)      p.set('status', filters.status);
    if (filters.priority)    p.set('priority', filters.priority);
    if (filters.assigned_to) p.set('assigned_to', filters.assigned_to);
    if (filters.entity_type) p.set('entity_type', filters.entity_type);
    if (filters.overdue)     p.set('overdue', 'true');
    // Pull a wide page so the in-page filter UI doesn't need to wire
    // pagination too — `per_page` is capped at 200 server-side.
    p.set('per_page', '200');
    return p.toString();
  }, [filters]);

  const hasActiveFilters = useMemo(
    () => filters.status !== '' || filters.priority !== '' || filters.assigned_to !== ''
       || filters.entity_type !== '' || filters.overdue,
    [filters],
  );

  // ── Data fetch ────────────────────────────────────────────────
  const fetchData = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    try {
      const r = await apiFetch<{ data: Task[] }>(`/tasks?${apiQuery}`);
      setTasks(r.data || []);
      // Stats are global (not filter-scoped) — same shape the backend
      // returns regardless of the row filters above, so we don't pass
      // the querystring here.
      const s = await apiFetch<{ total: number; pending: number; overdue: number }>('/tasks/stats');
      setStats(s);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load tasks';
      setError(msg);
    } finally {
      if (silent) setRefreshing(false);
    }
  }, [apiQuery]);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  // ── Handlers ───────────────────────────────────────────────────
  const openNew = useCallback(() => {
    setEditingRecord(undefined); setFormError(null); setFormOpen(true);
  }, []);
  const openEdit = useCallback((rec: Task) => {
    setEditingRecord(rec); setFormError(null); setFormOpen(true);
  }, []);

  // ── URL deep-link: /tasks?task_id=<n> auto-opens the row in edit mode.
  // One-shot per page load; the param is stripped after applying. Falls
  // back to a direct GET when the target is outside the current list
  // (e.g. filtered out by status / assignee). Mirrors the FlexCam +
  // AuditLog patterns established earlier in the audit sweep.
  useEffect(() => {
    const target = pendingTaskIdRef.current;
    if (!target || loading) return;
    pendingTaskIdRef.current = null;
    const numericId = Number(target);
    if (!Number.isFinite(numericId) || numericId <= 0) return;
    let cancelled = false;
    (async () => {
      try {
        let hit = tasks.find((t) => t.id === numericId);
        if (!hit) {
          // Not in the current list — fetch directly so the operator
          // can act on a deep-link from any filter state.
          try {
            const r = await apiFetch<{ data: Task }>(`/tasks/${numericId}`);
            hit = r.data;
          } catch {
            if (!cancelled) addToast(`Task #${numericId} not found`, 'error');
            return;
          }
        }
        if (cancelled || !hit) return;
        setHighlightId(numericId);
        openEdit(hit);
        // Wait one tick for the row to render, then scroll into view.
        requestAnimationFrame(() => {
          const el = rowRefs.current.get(numericId);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        // Decay the highlight after 4s.
        setTimeout(() => setHighlightId((h) => (h === numericId ? null : h)), 4000);
      } finally {
        if (!cancelled) {
          const next = new URLSearchParams(searchParams);
          next.delete('task_id');
          setSearchParams(next, { replace: true });
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, loading]);

  // ── Strip filter params from the URL after the initial paint so the
  // querystring stays clean when the operator changes filters in-page.
  // We deliberately keep the *current* filters in component state — the
  // URL was just the hand-off mechanism. Skipped if there's no consumed
  // param so we don't fire a no-op replaceState on every render.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    let mutated = false;
    for (const k of ['status', 'priority', 'assignee', 'assigned_to', 'entity_type', 'overdue']) {
      if (next.has(k)) { next.delete(k); mutated = true; }
    }
    if (mutated) setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Esc smart-cascade — close-newest-open-first ────────────────
  useEffect(() => {
    const isTypingInField = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isTypingInField(e.target)) return;
      // 1) Confirm-delete dialog (ConfirmDialog handles its own Esc too,
      //    but this branch documents the cascade ordering and catches
      //    Esc bubbling that originated outside the dialog).
      if (deleteId !== null) { e.stopPropagation(); setDeleteId(null); return; }
      // 2) Open form modal — FormModal already wires Esc internally,
      //    but a stray Esc on the page chrome should still close it.
      if (formOpen) { e.stopPropagation(); setFormOpen(false); setEditingRecord(undefined); return; }
      // 3) Active deep-link highlight
      if (highlightId !== null) { e.stopPropagation(); setHighlightId(null); return; }
      // 4) Inline error banner
      if (error) { e.stopPropagation(); setError(null); return; }
      // 5) Active filter set
      if (hasActiveFilters) { e.stopPropagation(); setFilters(EMPTY_FILTERS); setAssigneeName(''); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteId, formOpen, highlightId, error, hasActiveFilters]);

  // ── `N` shortcut to open a new task. Skips while a modal is open or
  // a typing surface is focused. Gated by canCreate (admin|manager|supervisor).
  // Matches the muscle memory established by GeographyPage / ServePage / DARs etc.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!canCreate) return;
      if (formOpen || deleteId !== null) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        openNew();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canCreate, formOpen, deleteId, openNew]);

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
      setFormOpen(false); setEditingRecord(undefined);
      await fetchData(true);
      addToast(editingRecord ? 'Task updated' : 'Task created', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed';
      setFormError(msg); addToast(msg, 'error');
    } finally { setFormSubmitting(false); }
  };

  const handleDelete = async () => {
    if (deleteId === null) return;
    setDeleteBusy(true);
    try {
      await apiFetch(`/tasks/${deleteId}`, { method: 'DELETE' });
      setDeleteId(null);
      await fetchData(true);
      addToast('Task deleted', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally {
      setDeleteBusy(false);
    }
  };

  // Quick status toggle from the row context menu. Hits the same PUT
  // endpoint the edit modal uses so all the audit-trail and timestamp
  // bookkeeping the backend does (auto-stamping completed_at) still runs.
  const quickStatus = async (task: Task, status: string) => {
    try {
      await apiFetch(`/tasks/${task.id}`, { method: 'PUT', body: JSON.stringify({ status }) });
      await fetchData(true);
      addToast(`Task #${task.id} → ${toDisplayLabel(status)}`, 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Update failed', 'error');
    }
  };

  // Linked-entity navigation reuses the audit util — same contract the
  // rest of the app already speaks (`?warrant_id=`, `?case_id=`, etc).
  const openLinkedEntity = (task: Task) => {
    const route = getAuditEntityRoute(task.linked_entity_type, task.linked_entity_id);
    if (route) navigate(route.path);
  };

  const exportPdf = () => {
    try {
      const doc = generateTasksPdf({
        tasks,
        filters: {
          status: filters.status || undefined,
          priority: filters.priority || undefined,
          assignedTo: filters.assigned_to || undefined,
          assignedToName: assigneeName || undefined,
          entityType: filters.entity_type || undefined,
          overdue: filters.overdue || undefined,
        },
        totalMatching: tasks.length,
      });
      const stamp = new Date().toISOString().slice(0, 10);
      const slug = [
        filters.status, filters.priority, filters.overdue ? 'overdue' : '',
      ].filter(Boolean).join('-') || 'all';
      doc.save(`tasks_${slug}_${stamp}.pdf`);
      addToast('Task PDF exported', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'PDF export failed', 'error');
    }
  };

  // Sort client-side too so the row order matches what the operator
  // would expect after a fresh load (priority weight then due date
  // ascending then id desc — mirrors the backend ORDER BY).
  const sortedTasks = useMemo(() => {
    const out = [...tasks];
    out.sort((a, b) => {
      const pa = PRIORITY_RANK[a.priority] ?? 9;
      const pb = PRIORITY_RANK[b.priority] ?? 9;
      if (pa !== pb) return pa - pb;
      const da = a.due_date || '9999-99-99';
      const db = b.due_date || '9999-99-99';
      if (da !== db) return da < db ? -1 : 1;
      return b.id - a.id;
    });
    return out;
  }, [tasks]);

  // ── Columns ────────────────────────────────────────────────────
  const columns = useMemo(() => [
    { key: 'id', label: 'ID', width: '60px', render: (row: Task) => (
      <span className="text-rmpg-400 font-mono">#{row.id}</span>
    )},
    { key: 'task_title', label: 'Task', render: (row: Task) => {
      const isHighlighted = highlightId === row.id;
      return (
        <div
          // Brand-gold left rail when this is the deep-linked row.
          // Padding stays consistent so the rail doesn't shift the
          // text horizontally when it appears/disappears.
          style={isHighlighted ? { borderLeft: '3px solid var(--brand-gold)', paddingLeft: 6 } : undefined}
        >
          <div className="text-rmpg-100">{row.task_title}</div>
          {row.description && (
            <div className="text-[10px] text-rmpg-500 line-clamp-1" title={row.description}>
              {row.description}
            </div>
          )}
        </div>
      );
    }},
    { key: 'priority', label: 'Priority', width: '90px', render: (row: Task) => {
      const tone = row.priority === 'urgent' ? 'text-red-400'
                 : row.priority === 'high'   ? 'text-amber-300'
                 : row.priority === 'low'    ? 'text-rmpg-500'
                 : 'text-rmpg-300';
      return <span className={`uppercase text-[10px] font-semibold ${tone}`}>{row.priority || '—'}</span>;
    }},
    { key: 'status', label: 'Status', width: '110px', render: (row: Task) => {
      const tone = row.status === 'completed' ? 'text-green-400'
                 : row.status === 'cancelled' ? 'text-rmpg-500'
                 : row.status === 'in_progress' ? 'text-brand-400'
                 : row.status === 'review' ? 'text-amber-300'
                 : 'text-rmpg-200';
      return <span className={`text-[10px] ${tone}`}>{row.status ? toDisplayLabel(row.status) : '—'}</span>;
    }},
    { key: 'assigned_to_name', label: 'Assignee', width: '160px', render: (row: Task) => (
      <div>
        <div className="text-rmpg-200">{row.assigned_to_name || <span className="text-rmpg-500 italic">Unassigned</span>}</div>
        {row.assigned_by_name && (
          <div className="text-[10px] text-rmpg-500" title="Assigned by">by {row.assigned_by_name}</div>
        )}
      </div>
    )},
    { key: 'due_date', label: 'Due', width: '130px', render: (row: Task) => {
      // Completed/cancelled tasks bypass the countdown — once a task
      // is closed the "overdue" framing is misleading. Surface the
      // completion timestamp instead so a supervisor can see when the
      // work actually landed.
      if (row.status === 'completed' || row.status === 'cancelled') {
        return (
          <span className="text-[10px] text-rmpg-500">
            {row.completed_at ? `Closed ${safeDateStr(row.completed_at, "")}` : '—'}
          </span>
        );
      }
      const due = describeDueDate(row.due_date);
      return <span className={`text-[10px] font-semibold ${dueToneTextClass(due.tone)}`}>{due.label}</span>;
    }},
    { key: 'linked', label: 'Linked', width: '140px', render: (row: Task) => {
      if (!row.linked_entity_type) return <span className="text-rmpg-600">—</span>;
      const route = getAuditEntityRoute(row.linked_entity_type, row.linked_entity_id);
      const label = `${row.linked_entity_type}${row.linked_entity_id != null ? ` #${row.linked_entity_id}` : ''}`;
      if (!route) return <span className="text-rmpg-400 text-[10px]">{label}</span>;
      return (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); openLinkedEntity(row); }}
          className="text-[10px] text-brand-400 hover:text-brand-300 inline-flex items-center gap-1"
          title={route.label}
        >
          {label}
          <ExternalLink size={10} />
        </button>
      );
    }},
    { key: 'actions', label: '', width: '90px', render: (row: Task) => (
      <div className="flex gap-2">
        <IconButton
          aria-label={`Edit task ${row.id}`}
          onClick={(e) => { e.stopPropagation(); openEdit(row); }}
          className="text-rmpg-400 hover:text-rmpg-100"
        >
          <Pencil size={12} />
        </IconButton>
        {canDelete && (
          <IconButton
            aria-label={`Delete task ${row.id}`}
            onClick={(e) => { e.stopPropagation(); setDeleteId(row.id); }}
            className="text-red-500 hover:text-red-300"
          >
            <Trash2 size={12} />
          </IconButton>
        )}
      </div>
    )},
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [highlightId, openEdit, canDelete]);

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="TASK MANAGEMENT" icon={ClipboardList}>
        <button
          type="button"
          className="toolbar-btn"
          disabled={tasks.length === 0}
          onClick={() => downloadTextFile('tasks.csv', tasksToCsv(tasks.map((t) => ({
            id: t.id,
            task_title: t.task_title,
            status: t.status,
            priority: t.priority,
            due_date: t.due_date,
            linked_entity_type: t.linked_entity_type,
            linked_entity_id: t.linked_entity_id,
          }))))}
        >CSV</button>
        <button
          type="button"
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="toolbar-btn"
          title="Reload tasks"
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={exportPdf}
          disabled={tasks.length === 0}
          className="toolbar-btn toolbar-btn-primary"
          title="Supervisor task-list PDF (filter snapshot, signature block)"
        >
          <FileText size={13} /> Task PDF
        </button>
        {canCreate && (
          <button
            type="button"
            onClick={openNew}
            className="toolbar-btn flex items-center gap-1.5"
            style={{ height: 28, padding: '0 10px' }}
            title="New task (shortcut: N)"
          >
            <Plus size={13} /> New Task
          </button>
        )}
      </PanelTitleBar>

      {/* Error banner — replaces the prior silent catch{}. Dismissable
          via Esc (smart-cascade) or the X. */}
      {error && (
        <div
          className="flex items-start gap-2 px-3 py-2 border border-red-700/60 bg-red-900/30 text-red-300 text-xs"
          role="alert"
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div className="flex-1">{error}</div>
          <button type="button" className="toolbar-btn" onClick={() => { void fetchData(); }}>Retry</button>
          <IconButton aria-label="Dismiss error" onClick={() => setError(null)} className="text-red-300 hover:text-red-100">
            <X size={12} />
          </IconButton>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <StatsCard icon={ClipboardList} label="Total Tasks" value={stats.total} />
        <StatsCard icon={Clock} label="Pending" value={stats.pending} />
        <StatsCard icon={AlertTriangle} label="Overdue" value={stats.overdue} />
      </div>

      {/* Filter bar — mirrors the GET /tasks query params (status /
          priority / assigned_to / entity_type / overdue). Officer picker
          stays inline so the operator can type a name without leaving
          the page. */}
      <div className="flex flex-wrap gap-2 items-end p-2 border border-rmpg-700/60 bg-surface-raised">
        <div>
          <label className="text-[10px] text-rmpg-400 uppercase block">Status</label>
          <select
            className="select-dark"
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
          >
            <option value="">All</option>
            {['pending', 'in_progress', 'review', 'completed', 'cancelled'].map((s) => (
              <option key={s} value={s}>{toDisplayLabel(s)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-rmpg-400 uppercase block">Priority</label>
          <select
            className="select-dark"
            value={filters.priority}
            onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))}
          >
            <option value="">All</option>
            {['urgent', 'high', 'normal', 'low'].map((p) => (
              <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
            ))}
          </select>
        </div>
        <div className="min-w-[220px]">
          <label className="text-[10px] text-rmpg-400 uppercase block">Assignee</label>
          <OfficerPicker
            value={filters.assigned_to ? Number(filters.assigned_to) : null}
            displayValue={assigneeName}
            onChange={(id, officer) => {
              setFilters((f) => ({ ...f, assigned_to: id ? String(id) : '' }));
              setAssigneeName(officer?.full_name || '');
            }}
            placeholder="Filter by officer…"
          />
        </div>
        <div>
          <label className="text-[10px] text-rmpg-400 uppercase block">Linked Type</label>
          <select
            className="select-dark"
            value={filters.entity_type}
            onChange={(e) => setFilters((f) => ({ ...f, entity_type: e.target.value }))}
          >
            <option value="">Any</option>
            {['call', 'incident', 'case', 'person', 'warrant', 'citation'].map((t) => (
              <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-rmpg-200 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.overdue}
            onChange={(e) => setFilters((f) => ({ ...f, overdue: e.target.checked }))}
          />
          Overdue only
        </label>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => { setFilters(EMPTY_FILTERS); setAssigneeName(''); }}
            className="toolbar-btn flex items-center gap-1"
            title="Clear all filters (Esc)"
          >
            <X size={11} /> Clear
          </button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={sortedTasks}
        loading={loading}
        ariaLabel="Tasks"
        // The DataTable renders its own empty-state, but we want
        // distinct copy depending on whether the operator filtered to
        // an empty slice vs the queue actually being empty.
        emptyMessage={hasActiveFilters ? 'No tasks match the active filters' : 'No tasks yet'}
        emptyDescription={hasActiveFilters
          ? 'Try widening the status / priority / assignee filter or toggling overdue-only.'
          : canCreate ? 'Press N or click New Task above to create the first one.' : 'No tasks have been created yet.'}
        emptyIcon={ClipboardList}
        onRowClick={(row) => openEdit(row)}
        rowContextMenu={(row) => {
          const route = getAuditEntityRoute(row.linked_entity_type, row.linked_entity_id);
          const selfLink = `${window.location.origin}/tasks?task_id=${row.id}`;
          const isClosed = row.status === 'completed' || row.status === 'cancelled';
          return [
            m.action('Open / edit', () => openEdit(row), { icon: <Eye size={12} /> }),
            ...(route ? [m.go(route.label, route.path, <ExternalLink size={12} />)] : []),
            m.separator(),
            ...(isClosed
              ? [m.action('Reopen task', () => quickStatus(row, 'pending'), { icon: <RotateCcw size={12} /> })]
              : [m.action('Mark complete', () => quickStatus(row, 'completed'), { icon: <CheckCircle2 size={12} /> })]
            ),
            m.separator(),
            m.copy('Copy task title', row.task_title),
            m.copy('Copy deep-link', selfLink),
            m.copyId(row.id),
            ...(canDelete ? [
              m.separator(),
              m.action('Delete', () => setDeleteId(row.id), { danger: true, icon: <Trash2 size={12} /> }),
            ] : []),
          ];
        }}
      />

      <TaskFormModal
        isOpen={formOpen}
        onClose={() => { setFormOpen(false); setEditingRecord(undefined); }}
        onSubmit={handleSubmit}
        isSubmitting={formSubmitting}
        editingRecord={editingRecord}
        submitError={formError}
        canEscalatePriority={canAssign}
      />

      <ConfirmDialog
        isOpen={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Task"
        message="This permanently removes the task and all comments."
        details={(() => {
          const t = tasks.find((x) => x.id === deleteId);
          if (!t) return null;
          return (
            <>
              <div>#{t.id} — {t.task_title}</div>
              {t.assigned_to_name && <div>Assigned to {t.assigned_to_name}</div>}
              {t.due_date && <div>Due {t.due_date}</div>}
            </>
          );
        })()}
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={deleteBusy}
      />
    </div>
  );
}
