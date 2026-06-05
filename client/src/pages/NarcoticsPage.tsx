import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { useToast } from '../components/ToastProvider';
import { useMenuActions } from '../utils/contextMenuActions';
import type { ContextMenuItem } from '../context/ContextMenuContext';
import { Pill, TrendingUp, Scale, Shield, DollarSign, Plus, Pencil, Trash2, Eye } from 'lucide-react';

interface NarcCase { id: number; case_number: string; case_type: string; subject_name: string; location: string; substance: string; street_value: number; status: string; priority: string; notes: string; }
interface NarcStats { totalInvestigations: number; totalSeizures: number; totalStreetValue: number; activeCIs: number; }

const EMPTY_FORM = { case_number: '', case_type: 'investigation', subject_name: '', location: '', substance: '', quantity: '', street_value: 0, status: 'open', priority: 'normal', notes: '' };

export default function NarcoticsPage() {
  const [cases, setCases] = useState<NarcCase[]>([]);
  const [stats, setStats] = useState<NarcStats>({ totalInvestigations: 0, totalSeizures: 0, totalStreetValue: 0, activeCIs: 0 });
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<NarcCase | null>(null);
  const [formData, setFormData] = useState<any>(EMPTY_FORM);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const { addToast } = useToast();
  const m = useMenuActions();

  const fetchData = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([
        apiFetch<NarcCase[]>('/narcotics/cases').catch(() => []),
        apiFetch<NarcStats>('/narcotics/stats').catch(() => ({ totalInvestigations: 0, totalSeizures: 0, totalStreetValue: 0, activeCIs: 0 })),
      ]);
      setCases(c); setStats(s);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openNew = () => { setEditingRecord(null); setFormData({ ...EMPTY_FORM }); setFormError(null); setFormOpen(true); };
  const openEdit = (rec: NarcCase) => { setEditingRecord(rec); setFormData({ ...rec }); setFormError(null); setFormOpen(true); };

  const handleSave = async () => {
    setFormSubmitting(true); setFormError(null);
    try {
      if (editingRecord) {
        await apiFetch(`/narcotics/cases/${editingRecord.id}`, { method: 'PUT', body: JSON.stringify(formData) });
        addToast('Case updated', 'success');
      } else {
        await apiFetch('/narcotics/cases', { method: 'POST', body: JSON.stringify(formData) });
        addToast('Case created', 'success');
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
      await apiFetch(`/narcotics/cases/${deleteId}`, { method: 'DELETE' });
      setDeleteId(null); fetchData();
      addToast('Case deleted', 'success');
    } catch (err) { addToast(err instanceof Error ? err.message : 'Delete failed', 'error'); }
  };

  const columns = [
    { key: 'case_number', label: 'Case #' },
    { key: 'case_type', label: 'Type' },
    { key: 'subject_name', label: 'Subject' },
    { key: 'substance', label: 'Substance' },
    { key: 'street_value', label: 'Street Value', render: (r: NarcCase) => `$${(r.street_value || 0).toLocaleString()}` },
    { key: 'status', label: 'Status', render: (r: NarcCase) => <span className={`badge ${r.status === 'open' || r.status === 'active' ? 'badge-p1' : 'badge-p4'}`}>{r.status}</span> },
    { key: 'priority', label: 'Priority' },
    { key: 'actions', label: '', width: '80px', render: (r: NarcCase) => (
      <div className="flex gap-2">
        <button onClick={(e) => { e.stopPropagation(); openEdit(r); }} className="text-rmpg-400 hover:text-white" title="Edit"><Pencil size={12} /></button>
        <button onClick={(e) => { e.stopPropagation(); setDeleteId(r.id); }} className="text-red-500 hover:text-red-300" title="Delete"><Trash2 size={12} /></button>
      </div>
    )},
  ];

  if (loading) return <div className="p-6 text-[#888888]">Loading narcotics data...</div>;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="NARCOTICS & VICE" icon={Pill}>
        <button onClick={openNew} className="toolbar-btn flex items-center gap-1.5" style={{ height: 28, padding: '0 10px' }}>
          <Plus size={13} /> New Case
        </button>
      </PanelTitleBar>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatsCard label="ACTIVE INVESTIGATIONS" value={String(stats.totalInvestigations)} icon={Shield} />
        <StatsCard label="TOTAL SEIZURES" value={String(stats.totalSeizures)} icon={Scale} />
        <StatsCard label="STREET VALUE" value={`$${(stats.totalStreetValue || 0).toLocaleString()}`} icon={DollarSign} />
        <StatsCard label="ACTIVE CIs" value={String(stats.activeCIs)} icon={TrendingUp} />
      </div>

      <DataTable
        columns={columns}
        data={cases}
        emptyMessage="No narcotics cases"
        onRowClick={openEdit}
        rowContextMenu={(r): ContextMenuItem[] => [
          m.action('Open', () => openEdit(r), { icon: <Eye size={12} /> }),
          m.action('Edit', () => openEdit(r), { icon: <Pencil size={12} /> }),
          m.separator(),
          m.copyId(r.id),
          m.action('Delete', () => setDeleteId(r.id), { danger: true, icon: <Trash2 size={12} /> }),
        ]}
      />

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setFormOpen(false)}>
          <div className="bg-surface-raised border border-rmpg-700 p-6 max-w-lg w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-rmpg-100 mb-4">{editingRecord ? 'Edit Case' : 'New Case'}</h3>
            {formError && <div className="text-xs text-red-400 mb-2">{formError}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Case # *</label><input id="ff-narcoticspage-0" value={formData.case_number} onChange={e => setFormData({...formData, case_number: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Type</label><select id="ff-narcoticspage-1" value={formData.case_type} onChange={e => setFormData({...formData, case_type: e.target.value})} className="input-dark w-full mt-1 text-xs"><option value="investigation">Investigation</option><option value="buy_bust">Buy Bust</option><option value="ci_management">CI Management</option><option value="surveillance">Surveillance</option><option value="other">Other</option></select></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Subject</label><input id="ff-narcoticspage-2" value={formData.subject_name} onChange={e => setFormData({...formData, subject_name: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Location</label><input id="ff-narcoticspage-3" value={formData.location} onChange={e => setFormData({...formData, location: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Substance</label><input id="ff-narcoticspage-4" value={formData.substance} onChange={e => setFormData({...formData, substance: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Quantity</label><input id="ff-narcoticspage-5" value={formData.quantity} onChange={e => setFormData({...formData, quantity: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Street Value</label><input id="ff-narcoticspage-6" type="number" value={formData.street_value} onChange={e => setFormData({...formData, street_value: parseFloat(e.target.value) || 0})} className="input-dark w-full mt-1 text-xs" /></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Status</label><select id="ff-narcoticspage-7" value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} className="input-dark w-full mt-1 text-xs"><option value="open">Open</option><option value="active">Active</option><option value="closed">Closed</option><option value="pending_review">Pending Review</option></select></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Priority</label><select id="ff-narcoticspage-8" value={formData.priority} onChange={e => setFormData({...formData, priority: e.target.value})} className="input-dark w-full mt-1 text-xs"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
            </div>
            <div className="mt-3"><label className="text-[9px] text-rmpg-400 uppercase font-bold">Notes</label><textarea id="ff-narcoticspage-9" value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} className="input-dark w-full mt-1 text-xs" rows={3} /></div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setFormOpen(false)} className="toolbar-btn px-4" style={{ height: 28 }}>Cancel</button>
              <button onClick={handleSave} disabled={formSubmitting || !formData.case_number} className="toolbar-btn-primary px-4" style={{ height: 28 }}>{formSubmitting ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {deleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setDeleteId(null)}>
          <div className="bg-surface-raised border border-red-800 p-6 max-w-sm w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-red-400 mb-2">Delete Case</h3>
            <p className="text-xs text-[#888888] mb-4">This permanently removes this case. This cannot be undone.</p>
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
