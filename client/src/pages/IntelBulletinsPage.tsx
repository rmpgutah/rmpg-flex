import { useState, useEffect } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import { Shield, AlertTriangle, Plus, Search, Eye, Check, X, Clock, MapPin, User } from 'lucide-react';

interface Bulletin {
  id: number;
  bulletin_number: string;
  title: string;
  type: 'bolo' | 'atl' | 'crime_alert' | 'officer_safety' | 'community_alert';
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'active' | 'expired' | 'cancelled';
  description: string;
  suspect_name?: string;
  suspect_description?: string;
  vehicle_description?: string;
  location?: string;
  created_by: string;
  created_at: string;
  expires_at?: string;
  acknowledged?: boolean;
  acknowledged_at?: string;
}

interface BulletinStats {
  active_bolos: number;
  active_atls: number;
  crime_alerts: number;
  unacknowledged: number;
}

interface BulletinForm {
  title: string;
  type: string;
  priority: string;
  description: string;
  suspect_name: string;
  suspect_description: string;
  vehicle_description: string;
  location: string;
  expires_at: string;
}

const emptyForm: BulletinForm = {
  title: '', type: 'bolo', priority: 'medium', description: '',
  suspect_name: '', suspect_description: '', vehicle_description: '',
  location: '', expires_at: '',
};

const priorityColors: Record<string, string> = {
  critical: 'bg-red-600 text-white',
  high: 'bg-orange-600 text-white',
  medium: 'bg-yellow-600 text-black',
  low: 'bg-gray-600 text-white',
};

const typeLabels: Record<string, string> = {
  bolo: 'BOLO', atl: 'ATL', crime_alert: 'Crime Alert',
  officer_safety: 'Officer Safety', community_alert: 'Community Alert',
};

