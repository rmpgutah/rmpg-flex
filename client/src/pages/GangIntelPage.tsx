import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import { ShieldAlert, Users, SprayCanIcon as Spray, TrendingUp, Plus, Pencil, Trash2, Eye, Loader2 } from 'lucide-react';
import { formatEnumValue } from '../utils/formatters';
import { gangMembersToCsv, downloadTextFile } from '../utils/rmsListExport';

interface GangMember {
  id: number;
  name: string;
  moniker: string;
  gang_name: string;
  status: string;
  threat_level: string;
  notes: string;
}

interface Gang {
  id: number;
  name: string;
  colors: string;
  member_count: number;
  threat_level: string;
  territory: string;
  notes: string;
}

interface Stats {
  totalMembers: number;
  activeMembers: number;
  totalGangs: number;
}

const EMPTY_MEMBER = { name: '', moniker: '', gang_name: '', status: 'active', threat_level: 'low', notes: '' };

export default function GangIntelPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [members, setMembers] = useState<GangMember[]>([]);
  const [gangs, setGangs] = useState<Gang[]>([]);
  const [stats, setStats] = useState<Stats>({ totalMembers: 0, activeMembers: 0, totalGangs: 0 });

  // Distinguish "initial load" vs "data loaded but empty" vs "no search results"
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const searchRef = useRef<HTMLInputElement>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<GangMember | null>(null);
  const [formData, setFormData] = useState<typeof EMPTY_MEMBER>(EMPTY_MEMBER);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // ConfirmDialog state for delete
  const [deleteTarget, setDeleteTarget] = useState<GangMember | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const { addToast } = useToast();
  const m = useMenuActions();

  // Role gate: delete intel records restricted to admin/manager/supervisor
  // (mirrors the Worker's DELETE endpoint guard in src/routes/gangIntel.ts)
  const canDelete = ['admin', 'manager', 'supervisor'].includes(user?.role || '');

  // ── Deep-link seed: ?member_id= or ?gang_id= ──────────────
  // Read once on mount and strip so the URL stays clean.
  const deepLinkMemberIdRef = useRef<number | null>(null);
  useEffect(() => {
    const mid = searchParams.get('member_id');
    const gid = searchParams.get('gang_id');
    if (mid) deepLinkMemberIdRef.current = Number(mid);
    if (mid || gid) {
      const next = new URLSearchParams(searchParams);
      next.delete('member_id');
      next.delete('gang_id');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchData = useCallback(async () => {
    setLoadError(false);
    try {
      const ms = await apiFetch<GangMember[]>('/gang-intel');
      const gs = await apiFetch<Gang[]>('/gang-intel/gangs').catch(() => [] as Gang[]);
      const st = await apiFetch<Stats>('/gang-intel/stats').catch(
        () => ({ totalMembers: 0, activeMembers: 0, totalGangs: 0 })
      );
      setMembers(ms);
      setGangs(gs);
      setStats(st);
      setHasLoaded(true);

      // Hydrate deep-link: auto-open the target member in the edit form
      if (deepLinkMemberIdRef.current !== null) {
        const target = ms.find(r => r.id === deepLinkMemberIdRef.current);
        deepLinkMemberIdRef.current = null;
        if (target) {
          setEditingRecord(target);
          setFormData({ ...target });
          setFormError(null);
          setFormOpen(true);
        }
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── 'N' keyboard shortcut → open new-member form ──────────
  // Only fires when focus is not in an input/textarea/select.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const editable =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
        (e.target as HTMLElement).isContentEditable;
      if (editable || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        openNew();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // ── Esc cascade: form → delete confirm ────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (formOpen) { e.stopPropagation(); setFormOpen(false); return; }
      if (deleteTarget) { e.stopPropagation(); setDeleteTarget(null); }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [formOpen, deleteTarget]);

  const openNew = () => {
    setEditingRecord(null);
    setFormData({ ...EMPTY_MEMBER });
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (rec: GangMember) => {
    setEditingRecord(rec);
    setFormData({ ...rec });
    setFormError(null);
    setFormOpen(true);
  };

  const handleSave = async () => {
    setFormSubmitting(true);
    setFormError(null);
    try {
      if (editingRecord) {
        await apiFetch(`/gang-intel/${editingRecord.id}`, {
          method: 'PUT',
          body: JSON.stringify(formData),
        });
        addToast('Member updated', 'success');
      } else {
        await apiFetch('/gang-intel', {
          method: 'POST',
          body: JSON.stringify(formData),
        });
        addToast('Member added', 'success');
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
    setDeleteSubmitting(true);
    try {
      await apiFetch(`/gang-intel/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      fetchData();
      addToast('Member deleted', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally {
      setDeleteSubmitting(false);
    }
  };

  // ── Filtered list with search ──────────────────────────────
  const q = search.trim().toLowerCase();
  const filtered = members.filter((r) => {
    if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
    if (!q) return true;
    return (
      r.name.toLowerCase().includes(q) ||
      (r.moniker || '').toLowerCase().includes(q) ||
      (r.gang_name || '').toLowerCase().includes(q)
    );
  });
  const hasFilter = !!q || statusFilter !== 'ALL';

  // ── Empty-state messaging ─────────────────────────────────
  let emptyMessage = 'No gang members tracked yet';
  if (!hasLoaded) {
    emptyMessage = 'Loading…';
  } else if (hasFilter && members.length > 0 && filtered.length === 0) {
    emptyMessage = 'No members match the current filter';
  } else if (members.length === 0) {
    emptyMessage = 'No gang members tracked yet — add the first record with New Member';
  }

  const memberColumns = [
    { key: 'name', label: 'Name' },
    { key: 'moniker', label: 'Moniker', render: (r: GangMember) => r.moniker || '--' },
    { key: 'gang_name', label: 'Gang', render: (r: GangMember) => r.gang_name || '--' },
    {
      key: 'status',
      label: 'Status',
      render: (r: GangMember) => (
        <span className={`badge ${r.status === 'active' ? 'badge-p1' : 'badge-p4'}`}>
          {formatEnumValue(r.status)}
        </span>
      ),
    },
    {
      key: 'threat_level',
      label: 'Threat',
      render: (r: GangMember) => (
        <span
          className={`badge ${
            r.threat_level === 'critical'
              ? 'badge-p1'
              : r.threat_level === 'high'
              ? 'badge-p2'
              : 'badge-p3'
          }`}
        >
          {formatEnumValue(r.threat_level)}
        </span>
      ),
    },
    {
      key: 'actions',
      label: '',
      width: '80px',
      render: (r: GangMember) => (
        <div className="flex gap-2">
          <button
            onClick={e => { e.stopPropagation(); openEdit(r); }}
            className="text-rmpg-400 hover:text-rmpg-100"
            title="Edit"
          >
            <Pencil size={12} />
          </button>
          {canDelete && (
            <button
              onClick={e => { e.stopPropagation(); setDeleteTarget(r); }}
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

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-rmpg-400">
        <Loader2 size={16} className="animate-spin" aria-label="Loading" />
        Loading gang intelligence…
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="GANG INTELLIGENCE" icon={ShieldAlert}>
        <input
          ref={searchRef}
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search members, monikers, gangs…"
          className="input-dark text-xs h-7 w-52"
          aria-label="Search gang members"
        />
        <select
          aria-label="Filter by status"
          className="select-dark text-xs h-7"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="ALL">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="deceased">Deceased</option>
        </select>
        <button
          type="button"
          className="toolbar-btn"
          style={{ height: 28, padding: '0 10px' }}
          disabled={filtered.length === 0}
          onClick={() => downloadTextFile('gang-members.csv', gangMembersToCsv(filtered))}
        >CSV</button>
        <button
          onClick={openNew}
          className="toolbar-btn flex items-center gap-1.5"
          style={{ height: 28, padding: '0 10px' }}
          title="New Member (N)"
        >
          <Plus size={13} /> New Member
        </button>
      </PanelTitleBar>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatsCard label="TOTAL MEMBERS" value={String(stats.totalMembers)} icon={Users} />
        <StatsCard label="ACTIVE" value={String(stats.activeMembers)} icon={TrendingUp} />
        <StatsCard label="GANGS TRACKED" value={String(stats.totalGangs)} icon={Spray} />
        <StatsCard label="THREAT LEVEL" value="MEDIUM" icon={ShieldAlert} />
      </div>

      {loadError && (
        <div className="p-3 text-xs text-red-400 flex items-center justify-between">
          <span>Failed to load gang intelligence.</span>
          <button type="button" className="toolbar-btn" onClick={() => { setLoading(true); void fetchData(); }}>Retry</button>
        </div>
      )}

      {/* Search bar moved to title bar */}

      <DataTable
        columns={memberColumns}
        data={filtered}
        emptyMessage={emptyMessage}
        onRowClick={openEdit}
        rowContextMenu={(r): ContextMenuItem[] => [
          m.action('Open', () => openEdit(r), { icon: <Eye size={12} /> }),
          m.action('Edit', () => openEdit(r), { icon: <Pencil size={12} /> }),
          m.separator(),
          m.copyId(r.id),
          m.copy('Copy name', r.name),
          m.copy('Copy moniker', r.moniker || ''),
          ...(canDelete
            ? [m.action('Delete', () => setDeleteTarget(r), { danger: true, icon: <Trash2 size={12} /> })]
            : []),
        ]}
      />

      {/* Member form modal */}
      {formOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
          style={{ background: 'rgba(0 0 0 / 0.70)' }}
          onClick={() => setFormOpen(false)}
        >
          <div
            className="bg-surface-raised border border-rmpg-700 p-6 max-w-lg w-full my-auto"
            style={{ borderRadius: 2 }}
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-rmpg-100 mb-4">
              {editingRecord ? 'Edit Member' : 'New Member'}
            </h3>
            {formError && <div className="text-xs text-red-400 mb-2">{formError}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="ff-gi-name" className="text-[9px] text-rmpg-400 uppercase font-bold">
                  Name *
                </label>
                <input
                  id="ff-gi-name"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                />
              </div>
              <div>
                <label htmlFor="ff-gi-moniker" className="text-[9px] text-rmpg-400 uppercase font-bold">
                  Moniker
                </label>
                <input
                  id="ff-gi-moniker"
                  value={formData.moniker}
                  onChange={e => setFormData({ ...formData, moniker: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                />
              </div>
              <div>
                <label htmlFor="ff-gi-gang" className="text-[9px] text-rmpg-400 uppercase font-bold">
                  Gang
                </label>
                <input
                  id="ff-gi-gang"
                  value={formData.gang_name}
                  onChange={e => setFormData({ ...formData, gang_name: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                />
              </div>
              <div>
                <label htmlFor="ff-gi-status" className="text-[9px] text-rmpg-400 uppercase font-bold">
                  Status
                </label>
                <select
                  id="ff-gi-status"
                  value={formData.status}
                  onChange={e => setFormData({ ...formData, status: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="incarcerated">Incarcerated</option>
                  <option value="deceased">Deceased</option>
                </select>
              </div>
              <div>
                <label htmlFor="ff-gi-threat" className="text-[9px] text-rmpg-400 uppercase font-bold">
                  Threat Level
                </label>
                <select
                  id="ff-gi-threat"
                  value={formData.threat_level}
                  onChange={e => setFormData({ ...formData, threat_level: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
            </div>
            <div className="mt-3">
              <label htmlFor="ff-gi-notes" className="text-[9px] text-rmpg-400 uppercase font-bold">
                Notes
              </label>
              <textarea
                id="ff-gi-notes"
                value={formData.notes}
                onChange={e => setFormData({ ...formData, notes: e.target.value })}
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
                disabled={formSubmitting || !formData.name}
                className="toolbar-btn toolbar-btn-primary px-4"
                style={{ height: 28 }}
              >
                {formSubmitting ? (
                  <><Loader2 size={12} className="inline animate-spin mr-1" />Saving…</>
                ) : (
                  'Save'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Member"
        message="This permanently removes the member record and cannot be undone."
        details={
          deleteTarget ? (
            <>
              <div><span className="text-rmpg-400">Name:</span> {deleteTarget.name}</div>
              {deleteTarget.moniker && (
                <div><span className="text-rmpg-400">Moniker:</span> {deleteTarget.moniker}</div>
              )}
              {deleteTarget.gang_name && (
                <div><span className="text-rmpg-400">Gang:</span> {deleteTarget.gang_name}</div>
              )}
            </>
          ) : undefined
        }
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={deleteSubmitting}
      />
    </div>
  );
}
