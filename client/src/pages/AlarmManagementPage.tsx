import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { useToast } from '../components/ToastProvider';
import { useMenuActions } from '../utils/contextMenuActions';
import type { ContextMenuItem } from '../context/ContextMenuContext';
import { Bell, AlertTriangle, ShieldCheck, DollarSign, Plus, Pencil, Trash2, Eye } from 'lucide-react';

interface AlarmAccount { id: number; account_number: string; account_name: string; address: string; contact_name: string; contact_phone: string; permit_number: string; permit_status: string; permit_expiry: string; alarm_type: string; false_alarm_count: number; status: string; notes: string; }
interface AlarmStats { totalAlarms: number; falseAlarms: number; permitsActive: number; permitsExpired: number; revenueCollected: number; }

const EMPTY_FORM = { account_number: '', account_name: '', address: '', contact_name: '', contact_phone: '', permit_number: '', permit_status: 'active', permit_expiry: '', alarm_type: 'burglary', false_alarm_count: 0, status: 'active', notes: '' };

export default function AlarmManagementPage() {
  const [accounts, setAccounts] = useState<AlarmAccount[]>([]);
  const [stats, setStats] = useState<AlarmStats>({ totalAlarms: 0, falseAlarms: 0, permitsActive: 0, permitsExpired: 0, revenueCollected: 0 });
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<AlarmAccount | null>(null);
  const [formData, setFormData] = useState<any>(EMPTY_FORM);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const { addToast } = useToast();
  const m = useMenuActions();

  const fetchData = useCallback(async () => {
    try {
      const [a, s] = await Promise.all([
        apiFetch<AlarmAccount[]>('/alarms/accounts').catch(() => []),
        apiFetch<AlarmStats>('/alarms/stats').catch(() => ({ totalAlarms: 0, falseAlarms: 0, permitsActive: 0, permitsExpired: 0, revenueCollected: 0 })),
      ]);
      setAccounts(a); setStats(s);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openNew = () => { setEditingRecord(null); setFormData({ ...EMPTY_FORM }); setFormError(null); setFormOpen(true); };
  const openEdit = (rec: AlarmAccount) => { setEditingRecord(rec); setFormData({ ...rec }); setFormError(null); setFormOpen(true); };

  const handleSave = async () => {
    setFormSubmitting(true); setFormError(null);
    try {
      if (editingRecord) {
        await apiFetch(`/alarms/accounts/${editingRecord.id}`, { method: 'PUT', body: JSON.stringify(formData) });
        addToast('Account updated', 'success');
      } else {
        await apiFetch('/alarms/accounts', { method: 'POST', body: JSON.stringify(formData) });
        addToast('Account created', 'success');
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
      await apiFetch(`/alarms/accounts/${deleteId}`, { method: 'DELETE' });
      setDeleteId(null); fetchData();
      addToast('Account deleted', 'success');
    } catch (err) { addToast(err instanceof Error ? err.message : 'Delete failed', 'error'); }
  };

  const columns = [
    { key: 'account_number', label: 'Account #' },
    { key: 'account_name', label: 'Name' },
    { key: 'address', label: 'Address' },
    { key: 'permit_status', label: 'Permit', render: (r: AlarmAccount) => <span className={`badge ${r.permit_status === 'active' ? 'badge-available' : r.permit_status === 'expired' ? 'badge-busy' : 'badge-pending'}`}>{r.permit_status}</span> },
    { key: 'false_alarm_count', label: 'False Alarms' },
    { key: 'status', label: 'Status', render: (r: AlarmAccount) => <span className={`badge ${r.status === 'active' ? 'badge-available' : 'badge-p4'}`}>{r.status}</span> },
    { key: 'actions', label: '', width: '80px', render: (r: AlarmAccount) => (
      <div className="flex gap-2">
        <button onClick={(e) => { e.stopPropagation(); openEdit(r); }} className="text-rmpg-400 hover:text-white" title="Edit"><Pencil size={12} /></button>
        <button onClick={(e) => { e.stopPropagation(); setDeleteId(r.id); }} className="text-red-500 hover:text-red-300" title="Delete"><Trash2 size={12} /></button>
      </div>
    )},
  ];

  const falseRate = stats.totalAlarms > 0 ? Math.round(stats.falseAlarms / stats.totalAlarms * 100) : 0;

  if (loading) return <div className="p-6 text-[#888888]">Loading alarm data...</div>;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="ALARM MANAGEMENT" icon={Bell}>
        <button onClick={openNew} className="toolbar-btn flex items-center gap-1.5" style={{ height: 28, padding: '0 10px' }}>
          <Plus size={13} /> New Account
        </button>
      </PanelTitleBar>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatsCard label="TOTAL ALARMS" value={String(stats.totalAlarms)} icon={Bell} />
        <StatsCard label="FALSE ALARM RATE" value={`${falseRate}%`} icon={AlertTriangle} />
        <StatsCard label="ACTIVE PERMITS" value={String(stats.permitsActive)} icon={ShieldCheck} />
        <StatsCard label="REVENUE" value={`$${(stats.revenueCollected || 0).toLocaleString()}`} icon={DollarSign} />
      </div>

      <DataTable
        columns={columns}
        data={accounts}
        emptyMessage="No alarm accounts"
        onRowClick={openEdit}
        enableContextMenu
        rowContextMenu={(row: AlarmAccount): ContextMenuItem[] => [
          m.action('Open', () => openEdit(row), { icon: <Eye size={12} /> }),
          m.action('Edit', () => openEdit(row), { icon: <Pencil size={12} /> }),
          m.separator(),
          m.copyId(row.id),
          m.action('Delete', () => setDeleteId(row.id), { danger: true, icon: <Trash2 size={12} /> }),
        ]}
      />

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setFormOpen(false)}>
          <div className="bg-surface-raised border border-rmpg-700 p-6 max-w-lg w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-rmpg-100 mb-4">{editingRecord ? 'Edit Account' : 'New Account'}</h3>
            {formError && <div className="text-xs text-red-400 mb-2">{formError}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Account # *</label><input id="ff-alarmmanagementpage-0" value={formData.account_number} onChange={e => setFormData({...formData, account_number: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Name *</label><input id="ff-alarmmanagementpage-1" value={formData.account_name} onChange={e => setFormData({...formData, account_name: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div className="col-span-2"><label className="text-[9px] text-rmpg-400 uppercase font-bold">Address *</label><input id="ff-alarmmanagementpage-2" value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Contact</label><input id="ff-alarmmanagementpage-3" value={formData.contact_name} onChange={e => setFormData({...formData, contact_name: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Phone</label><input id="ff-alarmmanagementpage-4" value={formData.contact_phone} onChange={e => setFormData({...formData, contact_phone: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Permit #</label><input id="ff-alarmmanagementpage-5" value={formData.permit_number} onChange={e => setFormData({...formData, permit_number: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Permit Status</label><select id="ff-alarmmanagementpage-6" value={formData.permit_status} onChange={e => setFormData({...formData, permit_status: e.target.value})} className="input-dark w-full mt-1 text-xs"><option value="active">Active</option><option value="expired">Expired</option><option value="suspended">Suspended</option><option value="pending">Pending</option></select></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Permit Expiry</label><input id="ff-alarmmanagementpage-7" type="date" value={formData.permit_expiry} onChange={e => setFormData({...formData, permit_expiry: e.target.value})} className="input-dark w-full mt-1 text-xs" /></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Alarm Type</label><select id="ff-alarmmanagementpage-8" value={formData.alarm_type} onChange={e => setFormData({...formData, alarm_type: e.target.value})} className="input-dark w-full mt-1 text-xs"><option value="burglary">Burglary</option><option value="robbery">Robbery</option><option value="panic">Panic</option><option value="fire">Fire</option><option value="medical">Medical</option><option value="other">Other</option></select></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">False Alarms</label><input id="ff-alarmmanagementpage-9" type="number" value={formData.false_alarm_count} onChange={e => setFormData({...formData, false_alarm_count: parseInt(e.target.value) || 0})} className="input-dark w-full mt-1 text-xs" /></div>
              <div><label className="text-[9px] text-rmpg-400 uppercase font-bold">Status</label><select id="ff-alarmmanagementpage-10" value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} className="input-dark w-full mt-1 text-xs"><option value="active">Active</option><option value="inactive">Inactive</option><option value="no_response">No Response</option></select></div>
            </div>
            <div className="mt-3"><label className="text-[9px] text-rmpg-400 uppercase font-bold">Notes</label><textarea id="ff-alarmmanagementpage-11" value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} className="input-dark w-full mt-1 text-xs" rows={3} /></div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setFormOpen(false)} className="toolbar-btn px-4" style={{ height: 28 }}>Cancel</button>
              <button onClick={handleSave} disabled={formSubmitting || !formData.account_number || !formData.account_name || !formData.address} className="toolbar-btn-primary px-4" style={{ height: 28 }}>{formSubmitting ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {deleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setDeleteId(null)}>
          <div className="bg-surface-raised border border-red-800 p-6 max-w-sm w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-red-400 mb-2">Delete Alarm Account</h3>
            <p className="text-xs text-[#888888] mb-4">This permanently removes this alarm account. This cannot be undone.</p>
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
