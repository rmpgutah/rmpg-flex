import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { useToast } from '../components/ToastProvider';
import { useMenuActions } from '../utils/contextMenuActions';
import type { ContextMenuItem } from '../context/ContextMenuContext';
import { ShieldAlert, Users, SprayCanIcon as Spray, TrendingUp, Plus, Pencil, Trash2, Eye } from 'lucide-react';

interface GangMember { id: number; name: string; moniker: string; gang_name: string; status: string; threat_level: string; notes: string; }
interface Gang { id: number; name: string; colors: string; member_count: number; threat_level: string; territory: string; notes: string; }
interface Stats { totalMembers: number; activeMembers: number; totalGangs: number; }

const EMPTY_MEMBER = { name: '', moniker: '', gang_name: '', status: 'active', threat_level: 'low', notes: '' };
const EMPTY_GANG = { name: '', colors: '', member_count: 0, threat_level: 'low', territory: '', notes: '' };

export default function GangIntelPage() {
  const [members, setMembers] = useState<GangMember[]>([]);
  const [gangs, setGangs] = useState<Gang[]>([]);
  const [stats, setStats] = useState<Stats>({ totalMembers: 0, activeMembers: 0, totalGangs: 0 });
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<GangMember | null>(null);
  const [formData, setFormData] = useState<any>(EMPTY_MEMBER);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const { addToast } = useToast();
  const m = useMenuActions();

  const fetchData = useCallback(async () => {
    try {
      const [m, g, s] = await Promise.all([
        apiFetch<GangMember[]>('/gang-intel').catch(() => []),
        apiFetch<Gang[]>('/gang-intel/gangs').catch(() => []),
        apiFetch<Stats>('/gang-intel/stats').catch(() => ({ totalMembers: 0, activeMembers: 0, totalGangs: 0 })),
      ]);
      setMembers(m); setGangs(g); setStats(s);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openNew = () => { setEditingRecord(null); setFormData({ ...EMPTY_MEMBER }); setFormError(null); setFormOpen(true); };
  const openEdit = (rec: GangMember) => { setEditingRecord(rec); setFormData({ ...rec }); setFormError(null); setFormOpen(true); };

  const handleSave = async () => {
    setFormSubmitting(true); setFormError(null);
    try {
      if (editingRecord) {
        await apiFetch(`/gang-intel/${editingRecord.id}`, { method: 'PUT', body: JSON.stringify(formData) });
        addToast('Member updated', 'success');
      } else {
        await apiFetch('/gang-intel', { method: 'POST', body: JSON.stringify(formData) });
        addToast('Member added', 'success');
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
      await apiFetch(`/gang-intel/${deleteId}`, { method: 'DELETE' });
      setDeleteId(null); fetchData();
      addToast('Member deleted', 'success');
    } catch (err) { addToast(err instanceof Error ? err.message : 'Delete failed', 'error'); }
  };

  const memberColumns = [
    { key: 'name', label: 'Name' },
    { key: 'moniker', label: 'Moniker', render: (r: GangMember) => r.moniker || '--' },
    { key: 'gang_name', label: 'Gang' },
    { key: 'status', label: 'Status', render: (r: GangMember) => <span className={`badge ${r.status === 'active' ? 'badge-p1' : 'badge-p4'}`}>{r.status}</span> },
    { key: 'threat_level', label: 'Threat', render: (r: GangMember) => <span className={`badge ${r.threat_level === 'critical' ? 'badge-p1' : r.threat_level === 'high' ? 'badge-p2' : 'badge-p3'}`}>{r.threat_level}</span> },
    { key: 'actions', label: '', width: '80px', render: (r: GangMember) => (
      <div className="flex gap-2">
        <button onClick={(e) => { e.stopPropagation(); openEdit(r); }} className="text-rmpg-400 hover:text-white" title="Edit"><Pencil size={12} /></button>
        <button onClick={(e) => { e.stopPropagation(); setDeleteId(r.id); }} className="text-red-500 hover:text-red-300" title="Delete"><Trash2 size={12} /></button>
      </div>
    )},
  ];

  if (loading) return <div className="p-6 text-[#888888]">Loading gang intelligence...</div>;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="GANG INTELLIGENCE" icon={ShieldAlert}>
        <button onClick={openNew} className="toolbar-btn flex items-center gap-1.5" style={{ height: 28, padding: '0 10px' }}>
          <Plus size={13} /> New Member
        </button>
      </PanelTitleBar>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatsCard label="TOTAL MEMBERS" value={String(stats.totalMembers)} icon={Users} />
        <StatsCard label="ACTIVE" value={String(stats.activeMembers)} icon={TrendingUp} />
        <StatsCard label="GANGS TRACKED" value={String(stats.totalGangs)} icon={Spray} />
        <StatsCard label="THREAT LEVEL" value="MEDIUM" icon={ShieldAlert} />
      </div>

      <DataTable
        columns={memberColumns}
        data={members}
        emptyMessage="No gang members tracked"
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
            <h3 className="text-sm font-bold text-rmpg-100 mb-4">{editingRecord ? 'Edit Member' : 'New Member'}</h3>
            {formError && <div className="text-xs text-red-400 mb-2">{formError}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Name *</label><input id="ff-gangintelpage-0" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Moniker</label><input id="ff-gangintelpage-1" value={formData.moniker} onChange={e => setFormData({...formData, moniker: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Gang</label><input id="ff-gangintelpage-2" value={formData.gang_name} onChange={e => setFormData({...formData, gang_name: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Status</label><select id="ff-gangintelpage-3" value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} className="input-dark w-full mt-1 text-xs"><option value="active">Active</option><option value="inactive">Inactive</option><option value="incarcerated">Incarcerated</option><option value="deceased">Deceased</option></select></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Threat Level</label><select id="ff-gangintelpage-4" value={formData.threat_level} onChange={e => setFormData({...formData, threat_level: e.target.value})} className="input-dark w-full mt-1 text-xs"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></div>
            </div>
            <div className="mt-3"><label className="text-[9px] text-rmpg-400 uppercase font-bold">Notes</label><textarea id="ff-gangintelpage-5" value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} className="input-dark w-full mt-1 text-xs" rows={3} /></div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setFormOpen(false)} className="toolbar-btn px-4" style={{ height: 28 }}>Cancel</button>
              <button onClick={handleSave} disabled={formSubmitting || !formData.name} className="toolbar-btn-primary px-4" style={{ height: 28 }}>{formSubmitting ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {deleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setDeleteId(null)}>
          <div className="bg-surface-raised border border-red-800 p-6 max-w-sm w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-red-400 mb-2">Delete Member</h3>
            <p className="text-xs text-[#888888] mb-4">This permanently removes this member record. This cannot be undone.</p>
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
