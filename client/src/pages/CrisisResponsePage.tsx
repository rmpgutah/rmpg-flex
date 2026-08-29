import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { useToast } from '../components/ToastProvider';
import { useMenuActions } from '../utils/contextMenuActions';
import { useAuth } from '../context/AuthContext';
import { Brain, Heart, PhoneCall, Users, Plus, Pencil, Trash2 } from 'lucide-react';

import ConfirmDialog from '../components/ConfirmDialog';
import { toDisplayLabel } from '../utils/formatters';
import { crisisIncidentsToCsv, downloadTextFile } from '../utils/rmsListExport';

interface CrisisIncident {
  id: number;
  incident_number: string;
  incident_type: string;
  location: string;
  subject_name: string;
  disposition: string;
  cit_team_used: number;
  resolved_on_scene: number;
  diverted: number;
  notes: string;
}
interface CrisisStats {
  citCalls: number;
  resolvedOnScene: number;
  diversionRate: number;
  teamsAvailable: number;
}

const EMPTY_FORM = {
  incident_number: '',
  incident_type: 'mental_health',
  location: '',
  subject_name: '',
  disposition: '',
  cit_team_used: 0,
  resolved_on_scene: 0,
  diverted: 0,
  notes: '',
};

export default function CrisisResponsePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();

  const [incidents, setIncidents] = useState<CrisisIncident[]>([]);
  const [stats, setStats] = useState<CrisisStats>({
    citCalls: 0,
    resolvedOnScene: 0,
    diversionRate: 0,
    teamsAvailable: 0,
  });
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const searchRef = useRef<HTMLInputElement>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<CrisisIncident | null>(null);
  const [formData, setFormData] = useState<typeof EMPTY_FORM>(EMPTY_FORM);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CrisisIncident | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { addToast } = useToast();
  const m = useMenuActions();

  // Role gate — only admin/manager may create or delete crisis entries
  const canCreate = ['admin', 'manager'].includes(user?.role ?? '');
  const canDelete = ['admin', 'manager'].includes(user?.role ?? '');

  // ── Deep-link: ?crisis_id= or ?incident_id= ─────────────────
  const pendingIdRef = useRef<string | null>(
    searchParams.get('crisis_id') ?? searchParams.get('incident_id'),
  );

  const fetchData = useCallback(async () => {
    setLoadState('loading');
    try {
      const [i, s] = await Promise.all([
        apiFetch<CrisisIncident[]>('/crisis/incidents').catch(() => [] as CrisisIncident[]),
        apiFetch<CrisisStats>('/crisis/stats').catch(
          () => ({ citCalls: 0, resolvedOnScene: 0, diversionRate: 0, teamsAvailable: 0 }),
        ),
      ]);
      setIncidents(i);
      setStats(s);
      setLoadState('ok');
    } catch {
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Strip deep-link params after data loads and open the targeted record
  useEffect(() => {
    if (loadState !== 'ok') return;
    const targetId = pendingIdRef.current;
    if (!targetId) return;
    pendingIdRef.current = null;

    const next = new URLSearchParams(searchParams);
    next.delete('crisis_id');
    next.delete('incident_id');
    setSearchParams(next, { replace: true });

    const id = Number(targetId);
    if (!Number.isFinite(id) || id <= 0) {
      addToast(`Invalid crisis incident id: ${targetId}`, 'error');
      return;
    }
    const hit = incidents.find((r) => r.id === id);
    if (hit) {
      openEdit(hit);
    } else {
      addToast(`Crisis incident #${targetId} not found`, 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadState]);

  // ── Filtered view ─────────────────────────────────────────────
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return incidents.filter((r) => {
      if (typeFilter !== 'ALL' && r.incident_type !== typeFilter) return false;
      if (!needle) return true;
      return (
        r.incident_number?.toLowerCase().includes(needle) ||
        r.subject_name?.toLowerCase().includes(needle) ||
        r.location?.toLowerCase().includes(needle) ||
        r.incident_type?.toLowerCase().includes(needle) ||
        r.disposition?.toLowerCase().includes(needle)
      );
    });
  }, [incidents, search, typeFilter]);

  const hasSearch = search.trim().length > 0 || typeFilter !== 'ALL';

  const openNew = useCallback(() => {
    setEditingRecord(null);
    setFormData({ ...EMPTY_FORM });
    setFormError(null);
    setFormOpen(true);
  }, []);

  const openEdit = (rec: CrisisIncident) => {
    setEditingRecord(rec);
    setFormData({ ...rec } as typeof EMPTY_FORM);
    setFormError(null);
    setFormOpen(true);
  };

  const handleSave = async () => {
    setFormSubmitting(true);
    setFormError(null);
    try {
      if (editingRecord) {
        await apiFetch(`/crisis/incidents/${editingRecord.id}`, {
          method: 'PUT',
          body: JSON.stringify(formData),
        });
        addToast('Incident updated', 'success');
      } else {
        await apiFetch('/crisis/incidents', {
          method: 'POST',
          body: JSON.stringify(formData),
        });
        addToast('Incident created', 'success');
      }
      setFormOpen(false);
      fetchData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setFormError(msg);
      addToast(msg, 'error');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch(`/crisis/incidents/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      fetchData();
      addToast('Incident deleted', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally {
      setDeleting(false);
    }
  };

  // ── Keyboard shortcuts ────────────────────────────────────────
  //   Esc — smart-cascade: deleteTarget -> form -> clear search
  //   N   — open New Incident modal (typing-suppressed, canCreate only)
  useEffect(() => {
    const isTypingInField = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (deleteTarget) { setDeleteTarget(null); return; }
        if (formOpen) { setFormOpen(false); setEditingRecord(null); return; }
        if (hasSearch) { setSearch(''); setTypeFilter('ALL'); return; }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingInField(e.target)) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if ((e.key === 'n' || e.key === 'N') && canCreate) {
        e.preventDefault();
        openNew();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteTarget, formOpen, hasSearch, canCreate, openNew]);

  const columns = [
    { key: 'incident_number', label: 'Incident #' },
    {
      key: 'incident_type',
      label: 'Type',
      render: (r: CrisisIncident) => toDisplayLabel(r.incident_type) || '--',
    },
    { key: 'subject_name', label: 'Subject' },
    { key: 'location', label: 'Location' },
    { key: 'disposition', label: 'Disposition' },
    {
      key: 'cit_team_used',
      label: 'CIT',
      render: (r: CrisisIncident) =>
        r.cit_team_used ? (
          <span className="text-blue-400">Yes</span>
        ) : (
          <span className="text-rmpg-500">No</span>
        ),
    },
    {
      key: 'resolved_on_scene',
      label: 'Resolved',
      render: (r: CrisisIncident) =>
        r.resolved_on_scene ? (
          <span className="text-blue-400">Yes</span>
        ) : (
          <span className="text-rmpg-500">No</span>
        ),
    },
    {
      key: 'actions',
      label: '',
      width: '80px',
      render: (r: CrisisIncident) => (
        <div className="flex gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); openEdit(r); }}
            className="text-rmpg-400 hover:text-rmpg-100"
            title="Edit"
          >
            <Pencil size={12} />
          </button>
          {canDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); setDeleteTarget(r); }}
              className="text-red-500 hover:text-red-300"
              title="Delete"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      ),
    },
  ];

  // ── Empty state message ──────────────────────────────────────
  const emptyMessage =
    loadState === 'loading' ? 'Loading crisis response data...'
    : loadState === 'error'  ? 'Failed to load crisis incidents'
    : hasSearch              ? `No incidents match "${search}". Clear the search to see all ${incidents.length} record${incidents.length !== 1 ? 's' : ''}.`
    : canCreate              ? 'No crisis incidents recorded. Press N to create the first one.'
    :                          'No crisis incidents recorded.';

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="CRISIS RESPONSE" icon={Brain}>
        <button
          type="button"
          className="toolbar-btn"
          style={{ height: 28, padding: '0 10px' }}
          disabled={filtered.length === 0}
          onClick={() => downloadTextFile('crisis-incidents.csv', crisisIncidentsToCsv(filtered))}
        >CSV</button>
        {canCreate && (
          <button
            onClick={openNew}
            className="toolbar-btn flex items-center gap-1.5"
            style={{ height: 28, padding: '0 10px' }}
          >
            <Plus size={13} /> New Incident{' '}
            <span className="ml-1 text-[9px] text-rmpg-500">(N)</span>
          </button>
        )}
      </PanelTitleBar>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatsCard label="CIT DEPLOYMENTS" value={String(stats.citCalls)} icon={PhoneCall} />
        <StatsCard label="RESOLVED ON SCENE" value={String(stats.resolvedOnScene)} icon={Heart} />
        <StatsCard label="DIVERSION RATE" value={`${stats.diversionRate}%`} icon={Users} />
        <StatsCard label="TEAMS AVAILABLE" value={String(stats.teamsAvailable)} icon={Brain} />
      </div>

      {loadState === 'error' && (
        <div className="p-3 text-xs text-red-400 flex items-center justify-between">
          <span>Failed to load crisis incidents.</span>
          <button type="button" className="toolbar-btn" onClick={() => void fetchData()}>Retry</button>
        </div>
      )}

      {/* Search bar */}
      <div className="flex items-center gap-2">
        <input
          ref={searchRef}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search incidents… (/)"
          className="input-dark text-xs"
          style={{ width: 220 }}
          aria-label="Search crisis incidents"
        />
        <select
          aria-label="Filter by incident type"
          className="select-dark text-xs h-7"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="ALL">All types</option>
          <option value="mental_health">Mental health</option>
          <option value="suicide">Suicide</option>
          <option value="substance">Substance</option>
          <option value="other">Other</option>
        </select>
        {hasSearch && (
          <button
            onClick={() => { setSearch(''); setTypeFilter('ALL'); }}
            className="toolbar-btn text-xs px-2"
            style={{ height: 28 }}
          >
            Clear
          </button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        emptyMessage={emptyMessage}
        onRowClick={openEdit}
        rowContextMenu={(row) => [
          m.action('Open / Edit', () => openEdit(row), { icon: <Pencil size={12} /> }),
          m.separator(),
          m.copyId(row.id),
          ...(canDelete
            ? [m.action('Delete', () => setDeleteTarget(row), { danger: true, icon: <Trash2 size={12} /> })]
            : []),
        ]}
      />

      {/* New / Edit form modal */}
      {formOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 overflow-y-auto p-4"
          onClick={() => setFormOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setFormOpen(false);
            }
          }}
        >
          <div
            className="bg-surface-raised border border-rmpg-700 p-6 max-w-lg w-full my-auto"
            style={{ borderRadius: 2 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-rmpg-100 mb-4">
              {editingRecord ? 'Edit Incident' : 'New Incident'}
            </h3>
            {formError && <div className="text-xs text-red-400 mb-2">{formError}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="ff-crisisresponsepage-0" className="text-[9px] text-rmpg-400 uppercase font-bold">
                  Incident # *
                </label>
                <input
                  id="ff-crisisresponsepage-0"
                  value={formData.incident_number}
                  onChange={(e) => setFormData({ ...formData, incident_number: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                />
              </div>
              <div>
                <label htmlFor="ff-crisisresponsepage-1" className="text-[9px] text-rmpg-400 uppercase font-bold">
                  Type
                </label>
                <select
                  id="ff-crisisresponsepage-1"
                  value={formData.incident_type}
                  onChange={(e) => setFormData({ ...formData, incident_type: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                >
                  <option value="mental_health">Mental Health</option>
                  <option value="suicide_ideation">Suicide Ideation</option>
                  <option value="substance_abuse">Substance Abuse</option>
                  <option value="domestic">Domestic</option>
                  <option value="welfare_check">Welfare Check</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label htmlFor="ff-crisisresponsepage-2" className="text-[9px] text-rmpg-400 uppercase font-bold">
                  Subject
                </label>
                <input
                  id="ff-crisisresponsepage-2"
                  value={formData.subject_name}
                  onChange={(e) => setFormData({ ...formData, subject_name: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                />
              </div>
              <div>
                <label htmlFor="ff-crisisresponsepage-3" className="text-[9px] text-rmpg-400 uppercase font-bold">
                  Location
                </label>
                <input
                  id="ff-crisisresponsepage-3"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                />
              </div>
              <div className="col-span-2">
                <label htmlFor="ff-crisisresponsepage-4" className="text-[9px] text-rmpg-400 uppercase font-bold">
                  Disposition
                </label>
                <input
                  id="ff-crisisresponsepage-4"
                  value={formData.disposition}
                  onChange={(e) => setFormData({ ...formData, disposition: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                />
              </div>
              <div className="flex items-center gap-4 col-span-2">
                <label className="flex items-center gap-2 text-[11px] text-rmpg-300">
                  <input
                    id="ff-crisisresponsepage-5"
                    type="checkbox"
                    checked={formData.cit_team_used === 1}
                    onChange={(e) => setFormData({ ...formData, cit_team_used: e.target.checked ? 1 : 0 })}
                    className="w-3 h-3"
                  />{' '}
                  CIT Team Used
                </label>
                <label className="flex items-center gap-2 text-[11px] text-rmpg-300">
                  <input
                    id="ff-crisisresponsepage-6"
                    type="checkbox"
                    checked={formData.resolved_on_scene === 1}
                    onChange={(e) =>
                      setFormData({ ...formData, resolved_on_scene: e.target.checked ? 1 : 0 })
                    }
                    className="w-3 h-3"
                  />{' '}
                  Resolved on Scene
                </label>
                <label className="flex items-center gap-2 text-[11px] text-rmpg-300">
                  <input
                    id="ff-crisisresponsepage-7"
                    type="checkbox"
                    checked={formData.diverted === 1}
                    onChange={(e) => setFormData({ ...formData, diverted: e.target.checked ? 1 : 0 })}
                    className="w-3 h-3"
                  />{' '}
                  Diverted
                </label>
              </div>
            </div>
            <div className="mt-3">
              <label htmlFor="ff-crisisresponsepage-8" className="text-[9px] text-rmpg-400 uppercase font-bold">
                Notes
              </label>
              <textarea
                id="ff-crisisresponsepage-8"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="input-dark w-full mt-1 text-xs"
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => setFormOpen(false)}
                className="toolbar-btn px-4"
                style={{ height: 28 }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={formSubmitting || !formData.incident_number}
                className="toolbar-btn toolbar-btn-primary px-4"
                style={{ height: 28 }}
              >
                {formSubmitting ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Crisis Incident"
        message="Permanently delete this crisis incident? This cannot be undone."
        details={
          deleteTarget ? (
            <>
              {deleteTarget.incident_number && <div>Incident #{deleteTarget.incident_number}</div>}
              {deleteTarget.subject_name && <div>Subject: {deleteTarget.subject_name}</div>}
              {deleteTarget.incident_type && <div>{toDisplayLabel(deleteTarget.incident_type)}</div>}
              {deleteTarget.location && <div className="text-rmpg-500">{deleteTarget.location}</div>}
              {deleteTarget.disposition && (
                <div className="text-rmpg-500">Disposition: {deleteTarget.disposition}</div>
              )}
            </>
          ) : undefined
        }
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={deleting}
      />
    </div>
  );
}
