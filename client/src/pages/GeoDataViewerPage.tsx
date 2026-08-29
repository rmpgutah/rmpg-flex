// ============================================================
// RMPG Flex — Geo Data Viewer
// Browse and inspect GeoJSON layers: state boundary, counties,
// municipalities, beats, highways, and populated places.
// Supports layer selection, feature table, search/filter, and
// detailed property inspection.
// ============================================================

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router';
import {
  Layers, MapPin, Search, ChevronLeft,
  RefreshCw, Download, Info, Grid3X3, Globe,
  Building2, Map, Filter, SortAsc, SortDesc, Eye,
  ChevronRight as ChevronRightIcon, X, Table2,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import { useToast } from '../components/ToastProvider';
import GeoDataMapView from '../components/GeoDataMapView';

// ── Types ──────────────────────────────────────────────────

interface LayerMeta {
  id: string;
  label: string;
  file: string;
  icon: React.ElementType;
  description: string;
  color: string;
}

interface GeoFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: {
    type: string;
    coordinates: unknown;
  };
}

interface FeatureCollection {
  type: 'FeatureCollection';
  features: GeoFeature[];
}

interface SortConfig {
  key: string;
  dir: 'asc' | 'desc';
}

// ── Layer catalogue ────────────────────────────────────────

const LAYERS: LayerMeta[] = [
  {
    id: 'state_boundary',
    label: 'State Boundary',
    file: '/geojson/state_boundary.geojson',
    icon: Globe,
    description: 'Utah state outline (derived from county union)',
    color: 'var(--field-label-color)',
  },
  {
    id: 'county',
    label: 'Counties',
    file: '/geojson/county.geojson',
    icon: Map,
    description: 'Utah county polygons with census population data',
    color: 'var(--text-secondary)',
  },
  {
    id: 'municipality',
    label: 'Municipalities',
    file: '/geojson/municipality.geojson',
    icon: Building2,
    description: 'Cities and towns within Utah',
    color: 'var(--sev-ok)',
  },
  {
    id: 'beat',
    label: 'Patrol Beats',
    file: '/geojson/beat.geojson',
    icon: Grid3X3,
    description: 'RMPG patrol beat polygons by district',
    color: 'var(--sev-critical)',
  },
  {
    id: 'highway',
    label: 'Highways',
    file: '/geojson/highway.geojson',
    icon: Map,
    description: 'Major interstate and highway corridors',
    color: 'var(--sev-special)',
  },
  {
    id: 'place',
    label: 'Populated Places',
    file: '/geojson/place.geojson',
    icon: MapPin,
    description: 'Cities, towns, and named places (point features)',
    color: 'var(--sev-high)',
  },
];

// ── Helpers ────────────────────────────────────────────────

function formatPropValue(val: unknown): string {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (typeof val === 'number') return val.toLocaleString();
  if (typeof val === 'string' && val.trim() === '') return '—';
  return String(val);
}

function compareValues(a: unknown, b: unknown, dir: 'asc' | 'desc'): number {
  const av = a == null ? '' : a;
  const bv = b == null ? '' : b;
  let cmp = 0;
  if (typeof av === 'number' && typeof bv === 'number') {
    cmp = av - bv;
  } else {
    cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
  }
  return dir === 'asc' ? cmp : -cmp;
}

const PAGE_SIZE = 50;

// ── Sub-components ─────────────────────────────────────────

