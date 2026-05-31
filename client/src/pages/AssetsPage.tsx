import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { useToast } from '../components/ToastProvider';
import { Package, Wrench, Crosshair, Dog, Plus, Pencil, Trash2 } from 'lucide-react';

export default function AssetsPage() {
  const [assets, setAssets] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ totalAssets: 0, issuedAssets: 0, totalWeapons: 0, activeK9: 0 });
  const [editingRecord, setEditingRecord] = useState<Record<string, any> | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const { addToast } = useToast();

  const fetchData = useCallback(async () => {
    try {
      const r = await apiFetch<{ data: Record<string, any>[] }>('/assets/inventory');
      setAssets(r.data || []);
      const s = await apiFetch<{ totalAssets: number; issuedAssets: number; totalWeapons: number; activeK9: number }>('/assets/stats');
      setStats(s);
    } catch { /* */ }
  }, []);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);

  const openNew = () => { setEditingRecord(null); setFormData({ asset_tag: '', asset_type: 'other', make: '', model: '', serial_number: '', status: 'available', notes: '' }); };
  const openEdit = (rec: Record<string, any>) => { setEditingRecord(rec); setFormData({ ...rec }); };

  const handleSave = async () => {
    setSubmitting(true);
    try {
      if (editingRecord) {
        await apiFetch(`/assets/inventory/${editingRecord.id}`, { method: 'PUT', body: JSON.stringify(formData) });
      } else {
        await apiFetch('/assets/inventory', { method: 'POST', body: JSON.stringify(formData) });
      }
      setEditingRecord(null); fetchData(); addToast(editingRecord ? 'Asset updated' : 'Asset created', 'success');
    } catch (err) { addToast(err instanceof Error ? err.message : 'Failed', 'error'); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try { await apiFetch(`/assets/inventory/${deleteId}`, { method: 'DELETE' }); setDeleteId(null); fetchData(); addToast('Asset deleted', 'success'); }
    catch (err) { addToast(err instanceof Error ? err.message : 'Delete failed', 'error'); }
  };

  const showForm = editingRecord !== null;

  const columns = [
    { key: 'asset_tag', label: 'Tag' }, { key: 'asset_type', label: 'Type' },
    { key: 'make', label: 'Make' }, { key: 'status', label: 'Status' },
    { key: 'actions', label: '', width: '100px', render: (row: any) => (
      <div className="flex gap-2">
        <button onClick={(e) => { e.stopPropagation(); openEdit(row); }} className="text-rmpg-400 hover:text-white"><Pencil size={12} /></button>
        <button onClick={(e) => { e.stopPropagation(); setDeleteId(row.id); }} className="text-red-500 hover:text-red-300"><Trash2 size={12} /></button>
      </div>
    )},
  ];

  if (loading) return <div className="p-6 text-[#888888]">Loading asset records...</div>;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="ASSET MANAGEMENT" icon={Package}>
        <button onClick={openNew} className="toolbar-btn flex items-center gap-1.5" style={{ height: 28, padding: '0 10px' }}>
          <Plus size={13} /> New Asset
        </button>
      </PanelTitleBar>
      <div className="grid grid-cols-4 gap-3">
        <StatsCard icon={Package} label="Total Assets" value={stats.totalAssets} />
        <StatsCard icon={Wrench} label="Issued" value={stats.issuedAssets} />
        <StatsCard icon={Crosshair} label="Weapons" value={stats.totalWeapons} />
        <StatsCard icon={Dog} label="K9 Units" value={stats.activeK9} />
      </div>
      <DataTable columns={columns} data={assets} emptyMessage="No assets registered" onRowClick={(row) => openEdit(row)} />

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setEditingRecord(null)}>
          <div className="bg-surface-raised border border-[#333] p-6 max-w-lg w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-white mb-4">{editingRecord ? 'Edit Asset' : 'New Asset'}</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Asset Tag <span className="text-red-500">*</span></label>
                  <input className="input-dark mt-1" value={formData.asset_tag || ''} onChange={e => setFormData({...formData, asset_tag: e.target.value})} autoFocus /></div>
                <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Type</label>
                  <select className="select-dark mt-1" value={formData.asset_type || 'other'} onChange={e => setFormData({...formData, asset_type: e.target.value})}>
                    {['weapon','body_camera','radio','taserr','computer','vehicle_accessory','uniform','ppe','k9_equipment','other'].map(t=><option key={t} value={t}>{t}</option>)}
                  </select></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Make</label><input className="input-dark mt-1" value={formData.make || ''} onChange={e => setFormData({...formData, make: e.target.value})} /></div>
                <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Model</label><input className="input-dark mt-1" value={formData.model || ''} onChange={e => setFormData({...formData, model: e.target.value})} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Serial #</label><input className="input-dark mt-1" value={formData.serial_number || ''} onChange={e => setFormData({...formData, serial_number: e.target.value})} /></div>
                <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Status</label>
                  <select className="select-dark mt-1" value={formData.status || 'available'} onChange={e => setFormData({...formData, status: e.target.value})}>
                    {['available','issued','maintenance','retired','lost'].map(s=><option key={s} value={s}>{s}</option>)}
                  </select></div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setEditingRecord(null)} className="toolbar-btn px-4" style={{ height: 28 }}>Cancel</button>
              <button onClick={handleSave} disabled={submitting} className="toolbar-btn-primary px-4" style={{ height: 28 }}>{submitting ? 'Saving...' : editingRecord ? 'Update' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}

      {deleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setDeleteId(null)}>
          <div className="bg-surface-raised border border-red-800 p-6 max-w-sm w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-red-400 mb-2">Delete Asset</h3>
            <p className="text-xs text-[#888888] mb-4">This permanently removes the asset record.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteId(null)} className="toolbar-btn px-4" style={{ height: 28 }}>Cancel</button>
              <button onClick={handleDelete} className="toolbar-btn-primary px-4" style={{ height: 28, borderColor: '#991b1b', color: '#f87171' }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
