// ============================================================
// ALPR Dashboard Page — Real-time license plate analytics
// ============================================================
// Live view of collected Motorola ALPR hits: summary tiles, paginated
// sightings table, image gallery, system health. Mobile-first cards with
// server-side filtering and pagination. Replaces manual plate log entry with
// automated plate reads + link to Intelligence Portal's PlateLogPage for
// full cross-referencing (stolen checks, watchlist, etc.).
//
// NOTE: Most Motorola ALPRs were taken offline following media reports and
// Motorola security remediation (January 2025). This dashboard monitors
// remaining systems; legacy for research/testing only.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, ScanSearch, AlertTriangle, MapPin, Camera, Filter, RefreshCw, Image as ImageIcon, Eye, Download } from 'lucide-react';
import { apiFetch, authedImageUrl } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import StatsCard from '../components/StatsCard';
import ConfirmDialog from '../components/ConfirmDialog';

interface ALPRSummary {
  total_hits: number;
  unique_plates: number;
  active_systems: number;
  vehicle_makes: number;
}

interface ALPRHit {
  id: number;
  uuid: string;
  system_id: string;
  timestamp: string;
  make: string;
  model: string;
  color: string;
  license_plate: string;
}

interface ALPRSystem {
  system_id: string;
  hit_count: number;
  last_hit: string;
}

interface HitsResponse {
  hits: ALPRHit[];
  count: number;
}

const LIMIT = 50;

