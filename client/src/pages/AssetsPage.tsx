import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';
import { useMenuActions } from '../utils/contextMenuActions';
import { Package, Wrench, Crosshair, Dog, Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { assetsToCsv, downloadTextFile } from '../utils/rmsListExport';

export default function AssetsPage() {
  const m = useMenuActions();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [assets, setAssets] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ totalAssets: 0, issuedAssets: 0, totalWeapons: 0, activeK9: 0 });
  const [editingRecord, setEditingRecord] = useState<Record<string, any> | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const { addToast } = useToast();

  // Role gates — mirror the server's requireRole calls:
  //   POST/PUT inventory: admin | manager | supervisor
  //   DELETE inventory:   admin | manager
  const canCreate = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'supervisor';
  const canEdit = canCreate;
  const canDelete = user?.role === 'admin' || user?.role === 'manager';

  // ── Deep-link: ?asset_id= pre-selects and opens the edit form ──
  // Captured once on mount; subsequent setSearchParams calls would
  // clear it from searchParams before the assets data arrives.
  const pendingAssetIdRef = useRef<string | null>(searchParams.get('asset_id'));

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const r = await apiFetch<{ data: Record<string, any>[] }>('/assets/inventory');
      setAssets(r.data || []);
      const s = await apiFetch<{ totalAssets: number; issuedAssets: number; totalWeapons: number; activeK9: number }>('/assets/stats');
      setStats(s);
    } catch { setError('Failed to load asset data'); }
  }, []);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  // Strip ?asset_id= after hydration and open the matching record
  useEffect(() => {
    const pendingId = pendingAssetIdRef.current;
    if (!pendingId || loading || assets.length === 0) return;
    pendingAssetIdRef.current = null;

    const next = new URLSearchParams(searchParams);
    next.delete('asset_id');
    setSearchParams(next, { replace: true });

    const target = assets.find((a) => String(a.id) === pendingId);
    if (target) {
      setEditingRecord(target);
      setFormData({ ...target });
      setFormOpen(true);
    } else {
      addToast(`Asset #${pendingId} not found`, 'error');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, assets]);

  const openNew = useCallback(() => {
    setEditingRecord(null);
    setFormData({ asset_tag: '', asset_type: 'other', make: '', model: '', serial_number: '', status: 'available', notes: '' });
    setFormOpen(true);
  }, []);

  const openEdit = useCallback((rec: Record<string, any>) => {
    setEditingRecord(rec);
    setFormData({ ...rec });
    setFormOpen(true);
  }, []);

  const closeForm = useCallback(() => {
    setFormOpen(false);
    setEditingRecord(null);
  }, []);

  const handleSave = async () => {
    setSubmitting(true);
    try {
      if (editingRecord) {
        await apiFetch(`/assets/inventory/${editingRecord.id}`, { method: 'PUT', body: JSON.stringify(formData) });
      } else {
        await apiFetch('/assets/inventory', { method: 'POST', body: JSON.stringify(formData) });
      }
      closeForm();
      fetchData();
      addToast(editingRecord ? 'Asset updated' : 'Asset created', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to save asset', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleteSubmitting(true);
    try {
      await apiFetch(`/assets/inventory/${deleteId}`, { method: 'DELETE' });
      setDeleteId(null);
      fetchData();
      addToast('Asset deleted', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally {
      setDeleteSubmitting(false);
    }
  };

  // ── Esc cascade: close newest-open-first ────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (deleteId !== null) { setDeleteId(null); e.stopPropagation(); return; }
      if (formOpen) { closeForm(); e.stopPropagation(); return; }
      if (error) { setError(null); e.stopPropagation(); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteId, formOpen, error]);

  // ── `N` shortcut: open New Asset (when no modal is open, canCreate) ─
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!canCreate || formOpen || deleteId !== null) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openNew(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canCreate, formOpen, deleteId, openNew]);

  // ── Filtered view (search bar) ───────────────────────────────────
  const q = search.trim().toLowerCase();
  const filteredAssets = assets.filter((a) => {
    if (typeFilter !== 'ALL' && a.asset_type !== typeFilter) return false;
    if (statusFilter !== 'ALL' && a.status !== statusFilter) return false;
    if (!q) return true;
    return (
      (a.asset_tag || '').toLowerCase().includes(q) ||
      (a.asset_type || '').toLowerCase().includes(q) ||
      (a.make || '').toLowerCase().includes(q) ||
      (a.model || '').toLowerCase().includes(q) ||
      (a.serial_number || '').toLowerCase().includes(q) ||
      (a.status || '').toLowerCase().includes(q)
    );
  });

  const hasSearch = q.length > 0 || typeFilter !== 'ALL' || statusFilter !== 'ALL';

  const columns = [
    { key: 'asset_tag', label: 'Tag' },
    { key: 'asset_type', label: 'Type' },
    { key: 'make', label: 'Make' },
    { key: 'model', label: 'Model' },
    { key: 'status', label: 'Status' },
    {
      key: 'actions',
      label: '',
      width: '80px',
      render: (row: any) => (
        <div className="flex gap-2">
          {canEdit && (
            <button
              onClick={(e) => { e.stopPropagation(); openEdit(row); }}
              className="text-rmpg-400 hover:text-rmpg-100"
              aria-label="Edit asset"
            >
              <Pencil size={12} />
            </button>
          )}
          {canDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); setDeleteId(row.id); }}
              className="text-red-500 hover:text-red-300"
              aria-label="Delete asset"
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
        <Loader2 className="w-4 h-4 animate-spin" role="status" aria-label="Loading" />
        Loading asset records...
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="ASSET MANAGEMENT" icon={Package}>
        {error && (
          <div className="border border-red-700/40 bg-red-900/20 text-red-400 text-[11px] px-3 py-2 mb-3 flex items-center justify-between" role="alert">
            <span>{error}</span>
            <button type="button" className="toolbar-btn" style={{ height: 26 }} onClick={() => { setLoading(true); fetchData().finally(() => setLoading(false)); }}>Retry</button>
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <input
            className="input-dark text-[11px]"
            style={{ height: 28, padding: '0 8px', width: 180 }}
            placeholder="Search assets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search assets"
          />
          <select aria-label="Filter by type" className="select-dark text-[11px]" style={{ height: 28 }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="ALL">All types</option>
            {['weapon', 'body_camera', 'radio', 'taser', 'computer', 'vehicle_accessory', 'uniform', 'ppe', 'k9_equipment', 'other'].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select aria-label="Filter by status" className="select-dark text-[11px]" style={{ height: 28 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="ALL">All statuses</option>
            {['available', 'issued', 'maintenance', 'retired', 'lost'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button
            type="button"
            className="toolbar-btn"
            style={{ height: 28, padding: '0 10px' }}
            disabled={filteredAssets.length === 0}
            onClick={() => downloadTextFile('assets.csv', assetsToCsv(filteredAssets))}
          >
            CSV
          </button>
          {canCreate && (
            <button
              onClick={openNew}
              className="toolbar-btn flex items-center gap-1.5"
              style={{ height: 28, padding: '0 10px' }}
              title="New Asset (N)"
            >
              <Plus size={13} /> New Asset
            </button>
          )}
        </div>
      </PanelTitleBar>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatsCard icon={Package} label="Total Assets" value={stats.totalAssets} />
        <StatsCard icon={Wrench} label="Issued" value={stats.issuedAssets} />
        <StatsCard icon={Crosshair} label="Weapons" value={stats.totalWeapons} />
        <StatsCard icon={Dog} label="K9 Units" value={stats.activeK9} />
      </div>

      <DataTable
        columns={columns}
        data={filteredAssets}
        emptyMessage={hasSearch ? 'No assets match the search' : 'No assets registered'}
        emptyDescription={
          hasSearch
            ? 'Try a different tag, type, make, model, or status'
            : 'Create the first asset record using the New Asset button above'
        }
        emptyIcon={Package}
        onRowClick={canEdit ? (row) => openEdit(row) : undefined}
        rowContextMenu={(row) => [
          ...(canEdit
            ? [m.action('Open / Edit', () => openEdit(row), { icon: <Pencil size={12} /> }), m.separator()]
            : []),
          m.copyId((row as any).id),
          m.copy('Copy serial', (row as any).serial_number ?? ''),
          ...(canDelete
            ? [m.action('Delete', () => setDeleteId((row as any).id), { danger: true, icon: <Trash2 size={12} /> })]
            : []),
        ]}
      />

      {/* ── Asset form modal ─────────────────────────────────────── */}
      {formOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 overflow-y-auto p-4"
          onClick={closeForm}
          role="dialog"
          aria-modal="true"
          aria-label={editingRecord ? 'Edit Asset' : 'New Asset'}
        >
          <div
            className="bg-surface-raised border border-rmpg-700 p-6 max-w-lg w-full my-auto"
            style={{ borderRadius: 2 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-rmpg-100 mb-4">
              {editingRecord ? 'Edit Asset' : 'New Asset'}
            </h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ff-assetspage-0" className="text-[10px] text-rmpg-400 uppercase font-semibold">
                    Asset Tag <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="ff-assetspage-0"
                    className="input-dark mt-1"
                    value={formData.asset_tag || ''}
                    onChange={(e) => setFormData({ ...formData, asset_tag: e.target.value })}
                    autoFocus
                  />
                </div>
                <div>
                  <label htmlFor="ff-assetspage-1" className="text-[10px] text-rmpg-400 uppercase font-semibold">Type</label>
                  <select
                    id="ff-assetspage-1"
                    className="select-dark mt-1"
                    value={formData.asset_type || 'other'}
                    onChange={(e) => setFormData({ ...formData, asset_type: e.target.value })}
                  >
                    {['weapon', 'body_camera', 'radio', 'taser', 'computer', 'vehicle_accessory', 'uniform', 'ppe', 'k9_equipment', 'other'].map(
                      (t) => <option key={t} value={t}>{t}</option>,
                    )}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ff-assetspage-2" className="text-[10px] text-rmpg-400 uppercase font-semibold">Make</label>
                  <input
                    id="ff-assetspage-2"
                    className="input-dark mt-1"
                    value={formData.make || ''}
                    onChange={(e) => setFormData({ ...formData, make: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor="ff-assetspage-3" className="text-[10px] text-rmpg-400 uppercase font-semibold">Model</label>
                  <input
                    id="ff-assetspage-3"
                    className="input-dark mt-1"
                    value={formData.model || ''}
                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ff-assetspage-4" className="text-[10px] text-rmpg-400 uppercase font-semibold">Serial #</label>
                  <input
                    id="ff-assetspage-4"
                    className="input-dark mt-1"
                    value={formData.serial_number || ''}
                    onChange={(e) => setFormData({ ...formData, serial_number: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor="ff-assetspage-5" className="text-[10px] text-rmpg-400 uppercase font-semibold">Status</label>
                  <select
                    id="ff-assetspage-5"
                    className="select-dark mt-1"
                    value={formData.status || 'available'}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  >
                    {['available', 'issued', 'maintenance', 'retired', 'lost'].map(
                      (s) => <option key={s} value={s}>{s}</option>,
                    )}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="ff-assetspage-6" className="text-[10px] text-rmpg-400 uppercase font-semibold">Notes</label>
                <textarea
                  id="ff-assetspage-6"
                  className="input-dark mt-1 w-full"
                  rows={2}
                  value={formData.notes || ''}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={closeForm} className="toolbar-btn px-4" style={{ height: 28 }}>Cancel</button>
              <button
                onClick={handleSave}
                disabled={submitting || !formData.asset_tag?.trim()}
                className="toolbar-btn toolbar-btn-primary px-4"
                style={{ height: 28 }}
              >
                {submitting
                  ? <><Loader2 className="w-3 h-3 animate-spin inline mr-1" />Saving...</>
                  : editingRecord ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirmation via ConfirmDialog ────────────────── */}
      <ConfirmDialog
        isOpen={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Asset"
        message="This permanently removes the asset record and cannot be undone."
        details={
          deleteId !== null
            ? (() => {
                const rec = assets.find((a) => a.id === deleteId);
                return rec ? <span>{rec.asset_tag} &mdash; {rec.asset_type}{rec.make ? ` (${rec.make})` : ''}</span> : null;
              })()
            : null
        }
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={deleteSubmitting}
      />
    </div>
  );
}
