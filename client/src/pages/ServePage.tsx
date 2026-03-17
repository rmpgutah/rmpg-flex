// ============================================================
// RMPG Flex — Process Server Field Suite
// Mobile-first page for managing serve jobs, route planning,
// attempt documentation, and skip traces.
// ============================================================

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Plus, RefreshCw, MapPin, BarChart3, List, Map as MapIcon,
  Briefcase, Calendar, Route, Navigation, Loader2, X,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useIsMobile } from '../hooks/useIsMobile';
import { useWebSocket } from '../context/WebSocketContext';
import { loadGoogleMaps, DARK_MAP_STYLE } from '../utils/googleMapsLoader';
import ServeJobCard from '../components/serve/ServeJobCard';
import ServeAttemptModal from '../components/serve/ServeAttemptModal';
import ServeRoutePlanner from '../components/serve/ServeRoutePlanner';
import ServeSkipTracePanel from '../components/serve/ServeSkipTracePanel';
import FormModal from '../components/FormModal';
import type { ServeJob, ServeAttemptData, ServeSkipAddress } from '../types';

// ─── Constants ──────────────────────────────────────────────────────────

const GMAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const TABS = ['Queue', 'Map', 'Stats'] as const;
type Tab = typeof TABS[number];
type StatusFilter = 'all' | 'pending' | 'in_progress' | 'served' | 'failed';

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'served', label: 'Served' },
  { value: 'failed', label: 'Failed' },
];

const MARKER_COLORS: Record<string, string> = {
  pending: '#3b82f6',
  in_progress: '#eab308',
  served: '#22c55e',
  failed: '#ef4444',
  skipped: '#6b7280',
  archived: '#4b5563',
};

const DOCUMENT_TYPES = [
  'Summons', 'Complaint', 'Subpoena', 'Writ', 'Order', 'Notice',
  'Petition', 'Motion', 'Garnishment', 'Eviction', 'Other',
];

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─── Stats Summary Type ─────────────────────────────────────────────────

interface StatsSummary {
  pending: number;
  in_progress: number;
  served: number;
  failed: number;
  total_attempts: number;
  mileage?: number;
  planned_mileage?: number;
}

// ─── Component ──────────────────────────────────────────────────────────

