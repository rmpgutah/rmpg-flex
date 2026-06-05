import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { useToast } from '../components/ToastProvider';
import { useMenuActions } from '../utils/contextMenuActions';
import { Brain, Heart, PhoneCall, Users, Plus, Pencil, Trash2 } from 'lucide-react';

interface CrisisIncident { id: number; incident_number: string; incident_type: string; location: string; subject_name: string; disposition: string; cit_team_used: number; resolved_on_scene: number; diverted: number; notes: string; }
interface CrisisStats { citCalls: number; resolvedOnScene: number; diversionRate: number; teamsAvailable: number; }

const EMPTY_FORM = { incident_number: '', incident_type: 'mental_health', location: '', subject_name: '', disposition: '', cit_team_used: 0, resolved_on_scene: 0, diverted: 0, notes: '' };

export default function CrisisResponsePage() {
  const [incidents, setIncidents] = useState<CrisisIncident[]>([]);
  const [stats, setStats] = useState<CrisisStats>({ citCalls: 0, resolvedOnScene: 0, diversionRate: 0, teamsAvailable: 0 });
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<CrisisIncident | null>(null);
  const [formData, setFormData] = useState<any>(EMPTY_FORM);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const { addToast } = useToast();
  const m = useMenuActions();

  const fetchData = useCallback(async () => {
    try {
      const [i, s] = await Promise.all([
        apiFetch<CrisisIncident[]>('/crisis/incidents').catch(() => []),
        apiFetch<CrisisStats>('/crisis/stats').catch(() => ({ citCalls: 0, resolvedOnScene: 0, diversionRate: 0, teamsAvailable: 0 })),
      ]);
      setIncidents(i); setStats(s);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openNew = () => { setEditingRecord(null); setFormData({ ...EMPTY_FORM }); setFormError(null); setFormOpen(true); };
  const openEdit = (rec: CrisisIncident) => { setEditingRecord(rec); setFormData({ ...rec }); setFormError(null); setFormOpen(true); };

  const handleSave = async () => {
    setFormSubmitting(true); setFormError(null);
    try {
      if (editingRecord) {
        await apiFetch(`/crisis/incidents/${editingRecord.id}`, { method: 'PUT', body: JSON.stringify(formData) });
        addToast('Incident updated', 'success');
      } else {
        await apiFetch('/crisis/incidents', { method: 'POST', body: JSON.stringify(formData) });
        addToast('Incident created', 'success');
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
      await apiFetch(`/crisis/incidents/${deleteId}`, { method: 'DELETE' });
      setDeleteId(null); fetchData();
      addToast('Incident deleted', 'success');
    } catch (err) { addToast(err instanceof Error ? err.message : 'Delete failed', 'error'); }
  };

  const columns = [
    { key: 'incident_number', label: 'Incident #' },
    { key: 'incident_type', label: 'Type', render: (r: CrisisIncident) => r.incident_type?.replace(/_/g, ' ') || '--' },
    { key: 'subject_name', label: 'Subject' },
    { key: 'location', label: 'Location' },
    { key: 'disposition', label: 'Disposition' },
    { key: 'cit_team_used', label: 'CIT', render: (r: CrisisIncident) => r.cit_team_used ? <span className="text-green-400">Yes</span> : <span className="text-rmpg-500">No</span> },
    { key: 'resolved_on_scene', label: 'Resolved', render: (r: CrisisIncident) => r.resolved_on_scene ? <span className="text-green-400">Yes</span> : <span className="text-rmpg-500">No</span> },
    { key: 'actions', label: '', width: '80px', render: (r: CrisisIncident) => (
      <div className="flex gap-2">
        <button onClick={(e) => { e.stopPropagation(); openEdit(r); }} className="text-rmpg-400 hover:text-white" title="Edit"><Pencil size={12} /></button>
        <button onClick={(e) => { e.stopPropagation(); setDeleteId(r.id); }} className="text-red-500 hover:text-red-300" title="Delete"><Trash2 size={12} /></button>
      </div>
    )},
  ];

  if (loading) return <div className="p-6 text-[#888888]">Loading crisis response data...</div>;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="CRISIS RESPONSE" icon={Brain}>
        <button onClick={openNew} className="toolbar-btn flex items-center gap-1.5" style={{ height: 28, padding: '0 10px' }}>
          <Plus size={13} /> New Incident
        </button>
      </PanelTitleBar>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatsCard label="CIT DEPLOYMENTS" value={String(stats.citCalls)} icon={PhoneCall} />
        <StatsCard label="RESOLVED ON SCENE" value={String(stats.resolvedOnScene)} icon={Heart} />
        <StatsCard label="DIVERSION RATE" value={`${stats.diversionRate}%`} icon={Users} />
        <StatsCard label="TEAMS AVAILABLE" value={String(stats.teamsAvailable)} icon={Brain} />
      </div>

      <DataTable
        columns={columns}
        data={incidents}
        emptyMessage="No crisis incidents recorded"
        onRowClick={openEdit}
        rowContextMenu={(row) => [
          m.action('Open / Edit', () => openEdit(row), { icon: <Pencil size={12} /> }),
          m.separator(),
          m.copyId(row.id),
          m.action('Delete', () => setDeleteId(row.id), { danger: true, icon: <Trash2 size={12} /> }),
        ]}
      />

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setFormOpen(false)}>
          <div className="bg-surface-raised border border-rmpg-700 p-6 max-w-lg w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-rmpg-100 mb-4">{editingRecord ? 'Edit Incident' : 'New Incident'}</h3>
            {formError && <div className="text-xs text-red-400 mb-2">{formError}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Incident # *</label><input id="ff-crisisresponsepage-0" value={formData.incident_number} onChange={e => setFormData({...formData, incident_number: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Type</label><select id="ff-crisisresponsepage-1" value={formData.incident_type} onChange={e => setFormData({...formData, incident_type: e.target.value})} className="input-dark w-full mt-1 text-xs"><option value="mental_health">Mental Health</option><option value="suicide_ideation">Suicide Ideation</option><option value="substance_abuse">Substance Abuse</option><option value="domestic">Domestic</option><option value="welfare_check">Welfare Check</option><option value="other">Other</option></select></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Subject</label><input id="ff-crisisresponsepage-2" value={formData.subject_name} onChange={e => setFormData({...formData, subject_name: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Location</label><input id="ff-crisisresponsepage-3" value={formData.location} onChange={e => setFormData({...formData, location: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div className="col-span-2"><label className="text-[9px] text-rmpg-400 uppercase font-bold">Disposition</label><input id="ff-crisisresponsepage-4" value={formData.disposition} onChange={e => setFormData({...formData, disposition: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div className="flex items-center gap-4 col-span-2">
                <label className="flex items-center gap-2 text-[11px] text-rmpg-300"><input id="ff-crisisresponsepage-5" type="checkbox" checked={formData.cit_team_used === 1} onChange={e => setFormData({...formData, cit_team_used: e.target.checked ? 1 : 0})} className="w-3 h-3" /> CIT Team Used</label>
                <label className="flex items-center gap-2 text-[11px] text-rmpg-300"><input id="ff-crisisresponsepage-6" type="checkbox" checked={formData.resolved_on_scene === 1} onChange={e => setFormData({...formData, resolved_on_scene: e.target.checked ? 1 : 0})} className="w-3 h-3" /> Resolved on Scene</label>
                <label className="flex items-center gap-2 text-[11px] text-rmpg-300"><input id="ff-crisisresponsepage-7" type="checkbox" checked={formData.diverted === 1} onChange={e => setFormData({...formData, diverted: e.target.checked ? 1 : 0})} className="w-3 h-3" /> Diverted</label>
              </div>
            </div>
            <div className="mt-3"><label className="text-[9px] text-rmpg-400 uppercase font-bold">Notes</label><textarea id="ff-crisisresponsepage-8" value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} className="input-dark w-full mt-1 text-xs" rows={3} /></div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setFormOpen(false)} className="toolbar-btn px-4" style={{ height: 28 }}>Cancel</button>
              <button onClick={handleSave} disabled={formSubmitting || !formData.incident_number} className="toolbar-btn-primary px-4" style={{ height: 28 }}>{formSubmitting ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {deleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setDeleteId(null)}>
          <div className="bg-surface-raised border border-red-800 p-6 max-w-sm w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-red-400 mb-2">Delete Incident</h3>
            <p className="text-xs text-[#888888] mb-4">This permanently removes this incident record. This cannot be undone.</p>
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
