import React, { useState, useEffect, useCallback } from 'react';
import {
  Search, Plus, X, Save, Loader2, Flame, ClipboardList,
  Droplets, BarChart3, MapPin,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';
import { apiFetch } from '../hooks/useApi';

// ── Types ──
interface FireIncident {
  id: number;
  incident_number: string;
  incident_date: string;
  incident_type: string;
  location: string;
  cause: string;
  severity: string;
  status: string;
  narrative: string;
  responding_units: string;
  estimated_loss: number;
}

interface PrePlan {
  id: number;
  building_name: string;
  address: string;
  building_type: string;
  hazards: string;
  sprinkler_system: number;
  last_inspected: string;
  floors: number;
  occupancy_type: string;
  notes: string;
}

interface Hydrant {
  id: number;
  hydrant_number: string;
  location: string;
  hydrant_type: string;
  flow_rate_gpm: number;
  status: string;
  last_tested: string;
  lat: number | null;
  lng: number | null;
}

interface FireStats {
  total_incidents: number;
  active_incidents: number;
  total_preplans: number;
  total_hydrants: number;
  hydrants_in_service: number;
  avg_response_time_min: number;
}

type TabId = 'incidents' | 'preplans' | 'hydrants' | 'stats';

const INCIDENT_TYPES = ['structure_fire', 'vehicle_fire', 'wildland_fire', 'hazmat', 'rescue', 'ems_assist', 'false_alarm', 'investigation', 'other'];
const SEVERITY_LEVELS = ['minor', 'moderate', 'major', 'catastrophic'];
const HYDRANT_TYPES = ['wet_barrel', 'dry_barrel', 'wall', 'underground'];
const HYDRANT_STATUSES = ['in_service', 'out_of_service', 'needs_repair', 'winterized'];

const STATUS_COLORS: Record<string, string> = {
  active: 'text-red-400',
  under_investigation: 'text-amber-400',
  closed: 'text-green-400',
  pending: 'text-[#d4a017]',
};

type ModalType = 'incident' | 'preplan' | 'hydrant' | null;

const EMPTY_INCIDENT = {
  incident_type: 'structure_fire', location: '', cause: '', severity: 'minor',
  narrative: '', responding_units: '', estimated_loss: '',
};

const EMPTY_PREPLAN = {
  building_name: '', address: '', building_type: '', hazards: '',
  sprinkler_system: false, floors: '1', occupancy_type: '', notes: '',
};

const EMPTY_HYDRANT = {
  hydrant_number: '', location: '', hydrant_type: 'wet_barrel',
  flow_rate_gpm: '', status: 'in_service', lat: '', lng: '',
};

export default function FireRMSPage() {
  const [activeTab, setActiveTab] = useState<TabId>('incidents');
  const [searchQuery, setSearchQuery] = useState('');

  // ── Data state ──
  const [incidents, setIncidents] = useState<FireIncident[]>([]);
  const [preplans, setPreplans] = useState<PrePlan[]>([]);
  const [hydrants, setHydrants] = useState<Hydrant[]>([]);
  const [stats, setStats] = useState<FireStats | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Modal state ──
  const [modalType, setModalType] = useState<ModalType>(null);
  const [incidentForm, setIncidentForm] = useState({ ...EMPTY_INCIDENT });
  const [preplanForm, setPreplanForm] = useState({ ...EMPTY_PREPLAN });
  const [hydrantForm, setHydrantForm] = useState({ ...EMPTY_HYDRANT });
  const [submitting, setSubmitting] = useState(false);

  // ── Fetchers ──
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (activeTab === 'incidents') {
        const params = new URLSearchParams();
        if (searchQuery) params.set('search', searchQuery);
        const data = await apiFetch<{ data: FireIncident[] }>(`/fire/incidents?${params}`);
        setIncidents(data.data || []);
      } else if (activeTab === 'preplans') {
        const params = new URLSearchParams();
        if (searchQuery) params.set('search', searchQuery);
        const data = await apiFetch<{ data: PrePlan[] }>(`/fire/preplans?${params}`);
        setPreplans(data.data || []);
      } else if (activeTab === 'hydrants') {
        const params = new URLSearchParams();
        if (searchQuery) params.set('search', searchQuery);
        const data = await apiFetch<{ data: Hydrant[] }>(`/fire/hydrants?${params}`);
        setHydrants(data.data || []);
      } else if (activeTab === 'stats') {
        const data = await apiFetch<FireStats>('/fire/stats');
        setStats(data);
      }
    } catch { /* empty */ }
    finally { setLoading(false); }
  }, [activeTab, searchQuery]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openNewModal = (type: ModalType) => {
    if (type === 'incident') setIncidentForm({ ...EMPTY_INCIDENT });
    else if (type === 'preplan') setPreplanForm({ ...EMPTY_PREPLAN });
    else if (type === 'hydrant') setHydrantForm({ ...EMPTY_HYDRANT });
    setModalType(type);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      if (modalType === 'incident') {
        await apiFetch('/fire/incidents', { method: 'POST', body: JSON.stringify(incidentForm) });
      } else if (modalType === 'preplan') {
        await apiFetch('/fire/preplans', { method: 'POST', body: JSON.stringify({ ...preplanForm, sprinkler_system: preplanForm.sprinkler_system ? 1 : 0 }) });
      } else if (modalType === 'hydrant') {
        await apiFetch('/fire/hydrants', { method: 'POST', body: JSON.stringify(hydrantForm) });
      }
      setModalType(null);
      fetchData();
    } catch { /* error */ }
    finally { setSubmitting(false); }
  };

  const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: 'incidents', label: 'Incidents', icon: Flame },
    { id: 'preplans', label: 'Pre-Plans', icon: ClipboardList },
    { id: 'hydrants', label: 'Hydrants', icon: Droplets },
    { id: 'stats', label: 'Stats', icon: BarChart3 },
  ];

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="FIRE RECORDS MANAGEMENT" icon={Flame} />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[#222222]">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setSearchQuery(''); }}
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

      {/* Search + New button (for table tabs) */}
      {activeTab !== 'stats' && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[#888888]" />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none"
            />
          </div>
          <button
            onClick={() => openNewModal(activeTab === 'incidents' ? 'incident' : activeTab === 'preplans' ? 'preplan' : 'hydrant')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#d4a017] text-black text-xs font-semibold rounded-[2px] hover:bg-[#b8891a]"
          >
            <Plus className="w-3.5 h-3.5" /> New
          </button>
        </div>
      )}

      {/* ═══ Incidents Table ═══ */}
      {activeTab === 'incidents' && (
        <div className="bg-[#141414] border border-[#222222] rounded-[2px] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#222222]">
                  {['Incident #', 'Date', 'Type', 'Location', 'Cause', 'Severity', 'Status'].map(h => (
                    <th key={h} className="text-left px-3 py-[3px] text-[9px] font-semibold text-[#888888] uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="text-center py-8 text-[#888888]"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                ) : incidents.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8 text-[#888888]">No incidents found</td></tr>
                ) : incidents.map(inc => (
                  <tr key={inc.id} className="border-b border-[#1a1a1a] hover:bg-[#1a1a1a]">
                    <td className="px-3 py-[2px] text-[#d4a017] font-mono">{inc.incident_number}</td>
                    <td className="px-3 py-[2px] text-[#888888]">{inc.incident_date}</td>
                    <td className="px-3 py-[2px] text-[#888888] capitalize">{inc.incident_type.replace(/_/g, ' ')}</td>
                    <td className="px-3 py-[2px] text-[#888888]">{inc.location}</td>
                    <td className="px-3 py-[2px] text-[#888888]">{inc.cause}</td>
                    <td className="px-3 py-[2px] text-[#888888] capitalize">{inc.severity}</td>
                    <td className={`px-3 py-[2px] font-semibold capitalize ${STATUS_COLORS[inc.status] || 'text-[#888888]'}`}>
                      {inc.status.replace(/_/g, ' ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ Pre-Plans Table ═══ */}
      {activeTab === 'preplans' && (
        <div className="bg-[#141414] border border-[#222222] rounded-[2px] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#222222]">
                  {['Building Name', 'Address', 'Type', 'Hazards', 'Sprinkler', 'Last Inspected'].map(h => (
                    <th key={h} className="text-left px-3 py-[3px] text-[9px] font-semibold text-[#888888] uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="text-center py-8 text-[#888888]"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                ) : preplans.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-[#888888]">No pre-plans found</td></tr>
                ) : preplans.map(pp => (
                  <tr key={pp.id} className="border-b border-[#1a1a1a] hover:bg-[#1a1a1a]">
                    <td className="px-3 py-[2px] text-white font-semibold">{pp.building_name}</td>
                    <td className="px-3 py-[2px] text-[#888888]">{pp.address}</td>
                    <td className="px-3 py-[2px] text-[#888888]">{pp.building_type}</td>
                    <td className="px-3 py-[2px] text-[#888888]">{pp.hazards}</td>
                    <td className="px-3 py-[2px]">
                      {pp.sprinkler_system ? <span className="text-green-400">Yes</span> : <span className="text-[#888888]">No</span>}
                    </td>
                    <td className="px-3 py-[2px] text-[#888888]">{pp.last_inspected}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ Hydrants Table ═══ */}
      {activeTab === 'hydrants' && (
        <div className="bg-[#141414] border border-[#222222] rounded-[2px] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#222222]">
                  {['Hydrant #', 'Location', 'Type', 'Flow Rate (GPM)', 'Status', 'Last Tested'].map(h => (
                    <th key={h} className="text-left px-3 py-[3px] text-[9px] font-semibold text-[#888888] uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="text-center py-8 text-[#888888]"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                ) : hydrants.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-[#888888]">No hydrants found</td></tr>
                ) : hydrants.map(h => (
                  <tr key={h.id} className="border-b border-[#1a1a1a] hover:bg-[#1a1a1a]">
                    <td className="px-3 py-[2px] text-[#d4a017] font-mono">{h.hydrant_number}</td>
                    <td className="px-3 py-[2px] text-[#888888]">{h.location}</td>
                    <td className="px-3 py-[2px] text-[#888888] capitalize">{h.hydrant_type.replace(/_/g, ' ')}</td>
                    <td className="px-3 py-[2px] text-[#888888] font-mono">{h.flow_rate_gpm}</td>
                    <td className={`px-3 py-[2px] capitalize ${h.status === 'in_service' ? 'text-green-400' : 'text-red-400'}`}>
                      {h.status.replace(/_/g, ' ')}
                    </td>
                    <td className="px-3 py-[2px] text-[#888888]">{h.last_tested}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ Stats Tab ═══ */}
      {activeTab === 'stats' && (
        <div className="space-y-4">
          {loading ? (
            <div className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin mx-auto text-[#888888]" /></div>
          ) : stats ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                { label: 'Total Incidents', value: stats.total_incidents, icon: Flame },
                { label: 'Active Incidents', value: stats.active_incidents, icon: Flame },
                { label: 'Pre-Plans', value: stats.total_preplans, icon: ClipboardList },
                { label: 'Total Hydrants', value: stats.total_hydrants, icon: Droplets },
                { label: 'Hydrants In Service', value: stats.hydrants_in_service, icon: Droplets },
                { label: 'Avg Response (min)', value: stats.avg_response_time_min, icon: BarChart3 },
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
          ) : (
            <div className="text-center py-12 text-[#888888] text-sm">No statistics available</div>
          )}
        </div>
      )}

      {/* ═══ New Form Modal ═══ */}
      {modalType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-[#141414] border border-[#222222] rounded-[2px] w-full max-w-lg mx-4 shadow-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-2 border-b border-[#222222]">
              <span className="text-sm font-semibold text-[#d4a017] capitalize">
                New {modalType === 'preplan' ? 'Pre-Plan' : modalType}
              </span>
              <IconButton aria-label="Close form" onClick={() => setModalType(null)}>
                <X className="w-4 h-4 text-[#888888]" />
              </IconButton>
            </div>
            <div className="p-4 space-y-3">
              {/* Incident form */}
              {modalType === 'incident' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-[#888888] uppercase">Type</label>
                      <select value={incidentForm.incident_type} onChange={e => setIncidentForm(p => ({ ...p, incident_type: e.target.value }))}
                        className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none">
                        {INCIDENT_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-[#888888] uppercase">Severity</label>
                      <select value={incidentForm.severity} onChange={e => setIncidentForm(p => ({ ...p, severity: e.target.value }))}
                        className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none">
                        {SEVERITY_LEVELS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-[#888888] uppercase">Location *</label>
                    <input value={incidentForm.location} onChange={e => setIncidentForm(p => ({ ...p, location: e.target.value }))}
                      className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none" />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#888888] uppercase">Cause</label>
                    <input value={incidentForm.cause} onChange={e => setIncidentForm(p => ({ ...p, cause: e.target.value }))}
                      className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none" />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#888888] uppercase">Responding Units</label>
                    <input value={incidentForm.responding_units} onChange={e => setIncidentForm(p => ({ ...p, responding_units: e.target.value }))}
                      className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none" />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#888888] uppercase">Estimated Loss ($)</label>
                    <input type="number" value={incidentForm.estimated_loss} onChange={e => setIncidentForm(p => ({ ...p, estimated_loss: e.target.value }))}
                      className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none" />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#888888] uppercase">Narrative</label>
                    <textarea value={incidentForm.narrative} onChange={e => setIncidentForm(p => ({ ...p, narrative: e.target.value }))} rows={3}
                      className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none resize-none" />
                  </div>
                </>
              )}

              {/* Pre-Plan form */}
              {modalType === 'preplan' && (
                <>
                  <div>
                    <label className="text-[10px] text-[#888888] uppercase">Building Name *</label>
                    <input value={preplanForm.building_name} onChange={e => setPreplanForm(p => ({ ...p, building_name: e.target.value }))}
                      className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none" />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#888888] uppercase">Address *</label>
                    <input value={preplanForm.address} onChange={e => setPreplanForm(p => ({ ...p, address: e.target.value }))}
                      className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-[#888888] uppercase">Building Type</label>
                      <input value={preplanForm.building_type} onChange={e => setPreplanForm(p => ({ ...p, building_type: e.target.value }))}
                        className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] text-[#888888] uppercase">Floors</label>
                      <input type="number" value={preplanForm.floors} onChange={e => setPreplanForm(p => ({ ...p, floors: e.target.value }))}
                        className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-[#888888] uppercase">Hazards</label>
                    <textarea value={preplanForm.hazards} onChange={e => setPreplanForm(p => ({ ...p, hazards: e.target.value }))} rows={2}
                      className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none resize-none" />
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="sprinkler" checked={preplanForm.sprinkler_system as boolean}
                      onChange={e => setPreplanForm(p => ({ ...p, sprinkler_system: e.target.checked }))}
                      className="rounded-[2px]" />
                    <label htmlFor="sprinkler" className="text-xs text-[#888888]">Sprinkler System</label>
                  </div>
                  <div>
                    <label className="text-[10px] text-[#888888] uppercase">Occupancy Type</label>
                    <input value={preplanForm.occupancy_type} onChange={e => setPreplanForm(p => ({ ...p, occupancy_type: e.target.value }))}
                      className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none" />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#888888] uppercase">Notes</label>
                    <textarea value={preplanForm.notes} onChange={e => setPreplanForm(p => ({ ...p, notes: e.target.value }))} rows={2}
                      className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none resize-none" />
                  </div>
                </>
              )}

              {/* Hydrant form */}
              {modalType === 'hydrant' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-[#888888] uppercase">Hydrant # *</label>
                      <input value={hydrantForm.hydrant_number} onChange={e => setHydrantForm(p => ({ ...p, hydrant_number: e.target.value }))}
                        className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs font-mono focus:border-[#d4a017] outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] text-[#888888] uppercase">Type</label>
                      <select value={hydrantForm.hydrant_type} onChange={e => setHydrantForm(p => ({ ...p, hydrant_type: e.target.value }))}
                        className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none">
                        {HYDRANT_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-[#888888] uppercase">Location *</label>
                    <input value={hydrantForm.location} onChange={e => setHydrantForm(p => ({ ...p, location: e.target.value }))}
                      className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-[#888888] uppercase">Flow Rate (GPM)</label>
                      <input type="number" value={hydrantForm.flow_rate_gpm} onChange={e => setHydrantForm(p => ({ ...p, flow_rate_gpm: e.target.value }))}
                        className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] text-[#888888] uppercase">Status</label>
                      <select value={hydrantForm.status} onChange={e => setHydrantForm(p => ({ ...p, status: e.target.value }))}
                        className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none">
                        {HYDRANT_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-[#888888] uppercase">Latitude</label>
                      <input type="number" step="any" value={hydrantForm.lat} onChange={e => setHydrantForm(p => ({ ...p, lat: e.target.value }))}
                        className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] text-[#888888] uppercase">Longitude</label>
                      <input type="number" step="any" value={hydrantForm.lng} onChange={e => setHydrantForm(p => ({ ...p, lng: e.target.value }))}
                        className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none" />
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-[#222222]">
              <button onClick={() => setModalType(null)} className="px-3 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-xs text-[#888888] hover:text-white">Cancel</button>
              <button onClick={handleSubmit} disabled={submitting}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#d4a017] text-black text-xs font-semibold rounded-[2px] hover:bg-[#b8891a] disabled:opacity-50">
                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
