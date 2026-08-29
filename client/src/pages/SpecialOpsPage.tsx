import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { useMenuActions } from '../utils/contextMenuActions';
import { useAuth } from '../context/AuthContext';
import { parseTimestamp, toDatetimeLocalValue, mtDatetimeLocalToUtc } from '../utils/dateUtils';
import { Swords, Shield, Wrench, AlertTriangle, Plus, Pencil, Trash2, Loader2 } from 'lucide-react';

interface Callout { id: number; date: string; call_type: string; location: string; resolution: string; duration_minutes: number; team_size: number; notes: string; }
interface Equipment { id: number; equipment_type: string; serial_number: string; condition: string; assigned_to: string; notes: string; }
interface Stats { totalCallouts: number; totalEquipment: number; readyEquipment: number; }

const EMPTY_CALLOUT = { date: toDatetimeLocalValue(new Date().toISOString()), call_type: '', location: '', resolution: '', duration_minutes: 0, team_size: 0, notes: '' };
const EMPTY_EQUIPMENT = { equipment_type: '', serial_number: '', condition: 'ready', assigned_to: '', notes: '' };

/** Roles that may create / delete records */
const CAN_CREATE_ROLES = new Set(['admin', 'manager', 'supervisor']);

export default function SpecialOpsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();

  const [callouts, setCallouts] = useState<Callout[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [stats, setStats] = useState<Stats>({ totalCallouts: 0, totalEquipment: 0, readyEquipment: 0 });
  /** 'loading' | 'empty' | 'ready' — distinguishes loading from genuinely-empty */
  const [loadState, setLoadState] = useState<'loading' | 'empty' | 'ready'>('loading');
  const [tab, setTab] = useState<'callouts' | 'equipment'>('callouts');
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Callout | Equipment | null>(null);
  const [formData, setFormData] = useState<Record<string, unknown>>(EMPTY_CALLOUT);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { addToast } = useToast();
  const m = useMenuActions();

  const canCreate = CAN_CREATE_ROLES.has(user?.role ?? '');

  // -- Deep-link: ?op_id= or ?operation_id= ---------------------
  // Captured once at mount so navigation after hydration does not re-fire.
  const pendingOpIdRef = useRef<string | null>(
    searchParams.get('op_id') ?? searchParams.get('operation_id')
  );

  const fetchData = useCallback(async () => {
    setLoadState('loading');
    try {
      const [c, e, s] = await Promise.all([
        apiFetch<Callout[]>('/special-ops/callouts').catch(() => [] as Callout[]),
        apiFetch<Equipment[]>('/special-ops/equipment').catch(() => [] as Equipment[]),
        apiFetch<Stats>('/special-ops/stats').catch(
          () => ({ totalCallouts: 0, totalEquipment: 0, readyEquipment: 0 }) as Stats
        ),
      ]);
      const safeCallouts = Array.isArray(c) ? c : [];
      const safeEquipment = Array.isArray(e) ? e : [];
      const safeStats =
        s && typeof s === 'object' && 'totalCallouts' in s
          ? s
          : { totalCallouts: 0, totalEquipment: 0, readyEquipment: 0 };
      setCallouts(safeCallouts);
      setEquipment(safeEquipment);
      setStats(safeStats);
      setLoadState(safeCallouts.length > 0 || safeEquipment.length > 0 ? 'ready' : 'empty');
    } catch {
      setLoadState('empty');
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // -- Deep-link hydration — runs once after list has loaded ----
  useEffect(() => {
    if (loadState === 'loading') return;
    const opIdRaw = pendingOpIdRef.current;
    if (!opIdRaw) return;
    pendingOpIdRef.current = null;

    // Strip param from URL before anything else
    const next = new URLSearchParams(searchParams);
    next.delete('op_id');
    next.delete('operation_id');
    setSearchParams(next, { replace: true });

    const opId = Number(opIdRaw);
    if (!Number.isFinite(opId) || opId <= 0) {
      addToast(`Invalid op_id: ${opIdRaw}`, 'error');
      return;
    }

    // Try callouts first, then equipment
    const calloutRec = callouts.find((c) => c.id === opId);
    const equipmentRec = equipment.find((e) => e.id === opId);
    const rec = calloutRec ?? equipmentRec;
    if (rec) {
      if (calloutRec) setTab('callouts');
      else setTab('equipment');
      setEditingRecord(rec);
      setFormData(calloutRec ? { ...calloutRec, date: toDatetimeLocalValue(calloutRec.date) } : { ...rec });
      setFormError(null);
      setFormOpen(true);
    } else {
      addToast(`Special ops record #${opId} not found`, 'warning');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadState]);

  // -- Keyboard shortcut: N -> open new-record form -------------
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Skip when focus is inside an input, select, or textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        if (!canCreate) return;
        setEditingRecord(null);
        setFormData(tab === 'callouts' ? { ...EMPTY_CALLOUT } : { ...EMPTY_EQUIPMENT });
        setFormError(null);
        setFormOpen(true);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [tab, canCreate]);

  // -- Esc cascade: close form first, then delete confirm -------
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (formOpen) { e.stopPropagation(); setFormOpen(false); return; }
      if (deleteTarget) { e.stopPropagation(); setDeleteTarget(null); }
    };
    document.addEventListener('keydown', handleEsc, true);
    return () => document.removeEventListener('keydown', handleEsc, true);
  }, [formOpen, deleteTarget]);

  const openNew = () => {
    if (!canCreate) return;
    setEditingRecord(null);
    setFormData(tab === 'callouts' ? { ...EMPTY_CALLOUT } : { ...EMPTY_EQUIPMENT });
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (rec: Callout | Equipment) => {
    setEditingRecord(rec);
    setFormData('date' in rec ? { ...rec, date: toDatetimeLocalValue(rec.date) } : { ...rec });
    setFormError(null);
    setFormOpen(true);
  };

  const handleSave = async () => {
    setFormSubmitting(true);
    setFormError(null);
    const isCallout = editingRecord ? 'call_type' in editingRecord : tab === 'callouts';
    const endpoint = isCallout ? '/special-ops/callouts' : '/special-ops/equipment';
    const payload = isCallout && 'date' in formData && formData.date
      ? { ...formData, date: mtDatetimeLocalToUtc(String(formData.date)) }
      : formData;
    try {
      if (editingRecord) {
        await apiFetch(`${endpoint}/${editingRecord.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        addToast('Record updated', 'success');
      } else {
        await apiFetch(endpoint, { method: 'POST', body: JSON.stringify(payload) });
        addToast('Record created', 'success');
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
    const endpoint = tab === 'callouts' ? '/special-ops/callouts' : '/special-ops/equipment';
    try {
      await apiFetch(`${endpoint}/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      fetchData();
      addToast('Record deleted', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally {
      setDeleting(false);
    }
  };

  // -- Filtered lists -------------------------------------------
  const searchLower = search.trim().toLowerCase();
  const filteredCallouts = searchLower
    ? callouts.filter((c) =>
        [c.call_type, c.location, c.resolution, c.notes].some(
          (v) => v?.toLowerCase().includes(searchLower)
        )
      )
    : callouts;
  const filteredEquipment = searchLower
    ? equipment.filter((e) =>
        [e.equipment_type, e.serial_number, e.assigned_to, e.notes].some(
          (v) => v?.toLowerCase().includes(searchLower)
        )
      )
    : equipment;

  // -- Column definitions ---------------------------------------
  const calloutColumns = [
    {
      key: 'date',
      label: 'Date',
      render: (r: Callout) => {
        try {
          return parseTimestamp(r.date).toLocaleDateString('en-US', {
            timeZone: 'America/Denver', month: 'short', day: 'numeric', year: 'numeric',
          });
        } catch {
          return r.date?.slice(0, 10) || '--';
        }
      },
    },
    { key: 'call_type', label: 'Type' },
    { key: 'location', label: 'Location' },
    { key: 'resolution', label: 'Resolution' },
    {
      key: 'duration_minutes',
      label: 'Duration',
      render: (r: Callout) => (r.duration_minutes ? `${r.duration_minutes}m` : '--'),
    },
    {
      key: 'actions',
      label: '',
      width: '80px',
      render: (r: Callout) => (
        <div className="flex gap-2">
          <button type="button"
            onClick={(e) => { e.stopPropagation(); openEdit(r); }}
            className="text-rmpg-400 hover:text-rmpg-100"
            title="Edit"
          >
            <Pencil size={12} />
          </button>
          {canCreate && (
            <button type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDeleteTarget({ id: r.id, label: r.call_type || `Callout #${r.id}` });
              }}
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

  const equipmentColumns = [
    { key: 'equipment_type', label: 'Type' },
    {
      key: 'serial_number',
      label: 'Serial #',
      render: (r: Equipment) => (
        <span className="font-mono text-rmpg-400">{r.serial_number || '--'}</span>
      ),
    },
    {
      key: 'condition',
      label: 'Condition',
      render: (r: Equipment) => (
        <span
          className={`badge ${
            r.condition === 'ready'
              ? 'badge-available'
              : r.condition === 'repair'
              ? 'badge-busy'
              : 'badge-pending'
          }`}
        >
          {r.condition}
        </span>
      ),
    },
    { key: 'assigned_to', label: 'Assigned To' },
    {
      key: 'actions',
      label: '',
      width: '80px',
      render: (r: Equipment) => (
        <div className="flex gap-2">
          <button type="button"
            onClick={(e) => { e.stopPropagation(); openEdit(r); }}
            className="text-rmpg-400 hover:text-rmpg-100"
            title="Edit"
          >
            <Pencil size={12} />
          </button>
          {canCreate && (
            <button type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDeleteTarget({ id: r.id, label: r.equipment_type || `Equipment #${r.id}` });
              }}
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

  // -- Empty state helper ---------------------------------------
  const renderEmptyState = (kind: string, hasFilter: boolean) => {
    if (loadState === 'loading') {
      return (
        <div className="flex items-center gap-2 p-6 text-rmpg-500 text-xs">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Loading {kind.toLowerCase()}...
        </div>
      );
    }
    if (hasFilter) {
      return (
        <div className="p-6 text-center text-rmpg-500 text-xs">
          No {kind.toLowerCase()} match &ldquo;{search}&rdquo;
        </div>
      );
    }
    return (
      <div className="p-6 text-center text-rmpg-500 text-xs">
        No {kind.toLowerCase()} recorded yet
        {canCreate && (
          <span className="block mt-1 text-rmpg-600">
            Press <kbd className="px-1 border border-rmpg-700 text-rmpg-400 font-mono">N</kbd> or use
            the toolbar to add one
          </span>
        )}
      </div>
    );
  };

  const formIsCallout =
    editingRecord ? 'call_type' in editingRecord : tab === 'callouts';

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="SPECIAL OPERATIONS" icon={Swords}>
        {canCreate && (
          <button type="button"
            onClick={openNew}
            className="toolbar-btn flex items-center gap-1.5"
            style={{ height: 28, padding: '0 10px' }}
            title="New record (N)"
          >
            <Plus size={13} /> {tab === 'callouts' ? 'New Callout' : 'New Equipment'}
          </button>
        )}
      </PanelTitleBar>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatsCard label="TOTAL CALLOUTS" value={String(stats.totalCallouts)} icon={AlertTriangle} />
        <StatsCard label="EQUIPMENT ITEMS" value={String(stats.totalEquipment)} icon={Wrench} />
        <StatsCard
          label="READY RATE"
          value={`${
            stats.totalEquipment > 0
              ? Math.round((stats.readyEquipment / stats.totalEquipment) * 100)
              : 100
          }%`}
          icon={Shield}
        />
        <StatsCard label="STATUS" value="STANDBY" icon={Swords} />
      </div>

      <div className="flex items-center gap-2">
        <button type="button"
          onClick={() => setTab('callouts')}
          className={`text-[10px] px-3 py-1 ${tab === 'callouts' ? 'toolbar-btn toolbar-btn-primary' : 'toolbar-btn'}`}
        >
          Callouts
        </button>
        <button type="button"
          onClick={() => setTab('equipment')}
          className={`text-[10px] px-3 py-1 ${tab === 'equipment' ? 'toolbar-btn toolbar-btn-primary' : 'toolbar-btn'}`}
        >
          Equipment
        </button>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          className="input-dark text-xs ml-auto"
          style={{ width: 160, height: 26 }}
          aria-label="Search special ops records"
        />
      </div>

      {tab === 'callouts' ? (
        filteredCallouts.length === 0 ? (
          renderEmptyState('Callouts', searchLower.length > 0)
        ) : (
          <DataTable
            columns={calloutColumns}
            data={filteredCallouts}
            emptyMessage="No callouts recorded"
            onRowClick={openEdit}
            rowContextMenu={(row: Callout) => [
              m.action('Open / Edit', () => openEdit(row), { icon: <Pencil size={12} /> }),
              m.separator(),
              m.copyId(row.id),
              ...(canCreate
                ? [m.action('Delete', () => setDeleteTarget({ id: row.id, label: row.call_type || `Callout #${row.id}` }), { danger: true, icon: <Trash2 size={12} /> })]
                : []),
            ]}
          />
        )
      ) : (
        filteredEquipment.length === 0 ? (
          renderEmptyState('Equipment', searchLower.length > 0)
        ) : (
          <DataTable
            columns={equipmentColumns}
            data={filteredEquipment}
            emptyMessage="No equipment in inventory"
            onRowClick={openEdit}
            rowContextMenu={(row: Equipment) => [
              m.action('Open / Edit', () => openEdit(row), { icon: <Pencil size={12} /> }),
              m.separator(),
              m.copy('Copy serial #', row.serial_number),
              m.copyId(row.id),
              ...(canCreate
                ? [m.action('Delete', () => setDeleteTarget({ id: row.id, label: row.equipment_type || `Equipment #${row.id}` }), { danger: true, icon: <Trash2 size={12} /> })]
                : []),
            ]}
          />
        )
      )}

      {/* -- Create / Edit modal --------------------------------- */}
      {formOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 overflow-y-auto p-4"
          onClick={() => setFormOpen(false)}
        >
          <div
            className="bg-surface-raised border border-rmpg-700 p-6 max-w-lg w-full my-auto"
            style={{ borderRadius: 2 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-rmpg-100 mb-4">
              {editingRecord ? 'Edit' : 'New'} {formIsCallout ? 'Callout' : 'Equipment'}
            </h3>
            {formError && <div className="text-xs text-red-400 mb-2">{formError}</div>}

            {formIsCallout ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ff-sops-0" className="text-[9px] text-rmpg-400 uppercase font-bold">Date</label>
                  <input
                    id="ff-sops-0"
                    type="datetime-local"
                    value={String(formData.date ?? '')}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    className="input-dark w-full mt-1 text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="ff-sops-1" className="text-[9px] text-rmpg-400 uppercase font-bold">Type *</label>
                  <input
                    id="ff-sops-1"
                    value={String(formData.call_type ?? '')}
                    onChange={(e) => setFormData({ ...formData, call_type: e.target.value })}
                    className="input-dark w-full mt-1 text-xs"
                    placeholder="e.g. SWAT, K9, EOD"
                  />
                </div>
                <div>
                  <label htmlFor="ff-sops-2" className="text-[9px] text-rmpg-400 uppercase font-bold">Location</label>
                  <input
                    id="ff-sops-2"
                    value={String(formData.location ?? '')}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    className="input-dark w-full mt-1 text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="ff-sops-3" className="text-[9px] text-rmpg-400 uppercase font-bold">Resolution</label>
                  <input
                    id="ff-sops-3"
                    value={String(formData.resolution ?? '')}
                    onChange={(e) => setFormData({ ...formData, resolution: e.target.value })}
                    className="input-dark w-full mt-1 text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="ff-sops-4" className="text-[9px] text-rmpg-400 uppercase font-bold">Duration (min)</label>
                  <input
                    id="ff-sops-4"
                    type="number"
                    value={Number(formData.duration_minutes ?? 0)}
                    onChange={(e) => setFormData({ ...formData, duration_minutes: parseInt(e.target.value) || 0 })}
                    className="input-dark w-full mt-1 text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="ff-sops-5" className="text-[9px] text-rmpg-400 uppercase font-bold">Team Size</label>
                  <input
                    id="ff-sops-5"
                    type="number"
                    value={Number(formData.team_size ?? 0)}
                    onChange={(e) => setFormData({ ...formData, team_size: parseInt(e.target.value) || 0 })}
                    className="input-dark w-full mt-1 text-xs"
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ff-sops-6" className="text-[9px] text-rmpg-400 uppercase font-bold">Type *</label>
                  <input
                    id="ff-sops-6"
                    value={String(formData.equipment_type ?? '')}
                    onChange={(e) => setFormData({ ...formData, equipment_type: e.target.value })}
                    className="input-dark w-full mt-1 text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="ff-sops-7" className="text-[9px] text-rmpg-400 uppercase font-bold">Serial #</label>
                  <input
                    id="ff-sops-7"
                    value={String(formData.serial_number ?? '')}
                    onChange={(e) => setFormData({ ...formData, serial_number: e.target.value })}
                    className="input-dark w-full mt-1 text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="ff-sops-8" className="text-[9px] text-rmpg-400 uppercase font-bold">Condition</label>
                  <select
                    id="ff-sops-8"
                    value={String(formData.condition ?? 'ready')}
                    onChange={(e) => setFormData({ ...formData, condition: e.target.value })}
                    className="input-dark w-full mt-1 text-xs"
                  >
                    <option value="ready">Ready</option>
                    <option value="repair">Repair</option>
                    <option value="retired">Retired</option>
                    <option value="lost">Lost</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="ff-sops-9" className="text-[9px] text-rmpg-400 uppercase font-bold">Assigned To</label>
                  <input
                    id="ff-sops-9"
                    value={String(formData.assigned_to ?? '')}
                    onChange={(e) => setFormData({ ...formData, assigned_to: e.target.value })}
                    className="input-dark w-full mt-1 text-xs"
                  />
                </div>
              </div>
            )}

            <div className="mt-3">
              <label htmlFor="ff-sops-10" className="text-[9px] text-rmpg-400 uppercase font-bold">Notes</label>
              <textarea
                id="ff-sops-10"
                value={String(formData.notes ?? '')}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="input-dark w-full mt-1 text-xs"
                rows={3}
              />
            </div>

            <div className="flex justify-end gap-3 mt-4">
              <button type="button" onClick={() => setFormOpen(false)} className="toolbar-btn px-4" style={{ height: 28 }}>
                Cancel
              </button>
              <button type="button"
                onClick={handleSave}
                disabled={
                  formSubmitting ||
                  (formIsCallout ? !formData.call_type : !formData.equipment_type)
                }
                className="toolbar-btn toolbar-btn-primary px-4"
                style={{ height: 28 }}
              >
                {formSubmitting ? (
                  <span className="flex items-center gap-1">
                    <Loader2 size={11} className="animate-spin" /> Saving...
                  </span>
                ) : (
                  'Save'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -- Delete confirmation (ConfirmDialog) ----------------- */}
      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Record"
        message="This permanently removes this record and cannot be undone."
        details={deleteTarget ? <span>{deleteTarget.label}</span> : undefined}
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={deleting}
      />
    </div>
  );
}
