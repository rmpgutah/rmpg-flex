// ============================================================
// RMPG Flex — Dispatch Geography Management
// Manage Areas, Sections, Zones, Beats, Dispatch Codes,
// and Premise Alerts. Full CRUD with tree view + stats.
// ============================================================

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  MapPin, Layers, Grid3X3, Target, Hash, AlertTriangle,
  Plus, Pencil, Trash2, ChevronRight, ChevronDown, Search,
  Radio, Shield, Users, BarChart3, RefreshCw, Save, X,
  Eye, EyeOff, Zap, Crosshair, FileText, Copy
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

// ── Types ──────────────────────────────────────────────────

interface Area {
  id: number; area_code: string; area_name: string; color: string;
  description?: string; commander?: string; notes?: string;
  sort_order: number; active: number; section_count?: number;
}

interface Section {
  id: number; section_code: string; section_name: string;
  area_id?: number; area_code?: string; area_name?: string;
  color: string; description?: string; supervisor?: string;
  radio_channel?: string; notes?: string; sort_order: number;
  active: number; zone_count?: number;
}

interface Zone {
  id: number; zone_code: string; zone_name: string;
  section_id?: number; section_code?: string; section_name?: string;
  color?: string; description?: string; primary_unit?: string;
  backup_unit?: string; radio_channel?: string; hazard_notes?: string;
  notes?: string; population_estimate?: number; sq_miles?: number;
  sort_order: number; active: number; beat_count?: number; active_calls?: number;
}

interface Beat {
  id: number; beat_code: string; beat_name: string; beat_descriptor?: string;
  zone_id?: number; zone_code?: string; zone_name?: string;
  section_code?: string; section_name?: string;
  dispatch_code?: string; color?: string; assigned_unit?: string;
  backup_unit?: string; hazard_notes?: string; patrol_frequency?: string;
  priority_modifier?: number; population_estimate?: number; sq_miles?: number;
  notes?: string; sort_order: number; active: number; active_calls?: number;
}

interface DispatchCode {
  id: number; code: string; description: string; category: string;
  priority: string; color: string; requires_backup: number;
  officer_safety: number; ems_needed: number; fire_needed: number;
  notes?: string; sort_order: number; active: number;
}

interface PremiseAlert {
  id: number; address: string; latitude?: number; longitude?: number;
  alert_type: string; alert_level: string; title: string;
  description?: string; flags: string; expires_at?: string;
  created_by?: number; active: number;
}

interface GeoStats {
  days: number;
  section_stats: { code: string; name: string; total_calls: number; p1_calls: number; p2_calls: number; active_calls: number; avg_response_sec: number }[];
  zone_stats: { code: string; name: string; section_id: string; total_calls: number; active_calls: number; avg_response_sec: number }[];
  beat_stats: { code: string; name: string; zone_id: string; total_calls: number; active_calls: number }[];
}

type Tab = 'tree' | 'areas' | 'sections' | 'zones' | 'beats' | 'codes' | 'premises' | 'stats';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'tree', label: 'Tree View', icon: <Layers className="w-3.5 h-3.5" /> },
  { id: 'areas', label: 'Areas', icon: <MapPin className="w-3.5 h-3.5" /> },
  { id: 'sections', label: 'Sections', icon: <Grid3X3 className="w-3.5 h-3.5" /> },
  { id: 'zones', label: 'Zones', icon: <Target className="w-3.5 h-3.5" /> },
  { id: 'beats', label: 'Beats', icon: <Crosshair className="w-3.5 h-3.5" /> },
  { id: 'codes', label: 'Dispatch Codes', icon: <Hash className="w-3.5 h-3.5" /> },
  { id: 'premises', label: 'Premise Alerts', icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  { id: 'stats', label: 'Statistics', icon: <BarChart3 className="w-3.5 h-3.5" /> },
];

const CODE_CATEGORIES = [
  { value: 'all', label: 'All Categories' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'violent', label: 'Violent Crime' },
  { value: 'property', label: 'Property Crime' },
  { value: 'traffic', label: 'Traffic' },
  { value: 'medical', label: 'Medical' },
  { value: 'fire', label: 'Fire' },
  { value: 'pursuit', label: 'Pursuit' },
  { value: 'enforcement', label: 'Enforcement' },
  { value: 'community', label: 'Community' },
  { value: 'status', label: 'Status' },
  { value: 'comm', label: 'Communications' },
  { value: 'response', label: 'Response' },
  { value: 'admin', label: 'Administrative' },
  { value: 'general', label: 'General' },
];

const PRIORITY_COLORS: Record<string, string> = {
  P1: 'bg-red-600 text-white',
  P2: 'bg-amber-600 text-white',
  P3: 'bg-blue-600 text-white',
  P4: 'bg-[#2b2b2b] text-white',
};

// ── Page Component ─────────────────────────────────────────