export default function ALPRDashboardPage() {
  // Summary stats
  const [summary, setSummary] = useState<ALPRSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  // Paginated hits
  const [hits, setHits] = useState<ALPRHit[]>([]);
  const [hitsLoading, setHitsLoading] = useState(false);
  const [hitsOffset, setHitsOffset] = useState(0);
  const [hitsTotal, setHitsTotal] = useState(0);

  // System status
  const [systems, setSystems] = useState<ALPRSystem[]>([]);
  const [systemsLoading, setSystemsLoading] = useState(false);

  // Filtering
  const [plateFilter, setPlateFilter] = useState('');
  const [systemFilter, setSystemFilter] = useState('');

  // Gallery view
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);

  // Auto-refresh toggle
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState<NodeJS.Timeout | null>(null);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const data = await apiFetch<ALPRSummary>('/alpr/summary');
      setSummary(data);
    } catch (err) {
      console.error('Failed to load ALPR summary:', err);
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  const loadHits = useCallback(async (offset: number = 0) => {
    setHitsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(LIMIT));
      params.set('offset', String(offset));
      if (plateFilter) params.set('plate', plateFilter);
      if (systemFilter) params.set('system', systemFilter);

      const data = await apiFetch<HitsResponse>(`/alpr/hits?${params}`);
      setHits(data.hits || []);
      setHitsTotal(data.count || 0);
      setHitsOffset(offset);
    } catch (err) {
      console.error('Failed to load ALPR hits:', err);
      setHits([]);
    } finally {
      setHitsLoading(false);
    }
  }, [plateFilter, systemFilter]);

  const loadSystems = useCallback(async () => {
    setSystemsLoading(true);
    try {
      const data = await apiFetch<ALPRSystem[]>('/alpr/systems');
      setSystems(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load ALPR systems:', err);
    } finally {
      setSystemsLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadSummary();
    loadHits(0);
    loadSystems();
  }, [loadSummary, loadHits, loadSystems]);

  // Auto-refresh
  useEffect(() => {
    if (autoRefresh) {
      setRefreshInterval(
        setInterval(() => {
          loadSummary();
          loadHits(hitsOffset);
          loadSystems();
        }, 10000) as NodeJS.Timeout
      );
      return () => {
        if (refreshInterval) clearInterval(refreshInterval);
      };
    }
  }, [autoRefresh, hitsOffset, loadSummary, loadHits, loadSystems, refreshInterval]);

  const hasFilters = plateFilter || systemFilter;
  const totalPages = Math.ceil(hitsTotal / LIMIT);
  const currentPage = Math.floor(hitsOffset / LIMIT) + 1;

  const onFilterSubmit = () => {
    setHitsOffset(0);
    loadHits(0);
  };

  const onClearFilters = () => {
    setPlateFilter('');
    setSystemFilter('');
    setHitsOffset(0);
    loadHits(0);
  };

  const filteredHit = hits[galleryIndex];

  return (
    <div className="p-4 space-y-4 max-w-6xl mx-auto">
      <PanelTitleBar title="ALPR DASHBOARD" icon={ScanSearch}>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="accent-brand-gold-500"
            />
            <span className="text-rmpg-300">Auto-refresh</span>
          </label>
          <button
            onClick={() => { loadSummary(); loadHits(hitsOffset); loadSystems(); }}
            aria-label="Refresh"
            className="p-1.5 text-rmpg-300 hover:text-brand-gold-500 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </PanelTitleBar>

      {/* Summary stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatsCard
          icon={ScanSearch}
          label="Total hits"
          value={summaryLoading ? '…' : (summary?.total_hits ?? 0).toLocaleString()}
          accent="blue"
        />
        <StatsCard
          icon={AlertTriangle}
          label="Unique plates"
          value={summaryLoading ? '…' : (summary?.unique_plates ?? 0).toLocaleString()}
          accent="purple"
        />
        <StatsCard
          icon={Camera}
          label="Active systems"
          value={systemsLoading ? '…' : (summary?.active_systems ?? 0).toLocaleString()}
          accent="orange"
        />
        <StatsCard
          icon={Filter}
          label="Vehicle makes"
          value={summaryLoading ? '…' : (summary?.vehicle_makes ?? 0).toLocaleString()}
          accent="green"
        />
      </div>

      {/* Monitored systems */}
      {systems.length > 0 && (
        <div className="bg-surface-raised border border-border-default rounded-sm p-4">
          <h3 className="text-brand-400 font-semibold text-sm mb-3 flex items-center gap-2">
            <Camera className="w-4 h-4" /> Monitored systems ({systems.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-56 overflow-y-auto">
            {systems.map((sys) => {
              const lastHitDate = new Date(sys.last_hit);
              const minutesAgo = Math.floor((Date.now() - lastHitDate.getTime()) / 60000);
              let timeLabel = '';
              if (minutesAgo < 1) timeLabel = 'just now';
              else if (minutesAgo < 60) timeLabel = `${minutesAgo}m ago`;
              else if (minutesAgo < 1440) timeLabel = `${Math.floor(minutesAgo / 60)}h ago`;
              else timeLabel = `${Math.floor(minutesAgo / 1440)}d ago`;

              return (
                <div key={sys.system_id} className="border border-border-subtle rounded-sm p-2 bg-surface-sunken">
                  <div className="text-[11px] font-mono text-brand-gold-500">{sys.system_id}</div>
                  <div className="text-[10px] text-rmpg-400 mt-0.5">
                    {sys.hit_count.toLocaleString()} hits · {timeLabel}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-surface-raised border border-border-default rounded-sm p-4 space-y-2">
        <h3 className="text-brand-400 font-semibold text-sm mb-2 flex items-center gap-2">
          <Filter className="w-4 h-4" /> Filter hits
        </h3>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={plateFilter}
            onChange={(e) => setPlateFilter(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && onFilterSubmit()}
            placeholder="License plate (e.g. ABC123)"
            className="flex-1 bg-surface-sunken border border-border-default px-3 py-2 text-[11px] text-rmpg-200 font-mono uppercase placeholder:text-rmpg-500 focus:outline-none focus:ring-1 focus:ring-brand-gold-500"
          />
          <input
            type="text"
            value={systemFilter}
            onChange={(e) => setSystemFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onFilterSubmit()}
            placeholder="System IP"
            className="flex-1 bg-surface-sunken border border-border-default px-3 py-2 text-[11px] text-rmpg-200 font-mono placeholder:text-rmpg-500 focus:outline-none focus:ring-1 focus:ring-brand-gold-500"
          />
          <button
            onClick={onFilterSubmit}
            disabled={hitsLoading}
            className="px-4 py-2 text-[11px] font-semibold bg-brand-700 text-rmpg-100 rounded-sm hover:bg-brand-600 disabled:opacity-40 transition-colors flex items-center gap-1.5"
          >
            {hitsLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ScanSearch className="w-3 h-3" />}
            Search
          </button>
          {hasFilters && (
            <button
              onClick={onClearFilters}
              className="px-3 py-2 text-[11px] font-semibold border border-border-default text-rmpg-400 rounded-sm hover:text-rmpg-200 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Hits table */}
      <div className="bg-surface-raised border border-border-default rounded-sm overflow-hidden">
        <div className="px-4 py-[3px] border-b border-border-default flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold text-brand-gold-500 uppercase tracking-wider">
            ALPR Hits · {hitsTotal.toLocaleString()} total
          </span>
          <span className="text-[10px] text-rmpg-500">
            Page {currentPage} of {totalPages}
          </span>
        </div>

        {hitsLoading && hits.length === 0 && (
          <div className="p-4 text-center text-rmpg-400 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-[11px]">Loading hits…</span>
          </div>
        )}

        {!hitsLoading && hits.length === 0 && (
          <div className="p-4 text-center text-rmpg-400 text-[11px]">
            {hasFilters ? 'No hits match your filters.' : 'No ALPR hits recorded yet.'}
          </div>
        )}

        {hits.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[9px] uppercase tracking-wider text-rmpg-500 border-b border-border-default bg-surface-sunken">
                  <th className="py-[3px] px-3 font-semibold">Plate</th>
                  <th className="py-[3px] px-3 font-semibold">Vehicle</th>
                  <th className="py-[3px] px-3 font-semibold">System</th>
                  <th className="py-[3px] px-3 font-semibold">When</th>
                  <th className="py-[3px] px-3 font-semibold text-center">Image</th>
                </tr>
              </thead>
              <tbody>
                {hits.map((hit) => {
                  const hitDate = new Date(hit.timestamp);
                  const timeStr = hitDate.toLocaleString();

                  return (
                    <tr key={hit.id} className="text-[11px] text-rmpg-200 border-b border-border-subtle hover:bg-surface-sunken transition-colors">
                      <td className="py-[2px] px-3 font-mono text-brand-gold-500 font-semibold">{hit.license_plate}</td>
                      <td className="py-[2px] px-3 text-rmpg-300">
                        {[hit.color, hit.make, hit.model].filter(Boolean).join(' ') || '—'}
                      </td>
                      <td className="py-[2px] px-3 font-mono text-rmpg-400">{hit.system_id}</td>
                      <td className="py-[2px] px-3 whitespace-nowrap text-rmpg-400">{timeStr}</td>
                      <td className="py-[2px] px-3 text-center">
                        <button
                          onClick={() => { setGalleryIndex(hits.indexOf(hit)); setGalleryOpen(true); }}
                          className="inline-flex items-center gap-1 text-[10px] px-2 py-1 border border-brand-gold-600 text-brand-gold-400 rounded-sm hover:bg-brand-gold-700/10 transition-colors"
                          title={`View image for ${hit.license_plate}`}
                        >
                          <Eye className="w-3 h-3" />
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-2 border-t border-border-default flex items-center justify-between gap-2 text-[10px]">
            <button
              onClick={() => loadHits(Math.max(0, hitsOffset - LIMIT))}
              disabled={hitsOffset === 0 || hitsLoading}
              className="px-2 py-1 border border-border-default text-rmpg-300 rounded-sm hover:text-rmpg-100 disabled:opacity-40 transition-colors"
            >
              ← Previous
            </button>
            <span className="text-rmpg-400">
              {Math.min(hitsOffset + 1, hitsTotal)}–{Math.min(hitsOffset + LIMIT, hitsTotal)} of {hitsTotal}
            </span>
            <button
              onClick={() => loadHits(hitsOffset + LIMIT)}
              disabled={hitsOffset + LIMIT >= hitsTotal || hitsLoading}
              className="px-2 py-1 border border-border-default text-rmpg-300 rounded-sm hover:text-rmpg-100 disabled:opacity-40 transition-colors"
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Image gallery modal */}
      {galleryOpen && filteredHit && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setGalleryOpen(false)}>
          <div className="bg-surface-base border border-border-default rounded-sm max-w-2xl w-full max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="px-4 py-3 border-b border-border-default flex items-center justify-between gap-2">
              <h3 className="text-brand-400 font-semibold text-sm flex items-center gap-2">
                <ImageIcon className="w-4 h-4" />
                {filteredHit.license_plate}
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-rmpg-400">
                  {hits.indexOf(filteredHit) + 1} of {hits.length}
                </span>
                <button onClick={() => setGalleryOpen(false)} className="text-rmpg-400 hover:text-rmpg-200 text-xl">
                  ×
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="p-4 space-y-3">
              {/* Vehicle details */}
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <span className="text-rmpg-500">Make/Model:</span>
                  <div className="text-rmpg-200">{filteredHit.make || '—'} {filteredHit.model || '—'}</div>
                </div>
                <div>
                  <span className="text-rmpg-500">Color:</span>
                  <div className="text-rmpg-200">{filteredHit.color || '—'}</div>
                </div>
                <div>
                  <span className="text-rmpg-500">System:</span>
                  <div className="font-mono text-rmpg-200">{filteredHit.system_id}</div>
                </div>
                <div>
                  <span className="text-rmpg-500">Timestamp:</span>
                  <div className="text-rmpg-200">{new Date(filteredHit.timestamp).toLocaleString()}</div>
                </div>
              </div>

              {/* Image placeholder — server-side image retrieval would be implemented here */}
              <div className="bg-surface-sunken border border-border-subtle rounded-sm aspect-video flex items-center justify-center">
                <div className="text-center text-rmpg-500 text-[12px]">
                  <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>Image retrieval: GET /api/alpr/hits/{filteredHit.uuid}/image</p>
                </div>
              </div>

              {/* Navigation */}
              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={() => setGalleryIndex((i) => (i - 1 + hits.length) % hits.length)}
                  className="px-3 py-1.5 text-[11px] font-semibold border border-border-default text-rmpg-300 rounded-sm hover:text-rmpg-100 transition-colors"
                >
                  ← Previous
                </button>
                <span className="text-[10px] text-rmpg-400">
                  {hits.indexOf(filteredHit) + 1} / {hits.length}
                </span>
                <button
                  onClick={() => setGalleryIndex((i) => (i + 1) % hits.length)}
                  className="px-3 py-1.5 text-[11px] font-semibold border border-border-default text-rmpg-300 rounded-sm hover:text-rmpg-100 transition-colors"
                >
                  Next →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
