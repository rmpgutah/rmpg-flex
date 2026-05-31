import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { useToast } from '../components/ToastProvider';
import { Users, Calendar, MessageSquare, Bell, Plus, Pencil, Trash2 } from 'lucide-react';

export default function CommunityPage() {
  const [events, setEvents] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ events: 0, tips: 0, watch_groups: 0, alerts: 0 });
  const [editingRecord, setEditingRecord] = useState<Record<string, any> | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const { addToast } = useToast();

  const fetchData = useCallback(async () => {
    try {
      const r = await apiFetch<{ data: Record<string, any>[] }>('/community/events');
      setEvents(r.data || []);
      const s = await apiFetch<{ events: number; tips: number; watch_groups: number; alerts: number }>('/community/stats');
      setStats(s);
    } catch { /* */ }
  }, []);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);

  const openNew = () => { setEditingRecord(null); setFormData({ event_name: '', event_type: 'other', location: '', start_date: '', status: 'planned', notes: '' }); };
  const openEdit = (rec: Record<string, any>) => { setEditingRecord(rec); setFormData({ ...rec }); };
  const handleSave = async () => {
    setSubmitting(true);
    try {
      if (editingRecord) {
        await apiFetch(`/community/events/${editingRecord.id}`, { method: 'PUT', body: JSON.stringify(formData) });
      } else {
        await apiFetch('/community/events', { method: 'POST', body: JSON.stringify(formData) });
      }
      setEditingRecord(null); fetchData(); addToast(editingRecord ? 'Event updated' : 'Event created', 'success');
    } catch (err) { addToast(err instanceof Error ? err.message : 'Failed', 'error'); }
    finally { setSubmitting(false); }
  };
  const handleDelete = async () => {
    if (!deleteId) return;
    try { await apiFetch(`/community/events/${deleteId}`, { method: 'DELETE' }); setDeleteId(null); fetchData(); addToast('Deleted', 'success'); }
    catch (err) { addToast(err instanceof Error ? err.message : 'Delete failed', 'error'); }
  };

  const showForm = editingRecord !== null;
  const columns = [
    { key: 'event_name', label: 'Event' }, { key: 'event_type', label: 'Type' },
    { key: 'location', label: 'Location' }, { key: 'start_date', label: 'Date' }, { key: 'status', label: 'Status' },
    { key: 'actions', label: '', width: '100px', render: (row: any) => (
      <div className="flex gap-2">
        <button onClick={(e) => { e.stopPropagation(); openEdit(row); }} className="text-rmpg-400 hover:text-white"><Pencil size={12} /></button>
        <button onClick={(e) => { e.stopPropagation(); setDeleteId(row.id); }} className="text-red-500 hover:text-red-300"><Trash2 size={12} /></button>
      </div>
    )},
  ];

  if (loading) return <div className="p-6 text-[#888888]">Loading community records...</div>;
  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="COMMUNITY ENGAGEMENT" icon={Users}>
        <button onClick={openNew} className="toolbar-btn flex items-center gap-1.5" style={{ height: 28, padding: '0 10px' }}><Plus size={13} /> New Event</button>
      </PanelTitleBar>
      <div className="grid grid-cols-4 gap-3">
        <StatsCard icon={Calendar} label="Events" value={stats.events} />
        <StatsCard icon={MessageSquare} label="Public Tips" value={stats.tips} />
        <StatsCard icon={Users} label="Watch Groups" value={stats.watch_groups} />
        <StatsCard icon={Bell} label="Alerts Sent" value={stats.alerts} />
      </div>
      <DataTable columns={columns} data={events} emptyMessage="No community events found" onRowClick={(row) => openEdit(row)} />
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setEditingRecord(null)}>
          <div className="bg-surface-raised border border-[#333] p-6 max-w-lg w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-white mb-4">{editingRecord ? 'Edit Event' : 'New Event'}</h3>
            <div className="space-y-3">
              <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Event Name <span className="text-red-500">*</span></label>
                <input className="input-dark mt-1" value={formData.event_name || ''} onChange={e => setFormData({...formData, event_name: e.target.value})} autoFocus /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Type</label>
                  <select className="select-dark mt-1" value={formData.event_type || 'other'} onChange={e => setFormData({...formData, event_type: e.target.value})}>
                    {['outreach','training','meeting','fundraiser','patrol_ride_along','other'].map(t=><option key={t} value={t}>{t}</option>)}
                  </select></div>
                <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Date</label>
                  <input type="date" className="input-dark mt-1" value={formData.start_date || ''} onChange={e => setFormData({...formData, start_date: e.target.value})} /></div>
              </div>
              <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Location</label>
                <input className="input-dark mt-1" value={formData.location || ''} onChange={e => setFormData({...formData, location: e.target.value})} /></div>
              <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Status</label>
                <select className="select-dark mt-1" value={formData.status || 'planned'} onChange={e => setFormData({...formData, status: e.target.value})}>
                  {['planned','in_progress','completed','cancelled'].map(s=><option key={s} value={s}>{s}</option>)}
                </select></div>
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setEditingRecord(null)} className="toolbar-btn px-4" style={{ height: 28 }}>Cancel</button>
              <button onClick={handleSave} disabled={submitting} className="toolbar-btn-primary px-4" style={{ height: 28 }}>{submitting ? 'Saving...' : editingRecord ? 'Update' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}
      {deleteId !== null && (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setDeleteId(null)}><div className="bg-surface-raised border border-red-800 p-6 max-w-sm w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}><h3 className="text-sm font-bold text-red-400 mb-2">Delete Event</h3><p className="text-xs text-[#888888] mb-4">This permanently removes the event.</p><div className="flex justify-end gap-3"><button onClick={() => setDeleteId(null)} className="toolbar-btn px-4" style={{ height: 28 }}>Cancel</button><button onClick={handleDelete} className="toolbar-btn-primary px-4" style={{ height: 28, borderColor: '#991b1b', color: '#f87171' }}>Delete</button></div></div></div>)}
    </div>
  );
}
