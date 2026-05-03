// ============================================================
// RMPG Flex — Dispatch Geography Admin Page
//
// 4-column Miller drilldown: Areas → Sectors → Zones → Beats
// Right-side detail pane with view/edit/create + delete actions.
// Pure-black Spillman theme, zero blue hex.
//
// Phase 3 of the geography rebuild plan. Full spec in
// docs/plans/2026-04-10-geography-areas-sectors-zones-beats-design.md
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapPin, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useGeographyTree } from '../hooks/useGeographyTree';
import PanelTitleBar from '../components/PanelTitleBar';
import type { Area, Beat, Sector, TierId, Zone } from '../types/geography';
import {
  beatChartCode,
  sectionPrefix,
  zoneChartCode,
} from '../utils/dispatchGeoCode';

// ── Types ────────────────────────────────────────────────────

type SelectedItem =
  | { tier: 'area'; data: Area }
  | { tier: 'sector'; data: Sector }
  | { tier: 'zone'; data: Zone }
  | { tier: 'beat'; data: Beat }
  | null;

interface PageState {
  selectedAreaId: number | null;
  selectedSectorId: number | null;
  selectedZoneId: number | null;
  selectedBeatId: number | null;
  searchQuery: string;
}

const INITIAL_STATE: PageState = {
  selectedAreaId: null,
  selectedSectorId: null,
  selectedZoneId: null,
  selectedBeatId: null,
  searchQuery: '',
};

// ── Main component ───────────────────────────────────────────

