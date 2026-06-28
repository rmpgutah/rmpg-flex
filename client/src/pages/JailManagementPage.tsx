import React, { useState, useEffect, useCallback } from 'react';
import {
  Search, Plus, X, Save, Loader2, Users, Building2, ArrowRightLeft,
  BarChart3, ClipboardList, UserPlus,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';
import { apiFetch } from '../hooks/useApi';

// ── Types ──
interface Inmate {
  id: number;
  booking_number: string;
  first_name: string;
  last_name: string;
  dob: string;
  gender: string;
  classification: string;
  status: string;
  housing_unit: string;
  cell_number: string;
  booked_at: string;
  released_at: string | null;
  arrest_record_id: number | null;
  charges: string;
  medical_flags: string;
  notes: string;
}

interface HousingUnit {
  id: number;
  name: string;
  capacity: number;
  current_count: number;
  unit_type: string;
}

interface Movement {
  id: number;
  inmate_id: number;
  inmate_name: string;
  from_unit: string;
  to_unit: string;
  reason: string;
  moved_at: string;
  moved_by: string;
}

interface JailStats {
  total_inmates: number;
  by_status: Record<string, number>;
  by_classification: Record<string, number>;
  total_capacity: number;
  occupancy_pct: number;
}

type TabId = 'intake' | 'housing' | 'search' | 'movements' | 'stats';

const CLASSIFICATIONS = ['minimum', 'medium', 'maximum', 'protective_custody', 'medical', 'administrative_segregation'];
const STATUSES = ['booked', 'in_custody', 'released', 'transferred', 'bonded_out'];

const STATUS_COLORS: Record<string, string> = {
  booked: 'text-amber-400',
  in_custody: 'text-red-400',
  released: 'text-green-400',
  transferred: 'text-blue-400',
  bonded_out: 'text-purple-400',
};

const EMPTY_INTAKE = {
  first_name: '', last_name: '', dob: '', gender: 'male',
  classification: 'medium', housing_unit: '', cell_number: '',
  arrest_record_id: '', charges: '', medical_flags: '', notes: '',
};

export default function JailManagementPage() {
  const [activeTab, setActiveTab] = useState<TabId>('intake');

  // ── Intake state ──
  const [intakeForm, setIntakeForm] = useState({ ...EMPTY_INTAKE });
  const [intakeSubmitting, setIntakeSubmitting] = useState(false);
  const [intakeMessage, setIntakeMessage] = useState('');

  // ── Housing state ──
  const [housingUnits, setHousingUnits] = useState<HousingUnit[]>([]);
  const [housingLoading, setHousingLoading] = useState(true);

  // ── Search state ──
  const [inmates, setInmates] = useState<Inmate[]>([]);
  const [inmateSearch, setInmateSearch] = useState('');
  const [inmateLoading, setInmateLoading] = useState(true);

  // ── Movements state ──
  const [movements, setMovements] = useState<Movement[]>([]);
  const [movementsLoading, setMovementsLoading] = useState(true);

  // ── Stats state ──
  const [stats, setStats] = useState<JailStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // ── Fetchers ──
  const fetchHousing = useCallback(async () => {
    setHousingLoading(true);
    try {
      const data = await apiFetch<HousingUnit[]>('/jail/housing');
      setHousingUnits(Array.isArray(data) ? data : []);
    } catch { /* empty */ }
    finally { setHousingLoading(false); }
  }, []);

  const fetchInmates = useCallback(async () => {
    setInmateLoading(true);
    try {
      const params = new URLSearchParams();
      if (inmateSearch) params.set('search', inmateSearch);
      const data = await apiFetch<{ data: Inmate[] }>(`/jail/inmates?${params}`);
      setInmates(data.data || []);
    } catch { /* empty */ }
    finally { setInmateLoading(false); }
  }, [inmateSearch]);

  const fetchMovements = useCallback(async () => {
    setMovementsLoading(true);
    try {
      const data = await apiFetch<Movement[]>('/jail/movements');
      setMovements(Array.isArray(data) ? data : []);
    } catch { /* empty */ }
    finally { setMovementsLoading(false); }
  }, []);

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const data = await apiFetch<JailStats>('/jail/stats');
      setStats(data);
    } catch { /* empty */ }
    finally { setStatsLoading(false); }
  }, []);

  useEffect(() => {
    if (activeTab === 'housing') fetchHousing();
    else if (activeTab === 'search') fetchInmates();
    else if (activeTab === 'movements') fetchMovements();
    else if (activeTab === 'stats') fetchStats();
  }, [activeTab, fetchHousing, fetchInmates, fetchMovements, fetchStats]);

  // ── Intake submit ──
  const handleIntakeSubmit = async () => {
    if (!intakeForm.first_name || !intakeForm.last_name) return;
    setIntakeSubmitting(true);
    setIntakeMessage('');
    try {
      await apiFetch('/jail/intake', { method: 'POST', body: JSON.stringify(intakeForm) });
      setIntakeMessage('Inmate booked successfully');
      setIntakeForm({ ...EMPTY_INTAKE });
    } catch (err: any) { setIntakeMessage(err?.message || 'Booking failed'); }
    finally { setIntakeSubmitting(false); }
  };

  const handleIntakeField = (field: string, value: string) => {
    setIntakeForm(prev => ({ ...prev, [field]: value }));
  };

  const getOccupancyColor = (unit: HousingUnit) => {
    const pct = unit.capacity > 0 ? unit.current_count / unit.capacity : 0;
    if (pct >= 0.9) return 'bg-red-900/50 border-red-700/50';
    if (pct >= 0.5) return 'bg-amber-900/40 border-amber-700/50';
    return 'bg-green-900/30 border-green-700/50';
  };

  const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: 'intake', label: 'Intake', icon: UserPlus },
    { id: 'housing', label: 'Housing Board', icon: Building2 },
    { id: 'search', label: 'Inmate Search', icon: Search },
    { id: 'movements', label: 'Movements', icon: ArrowRightLeft },
    { id: 'stats', label: 'Stats', icon: BarChart3 },
  ];

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="JAIL MANAGEMENT SYSTEM" icon={Building2} />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[#222222] overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold tracking-wide transition-colors whitespace-nowrap
              ${activeTab === tab.id
                ? 'text-[#d4a017] border-b-2 border-[#d4a017] bg-[#141414]'
                : 'text-[#888888] hover:text-white hover:bg-[#141414]'}`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ═══ Intake Tab ═══ */}
      {activeTab === 'intake' && (
        <div className="bg-[#141414] border border-[#222222] rounded-[2px] p-4 max-w-2xl space-y-4">
          <h3 className="text-sm font-semibold text-[#d4a017]">New Booking</h3>
          {intakeMessage && (
            <div className={`text-xs px-3 py-2 rounded-[2px] ${intakeMessage.includes('success') ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
              {intakeMessage}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {[
              { key: 'first_name', label: 'First Name *' },
              { key: 'last_name', label: 'Last Name *' },
              { key: 'dob', label: 'Date of Birth', type: 'date' },
              { key: 'arrest_record_id', label: 'Arrest Record ID' },
              { key: 'housing_unit', label: 'Housing Unit' },
              { key: 'cell_number', label: 'Cell Number' },
            ].map(f => (
              <div key={f.key}>
                <label className="text-[10px] text-[#888888] uppercase">{f.label}</label>
                <input type={f.type || 'text'} value={(intakeForm as any)[f.key]}
                  onChange={e => handleIntakeField(f.key, e.target.value)}
                  className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-[#888888] uppercase">Gender</label>
              <select value={intakeForm.gender} onChange={e => handleIntakeField('gender', e.target.value)}
                className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none">
                {['male', 'female', 'other'].map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[#888888] uppercase">Classification</label>
              <select value={intakeForm.classification} onChange={e => handleIntakeField('classification', e.target.value)}
                className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none">
                {CLASSIFICATIONS.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-[10px] text-[#888888] uppercase">Charges</label>
            <textarea value={intakeForm.charges} onChange={e => handleIntakeField('charges', e.target.value)} rows={2}
              className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none resize-none" />
          </div>
          <div>
            <label className="text-[10px] text-[#888888] uppercase">Medical Flags</label>
            <input value={intakeForm.medical_flags} onChange={e => handleIntakeField('medical_flags', e.target.value)}
              className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none" />
          </div>
          <div>
            <label className="text-[10px] text-[#888888] uppercase">Notes</label>
            <textarea value={intakeForm.notes} onChange={e => handleIntakeField('notes', e.target.value)} rows={2}
              className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none resize-none" />
          </div>
          <div className="flex justify-end">
            <button onClick={handleIntakeSubmit} disabled={intakeSubmitting}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#d4a017] text-black text-xs font-semibold rounded-[2px] hover:bg-[#b8891a] disabled:opacity-50">
              {intakeSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
              Book Inmate
            </button>
          </div>
        </div>
      )}

      {/* ═══ Housing Board Tab ═══ */}
      {activeTab === 'housing' && (
        <div className="space-y-4">
          {housingLoading ? (
            <div className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin mx-auto text-[#888888]" /></div>
          ) : housingUnits.length === 0 ? (
            <div className="text-center py-12 text-[#888888] text-sm">No housing units configured</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {housingUnits.map(unit => (
                <div key={unit.id} className={`border rounded-[2px] p-3 ${getOccupancyColor(unit)}`}>
                  <div className="text-xs font-bold text-white mb-1">{unit.name}</div>
                  <div className="text-[10px] text-[#888888] uppercase mb-2">{unit.unit_type}</div>
                  <div className="text-lg font-mono text-white">
                    {unit.current_count}<span className="text-[#888888]">/{unit.capacity}</span>
                  </div>
                  <div className="mt-1 w-full bg-[#0a0a0a] rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full ${unit.current_count / unit.capacity >= 0.9 ? 'bg-red-500' : unit.current_count / unit.capacity >= 0.5 ? 'bg-amber-500' : 'bg-green-500'}`}
                      style={{ width: `${Math.min(100, (unit.current_count / unit.capacity) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ Inmate Search Tab ═══ */}
      {activeTab === 'search' && (
        <div className="space-y-4">
          <div className="relative max-w-md">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[#888888]" />
            <input
              type="text"
              placeholder="Search by name, booking #..."
              value={inmateSearch}
              onChange={e => setInmateSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && fetchInmates()}
              className="w-full pl-8 pr-3 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none"
            />
          </div>

          <div className="bg-[#141414] border border-[#222222] rounded-[2px] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#222222]">
                    {['Name', 'Booking #', 'DOB', 'Status', 'Classification', 'Housing', 'Booked'].map(h => (
                      <th key={h} className="text-left px-3 py-[3px] text-[9px] font-semibold text-[#888888] uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inmateLoading ? (
                    <tr><td colSpan={7} className="text-center py-8 text-[#888888]"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                  ) : inmates.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-8 text-[#888888]">No inmates found</td></tr>
                  ) : inmates.map(inmate => (
                    <tr key={inmate.id} className="border-b border-[#1a1a1a] hover:bg-[#1a1a1a]">
                      <td className="px-3 py-[2px] text-white font-semibold">{inmate.last_name}, {inmate.first_name}</td>
                      <td className="px-3 py-[2px] text-[#888888] font-mono">{inmate.booking_number}</td>
                      <td className="px-3 py-[2px] text-[#888888]">{inmate.dob}</td>
                      <td className={`px-3 py-[2px] font-semibold capitalize ${STATUS_COLORS[inmate.status] || 'text-[#888888]'}`}>
                        {inmate.status.replace(/_/g, ' ')}
                      </td>
                      <td className="px-3 py-[2px] text-[#888888] capitalize">{inmate.classification.replace(/_/g, ' ')}</td>
                      <td className="px-3 py-[2px] text-[#888888]">{inmate.housing_unit} {inmate.cell_number}</td>
                      <td className="px-3 py-[2px] text-[#888888]">{inmate.booked_at}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Movements Tab ═══ */}
      {activeTab === 'movements' && (
        <div className="space-y-4">
          <div className="bg-[#141414] border border-[#222222] rounded-[2px] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#222222]">
                    {['Inmate', 'From', 'To', 'Reason', 'Time', 'Moved By'].map(h => (
                      <th key={h} className="text-left px-3 py-[3px] text-[9px] font-semibold text-[#888888] uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {movementsLoading ? (
                    <tr><td colSpan={6} className="text-center py-8 text-[#888888]"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                  ) : movements.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-8 text-[#888888]">No movements recorded</td></tr>
                  ) : movements.map(mov => (
                    <tr key={mov.id} className="border-b border-[#1a1a1a] hover:bg-[#1a1a1a]">
                      <td className="px-3 py-[2px] text-white">{mov.inmate_name}</td>
                      <td className="px-3 py-[2px] text-[#888888]">{mov.from_unit}</td>
                      <td className="px-3 py-[2px] text-[#888888]">{mov.to_unit}</td>
                      <td className="px-3 py-[2px] text-[#888888]">{mov.reason}</td>
                      <td className="px-3 py-[2px] text-[#888888]">{mov.moved_at}</td>
                      <td className="px-3 py-[2px] text-[#888888]">{mov.moved_by}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Stats Tab ═══ */}
      {activeTab === 'stats' && (
        <div className="space-y-4">
          {statsLoading ? (
            <div className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin mx-auto text-[#888888]" /></div>
          ) : stats ? (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-[#141414] border border-[#222222] rounded-[2px] p-3">
                  <div className="text-lg font-bold text-white">{stats.total_inmates}</div>
                  <div className="text-[10px] text-[#888888] uppercase tracking-wider">Total Inmates</div>
                </div>
                <div className="bg-[#141414] border border-[#222222] rounded-[2px] p-3">
                  <div className="text-lg font-bold text-white">{stats.total_capacity}</div>
                  <div className="text-[10px] text-[#888888] uppercase tracking-wider">Total Capacity</div>
                </div>
                <div className="bg-[#141414] border border-[#222222] rounded-[2px] p-3">
                  <div className="text-lg font-bold text-[#d4a017]">{stats.occupancy_pct}%</div>
                  <div className="text-[10px] text-[#888888] uppercase tracking-wider">Occupancy</div>
                </div>
                <div className="bg-[#141414] border border-[#222222] rounded-[2px] p-3">
                  <div className="text-lg font-bold text-white">{Object.keys(stats.by_classification).length}</div>
                  <div className="text-[10px] text-[#888888] uppercase tracking-wider">Classifications</div>
                </div>
              </div>

              {/* Status breakdown */}
              <div className="bg-[#141414] border border-[#222222] rounded-[2px] p-4">
                <h4 className="text-xs font-semibold text-[#d4a017] mb-3 uppercase">By Status</h4>
                <div className="space-y-2">
                  {Object.entries(stats.by_status).map(([status, count]) => (
                    <div key={status} className="flex items-center gap-3">
                      <span className="text-xs text-[#888888] capitalize w-32">{status.replace(/_/g, ' ')}</span>
                      <div className="flex-1 bg-[#0a0a0a] rounded-full h-2">
                        <div className="h-2 rounded-full bg-[#d4a017]"
                          style={{ width: `${stats.total_inmates > 0 ? (count / stats.total_inmates) * 100 : 0}%` }} />
                      </div>
                      <span className="text-xs text-white font-mono w-8 text-right">{count}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Classification breakdown */}
              <div className="bg-[#141414] border border-[#222222] rounded-[2px] p-4">
                <h4 className="text-xs font-semibold text-[#d4a017] mb-3 uppercase">By Classification</h4>
                <div className="space-y-2">
                  {Object.entries(stats.by_classification).map(([cls, count]) => (
                    <div key={cls} className="flex items-center gap-3">
                      <span className="text-xs text-[#888888] capitalize w-40">{cls.replace(/_/g, ' ')}</span>
                      <div className="flex-1 bg-[#0a0a0a] rounded-full h-2">
                        <div className="h-2 rounded-full bg-amber-500"
                          style={{ width: `${stats.total_inmates > 0 ? (count / stats.total_inmates) * 100 : 0}%` }} />
                      </div>
                      <span className="text-xs text-white font-mono w-8 text-right">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-12 text-[#888888] text-sm">No statistics available</div>
          )}
        </div>
      )}
    </div>
  );
}
