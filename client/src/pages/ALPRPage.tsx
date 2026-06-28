import React, { useState, useEffect, useCallback } from 'react';
import {
  Search, Plus, Camera, X, Save, Loader2, ToggleLeft, ToggleRight,
  AlertTriangle, Car, Eye, Shield, Activity,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';
import { apiFetch } from '../hooks/useApi';

// ── Types ──
interface ALPRRead {
  id: number;
  plate: string;
  state: string;
  camera_name: string;
  location: string;
  read_at: string;
  vehicle_description: string;
  confidence: number;
  is_hit: number;
  hit_reason?: string;
}

interface HotListEntry {
  id: number;
  plate: string;
  state: string;
  reason: string;
  alert_type: string;
  vehicle_description: string;
  priority: string;
  expires_at: string;
  active: number;
  created_at: string;
}

interface ALPRStats {
  total_reads_today: number;
  hits_today: number;
  cameras_active: number;
}

const ALERT_TYPES = ['stolen', 'wanted', 'bolo', 'amber_alert', 'missing', 'warrant', 'other'];
const PRIORITIES = ['critical', 'high', 'medium', 'low'];

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'text-red-400',
  high: 'text-amber-400',
  medium: 'text-[#d4a017]',
  low: 'text-[#888888]',
};

const EMPTY_HOTLIST_FORM = {
  plate: '', state: '', reason: '', alert_type: 'stolen',
  vehicle_description: '', priority: 'high', expires_at: '',
};

