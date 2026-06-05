import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { useToast } from '../components/ToastProvider';
import { useMenuActions } from '../utils/contextMenuActions';
import { Swords, Shield, Wrench, AlertTriangle, Plus, Pencil, Trash2 } from 'lucide-react';

interface Callout { id: number; date: string; call_type: string; location: string; resolution: string; duration_minutes: number; team_size: number; notes: string; }
interface Equipment { id: number; equipment_type: string; serial_number: string; condition: string; assigned_to: string; notes: string; }
interface Stats { totalCallouts: number; totalEquipment: number; readyEquipment: number; }

const EMPTY_CALLOUT = { date: new Date().toISOString().slice(0, 16), call_type: '', location: '', resolution: '', duration_minutes: 0, team_size: 0, notes: '' };
const EMPTY_EQUIPMENT = { equipment_type: '', serial_number: '', condition: 'ready', assigned_to: '', notes: '' };

export default function SpecialOpsPage() {
  const [callouts, setCallouts] = useState<Callout[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [stats, setStats] = useState<Stats>({ totalCallouts: 0, totalEquipment: 0, readyEquipment: 0 });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'callouts' | 'equipment'>('callouts');
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<any>(null);
  const [formData, setFormData] = useState<any>(EMPTY_CALLOUT);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const { addToast } = useToast();
  const m = useMenuActions();

  const fetchData = useCallback(async () => {
    try {
      const [c, e, s] = await Promise.all([
        apiFetch<Callout[]>('/special-ops/callouts').catch(() => []),
        apiFetch<Equipment[]>('/special-ops/equipment').catch(() => []),
        apiFetch<Stats>('/special-ops/stats').catch(() => ({ totalCallouts: 0, totalEquipment: 0, readyEquipment: 0 })),
      ]);
      setCallouts(c); setEquipment(e); setStats(s);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openNew = () => {
    setEditingRecord(null);
    setFormData(tab === 'callouts' ? { ...EMPTY_CALLOUT } : { ...EMPTY_EQUIPMENT });
    setFormError(null); setFormOpen(true);
  };
  const openEdit = (rec: any) => {
    setEditingRecord(rec); setFormData({ ...rec }); setFormError(null); setFormOpen(true);
  };

  const handleSave = async () => {
    setFormSubmitting(true); setFormError(null);
    const endpoint = tab === 'callouts' ? '/special-ops/callouts' : '/special-ops/equipment';
    try {
      if (editingRecord) {
        await apiFetch(`${endpoint}/${editingRecord.id}`, { method: 'PUT', body: JSON.stringify(formData) });
        addToast('Record updated', 'success');
      } else {
        await apiFetch(endpoint, { method: 'POST', body: JSON.stringify(formData) });
        addToast('Record created', 'success');
      }
      setFormOpen(false); fetchData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setFormError(msg); addToast(msg, 'error');
    } finally { setFormSubmitting(false); }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const endpoint = tab === 'callouts' ? '/special-ops/callouts' : '/special-ops/equipment';
    try {
      await apiFetch(`${endpoint}/${deleteId}`, { method: 'DELETE' });
      setDeleteId(null); fetchData();
      addToast('Record deleted', 'success');
    } catch (err) { addToast(err instanceof Error ? err.message : 'Delete failed', 'error'); }
  };

  const calloutColumns = [
    { key: 'date', label: 'Date', render: (r: Callout) => r.date?.slice(0, 10) || '--' },
    { key: 'call_type', label: 'Type' },
    { key: 'location', label: 'Location' },
    { key: 'resolution', label: 'Resolution' },
    { key: 'duration_minutes', label: 'Duration', render: (r: Callout) => r.duration_minutes ? `${r.duration_minutes}m` : '--' },
    { key: 'actions', label: '', width: '80px', render: (r: Callout) => (
      <div className="flex gap-2">
        <button onClick={(e) => { e.stopPropagation(); openEdit(r); }} className="text-rmpg-400 hover:text-white" title="Edit"><Pencil size={12} /></button>
        <button onClick={(e) => { e.stopPropagation(); setDeleteId(r.id); }} className="text-red-500 hover:text-red-300" title="Delete"><Trash2 size={12} /></button>
      </div>
    )},
  ];

  const equipmentColumns = [
    { key: 'equipment_type', label: 'Type' },
    { key: 'serial_number', label: 'Serial #', render: (r: Equipment) => <span className="font-mono text-rmpg-400">{r.serial_number || '--'}</span> },
    { key: 'condition', label: 'Condition', render: (r: Equipment) => <span className={`badge ${r.condition === 'ready' ? 'badge-available' : r.condition === 'repair' ? 'badge-busy' : 'badge-pending'}`}>{r.condition}</span> },
    { key: 'assigned_to', label: 'Assigned To' },
    { key: 'actions', label: '', width: '80px', render: (r: Equipment) => (
      <div className="flex gap-2">
        <button onClick={(e) => { e.stopPropagation(); openEdit(r); }} className="text-rmpg-400 hover:text-white" title="Edit"><Pencil size={12} /></button>
        <button onClick={(e) => { e.stopPropagation(); setDeleteId(r.id); }} className="text-red-500 hover:text-red-300" title="Delete"><Trash2 size={12} /></button>
      </div>
    )},
  ];

  if (loading) return <div className="p-6 text-[#888888]">Loading special operations...</div>;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="SPECIAL OPERATIONS" icon={Swords}>
        <button onClick={openNew} className="toolbar-btn flex items-center gap-1.5" style={{ height: 28, padding: '0 10px' }}>
          <Plus size={13} /> {tab === 'callouts' ? 'New Callout' : 'New Equipment'}
        </button>
      </PanelTitleBar>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatsCard label="TOTAL CALLOUTS" value={String(stats.totalCallouts)} icon={AlertTriangle} />
        <StatsCard label="EQUIPMENT ITEMS" value={String(stats.totalEquipment)} icon={Wrench} />
        <StatsCard label="READY RATE" value={`${stats.totalEquipment > 0 ? Math.round(stats.readyEquipment / stats.totalEquipment * 100) : 100}%`} icon={Shield} />
        <StatsCard label="STATUS" value="STANDBY" icon={Swords} />
      </div>

      <div className="flex gap-2">
        <button onClick={() => setTab('callouts')} className={`text-[10px] px-3 py-1 ${tab === 'callouts' ? 'toolbar-btn-primary' : 'toolbar-btn'}`}>Callouts</button>
        <button onClick={() => setTab('equipment')} className={`text-[10px] px-3 py-1 ${tab === 'equipment' ? 'toolbar-btn-primary' : 'toolbar-btn'}`}>Equipment</button>
      </div>

      {tab === 'callouts' ? (
        <DataTable
          columns={calloutColumns}
          data={callouts}
          emptyMessage="No callouts recorded"
          onRowClick={openEdit}
          rowContextMenu={(row) => [
            m.action('Open / Edit', () => openEdit(row), { icon: <Pencil size={12} /> }),
            m.separator(),
            m.copyId(row.id),
            m.action('Delete', () => setDeleteId(row.id), { danger: true, icon: <Trash2 size={12} /> }),
          ]}
        />
      ) : (
        <DataTable
          columns={equipmentColumns}
          data={equipment}
          emptyMessage="No equipment in inventory"
          onRowClick={openEdit}
          rowContextMenu={(row) => [
            m.action('Open / Edit', () => openEdit(row), { icon: <Pencil size={12} /> }),
            m.separator(),
            m.copy('Copy serial #', row.serial_number),
            m.copyId(row.id),
            m.action('Delete', () => setDeleteId(row.id), { danger: true, icon: <Trash2 size={12} /> }),
          ]}
        />
      )}

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setFormOpen(false)}>
          <div className="bg-surface-raised border border-rmpg-700 p-6 max-w-lg w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-rmpg-100 mb-4">{editingRecord ? 'Edit' : 'New'} {tab === 'callouts' ? 'Callout' : 'Equipment'}</h3>
            {formError && <div className="text-xs text-red-400 mb-2">{formError}</div>}
            {tab === 'callouts' ? (
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Date</label><input id="ff-specialopspage-0" type="datetime-local" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
                <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Type *</label><input id="ff-specialopspage-1" value={formData.call_type} onChange={e => setFormData({...formData, call_type: e.target.value})} className="input-dark w-full mt-1 text-xs" placeholder="e.g. SWAT, K9, EOD" /></div>
                <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Location</label><input id="ff-specialopspage-2" value={formData.location} onChange={e => setFormData({...formData, location: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
                <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Resolution</label><input id="ff-specialopspage-3" value={formData.resolution} onChange={e => setFormData({...formData, resolution: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
                <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Duration (min)</label><input id="ff-specialopspage-4" type="number" value={formData.duration_minutes} onChange={e => setFormData({...formData, duration_minutes: parseInt(e.target.value) || 0})} className="input-dark w-full mt-1 text-xs" /></div>
                <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Team Size</label><input id="ff-specialopspage-5" type="number" value={formData.team_size} onChange={e => setFormData({...formData, team_size: parseInt(e.target.value) || 0})} className="input-dark w-full mt-1 text-xs" /></div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Type *</label><input id="ff-specialopspage-6" value={formData.equipment_type} onChange={e => setFormData({...formData, equipment_type: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
                <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Serial #</label><input id="ff-specialopspage-7" value={formData.serial_number} onChange={e => setFormData({...formData, serial_number: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
                <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Condition</label><select id="ff-specialopspage-8" value={formData.condition} onChange={e => setFormData({...formData, condition: e.target.value})} className="input-dark w-full mt-1 text-xs"><option value="ready">Ready</option><option value="repair">Repair</option><option value="retired">Retired</option><option value="lost">Lost</option></select></div>
                <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Assigned To</label><input id="ff-specialopspage-9" value={formData.assigned_to} onChange={e => setFormData({...formData, assigned_to: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              </div>
            )}
            <div className="mt-3"><label className="text-[9px] text-rmpg-400 uppercase font-bold">Notes</label><textarea id="ff-specialopspage-10" value={formData.notes || ''} onChange={e => setFormData({...formData, notes: e.target.value})} className="input-dark w-full mt-1 text-xs" rows={3} /></div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setFormOpen(false)} className="toolbar-btn px-4" style={{ height: 28 }}>Cancel</button>
              <button onClick={handleSave} disabled={formSubmitting || (tab === 'callouts' ? !formData.call_type : !formData.equipment_type)} className="toolbar-btn-primary px-4" style={{ height: 28 }}>{formSubmitting ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {deleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setDeleteId(null)}>
          <div className="bg-surface-raised border border-red-800 p-6 max-w-sm w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-red-400 mb-2">Delete Record</h3>
            <p className="text-xs text-[#888888] mb-4">This permanently removes this record. This cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteId(null)} className="toolbar-btn px-4" style={{ height: 28 }}>Cancel</button>
              <button onClick={handleDelete} className="toolbar-btn-primary px-4 text-red-400 border-red-800" style={{ height: 28, borderColor: '#991b1b' }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