export default function GeographyPage() {
  const { tree, loading, error, refetch } = useGeographyTree();
  const [state, setState] = useState<PageState>(INITIAL_STATE);

  // ── Derived: items per column based on selection + search ──

  const matchesSearch = useCallback(
    (text: string) => {
      const q = state.searchQuery.toLowerCase().trim();
      if (!q) return true;
      return text.toLowerCase().includes(q);
    },
    [state.searchQuery],
  );

  const currentAreas: Area[] = useMemo(() => {
    const areas = tree?.areas || [];
    if (!state.searchQuery.trim()) return areas;
    return areas.filter((a) => matchesSearch(a.area_name + ' ' + a.area_code));
  }, [tree, state.searchQuery, matchesSearch]);

  const currentSectors: Sector[] = useMemo(() => {
    if (!tree || state.selectedAreaId == null) return [];
    const area = tree.areas.find((a) => a.id === state.selectedAreaId);
    const sectors = area?.sectors || [];
    if (!state.searchQuery.trim()) return sectors;
    return sectors.filter((s) => matchesSearch(s.sector_name + ' ' + s.sector_code));
  }, [tree, state.selectedAreaId, state.searchQuery, matchesSearch]);

  const currentZones: Zone[] = useMemo(() => {
    if (!tree || state.selectedSectorId == null) return [];
    for (const area of tree.areas) {
      const sector = area.sectors.find((s) => s.id === state.selectedSectorId);
      if (sector) {
        const zones = sector.zones || [];
        if (!state.searchQuery.trim()) return zones;
        return zones.filter((z) => matchesSearch(z.zone_name + ' ' + z.zone_code));
      }
    }
    return [];
  }, [tree, state.selectedSectorId, state.searchQuery, matchesSearch]);

  const currentBeats: Beat[] = useMemo(() => {
    if (!tree || state.selectedZoneId == null) return [];
    for (const area of tree.areas) {
      for (const sector of area.sectors) {
        const zone = sector.zones?.find((z) => z.id === state.selectedZoneId);
        if (zone) {
          const beats = zone.beats || [];
          if (!state.searchQuery.trim()) return beats;
          return beats.filter((b) => matchesSearch(b.beat_name + ' ' + b.beat_code));
        }
      }
    }
    return [];
  }, [tree, state.selectedZoneId, state.searchQuery, matchesSearch]);

  // ── Selection cascade ──

  const selectArea = useCallback((id: number) => {
    setState((s) => ({
      ...s,
      selectedAreaId: id,
      selectedSectorId: null,
      selectedZoneId: null,
      selectedBeatId: null,
    }));
  }, []);

  const selectSector = useCallback((id: number) => {
    setState((s) => ({
      ...s,
      selectedSectorId: id,
      selectedZoneId: null,
      selectedBeatId: null,
    }));
  }, []);

  const selectZone = useCallback((id: number) => {
    setState((s) => ({ ...s, selectedZoneId: id, selectedBeatId: null }));
  }, []);

  const selectBeat = useCallback((id: number) => {
    setState((s) => ({ ...s, selectedBeatId: id }));
  }, []);

  // ── Resolve selected item for DetailPane ──

  const selected: SelectedItem = useMemo(() => {
    if (!tree) return null;
    if (state.selectedBeatId != null) {
      for (const a of tree.areas)
        for (const s of a.sectors)
          for (const z of s.zones || [])
            for (const b of z.beats || [])
              if (b.id === state.selectedBeatId) return { tier: 'beat', data: b };
    }
    if (state.selectedZoneId != null) {
      for (const a of tree.areas)
        for (const s of a.sectors)
          for (const z of s.zones || [])
            if (z.id === state.selectedZoneId) return { tier: 'zone', data: z };
    }
    if (state.selectedSectorId != null) {
      for (const a of tree.areas)
        for (const s of a.sectors || [])
          if (s.id === state.selectedSectorId) return { tier: 'sector', data: s };
    }
    if (state.selectedAreaId != null) {
      const a = tree.areas.find((x) => x.id === state.selectedAreaId);
      if (a) return { tier: 'area', data: a };
    }
    return null;
  }, [tree, state]);

  // ── Add handlers (tier-specific) ──

  const handleAdd = useCallback(
    async (tier: TierId) => {
      const label = tier.charAt(0).toUpperCase() + tier.slice(1);
      const name = window.prompt(`New ${label} name:`);
      if (!name || !name.trim()) return;
      const code = name.trim().toUpperCase().replace(/\s+/g, '_').slice(0, 12);

      try {
        if (tier === 'area') {
          await apiFetch('/dispatch/geography/areas', {
            method: 'POST',
            body: JSON.stringify({ area_code: code, area_name: name.trim() }),
          });
        } else if (tier === 'sector') {
          if (state.selectedAreaId == null) {
            alert('Select an Area first');
            return;
          }
          await apiFetch('/dispatch/geography/sectors', {
            method: 'POST',
            body: JSON.stringify({
              sector_code: code,
              sector_name: name.trim(),
              area_id: state.selectedAreaId,
            }),
          });
        } else if (tier === 'zone') {
          if (state.selectedSectorId == null) {
            alert('Select a Sector first');
            return;
          }
          await apiFetch('/dispatch/geography/zones', {
            method: 'POST',
            body: JSON.stringify({
              zone_code: code,
              zone_name: name.trim(),
              sector_id: state.selectedSectorId,
            }),
          });
        } else if (tier === 'beat') {
          if (state.selectedZoneId == null) {
            alert('Select a Zone first');
            return;
          }
          await apiFetch('/dispatch/geography/beats', {
            method: 'POST',
            body: JSON.stringify({
              beat_code: code,
              beat_name: name.trim(),
              zone_id: state.selectedZoneId,
            }),
          });
        }
        refetch();
      } catch (e) {
        alert(`Create ${tier} failed: ${(e as Error)?.message || 'unknown error'}`);
      }
    },
    [state.selectedAreaId, state.selectedSectorId, state.selectedZoneId, refetch],
  );

  // ── Delete handler (current selection) ──

  const handleDelete = useCallback(async () => {
    if (!selected) return;
    const name =
      (selected.data as any).area_name ||
      (selected.data as any).sector_name ||
      (selected.data as any).zone_name ||
      (selected.data as any).beat_name ||
      'this item';
    if (!window.confirm(`Delete ${selected.tier} "${name}"?`)) return;

    const tierPath =
      selected.tier === 'area'
        ? 'areas'
        : selected.tier === 'sector'
          ? 'sectors'
          : selected.tier === 'zone'
            ? 'zones'
            : 'beats';

    try {
      await apiFetch(`/dispatch/geography/${tierPath}/${selected.data.id}`, {
        method: 'DELETE',
      });
      // Clear selection for the deleted tier + below
      setState((s) => {
        if (selected.tier === 'area') return { ...s, selectedAreaId: null, selectedSectorId: null, selectedZoneId: null, selectedBeatId: null };
        if (selected.tier === 'sector') return { ...s, selectedSectorId: null, selectedZoneId: null, selectedBeatId: null };
        if (selected.tier === 'zone') return { ...s, selectedZoneId: null, selectedBeatId: null };
        return { ...s, selectedBeatId: null };
      });
      refetch();
    } catch (e) {
      alert(`Delete failed: ${(e as Error)?.message || 'unknown error'}`);
    }
  }, [selected, refetch]);

  // ── Keyboard: Esc clears selection, / focuses search ──

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'Escape') {
        setState(INITIAL_STATE);
      } else if (e.key === '/') {
        e.preventDefault();
        (document.getElementById('geography-search-input') as HTMLInputElement)?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Render ──

  if (loading && !tree) {
    return (
      <div className="p-4">
        <PanelTitleBar title="DISPATCH GEOGRAPHY" icon={MapPin} />
        <div className="panel-raised p-6 text-center text-[var(--text-muted)] text-sm">
          Loading geography tree…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <PanelTitleBar title="DISPATCH GEOGRAPHY" icon={MapPin} />
        <div className="panel-raised p-6 text-center">
          <p className="text-red-400 text-sm">{error}</p>
          <button
            onClick={refetch}
            className="mt-3 px-3 py-1 text-xs border border-[#333] hover:bg-[#1a1a1a] text-[var(--text-primary)]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const sectorCount = tree?.areas.flatMap((a) => a.sectors || []).length || 0;
  const zoneCount = tree?.areas.flatMap((a) => a.sectors || []).flatMap((s) => s.zones || []).length || 0;
  const beatCount =
    tree?.areas
      .flatMap((a) => a.sectors || [])
      .flatMap((s) => s.zones || [])
      .flatMap((z) => z.beats || []).length || 0;

  return (
    <div className="p-4 flex flex-col h-full gap-2 min-h-0">
      <PanelTitleBar
        title="DISPATCH GEOGRAPHY — AREAS / SECTORS / ZONES / BEATS"
        icon={MapPin}
      />

      {/* Search + refresh bar */}
      <div className="flex items-center gap-2 px-2">
        <input
          id="geography-search-input"
          type="text"
          value={state.searchQuery}
          onChange={(e) => setState((s) => ({ ...s, searchQuery: e.target.value }))}
          placeholder="Search all tiers… (press / to focus)"
          className="input-dark text-xs flex-1 max-w-md"
        />
        {state.searchQuery && (
          <button
            onClick={() => setState((s) => ({ ...s, searchQuery: '' }))}
            className="p-1 text-[var(--text-muted)] hover:text-[#d4a017]"
            title="Clear search"
          >
            <X size={14} />
          </button>
        )}
        <button
          onClick={refetch}
          className="p-1.5 text-[var(--text-muted)] hover:text-[#d4a017]"
          title="Refetch from server"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Columns */}
      <div className="flex-1 flex gap-0 min-h-0 panel-raised border border-[#222222]">
        <TierColumn<Area>
          title="AREAS"
          count={currentAreas.length}
          items={currentAreas}
          selectedId={state.selectedAreaId}
          onSelect={selectArea}
          onAdd={() => handleAdd('area')}
          renderItem={(a) => ({
            primary: a.area_name,
            secondary: a.sector_count != null ? `${a.sector_count} sectors` : '',
            code: a.area_code,
          })}
          width={180}
        />
        <TierColumn<Sector>
          title={`SECTORS ${currentSectors.length > 0 ? `(${currentSectors.length})` : ''}`}
          count={currentSectors.length}
          items={currentSectors}
          selectedId={state.selectedSectorId}
          onSelect={selectSector}
          onAdd={() => handleAdd('sector')}
          disabled={state.selectedAreaId == null}
          renderItem={(s) => {
            const prefix = sectionPrefix(s.sector_code);
            return {
              primary: s.sector_name,
              secondary: s.zone_count != null ? `${s.zone_count} zones` : '',
              code: prefix ? `${prefix} · ${s.sector_code}` : s.sector_code,
            };
          }}
          width={200}
        />
        <TierColumn<Zone>
          title={`ZONES ${currentZones.length > 0 ? `(${currentZones.length})` : ''}`}
          count={currentZones.length}
          items={currentZones}
          selectedId={state.selectedZoneId}
          onSelect={selectZone}
          onAdd={() => handleAdd('zone')}
          disabled={state.selectedSectorId == null}
          renderItem={(z) => ({
            primary: z.zone_name,
            secondary: z.zone_type === 'unincorporated' ? 'Unincorp.' : '',
            code: zoneChartCode(z),
          })}
          width={240}
        />
        <TierColumn<Beat>
          title={`BEATS ${currentBeats.length > 0 ? `(${currentBeats.length})` : ''}`}
          count={currentBeats.length}
          items={currentBeats}
          selectedId={state.selectedBeatId}
          onSelect={selectBeat}
          onAdd={() => handleAdd('beat')}
          disabled={state.selectedZoneId == null}
          renderItem={(b) => ({
            primary: b.beat_name,
            secondary: beatChartCode(b),
            code: b.beat_code,
          })}
          width={240}
        />
        <DetailPane selected={selected} onDelete={handleDelete} />
      </div>

      {/* Stats bar */}
      <div className="panel-sunken px-4 py-2 text-[10px] text-[var(--text-muted)] flex gap-6 border border-[#222]">
        <span>
          <span className="text-[#d4a017] font-bold">{tree?.areas.length || 0}</span> AREAS
        </span>
        <span>
          <span className="text-[#d4a017] font-bold">{sectorCount}</span> SECTORS
        </span>
        <span>
          <span className="text-[#d4a017] font-bold">{zoneCount}</span> ZONES
        </span>
        <span>
          <span className="text-[#d4a017] font-bold">{beatCount}</span> BEATS
        </span>
        <span className="ml-auto text-[9px] opacity-60">
          ↑↓ select · / search · Esc clear
        </span>
      </div>
    </div>
  );
}

// ── TierColumn (reusable) ────────────────────────────────────

interface TierColumnProps<T extends { id: number }> {
  title: string;
  count: number;
  items: T[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onAdd: () => void;
  disabled?: boolean;
  renderItem: (item: T) => { primary: string; secondary: string; code: string };
  width: number;
}

function TierColumn<T extends { id: number }>(props: TierColumnProps<T>) {
  return (
    <div
      className="border-r border-[#222222] flex flex-col min-h-0 bg-[var(--surface-raised)]"
      style={{ width: props.width, minWidth: props.width }}
    >
      <div className="px-3 py-2 border-b border-[#222222] bg-[var(--surface-sunken)] flex items-center justify-between">
        <span className="text-[10px] font-bold tracking-wider text-[#d4a017] truncate">
          {props.title}
        </span>
        <button
          onClick={props.onAdd}
          disabled={props.disabled}
          className="p-1 hover:bg-[#1a1a1a] disabled:opacity-30 disabled:cursor-not-allowed"
          title={`Add new ${props.title.split(' ')[0].toLowerCase()}`}
        >
          <Plus size={12} className="text-[var(--text-muted)]" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {props.disabled ? (
          <div className="p-3 text-[10px] text-[var(--text-muted)] italic text-center">
            Select parent first
          </div>
        ) : props.items.length === 0 ? (
          <div className="p-3 text-[10px] text-[var(--text-muted)] italic text-center">
            (empty)
          </div>
        ) : (
          props.items.map((item) => {
            const { primary, secondary, code } = props.renderItem(item);
            const selected = item.id === props.selectedId;
            return (
              <button
                key={item.id}
                onClick={() => props.onSelect(item.id)}
                className={`w-full text-left px-3 py-2 border-l-2 text-[11px] ${
                  selected
                    ? 'border-[#d4a017] bg-[var(--surface-hover)]'
                    : 'border-transparent hover:bg-[#1a1a1a]'
                }`}
              >
                <div className="font-semibold text-[var(--text-primary)] truncate">
                  {primary}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[9px] text-[var(--text-muted)] truncate font-mono">
                    {code}
                  </span>
                  {secondary && (
                    <span className="text-[9px] text-[var(--text-muted)] whitespace-nowrap">
                      {secondary}
                    </span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── DetailPane ───────────────────────────────────────────────

function DetailPane({
  selected,
  onDelete,
}: {
  selected: SelectedItem;
  onDelete: () => void;
}) {
  if (!selected) {
    return (
      <div className="flex-1 p-6 flex items-center justify-center min-w-[280px]">
        <div className="text-center text-[var(--text-muted)] text-xs">
          <MapPin size={32} className="mx-auto mb-2 opacity-30" />
          <div>Select an item from any column</div>
          <div className="mt-1 text-[10px]">to see details</div>
        </div>
      </div>
    );
  }

  const data = selected.data as any;
  const primaryName =
    data.area_name || data.sector_name || data.zone_name || data.beat_name;
  const primaryCode =
    selected.tier === 'beat'
      ? beatChartCode(selected.data as Beat)
      : selected.tier === 'zone'
        ? zoneChartCode(selected.data as Zone)
        : selected.tier === 'sector'
          ? `${sectionPrefix((selected.data as Sector).sector_code) || (selected.data as Sector).sector_code} · ${(selected.data as Sector).sector_code}`
          : data.area_code;

  // Fields to hide (navigation children, timestamps, internal IDs)
  const HIDDEN = new Set([
    'sectors',
    'zones',
    'beats',
    'created_at',
    'updated_at',
    'id',
  ]);

  const fields = Object.entries(data)
    .filter(([k]) => !HIDDEN.has(k))
    .filter(([, v]) => v !== undefined);

  return (
    <div className="flex-1 p-4 overflow-y-auto min-w-[280px]">
      <div className="text-[10px] font-bold tracking-wider text-[#d4a017] mb-2">
        {selected.tier.toUpperCase()} DETAIL
      </div>
      <div className="text-[14px] font-bold text-[var(--text-primary)] mb-1">
        {primaryName}
      </div>
      <div className="text-[10px] text-[var(--text-muted)] font-mono mb-4">
        {primaryCode}
      </div>
      <dl className="text-[11px] grid grid-cols-[120px_1fr] gap-x-3 gap-y-1">
        {fields.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-[var(--text-muted)] uppercase text-[9px] pt-0.5">
              {k.replace(/_/g, ' ')}
            </dt>
            <dd className="text-[var(--text-primary)] break-words">
              {v == null || v === '' ? (
                <span className="text-[var(--text-muted)] italic">—</span>
              ) : (
                String(v)
              )}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-6 flex gap-2">
        <button
          onClick={onDelete}
          className="flex items-center gap-1 px-3 py-1.5 text-[10px] border border-[#333] hover:border-red-400 hover:bg-red-900/20 text-[var(--text-muted)] hover:text-red-300"
        >
          <Trash2 size={11} />
          Delete
        </button>
      </div>
    </div>
  );
}