function LayerCard({
  layer,
  count,
  active,
  loading,
  onClick,
}: {
  layer: LayerMeta;
  count: number | null;
  active: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  const Icon = layer.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left transition-colors"
      style={{
        padding: '8px 10px',
        background: active ? 'var(--surface-raised)' : 'transparent',
        border: `1px solid ${active ? 'var(--border-default)' : 'var(--surface-raised)'}`,
        borderLeft: `3px solid ${active ? layer.color : 'transparent'}`,
        cursor: 'pointer',
        marginBottom: 2,
      }}
    >
      <div className="flex items-center gap-2">
        <Icon style={{ width: 13, height: 13, color: layer.color, flexShrink: 0 }} />
        <span className="text-[11px] font-medium text-rmpg-100 min-w-0 truncate flex-1">{layer.label}</span>
        {loading ? (
          <RefreshCw style={{ width: 10, height: 10, color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} />
        ) : count !== null ? (
          <span
            className="text-[9px] font-mono px-1.5 py-0.5"
            style={{ background: 'var(--surface-sunken)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
          >
            {count.toLocaleString()}
          </span>
        ) : null}
      </div>
      {active && (
        <p className="text-[9px] mt-1 leading-tight" style={{ color: 'var(--text-muted)' }}>
          {layer.description}
        </p>
      )}
    </button>
  );
}

function FeatureDetailPanel({
  feature,
  layerColor,
  onClose,
}: {
  feature: GeoFeature | null;
  layerColor: string;
  onClose: () => void;
}) {
  if (!feature) return null;
  const props = feature.properties || {};
  const entries = Object.entries(props).filter(([k]) => k !== 'layer');

  return (
    <div
      className="flex flex-col h-full"
      style={{ borderLeft: '1px solid var(--border-subtle)', minWidth: 220, maxWidth: 300, background: 'var(--surface-sunken)' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-base)' }}
      >
        <div className="flex items-center gap-2">
          <Info style={{ width: 12, height: 12, color: layerColor }} />
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: layerColor }}>
            Feature Detail
          </span>
        </div>
        <button type="button" onClick={onClose} style={{ color: 'var(--text-muted)', lineHeight: 0 }}>
          <X style={{ width: 12, height: 12 }} />
        </button>
      </div>

      {/* Geometry badge */}
      <div className="px-3 py-1.5 flex-shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <span
          className="text-[9px] font-mono px-2 py-0.5"
          style={{ background: 'var(--surface-base)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
        >
          {feature.geometry?.type ?? 'Unknown'}
        </span>
      </div>

      {/* Properties */}
      <div className="overflow-y-auto flex-1 px-3 py-2">
        <div className="overflow-x-auto"><table className="w-full" style={{ borderCollapse: 'collapse' }}>
          <tbody>
            {entries.map(([key, val]) => (
              <tr key={key} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td
                  className="py-1 pr-2 align-top text-[9px] font-mono uppercase tracking-wide"
                  style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}
                >
                  {key}
                </td>
                <td
                  className="py-1 align-top text-[10px] break-all"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {formatPropValue(val)}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────

export default function GeoDataViewerPage() {
  const { addToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // Deep-link: ?layer= selects the active layer on mount, then stripped
  const [activeLayerId, setActiveLayerId] = useState<string>(() => {
    const param = searchParams.get('layer');
    return LAYERS.some((l) => l.id === param) ? (param as string) : 'county';
  });

  // Strip ?layer= after mount (replace: true keeps back-button clean)
  useEffect(() => {
    if (searchParams.has('layer')) {
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [layerData, setLayerData] = useState<Record<string, FeatureCollection>>({});
  const [loadingLayer, setLoadingLayer] = useState<string | null>(null);

  // Table state
  const [search, setSearch] = useState('');
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null);
  const [page, setPage] = useState(1);
  const [selectedFeature, setSelectedFeature] = useState<GeoFeature | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const [columnFilter, setColumnFilter] = useState<string>('');
  const [viewMode, setViewMode] = useState<'table' | 'map'>('table');

  const mountedRef = useRef(true);
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // ── Load layer ──────────────────────────────────────────

  const loadLayer = useCallback(async (layerId: string) => {
    if (layerData[layerId]) return;
    const meta = LAYERS.find((l) => l.id === layerId);
    if (!meta) return;
    setLoadingLayer(layerId);
    try {
      const res = await fetch(meta.file);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: FeatureCollection = await res.json();
      if (mountedRef.current) {
        setLayerData((prev) => ({ ...prev, [layerId]: data }));
      }
    } catch {
      if (mountedRef.current) addToast(`Failed to load ${meta.label} layer`, 'error');
    } finally {
      if (mountedRef.current) setLoadingLayer(null);
    }
  }, [layerData, addToast]);

  // Load active layer on mount and when switching
  useEffect(() => {
    loadLayer(activeLayerId);
  }, [activeLayerId, loadLayer]);

  // Reset table state when layer changes
  useEffect(() => {
    setSearch('');
    setSortConfig(null);
    setPage(1);
    setSelectedFeature(null);
    setColumnFilter('');
  }, [activeLayerId]);

  // ── Keyboard: N focuses search; Esc cascade ─────────────
  // Esc order: feature detail → column filter → search clear

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if (e.key === 'Escape') {
        e.stopPropagation();
        if (selectedFeature) {
          setSelectedFeature(null);
          return;
        }
        if (showFilter) {
          setShowFilter(false);
          setColumnFilter('');
          return;
        }
        if (search) {
          setSearch('');
          setPage(1);
        }
        return;
      }

      if ((e.key === 'N' || e.key === 'n') && !isInput && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [selectedFeature, showFilter, search]);

  // ── Derived data ────────────────────────────────────────

  const activeLayer = LAYERS.find((l) => l.id === activeLayerId)!;
  const fc = layerData[activeLayerId];
  const features = fc?.features ?? [];

  // Columns derived from first feature (skip geometry)
  const columns = useMemo(() => {
    if (!features.length) return [];
    const props = features[0].properties || {};
    return Object.keys(props).filter((k) => k !== 'layer');
  }, [features]);

  // Filtered columns
  const visibleColumns = useMemo(() => {
    if (!columnFilter) return columns;
    const q = columnFilter.toLowerCase();
    return columns.filter((c) => c.toLowerCase().includes(q));
  }, [columns, columnFilter]);

  // Search filter — searches across all column values
  const filtered = useMemo(() => {
    if (!search.trim()) return features;
    const q = search.toLowerCase();
    return features.filter((f) => {
      const props = f.properties || {};
      return Object.values(props).some((v) =>
        v != null && String(v).toLowerCase().includes(q)
      );
    });
  }, [features, search]);

  // Sorted
  const sorted = useMemo(() => {
    if (!sortConfig) return filtered;
    return [...filtered].sort((a, b) =>
      compareValues(
        a.properties?.[sortConfig.key],
        b.properties?.[sortConfig.key],
        sortConfig.dir,
      )
    );
  }, [filtered, sortConfig]);

  // Paginated
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paginated = useMemo(
    () => sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [sorted, page],
  );

  // ── Handlers ────────────────────────────────────────────

  const handleSort = (col: string) => {
    setSortConfig((prev) =>
      prev?.key === col
        ? { key: col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key: col, dir: 'asc' }
    );
    setPage(1);
  };

  const handleSearch = (v: string) => {
    setSearch(v);
    setPage(1);
  };

  const handleLayerSwitch = (id: string) => {
    setActiveLayerId(id);
  };

  const handleExportCSV = () => {
    if (!sorted.length) return;
    const cols = columns;
    const rows = sorted.map((f) =>
      cols.map((c) => {
        const v = f.properties?.[c];
        const s = v == null ? '' : String(v);
        return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(',')
    );
    const csv = [cols.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeLayerId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Render ──────────────────────────────────────────────

  const isLoading = loadingLayer === activeLayerId;
  const hasSearch = search.trim().length > 0;

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--surface-sunken)', minHeight: 0 }}>
      {/* Page header */}
      <div style={{ borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        <PanelTitleBar title="GEO DATA VIEWER" icon={Layers}>
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-[9px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {activeLayer.label.toUpperCase()} · {sorted.length.toLocaleString()} FEATURES
            </span>
            <button
              type="button"
              onClick={handleExportCSV}
              disabled={!sorted.length}
              title="Export filtered features as CSV"
              className="flex items-center gap-1 px-2 py-1 text-[9px] font-mono uppercase tracking-wider transition-colors"
              style={{
                background: 'var(--surface-base)',
                border: '1px solid var(--border-default)',
                color: sorted.length ? 'var(--text-secondary)' : 'var(--text-muted)',
                cursor: sorted.length ? 'pointer' : 'not-allowed',
              }}
            >
              <Download style={{ width: 10, height: 10 }} />
              CSV
            </button>
          </div>
        </PanelTitleBar>
      </div>

      {/* Body: sidebar + main */}
      <div className="flex flex-1 min-h-0">
        {/* ── Left: Layer list ─────────────────────────── */}
        <div
          className="flex flex-col flex-shrink-0 overflow-y-auto"
          style={{
            width: 180,
            borderRight: '1px solid var(--border-subtle)',
            background: 'var(--surface-overlay)',
            padding: '8px 6px',
          }}
        >
          <p
            className="text-[9px] font-semibold uppercase tracking-wider mb-2 px-1"
            style={{ color: 'var(--text-muted)' }}
          >
            Layers
          </p>
          {LAYERS.map((layer) => (
            <LayerCard
              key={layer.id}
              layer={layer}
              count={layerData[layer.id]?.features.length ?? null}
              active={layer.id === activeLayerId}
              loading={loadingLayer === layer.id}
              onClick={() => handleLayerSwitch(layer.id)}
            />
          ))}
        </div>

        {/* ── Right: Feature table + detail ────────────── */}
        <div className="flex flex-1 min-w-0 min-h-0">
          {/* Table area */}
          <div className="flex flex-col flex-1 min-w-0 min-h-0">
            {/* Toolbar */}
            <div
              className="flex items-center gap-2 flex-shrink-0 flex-wrap"
              style={{
                padding: '6px 10px',
                borderBottom: '1px solid var(--border-subtle)',
                background: 'var(--surface-overlay)',
              }}
            >
              {/* Search — N shortcut focuses this */}
              <div className="flex items-center gap-1.5 flex-1 min-w-0" style={{ maxWidth: 260 }}>
                <Search style={{ width: 11, height: 11, color: 'var(--text-muted)', flexShrink: 0 }} />
                <input
                  id="ff-geodataviewerpage-0"
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search features… (N)"
                  aria-label="Search map features"
                  value={search}
                  onChange={(e) => handleSearch(e.target.value)}
                  className="flex-1 text-[10px] bg-transparent outline-none placeholder-rmpg-600"
                  style={{ color: 'var(--text-secondary)', border: 'none' }}
                />
                {search && (
                  <button type="button" onClick={() => handleSearch('')} style={{ color: 'var(--text-muted)', lineHeight: 0 }}>
                    <X style={{ width: 10, height: 10 }} />
                  </button>
                )}
              </div>

              {/* Table / Map view toggle */}
              <div className="flex items-center" style={{ border: '1px solid var(--surface-raised)' }}>
                <button
                  type="button"
                  onClick={() => setViewMode('table')}
                  title="Table view"
                  aria-label="Table view"
                  className="flex items-center gap-1 px-2 py-1 text-[9px] font-mono uppercase tracking-wider transition-colors"
                  style={{
                    background: viewMode === 'table' ? 'var(--surface-raised)' : 'var(--surface-overlay)',
                    color: viewMode === 'table' ? 'var(--text-secondary)' : 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  <Table2 style={{ width: 9, height: 9 }} />
                  Table
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('map')}
                  title="Map view"
                  aria-label="Map view"
                  className="flex items-center gap-1 px-2 py-1 text-[9px] font-mono uppercase tracking-wider transition-colors"
                  style={{
                    background: viewMode === 'map' ? 'var(--surface-raised)' : 'var(--surface-overlay)',
                    color: viewMode === 'map' ? 'var(--text-secondary)' : 'var(--text-muted)',
                    cursor: 'pointer',
                    borderLeft: '1px solid var(--surface-raised)',
                  }}
                >
                  <Map style={{ width: 9, height: 9 }} />
                  Map
                </button>
              </div>

              {/* Column filter toggle */}
              <button
                type="button"
                onClick={() => setShowFilter((v) => !v)}
                className="flex items-center gap-1 px-2 py-1 text-[9px] font-mono uppercase tracking-wider transition-colors"
                style={{
                  background: showFilter ? 'var(--surface-raised)' : 'var(--surface-overlay)',
                  border: `1px solid ${showFilter ? 'var(--border-default)' : 'var(--surface-raised)'}`,
                  color: showFilter ? 'var(--text-secondary)' : 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                <Filter style={{ width: 9, height: 9 }} />
                Columns
              </button>

              {showFilter && (
                <input
                  id="ff-geodataviewerpage-1"
                  type="text"
                  placeholder="Filter columns..."
                  value={columnFilter}
                  onChange={(e) => setColumnFilter(e.target.value)}
                  className="text-[10px] outline-none placeholder-rmpg-600"
                  style={{
                    background: 'var(--surface-base)',
                    border: '1px solid var(--border-default)',
                    color: 'var(--text-secondary)',
                    padding: '2px 6px',
                    width: 120,
                  }}
                />
              )}

              <div className="flex-1" />

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    style={{ color: page > 1 ? 'var(--text-secondary)' : 'var(--text-muted)', lineHeight: 0, cursor: page > 1 ? 'pointer' : 'default' }}
                  >
                    <ChevronLeft style={{ width: 11, height: 11 }} />
                  </button>
                  <span className="text-[9px] font-mono" style={{ color: 'var(--text-muted)' }}>
                    {page} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    style={{ color: page < totalPages ? 'var(--text-secondary)' : 'var(--text-muted)', lineHeight: 0, cursor: page < totalPages ? 'pointer' : 'default' }}
                  >
                    <ChevronRightIcon style={{ width: 11, height: 11 }} />
                  </button>
                </div>
              )}

              <span className="text-[9px] font-mono" style={{ color: 'var(--text-muted)' }}>
                {sorted.length > 0
                  ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, sorted.length)} of ${sorted.length.toLocaleString()}`
                  : '0 results'}
              </span>
            </div>

            {/* Map view — real Mapbox GL geometry for the active layer.
                Click a feature to select it; feeds the same detail panel
                the table view uses. Renders the full (unfiltered) layer,
                not the search-filtered/paginated table subset — geographic
                browsing is a different mode than row search. */}
            {viewMode === 'map' ? (
              <div className="flex-1 min-h-0">
                <GeoDataMapView
                  fc={fc}
                  color={activeLayer.color}
                  selectedFeature={selectedFeature}
                  onSelectFeature={setSelectedFeature}
                  height="100%"
                />
              </div>
            ) : (
            /* Table — three distinct empty states */
            <div className="flex-1 overflow-auto min-h-0">
              {isLoading ? (
                <div className="flex items-center justify-center h-32 gap-2">
                  <RefreshCw style={{ width: 14, height: 14, color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} />
                  <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Loading {activeLayer.label}…</span>
                </div>
              ) : !features.length ? (
                <div className="flex flex-col items-center justify-center h-32 gap-1">
                  <Layers style={{ width: 20, height: 20, color: 'var(--text-muted)' }} />
                  <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>No features loaded for {activeLayer.label}</span>
                </div>
              ) : !sorted.length && hasSearch ? (
                <div className="flex flex-col items-center justify-center h-32 gap-1">
                  <Search style={{ width: 20, height: 20, color: 'var(--text-muted)' }} />
                  <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>No features match &ldquo;{search}&rdquo;</span>
                  <button
                    type="button"
                    className="text-[10px] mt-1"
                    style={{ color: 'var(--text-secondary)', cursor: 'pointer' }}
                    onClick={() => handleSearch('')}
                  >
                    Clear search
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto"><table className="w-full" style={{ borderCollapse: 'collapse', tableLayout: 'auto' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-sunken)', position: 'sticky', top: 0, zIndex: 1 }}>
                      <th
                        className="text-[9px] font-semibold uppercase tracking-wider text-left"
                        style={{ padding: '3px 8px', color: 'var(--text-muted)', whiteSpace: 'nowrap', width: 32, borderRight: '1px solid var(--border-subtle)' }}
                      >
                        #
                      </th>
                      {visibleColumns.map((col) => {
                        const isSorted = sortConfig?.key === col;
                        return (
                          <th
                            key={col}
                            onClick={() => handleSort(col)}
                            className="text-[9px] font-semibold uppercase tracking-wider text-left cursor-pointer select-none"
                            style={{
                              padding: '3px 8px',
                              color: isSorted ? activeLayer.color : 'var(--text-muted)',
                              whiteSpace: 'nowrap',
                              borderRight: '1px solid var(--border-subtle)',
                            }}
                          >
                            <div className="flex items-center gap-1">
                              {col}
                              {isSorted ? (
                                sortConfig.dir === 'asc'
                                  ? <SortAsc style={{ width: 9, height: 9 }} />
                                  : <SortDesc style={{ width: 9, height: 9 }} />
                              ) : null}
                            </div>
                          </th>
                        );
                      })}
                      <th style={{ padding: '3px 8px', width: 36 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((feature, idx) => {
                      const rowIdx = (page - 1) * PAGE_SIZE + idx + 1;
                      const isSelected = selectedFeature === feature;
                      return (
                        <tr
                          key={idx}
                          onClick={() => setSelectedFeature(isSelected ? null : feature)}
                          style={{
                            borderBottom: '1px solid var(--border-subtle)',
                            background: isSelected
                              ? 'var(--surface-base)'
                              : idx % 2 === 0
                                ? 'var(--surface-sunken)'
                                : 'var(--surface-overlay)',
                            cursor: 'pointer',
                            borderLeft: isSelected ? `2px solid ${activeLayer.color}` : '2px solid transparent',
                          }}
                        >
                          <td className="text-[9px] font-mono" style={{ padding: '2px 8px', color: 'var(--text-muted)', borderRight: '1px solid var(--border-subtle)' }}>
                            {rowIdx}
                          </td>
                          {visibleColumns.map((col) => (
                            <td
                              key={col}
                              className="text-[10px]"
                              style={{
                                padding: '2px 8px',
                                color: 'var(--text-secondary)',
                                whiteSpace: 'nowrap',
                                maxWidth: 180,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                borderRight: '1px solid var(--border-subtle)',
                              }}
                              title={formatPropValue(feature.properties?.[col])}
                            >
                              {formatPropValue(feature.properties?.[col])}
                            </td>
                          ))}
                          <td style={{ padding: '2px 8px', textAlign: 'center' }}>
                            <Eye style={{ width: 10, height: 10, color: isSelected ? activeLayer.color : 'var(--text-muted)' }} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table></div>
              )}
            </div>
            )}
          </div>

          {/* ── Feature detail panel ─────────────────── */}
          {selectedFeature && (
            <FeatureDetailPanel
              feature={selectedFeature}
              layerColor={activeLayer.color}
              onClose={() => setSelectedFeature(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