export default function GeographyPage() {
  const [tab, setTab] = useState<Tab>('tree');
  const [areas, setAreas] = useState<Area[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [beats, setBeats] = useState<Beat[]>([]);
  const [codes, setCodes] = useState<DispatchCode[]>([]);
  const [premises, setPremises] = useState<PremiseAlert[]>([]);
  const [stats, setStats] = useState<GeoStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [codeCategory, setCodeCategory] = useState('all');
  const [editModal, setEditModal] = useState<{ type: string; item: any } | null>(null);
  const [expandedTree, setExpandedTree] = useState<Set<string>>(new Set());

  // ── Data Fetching ───────────────────────────────────────

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [a, s, z, b] = await Promise.all([
        apiFetch<Area[]>('/dispatch/geography/areas'),
        apiFetch<Section[]>('/dispatch/geography/sections'),
        apiFetch<Zone[]>('/dispatch/geography/zones'),
        apiFetch<Beat[]>('/dispatch/geography/beats'),
      ]);
      if (a) setAreas(a);
      if (s) setSections(s);
      if (z) setZones(z);
      if (b) setBeats(b);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const loadCodes = useCallback(async () => {
    try {
      const c = await apiFetch<DispatchCode[]>(`/dispatch/geography/codes?category=${codeCategory}${search ? '&search=' + encodeURIComponent(search) : ''}`);
      if (c) setCodes(c);
    } catch { /* ignore */ }
  }, [codeCategory, search]);

  const loadPremises = useCallback(async () => {
    try {
      const p = await apiFetch<PremiseAlert[]>(`/dispatch/geography/premise-alerts${search ? '?address=' + encodeURIComponent(search) : ''}`);
      if (p) setPremises(p);
    } catch { /* ignore */ }
  }, [search]);

  const loadStats = useCallback(async () => {
    try {
      const s = await apiFetch<GeoStats>('/dispatch/geography/stats?days=30');
      if (s) setStats(s);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { if (tab === 'codes') loadCodes(); }, [tab, loadCodes]);
  useEffect(() => { if (tab === 'premises') loadPremises(); }, [tab, loadPremises]);
  useEffect(() => { if (tab === 'stats') loadStats(); }, [tab, loadStats]);

  // ── CRUD Operations ─────────────────────────────────────

  const saveEntity = useCallback(async (type: string, data: any) => {
    const endpoint = type === 'code' ? 'codes' : type === 'premise' ? 'premise-alerts' : type + 's';
    const method = data.id ? 'PUT' : 'POST';
    const url = data.id ? `/dispatch/geography/${endpoint}/${data.id}` : `/dispatch/geography/${endpoint}`;
    try {
      const result = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (result) {
        setEditModal(null);
        if (['area', 'section', 'zone', 'beat'].includes(type)) loadAll();
        if (type === 'code') loadCodes();
        if (type === 'premise') loadPremises();
      }
    } catch (err) {
      console.error('Save failed:', err);
    }
  }, [loadAll, loadCodes, loadPremises]);

  const deleteEntity = useCallback(async (type: string, id: number) => {
    if (!confirm('Delete this item? This cannot be undone.')) return;
    const endpoint = type === 'code' ? 'codes' : type === 'premise' ? 'premise-alerts' : type + 's';
    try {
      await apiFetch(`/dispatch/geography/${endpoint}/${id}`, { method: 'DELETE' });
      if (['area', 'section', 'zone', 'beat'].includes(type)) loadAll();
      if (type === 'code') loadCodes();
      if (type === 'premise') loadPremises();
    } catch { /* ignore */ }
  }, [loadAll, loadCodes, loadPremises]);

  // ── Tree View Helpers ───────────────────────────────────

  const toggleExpand = (key: string) => {
    setExpandedTree(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const expandAll = () => {
    const keys = new Set<string>();
    areas.forEach(a => keys.add('area-' + a.id));
    sections.forEach(s => keys.add('section-' + s.id));
    zones.forEach(z => keys.add('zone-' + z.id));
    setExpandedTree(keys);
  };

  // ── Search Filtering ────────────────────────────────────

  const filteredAreas = useMemo(() => {
    if (!search) return areas;
    const q = search.toLowerCase();
    return areas.filter(a => a.area_code.toLowerCase().includes(q) || a.area_name.toLowerCase().includes(q));
  }, [areas, search]);

  const filteredSections = useMemo(() => {
    if (!search) return sections;
    const q = search.toLowerCase();
    return sections.filter(s => s.section_code.toLowerCase().includes(q) || s.section_name.toLowerCase().includes(q));
  }, [sections, search]);

  const filteredZones = useMemo(() => {
    if (!search) return zones;
    const q = search.toLowerCase();
    return zones.filter(z => z.zone_code.toLowerCase().includes(q) || z.zone_name.toLowerCase().includes(q));
  }, [zones, search]);

  const filteredBeats = useMemo(() => {
    if (!search) return beats;
    const q = search.toLowerCase();
    return beats.filter(b => b.beat_code.toLowerCase().includes(q) || b.beat_name.toLowerCase().includes(q) || (b.beat_descriptor || '').toLowerCase().includes(q));
  }, [beats, search]);

  // ── Render ──────────────────────────────────────────────

  return (
    <div className="p-4 space-y-3 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MapPin className="w-5 h-5 text-blue-400" />
          <h1 className="text-lg font-bold text-white">Dispatch Geography</h1>
          <span className="text-[10px] text-rmpg-400 font-mono bg-surface-sunken px-2 py-0.5 rounded-sm">
            {areas.length} Areas · {sections.length} Sections · {zones.length} Zones · {beats.length} Beats
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { loadAll(); if (tab === 'codes') loadCodes(); if (tab === 'premises') loadPremises(); if (tab === 'stats') loadStats(); }}
            className="btn-sm btn-ghost" title="Refresh">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 overflow-x-auto border-b border-rmpg-700 pb-1">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-t-sm whitespace-nowrap transition-colors ${
              tab === t.id ? 'bg-surface-raised text-white border-b-2 border-blue-500' : 'text-rmpg-400 hover:text-rmpg-200 hover:bg-surface-sunken'
            }`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Search Bar (shared across tabs) */}
      {tab !== 'stats' && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-500" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder={tab === 'codes' ? 'Search codes...' : tab === 'premises' ? 'Search by address...' : 'Search...'}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-surface-sunken border border-rmpg-600 rounded-sm text-white placeholder-rmpg-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
          {tab === 'codes' && (
            <select value={codeCategory} onChange={e => setCodeCategory(e.target.value)}
              className="text-xs bg-surface-sunken border border-rmpg-600 rounded-sm text-white px-2 py-1.5">
              {CODE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          )}
          {['areas', 'sections', 'zones', 'beats', 'codes', 'premises'].includes(tab) && (
            <button onClick={() => setEditModal({ type: tab.replace(/s$/, '').replace('premise', 'premise'), item: {} })}
              className="btn-sm btn-primary flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          )}
        </div>
      )}

      {/* Tab Content */}
      <div className="bg-surface-base border border-rmpg-700 rounded-sm">
        {tab === 'tree' && (
          <TreeView areas={areas} sections={sections} zones={zones} beats={beats}
            expanded={expandedTree} onToggle={toggleExpand} onExpandAll={expandAll}
            onEdit={(type, item) => setEditModal({ type, item })}
            onDelete={(type, id) => deleteEntity(type, id)} />
        )}
        {tab === 'areas' && <AreaList items={filteredAreas} onEdit={item => setEditModal({ type: 'area', item })} onDelete={id => deleteEntity('area', id)} />}
        {tab === 'sections' && <SectionList items={filteredSections} onEdit={item => setEditModal({ type: 'section', item })} onDelete={id => deleteEntity('section', id)} />}
        {tab === 'zones' && <ZoneList items={filteredZones} onEdit={item => setEditModal({ type: 'zone', item })} onDelete={id => deleteEntity('zone', id)} />}
        {tab === 'beats' && <BeatList items={filteredBeats} onEdit={item => setEditModal({ type: 'beat', item })} onDelete={id => deleteEntity('beat', id)} />}
        {tab === 'codes' && <CodeList items={codes} onEdit={item => setEditModal({ type: 'code', item })} onDelete={id => deleteEntity('code', id)} />}
        {tab === 'premises' && <PremiseList items={premises} onEdit={item => setEditModal({ type: 'premise', item })} onDelete={id => deleteEntity('premise', id)} />}
        {tab === 'stats' && <StatsView stats={stats} />}
      </div>

      {/* Edit Modal */}
      {editModal && (
        <EditModal type={editModal.type} item={editModal.item} onSave={saveEntity} onClose={() => setEditModal(null)}
          areas={areas} sections={sections} zones={zones} />
      )}
    </div>
  );
}

// ── Tree View ─────────────────────────────────────────────

function TreeView({ areas, sections, zones, beats, expanded, onToggle, onExpandAll, onEdit, onDelete }: {
  areas: Area[]; sections: Section[]; zones: Zone[]; beats: Beat[];
  expanded: Set<string>; onToggle: (k: string) => void; onExpandAll: () => void;
  onEdit: (type: string, item: any) => void; onDelete: (type: string, id: number) => void;
}) {
  const sectionsByArea = useMemo(() => {
    const map = new Map<number | null, Section[]>();
    for (const s of sections) {
      const key = s.area_id || null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return map;
  }, [sections]);

  const zonesBySection = useMemo(() => {
    const map = new Map<number, Zone[]>();
    for (const z of zones) {
      if (z.section_id) {
        if (!map.has(z.section_id)) map.set(z.section_id, []);
        map.get(z.section_id)!.push(z);
      }
    }
    return map;
  }, [zones]);

  const beatsByZone = useMemo(() => {
    const map = new Map<number, Beat[]>();
    for (const b of beats) {
      if (b.zone_id) {
        if (!map.has(b.zone_id)) map.set(b.zone_id, []);
        map.get(b.zone_id)!.push(b);
      }
    }
    return map;
  }, [beats]);

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider">Dispatch Geography Hierarchy</span>
        <button onClick={onExpandAll} className="text-[10px] text-blue-400 hover:text-blue-300">Expand All</button>
      </div>

      {areas.map(area => {
        const aKey = 'area-' + area.id;
        const isOpen = expanded.has(aKey);
        const areaSections = sectionsByArea.get(area.id) || [];
        return (
          <div key={area.id} className="mb-1">
            <TreeNode level={0} color={area.color} code={area.area_code} name={area.area_name}
              count={areaSections.length} countLabel="sections" isOpen={isOpen}
              onToggle={() => onToggle(aKey)} onEdit={() => onEdit('area', area)} onDelete={() => onDelete('area', area.id)} />
            {isOpen && areaSections.map(section => {
              const sKey = 'section-' + section.id;
              const sOpen = expanded.has(sKey);
              const secZones = zonesBySection.get(section.id) || [];
              return (
                <div key={section.id}>
                  <TreeNode level={1} color={section.color} code={section.section_code} name={section.section_name}
                    count={secZones.length} countLabel="zones" isOpen={sOpen}
                    onToggle={() => onToggle(sKey)} onEdit={() => onEdit('section', section)} onDelete={() => onDelete('section', section.id)}
                    extra={section.radio_channel ? <span className="text-[9px] text-cyan-400 ml-2"><Radio className="w-2.5 h-2.5 inline" /> {section.radio_channel}</span> : null} />
                  {sOpen && secZones.map(zone => {
                    const zKey = 'zone-' + zone.id;
                    const zOpen = expanded.has(zKey);
                    const zoneBeats = beatsByZone.get(zone.id) || [];
                    return (
                      <div key={zone.id}>
                        <TreeNode level={2} color={zone.color || section.color} code={zone.zone_code} name={zone.zone_name}
                          count={zoneBeats.length} countLabel="beats" isOpen={zOpen}
                          onToggle={() => onToggle(zKey)} onEdit={() => onEdit('zone', zone)} onDelete={() => onDelete('zone', zone.id)}
                          extra={
                            <>
                              {zone.primary_unit && <span className="text-[9px] text-green-400 ml-2"><Shield className="w-2.5 h-2.5 inline" /> {zone.primary_unit}</span>}
                              {(zone.active_calls || 0) > 0 && <span className="text-[9px] text-amber-400 ml-2">{zone.active_calls} active</span>}
                            </>
                          } />
                        {zOpen && zoneBeats.map(beat => (
                          <TreeNode key={beat.id} level={3} color={beat.color || zone.color || section.color} code={beat.beat_code} name={beat.beat_name}
                            subtitle={beat.beat_descriptor} isLeaf
                            onEdit={() => onEdit('beat', beat)} onDelete={() => onDelete('beat', beat.id)}
                            extra={
                              <>
                                {beat.dispatch_code && <span className="text-[9px] text-rmpg-400 ml-2 font-mono">{beat.dispatch_code}</span>}
                                {beat.assigned_unit && <span className="text-[9px] text-green-400 ml-2"><Shield className="w-2.5 h-2.5 inline" /> {beat.assigned_unit}</span>}
                                {beat.hazard_notes && <span className="text-[9px] text-red-400 ml-2"><AlertTriangle className="w-2.5 h-2.5 inline" /></span>}
                                {(beat.active_calls || 0) > 0 && <span className="text-[9px] text-amber-400 ml-2">{beat.active_calls} active</span>}
                              </>
                            } />
                        ))}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Unassigned sections (no area) */}
      {(sectionsByArea.get(null) || []).length > 0 && (
        <div className="mt-4 pt-3 border-t border-rmpg-700">
          <span className="text-[10px] text-rmpg-500 uppercase font-bold">Unassigned Sections</span>
          {(sectionsByArea.get(null) || []).map(section => {
            const sKey = 'section-' + section.id;
            const sOpen = expanded.has(sKey);
            const secZones = zonesBySection.get(section.id) || [];
            return (
              <div key={section.id}>
                <TreeNode level={0} color={section.color} code={section.section_code} name={section.section_name}
                  count={secZones.length} countLabel="zones" isOpen={sOpen}
                  onToggle={() => onToggle(sKey)} onEdit={() => onEdit('section', section)} onDelete={() => onDelete('section', section.id)} />
                {sOpen && secZones.map(zone => {
                  const zKey = 'zone-' + zone.id;
                  const zOpen = expanded.has(zKey);
                  const zoneBeats = beatsByZone.get(zone.id) || [];
                  return (
                    <div key={zone.id}>
                      <TreeNode level={1} color={zone.color || section.color} code={zone.zone_code} name={zone.zone_name}
                        count={zoneBeats.length} countLabel="beats" isOpen={zOpen}
                        onToggle={() => onToggle(zKey)} onEdit={() => onEdit('zone', zone)} onDelete={() => onDelete('zone', zone.id)} />
                      {zOpen && zoneBeats.map(beat => (
                        <TreeNode key={beat.id} level={2} color={beat.color || section.color} code={beat.beat_code} name={beat.beat_name}
                          subtitle={beat.beat_descriptor} isLeaf
                          onEdit={() => onEdit('beat', beat)} onDelete={() => onDelete('beat', beat.id)} />
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Tree Node Component ───────────────────────────────────

function TreeNode({ level, color, code, name, subtitle, count, countLabel, isOpen, isLeaf, onToggle, onEdit, onDelete, extra }: {
  level: number; color?: string; code: string; name: string; subtitle?: string;
  count?: number; countLabel?: string; isOpen?: boolean; isLeaf?: boolean;
  onToggle?: () => void; onEdit: () => void; onDelete: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-center group hover:bg-surface-raised/50 py-1 px-1 rounded-sm"
      style={{ paddingLeft: `${level * 24 + 8}px` }}>
      {!isLeaf ? (
        <button onClick={onToggle} className="w-4 h-4 flex items-center justify-center text-rmpg-400 hover:text-white mr-1">
          {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
      ) : (
        <span className="w-4 h-4 mr-1" />
      )}
      <span className="w-2.5 h-2.5 rounded-full mr-2 flex-shrink-0" style={{ backgroundColor: color || '#666666' }} />
      <span className="text-[11px] font-mono text-blue-400 mr-2 min-w-[50px]">{code}</span>
      <span className="text-[11px] text-white font-medium mr-1">{name}</span>
      {subtitle && <span className="text-[10px] text-rmpg-400 mr-2">— {subtitle}</span>}
      {count !== undefined && <span className="text-[9px] text-rmpg-500 mr-2">({count} {countLabel})</span>}
      {extra}
      <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onEdit} className="p-0.5 text-rmpg-400 hover:text-blue-400"><Pencil className="w-3 h-3" /></button>
        <button onClick={onDelete} className="p-0.5 text-rmpg-400 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
      </div>
    </div>
  );
}

// ── List Views ────────────────────────────────────────────

function AreaList({ items, onEdit, onDelete }: { items: Area[]; onEdit: (a: Area) => void; onDelete: (id: number) => void }) {
  if (items.length === 0) return <div className="p-8 text-center text-rmpg-500 text-sm">No areas defined. Click "Add" to create one.</div>;
  return (
    <div className="divide-y divide-rmpg-700">
      <div className="grid grid-cols-[40px_100px_1fr_120px_120px_80px_80px] gap-2 px-3 py-1.5 text-[9px] text-rmpg-500 uppercase font-bold bg-surface-sunken">
        <span />
        <span>Code</span><span>Name</span><span>Commander</span><span>Description</span><span>Sections</span><span />
      </div>
      {items.map(a => (
        <div key={a.id} className="grid grid-cols-[40px_100px_1fr_120px_120px_80px_80px] gap-2 px-3 py-2 items-center text-xs hover:bg-surface-raised/40 group">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: a.color }} />
          <span className="font-mono text-blue-400">{a.area_code}</span>
          <span className="text-white font-medium">{a.area_name}</span>
          <span className="text-rmpg-400 truncate">{a.commander || '—'}</span>
          <span className="text-rmpg-400 truncate">{a.description || '—'}</span>
          <span className="text-rmpg-300">{a.section_count || 0}</span>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100">
            <button onClick={() => onEdit(a)} className="p-0.5 text-rmpg-400 hover:text-blue-400"><Pencil className="w-3 h-3" /></button>
            <button onClick={() => onDelete(a.id)} className="p-0.5 text-rmpg-400 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionList({ items, onEdit, onDelete }: { items: Section[]; onEdit: (s: Section) => void; onDelete: (id: number) => void }) {
  if (items.length === 0) return <div className="p-8 text-center text-rmpg-500 text-sm">No sections defined.</div>;
  return (
    <div className="divide-y divide-rmpg-700">
      <div className="grid grid-cols-[40px_80px_1fr_100px_100px_80px_80px_80px] gap-2 px-3 py-1.5 text-[9px] text-rmpg-500 uppercase font-bold bg-surface-sunken">
        <span /><span>Code</span><span>Name</span><span>Area</span><span>Supervisor</span><span>Radio</span><span>Zones</span><span />
      </div>
      {items.map(s => (
        <div key={s.id} className="grid grid-cols-[40px_80px_1fr_100px_100px_80px_80px_80px] gap-2 px-3 py-2 items-center text-xs hover:bg-surface-raised/40 group">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
          <span className="font-mono text-blue-400">{s.section_code}</span>
          <span className="text-white font-medium">{s.section_name}</span>
          <span className="text-rmpg-400 truncate">{s.area_name || '—'}</span>
          <span className="text-rmpg-400 truncate">{s.supervisor || '—'}</span>
          <span className="text-cyan-400 text-[10px]">{s.radio_channel || '—'}</span>
          <span className="text-rmpg-300">{s.zone_count || 0}</span>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100">
            <button onClick={() => onEdit(s)} className="p-0.5 text-rmpg-400 hover:text-blue-400"><Pencil className="w-3 h-3" /></button>
            <button onClick={() => onDelete(s.id)} className="p-0.5 text-rmpg-400 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ZoneList({ items, onEdit, onDelete }: { items: Zone[]; onEdit: (z: Zone) => void; onDelete: (id: number) => void }) {
  if (items.length === 0) return <div className="p-8 text-center text-rmpg-500 text-sm">No zones defined.</div>;
  return (
    <div className="divide-y divide-rmpg-700">
      <div className="grid grid-cols-[40px_80px_1fr_100px_100px_80px_80px_80px_60px_80px] gap-2 px-3 py-1.5 text-[9px] text-rmpg-500 uppercase font-bold bg-surface-sunken">
        <span /><span>Code</span><span>Name</span><span>Section</span><span>Primary Unit</span><span>Backup</span><span>Radio</span><span>Beats</span><span>Active</span><span />
      </div>
      {items.map(z => (
        <div key={z.id} className="grid grid-cols-[40px_80px_1fr_100px_100px_80px_80px_80px_60px_80px] gap-2 px-3 py-2 items-center text-xs hover:bg-surface-raised/40 group">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: z.color || '#666666' }} />
          <span className="font-mono text-blue-400">{z.zone_code}</span>
          <span className="text-white font-medium">{z.zone_name}</span>
          <span className="text-rmpg-400 truncate">{z.section_name || '—'}</span>
          <span className="text-green-400 text-[10px]">{z.primary_unit || '—'}</span>
          <span className="text-rmpg-400 text-[10px]">{z.backup_unit || '—'}</span>
          <span className="text-cyan-400 text-[10px]">{z.radio_channel || '—'}</span>
          <span className="text-rmpg-300">{z.beat_count || 0}</span>
          <span className={`text-[10px] ${(z.active_calls || 0) > 0 ? 'text-amber-400 font-bold' : 'text-rmpg-500'}`}>{z.active_calls || 0}</span>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100">
            <button onClick={() => onEdit(z)} className="p-0.5 text-rmpg-400 hover:text-blue-400"><Pencil className="w-3 h-3" /></button>
            <button onClick={() => onDelete(z.id)} className="p-0.5 text-rmpg-400 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

function BeatList({ items, onEdit, onDelete }: { items: Beat[]; onEdit: (b: Beat) => void; onDelete: (id: number) => void }) {
  if (items.length === 0) return <div className="p-8 text-center text-rmpg-500 text-sm">No beats defined.</div>;
  return (
    <div className="divide-y divide-rmpg-700">
      <div className="grid grid-cols-[40px_100px_1fr_100px_100px_80px_80px_60px_60px_80px] gap-2 px-3 py-1.5 text-[9px] text-rmpg-500 uppercase font-bold bg-surface-sunken">
        <span /><span>Code</span><span>Name</span><span>Zone</span><span>Dispatch Code</span><span>Unit</span><span>Patrol</span><span>Active</span><span>Hazard</span><span />
      </div>
      {items.map(b => (
        <div key={b.id} className="grid grid-cols-[40px_100px_1fr_100px_100px_80px_80px_60px_60px_80px] gap-2 px-3 py-2 items-center text-xs hover:bg-surface-raised/40 group">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: b.color || '#666666' }} />
          <span className="font-mono text-blue-400">{b.beat_code}</span>
          <div>
            <span className="text-white font-medium">{b.beat_name}</span>
            {b.beat_descriptor && <span className="text-rmpg-400 text-[10px] ml-1">— {b.beat_descriptor}</span>}
          </div>
          <span className="text-rmpg-400 truncate">{b.zone_name || '—'}</span>
          <span className="font-mono text-rmpg-300 text-[10px]">{b.dispatch_code || '—'}</span>
          <span className="text-green-400 text-[10px]">{b.assigned_unit || '—'}</span>
          <span className={`text-[10px] ${b.patrol_frequency === 'high' ? 'text-amber-400' : b.patrol_frequency === 'low' ? 'text-rmpg-500' : 'text-rmpg-300'}`}>
            {b.patrol_frequency || 'normal'}
          </span>
          <span className={`text-[10px] ${(b.active_calls || 0) > 0 ? 'text-amber-400 font-bold' : 'text-rmpg-500'}`}>{b.active_calls || 0}</span>
          <span>{b.hazard_notes ? <AlertTriangle className="w-3 h-3 text-red-400" /> : <span className="text-rmpg-600">—</span>}</span>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100">
            <button onClick={() => onEdit(b)} className="p-0.5 text-rmpg-400 hover:text-blue-400"><Pencil className="w-3 h-3" /></button>
            <button onClick={() => onDelete(b.id)} className="p-0.5 text-rmpg-400 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

function CodeList({ items, onEdit, onDelete }: { items: DispatchCode[]; onEdit: (c: DispatchCode) => void; onDelete: (id: number) => void }) {
  if (items.length === 0) return <div className="p-8 text-center text-rmpg-500 text-sm">No dispatch codes found.</div>;
  return (
    <div className="divide-y divide-rmpg-700">
      <div className="grid grid-cols-[80px_1fr_100px_60px_60px_60px_60px_60px_80px] gap-2 px-3 py-1.5 text-[9px] text-rmpg-500 uppercase font-bold bg-surface-sunken">
        <span>Code</span><span>Description</span><span>Category</span><span>Priority</span><span>Backup</span><span>Safety</span><span>EMS</span><span>Fire</span><span />
      </div>
      {items.map(c => (
        <div key={c.id} className="grid grid-cols-[80px_1fr_100px_60px_60px_60px_60px_60px_80px] gap-2 px-3 py-2 items-center text-xs hover:bg-surface-raised/40 group">
          <span className="font-mono font-bold" style={{ color: c.color }}>{c.code}</span>
          <span className="text-white">{c.description}</span>
          <span className="text-rmpg-400 capitalize text-[10px]">{c.category}</span>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-sm text-center ${PRIORITY_COLORS[c.priority] || ''}`}>{c.priority}</span>
          <span className="text-center">{c.requires_backup ? <Shield className="w-3 h-3 text-amber-400 mx-auto" /> : '—'}</span>
          <span className="text-center">{c.officer_safety ? <AlertTriangle className="w-3 h-3 text-red-400 mx-auto" /> : '—'}</span>
          <span className="text-center">{c.ems_needed ? <Zap className="w-3 h-3 text-blue-400 mx-auto" /> : '—'}</span>
          <span className="text-center">{c.fire_needed ? <Zap className="w-3 h-3 text-orange-400 mx-auto" /> : '—'}</span>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100">
            <button onClick={() => onEdit(c)} className="p-0.5 text-rmpg-400 hover:text-blue-400"><Pencil className="w-3 h-3" /></button>
            <button onClick={() => onDelete(c.id)} className="p-0.5 text-rmpg-400 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

function PremiseList({ items, onEdit, onDelete }: { items: PremiseAlert[]; onEdit: (p: PremiseAlert) => void; onDelete: (id: number) => void }) {
  if (items.length === 0) return <div className="p-8 text-center text-rmpg-500 text-sm">No premise alerts. Click "Add" to flag a location.</div>;
  const levelColors: Record<string, string> = { critical: 'text-red-400', warning: 'text-amber-400', info: 'text-blue-400' };
  return (
    <div className="divide-y divide-rmpg-700">
      <div className="grid grid-cols-[80px_1fr_120px_80px_80px_120px_80px] gap-2 px-3 py-1.5 text-[9px] text-rmpg-500 uppercase font-bold bg-surface-sunken">
        <span>Level</span><span>Title</span><span>Address</span><span>Type</span><span>Flags</span><span>Expires</span><span />
      </div>
      {items.map(p => (
        <div key={p.id} className="grid grid-cols-[80px_1fr_120px_80px_80px_120px_80px] gap-2 px-3 py-2 items-center text-xs hover:bg-surface-raised/40 group">
          <span className={`font-bold uppercase text-[10px] ${levelColors[p.alert_level] || 'text-rmpg-400'}`}>{p.alert_level}</span>
          <div>
            <span className="text-white font-medium">{p.title}</span>
            {p.description && <div className="text-[10px] text-rmpg-400 truncate">{p.description}</div>}
          </div>
          <span className="text-rmpg-300 truncate text-[10px]">{p.address}</span>
          <span className="text-rmpg-400 capitalize text-[10px]">{p.alert_type}</span>
          <span className="text-[10px] text-rmpg-400">
            {(() => { try { return JSON.parse(p.flags || '[]').length; } catch { return 0; } })() || '—'}
          </span>
          <span className="text-[10px] text-rmpg-400">{p.expires_at || 'Never'}</span>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100">
            <button onClick={() => onEdit(p)} className="p-0.5 text-rmpg-400 hover:text-blue-400"><Pencil className="w-3 h-3" /></button>
            <button onClick={() => onDelete(p.id)} className="p-0.5 text-rmpg-400 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Statistics View ───────────────────────────────────────

function StatsView({ stats }: { stats: GeoStats | null }) {
  if (!stats) return <div className="p-8 text-center text-rmpg-500 text-sm">Loading statistics...</div>;

  const formatTime = (sec: number | null) => {
    if (!sec || !Number.isFinite(sec)) return '—';
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}m ${s}s`;
  };

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center gap-2 text-[10px] text-rmpg-400">
        <BarChart3 className="w-3.5 h-3.5" /> Last {stats.days} Days
      </div>

      {/* Section Stats */}
      <div>
        <h3 className="text-xs font-bold text-white mb-2 flex items-center gap-2"><Grid3X3 className="w-3.5 h-3.5 text-blue-400" /> Section Activity</h3>
        {stats.section_stats.length === 0 ? (
          <p className="text-[10px] text-rmpg-500">No call data by section in this period.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {stats.section_stats.map(s => (
              <div key={s.code} className="bg-surface-sunken border border-rmpg-700 rounded-sm p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-white">{s.code} — {s.name}</span>
                  <span className="text-[10px] text-rmpg-400">{s.total_calls} calls</span>
                </div>
                <div className="grid grid-cols-4 gap-2 text-[10px]">
                  <div>
                    <div className="text-rmpg-500">P1</div>
                    <div className="text-red-400 font-bold">{s.p1_calls}</div>
                  </div>
                  <div>
                    <div className="text-rmpg-500">P2</div>
                    <div className="text-amber-400 font-bold">{s.p2_calls}</div>
                  </div>
                  <div>
                    <div className="text-rmpg-500">Active</div>
                    <div className="text-green-400 font-bold">{s.active_calls}</div>
                  </div>
                  <div>
                    <div className="text-rmpg-500">Avg Resp</div>
                    <div className="text-blue-400 font-bold">{formatTime(s.avg_response_sec)}</div>
                  </div>
                </div>
                {/* Simple bar */}
                <div className="mt-2 h-1.5 bg-rmpg-700 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(100, (s.total_calls / Math.max(1, stats.section_stats[0]?.total_calls || 1)) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Zone Stats */}
      <div>
        <h3 className="text-xs font-bold text-white mb-2 flex items-center gap-2"><Target className="w-3.5 h-3.5 text-green-400" /> Zone Activity</h3>
        {stats.zone_stats.length === 0 ? (
          <p className="text-[10px] text-rmpg-500">No call data by zone in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-rmpg-500 uppercase border-b border-rmpg-700">
                  <th className="text-left py-1 px-2">Zone</th>
                  <th className="text-right py-1 px-2">Total Calls</th>
                  <th className="text-right py-1 px-2">Active</th>
                  <th className="text-right py-1 px-2">Avg Response</th>
                </tr>
              </thead>
              <tbody>
                {stats.zone_stats.slice(0, 20).map(z => (
                  <tr key={z.code} className="border-b border-rmpg-800 hover:bg-surface-raised/30">
                    <td className="py-1.5 px-2 text-white font-medium">{z.code} — {z.name}</td>
                    <td className="py-1.5 px-2 text-right text-rmpg-300">{z.total_calls}</td>
                    <td className="py-1.5 px-2 text-right"><span className={z.active_calls > 0 ? 'text-amber-400 font-bold' : 'text-rmpg-500'}>{z.active_calls}</span></td>
                    <td className="py-1.5 px-2 text-right text-blue-400">{formatTime(z.avg_response_sec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Beat Stats */}
      <div>
        <h3 className="text-xs font-bold text-white mb-2 flex items-center gap-2"><Crosshair className="w-3.5 h-3.5 text-amber-400" /> Beat Activity (Top 20)</h3>
        {stats.beat_stats.length === 0 ? (
          <p className="text-[10px] text-rmpg-500">No call data by beat in this period.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2">
            {stats.beat_stats.slice(0, 20).map(b => (
              <div key={b.code} className="bg-surface-sunken border border-rmpg-700 rounded-sm p-2 text-center">
                <div className="text-[10px] font-mono text-blue-400 font-bold">{b.code}</div>
                <div className="text-[9px] text-rmpg-400 truncate">{b.name}</div>
                <div className="text-lg font-bold text-white mt-1">{b.total_calls}</div>
                <div className="text-[9px] text-rmpg-500">calls</div>
                {b.active_calls > 0 && <div className="text-[9px] text-amber-400 font-bold mt-0.5">{b.active_calls} active</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Edit Modal ────────────────────────────────────────────

function EditModal({ type, item, onSave, onClose, areas, sections, zones }: {
  type: string; item: any; onSave: (type: string, data: any) => void;
  onClose: () => void; areas: Area[]; sections: Section[]; zones: Zone[];
}) {
  const [form, setForm] = useState({ ...item });
  const isNew = !item.id;
  const title = `${isNew ? 'Create' : 'Edit'} ${type.charAt(0).toUpperCase() + type.slice(1)}`;

  const set = (field: string, value: any) => setForm((prev: any) => ({ ...prev, [field]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(type, form);
  };

  return (
    <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/80" onClick={onClose}>
      <div className="bg-surface-base border border-rmpg-600 rounded-sm w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2 border-b border-rmpg-700">
          <h2 className="text-sm font-bold text-white">{title}</h2>
          <button onClick={onClose} className="p-1 text-rmpg-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          {type === 'area' && (
            <>
              <FormField label="Area Code" required>
                <input value={form.area_code || ''} onChange={e => set('area_code', e.target.value)} className="form-input" placeholder="e.g., NORTH" />
              </FormField>
              <FormField label="Area Name" required>
                <input value={form.area_name || ''} onChange={e => set('area_name', e.target.value)} className="form-input" placeholder="e.g., North Area" />
              </FormField>
              <FormField label="Color">
                <div className="flex items-center gap-2">
                  <input type="color" value={form.color || '#888888'} onChange={e => set('color', e.target.value)} className="w-8 h-8 border-0 bg-transparent cursor-pointer" />
                  <input value={form.color || '#888888'} onChange={e => set('color', e.target.value)} className="form-input flex-1" />
                </div>
              </FormField>
              <FormField label="Commander"><input value={form.commander || ''} onChange={e => set('commander', e.target.value)} className="form-input" /></FormField>
              <FormField label="Description"><textarea value={form.description || ''} onChange={e => set('description', e.target.value)} className="form-input" rows={2} /></FormField>
              <FormField label="Notes"><textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)} className="form-input" rows={2} /></FormField>
            </>
          )}

          {type === 'section' && (
            <>
              <FormField label="Section Code" required>
                <input value={form.section_code || ''} onChange={e => set('section_code', e.target.value)} className="form-input" placeholder="e.g., SL1" />
              </FormField>
              <FormField label="Section Name" required>
                <input value={form.section_name || ''} onChange={e => set('section_name', e.target.value)} className="form-input" placeholder="e.g., Salt Lake Metro" />
              </FormField>
              <FormField label="Area">
                <select value={form.area_id || ''} onChange={e => set('area_id', e.target.value ? parseInt(e.target.value) : null)} className="form-input">
                  <option value="">— None —</option>
                  {areas.map(a => <option key={a.id} value={a.id}>{a.area_code} — {a.area_name}</option>)}
                </select>
              </FormField>
              <FormField label="Color">
                <div className="flex items-center gap-2">
                  <input type="color" value={form.color || '#888888'} onChange={e => set('color', e.target.value)} className="w-8 h-8 border-0 bg-transparent cursor-pointer" />
                  <input value={form.color || '#888888'} onChange={e => set('color', e.target.value)} className="form-input flex-1" />
                </div>
              </FormField>
              <FormField label="Supervisor"><input value={form.supervisor || ''} onChange={e => set('supervisor', e.target.value)} className="form-input" /></FormField>
              <FormField label="Radio Channel"><input value={form.radio_channel || ''} onChange={e => set('radio_channel', e.target.value)} className="form-input" placeholder="e.g., Ch 4" /></FormField>
              <FormField label="Notes"><textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)} className="form-input" rows={2} /></FormField>
            </>
          )}

          {type === 'zone' && (
            <>
              <FormField label="Zone Code" required>
                <input value={form.zone_code || ''} onChange={e => set('zone_code', e.target.value)} className="form-input" placeholder="e.g., SLC" />
              </FormField>
              <FormField label="Zone Name" required>
                <input value={form.zone_name || ''} onChange={e => set('zone_name', e.target.value)} className="form-input" placeholder="e.g., Salt Lake City" />
              </FormField>
              <FormField label="Section">
                <select value={form.section_id || ''} onChange={e => set('section_id', e.target.value ? parseInt(e.target.value) : null)} className="form-input">
                  <option value="">— None —</option>
                  {sections.map(s => <option key={s.id} value={s.id}>{s.section_code} — {s.section_name}</option>)}
                </select>
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Primary Unit"><input value={form.primary_unit || ''} onChange={e => set('primary_unit', e.target.value)} className="form-input" placeholder="e.g., S19" /></FormField>
                <FormField label="Backup Unit"><input value={form.backup_unit || ''} onChange={e => set('backup_unit', e.target.value)} className="form-input" /></FormField>
              </div>
              <FormField label="Radio Channel"><input value={form.radio_channel || ''} onChange={e => set('radio_channel', e.target.value)} className="form-input" /></FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Population Est"><input type="number" value={form.population_estimate || ''} onChange={e => set('population_estimate', parseInt(e.target.value) || null)} className="form-input" /></FormField>
                <FormField label="Sq Miles"><input type="number" step="0.1" value={form.sq_miles || ''} onChange={e => set('sq_miles', parseFloat(e.target.value) || null)} className="form-input" /></FormField>
              </div>
              <FormField label="Hazard Notes"><textarea value={form.hazard_notes || ''} onChange={e => set('hazard_notes', e.target.value)} className="form-input text-red-300" rows={2} placeholder="Safety warnings for this zone..." /></FormField>
              <FormField label="Notes"><textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)} className="form-input" rows={2} /></FormField>
            </>
          )}

          {type === 'beat' && (
            <>
              <FormField label="Beat Code" required>
                <input value={form.beat_code || ''} onChange={e => set('beat_code', e.target.value)} className="form-input" placeholder="e.g., SLC-A" />
              </FormField>
              <FormField label="Beat Name" required>
                <input value={form.beat_name || ''} onChange={e => set('beat_name', e.target.value)} className="form-input" placeholder="e.g., Downtown Core" />
              </FormField>
              <FormField label="Descriptor">
                <input value={form.beat_descriptor || ''} onChange={e => set('beat_descriptor', e.target.value)} className="form-input" placeholder="e.g., CBD / Financial District" />
              </FormField>
              <FormField label="Zone">
                <select value={form.zone_id || ''} onChange={e => set('zone_id', e.target.value ? parseInt(e.target.value) : null)} className="form-input">
                  <option value="">— None —</option>
                  {zones.map(z => <option key={z.id} value={z.id}>{z.zone_code} — {z.zone_name}</option>)}
                </select>
              </FormField>
              <FormField label="Dispatch Code"><input value={form.dispatch_code || ''} onChange={e => set('dispatch_code', e.target.value)} className="form-input font-mono" placeholder="e.g., SL1-SLC/A" /></FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Assigned Unit"><input value={form.assigned_unit || ''} onChange={e => set('assigned_unit', e.target.value)} className="form-input" placeholder="e.g., S19" /></FormField>
                <FormField label="Backup Unit"><input value={form.backup_unit || ''} onChange={e => set('backup_unit', e.target.value)} className="form-input" /></FormField>
              </div>
              <FormField label="Patrol Frequency">
                <select value={form.patrol_frequency || 'normal'} onChange={e => set('patrol_frequency', e.target.value)} className="form-input">
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </FormField>
              <FormField label="Priority Modifier">
                <input type="number" value={form.priority_modifier || 0} onChange={e => set('priority_modifier', parseInt(e.target.value) || 0)} className="form-input"
                  min={-2} max={2} />
                <span className="text-[9px] text-rmpg-500 mt-0.5">-2 to +2. Positive = higher urgency for calls in this beat</span>
              </FormField>
              <FormField label="Hazard Notes"><textarea value={form.hazard_notes || ''} onChange={e => set('hazard_notes', e.target.value)} className="form-input text-red-300" rows={2} placeholder="Officer safety warnings..." /></FormField>
              <FormField label="Notes"><textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)} className="form-input" rows={2} /></FormField>
            </>
          )}

          {type === 'code' && (
            <>
              <FormField label="Code" required>
                <input value={form.code || ''} onChange={e => set('code', e.target.value)} className="form-input font-mono" placeholder="e.g., 10-71" />
              </FormField>
              <FormField label="Description" required>
                <input value={form.description || ''} onChange={e => set('description', e.target.value)} className="form-input" placeholder="e.g., Shooting" />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Category">
                  <select value={form.category || 'general'} onChange={e => set('category', e.target.value)} className="form-input">
                    {CODE_CATEGORIES.filter(c => c.value !== 'all').map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </FormField>
                <FormField label="Priority">
                  <select value={form.priority || 'P3'} onChange={e => set('priority', e.target.value)} className="form-input">
                    <option value="P1">P1 — Emergency</option>
                    <option value="P2">P2 — Urgent</option>
                    <option value="P3">P3 — Routine</option>
                    <option value="P4">P4 — Low</option>
                  </select>
                </FormField>
              </div>
              <FormField label="Color">
                <div className="flex items-center gap-2">
                  <input type="color" value={form.color || '#666666'} onChange={e => set('color', e.target.value)} className="w-8 h-8 border-0 bg-transparent cursor-pointer" />
                  <input value={form.color || '#666666'} onChange={e => set('color', e.target.value)} className="form-input flex-1" />
                </div>
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center gap-2 text-xs text-rmpg-300">
                  <input type="checkbox" checked={!!form.requires_backup} onChange={e => set('requires_backup', e.target.checked ? 1 : 0)} className="rounded-sm" />
                  Requires Backup
                </label>
                <label className="flex items-center gap-2 text-xs text-rmpg-300">
                  <input type="checkbox" checked={!!form.officer_safety} onChange={e => set('officer_safety', e.target.checked ? 1 : 0)} className="rounded-sm" />
                  Officer Safety
                </label>
                <label className="flex items-center gap-2 text-xs text-rmpg-300">
                  <input type="checkbox" checked={!!form.ems_needed} onChange={e => set('ems_needed', e.target.checked ? 1 : 0)} className="rounded-sm" />
                  EMS Needed
                </label>
                <label className="flex items-center gap-2 text-xs text-rmpg-300">
                  <input type="checkbox" checked={!!form.fire_needed} onChange={e => set('fire_needed', e.target.checked ? 1 : 0)} className="rounded-sm" />
                  Fire Needed
                </label>
              </div>
              <FormField label="Notes"><textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)} className="form-input" rows={2} /></FormField>
            </>
          )}

          {type === 'premise' && (
            <>
              <FormField label="Address" required>
                <input value={form.address || ''} onChange={e => set('address', e.target.value)} className="form-input" placeholder="123 Main St, Salt Lake City, UT" />
              </FormField>
              <FormField label="Title" required>
                <input value={form.title || ''} onChange={e => set('title', e.target.value)} className="form-input" placeholder="e.g., Known Drug Activity" />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Alert Type">
                  <select value={form.alert_type || 'caution'} onChange={e => set('alert_type', e.target.value)} className="form-input">
                    <option value="caution">Caution</option>
                    <option value="weapons">Weapons</option>
                    <option value="violent">Violent History</option>
                    <option value="drugs">Drug Activity</option>
                    <option value="mental_health">Mental Health</option>
                    <option value="animal">Dangerous Animal</option>
                    <option value="hazmat">Hazmat</option>
                    <option value="repeat_offender">Repeat Offender</option>
                    <option value="other">Other</option>
                  </select>
                </FormField>
                <FormField label="Alert Level">
                  <select value={form.alert_level || 'info'} onChange={e => set('alert_level', e.target.value)} className="form-input">
                    <option value="info">Info</option>
                    <option value="warning">Warning</option>
                    <option value="critical">Critical</option>
                  </select>
                </FormField>
              </div>
              <FormField label="Description">
                <textarea value={form.description || ''} onChange={e => set('description', e.target.value)} className="form-input" rows={3} placeholder="Details about the premise alert..." />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Latitude"><input type="number" step="any" value={form.latitude || ''} onChange={e => set('latitude', parseFloat(e.target.value) || null)} className="form-input" /></FormField>
                <FormField label="Longitude"><input type="number" step="any" value={form.longitude || ''} onChange={e => set('longitude', parseFloat(e.target.value) || null)} className="form-input" /></FormField>
              </div>
              <FormField label="Expires At"><input type="datetime-local" value={form.expires_at || ''} onChange={e => set('expires_at', e.target.value)} className="form-input" /></FormField>
            </>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-rmpg-700">
            <button type="button" onClick={onClose} className="btn-sm btn-ghost">Cancel</button>
            <button type="submit" className="btn-sm btn-primary flex items-center gap-1"><Save className="w-3.5 h-3.5" /> {isNew ? 'Create' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FormField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] text-rmpg-400 uppercase font-bold mb-1 block">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
    </div>
  );
}
