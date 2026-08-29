// ============================================================
// RMPG Flex — Mass Notification Templates (/alerts)
//
// Page 55 of the full-app frontend pass. This page manages
// *templates* for Rave-Alert-parity mass notifications (NOT the
// per-user notification inbox at /notifications, NOT the system
// banner alerts feed). Server router lives at src/routes/
// notifications.ts mounted under /api/alerts.
//
// What the audit added:
//   - URL deep-link contract: ?template_id, ?category, ?channel
//   - Filter bar with empty-state distinction (no templates vs
//     filter is hiding everything)
//   - Esc smart-cascade: edit modal → delete confirm → filter clear
//   - ConfirmDialog replaces the inline delete modal (cancel-pre-
//     focus, focus-trap, body-scroll-lock, ARIA alertdialog)
//   - "N" shortcut opens a New Template (skipped when typing in
//     an input/textarea/select)
//   - Cmd/Ctrl+Enter saves the edit modal
//   - Theme-token sweep (no more hardcoded var(--text-secondary) / var(--sev-critical) /
//     var(--sev-critical-soft) — the inline delete modal that hardcoded those colors
//     is gone)
// ============================================================
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { useMenuActions } from '../utils/contextMenuActions';
import type { ContextMenuItem } from '../context/ContextMenuContext';
import {
  Megaphone, FileText, Send, CheckCircle, Plus, Pencil, Trash2, Eye,
  Filter as FilterIcon, X,
} from 'lucide-react';
import { formatEnumValue } from '../utils/formatters';
import { alertTemplatesToCsv, downloadTextFile } from '../utils/rmsListExport';

interface NotificationTemplate {
  id: number;
  template_name: string;
  subject: string | null;
  body: string;
  channel: string;
  category: string | null;
  created_at: string | null;
  updated_at?: string | null;
  created_by?: number | null;
}

const CHANNELS = ['email', 'sms', 'push', 'all'] as const;

