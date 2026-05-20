// ============================================================
// RMPG Flex — Process Server Field Suite
// Mobile-first page for managing serve jobs, route planning,
// attempt documentation, and skip traces.
// ============================================================

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import RichTextArea from '../components/RichTextArea';
import {
  Plus, RefreshCw, MapPin, BarChart3, List, Map as MapIcon, Briefcase, Calendar,
  Route, Navigation, Loader2, CheckCircle, Circle,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';
import { useAuth } from '../context/AuthContext';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { createMapboxMap, addMapboxTrail, injectMapboxStyles } from '../utils/mapboxLoader';
import { getMapboxToken } from '../utils/mapboxApiKey';
import ServeJobCard from '../components/serve/ServeJobCard';
import ServeAttemptModal from '../components/serve/ServeAttemptModal';
import ServeRoutePlanner from '../components/serve/ServeRoutePlanner';
import ServeSkipTracePanel from '../components/serve/ServeSkipTracePanel';
import FormModal from '../components/FormModal';
import type { ServeJob, ServeAttemptData, ServeSkipAddress } from '../types';
import ExportButton from '../components/ExportButton';

// ─── Constants ──────────────────────────────────────────────────────────

const TABS = ['Queue', 'Route', 'Map', 'Stats'] as const;
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
  pending: '#888888',
  in_progress: '#eab308',
  served: '#22c55e',
  failed: '#ef4444',
  skipped: '#666666',
  archived: '#555555',
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
  const { user } = useAuth();
  // ── Core state ──────────────────────────────────────────────────────
  const [selectedDate, setSelectedDate] = useState(() => formatDate(new Date()));
  const [activeTab, setActiveTab] = useState<Tab>('Queue');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  // ── Officers for route planner ──────────────────────────────────────
  const [officers, setOfficers] = useState<{ id: number; name: string }[]>([]);
  // ── Saved route state ───────────────────────────────────────────────
  const [savedRoute, setSavedRoute] = useState<any>(null);

  // ── Data ────────────────────────────────────────────────────────────
  const [jobs, setJobs] = useState<ServeJob[]>([]);
  const [linkedCalls, setLinkedCalls] = useState<Record<number, any>>({});
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState('');
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

  // ── Feature 10: Affidavit Generation ──
  const [affidavitData, setAffidavitData] = useState<any>(null);
  // ── Feature 12: Deadline Tracking ──
  const [deadlines, setDeadlines] = useState<any>(null);
  // ── Feature 14: Success Rate Stats ──
  const [successRates, setSuccessRates] = useState<any>(null);

  const handleGenerateAffidavit = async (jobId: number) => {
    try {
      const data = await apiFetch<any>(`/process-server/${jobId}/affidavit`);
      setAffidavitData(data);
    } catch { /* ignore */ }
  };

  const handleLoadDeadlines = async () => {
    try {
      const data = await apiFetch<any>('/process-server/deadlines');
      setDeadlines(data);
    } catch { /* ignore */ }
  };

  const handleLoadSuccessRates = async () => {
    try {
      const data = await apiFetch<any>('/process-server/success-rates?days=90');
      setSuccessRates(data);
    } catch { /* ignore */ }
  };

  // ── Map state ──────────────────────────────────────────────────────
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const trailIdRef = useRef<string | null>(null);
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
    setFetchError('');
    try {
      const data = await apiFetch<ServeJob[]>(`/process-server?date=${selectedDate}`);
      const fetchedJobs = data || [];
      setJobs(fetchedJobs);

      // Fetch linked dispatch calls for jobs that have call_id
      const jobsWithCalls = fetchedJobs.filter((j: any) => j.call_id);
      if (jobsWithCalls.length > 0) {
        const callMap: Record<number, any> = {};
        await Promise.all(
          jobsWithCalls.map(async (j: any) => {
            try {
              const call = await apiFetch(`/dispatch/calls/${j.call_id}`);
              if (call) callMap[j.id] = call;
            } catch {}
          })
        );
        setLinkedCalls(callMap);
      } else {
        setLinkedCalls({});
      }
    } catch (err: any) {
      setFetchError(err?.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await apiFetch<StatsSummary>(`/process-server/stats/summary?date=${selectedDate}`);
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
  useLiveSync('process-server', refreshJobs);

  // ── Fetch officers for route planner ─────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<any>('/personnel?status=active');
        if (cancelled) return;
        const list = Array.isArray(res) ? res : res?.data ?? [];
        setOfficers(list.map((u: any) => ({ id: u.id, name: u.full_name || `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.username })));
      } catch { /* non-critical */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Fetch saved route for today ──────────────────────────────────
  const fetchSavedRoute = useCallback(async () => {
    if (!user?.id) return;
    try {
      const route = await apiFetch<any>(`/process-server/routes/${selectedDate}?officer_id=${Number(user.id)}`);
      setSavedRoute(route);
    } catch { setSavedRoute(null); }
  }, [selectedDate, user?.id]);

  useEffect(() => { fetchSavedRoute(); }, [fetchSavedRoute]);

  // ══════════════════════════════════════════════════════════════════════
  // Handlers
  // ══════════════════════════════════════════════════════════════════════

  const handleSyncFromSM = useCallback(async () => {
    setSyncing(true);
    try {
      await apiFetch('/process-server/sync-from-sm', { method: 'POST' });
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
      await apiFetch(`/process-server/${jobId}`, {
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
      await apiFetch('/process-server/reorder', {
        method: 'PUT',
        body: JSON.stringify({ orderedIds: orderedJobIds }),
      });
      refreshJobs();
      fetchSavedRoute(); // Refresh saved route for Route tab
    } catch {
      // reorder failed — local state still updated
    }
  }, [refreshJobs, fetchSavedRoute]);

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
        await apiFetch(`/process-server/${editJob.id}`, {
          method: 'PUT',
          body: JSON.stringify(formData),
        });
      } else {
        await apiFetch('/process-server', {
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

  // ── Feature 1: Priority Queue Sort ──
  const [sortByUrgency, setSortByUrgency] = useState(false);
  // ── Feature 5: Cost Calculator ──
  const [costEstimate, setCostEstimate] = useState<any>(null);
  const [costJobId, setCostJobId] = useState<number | null>(null);

  const handleLoadCostEstimate = async (jobId: number) => {
    setCostJobId(jobId);
    try {
      const data = await apiFetch<any>(`/process-server/${jobId}/cost-estimate`);
      setCostEstimate(data);
    } catch { setCostEstimate(null); }
  };

  // ── Feature 3: Serve Completion Notification ──
  const handleNotifyCompletion = async (jobId: number) => {
    try {
      await apiFetch(`/process-server/${jobId}/notify-completion`, { method: 'POST' });
    } catch { /* ignore */ }
  };

  const filteredJobs = useMemo(() => {
    let result = statusFilter === 'all' ? jobs : jobs.filter(j => j.status === statusFilter);

    // Feature 1: Sort by deadline urgency
    if (sortByUrgency) {
      result = [...result].sort((a, b) => {
        // Priority: overdue > no deadline is last
        const getUrgencyScore = (j: ServeJob) => {
          if (!j.deadline) return 999;
          const daysLeft = (new Date(j.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
          if (daysLeft < 0) return -100 + daysLeft; // overdue: most negative first
          return daysLeft;
        };
        return getUrgencyScore(a) - getUrgencyScore(b);
      });
    }

    return result;
  }, [jobs, statusFilter, sortByUrgency]);

  // ══════════════════════════════════════════════════════════════════════
  // Map Tab
  // ══════════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (activeTab !== 'Map') return;

    let cancelled = false;

    const initMap = async () => {
      if (cancelled || !mapContainerRef.current) return;

      // If map already exists, just update markers
      if (mapRef.current) {
        updateMapMarkers();
        return;
      }

      try {
        const token = await getMapboxToken();
        if (cancelled || !token) {
          if (!cancelled) setMapReady(false);
          return;
        }

        injectMapboxStyles();
        const map = createMapboxMap({
          container: mapContainerRef.current,
          accessToken: token,
          center: [-111.891, 40.7608], // SLC default [lng, lat]
          zoom: 11,
        });

        map.on('load', () => {
          if (!cancelled) {
            mapRef.current = map;
            setMapReady(true);
          }
        });
      } catch {
        if (!cancelled) setMapReady(false);
      }
    };

    initMap();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        setMapReady(false);
      }
    };
  }, [activeTab]);

  // Update markers when jobs change or map becomes ready
  const updateMapMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear old markers
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    // Clear old trail
    if (trailIdRef.current) {
      try {
        if (map.getLayer(trailIdRef.current)) map.removeLayer(trailIdRef.current);
        if (map.getSource(trailIdRef.current)) map.removeSource(trailIdRef.current);
      } catch { /* layer/source may not exist */ }
      trailIdRef.current = null;
    }

    const bounds = new mapboxgl.LngLatBounds();
    let hasMarkers = false;

    jobs.forEach(job => {
      if (job.recipient_lat == null || job.recipient_lng == null) return;
      hasMarkers = true;
      bounds.extend([job.recipient_lng, job.recipient_lat]);

      const color = MARKER_COLORS[job.status] || MARKER_COLORS.pending;

      // Custom marker element
      const el = document.createElement('div');
      el.style.cssText = `width:20px;height:20px;border-radius:50%;background:${color};border:2px solid #ffffff;cursor:pointer;box-shadow:0 0 6px ${color}80;`;
      el.title = job.recipient_name;

      const fullAddr = [job.recipient_address, job.recipient_city, job.recipient_state, job.recipient_zip]
        .filter(Boolean).join(', ');

      const popup = new mapboxgl.Popup({ offset: 12, closeButton: false, className: 'mapbox-popup-dark' })
        .setHTML(`
          <div style="color:#fff;background:#141414;padding:8px 12px;border-radius:2px;min-width:180px;font-family:system-ui;">
            <div style="font-weight:600;font-size:13px;margin-bottom:4px;">${job.recipient_name}</div>
            <div style="font-size:11px;color:#8a9aaa;">${fullAddr || 'No address'}</div>
            <div style="font-size:10px;color:#6b7280;margin-top:4px;text-transform:uppercase;">${job.status.replace(/_/g, ' ')} &middot; ${(job.document_type || '').replace(/_/g, ' ')}</div>
          </div>
        `);

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([job.recipient_lng, job.recipient_lat])
        .setPopup(popup)
        .addTo(map);

      markersRef.current.push(marker);
    });

    // Draw trail if route planned
    if (routeData && routeData.orderedIds.length > 1) {
      const coords = routeData.orderedIds
        .map(id => jobs.find(j => j.id === id))
        .filter((j): j is ServeJob => !!j && j.recipient_lat != null && j.recipient_lng != null)
        .map(j => [j.recipient_lng!, j.recipient_lat!] as [number, number]);

      if (coords.length > 1) {
        const trailId = 'serve-route-trail';
        addMapboxTrail(map, trailId, coords, '#888888', 3);
        trailIdRef.current = trailId;
      }
    }

    if (hasMarkers) {
      map.fitBounds(bounds, { padding: 60 });
    }
  }, [jobs, routeData]);

  useEffect(() => {
    if (mapReady) updateMapMarkers();
  }, [mapReady, updateMapMarkers]);

  // ══════════════════════════════════════════════════════════════════════
  // Render
  // ══════════════════════════════════════════════════════════════════════

  // Set document title
  useEffect(() => { document.title = 'Process Server \u2014 RMPG Flex'; }, []);

  // Keyboard shortcut: Escape to close modals
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setCreateJobOpen(false); setEditJob(null); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="flex flex-col h-full bg-surface-base" role="main">
      {fetchError && (
        <div className="mx-4 mt-2 p-2 bg-red-900/30 border border-red-700/50 rounded-[2px] text-red-400 text-xs flex items-center gap-2 animate-in fade-in duration-200">
          <span>⚠ {fetchError}</span>
          <button type="button" onClick={() => setFetchError('')} className="ml-auto text-red-500 hover:text-red-300 transition-colors" aria-label="Dismiss error">✕</button>
        </div>
      )}
      {/* ─── Header Bar ────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#2b2b2b] bg-[#0c0c0c] flex-wrap" role="toolbar" aria-label="Process Server controls">
        <div className="flex items-center gap-1.5">
          <Briefcase size={16} className="text-[#d4a017]" />
          {!isMobile && <span className="text-sm font-semibold text-white tracking-wider">PROCESS SERVER</span>}
          {!isMobile && <span className="block h-px w-full bg-[#d4a017]/30 mt-0.5" />}
        </div>

        {/* Date picker + route stats */}
        <div className="flex items-center gap-1 ml-auto sm:ml-2">
          <Calendar size={14} className="text-rmpg-400" />
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="px-2 py-1 text-xs bg-[#141414] border border-[#2b2b2b] rounded-[2px] text-white focus:border-[#888888] focus:outline-none focus:ring-1 focus:ring-[#888888]/40 transition-colors"
          />
          {/* Route stats inline (Step 3.5) */}
          {savedRoute && savedRoute.optimized_order_json && (() => {
            const orderIds: number[] = (() => {
              try {
                return typeof savedRoute.optimized_order_json === 'string'
                  ? JSON.parse(savedRoute.optimized_order_json)
                  : savedRoute.optimized_order_json;
              } catch { return []; }
            })();
            const stopCount = orderIds.length;
            const dist = savedRoute.total_distance_miles;
            const mins = savedRoute.total_time_minutes;
            if (stopCount === 0) return null;
            return (
              <span className="font-mono tabular-nums text-[10px] ml-1.5 px-1.5 py-0.5 rounded-[2px]" style={{ color: '#d4a017', background: '#d4a01710', border: '1px solid #d4a01720' }}>
                {stopCount} stops
                {dist ? ` / ${Number(dist).toFixed(0)} mi` : ''}
                {mins ? ` / ~${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m` : ''}
              </span>
            );
          })()}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5">
          <button type="button"
            onClick={() => setRoutePlannerOpen(true)}
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-gray-400 bg-gray-900/20 hover:bg-gray-900/40 border border-gray-700/40 rounded-[2px] transition-all duration-150 hover:shadow-[0_0_8px_rgba(136, 136, 136,0.15)] focus:outline-none focus:ring-1 focus:ring-gray-500/50"
            title="Plan Route"
            aria-label="Plan Route"
          >
            <Route size={12} />
            {!isMobile && 'Plan Route'}
          </button>
          <button type="button"
            onClick={handleSyncFromSM}
            disabled={syncing}
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-gray-400 bg-gray-900/20 hover:bg-gray-900/40 border border-gray-700/40 rounded-[2px] transition-all duration-150 disabled:opacity-40 hover:shadow-[0_0_8px_rgba(34,211,238,0.15)] focus:outline-none focus:ring-1 focus:ring-gray-500/50"
            title="Sync from ServeManager"
            aria-label="Sync from ServeManager"
          >
            {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {!isMobile && 'Sync from SM'}
          </button>
          <button type="button"
            onClick={openCreate}
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-green-400 bg-green-900/20 hover:bg-green-900/40 border border-green-700/40 rounded-[2px] transition-all duration-150 hover:shadow-[0_0_8px_rgba(34,197,94,0.15)] focus:outline-none focus:ring-1 focus:ring-green-500/50"
            title="Add Job"
            aria-label="Add serve job"
          >
            <Plus size={12} />
            {!isMobile && 'Add Job'}
          </button>
          <ExportButton exportUrl="/api/process-server/export/csv" exportFilename="serve-jobs.csv" />
        </div>
      </div>

      {/* ─── Tab Bar ───────────────────────────────────────────────── */}
      <div className="flex items-center border-b border-[#2b2b2b] bg-[#0c0c0c]" role="tablist" aria-label="Process Server views">
        {TABS.map(tab => {
          const Icon = tab === 'Queue' ? List : tab === 'Route' ? Route : tab === 'Map' ? MapIcon : BarChart3;
          return (
            <button type="button"
              key={tab}
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-all duration-150 border-b-2 ${
                activeTab === tab
                  ? 'text-[#d4a017] border-[#d4a017] bg-[#d4a017]/5'
                  : 'text-rmpg-400 border-transparent hover:text-rmpg-200 hover:border-rmpg-600 hover:bg-white/[0.02]'
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
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[#2b2b2b] overflow-x-auto">
              {STATUS_FILTERS.map(f => (
                <button type="button"
                  key={f.value}
                  role="button"
                  aria-pressed={statusFilter === f.value}
                  onClick={() => setStatusFilter(f.value)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-[2px] border transition-all duration-150 whitespace-nowrap focus:outline-none focus:ring-1 focus:ring-[#888888]/50 ${
                    statusFilter === f.value
                      ? 'text-white bg-[#888888] border-[#888888] shadow-[0_0_6px_rgba(212,160,23,0.3)]'
                      : 'text-rmpg-400 bg-transparent border-rmpg-600 hover:border-rmpg-400 hover:text-rmpg-200'
                  }`}
                >
                  {f.label}
                  {f.value !== 'all' && (
                    <span className="ml-1 text-[10px] tabular-nums font-mono text-rmpg-500">
                      {jobs.filter(j => j.status === f.value).length}
                    </span>
                  )}
                </button>
              ))}
              {/* Feature 1: Priority Sort Toggle */}
              <button type="button"
                role="button"
                aria-pressed={sortByUrgency}
                onClick={() => setSortByUrgency(prev => !prev)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-[2px] border transition-all duration-150 whitespace-nowrap ml-auto focus:outline-none focus:ring-1 focus:ring-amber-500/50 ${
                  sortByUrgency
                    ? 'text-amber-400 bg-amber-900/30 border-amber-600 shadow-[0_0_6px_rgba(245,158,11,0.2)]'
                    : 'text-rmpg-400 bg-transparent border-rmpg-600 hover:border-rmpg-400 hover:text-rmpg-200'
                }`}
                title="Sort by deadline urgency"
              >
                {sortByUrgency ? '⚡ Urgent First' : '↕ Priority Sort'}
              </button>
            </div>

            {/* Feature 1: Urgency color indicators */}
            {sortByUrgency && filteredJobs.length > 0 && (
              <div className="px-3 py-1 border-b border-[#2b2b2b] flex items-center gap-3 text-[9px] text-rmpg-500">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Overdue</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500 inline-block" /> {'<'}24h</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> {'<'}3d</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-500 inline-block" /> {'<'}7d</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> 7d+</span>
              </div>
            )}

            {/* Job list */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2 scrollbar-dark">
              {loading && jobs.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-xs text-rmpg-400">
                  <Loader2 size={16} className="animate-spin mr-2 text-[#888888]" />
                  <span className="text-rmpg-400">Loading jobs...</span>
                </div>
              ) : filteredJobs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-center">
                  <div className="w-12 h-12 rounded-full bg-[#0c0c0c] flex items-center justify-center mb-3">
                    <Briefcase size={20} className="text-rmpg-500" />
                  </div>
                  <p className="text-sm text-rmpg-400 font-medium">
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
                    linkedCall={linkedCalls[job.id] || null}
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

        {/* ── Route Tab (Step 3.4) ──────────────────────────────── */}
        {activeTab === 'Route' && (
          <div className="h-full overflow-y-auto p-4 space-y-4 scrollbar-dark">
            {savedRoute && savedRoute.optimized_order_json ? (() => {
              const orderIds: number[] = (() => {
                try {
                  return typeof savedRoute.optimized_order_json === 'string'
                    ? JSON.parse(savedRoute.optimized_order_json)
                    : savedRoute.optimized_order_json;
                } catch { return []; }
              })();
              const routeJobs = orderIds
                .map(id => jobs.find(j => j.id === id))
                .filter((j): j is ServeJob => !!j);
              const completedCount = routeJobs.filter(j => j.status === 'served').length;
              const totalStops = routeJobs.length;
              const progressPct = totalStops > 0 ? Math.round((completedCount / totalStops) * 100) : 0;

              return (
                <>
                  {/* Stats bar */}
                  <div className="flex items-center gap-4 flex-wrap px-3 py-2 bg-[#0c0c0c] border border-[#2b2b2b] rounded-[2px]" role="status" aria-label="Route statistics">
                    <div className="flex items-center gap-1.5 text-rmpg-400 text-xs">
                      <MapPin size={12} className="text-gray-400" />
                      <span className="font-mono tabular-nums text-white">{totalStops}</span> stops
                    </div>
                    <div className="flex items-center gap-1.5 text-rmpg-400 text-xs">
                      <Navigation size={12} className="text-emerald-400" />
                      <span className="font-mono tabular-nums text-white">
                        {savedRoute.total_distance_miles ? `${Number(savedRoute.total_distance_miles).toFixed(1)} mi` : '--'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-rmpg-400 text-xs">
                      <Calendar size={12} className="text-amber-400" />
                      <span className="font-mono tabular-nums text-white">
                        {savedRoute.total_time_minutes
                          ? `~${Math.floor(savedRoute.total_time_minutes / 60)}h ${Math.round(savedRoute.total_time_minutes % 60)}m`
                          : '--'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-rmpg-400 text-xs ml-auto">
                      <span className="font-mono tabular-nums" style={{ color: '#d4a017' }}>
                        {completedCount}/{totalStops} done ({progressPct}%)
                      </span>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full h-1.5 bg-[#181818] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${progressPct}%`,
                        background: progressPct === 100 ? '#22c55e' : '#d4a017',
                        boxShadow: `0 0 6px ${progressPct === 100 ? '#22c55e' : '#d4a017'}40`,
                      }}
                    />
                  </div>

                  {/* Ordered stop list */}
                  <div className="space-y-1">
                    {routeJobs.map((job, idx) => {
                      const isCompleted = job.status === 'served';
                      const isFailed = job.status === 'failed';
                      return (
                        <div
                          key={job.id}
                          className={`flex items-center gap-3 px-3 py-2 rounded-[2px] border transition-all duration-150 ${
                            isCompleted
                              ? 'bg-green-900/10 border-green-800/30 opacity-60'
                              : isFailed
                                ? 'bg-red-900/10 border-red-800/30 opacity-60'
                                : 'bg-[#141414] border-[#2b2b2b] hover:border-[#888888]/30'
                          }`}
                        >
                          {/* Stop number */}
                          <span
                            className="w-6 h-6 flex items-center justify-center rounded-full text-[10px] font-bold text-white flex-shrink-0"
                            style={{
                              background: isCompleted ? '#22c55e' : isFailed ? '#ef4444' : job.status === 'in_progress' ? '#eab308' : '#888888',
                            }}
                          >
                            {idx + 1}
                          </span>

                          {/* Completion indicator */}
                          {isCompleted ? (
                            <CheckCircle size={14} className="text-green-400 flex-shrink-0" />
                          ) : (
                            <Circle size={14} className="text-rmpg-600 flex-shrink-0" />
                          )}

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className={`text-xs font-medium truncate ${isCompleted ? 'text-rmpg-400 line-through' : 'text-white'}`}>
                              {job.recipient_name}
                            </div>
                            <div className="text-[10px] text-rmpg-500 truncate">
                              {job.recipient_address || 'No address'}
                              {job.recipient_city ? `, ${job.recipient_city}` : ''}
                            </div>
                          </div>

                          {/* Status badge */}
                          <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded-[2px] flex-shrink-0" style={{
                            background: isCompleted ? '#22c55e20' : isFailed ? '#ef444420' : job.status === 'in_progress' ? '#eab30820' : '#88888820',
                            color: isCompleted ? '#4ade80' : isFailed ? '#f87171' : job.status === 'in_progress' ? '#facc15' : '#aaaaaa',
                            border: `1px solid ${isCompleted ? '#22c55e30' : isFailed ? '#ef444430' : job.status === 'in_progress' ? '#eab30830' : '#88888830'}`,
                          }}>
                            {job.status.replace('_', ' ')}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 pt-2">
                    <button type="button"
                      onClick={() => setRoutePlannerOpen(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-400 bg-gray-900/20 hover:bg-gray-900/40 border border-gray-700/40 rounded-[2px] transition-all duration-150 hover:shadow-[0_0_8px_rgba(136, 136, 136,0.15)] focus:outline-none focus:ring-1 focus:ring-gray-500/50"
                      aria-label="Open Route Planner"
                    >
                      <Route size={12} />
                      Open Route Planner
                    </button>
                    <button type="button"
                      onClick={() => {
                        // Build navigation URL with all waypoints
                        const geocoded = routeJobs.filter(j => j.status !== 'served' && j.recipient_lat != null && j.recipient_lng != null);
                        if (geocoded.length === 0) return;
                        const dest = geocoded[geocoded.length - 1];
                        const waypoints = geocoded.slice(0, -1).map(j => `${j.recipient_lat},${j.recipient_lng}`).join('|');
                        const url = `https://www.google.com/maps/dir/?api=1&destination=${dest.recipient_lat},${dest.recipient_lng}${waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : ''}&travelmode=driving`;
                        window.open(url, '_blank', 'noopener,noreferrer');
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-400 bg-emerald-900/20 hover:bg-emerald-900/40 border border-emerald-700/40 rounded-[2px] transition-all duration-150 hover:shadow-[0_0_8px_rgba(16,185,129,0.15)] focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                      aria-label="Start Navigation"
                    >
                      <Navigation size={12} />
                      Start Navigation
                    </button>
                  </div>
                </>
              );
            })() : (
              <div className="flex flex-col items-center justify-center h-40 text-center">
                <div className="w-12 h-12 rounded-full bg-[#181818] flex items-center justify-center mb-3">
                  <Route size={20} className="text-rmpg-500" />
                </div>
                <p className="text-sm text-rmpg-400 font-medium mb-3">No route planned for this date.</p>
                <button type="button"
                  onClick={() => setRoutePlannerOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-400 bg-gray-900/20 hover:bg-gray-900/40 border border-gray-700/40 rounded-[2px] transition-all duration-150 hover:shadow-[0_0_8px_rgba(136, 136, 136,0.15)] focus:outline-none focus:ring-1 focus:ring-gray-500/50"
                  aria-label="Open Route Planner"
                >
                  <Route size={12} />
                  Plan a Route
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Map Tab ─────────────────────────────────────────────── */}
        {activeTab === 'Map' && (
          <div className="h-full relative">
            <div ref={mapContainerRef} className="absolute inset-0" />
            {!mapReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-[#0c0c0c]">
                <div className="flex items-center gap-2 text-xs text-rmpg-400">
                  <Loader2 size={14} className="animate-spin" />
                  Loading map...
                </div>
              </div>
            )}

            {/* Navigate to Next button */}
            {mapReady && jobs.some(j => j.status === 'pending' || j.status === 'in_progress') && (
              <button type="button"
                onClick={handleNavigateToNext}
                className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#888888] hover:bg-[#888888]/80 rounded-[2px] shadow-lg shadow-[#888888]/20 border border-[#888888] transition-all duration-150 hover:shadow-[0_0_16px_rgba(212,160,23,0.3)] focus:outline-none focus:ring-2 focus:ring-[#888888]/50"
              >
                <Navigation size={16} />
                Navigate to Next
              </button>
            )}
          </div>
        )}

        {/* ── Stats Tab ───────────────────────────────────────────── */}
        {activeTab === 'Stats' && (
          <div className="h-full overflow-y-auto p-4 space-y-4 scrollbar-dark">
            {/* Summary cards */}
            <div className={`grid gap-3 ${isMobile ? 'grid-cols-2' : 'grid-cols-4'}`}>
              <StatCard
                label="Jobs Remaining"
                value={(stats?.pending ?? 0) + (stats?.in_progress ?? 0)}
                color="text-gray-400"
                bg="bg-gray-900/20"
                border="border-gray-700/40"
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
              <div className="px-4 py-3 bg-[#141414] border border-[#2b2b2b] rounded-[2px] transition-colors hover:border-[#888888]/30">
                <div className="text-[10px] text-[#d4a017] uppercase font-semibold tracking-wider mb-1">Mileage Today</div>
                <div className="text-lg font-bold text-white font-mono tabular-nums">
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
              <div className="px-4 py-3 bg-[#141414] border border-[#2b2b2b] rounded-[2px] transition-colors hover:border-[#888888]/30">
                <div className="text-[10px] text-[#d4a017] uppercase font-semibold tracking-wider mb-1">Route Efficiency</div>
                <div className="text-lg font-bold text-white font-mono tabular-nums">
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

            {/* Feature 5: Cost Calculator */}
            <div className="p-3 bg-[#141414] border border-[#2b2b2b] rounded-[2px]">
              <div className="text-[10px] text-[#d4a017] uppercase font-semibold tracking-wider mb-2">Job Cost Calculator</div>
              <div className="flex items-center gap-2">
                <select
                  value={costJobId || ''}
                  onChange={e => { const v = parseInt(e.target.value, 10); if (v) handleLoadCostEstimate(v); }}
                  className="flex-1 px-2 py-1 text-xs bg-[#0c0c0c] border border-[#2b2b2b] rounded-[2px] text-white focus:border-[#888888] focus:outline-none focus:ring-1 focus:ring-[#888888]/40 transition-colors"
                >
                  <option value="">Select a job...</option>
                  {jobs.map(j => (
                    <option key={j.id} value={j.id}>{j.recipient_name} - {j.document_type || 'N/A'}</option>
                  ))}
                </select>
              </div>
              {costEstimate && (
                <div className="mt-2 space-y-1 text-[10px]">
                  <div className="flex justify-between"><span className="text-rmpg-400">Base Fee:</span><span className="text-white">${costEstimate.costs.base_fee.toFixed(2)}</span></div>
                  {costEstimate.costs.extra_attempts > 0 && (
                    <div className="flex justify-between"><span className="text-rmpg-400">Extra Attempts ({costEstimate.costs.extra_attempts}):</span><span className="text-white">${costEstimate.costs.extra_attempt_fee.toFixed(2)}</span></div>
                  )}
                  {costEstimate.costs.rush_surcharge > 0 && (
                    <div className="flex justify-between"><span className="text-amber-400">Rush Surcharge:</span><span className="text-white">${costEstimate.costs.rush_surcharge.toFixed(2)}</span></div>
                  )}
                  {costEstimate.costs.skip_trace_count > 0 && (
                    <div className="flex justify-between"><span className="text-rmpg-400">Skip Traces ({costEstimate.costs.skip_trace_count}):</span><span className="text-white">${costEstimate.costs.skip_trace_fee.toFixed(2)}</span></div>
                  )}
                  {costEstimate.costs.mileage > 0 && (
                    <div className="flex justify-between"><span className="text-rmpg-400">Mileage ({costEstimate.costs.mileage.toFixed(1)} mi):</span><span className="text-white">${costEstimate.costs.mileage_fee.toFixed(2)}</span></div>
                  )}
                  <div className="flex justify-between border-t border-rmpg-700 pt-1 font-bold"><span className="text-brand-400">Total:</span><span className="text-brand-300">${costEstimate.costs.total.toFixed(2)}</span></div>
                </div>
              )}
            </div>

            {/* Feature 12: Deadline Tracking + Feature 14: Success Rates */}
            <div className="flex gap-2">
              <button type="button" onClick={handleLoadDeadlines} className="toolbar-btn toolbar-btn-primary text-xs px-3 py-1.5">
                <Calendar className="w-3.5 h-3.5" /> Deadline Tracker
              </button>
              <button type="button" onClick={handleLoadSuccessRates} className="toolbar-btn text-xs px-3 py-1.5">
                <BarChart3 className="w-3.5 h-3.5" /> Success Rates
              </button>
            </div>

            {/* Feature 12: Deadline Tracking Panel */}
            {deadlines && (
              <div className="p-3 bg-[#141414] border border-[#2b2b2b] rounded-[2px] space-y-2">
                <div className="flex justify-between items-center">
                  <div className="text-[10px] text-[#d4a017] uppercase font-semibold tracking-wider">Deadline Tracker ({deadlines.total} active)</div>
                  <button type="button" onClick={() => setDeadlines(null)} className="text-rmpg-500 hover:text-rmpg-300 text-xs transition-colors" aria-label="Close deadline tracker">Close</button>
                </div>
                {deadlines.overdue?.length > 0 && (
                  <div>
                    <div className="text-[9px] text-red-400 font-bold uppercase">Overdue ({deadlines.overdue.length})</div>
                    {deadlines.overdue.map((d: any) => (
                      <div key={d.id} className="text-[10px] flex gap-2 py-0.5 text-red-300">
                        <span>{d.recipient_name}</span>
                        <span className="text-rmpg-500">{(d.document_type || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</span>
                        <span className="ml-auto">{Math.abs(Math.round(d.days_remaining))}d overdue</span>
                      </div>
                    ))}
                  </div>
                )}
                {deadlines.urgent?.length > 0 && (
                  <div>
                    <div className="text-[9px] text-amber-400 font-bold uppercase">Due within 3 days ({deadlines.urgent.length})</div>
                    {deadlines.urgent.map((d: any) => (
                      <div key={d.id} className="text-[10px] flex gap-2 py-0.5 text-amber-300">
                        <span>{d.recipient_name}</span>
                        <span className="text-rmpg-500">{d.deadline}</span>
                        <span className="ml-auto">{Math.round(d.days_remaining)}d left</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Feature 14: Success Rate Stats Panel */}
            {successRates && (
              <div className="p-3 bg-[#141414] border border-[#2b2b2b] rounded-[2px] space-y-2">
                <div className="flex justify-between items-center">
                  <div className="text-[10px] text-[#d4a017] uppercase font-semibold tracking-wider">Success Rates ({successRates.period_days}d)</div>
                  <button type="button" onClick={() => setSuccessRates(null)} className="text-rmpg-500 hover:text-rmpg-300 text-xs transition-colors" aria-label="Close success rates">Close</button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  <div><div className="text-lg font-bold tabular-nums font-mono text-green-400" style={{ textShadow: '0 0 4px currentColor' }}>{successRates.overall?.success_rate}%</div><div className="text-[9px] text-rmpg-400">Overall</div></div>
                  <div><div className="text-lg font-bold tabular-nums font-mono text-white" style={{ textShadow: '0 0 4px currentColor' }}>{successRates.overall?.total}</div><div className="text-[9px] text-rmpg-400">Total Jobs</div></div>
                  <div><div className="text-lg font-bold tabular-nums font-mono text-green-400" style={{ textShadow: '0 0 4px currentColor' }}>{successRates.overall?.served}</div><div className="text-[9px] text-rmpg-400">Served</div></div>
                  <div><div className="text-lg font-bold tabular-nums font-mono text-white" style={{ textShadow: '0 0 4px currentColor' }}>{successRates.overall?.avg_attempts?.toFixed(1)}</div><div className="text-[9px] text-rmpg-400">Avg Attempts</div></div>
                </div>
                {successRates.by_officer?.length > 0 && (
                  <div>
                    <div className="text-[9px] text-rmpg-400 uppercase font-semibold mb-1">By Officer</div>
                    {successRates.by_officer.map((o: any) => (
                      <div key={o.officer_id} className="text-[10px] flex gap-2 py-0.5">
                        <span className="text-white flex-1">{o.officer_name || 'Unassigned'}</span>
                        <span className="text-green-400">{o.success_rate}%</span>
                        <span className="text-rmpg-500">{o.served}/{o.total}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
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
        officers={officers}
        currentUserId={user?.id ? Number(user.id) : undefined}
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
              className="w-full px-3 py-2 text-sm bg-[#0c0c0c] border border-[#2b2b2b] rounded-[2px] text-white focus:border-[#888888] focus:outline-none focus:ring-1 focus:ring-[#888888]/40 transition-colors"
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
                className="w-full px-3 py-2 text-sm bg-[#0c0c0c] border border-[#2b2b2b] rounded-[2px] text-white focus:border-[#888888] focus:outline-none focus:ring-1 focus:ring-[#888888]/40 transition-colors"
                placeholder="Street address"
              />
            </div>
            <div>
              <label className="block text-[11px] text-rmpg-400 mb-1">City</label>
              <input
                type="text"
                value={formData.recipient_city}
                onChange={e => handleFormChange('recipient_city', e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#0c0c0c] border border-[#2b2b2b] rounded-[2px] text-white focus:border-[#888888] focus:outline-none focus:ring-1 focus:ring-[#888888]/40 transition-colors"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-rmpg-400 mb-1">State</label>
                <input
                  type="text"
                  value={formData.recipient_state}
                  onChange={e => handleFormChange('recipient_state', e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[#0c0c0c] border border-[#2b2b2b] rounded-[2px] text-white focus:border-[#888888] focus:outline-none focus:ring-1 focus:ring-[#888888]/40 transition-colors"
                  maxLength={2}
                />
              </div>
              <div>
                <label className="block text-[11px] text-rmpg-400 mb-1">ZIP</label>
                <input
                  type="text"
                  value={formData.recipient_zip}
                  onChange={e => handleFormChange('recipient_zip', e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[#0c0c0c] border border-[#2b2b2b] rounded-[2px] text-white focus:border-[#888888] focus:outline-none focus:ring-1 focus:ring-[#888888]/40 transition-colors"
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
                className="w-full px-3 py-2 text-sm bg-[#0c0c0c] border border-[#2b2b2b] rounded-[2px] text-white focus:border-[#888888] focus:outline-none focus:ring-1 focus:ring-[#888888]/40 transition-colors"
              >
                {DOCUMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-rmpg-400 mb-1">Priority</label>
              <select
                value={formData.priority}
                onChange={e => handleFormChange('priority', e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#0c0c0c] border border-[#2b2b2b] rounded-[2px] text-white focus:border-[#888888] focus:outline-none focus:ring-1 focus:ring-[#888888]/40 transition-colors"
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
                className="w-full px-3 py-2 text-sm bg-[#0c0c0c] border border-[#2b2b2b] rounded-[2px] text-white focus:border-[#888888] focus:outline-none focus:ring-1 focus:ring-[#888888]/40 transition-colors"
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
                className="w-full px-3 py-2 text-sm bg-[#0c0c0c] border border-[#2b2b2b] rounded-[2px] text-white focus:border-[#888888] focus:outline-none focus:ring-1 focus:ring-[#888888]/40 transition-colors"
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
                className="w-full px-3 py-2 text-sm bg-[#0c0c0c] border border-[#2b2b2b] rounded-[2px] text-white focus:border-[#888888] focus:outline-none focus:ring-1 focus:ring-[#888888]/40 transition-colors"
              />
            </div>
            <div>
              <label className="block text-[11px] text-rmpg-400 mb-1">Court</label>
              <input
                type="text"
                value={formData.court_name}
                onChange={e => handleFormChange('court_name', e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#0c0c0c] border border-[#2b2b2b] rounded-[2px] text-white focus:border-[#888888] focus:outline-none focus:ring-1 focus:ring-[#888888]/40 transition-colors"
              />
            </div>
            <div>
              <label className="block text-[11px] text-rmpg-400 mb-1">Jurisdiction</label>
              <input
                type="text"
                value={formData.jurisdiction}
                onChange={e => handleFormChange('jurisdiction', e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#0c0c0c] border border-[#2b2b2b] rounded-[2px] text-white focus:border-[#888888] focus:outline-none focus:ring-1 focus:ring-[#888888]/40 transition-colors"
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
                className="w-full px-3 py-2 text-sm bg-[#0c0c0c] border border-[#2b2b2b] rounded-[2px] text-white focus:border-[#888888] focus:outline-none focus:ring-1 focus:ring-[#888888]/40 transition-colors"
              />
            </div>
            <div>
              <label className="block text-[11px] text-rmpg-400 mb-1">Attorney Name</label>
              <input
                type="text"
                value={formData.attorney_name}
                onChange={e => handleFormChange('attorney_name', e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#0c0c0c] border border-[#2b2b2b] rounded-[2px] text-white focus:border-[#888888] focus:outline-none focus:ring-1 focus:ring-[#888888]/40 transition-colors"
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
                className="w-full px-3 py-2 text-sm bg-[#0c0c0c] border border-[#2b2b2b] rounded-[2px] text-white focus:border-[#888888] focus:outline-none focus:ring-1 focus:ring-[#888888]/40 transition-colors"
              />
            </div>
          </div>

          {/* Instructions + notes */}
          <div>
            <label className="block text-[11px] text-rmpg-400 mb-1">Service Instructions</label>
            <RichTextArea
              value={formData.service_instructions}
              onChange={e => handleFormChange('service_instructions', e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-sm bg-[#0c0c0c] border border-[#2b2b2b] rounded-[2px] text-white focus:border-[#888888] focus:outline-none focus:ring-1 focus:ring-[#888888]/40 transition-colors resize-none"
              placeholder="Special instructions for service..."
            />
          </div>
          <div>
            <label className="block text-[11px] text-rmpg-400 mb-1">Notes</label>
            <RichTextArea
              value={formData.notes}
              onChange={e => handleFormChange('notes', e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-sm bg-[#0c0c0c] border border-[#2b2b2b] rounded-[2px] text-white focus:border-[#888888] focus:outline-none focus:ring-1 focus:ring-[#888888]/40 transition-colors resize-none"
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
    <div className={`px-4 py-3 rounded-[2px] border ${bg} ${border} transition-all duration-150 hover:shadow-md hover:scale-[1.01]`}>
      <div className="text-[10px] text-[#d4a017] uppercase font-semibold tracking-wider mb-1">{label}</div>
      <div className={`text-2xl font-bold font-mono tabular-nums ${color}`} style={{ textShadow: '0 0 4px currentColor' }}>{value}</div>
    </div>
  );
}