export default function IntelBulletinsPage() {
  const [bulletins, setBulletins] = useState<Bulletin[]>([]);
  const [stats, setStats] = useState<BulletinStats>({ active_bolos: 0, active_atls: 0, crime_alerts: 0, unacknowledged: 0 });
  const [statusFilter, setStatusFilter] = useState('active');
  const [typeFilter, setTypeFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBulletin, setSelectedBulletin] = useState<Bulletin | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingBulletin, setEditingBulletin] = useState<Bulletin | null>(null);
  const [form, setForm] = useState<BulletinForm>(emptyForm);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchStats();
  }, []);

  useEffect(() => {
    fetchBulletins();
  }, [statusFilter, typeFilter, priorityFilter, searchQuery]);

  async function fetchStats() {
    try {
      const data = await apiFetch<BulletinStats>('/intel-bulletins/stats/summary');
      setStats(data);
    } catch (err) {
      console.error('Failed to fetch stats', err);
    }
  }

  async function fetchBulletins() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (typeFilter !== 'all') params.set('type', typeFilter);
      if (priorityFilter !== 'all') params.set('priority', priorityFilter);
      if (searchQuery) params.set('q', searchQuery);
      const query = params.toString();
      const data = await apiFetch<Bulletin[]>(`/intel-bulletins${query ? '?' + query : ''}`);
      setBulletins(data);
    } catch (err) {
      console.error('Failed to fetch bulletins', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    try {
      if (editingBulletin) {
        await apiFetch(`/intel-bulletins/${editingBulletin.id}`, { method: 'PUT', body: JSON.stringify(form), headers: { 'Content-Type': 'application/json' } });
      } else {
        await apiFetch('/intel-bulletins', { method: 'POST', body: JSON.stringify(form), headers: { 'Content-Type': 'application/json' } });
      }
      setShowCreateModal(false);
      setEditingBulletin(null);
      setForm(emptyForm);
      fetchBulletins();
      fetchStats();
    } catch (err) {
      console.error('Failed to save bulletin', err);
    }
  }

  async function handleAcknowledge(id: number) {
    try {
      await apiFetch(`/intel-bulletins/${id}/acknowledge`, { method: 'POST' });
      fetchBulletins();
      fetchStats();
    } catch (err) {
      console.error('Failed to acknowledge bulletin', err);
    }
  }

  function openCreate() {
    setForm(emptyForm);
    setEditingBulletin(null);
    setShowCreateModal(true);
  }

  function openEdit(b: Bulletin) {
    setForm({
      title: b.title, type: b.type, priority: b.priority,
      description: b.description, suspect_name: b.suspect_name || '',
      suspect_description: b.suspect_description || '',
      vehicle_description: b.vehicle_description || '',
      location: b.location || '', expires_at: b.expires_at || '',
    });
    setEditingBulletin(b);
    setShowCreateModal(true);
  }

  return (
    <div className="p-4 space-y-4 bg-[#0a0a0a] min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between">
        <PanelTitleBar title="INTELLIGENCE BULLETINS" icon={Shield} />
        <button
          onClick={openCreate}
          className="flex items-center gap-1 px-3 py-1.5 bg-[#d4a017] text-black font-semibold text-xs rounded-sm hover:bg-[#b88914]"
        >
          <Plus className="w-3.5 h-3.5" /> New Bulletin
        </button>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Active BOLOs', value: stats.active_bolos, color: 'text-red-400' },
          { label: 'Active ATLs', value: stats.active_atls, color: 'text-orange-400' },
          { label: 'Crime Alerts', value: stats.crime_alerts, color: 'text-yellow-400' },
          { label: 'Unacknowledged', value: stats.unacknowledged, color: 'text-[#d4a017]' },
        ].map((s) => (
          <div key={s.label} className="bg-[#141414] border border-[#222222] rounded-sm p-3 text-center">
            <div className={`text-xl font-mono font-bold ${s.color}`}>{s.value}</div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wide">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-2 bg-[#141414] border border-[#222222] rounded-sm p-2">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-[#0a0a0a] border border-[#222222] text-gray-200 text-xs px-2 py-1 rounded-sm">
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="expired">Expired</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="bg-[#0a0a0a] border border-[#222222] text-gray-200 text-xs px-2 py-1 rounded-sm">
          <option value="all">All Types</option>
          <option value="bolo">BOLO</option>
          <option value="atl">ATL</option>
          <option value="crime_alert">Crime Alert</option>
          <option value="officer_safety">Officer Safety</option>
          <option value="community_alert">Community Alert</option>
        </select>
        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="bg-[#0a0a0a] border border-[#222222] text-gray-200 text-xs px-2 py-1 rounded-sm">
          <option value="all">All Priority</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <div className="flex items-center gap-1 flex-1 min-w-[180px]">
          <Search className="w-3.5 h-3.5 text-gray-500" />
          <input
            type="text"
            placeholder="Search bulletins..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-[#0a0a0a] border border-[#222222] text-gray-200 text-xs px-2 py-1 rounded-sm flex-1"
          />
        </div>
      </div>

      {/* Bulletin List */}
      <div className="space-y-2">
        {loading && <div className="text-center text-gray-500 text-xs py-8">Loading...</div>}
        {!loading && bulletins.length === 0 && (
          <div className="text-center text-gray-500 text-xs py-8">No bulletins found</div>
        )}
        {bulletins.map((b) => (
          <div
            key={b.id}
            className="bg-[#141414] border border-[#222222] rounded-sm p-3 hover:border-[#333333] cursor-pointer"
            onClick={() => setSelectedBulletin(b)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase rounded-sm ${priorityColors[b.priority]}`}>
                    {b.priority}
                  </span>
                  <span className="font-mono text-xs text-gray-400">{b.bulletin_number}</span>
                  <span className="px-1.5 py-0.5 text-[9px] bg-[#222222] text-gray-300 rounded-sm uppercase">
                    {typeLabels[b.type] || b.type}
                  </span>
                  {b.status !== 'active' && (
                    <span className="px-1.5 py-0.5 text-[9px] bg-[#333333] text-gray-400 rounded-sm uppercase">{b.status}</span>
                  )}
                </div>
                <div className="text-sm text-gray-100 font-semibold mt-1 truncate">{b.title}</div>
                <div className="text-xs text-gray-400 mt-0.5 line-clamp-2">{b.description}</div>
                <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-500">
                  {b.suspect_name && (
                    <span className="flex items-center gap-0.5"><User className="w-3 h-3" />{b.suspect_name}</span>
                  )}
                  {b.location && (
                    <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" />{b.location}</span>
                  )}
                  <span className="flex items-center gap-0.5"><Clock className="w-3 h-3" />{new Date(b.created_at).toLocaleDateString()}</span>
                  {b.expires_at && (
                    <span className="flex items-center gap-0.5">
                      <AlertTriangle className="w-3 h-3" />Exp: {new Date(b.expires_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {!b.acknowledged && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleAcknowledge(b.id); }}
                    className="flex items-center gap-0.5 px-2 py-1 text-[10px] bg-[#d4a017] text-black font-semibold rounded-sm hover:bg-[#b88914]"
                    title="Acknowledge"
                  >
                    <Check className="w-3 h-3" /> ACK
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); setSelectedBulletin(b); }}
                  className="p-1 text-gray-400 hover:text-gray-200"
                  title="View details"
                >
                  <Eye className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Detail Modal */}
      {selectedBulletin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setSelectedBulletin(null)}>
          <div className="bg-[#141414] border border-[#222222] rounded-sm w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b border-[#222222]">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-[#d4a017]" />
                <span className="text-sm font-semibold text-gray-100">Bulletin Detail</span>
              </div>
              <button onClick={() => setSelectedBulletin(null)} className="text-gray-400 hover:text-gray-200">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-xs">
              <div className="flex items-center gap-2">
                <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase rounded-sm ${priorityColors[selectedBulletin.priority]}`}>
                  {selectedBulletin.priority}
                </span>
                <span className="font-mono text-gray-400">{selectedBulletin.bulletin_number}</span>
                <span className="px-1.5 py-0.5 text-[9px] bg-[#222222] text-gray-300 rounded-sm uppercase">
                  {typeLabels[selectedBulletin.type]}
                </span>
              </div>
              <h3 className="text-base font-semibold text-gray-100">{selectedBulletin.title}</h3>
              <p className="text-gray-300 whitespace-pre-wrap">{selectedBulletin.description}</p>
              {selectedBulletin.suspect_name && (
                <div><span className="text-gray-500">Suspect:</span> <span className="text-gray-200">{selectedBulletin.suspect_name}</span></div>
              )}
              {selectedBulletin.suspect_description && (
                <div><span className="text-gray-500">Description:</span> <span className="text-gray-200">{selectedBulletin.suspect_description}</span></div>
              )}
              {selectedBulletin.vehicle_description && (
                <div><span className="text-gray-500">Vehicle:</span> <span className="text-gray-200">{selectedBulletin.vehicle_description}</span></div>
              )}
              {selectedBulletin.location && (
                <div><span className="text-gray-500">Location:</span> <span className="text-gray-200">{selectedBulletin.location}</span></div>
              )}
              <div className="flex gap-4 pt-2 border-t border-[#222222] text-gray-500">
                <span>Created: {new Date(selectedBulletin.created_at).toLocaleString()}</span>
                {selectedBulletin.expires_at && <span>Expires: {new Date(selectedBulletin.expires_at).toLocaleString()}</span>}
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => { openEdit(selectedBulletin); setSelectedBulletin(null); }} className="px-3 py-1 bg-[#222222] text-gray-200 text-xs rounded-sm hover:bg-[#333333]">
                  Edit
                </button>
                {!selectedBulletin.acknowledged && (
                  <button onClick={() => { handleAcknowledge(selectedBulletin.id); setSelectedBulletin(null); }} className="px-3 py-1 bg-[#d4a017] text-black text-xs font-semibold rounded-sm hover:bg-[#b88914]">
                    Acknowledge
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create/Edit Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setShowCreateModal(false)}>
          <div className="bg-[#141414] border border-[#222222] rounded-sm w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b border-[#222222]">
              <span className="text-sm font-semibold text-gray-100">
                {editingBulletin ? 'Edit Bulletin' : 'New Intelligence Bulletin'}
              </span>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-gray-200">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-[10px] text-gray-400 uppercase mb-1">Title *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full bg-[#0a0a0a] border border-[#222222] text-gray-200 text-xs px-2 py-1.5 rounded-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] text-gray-400 uppercase mb-1">Type *</label>
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full bg-[#0a0a0a] border border-[#222222] text-gray-200 text-xs px-2 py-1.5 rounded-sm">
                    <option value="bolo">BOLO</option>
                    <option value="atl">ATL</option>
                    <option value="crime_alert">Crime Alert</option>
                    <option value="officer_safety">Officer Safety</option>
                    <option value="community_alert">Community Alert</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400 uppercase mb-1">Priority *</label>
                  <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full bg-[#0a0a0a] border border-[#222222] text-gray-200 text-xs px-2 py-1.5 rounded-sm">
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 uppercase mb-1">Description *</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={4}
                  className="w-full bg-[#0a0a0a] border border-[#222222] text-gray-200 text-xs px-2 py-1.5 rounded-sm resize-none"
                />
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 uppercase mb-1">Suspect Name</label>
                <input
                  type="text"
                  value={form.suspect_name}
                  onChange={(e) => setForm({ ...form, suspect_name: e.target.value })}
                  className="w-full bg-[#0a0a0a] border border-[#222222] text-gray-200 text-xs px-2 py-1.5 rounded-sm"
                />
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 uppercase mb-1">Suspect Description</label>
                <textarea
                  value={form.suspect_description}
                  onChange={(e) => setForm({ ...form, suspect_description: e.target.value })}
                  rows={2}
                  className="w-full bg-[#0a0a0a] border border-[#222222] text-gray-200 text-xs px-2 py-1.5 rounded-sm resize-none"
                />
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 uppercase mb-1">Vehicle Description</label>
                <input
                  type="text"
                  value={form.vehicle_description}
                  onChange={(e) => setForm({ ...form, vehicle_description: e.target.value })}
                  className="w-full bg-[#0a0a0a] border border-[#222222] text-gray-200 text-xs px-2 py-1.5 rounded-sm"
                />
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 uppercase mb-1">Location</label>
                <input
                  type="text"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  className="w-full bg-[#0a0a0a] border border-[#222222] text-gray-200 text-xs px-2 py-1.5 rounded-sm"
                />
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 uppercase mb-1">Expires At</label>
                <input
                  type="datetime-local"
                  value={form.expires_at}
                  onChange={(e) => setForm({ ...form, expires_at: e.target.value })}
                  className="w-full bg-[#0a0a0a] border border-[#222222] text-gray-200 text-xs px-2 py-1.5 rounded-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-[#222222]">
                <button onClick={() => setShowCreateModal(false)} className="px-3 py-1.5 bg-[#222222] text-gray-300 text-xs rounded-sm hover:bg-[#333333]">
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={!form.title || !form.description}
                  className="px-3 py-1.5 bg-[#d4a017] text-black text-xs font-semibold rounded-sm hover:bg-[#b88914] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {editingBulletin ? 'Update Bulletin' : 'Create Bulletin'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
