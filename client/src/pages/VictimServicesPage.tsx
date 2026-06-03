import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { useToast } from '../components/ToastProvider';
import { useMenuActions } from '../utils/contextMenuActions';
import { Heart, Shield, Phone, FileText, Plus, Pencil, Trash2, Users, Eye } from 'lucide-react';

interface Victim { id: number; victim_name: string; case_number: string; crime_type: string; status: string; phone: string; email: string; safety_plan: number; protective_order: number; notes: string; }
interface Stats { totalVictims: number; activeVictims: number; safetyPlans: number; }

const EMPTY_FORM = { victim_name: '', case_number: '', crime_type: '', status: 'active', phone: '', email: '', address: '', safety_plan: 0, protective_order: 0, notes: '' };

export default function VictimServicesPage() {
  const [victims, setVictims] = useState<Victim[]>([]);
  const [stats, setStats] = useState<Stats>({ totalVictims: 0, activeVictims: 0, safetyPlans: 0 });
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Victim | null>(null);
  const [formData, setFormData] = useState<any>(EMPTY_FORM);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const { addToast } = useToast();
  const m = useMenuActions();

  const fetchData = useCallback(async () => {
    try {
      const [v, s] = await Promise.all([
        apiFetch<Victim[]>('/victim-services/victims').catch(() => []),
        apiFetch<Stats>('/victim-services/stats').catch(() => ({ totalVictims: 0, activeVictims: 0, safetyPlans: 0 })),
      ]);
      setVictims(v); setStats(s);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openNew = () => { setEditingRecord(null); setFormData({ ...EMPTY_FORM }); setFormError(null); setFormOpen(true); };
  const openEdit = (rec: Victim) => { setEditingRecord(rec); setFormData({ ...rec }); setFormError(null); setFormOpen(true); };

  const handleSave = async () => {
    setFormSubmitting(true); setFormError(null);
    try {
      if (editingRecord) {
        await apiFetch(`/victim-services/victims/${editingRecord.id}`, { method: 'PUT', body: JSON.stringify(formData) });
        addToast('Record updated', 'success');
      } else {
        await apiFetch('/victim-services/victims', { method: 'POST', body: JSON.stringify(formData) });
        addToast('Victim added', 'success');
      }
      setFormOpen(false); fetchData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setFormError(msg); addToast(msg, 'error');
    } finally { setFormSubmitting(false); }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await apiFetch(`/victim-services/victims/${deleteId}`, { method: 'DELETE' });
      setDeleteId(null); fetchData();
      addToast('Record deleted', 'success');
    } catch (err) { addToast(err instanceof Error ? err.message : 'Delete failed', 'error'); }
  };

  const columns = [
    { key: 'victim_name', label: 'Name' },
    { key: 'case_number', label: 'Case #' },
    { key: 'crime_type', label: 'Crime Type' },
    { key: 'status', label: 'Status', render: (r: Victim) => <span className={`badge ${r.status === 'active' ? 'badge-p1' : 'badge-p4'}`}>{r.status}</span> },
    { key: 'safety_plan', label: 'Safety Plan', render: (r: Victim) => r.safety_plan ? <span className="text-green-400">Yes</span> : <span className="text-rmpg-500">No</span> },
    { key: 'protective_order', label: 'PO', render: (r: Victim) => r.protective_order ? <span className="text-green-400">Yes</span> : <span className="text-rmpg-500">No</span> },
    { key: 'actions', label: '', width: '80px', render: (r: Victim) => (
      <div className="flex gap-2">
        <button onClick={(e) => { e.stopPropagation(); openEdit(r); }} className="text-rmpg-400 hover:text-white" title="Edit"><Pencil size={12} /></button>
        <button onClick={(e) => { e.stopPropagation(); setDeleteId(r.id); }} className="text-red-500 hover:text-red-300" title="Delete"><Trash2 size={12} /></button>
      </div>
    )},
  ];

  if (loading) return <div className="p-6 text-[#888888]">Loading victim services...</div>;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="VICTIM SERVICES" icon={Heart}>
        <button onClick={openNew} className="toolbar-btn flex items-center gap-1.5" style={{ height: 28, padding: '0 10px' }}>
          <Plus size={13} /> New Victim
        </button>
      </PanelTitleBar>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatsCard label="TOTAL VICTIMS" value={String(stats.totalVictims)} icon={Users} />
        <StatsCard label="ACTIVE CASES" value={String(stats.activeVictims)} icon={Shield} />
        <StatsCard label="SAFETY PLANS" value={String(stats.safetyPlans)} icon={Heart} />
        <StatsCard label="STATUS" value="OPERATIONAL" icon={FileText} />
      </div>

      <DataTable
        columns={columns}
        data={victims}
        emptyMessage="No victim records"
        onRowClick={openEdit}
        rowContextMenu={(row) => [
          m.action('Open / edit', () => openEdit(row), { icon: <Eye size={12} /> }),
          m.separator(),
          m.copy('Copy name', row.victim_name),
          m.copy('Copy phone', row.phone, <Phone size={12} />),
          m.copyId(row.id),
          m.separator(),
          m.action('Delete', () => setDeleteId(row.id), { danger: true, icon: <Trash2 size={12} /> }),
        ]}
      />

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setFormOpen(false)}>
          <div className="bg-surface-raised border border-rmpg-700 p-6 max-w-lg w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-rmpg-100 mb-4">{editingRecord ? 'Edit Victim' : 'New Victim'}</h3>
            {formError && <div className="text-xs text-red-400 mb-2">{formError}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Name *</label><input id="ff-victimservicespage-0" value={formData.victim_name} onChange={e => setFormData({...formData, victim_name: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Case #</label><input id="ff-victimservicespage-1" value={formData.case_number} onChange={e => setFormData({...formData, case_number: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Crime Type</label><input id="ff-victimservicespage-2" value={formData.crime_type} onChange={e => setFormData({...formData, crime_type: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Status</label><select id="ff-victimservicespage-3" value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} className="input-dark w-full mt-1 text-xs"><option value="active">Active</option><option value="closed">Closed</option><option value="referred">Referred</option><option value="pending">Pending</option></select></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Phone</label><input id="ff-victimservicespage-4" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Email</label><input id="ff-victimservicespage-5" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div className="col-span-2"><label className="text-[9px] text-rmpg-400 uppercase font-bold">Address</label><input id="ff-victimservicespage-6" value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div className="flex items-center gap-4 col-span-2">
                <label className="flex items-center gap-2 text-[11px] text-rmpg-300"><input id="ff-victimservicespage-7" type="checkbox" checked={formData.safety_plan === 1} onChange={e => setFormData({...formData, safety_plan: e.target.checked ? 1 : 0})} className="w-3 h-3" /> Safety Plan</label>
                <label className="flex items-center gap-2 text-[11px] text-rmpg-300"><input id="ff-victimservicespage-8" type="checkbox" checked={formData.protective_order === 1} onChange={e => setFormData({...formData, protective_order: e.target.checked ? 1 : 0})} className="w-3 h-3" /> Protective Order</label>
              </div>
            </div>
            <div className="mt-3"><label className="text-[9px] text-rmpg-400 uppercase font-bold">Notes</label><textarea id="ff-victimservicespage-9" value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} className="input-dark w-full mt-1 text-xs" rows={3} /></div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setFormOpen(false)} className="toolbar-btn px-4" style={{ height: 28 }}>Cancel</button>
              <button onClick={handleSave} disabled={formSubmitting || !formData.victim_name} className="toolbar-btn-primary px-4" style={{ height: 28 }}>{formSubmitting ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {deleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setDeleteId(null)}>
          <div className="bg-surface-raised border border-red-800 p-6 max-w-sm w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-red-400 mb-2">Delete Victim Record</h3>
            <p className="text-xs text-[#888888] mb-4">This permanently removes this victim record. This cannot be undone.</p>
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