export default function ALPRPage() {
  const [activeTab, setActiveTab] = useState<'live' | 'hotlist'>('live');

  // ── Live Feed state ──
  const [reads, setReads] = useState<ALPRRead[]>([]);
  const [stats, setStats] = useState<ALPRStats>({ total_reads_today: 0, hits_today: 0, cameras_active: 0 });
  const [loading, setLoading] = useState(true);
  const [searchPlate, setSearchPlate] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // ── Hot List state ──
  const [hotlist, setHotlist] = useState<HotListEntry[]>([]);
  const [hotlistLoading, setHotlistLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<HotListEntry | null>(null);
  const [formData, setFormData] = useState({ ...EMPTY_HOTLIST_FORM });
  const [submitting, setSubmitting] = useState(false);

  // ── Fetch live reads ──
  const fetchReads = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchPlate) params.set('plate', searchPlate);
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);
      const data = await apiFetch<{ reads: ALPRRead[]; stats: ALPRStats }>(`/alpr/reads?${params}`);
      setReads(data.reads || []);
      setStats(data.stats || { total_reads_today: 0, hits_today: 0, cameras_active: 0 });
    } catch { /* handled by empty state */ }
    finally { setLoading(false); }
  }, [searchPlate, dateFrom, dateTo]);

  // ── Fetch hot list ──
  const fetchHotlist = useCallback(async () => {
    setHotlistLoading(true);
    try {
      const data = await apiFetch<HotListEntry[]>('/alpr/hotlist');
      setHotlist(Array.isArray(data) ? data : []);
    } catch { /* handled by empty state */ }
    finally { setHotlistLoading(false); }
  }, []);

  useEffect(() => {
    if (activeTab === 'live') fetchReads();
    else fetchHotlist();
  }, [activeTab, fetchReads, fetchHotlist]);

  // ── Form handlers ──
  const handleOpenNew = () => {
    setEditingEntry(null);
    setFormData({ ...EMPTY_HOTLIST_FORM });
    setFormOpen(true);
  };

  const handleEdit = (entry: HotListEntry) => {
    setEditingEntry(entry);
    setFormData({
      plate: entry.plate,
      state: entry.state,
      reason: entry.reason,
      alert_type: entry.alert_type,
      vehicle_description: entry.vehicle_description || '',
      priority: entry.priority,
      expires_at: entry.expires_at || '',
    });
    setFormOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.plate || !formData.reason) return;
    setSubmitting(true);
    try {
      if (editingEntry) {
        await apiFetch(`/alpr/hotlist/${editingEntry.id}`, {
          method: 'PUT',
          body: JSON.stringify(formData),
        });
      } else {
        await apiFetch('/alpr/hotlist', {
          method: 'POST',
          body: JSON.stringify(formData),
        });
      }
      setFormOpen(false);
      fetchHotlist();
    } catch { /* error */ }
    finally { setSubmitting(false); }
  };

  const handleToggleActive = async (entry: HotListEntry) => {
    try {
      await apiFetch(`/alpr/hotlist/${entry.id}`, {
        method: 'PUT',
        body: JSON.stringify({ active: entry.active ? 0 : 1 }),
      });
      fetchHotlist();
    } catch { /* error */ }
  };

  const handleField = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const tabs = [
    { id: 'live' as const, label: 'Live Feed', icon: Activity },
    { id: 'hotlist' as const, label: 'Hot List', icon: Shield },
  ];

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="LICENSE PLATE RECOGNITION" icon={Camera} />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[#222222]">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold tracking-wide transition-colors
              ${activeTab === tab.id
                ? 'text-[#d4a017] border-b-2 border-[#d4a017] bg-[#141414]'
                : 'text-[#888888] hover:text-white hover:bg-[#141414]'}`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ═══ Live Feed Tab ═══ */}
      {activeTab === 'live' && (
        <div className="space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Total Reads Today', value: stats.total_reads_today, icon: Eye },
              { label: 'Hits Today', value: stats.hits_today, icon: AlertTriangle },
              { label: 'Cameras Active', value: stats.cameras_active, icon: Camera },
            ].map(s => (
              <div key={s.label} className="bg-[#141414] border border-[#222222] rounded-[2px] p-3 flex items-center gap-3">
                <s.icon className="w-5 h-5 text-[#d4a017]" />
                <div>
                  <div className="text-lg font-bold text-white">{s.value}</div>
                  <div className="text-[10px] text-[#888888] uppercase tracking-wider">{s.label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Search / Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[#888888]" />
              <input
                type="text"
                placeholder="Search plate..."
                value={searchPlate}
                onChange={e => setSearchPlate(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none"
              />
            </div>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="bg-[#0a0a0a] border border-[#222222] rounded-[2px] px-2 py-1.5 text-white text-xs focus:border-[#d4a017] outline-none"
            />
            <span className="text-[#888888] text-xs">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="bg-[#0a0a0a] border border-[#222222] rounded-[2px] px-2 py-1.5 text-white text-xs focus:border-[#d4a017] outline-none"
            />
            <button onClick={fetchReads} className="px-3 py-1.5 bg-[#141414] border border-[#222222] rounded-[2px] text-xs text-white hover:bg-[#1a1a1a]">
              Apply
            </button>
          </div>

          {/* Table */}
          <div className="bg-[#141414] border border-[#222222] rounded-[2px] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#222222]">
                    {['Plate', 'State', 'Camera', 'Location', 'Time', 'Vehicle', 'Confidence', 'Hit?'].map(h => (
                      <th key={h} className="text-left px-3 py-[3px] text-[9px] font-semibold text-[#888888] uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={8} className="text-center py-8 text-[#888888]"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                  ) : reads.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-8 text-[#888888]">No reads found</td></tr>
                  ) : reads.map(read => (
                    <tr
                      key={read.id}
                      className={`border-b border-[#1a1a1a] hover:bg-[#1a1a1a] ${read.is_hit ? 'bg-red-950/30' : ''}`}
                    >
                      <td className="px-3 py-[2px] font-mono font-bold text-white">{read.plate}</td>
                      <td className="px-3 py-[2px] text-[#888888]">{read.state}</td>
                      <td className="px-3 py-[2px] text-[#888888]">{read.camera_name}</td>
                      <td className="px-3 py-[2px] text-[#888888]">{read.location}</td>
                      <td className="px-3 py-[2px] text-[#888888]">{read.read_at}</td>
                      <td className="px-3 py-[2px] text-[#888888]">{read.vehicle_description}</td>
                      <td className="px-3 py-[2px] text-[#888888]">{read.confidence}%</td>
                      <td className="px-3 py-[2px]">
                        {read.is_hit ? (
                          <span className="text-red-400 font-bold">⬤ HIT</span>
                        ) : (
                          <span className="text-green-600">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Hot List Tab ═══ */}
      {activeTab === 'hotlist' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs text-[#888888]">{hotlist.length} entries</div>
            <button
              onClick={handleOpenNew}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#d4a017] text-black text-xs font-semibold rounded-[2px] hover:bg-[#b8891a]"
            >
              <Plus className="w-3.5 h-3.5" /> Add to Hot List
            </button>
          </div>

          <div className="bg-[#141414] border border-[#222222] rounded-[2px] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#222222]">
                    {['Plate', 'State', 'Reason', 'Alert Type', 'Vehicle', 'Priority', 'Expires', 'Active', ''].map(h => (
                      <th key={h} className="text-left px-3 py-[3px] text-[9px] font-semibold text-[#888888] uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {hotlistLoading ? (
                    <tr><td colSpan={9} className="text-center py-8 text-[#888888]"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                  ) : hotlist.length === 0 ? (
                    <tr><td colSpan={9} className="text-center py-8 text-[#888888]">No hot list entries</td></tr>
                  ) : hotlist.map(entry => (
                    <tr key={entry.id} className="border-b border-[#1a1a1a] hover:bg-[#1a1a1a] cursor-pointer" onClick={() => handleEdit(entry)}>
                      <td className="px-3 py-[2px] font-mono font-bold text-white">{entry.plate}</td>
                      <td className="px-3 py-[2px] text-[#888888]">{entry.state}</td>
                      <td className="px-3 py-[2px] text-[#888888]">{entry.reason}</td>
                      <td className="px-3 py-[2px] text-[#888888] capitalize">{entry.alert_type.replace(/_/g, ' ')}</td>
                      <td className="px-3 py-[2px] text-[#888888]">{entry.vehicle_description}</td>
                      <td className={`px-3 py-[2px] font-semibold capitalize ${PRIORITY_COLORS[entry.priority] || 'text-[#888888]'}`}>{entry.priority}</td>
                      <td className="px-3 py-[2px] text-[#888888]">{entry.expires_at || '—'}</td>
                      <td className="px-3 py-[2px]">
                        <IconButton
                          aria-label={`Toggle ${entry.plate} active status`}
                          onClick={e => { e.stopPropagation(); handleToggleActive(entry); }}
                        >
                          {entry.active ? <ToggleRight className="w-4 h-4 text-green-400" /> : <ToggleLeft className="w-4 h-4 text-[#888888]" />}
                        </IconButton>
                      </td>
                      <td className="px-3 py-[2px]" />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Form Modal ═══ */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-[#141414] border border-[#222222] rounded-[2px] w-full max-w-lg mx-4 shadow-lg">
            <div className="flex items-center justify-between px-4 py-2 border-b border-[#222222]">
              <span className="text-sm font-semibold text-[#d4a017]">{editingEntry ? 'Edit Hot List Entry' : 'Add to Hot List'}</span>
              <IconButton aria-label="Close form" onClick={() => setFormOpen(false)}>
                <X className="w-4 h-4 text-[#888888]" />
              </IconButton>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-[#888888] uppercase">Plate *</label>
                  <input value={formData.plate} onChange={e => handleField('plate', e.target.value.toUpperCase())}
                    className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs font-mono focus:border-[#d4a017] outline-none" />
                </div>
                <div>
                  <label className="text-[10px] text-[#888888] uppercase">State</label>
                  <input value={formData.state} onChange={e => handleField('state', e.target.value.toUpperCase())}
                    className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none" />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-[#888888] uppercase">Reason *</label>
                <textarea value={formData.reason} onChange={e => handleField('reason', e.target.value)} rows={2}
                  className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-[#888888] uppercase">Alert Type</label>
                  <select value={formData.alert_type} onChange={e => handleField('alert_type', e.target.value)}
                    className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none">
                    {ALERT_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-[#888888] uppercase">Priority</label>
                  <select value={formData.priority} onChange={e => handleField('priority', e.target.value)}
                    className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none">
                    {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-[#888888] uppercase">Vehicle Description</label>
                <input value={formData.vehicle_description} onChange={e => handleField('vehicle_description', e.target.value)}
                  className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none" />
              </div>
              <div>
                <label className="text-[10px] text-[#888888] uppercase">Expires</label>
                <input type="date" value={formData.expires_at} onChange={e => handleField('expires_at', e.target.value)}
                  className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-[#222222]">
              <button onClick={() => setFormOpen(false)} className="px-3 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-xs text-[#888888] hover:text-white">Cancel</button>
              <button onClick={handleSubmit} disabled={submitting}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#d4a017] text-black text-xs font-semibold rounded-[2px] hover:bg-[#b8891a] disabled:opacity-50">
                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {editingEntry ? 'Update' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
