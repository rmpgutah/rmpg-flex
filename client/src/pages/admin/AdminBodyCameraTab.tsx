// ============================================================
// RMPG Flex — Body Camera Administration Tab
// ============================================================
// Full BWC fleet management: device inventory, footage browser,
// checkout/checkin log, audit trail, retention policies.
// Routes: /api/body-cameras/*

import React, { useState, useEffect, useCallback } from 'react';
import {
  Camera, Video, HardDrive, Battery, Shield, Search,
  ChevronDown, ChevronRight, Plus, Edit2, Flag, Eye,
  CheckCircle, AlertTriangle, Clock, Archive, Users,
  BarChart3, RefreshCw, Filter, Loader2, X, Download,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

// ── Types ────────────────────────────────────────────────────

interface BwcDevice {
  id: number;
  device_serial: string;
  device_model: string;
  device_type: string;
  assigned_officer_id: number | null;
  officer_name?: string;
  badge_number?: string;
  status: 'available' | 'assigned' | 'maintenance' | 'retired' | 'lost';
  firmware_version?: string;
  storage_capacity_gb?: number;
  purchase_date?: string;
  warranty_expiry?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

interface BwcFootage {
  id: number;
  footage_id: string;
  device_id: number;
  device_serial: string;
  device_model: string;
  officer_id: number;
  officer_name: string;
  badge_number: string;
  title?: string;
  category: string;
  start_time: string;
  end_time?: string;
  duration_seconds?: number;
  file_size_mb?: number;
  storage_location?: string;
  retention_class: string;
  retention_expiry?: string;
  linked_incident_id?: number;
  linked_call_id?: number;
  linked_case_id?: string;
  linked_uof_id?: number;
  flagged: number;
  flag_reason?: string;
  reviewed: number;
  reviewed_by?: number;
  reviewed_by_name?: string;
  reviewed_at?: string;
  review_notes?: string;
  tags: string[];
  notes?: string;
  status: string;
  created_at: string;
}

interface BwcStats {
  devices: { total: number; assigned: number; available: number; maintenance: number };
  footage: {
    total: number; totalStorageGb: number;
    byCategory: { category: string; count: number }[];
    byStatus: { status: string; count: number }[];
    flagged: number; pendingReview: number;
    litigationHold: number; expiringRetention: number;
  };
  byOfficer: { full_name: string; badge_number: string; count: number; total_hours: number }[];
  recentCheckouts: any[];
}

type SubTab = 'overview' | 'devices' | 'footage' | 'audit';

interface Props {
  users: any[];
}

// ── Helpers ──────────────────────────────────────────────────

function formatDuration(secs: number | undefined | null): string {
  if (!secs) return '--';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDate(d: string | undefined): string {
  if (!d) return '--';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(d: string | undefined): string {
  if (!d) return '--';
  return new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

const statusColors: Record<string, string> = {
  available: 'text-green-400',
  assigned: 'text-blue-400',
  maintenance: 'text-yellow-400',
  retired: 'text-gray-500',
  lost: 'text-red-400',
  uploaded: 'text-blue-400',
  active: 'text-green-400',
  archived: 'text-gray-500',
  flagged: 'text-red-400',
  under_review: 'text-yellow-400',
  litigation_hold: 'text-purple-400',
  deleted: 'text-gray-600',
};

// ── Component ────────────────────────────────────────────────

export default function AdminBodyCameraTab({ users }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('overview');
  const [stats, setStats] = useState<BwcStats | null>(null);
  const [devices, setDevices] = useState<BwcDevice[]>([]);
  const [footage, setFootage] = useState<BwcFootage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Device form
  const [showDeviceForm, setShowDeviceForm] = useState(false);
  const [editingDevice, setEditingDevice] = useState<BwcDevice | null>(null);
  const [deviceForm, setDeviceForm] = useState({
    device_serial: '', device_model: 'Axon Body 3', device_type: 'body',
    assigned_officer_id: '', firmware_version: '', storage_capacity_gb: '',
    purchase_date: '', warranty_expiry: '', notes: '',
  });

  // Footage form
  const [showFootageForm, setShowFootageForm] = useState(false);
  const [footageForm, setFootageForm] = useState({
    device_id: '', officer_id: '', title: '', category: 'routine',
    start_time: '', end_time: '', duration_seconds: '', file_size_mb: '',
    storage_location: '', retention_class: 'standard', notes: '',
    linked_incident_id: '', linked_call_id: '',
  });

  // Filters
  const [deviceFilter, setDeviceFilter] = useState('');
  const [footageFilter, setFootageFilter] = useState('');
  const [footageCategory, setFootageCategory] = useState('');
  const [footageStatus, setFootageStatus] = useState('');

  // ── Fetchers ─────────────────────────────────────────────

  const fetchStats = useCallback(async () => {
    try {
      const data = await apiFetch('/api/body-cameras/stats');
      setStats(data);
    } catch { /* non-fatal */ }
  }, []);

  const fetchDevices = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch(`/api/body-cameras/devices?search=${encodeURIComponent(deviceFilter)}`);
      setDevices(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [deviceFilter]);

  const fetchFootage = useCallback(async () => {
    setLoading(true);
    try {
      let url = `/api/body-cameras/footage?search=${encodeURIComponent(footageFilter)}`;
      if (footageCategory) url += `&category=${footageCategory}`;
      if (footageStatus) url += `&status=${footageStatus}`;
      const data = await apiFetch(url);
      setFootage(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [footageFilter, footageCategory, footageStatus]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    if (subTab === 'devices') fetchDevices();
    if (subTab === 'footage') fetchFootage();
  }, [subTab, fetchDevices, fetchFootage]);

  // ── Device CRUD ──────────────────────────────────────────

  const handleSaveDevice = async () => {
    try {
      const body: any = { ...deviceForm };
      if (body.assigned_officer_id) body.assigned_officer_id = parseInt(body.assigned_officer_id);
      else delete body.assigned_officer_id;
      if (body.storage_capacity_gb) body.storage_capacity_gb = parseFloat(body.storage_capacity_gb);
      else delete body.storage_capacity_gb;

      if (editingDevice) {
        await apiFetch(`/api/body-cameras/devices/${editingDevice.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await apiFetch('/api/body-cameras/devices', { method: 'POST', body: JSON.stringify(body) });
      }
      setShowDeviceForm(false);
      setEditingDevice(null);
      setDeviceForm({ device_serial: '', device_model: 'Axon Body 3', device_type: 'body', assigned_officer_id: '', firmware_version: '', storage_capacity_gb: '', purchase_date: '', warranty_expiry: '', notes: '' });
      fetchDevices();
      fetchStats();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCheckout = async (deviceId: number, officerId: number) => {
    try {
      await apiFetch(`/api/body-cameras/devices/${deviceId}/checkout`, {
        method: 'POST', body: JSON.stringify({ officer_id: officerId }),
      });
      fetchDevices();
      fetchStats();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCheckin = async (deviceId: number) => {
    try {
      await apiFetch(`/api/body-cameras/devices/${deviceId}/checkin`, { method: 'POST', body: JSON.stringify({}) });
      fetchDevices();
      fetchStats();
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ── Footage CRUD ─────────────────────────────────────────

  const handleSaveFootage = async () => {
    try {
      const body: any = { ...footageForm };
      if (body.device_id) body.device_id = parseInt(body.device_id);
      if (body.officer_id) body.officer_id = parseInt(body.officer_id);
      if (body.duration_seconds) body.duration_seconds = parseInt(body.duration_seconds);
      if (body.file_size_mb) body.file_size_mb = parseFloat(body.file_size_mb);
      if (body.linked_incident_id) body.linked_incident_id = parseInt(body.linked_incident_id);
      if (body.linked_call_id) body.linked_call_id = parseInt(body.linked_call_id);

      await apiFetch('/api/body-cameras/footage', { method: 'POST', body: JSON.stringify(body) });
      setShowFootageForm(false);
      setFootageForm({ device_id: '', officer_id: '', title: '', category: 'routine', start_time: '', end_time: '', duration_seconds: '', file_size_mb: '', storage_location: '', retention_class: 'standard', notes: '', linked_incident_id: '', linked_call_id: '' });
      fetchFootage();
      fetchStats();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleFlagFootage = async (id: number, flagged: boolean, reason?: string) => {
    try {
      await apiFetch(`/api/body-cameras/footage/${id}/flag`, {
        method: 'PUT', body: JSON.stringify({ flagged, flag_reason: reason || '' }),
      });
      fetchFootage();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleReviewFootage = async (id: number, notes?: string) => {
    try {
      await apiFetch(`/api/body-cameras/footage/${id}/review`, {
        method: 'PUT', body: JSON.stringify({ review_notes: notes || 'Reviewed' }),
      });
      fetchFootage();
      fetchStats();
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ── Sub-tab nav ──────────────────────────────────────────

  const subTabs: { id: SubTab; label: string; icon: React.ElementType }[] = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'devices', label: 'Device Fleet', icon: Camera },
    { id: 'footage', label: 'Footage', icon: Video },
    { id: 'audit', label: 'Activity', icon: Shield },
  ];

  // ── Input helper ─────────────────────────────────────────

  const inputClass = 'bg-[#111] border border-[#333] text-[#ccc] rounded px-2 py-1.5 text-xs font-mono focus:border-[#bc1010] focus:outline-none w-full';
  const selectClass = inputClass;
  const labelClass = 'block text-[10px] uppercase tracking-wider text-[#666] mb-1';
  const btnPrimary = 'px-3 py-1.5 bg-[#bc1010] text-white text-xs font-bold rounded hover:bg-[#d41414] transition-colors';
  const btnSecondary = 'px-3 py-1.5 bg-[#222] text-[#aaa] text-xs font-bold rounded border border-[#333] hover:bg-[#2a2a2a] transition-colors';

  return (
    <div className="space-y-4">
      {/* Sub-tab navigation */}
      <div className="flex items-center gap-1 border-b border-[#2a2a2a] pb-2">
        {subTabs.map((t) => {
          const Icon = t.icon;
          const active = subTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-t transition-colors ${
                active ? 'bg-[#1a1a1a] text-[#bc1010] border border-[#333] border-b-0' : 'text-[#666] hover:text-[#999]'
              }`}
            >
              <Icon size={12} />
              {t.label}
            </button>
          );
        })}
        <div className="flex-1" />
        <button onClick={() => { fetchStats(); if (subTab === 'devices') fetchDevices(); if (subTab === 'footage') fetchFootage(); }}
          className="text-[#555] hover:text-[#999] transition-colors">
          <RefreshCw size={12} />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-2 bg-red-900/20 border border-red-800/40 rounded text-xs text-red-400">
          <AlertTriangle size={12} /> {error}
          <button onClick={() => setError('')} className="ml-auto"><X size={12} /></button>
        </div>
      )}

      {/* ── OVERVIEW ───────────────────────────────────────── */}
      {subTab === 'overview' && stats && (
        <div className="space-y-4">
          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {[
              { label: 'Total Devices', value: stats.devices.total, icon: Camera, color: '#bc1010' },
              { label: 'Assigned', value: stats.devices.assigned, icon: Users, color: '#3b82f6' },
              { label: 'Available', value: stats.devices.available, icon: CheckCircle, color: '#22c55e' },
              { label: 'Total Footage', value: stats.footage.total, icon: Video, color: '#a855f7' },
              { label: 'Storage (GB)', value: stats.footage.totalStorageGb, icon: HardDrive, color: '#f59e0b' },
              { label: 'Flagged', value: stats.footage.flagged, icon: Flag, color: '#ef4444' },
            ].map((s) => (
              <div key={s.label} className="bg-[#111] border border-[#222] rounded p-3">
                <div className="flex items-center gap-2 mb-1">
                  <s.icon size={12} style={{ color: s.color }} />
                  <span className="text-[10px] uppercase tracking-wider text-[#555]">{s.label}</span>
                </div>
                <div className="text-xl font-bold text-[#ddd] font-mono">{s.value}</div>
              </div>
            ))}
          </div>

          {/* Pending review + retention alerts */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-[#111] border border-[#222] rounded p-3">
              <div className="flex items-center gap-2 mb-2">
                <Eye size={12} className="text-yellow-400" />
                <span className="text-xs font-bold text-[#aaa] uppercase">Pending Review</span>
              </div>
              <div className="text-2xl font-bold text-yellow-400 font-mono">{stats.footage.pendingReview}</div>
              <div className="text-[10px] text-[#555] mt-1">Footage awaiting supervisor review</div>
            </div>
            <div className="bg-[#111] border border-[#222] rounded p-3">
              <div className="flex items-center gap-2 mb-2">
                <Shield size={12} className="text-purple-400" />
                <span className="text-xs font-bold text-[#aaa] uppercase">Litigation Hold</span>
              </div>
              <div className="text-2xl font-bold text-purple-400 font-mono">{stats.footage.litigationHold}</div>
              <div className="text-[10px] text-[#555] mt-1">Footage under legal hold</div>
            </div>
            <div className="bg-[#111] border border-[#222] rounded p-3">
              <div className="flex items-center gap-2 mb-2">
                <Clock size={12} className="text-orange-400" />
                <span className="text-xs font-bold text-[#aaa] uppercase">Expiring (30d)</span>
              </div>
              <div className="text-2xl font-bold text-orange-400 font-mono">{stats.footage.expiringRetention}</div>
              <div className="text-[10px] text-[#555] mt-1">Retention expiring within 30 days</div>
            </div>
          </div>

          {/* Officer activity */}
          {stats.byOfficer.length > 0 && (
            <div className="bg-[#111] border border-[#222] rounded p-3">
              <h3 className="text-xs font-bold text-[#aaa] uppercase mb-2">Top Officers (30 days)</h3>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-[#555] uppercase">
                    <th className="text-left py-1">Officer</th>
                    <th className="text-left py-1">Badge</th>
                    <th className="text-right py-1">Recordings</th>
                    <th className="text-right py-1">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.byOfficer.map((o, i) => (
                    <tr key={i} className="border-t border-[#1a1a1a]">
                      <td className="py-1 text-[#ccc]">{o.full_name}</td>
                      <td className="py-1 text-[#888]">{o.badge_number}</td>
                      <td className="py-1 text-right text-[#ccc] font-mono">{o.count}</td>
                      <td className="py-1 text-right text-[#ccc] font-mono">{o.total_hours}h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Recent checkouts */}
          {stats.recentCheckouts.length > 0 && (
            <div className="bg-[#111] border border-[#222] rounded p-3">
              <h3 className="text-xs font-bold text-[#aaa] uppercase mb-2">Recent Checkout Activity</h3>
              <div className="space-y-1">
                {stats.recentCheckouts.slice(0, 8).map((c: any) => (
                  <div key={c.id} className="flex items-center gap-2 text-xs py-1 border-b border-[#1a1a1a]">
                    <span className={c.action === 'checkout' ? 'text-green-400' : 'text-blue-400'}>
                      {c.action === 'checkout' ? '→ OUT' : '← IN'}
                    </span>
                    <span className="text-[#888]">{c.device_serial}</span>
                    <span className="text-[#ccc]">{c.officer_name}</span>
                    <span className="ml-auto text-[#555]">{formatDateTime(c.performed_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {subTab === 'overview' && !stats && (
        <div className="flex items-center justify-center py-12 text-[#555]">
          <Loader2 size={16} className="animate-spin mr-2" /> Loading statistics...
        </div>
      )}

      {/* ── DEVICES ────────────────────────────────────────── */}
      {subTab === 'devices' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#555]" />
              <input
                className={`${inputClass} pl-7`}
                placeholder="Search serial, model, officer..."
                value={deviceFilter}
                onChange={(e) => setDeviceFilter(e.target.value)}
              />
            </div>
            <button onClick={() => { setEditingDevice(null); setShowDeviceForm(true); }} className={btnPrimary}>
              <Plus size={12} className="inline mr-1" /> Add Device
            </button>
          </div>

          {loading && <div className="text-center py-4 text-[#555] text-xs"><Loader2 size={14} className="animate-spin inline mr-1" /> Loading...</div>}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {devices.map((d) => (
              <div key={d.id} className="bg-[#111] border border-[#222] rounded p-3 hover:border-[#333] transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Camera size={14} className="text-[#bc1010]" />
                    <span className="text-xs font-bold text-[#ddd] font-mono">{d.device_serial}</span>
                  </div>
                  <span className={`text-[10px] font-bold uppercase ${statusColors[d.status] || 'text-[#666]'}`}>
                    {d.status}
                  </span>
                </div>
                <div className="text-[10px] text-[#666] mb-2">{d.device_model} · {d.device_type}</div>
                {d.officer_name && (
                  <div className="text-xs text-[#aaa] mb-1">
                    <Users size={10} className="inline mr-1" />
                    {d.officer_name} {d.badge_number && `(#${d.badge_number})`}
                  </div>
                )}
                {d.firmware_version && (
                  <div className="text-[10px] text-[#555]">FW: {d.firmware_version}</div>
                )}
                <div className="flex items-center gap-1 mt-2 pt-2 border-t border-[#1a1a1a]">
                  <button onClick={() => {
                    setEditingDevice(d);
                    setDeviceForm({
                      device_serial: d.device_serial, device_model: d.device_model,
                      device_type: d.device_type, assigned_officer_id: d.assigned_officer_id?.toString() || '',
                      firmware_version: d.firmware_version || '', storage_capacity_gb: d.storage_capacity_gb?.toString() || '',
                      purchase_date: d.purchase_date || '', warranty_expiry: d.warranty_expiry || '',
                      notes: d.notes || '',
                    });
                    setShowDeviceForm(true);
                  }} className="text-[10px] text-[#666] hover:text-[#aaa]">
                    <Edit2 size={10} className="inline mr-0.5" /> Edit
                  </button>
                  {d.status === 'available' && (
                    <button onClick={() => {
                      const officerId = prompt('Officer user ID for checkout:');
                      if (officerId) handleCheckout(d.id, parseInt(officerId));
                    }} className="text-[10px] text-green-600 hover:text-green-400 ml-2">
                      → Checkout
                    </button>
                  )}
                  {d.status === 'assigned' && (
                    <button onClick={() => handleCheckin(d.id)} className="text-[10px] text-blue-600 hover:text-blue-400 ml-2">
                      ← Checkin
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {devices.length === 0 && !loading && (
            <div className="text-center py-8 text-[#555] text-xs">
              No devices found. Click "Add Device" to register a body camera.
            </div>
          )}

          {/* Device form modal */}
          {showDeviceForm && (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowDeviceForm(false)}>
              <div className="bg-[#0f0f0f] border border-[#333] rounded-lg p-4 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-sm font-bold text-[#ccc] mb-3">
                  {editingDevice ? 'Edit Device' : 'Register New Body Camera'}
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Serial Number *</label>
                    <input className={inputClass} value={deviceForm.device_serial}
                      onChange={(e) => setDeviceForm(f => ({ ...f, device_serial: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelClass}>Model</label>
                    <input className={inputClass} value={deviceForm.device_model}
                      onChange={(e) => setDeviceForm(f => ({ ...f, device_model: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelClass}>Type</label>
                    <select className={selectClass} value={deviceForm.device_type}
                      onChange={(e) => setDeviceForm(f => ({ ...f, device_type: e.target.value }))}>
                      <option value="body">Body</option>
                      <option value="dash">Dash</option>
                      <option value="interview">Interview Room</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Assign Officer</label>
                    <select className={selectClass} value={deviceForm.assigned_officer_id}
                      onChange={(e) => setDeviceForm(f => ({ ...f, assigned_officer_id: e.target.value }))}>
                      <option value="">-- Unassigned --</option>
                      {users.filter(u => u.status === 'active').map(u => (
                        <option key={u.id} value={u.id}>{u.full_name} ({u.badge_number || 'N/A'})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Firmware</label>
                    <input className={inputClass} value={deviceForm.firmware_version}
                      onChange={(e) => setDeviceForm(f => ({ ...f, firmware_version: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelClass}>Storage (GB)</label>
                    <input className={inputClass} type="number" value={deviceForm.storage_capacity_gb}
                      onChange={(e) => setDeviceForm(f => ({ ...f, storage_capacity_gb: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelClass}>Purchase Date</label>
                    <input className={inputClass} type="date" value={deviceForm.purchase_date}
                      onChange={(e) => setDeviceForm(f => ({ ...f, purchase_date: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelClass}>Warranty Expiry</label>
                    <input className={inputClass} type="date" value={deviceForm.warranty_expiry}
                      onChange={(e) => setDeviceForm(f => ({ ...f, warranty_expiry: e.target.value }))} />
                  </div>
                  <div className="col-span-2">
                    <label className={labelClass}>Notes</label>
                    <textarea className={`${inputClass} h-16 resize-none`} value={deviceForm.notes}
                      onChange={(e) => setDeviceForm(f => ({ ...f, notes: e.target.value }))} />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <button onClick={() => setShowDeviceForm(false)} className={btnSecondary}>Cancel</button>
                  <button onClick={handleSaveDevice} className={btnPrimary}>
                    {editingDevice ? 'Save Changes' : 'Register Device'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── FOOTAGE ────────────────────────────────────────── */}
      {subTab === 'footage' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#555]" />
              <input
                className={`${inputClass} pl-7`}
                placeholder="Search footage ID, title, officer..."
                value={footageFilter}
                onChange={(e) => setFootageFilter(e.target.value)}
              />
            </div>
            <select className={`${selectClass} w-32`} value={footageCategory}
              onChange={(e) => setFootageCategory(e.target.value)}>
              <option value="">All Categories</option>
              <option value="routine">Routine</option>
              <option value="evidence">Evidence</option>
              <option value="training">Training</option>
              <option value="complaint">Complaint</option>
              <option value="use_of_force">Use of Force</option>
              <option value="pursuit">Pursuit</option>
            </select>
            <select className={`${selectClass} w-32`} value={footageStatus}
              onChange={(e) => setFootageStatus(e.target.value)}>
              <option value="">All Status</option>
              <option value="uploaded">Uploaded</option>
              <option value="available">Available</option>
              <option value="flagged">Flagged</option>
              <option value="under_review">Under Review</option>
              <option value="archived">Archived</option>
              <option value="litigation_hold">Litigation Hold</option>
            </select>
            <button onClick={() => { setShowFootageForm(true); }} className={btnPrimary}>
              <Plus size={12} className="inline mr-1" /> Add Footage
            </button>
          </div>

          {loading && <div className="text-center py-4 text-[#555] text-xs"><Loader2 size={14} className="animate-spin inline mr-1" /> Loading...</div>}

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-[#555] uppercase border-b border-[#222]">
                  <th className="text-left py-2 px-2">ID</th>
                  <th className="text-left py-2 px-2">Officer</th>
                  <th className="text-left py-2 px-2">Camera</th>
                  <th className="text-left py-2 px-2">Category</th>
                  <th className="text-left py-2 px-2">Start</th>
                  <th className="text-right py-2 px-2">Duration</th>
                  <th className="text-right py-2 px-2">Size</th>
                  <th className="text-left py-2 px-2">Status</th>
                  <th className="text-center py-2 px-2">Flags</th>
                  <th className="text-right py-2 px-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {footage.map((f) => (
                  <tr key={f.id} className="border-b border-[#1a1a1a] hover:bg-[#111]">
                    <td className="py-1.5 px-2 font-mono text-[#888]">{f.footage_id}</td>
                    <td className="py-1.5 px-2 text-[#ccc]">
                      {f.officer_name}
                      {f.badge_number && <span className="text-[#555] ml-1">#{f.badge_number}</span>}
                    </td>
                    <td className="py-1.5 px-2 text-[#888] font-mono">{f.device_serial}</td>
                    <td className="py-1.5 px-2">
                      <span className="px-1.5 py-0.5 bg-[#1a1a1a] rounded text-[10px] text-[#aaa]">
                        {f.category}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-[#888]">{formatDateTime(f.start_time)}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-[#ccc]">{formatDuration(f.duration_seconds)}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-[#888]">
                      {f.file_size_mb ? `${f.file_size_mb.toFixed(1)} MB` : '--'}
                    </td>
                    <td className="py-1.5 px-2">
                      <span className={`text-[10px] font-bold uppercase ${statusColors[f.status] || 'text-[#666]'}`}>
                        {f.status}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-center">
                      {f.flagged ? <Flag size={12} className="text-red-400 inline" /> : null}
                      {f.reviewed ? <CheckCircle size={12} className="text-green-400 inline ml-1" /> : null}
                    </td>
                    <td className="py-1.5 px-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {!f.reviewed && (
                          <button onClick={() => handleReviewFootage(f.id)}
                            className="text-[10px] text-green-600 hover:text-green-400" title="Mark Reviewed">
                            <Eye size={11} />
                          </button>
                        )}
                        <button onClick={() => handleFlagFootage(f.id, !f.flagged, f.flagged ? '' : 'Flagged for review')}
                          className={`text-[10px] ${f.flagged ? 'text-red-400' : 'text-[#555] hover:text-red-400'}`} title={f.flagged ? 'Unflag' : 'Flag'}>
                          <Flag size={11} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {footage.length === 0 && !loading && (
            <div className="text-center py-8 text-[#555] text-xs">
              No footage records found. Add footage entries as recordings are uploaded.
            </div>
          )}

          {/* Footage form modal */}
          {showFootageForm && (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowFootageForm(false)}>
              <div className="bg-[#0f0f0f] border border-[#333] rounded-lg p-4 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-sm font-bold text-[#ccc] mb-3">Add Footage Record</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Device *</label>
                    <select className={selectClass} value={footageForm.device_id}
                      onChange={(e) => setFootageForm(f => ({ ...f, device_id: e.target.value }))}>
                      <option value="">-- Select Device --</option>
                      {devices.map(d => (
                        <option key={d.id} value={d.id}>{d.device_serial} ({d.device_model})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Officer *</label>
                    <select className={selectClass} value={footageForm.officer_id}
                      onChange={(e) => setFootageForm(f => ({ ...f, officer_id: e.target.value }))}>
                      <option value="">-- Select Officer --</option>
                      {users.filter(u => u.status === 'active').map(u => (
                        <option key={u.id} value={u.id}>{u.full_name} ({u.badge_number || 'N/A'})</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className={labelClass}>Title</label>
                    <input className={inputClass} value={footageForm.title} placeholder="Brief description..."
                      onChange={(e) => setFootageForm(f => ({ ...f, title: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelClass}>Category</label>
                    <select className={selectClass} value={footageForm.category}
                      onChange={(e) => setFootageForm(f => ({ ...f, category: e.target.value }))}>
                      <option value="routine">Routine</option>
                      <option value="evidence">Evidence</option>
                      <option value="training">Training</option>
                      <option value="complaint">Complaint</option>
                      <option value="use_of_force">Use of Force</option>
                      <option value="pursuit">Pursuit</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Retention</label>
                    <select className={selectClass} value={footageForm.retention_class}
                      onChange={(e) => setFootageForm(f => ({ ...f, retention_class: e.target.value }))}>
                      <option value="standard">Standard (1 year)</option>
                      <option value="extended">Extended (3 years)</option>
                      <option value="permanent">Permanent</option>
                      <option value="litigation_hold">Litigation Hold</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Start Time *</label>
                    <input className={inputClass} type="datetime-local" value={footageForm.start_time}
                      onChange={(e) => setFootageForm(f => ({ ...f, start_time: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelClass}>End Time</label>
                    <input className={inputClass} type="datetime-local" value={footageForm.end_time}
                      onChange={(e) => setFootageForm(f => ({ ...f, end_time: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelClass}>File Size (MB)</label>
                    <input className={inputClass} type="number" value={footageForm.file_size_mb}
                      onChange={(e) => setFootageForm(f => ({ ...f, file_size_mb: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelClass}>Storage Location</label>
                    <input className={inputClass} value={footageForm.storage_location} placeholder="e.g., NAS-01, Evidence.com"
                      onChange={(e) => setFootageForm(f => ({ ...f, storage_location: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelClass}>Linked Incident #</label>
                    <input className={inputClass} type="number" value={footageForm.linked_incident_id}
                      onChange={(e) => setFootageForm(f => ({ ...f, linked_incident_id: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelClass}>Linked Call #</label>
                    <input className={inputClass} type="number" value={footageForm.linked_call_id}
                      onChange={(e) => setFootageForm(f => ({ ...f, linked_call_id: e.target.value }))} />
                  </div>
                  <div className="col-span-2">
                    <label className={labelClass}>Notes</label>
                    <textarea className={`${inputClass} h-16 resize-none`} value={footageForm.notes}
                      onChange={(e) => setFootageForm(f => ({ ...f, notes: e.target.value }))} />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <button onClick={() => setShowFootageForm(false)} className={btnSecondary}>Cancel</button>
                  <button onClick={handleSaveFootage} className={btnPrimary}>Add Footage</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── AUDIT / ACTIVITY ───────────────────────────────── */}
      {subTab === 'audit' && stats && (
        <div className="space-y-3">
          <div className="bg-[#111] border border-[#222] rounded p-3">
            <h3 className="text-xs font-bold text-[#aaa] uppercase mb-2">
              <Shield size={12} className="inline mr-1" /> Footage by Category
            </h3>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
              {stats.footage.byCategory.map((c) => (
                <div key={c.category} className="bg-[#0a0a0a] rounded p-2 text-center">
                  <div className="text-lg font-bold text-[#ccc] font-mono">{c.count}</div>
                  <div className="text-[10px] text-[#555] uppercase">{c.category}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[#111] border border-[#222] rounded p-3">
            <h3 className="text-xs font-bold text-[#aaa] uppercase mb-2">
              <Archive size={12} className="inline mr-1" /> Footage by Status
            </h3>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
              {stats.footage.byStatus.map((s) => (
                <div key={s.status} className="bg-[#0a0a0a] rounded p-2 text-center">
                  <div className={`text-lg font-bold font-mono ${statusColors[s.status] || 'text-[#ccc]'}`}>{s.count}</div>
                  <div className="text-[10px] text-[#555] uppercase">{s.status.replace(/_/g, ' ')}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[#111] border border-[#222] rounded p-3">
            <h3 className="text-xs font-bold text-[#aaa] uppercase mb-2">Retention Summary</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="text-center">
                <div className="text-xl font-bold text-green-400 font-mono">{stats.devices.total}</div>
                <div className="text-[10px] text-[#555]">Total Cameras</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-blue-400 font-mono">{stats.footage.total}</div>
                <div className="text-[10px] text-[#555]">Total Recordings</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-yellow-400 font-mono">{stats.footage.totalStorageGb} GB</div>
                <div className="text-[10px] text-[#555]">Total Storage</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-orange-400 font-mono">{stats.footage.expiringRetention}</div>
                <div className="text-[10px] text-[#555]">Expiring Soon</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