export default function ServePage() {
  const isMobile = useIsMobile();
  const { subscribe } = useWebSocket();

  // ── Core state ──────────────────────────────────────────────────────
  const [selectedDate, setSelectedDate] = useState(() => formatDate(new Date()));
  const [activeTab, setActiveTab] = useState<Tab>('Queue');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // ── Data ────────────────────────────────────────────────────────────
  const [jobs, setJobs] = useState<ServeJob[]>([]);
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // ── Expanded card tracking ─────────────────────────────────────────
  const [expandedJobId, setExpandedJobId] = useState<number | null>(null);

  // ── Modals / panels ────────────────────────────────────────────────
  const [attemptJob, setAttemptJob] = useState<ServeJob | null>(null);
  const [skipTraceJob, setSkipTraceJob] = useState<ServeJob | null>(null);
  const [routePlannerOpen, setRoutePlannerOpen] = useState(false);
  const [createJobOpen, setCreateJobOpen] = useState(false);
  const [editJob, setEditJob] = useState<ServeJob | null>(null);

  // ── Create/Edit form state ─────────────────────────────────────────
  const [formData, setFormData] = useState({
    recipient_name: '',
    recipient_address: '',
    recipient_city: '',
    recipient_state: 'UT',
    recipient_zip: '',
    document_type: 'Summons',
    case_number: '',
    court_name: '',
    jurisdiction: '',
    client_name: '',
    attorney_name: '',
    priority: 'normal' as ServeJob['priority'],
    time_window: 'anytime' as ServeJob['time_window'],
    deadline: '',
    max_attempts: 3,
    service_instructions: '',
    notes: '',
  });
  const [formSubmitting, setFormSubmitting] = useState(false);

  // ── Map state ──────────────────────────────────────────────────────
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // ── Route state ────────────────────────────────────────────────────
  const [routeData, setRouteData] = useState<{
    orderedIds: number[];
    totalDistance: number;
    totalDuration: number;
    fuelCost: number;
  } | null>(null);

  // ══════════════════════════════════════════════════════════════════════
  // API Calls
  // ══════════════════════════════════════════════════════════════════════

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<ServeJob[]>(`/api/process-server?date=${selectedDate}`);
      setJobs(data || []);
    } catch {
      // silently fail — user can retry
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await apiFetch<StatsSummary>(`/api/process-server/stats/summary?date=${selectedDate}`);
      setStats(data);
    } catch {
      // stats are non-critical
    }
  }, [selectedDate]);

  const refreshJobs = useCallback(() => {
    fetchJobs();
    fetchStats();
  }, [fetchJobs, fetchStats]);

  // Initial load + date change
  useEffect(() => {
    refreshJobs();
  }, [refreshJobs]);

  // ── WebSocket live updates ─────────────────────────────────────────
  useEffect(() => {
    const unsubs = [
      subscribe('serve:created' as any, () => refreshJobs()),
      subscribe('serve:updated' as any, () => refreshJobs()),
      subscribe('serve:attempt' as any, () => refreshJobs()),
    ];
    return () => { unsubs.forEach(u => u()); };
  }, [subscribe, refreshJobs]);

  // ══════════════════════════════════════════════════════════════════════
  // Handlers
  // ══════════════════════════════════════════════════════════════════════

  const handleSyncFromSM = useCallback(async () => {
    setSyncing(true);
    try {
      await apiFetch('/api/process-server/sync-from-sm', { method: 'POST' });
      refreshJobs();
    } catch {
      // sync failed
    } finally {
      setSyncing(false);
    }
  }, [refreshJobs]);

  const handleNavigate = useCallback((jobId: number) => {
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    if (job.recipient_lat != null && job.recipient_lng != null) {
      window.open(
        `https://www.google.com/maps/dir/?api=1&destination=${job.recipient_lat},${job.recipient_lng}`,
        '_blank',
        'noopener,noreferrer',
      );
    } else if (job.recipient_address) {
      const addr = encodeURIComponent(
        `${job.recipient_address} ${job.recipient_city || ''} ${job.recipient_state || ''} ${job.recipient_zip || ''}`,
      );
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${addr}`, '_blank', 'noopener,noreferrer');
    }
  }, [jobs]);

  const handleFlagAddress = useCallback(async (jobId: number) => {
    try {
      await apiFetch(`/api/process-server/${jobId}`, {
        method: 'PUT',
        body: JSON.stringify({ notes: 'BAD ADDRESS \u2014 needs verification', status: 'skipped' }),
      });
      refreshJobs();
    } catch {
      // flag failed
    }
  }, [refreshJobs]);

  const handleAttemptSubmit = useCallback(async (data: ServeAttemptData) => {
    if (!attemptJob) return { dueDiligenceComplete: false, attemptNumber: 0, jobStatus: 'pending' };
    const result = await apiFetch<{
      dueDiligenceComplete?: boolean;
      attemptNumber?: number;
      jobStatus?: string;
    }>(`/api/process-server/${attemptJob.id}/attempt`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    refreshJobs();
    return result;
  }, [attemptJob, refreshJobs]);

  const handleRouteOptimized = useCallback(async (
    orderedJobIds: number[],
    data: { totalDistance: number; totalDuration: number; fuelCost: number },
  ) => {
    setRouteData({ orderedIds: orderedJobIds, ...data });
    // Persist sort order to server
    try {
      await apiFetch('/api/process-server/reorder', {
        method: 'PUT',
        body: JSON.stringify({ orderedIds: orderedJobIds }),
      });
      refreshJobs();
    } catch {
      // reorder failed — local state still updated
    }
  }, [refreshJobs]);

  const handleSkipTraceAddToRoute = useCallback((_addr: ServeSkipAddress) => {
    // Could update the job's address — for now just close and refresh
    refreshJobs();
  }, [refreshJobs]);

  // ── Create / Edit Job ──────────────────────────────────────────────

  const resetForm = useCallback(() => {
    setFormData({
      recipient_name: '', recipient_address: '', recipient_city: '',
      recipient_state: 'UT', recipient_zip: '', document_type: 'Summons',
      case_number: '', court_name: '', jurisdiction: '', client_name: '',
      attorney_name: '', priority: 'normal', time_window: 'anytime',
      deadline: '', max_attempts: 3, service_instructions: '', notes: '',
    });
  }, []);

  const openCreate = useCallback(() => {
    resetForm();
    setEditJob(null);
    setCreateJobOpen(true);
  }, [resetForm]);

  const openEdit = useCallback((jobId: number) => {
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    setEditJob(job);
    setFormData({
      recipient_name: job.recipient_name,
      recipient_address: job.recipient_address || '',
      recipient_city: job.recipient_city || '',
      recipient_state: job.recipient_state || 'UT',
      recipient_zip: job.recipient_zip || '',
      document_type: job.document_type,
      case_number: job.case_number || '',
      court_name: job.court_name || '',
      jurisdiction: job.jurisdiction || '',
      client_name: job.client_name || '',
      attorney_name: job.attorney_name || '',
      priority: job.priority,
      time_window: job.time_window,
      deadline: job.deadline || '',
      max_attempts: job.max_attempts,
      service_instructions: job.service_instructions || '',
      notes: job.notes || '',
    });
    setCreateJobOpen(true);
  }, [jobs]);

  const handleFormSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.recipient_name.trim()) return;
    setFormSubmitting(true);
    try {
      if (editJob) {
        await apiFetch(`/api/process-server/${editJob.id}`, {
          method: 'PUT',
          body: JSON.stringify(formData),
        });
      } else {
        await apiFetch('/api/process-server', {
          method: 'POST',
          body: JSON.stringify({ ...formData, serve_date: selectedDate }),
        });
      }
      setCreateJobOpen(false);
      resetForm();
      setEditJob(null);
      refreshJobs();
    } catch {
      // error
    } finally {
      setFormSubmitting(false);
    }
  }, [formData, editJob, selectedDate, resetForm, refreshJobs]);

  const handleFormChange = useCallback((field: string, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  // ── Navigate to next unserved stop ─────────────────────────────────

  const handleNavigateToNext = useCallback(() => {
    const unserved = routeData
      ? routeData.orderedIds
          .map(id => jobs.find(j => j.id === id))
          .filter((j): j is ServeJob => !!j && j.status !== 'served' && j.status !== 'failed')
      : jobs.filter(j => j.status === 'pending' || j.status === 'in_progress');

    if (unserved.length > 0) {
      handleNavigate(unserved[0].id);
    }
  }, [jobs, routeData, handleNavigate]);

  // ══════════════════════════════════════════════════════════════════════
  // Filtered Jobs
  // ══════════════════════════════════════════════════════════════════════

  const filteredJobs = useMemo(() => {
    if (statusFilter === 'all') return jobs;
    return jobs.filter(j => j.status === statusFilter);
  }, [jobs, statusFilter]);

  // ══════════════════════════════════════════════════════════════════════
  // Map Tab
  // ══════════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (activeTab !== 'Map' || !GMAPS_API_KEY) return;

    let cancelled = false;

    loadGoogleMaps(GMAPS_API_KEY).then(() => {
      if (cancelled || !mapContainerRef.current) return;

      // If map already exists, just update markers
      if (mapRef.current) {
        updateMapMarkers();
        return;
      }

      const center = { lat: 40.7608, lng: -111.891 }; // SLC default
      const map = new google.maps.Map(mapContainerRef.current, {
        center,
        zoom: 11,
        styles: DARK_MAP_STYLE,
        disableDefaultUI: true,
        zoomControl: true,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });

      mapRef.current = map;
      infoWindowRef.current = new google.maps.InfoWindow();
      setMapReady(true);
    }).catch(() => {
      // map load failed
    });

    return () => { cancelled = true; };
  }, [activeTab]);

  // Update markers when jobs change or map becomes ready
  const updateMapMarkers = useCallback(() => {
    if (!mapRef.current) return;

    // Clear old markers
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];

    // Clear old polyline
    if (polylineRef.current) {
      polylineRef.current.setMap(null);
      polylineRef.current = null;
    }

    const bounds = new google.maps.LatLngBounds();
    let hasMarkers = false;

    jobs.forEach(job => {
      if (job.recipient_lat == null || job.recipient_lng == null) return;
      hasMarkers = true;
      const pos = { lat: job.recipient_lat, lng: job.recipient_lng };
      bounds.extend(pos);

      const color = MARKER_COLORS[job.status] || MARKER_COLORS.pending;
      const marker = new google.maps.Marker({
        position: pos,
        map: mapRef.current!,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: color,
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 1.5,
          scale: 10,
        },
        title: job.recipient_name,
      });

      marker.addListener('click', () => {
        const fullAddr = [job.recipient_address, job.recipient_city, job.recipient_state, job.recipient_zip]
          .filter(Boolean).join(', ');
        infoWindowRef.current?.setContent(`
          <div style="color:#fff;background:#141e2b;padding:8px 12px;border-radius:4px;min-width:180px;font-family:system-ui;">
            <div style="font-weight:600;font-size:13px;margin-bottom:4px;">${job.recipient_name}</div>
            <div style="font-size:11px;color:#8a9aaa;">${fullAddr || 'No address'}</div>
            <div style="font-size:10px;color:#6b7280;margin-top:4px;text-transform:uppercase;">${job.status.replace('_', ' ')} &middot; ${job.document_type}</div>
          </div>
        `);
        infoWindowRef.current?.open(mapRef.current!, marker);
      });

      markersRef.current.push(marker);
    });

    // Draw polyline if route planned
    if (routeData && routeData.orderedIds.length > 1) {
      const path = routeData.orderedIds
        .map(id => jobs.find(j => j.id === id))
        .filter((j): j is ServeJob => !!j && j.recipient_lat != null && j.recipient_lng != null)
        .map(j => ({ lat: j.recipient_lat!, lng: j.recipient_lng! }));

      if (path.length > 1) {
        polylineRef.current = new google.maps.Polyline({
          path,
          geodesic: true,
          strokeColor: '#3b82f6',
          strokeOpacity: 0.8,
          strokeWeight: 3,
          map: mapRef.current,
        });
      }
    }

    if (hasMarkers) {
      mapRef.current.fitBounds(bounds, 60);
    }
  }, [jobs, routeData]);

  useEffect(() => {
    if (mapReady) updateMapMarkers();
  }, [mapReady, updateMapMarkers]);

  // ══════════════════════════════════════════════════════════════════════
  // Render
  // ══════════════════════════════════════════════════════════════════════

  return (
    <div className="flex flex-col h-full bg-surface-base app-grid-bg">
      {/* ─── Header Bar ────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1e3048] bg-[#0d1520] flex-wrap">
        <div className="flex items-center gap-1.5">
          <Briefcase size={16} className="text-brand-400" />
          {!isMobile && <span className="text-sm font-semibold text-white">Process Server</span>}
        </div>

        {/* Date picker */}
        <div className="flex items-center gap-1 ml-auto sm:ml-2">
          <Calendar size={14} className="text-rmpg-400" />
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="px-2 py-1 text-xs bg-[#141e2b] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none"
          />
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setRoutePlannerOpen(true)}
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-blue-400 bg-blue-900/20 hover:bg-blue-900/40 border border-blue-700/40 rounded transition-colors"
            title="Plan Route"
          >
            <Route size={12} />
            {!isMobile && 'Plan Route'}
          </button>
          <button
            onClick={handleSyncFromSM}
            disabled={syncing}
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-cyan-400 bg-cyan-900/20 hover:bg-cyan-900/40 border border-cyan-700/40 rounded transition-colors disabled:opacity-40"
            title="Sync from ServeManager"
          >
            {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {!isMobile && 'Sync from SM'}
          </button>
          <button
            onClick={openCreate}
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-green-400 bg-green-900/20 hover:bg-green-900/40 border border-green-700/40 rounded transition-colors"
            title="Add Job"
          >
            <Plus size={12} />
            {!isMobile && 'Add Job'}
          </button>
        </div>
      </div>

      {/* ─── Tab Bar ───────────────────────────────────────────────── */}
      <div className="flex items-center border-b border-[#1e3048] bg-[#0d1520]">
        {TABS.map(tab => {
          const Icon = tab === 'Queue' ? List : tab === 'Map' ? MapIcon : BarChart3;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors border-b-2 ${
                activeTab === tab
                  ? 'text-white border-brand-500'
                  : 'text-rmpg-400 border-transparent hover:text-rmpg-200 hover:border-rmpg-600'
              }`}
            >
              <Icon size={14} />
              {tab}
            </button>
          );
        })}
      </div>

      {/* ─── Tab Content ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden">
        {/* ── Queue Tab ───────────────────────────────────────────── */}
        {activeTab === 'Queue' && (
          <div className="h-full flex flex-col">
            {/* Filter buttons */}
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[#1e3048] overflow-x-auto">
              {STATUS_FILTERS.map(f => (
                <button
                  key={f.value}
                  onClick={() => setStatusFilter(f.value)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded border transition-colors whitespace-nowrap ${
                    statusFilter === f.value
                      ? 'text-white bg-brand-700 border-brand-500'
                      : 'text-rmpg-400 bg-transparent border-rmpg-600 hover:border-rmpg-400'
                  }`}
                >
                  {f.label}
                  {f.value !== 'all' && (
                    <span className="ml-1 text-[10px] text-rmpg-500">
                      {jobs.filter(j => j.status === f.value).length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Job list */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loading && jobs.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-xs text-rmpg-400">
                  <Loader2 size={16} className="animate-spin mr-2" />
                  Loading jobs...
                </div>
              ) : filteredJobs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-center">
                  <Briefcase size={24} className="text-rmpg-600 mb-2" />
                  <p className="text-sm text-rmpg-400">
                    {statusFilter !== 'all'
                      ? `No ${statusFilter.replace('_', ' ')} jobs for this date.`
                      : 'No jobs for today. Sync from ServeManager or add manually.'
                    }
                  </p>
                </div>
              ) : (
                filteredJobs.map(job => (
                  <ServeJobCard
                    key={job.id}
                    job={job}
                    onAttempt={(id) => {
                      const j = jobs.find(jj => jj.id === id);
                      if (j) setAttemptJob(j);
                    }}
                    onNavigate={handleNavigate}
                    onSkipTrace={(id) => {
                      const j = jobs.find(jj => jj.id === id);
                      if (j) setSkipTraceJob(j);
                    }}
                    onFlagAddress={handleFlagAddress}
                    onEdit={openEdit}
                    isExpanded={expandedJobId === job.id}
                    onToggleExpand={() => setExpandedJobId(prev => prev === job.id ? null : job.id)}
                  />
                ))
              )}
            </div>
          </div>
        )}

        {/* ── Map Tab ─────────────────────────────────────────────── */}
        {activeTab === 'Map' && (
          <div className="h-full relative">
            <div ref={mapContainerRef} className="absolute inset-0" />
            {!mapReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-[#0d1520]">
                <div className="flex items-center gap-2 text-xs text-rmpg-400">
                  <Loader2 size={14} className="animate-spin" />
                  Loading map...
                </div>
              </div>
            )}

            {/* Navigate to Next button */}
            {mapReady && jobs.some(j => j.status === 'pending' || j.status === 'in_progress') && (
              <button
                onClick={handleNavigateToNext}
                className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg shadow-lg border border-blue-500 transition-colors"
              >
                <Navigation size={16} />
                Navigate to Next
              </button>
            )}
          </div>
        )}

        {/* ── Stats Tab ───────────────────────────────────────────── */}
        {activeTab === 'Stats' && (
          <div className="h-full overflow-y-auto p-4 space-y-4">
            {/* Summary cards */}
            <div className={`grid gap-3 ${isMobile ? 'grid-cols-2' : 'grid-cols-4'}`}>
              <StatCard
                label="Jobs Remaining"
                value={(stats?.pending ?? 0) + (stats?.in_progress ?? 0)}
                color="text-blue-400"
                bg="bg-blue-900/20"
                border="border-blue-700/40"
              />
              <StatCard
                label="Served Today"
                value={stats?.served ?? 0}
                color="text-green-400"
                bg="bg-green-900/20"
                border="border-green-700/40"
              />
              <StatCard
                label="Failed"
                value={stats?.failed ?? 0}
                color="text-red-400"
                bg="bg-red-900/20"
                border="border-red-700/40"
              />
              <StatCard
                label="Total Attempts"
                value={stats?.total_attempts ?? 0}
                color="text-amber-400"
                bg="bg-amber-900/20"
                border="border-amber-700/40"
              />
            </div>

            {/* Mileage / efficiency */}
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
              <div className="px-4 py-3 bg-[#141e2b] border border-[#1e3048] rounded">
                <div className="text-[10px] text-rmpg-400 uppercase font-semibold mb-1">Mileage Today</div>
                <div className="text-lg font-bold text-white font-mono">
                  {routeData?.totalDistance
                    ? `${routeData.totalDistance.toFixed(1)} mi`
                    : stats?.mileage
                      ? `${stats.mileage.toFixed(1)} mi`
                      : '--'
                  }
                </div>
                {routeData?.fuelCost && routeData.fuelCost > 0 && (
                  <div className="text-[10px] text-rmpg-400 mt-1">
                    Fuel cost: ${routeData.fuelCost.toFixed(2)}
                  </div>
                )}
              </div>
              <div className="px-4 py-3 bg-[#141e2b] border border-[#1e3048] rounded">
                <div className="text-[10px] text-rmpg-400 uppercase font-semibold mb-1">Route Efficiency</div>
                <div className="text-lg font-bold text-white font-mono">
                  {routeData && stats?.planned_mileage && stats.planned_mileage > 0
                    ? `${Math.round((stats.planned_mileage / (routeData.totalDistance || 1)) * 100)}%`
                    : '--'
                  }
                </div>
                {routeData && (
                  <div className="text-[10px] text-rmpg-400 mt-1">
                    Est. drive time: {Math.floor((routeData.totalDuration || 0) / 60)}h {Math.round((routeData.totalDuration || 0) % 60)}m
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* Modals & Panels                                              */}
      {/* ══════════════════════════════════════════════════════════════ */}

      {/* Attempt Modal */}
      {attemptJob && (
        <ServeAttemptModal
          isOpen={!!attemptJob}
          onClose={() => setAttemptJob(null)}
          job={attemptJob}
          onSubmit={handleAttemptSubmit}
        />
      )}

      {/* Route Planner */}
      <ServeRoutePlanner
        isOpen={routePlannerOpen}
        onClose={() => setRoutePlannerOpen(false)}
        jobs={jobs.filter(j => j.status !== 'served' && j.status !== 'archived')}
        onRouteOptimized={handleRouteOptimized}
      />

      {/* Skip Trace Panel */}
      {skipTraceJob && (
        <ServeSkipTracePanel
          isOpen={!!skipTraceJob}
          onClose={() => setSkipTraceJob(null)}
          job={skipTraceJob}
          onAddToRoute={handleSkipTraceAddToRoute}
          onLookupComplete={refreshJobs}
        />
      )}

      {/* Create / Edit Job Modal */}
      <FormModal
        isOpen={createJobOpen}
        onClose={() => { setCreateJobOpen(false); setEditJob(null); resetForm(); }}
        onSubmit={handleFormSubmit}
        title={editJob ? 'Edit Job' : 'Add Serve Job'}
        icon={Briefcase}
        submitLabel={editJob ? 'Update' : 'Create'}
        isSubmitting={formSubmitting}
        maxWidth="max-w-xl"
        isDirty={formData.recipient_name.trim().length > 0}
      >
        <div className="space-y-3">
          {/* Recipient */}
          <div>
            <label className="block text-[11px] text-rmpg-400 mb-1">
              Recipient Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              required
              value={formData.recipient_name}
              onChange={e => handleFormChange('recipient_name', e.target.value)}
              className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none"
              placeholder="Full name"
            />
          </div>

          {/* Address */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-[11px] text-rmpg-400 mb-1">Address</label>
              <input
                type="text"
                value={formData.recipient_address}
                onChange={e => handleFormChange('recipient_address', e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none"
                placeholder="Street address"
              />
            </div>
            <div>
              <label className="block text-[11px] text-rmpg-400 mb-1">City</label>
              <input
                type="text"
                value={formData.recipient_city}
                onChange={e => handleFormChange('recipient_city', e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-rmpg-400 mb-1">State</label>
                <input
                  type="text"
                  value={formData.recipient_state}
                  onChange={e => handleFormChange('recipient_state', e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none"
                  maxLength={2}
                />
              </div>
              <div>
                <label className="block text-[11px] text-rmpg-400 mb-1">ZIP</label>
                <input
                  type="text"
                  value={formData.recipient_zip}
                  onChange={e => handleFormChange('recipient_zip', e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none"
                  maxLength={10}
                />
              </div>
            </div>
          </div>

          {/* Document type + priority */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-rmpg-400 mb-1">Document Type</label>
              <select
                value={formData.document_type}
                onChange={e => handleFormChange('document_type', e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none"
              >
                {DOCUMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-rmpg-400 mb-1">Priority</label>
              <select
                value={formData.priority}
                onChange={e => handleFormChange('priority', e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="rush">Rush</option>
              </select>
            </div>
          </div>

          {/* Time window + deadline */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-rmpg-400 mb-1">Time Window</label>
              <select
                value={formData.time_window}
                onChange={e => handleFormChange('time_window', e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none"
              >
                <option value="morning">Morning</option>
                <option value="afternoon">Afternoon</option>
                <option value="evening">Evening</option>
                <option value="anytime">Anytime</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-rmpg-400 mb-1">Deadline</label>
              <input
                type="date"
                value={formData.deadline}
                onChange={e => handleFormChange('deadline', e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Case / Court / Jurisdiction */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] text-rmpg-400 mb-1">Case Number</label>
              <input
                type="text"
                value={formData.case_number}
                onChange={e => handleFormChange('case_number', e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] text-rmpg-400 mb-1">Court</label>
              <input
                type="text"
                value={formData.court_name}
                onChange={e => handleFormChange('court_name', e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] text-rmpg-400 mb-1">Jurisdiction</label>
              <input
                type="text"
                value={formData.jurisdiction}
                onChange={e => handleFormChange('jurisdiction', e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Client + Attorney */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-rmpg-400 mb-1">Client Name</label>
              <input
                type="text"
                value={formData.client_name}
                onChange={e => handleFormChange('client_name', e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] text-rmpg-400 mb-1">Attorney Name</label>
              <input
                type="text"
                value={formData.attorney_name}
                onChange={e => handleFormChange('attorney_name', e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Max attempts */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-rmpg-400 mb-1">Max Attempts</label>
              <input
                type="number"
                min={1}
                max={10}
                value={formData.max_attempts}
                onChange={e => handleFormChange('max_attempts', parseInt(e.target.value, 10) || 3)}
                className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Instructions + notes */}
          <div>
            <label className="block text-[11px] text-rmpg-400 mb-1">Service Instructions</label>
            <textarea
              value={formData.service_instructions}
              onChange={e => handleFormChange('service_instructions', e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none resize-none"
              placeholder="Special instructions for service..."
            />
          </div>
          <div>
            <label className="block text-[11px] text-rmpg-400 mb-1">Notes</label>
            <textarea
              value={formData.notes}
              onChange={e => handleFormChange('notes', e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded text-white focus:border-brand-500 focus:outline-none resize-none"
              placeholder="Internal notes..."
            />
          </div>
        </div>
      </FormModal>
    </div>
  );
}

// ─── Stat Card Sub-component ────────────────────────────────────────────

function StatCard({
  label,
  value,
  color,
  bg,
  border,
}: {
  label: string;
  value: number;
  color: string;
  bg: string;
  border: string;
}) {
  return (
    <div className={`px-4 py-3 rounded border ${bg} ${border}`}>
      <div className="text-[10px] text-rmpg-400 uppercase font-semibold mb-1">{label}</div>
      <div className={`text-2xl font-bold font-mono ${color}`}>{value}</div>
    </div>
  );
}