export default function AlertsPage() {
  // ── URL deep-link contract ──
  // Accepts (all optional, all stripped after consumption so a refresh
  // doesn't re-pin the operator to a stale link):
  //   ?template_id=<id>  — highlight + scroll to that row; if it's
  //                        not in the current view (filter mismatch),
  //                        toast + reset filters so the operator can
  //                        find it.
  //   ?category=<cat>    — preselect a category filter.
  //   ?channel=<chan>    — preselect a channel filter.
  const [searchParams, setSearchParams] = useSearchParams();
  const initialCategoryParam = searchParams.get('category') ?? '';
  const initialChannelParam = searchParams.get('channel') ?? '';
  const pendingTemplateIdRef = useRef<string | null>(searchParams.get('template_id'));

  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ templates: 0, batches: 0, sent_batches: 0 });
  const [editingRecord, setEditingRecord] = useState<NotificationTemplate | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<NotificationTemplate | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterChannel, setFilterChannel] = useState<string>(initialChannelParam);
  const [filterCategory, setFilterCategory] = useState<string>(initialCategoryParam);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const { user } = useAuth();
  const canManage = ['admin', 'manager', 'supervisor'].includes(user?.role || '');
  const { addToast } = useToast();
  const m = useMenuActions();

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const r = await apiFetch<{ data: NotificationTemplate[] }>('/alerts/templates');
      setTemplates(r.data || []);
      const s = await apiFetch<{ templates: number; batches: number; sent_batches: number }>('/alerts/stats');
      setStats(s);
    } catch { setError('Failed to load data'); }
  }, []);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);

  // Categories distilled from the server payload — operator can't
  // filter by a category that doesn't exist in the dataset, and the
  // dropdown stays accurate even after a new category is added by
  // a template create.
  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of templates) {
      if (t.category) set.add(t.category);
    }
    return Array.from(set).sort();
  }, [templates]);

  const filteredTemplates = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return templates.filter(t => {
      if (filterChannel && t.channel !== filterChannel) return false;
      if (filterCategory && (t.category ?? '') !== filterCategory) return false;
      if (needle) {
        const blob = `${t.template_name} ${t.subject ?? ''} ${t.category ?? ''} ${t.channel}`.toLowerCase();
        if (!blob.includes(needle)) return false;
      }
      return true;
    });
  }, [templates, filterChannel, filterCategory, search]);

  // Consume ?template_id once on first load — highlight the row, scroll
  // into view, and (if a filter is hiding it) clear filters + toast so
  // the operator can find it.
  useEffect(() => {
    const id = pendingTemplateIdRef.current;
    if (!id || templates.length === 0) return;
    pendingTemplateIdRef.current = null;
    const numeric = Number(id);
    const found = templates.find(t => t.id === numeric);
    if (!found) {
      addToast(`Template #${id} not found`, 'info');
      // Strip the param either way so refresh doesn't re-pin.
      const next = new URLSearchParams(searchParams);
      next.delete('template_id');
      setSearchParams(next, { replace: true });
      return;
    }
    const inView = filteredTemplates.some(t => t.id === numeric);
    if (!inView) {
      setFilterChannel('');
      setFilterCategory('');
      addToast('Cleared filters to show linked template', 'info');
    }
    setHighlightId(numeric);
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-template-row="${numeric}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
    // Strip the param so refresh doesn't re-pin the operator to a stale link.
    const next = new URLSearchParams(searchParams);
    next.delete('template_id');
    setSearchParams(next, { replace: true });
    // Fade the highlight after a few seconds.
    const t = setTimeout(() => setHighlightId(null), 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates]);

  const openNew = useCallback(() => {
    setEditingRecord({ id: 0, template_name: '', subject: '', body: '', channel: 'email', category: '', created_at: null });
    setFormData({ template_name: '', subject: '', body: '', channel: 'email', category: 'general' });
  }, []);
  const openEdit = (rec: NotificationTemplate) => { setEditingRecord(rec); setFormData({ ...rec }); };

  const handleSave = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      if (editingRecord && editingRecord.id > 0) {
        await apiFetch(`/alerts/templates/${editingRecord.id}`, { method: 'PUT', body: JSON.stringify(formData) });
      } else {
        await apiFetch('/alerts/templates', { method: 'POST', body: JSON.stringify(formData) });
      }
      const wasEdit = !!(editingRecord && editingRecord.id > 0);
      setEditingRecord(null);
      await fetchData();
      addToast(wasEdit ? 'Template updated' : 'Template created', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally { setSubmitting(false); }
  }, [submitting, editingRecord, formData, fetchData, addToast]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await apiFetch(`/alerts/templates/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      await fetchData();
      addToast('Template deleted', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally { setDeleteBusy(false); }
  }, [deleteTarget, fetchData, addToast]);

  const showForm = editingRecord !== null;
  const hasFilters = !!(filterChannel || filterCategory || search.trim());
  const clearFilters = useCallback(() => {
    setFilterChannel('');
    setFilterCategory('');
    setSearch('');
  }, []);

  // ── Esc smart-cascade ──
  // Priority: delete confirm (handled by ConfirmDialog itself) →
  // edit modal → clear filters. We deliberately do NOT preventDefault
  // when nothing on this page is open so a global Esc handler upstream
  // (NotificationCenter, ContextMenu, etc) can still react.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (deleteTarget) return; // ConfirmDialog owns its own Esc
      if (showForm) { setEditingRecord(null); e.preventDefault(); return; }
      if (hasFilters) { clearFilters(); e.preventDefault(); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteTarget, showForm, hasFilters, clearFilters]);

  // ── "N" shortcut → New Template ──
  // Skipped when the operator is typing in an input/textarea/select,
  // and when a modal is already open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (showForm || deleteTarget) return;
      const t = e.target as HTMLElement | null;
      const tag = (t?.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || t?.isContentEditable;
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key !== 'n' && e.key !== 'N') return;
      if (e.shiftKey) return;
      if (typing) return;
      e.preventDefault();
      openNew();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showForm, deleteTarget, openNew]);

  // ── Cmd/Ctrl+Enter inside the edit modal → save ──
  useEffect(() => {
    if (!showForm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      handleSave();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showForm, handleSave]);

  const columns = [
    { key: 'template_name', label: 'Template' },
    { key: 'subject', label: 'Subject' },
    { key: 'channel', label: 'Channel' },
    { key: 'category', label: 'Category' },
    { key: 'created_at', label: 'Created' },
    { key: 'actions', label: '', width: '100px', render: (row: NotificationTemplate) => (
      <div className="flex gap-2" data-template-row={row.id}>
        <button onClick={(e) => { e.stopPropagation(); openEdit(row); }} className="text-rmpg-400 hover:text-rmpg-100" aria-label={`Edit ${row.template_name}`}><Pencil size={12} /></button>
        <button onClick={(e) => { e.stopPropagation(); setDeleteTarget(row); }} className="text-red-500 hover:text-red-300" aria-label={`Delete ${row.template_name}`}><Trash2 size={12} /></button>
      </div>
    )},
  ];

  if (loading) return <div className="p-6 text-rmpg-400">Loading notification system...</div>;

  // Empty-state distinction — "no templates at all" (server returned
  // zero, no filter) vs "no templates match this filter". Operators
  // with a stale deep-linked filter previously couldn't tell which.
  const noTemplatesAtAll = templates.length === 0;
  const filterHidingAll = templates.length > 0 && filteredTemplates.length === 0;
  const emptyMessage = noTemplatesAtAll
    ? 'No notification templates'
    : 'No templates match the current filter';

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="MASS NOTIFICATION" icon={Megaphone}>
        <button
          type="button"
          className="toolbar-btn"
          style={{ height: 28, padding: '0 10px' }}
          disabled={filteredTemplates.length === 0}
          onClick={() => downloadTextFile('alert-templates.csv', alertTemplatesToCsv(filteredTemplates))}
        >CSV</button>
        <button onClick={openNew} className="toolbar-btn flex items-center gap-1.5" style={{ height: 28, padding: '0 10px' }} title="New Template (N)"><Plus size={13} /> New Template</button>
      </PanelTitleBar>
      {error && (
        <div className="border border-red-700/40 bg-red-900/20 text-red-400 text-[11px] px-3 py-2 mb-1 flex items-center justify-between" role="alert">
          <span>{error}</span>
          <button type="button" className="toolbar-btn" onClick={() => { setLoading(true); void fetchData().finally(() => setLoading(false)); }}>Retry</button>
        </div>
      )}
      <div className="grid grid-cols-3 gap-3">
        <StatsCard icon={FileText} label="Templates" value={stats.templates} />
        <StatsCard icon={Send} label="Batches" value={stats.batches} />
        <StatsCard icon={CheckCircle} label="Sent" value={stats.sent_batches} />
      </div>

      {/* Filter bar — channel + category. Empty options hide the
          dropdowns when there's nothing to filter by, so a fresh
          install doesn't show useless empty selects. */}
      <div className="flex items-center gap-3 text-xs">
        <FilterIcon className="w-3.5 h-3.5 text-rmpg-400" />
        <input
          ref={searchRef}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search templates… (/)"
          className="input-dark text-xs h-7 w-48"
          aria-label="Search templates"
        />
        <label className="flex items-center gap-1.5">
          <span className="text-rmpg-400 uppercase text-[10px] font-semibold">Channel</span>
          <select
            value={filterChannel}
            onChange={e => setFilterChannel(e.target.value)}
            className="select-dark"
            style={{ height: 26, paddingTop: 0, paddingBottom: 0 }}
            aria-label="Filter by channel"
          >
            <option value="">All</option>
            {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        {categoryOptions.length > 0 && (
          <label className="flex items-center gap-1.5">
            <span className="text-rmpg-400 uppercase text-[10px] font-semibold">Category</span>
            <select
              value={filterCategory}
              onChange={e => setFilterCategory(e.target.value)}
              className="select-dark"
              style={{ height: 26, paddingTop: 0, paddingBottom: 0 }}
              aria-label="Filter by category"
            >
              <option value="">All</option>
              {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        )}
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="inline-flex items-center gap-1 text-rmpg-400 hover:text-rmpg-100 transition-colors"
            title="Clear filters (Esc)"
          >
            <X className="w-3 h-3" /> Clear
          </button>
        )}
        <span className="text-rmpg-500 ml-auto">{filteredTemplates.length} of {templates.length}</span>
      </div>

      <DataTable
        columns={columns}
        data={filteredTemplates}
        emptyMessage={emptyMessage}
        emptyDescription={filterHidingAll ? 'A filter is hiding templates. Press Esc or click Clear to show all.' : undefined}
        selectedKey={highlightId}
        onRowClick={(row) => openEdit(row)}
        enableContextMenu
        rowContextMenu={(row: NotificationTemplate): ContextMenuItem[] => [
          m.action('Open', () => openEdit(row), { icon: <Eye size={12} /> }),
          ...(canManage ? [m.action('Edit', () => openEdit(row), { icon: <Pencil size={12} /> })] : []),
          m.separator(),
          m.copyId(row.id),
          m.action('Delete', () => setDeleteTarget(row), { danger: true, icon: <Trash2 size={12} /> }),
        ]}
      />

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 overflow-y-auto p-4" onClick={() => setEditingRecord(null)}>
          <div className="bg-surface-raised border border-rmpg-700 p-6 max-w-lg w-full my-auto" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-rmpg-100 mb-4">{editingRecord && editingRecord.id > 0 ? 'Edit Template' : 'New Template'}</h3>
            <div className="space-y-3">
              <div><label htmlFor="ff-alertspage-0" className="text-[10px] text-rmpg-400 uppercase font-semibold">Name <span className="text-red-500">*</span></label>
                <input id="ff-alertspage-0" className="input-dark mt-1" value={formData.template_name || ''} onChange={e => setFormData({...formData, template_name: e.target.value})} autoFocus /></div>
              <div><label htmlFor="ff-alertspage-1" className="text-[10px] text-rmpg-400 uppercase font-semibold">Subject</label>
                <input id="ff-alertspage-1" className="input-dark mt-1" value={formData.subject || ''} onChange={e => setFormData({...formData, subject: e.target.value})} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label htmlFor="ff-alertspage-2" className="text-[10px] text-rmpg-400 uppercase font-semibold">Channel</label>
                  <select id="ff-alertspage-2" className="select-dark mt-1" value={formData.channel || 'email'} onChange={e => setFormData({...formData, channel: e.target.value})}>
                    {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select></div>
                <div><label htmlFor="ff-alertspage-3" className="text-[10px] text-rmpg-400 uppercase font-semibold">Category</label>
                  <input id="ff-alertspage-3" className="input-dark mt-1" value={formData.category || ''} onChange={e => setFormData({...formData, category: e.target.value})} /></div>
              </div>
              <div><label htmlFor="ff-alertspage-4" className="text-[10px] text-rmpg-400 uppercase font-semibold">Body <span className="text-red-500">*</span></label>
                <textarea id="ff-alertspage-4" rows={4} className="input-dark mt-1" value={formData.body || ''} onChange={e => setFormData({...formData, body: e.target.value})} /></div>
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setEditingRecord(null)} className="toolbar-btn px-4" style={{ height: 28 }}>Cancel</button>
              <button onClick={handleSave} disabled={submitting} className="toolbar-btn toolbar-btn-primary px-4" style={{ height: 28 }} title="Save (Cmd/Ctrl+Enter)">
                {submitting ? 'Saving...' : editingRecord && editingRecord.id > 0 ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Template"
        message="This permanently removes the notification template. Batches that already used this template are not affected."
        details={deleteTarget && (
          <>
            <div><span className="text-rmpg-500">Name:</span> {deleteTarget.template_name}</div>
            {deleteTarget.subject && <div><span className="text-rmpg-500">Subject:</span> {deleteTarget.subject}</div>}
            <div><span className="text-rmpg-500">Channel:</span> {deleteTarget.channel}</div>
            {deleteTarget.category && <div><span className="text-rmpg-500">Category:</span> {formatEnumValue(deleteTarget.category)}</div>}
          </>
        )}
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={deleteBusy}
      />
    </div>
  );
}
