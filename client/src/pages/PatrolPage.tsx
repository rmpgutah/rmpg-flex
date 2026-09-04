import React, { useState, useEffect, useCallback, useId, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import RichTextArea from '../components/RichTextArea';
import {
  QrCode,
  MapPin,
  Clock,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Plus,
  Loader2,
  RefreshCw,
  Pencil,
  Trash2,
  Eye,
  X,
  Archive,
  RotateCcw,
  Copy,
  Map as MapIcon,
  Wrench,
  DollarSign,
  FileText,
  ClipboardCheck,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useContextMenu, type ContextMenuItem } from '../context/ContextMenuContext';
import { useMenuActions } from '../utils/contextMenuActions';
import ConfirmDialog from '../components/ConfirmDialog';
import { usePersistedTab } from '../hooks/usePersistedState';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';
import RmpgLogo from '../components/RmpgLogo';
import PrintButton from '../components/PrintButton';
import ExportButton from '../components/ExportButton';
import SpillmanModuleGroup from '../components/spillman/SpillmanModuleGroup';
import type { ModuleGroupSpec } from '../components/spillman/SpillmanModuleGroup';
import { useIsMobile } from '../hooks/useIsMobile';
import { safeDateStr, safeTimeStr, parseTimestamp } from '../utils/dateUtils';
import { initMapbox, mapboxgl, MAPBOX_STYLE_DARK, injectMapboxStyles, registerMapInstance, unregisterMapInstance } from '../utils/mapboxLoader';
import { applyRmpgBasemap } from '../utils/mapboxBasemap';
import { installWebglContextRecovery } from '../utils/webglRecovery';
import { getMapboxAccessToken } from '../utils/mapboxApiKey';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';
import { useFormDraft } from '../hooks/useFormDraft';
import UnsavedChangesGuard from '../components/UnsavedChangesGuard';
import { toDisplayLabel } from '../utils/formatters';
import FloatingSaveBar from '../components/FloatingSaveBar';
import MileageAuditTab from './patrol/MileageAuditTab';
import PricingTab from './patrol/PricingTab';
import ContractsTab from './patrol/ContractsTab';
import BillingReviewTab from './patrol/BillingReviewTab';
import { escapeHtml } from '../utils/sanitize';
import { importWithRetry } from '../utils/importWithRetry';

// Add Mapbox type for TypeScript
declare global {
  interface Window {
    mapboxgl: typeof mapboxgl;
  }
}

type Checkpoint = {
  id: number;
  property_id: number;
  property_name: string;
  name: string;
  description: string | null;
  qr_code: string;
  latitude: number | null;
  longitude: number | null;
  scan_required_interval_minutes: number;
  is_active: number;
  archived_at: string | null;
  created_at: string;
};

type Scan = {
  id: number;
  checkpoint_id: number;
  checkpoint_name: string;
  property_name: string;
  officer_id: number;
  officer_name: string;
  scanned_at: string;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  status: 'on_time' | 'late' | 'missed';
};

type Compliance = {
  checkpoint_id: number;
  checkpoint_name: string;
  property_name: string;
  scans_today: number;
  last_scan_time: string | null;
  compliance_rate: number;
  next_scan_due: string | null;
  scan_interval_minutes: number;
};

type Property = {
  id: number;
  name: string;
};

// ── Patrol Map View ─────────────────────────────────────────
// Shows checkpoint markers + scan route polylines on Mapbox.

function PatrolMapView({ checkpoints, scans }: { checkpoints: Checkpoint[]; scans: Scan[] }) {
  const mapContainerRef = React.useRef<HTMLDivElement>(null);
  const mapInstanceRef = React.useRef<mapboxgl.Map | null>(null);
  const [mapReady, setMapReady] = React.useState(false);
  // WebGL context-loss recovery (rebuilds the map after a GPU context drop).
  const [recoverNonce, setRecoverNonce] = React.useState(0);
  const [isRecovering, setIsRecovering] = React.useState(false);
  const [needsManualReload, setNeedsManualReload] = React.useState(false);
  const recoveryCleanupRef = React.useRef<(() => void) | null>(null);

  React.useEffect(() => {
    if (!mapContainerRef.current) return;

    let cancelled = false;
    injectMapboxStyles();

    function initPatrolMap() {
      if (cancelled || !mapContainerRef.current || mapInstanceRef.current) return;

      const map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: MAPBOX_STYLE_DARK,
        center: [-111.89, 40.76],
        zoom: 12,
        projection: 'mercator',
        attributionControl: false,
      });
      mapInstanceRef.current = map;
      registerMapInstance(map);
      map.on('style.load', () => applyRmpgBasemap(map, { variant: 'dark' }));

      // Rebuild in place if the GPU drops the context. The marker/route effect
      // (keyed on mapReady) re-runs and re-fits bounds to the checkpoints.
      recoveryCleanupRef.current = installWebglContextRecovery(map, {
        label: 'PatrolMapView',
        onRebuild: () => {
          setIsRecovering(false);
          setNeedsManualReload(false);
          if (recoveryCleanupRef.current) { recoveryCleanupRef.current(); recoveryCleanupRef.current = null; }
          if (mapInstanceRef.current) { unregisterMapInstance(mapInstanceRef.current); try { mapInstanceRef.current.remove(); } catch { /* gone */ } mapInstanceRef.current = null; }
          setMapReady(false);
          setRecoverNonce((n) => n + 1);
        },
        onContextLost: () => setIsRecovering(true),
        onContextRestored: () => setIsRecovering(false),
        onGiveUp: () => { setIsRecovering(false); setNeedsManualReload(true); },
      });

      map.on('load', () => {
        if (cancelled) return;
        setMapReady(true);
      });
    }

    (async () => {
      try {
        const token = await getMapboxAccessToken();
        if (cancelled) return;
        initMapbox(token);
        if (cancelled) return;
        initPatrolMap();
      } catch {
        setMapReady(false);
      }
    })();

    return () => {
      cancelled = true;
      if (recoveryCleanupRef.current) { recoveryCleanupRef.current(); recoveryCleanupRef.current = null; }
      // unregisterMapInstance() only drops our bookkeeping entry — it does NOT
      // release the map. Mapbox holds a WebGL context, a canvas, and
      // window-level listeners until map.remove() is called, so leaving it out
      // meant every visit to Patrol leaked a live GL context that could never
      // be garbage collected. Browsers cap WebGL contexts (~16 in Chrome) and
      // silently kill the OLDEST when that ceiling is hit, so the damage shows
      // up as unrelated maps elsewhere in the app going blank.
      if (mapInstanceRef.current) {
        unregisterMapInstance(mapInstanceRef.current);
        try { mapInstanceRef.current.remove(); } catch { /* already gone */ }
        mapInstanceRef.current = null;
      }
      setMapReady(false);
    };
  }, [recoverNonce]);

  // Add markers + polylines when map is ready
  React.useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;

    const bounds = new mapboxgl.LngLatBounds();
    let hasPoints = false;
    const markers: mapboxgl.Marker[] = [];

    // Checkpoint markers
    checkpoints.forEach(cp => {
      if (!cp.latitude || !cp.longitude) return;
      const lngLat: [number, number] = [cp.longitude, cp.latitude];
      bounds.extend(lngLat);
      hasPoints = true;

      const el = document.createElement('div');
      el.style.cssText = `width:16px;height:16px;border-radius:50%;background:${cp.is_active ? 'var(--sev-ok)' : 'var(--text-muted)'};border:2px solid #fff;box-shadow:0 1px 4px rgba(0 0 0 / 0.4);`;
      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat(lngLat)
        .addTo(map);

      const popup = new mapboxgl.Popup({ offset: 15 })
        .setHTML(`<div style="color:#000;font-size:12px;font-weight:bold">${escapeHtml(cp.name)}</div>
          <div style="color:#666;font-size:10px">${cp.is_active ? 'Active' : 'Inactive'} • Every ${escapeHtml(cp.scan_required_interval_minutes) || '?'} min</div>`);
      marker.setPopup(popup);
      markers.push(marker);
    });

    // Scan route polylines (group by date, draw chronological lines)
    const scansByDate = new Map<string, Scan[]>();
    scans.forEach(s => {
      if (!s.latitude || !s.longitude) return;
      const date = s.scanned_at.split('T')[0];
      const list = scansByDate.get(date) || [];
      list.push(s);
      scansByDate.set(date, list);
    });

    // Officer trail palette — five distinct hues for distinguishing trails on
    // the map. These ARE deliberately hardcoded constants (trails always look
    // identical regardless of day/night) so they can't go through --sev-*.
    // Lifted from raw hex to read against the semantic palette anyway: muted
    // grey / special purple / warn amber / critical red / ok green.
    const colors = ['#888888', '#a855f7', '#f59e0b', '#ef4444', '#22c55e'];
    let colorIdx = 0;
    scansByDate.forEach((dayScans) => {
      const sorted = dayScans.sort((a, b) => parseTimestamp(a.scanned_at).getTime() - parseTimestamp(b.scanned_at).getTime());
      const coords: [number, number][] = [];
      sorted.forEach(s => {
        const lngLat: [number, number] = [s.longitude!, s.latitude!];
        bounds.extend(lngLat);
        hasPoints = true;
        coords.push(lngLat);
      });

      if (coords.length > 1) {
        const sourceId = `scan-line-${colorIdx}`;
        map.addSource(sourceId, {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
        });
        map.addLayer({
          id: sourceId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': colors[colorIdx % colors.length],
            'line-opacity': 0.7,
            'line-width': 2,
          },
        });
      }
      colorIdx++;
    });

    if (hasPoints) {
      map.fitBounds(bounds, { padding: 50 });
    }
  }, [mapReady, checkpoints, scans]);

  return (
    <div className="relative w-full flex-1" style={{ minHeight: 400 }}>
      <div ref={mapContainerRef} className="absolute inset-0" />
      <div className="absolute top-2 left-2 text-[9px] font-mono text-rmpg-400 bg-black/60 px-2 py-1 border border-rmpg-700">
        {checkpoints.filter(c => c.latitude != null && c.longitude != null).length} checkpoints •{' '}
        {scans.filter(s => s.latitude != null && s.longitude != null).length} scan points
      </div>
      {isRecovering && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-surface-base/80 pointer-events-none">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="w-5 h-5 text-brand-400 animate-spin" />
            <span className="text-rmpg-300 text-[10px] font-mono">MAP RECONNECTING…</span>
          </div>
        </div>
      )}
      {needsManualReload && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-surface-base/90">
          <div className="flex flex-col items-center gap-2 text-center px-4">
            <span className="text-rmpg-100 text-xs font-mono">MAP GPU CRASH</span>
            <button onClick={() => window.location.reload()} className="px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white text-[10px] font-mono" style={{ borderRadius: 2 }}>
              RELOAD PAGE
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const PatrolPage: React.FC = () => {
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const { user } = useAuth();
  const { openMenu } = useContextMenu();
  const m = useMenuActions();

  // Role gates — matches the admin|manager pattern used across Jail/DashCameras/etc.
  const canCreate = useMemo(() =>
    user?.role === 'admin' || user?.role === 'manager' || user?.role === 'supervisor' || user?.role === 'officer',
    [user?.role],
  );
  const canDelete = useMemo(() =>
    user?.role === 'admin' || user?.role === 'manager',
    [user?.role],
  );

  // Set document title
  useEffect(() => { document.title = 'Patrol Tracking — RMPG Flex'; }, []);
  const checkpointModalTitleId = useId();
  const qrModalTitleId = useId();
  const [activeTab, setActiveTab] = usePersistedTab('rmpg_patrol_tab', 'checkpoints', ['checkpoints', 'scans', 'compliance', 'map', 'summary', 'mileage', 'pricing', 'contracts', 'billing'] as const);

  // ── ?tab=<id> URL deep-link ──
  // Same contract Dashboard/Dispatch/Map/MDT/NCIC consume. Honors one-shot
  // tab selection on mount, strips the param so a refresh doesn't override
  // the operator's subsequent tab clicks. Validates against the persisted-
  // tab whitelist so a bad URL just lands on the saved default.
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingTabRef = useRef<string | null>(searchParams.get('tab'));
  useEffect(() => {
    const target = pendingTabRef.current;
    if (!target) return;
    pendingTabRef.current = null;
    const valid = ['checkpoints', 'scans', 'compliance', 'map', 'summary', 'mileage', 'pricing', 'contracts', 'billing'] as const;
    if ((valid as readonly string[]).includes(target)) {
      setActiveTab(target as typeof valid[number]);
    }
    const next = new URLSearchParams(searchParams);
    next.delete('tab');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [scans, setScans] = useState<Scan[]>([]);
  const [compliance, setCompliance] = useState<Compliance[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showCheckpointModal, setShowCheckpointModal] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [selectedQrCode, setSelectedQrCode] = useState('');
  // Rendered PNG for the checkpoint token. The modal used to show only the token
  // as text under "Scan this code with a QR scanner app", which is unscannable —
  // there was no QR image anywhere in the checkpoint flow.
  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const rowRefs = useRef<Map<number, HTMLTableRowElement | null>>(new Map());
  const deepLinkConsumedRef = useRef(false);
  const [editingCheckpoint, setEditingCheckpoint] = useState<Checkpoint | null>(null);
  const EMPTY_CHECKPOINT_FORM = {
    property_id: '',
    name: '',
    description: '',
    latitude: '',
    longitude: '',
    scan_required_interval_minutes: '',
    is_active: true
  };
  const {
    form: formData,
    setForm: setFormData,
    isDirty: formIsDirty,
    wasRestored: formWasRestored,
    clearDraft: clearFormDraft,
    snapshot: snapshotForm,
  } = useFormDraft<typeof EMPTY_CHECKPOINT_FORM>({
    storageKey: `rmpg_checkpoint_form_${editingCheckpoint?.id ?? 'new'}`,
    defaultValue: EMPTY_CHECKPOINT_FORM,
    isActive: showCheckpointModal,
  });

  // ── Feature 11/13/15: Shift summary, break tracking, efficiency ──
  const [shiftSummary, setShiftSummary] = useState<any>(null);
  const [isOnBreak, setIsOnBreak] = useState(false);
  // Start time of the CURRENT open break (when isOnBreak=true). Drives the
  // live elapsed counter so the operator sees "Break elapsed 14m" instead of
  // a binary "you're on break" state. Hydrated from server on mount along
  // with isOnBreak so a page refresh doesn't lose the timer.
  const [breakStartIso, setBreakStartIso] = useState<string | null>(null);
  // In-flight guard for the Break / Meal buttons — see startBreak().
  const [breakStarting, setBreakStarting] = useState(false);
  const [breakElapsedMs, setBreakElapsedMs] = useState(0);
  const [efficiency, setEfficiency] = useState<any>(null);

  // Hydrate isOnBreak + breakStartIso from server on mount + user change.
  // Previously `isOnBreak` only flipped on local Start/End clicks, so an
  // operator on break who reloaded the page saw the "Start Break" button
  // again and a fresh click would race the server into a 2nd break.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const fetchOpenBreak = async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const rows = await apiFetch<Array<{ break_start: string; break_end: string | null }>>(
          `/patrol/breaks?officer_id=${user.id}&date=${today}`,
        );
        if (cancelled) return;
        const open = (Array.isArray(rows) ? rows : []).find((r) => !r.break_end);
        if (open) {
          setIsOnBreak(true);
          setBreakStartIso(open.break_start);
        } else {
          setIsOnBreak(false);
          setBreakStartIso(null);
        }
      } catch { /* silent — toolbar just shows Start buttons */ }
    };
    fetchOpenBreak();
    return () => { cancelled = true; };
  }, [user?.id]);

  // Live elapsed counter — 30s tick is plenty (officer is reading minutes,
  // not seconds). Pauses cleanly when isOnBreak flips back to false.
  useEffect(() => {
    if (!isOnBreak || !breakStartIso) { setBreakElapsedMs(0); return; }
    const tick = () => setBreakElapsedMs(Date.now() - parseTimestamp(breakStartIso).getTime());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [isOnBreak, breakStartIso]);

  const loadShiftSummary = async () => {
    if (!user?.id) return; // handler requires officer_id, else 400
    try {
      const data = await apiFetch<any>(`/patrol/shift-summary?officer_id=${user.id}`);
      setShiftSummary(data);
    } catch { /* ignore */ }
  };

  const loadEfficiency = async () => {
    try {
      const data = await apiFetch<any>('/patrol/efficiency');
      setEfficiency(data);
    } catch { /* ignore */ }
  };

  const startBreak = async (breakType = 'break') => {
    // Guard against a double-click firing two POSTs before the first returns.
    // The server is also idempotent now (it returns any already-open break
    // rather than inserting a second one), which is the authoritative fix —
    // this only stops the duplicate request leaving the device at all.
    if (breakStarting) return;
    setBreakStarting(true);
    try {
      const data = await apiFetch<{ break_start?: string }>(
        '/patrol/breaks/start',
        { method: 'POST', body: JSON.stringify({ break_type: breakType }) },
      );
      setIsOnBreak(true);
      // Server returns the canonical break_start when available; fall back
      // to "now" so the elapsed counter starts ticking immediately.
      setBreakStartIso(data?.break_start ?? new Date().toISOString());
      addToast('Break started', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to start break', 'error');
    } finally {
      // finally, not a trailing call: a thrown request must still re-enable
      // the button, or it would be dead until the operator reloaded.
      setBreakStarting(false);
    }
  };

  const endBreak = async () => {
    try {
      const data = await apiFetch<any>('/patrol/breaks/end', { method: 'POST' });
      setIsOnBreak(false);
      setBreakStartIso(null);
      addToast(`Break ended (${data?.duration_minutes || 0} min)`, 'success');
    } catch (err: any) { addToast(err?.message || 'Failed to end break', 'error'); }
  };

  // Scan filters
  const [scanFilters, setScanFilters] = useState({
    checkpointId: '',
    officerId: '',
    startDate: '',
    endDate: ''
  });

  useEffect(() => {
    loadProperties();
  }, []);

  useEffect(() => {
    if (activeTab === 'compliance') {
      loadCompliance();
      const interval = setInterval(() => {
        loadCompliance();
      }, 60000);
      return () => clearInterval(interval);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const loadProperties = async () => {
    try {
      const data = await apiFetch<Property[]>('/records/properties');
      setProperties(data || []);
    } catch (error) {
      console.error('Error loading properties:', error);
      addToast(error instanceof Error ? error.message : 'Failed to load properties', 'error');
    }
  };

  const loadData = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) { setLoading(true); setError(null); }
    try {
      if (activeTab === 'checkpoints') {
        await loadCheckpoints();
      } else if (activeTab === 'scans') {
        await loadScans();
      } else if (activeTab === 'compliance') {
        await loadCompliance();
      } else if (activeTab === 'map') {
        // Map needs both checkpoints + scans to render markers/routes;
        // without this it inherits whatever the previously-active tab left
        // in state (often empty on a fresh landing).
        await Promise.all([loadCheckpoints(), loadScans()]);
      } else if (activeTab === 'summary') {
        // Shift Summary tab previously required a manual "Load Summary" click
        // before any data appeared.
        await Promise.all([loadShiftSummary(), loadEfficiency()]);
      }
    } catch (err: any) {
      if (!options?.silent) {
        console.error('Error loading data:', err);
        setError(err?.message || 'Failed to load data');
      }
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [activeTab]);

  const loadCheckpoints = async () => {
    try {
      const data = await apiFetch<Checkpoint[]>('/patrol/checkpoints');
      setCheckpoints(data || []);
    } catch {
      setCheckpoints([]);
    }
  };

  const loadScans = async () => {
    try {
      const params = new URLSearchParams();
      // Handler reads snake_case (checkpoint_id/officer_id/from/to), not camelCase.
      if (scanFilters.checkpointId) params.append('checkpoint_id', scanFilters.checkpointId);
      if (scanFilters.officerId) params.append('officer_id', scanFilters.officerId);
      if (scanFilters.startDate) params.append('from', scanFilters.startDate);
      if (scanFilters.endDate) params.append('to', scanFilters.endDate);

      const data = await apiFetch<Scan[]>(`/patrol/scans?${params.toString()}`);
      setScans(data || []);
    } catch {
      setScans([]);
    }
  };

  const loadCompliance = async () => {
    try {
      // Handler returns { days, checkpoints: [...] }, not a bare array.
      const data = await apiFetch<{ days: number; checkpoints: Compliance[] }>('/patrol/compliance');
      setCompliance(data?.checkpoints || []);
    } catch {
      setCompliance([]);
    }
  };

  useEffect(() => {
    if (activeTab === 'scans') {
      loadScans();
    }
  }, [scanFilters]);

  useEffect(() => {
    loadData();
  }, [activeTab]);

  // Live sync — auto-refresh when any device modifies patrol data (silent to avoid unmounting UI)
  const silentRefreshPatrol = useCallback(() => loadData({ silent: true }), [loadData]);
  useLiveSync('patrol', silentRefreshPatrol);

  // ── ?checkpoint_id=<n> deep-link ──
  // On first load after checkpoints are available, scroll the matching row
  // into view, flash-highlight it, and strip the param (replace:true) so a
  // refresh doesn't re-trigger. Missing target toasts a warning.
  useEffect(() => {
    if (loading || deepLinkConsumedRef.current) return;
    const cpIdParam = searchParams.get('checkpoint_id');
    if (!cpIdParam) return;
    deepLinkConsumedRef.current = true;
    const id = parseInt(cpIdParam, 10);
    const target = checkpoints.find((c) => c.id === id);
    if (target) {
      setActiveTab('checkpoints');
      setHighlightId(id);
    } else {
      addToast(`Checkpoint #${cpIdParam} not found.`, 'warning');
    }
    const next = new URLSearchParams(searchParams);
    next.delete('checkpoint_id');
    setSearchParams(next, { replace: true });
  }, [loading, checkpoints, searchParams, setSearchParams, addToast, setActiveTab]);

  // Flash-highlight row — 3 s window, same as Jail/Equipment pattern.
  useEffect(() => {
    if (highlightId === null) return;
    const row = rowRefs.current.get(highlightId);
    row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t = setTimeout(() => setHighlightId(null), 3000);
    return () => clearTimeout(t);
  }, [highlightId]);

  const handleCreateCheckpoint = () => {
    setEditingCheckpoint(null);
    setFormData({
      property_id: '',
      name: '',
      description: '',
      latitude: '',
      longitude: '',
      scan_required_interval_minutes: '',
      is_active: true
    });
    setShowCheckpointModal(true);
    snapshotForm();
  };

  const handleEditCheckpoint = (checkpoint: Checkpoint) => {
    setEditingCheckpoint(checkpoint);
    setFormData({
      property_id: checkpoint.property_id.toString(),
      name: checkpoint.name,
      description: checkpoint.description || '',
      latitude: checkpoint.latitude?.toString() || '',
      longitude: checkpoint.longitude?.toString() || '',
      scan_required_interval_minutes: checkpoint.scan_required_interval_minutes.toString(),
      is_active: checkpoint.is_active === 1
    });
    setShowCheckpointModal(true);
    snapshotForm();
  };

  const handleSaveCheckpoint = async () => {
    try {
      const payload = {
        property_id: parseInt(formData.property_id, 10),
        name: formData.name,
        description: formData.description || null,
        latitude: formData.latitude ? parseFloat(formData.latitude) : null,
        longitude: formData.longitude ? parseFloat(formData.longitude) : null,
        scan_required_interval_minutes: parseInt(formData.scan_required_interval_minutes, 10),
        is_active: formData.is_active
      };

      if (editingCheckpoint) {
        await apiFetch(`/patrol/checkpoints/${editingCheckpoint.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
      } else {
        await apiFetch('/patrol/checkpoints', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }

      setShowCheckpointModal(false);
      clearFormDraft();
      loadCheckpoints();
      addToast(editingCheckpoint ? 'Checkpoint updated' : 'Checkpoint created', 'success');
    } catch (err: any) {
      console.error('Error saving checkpoint:', err);
      addToast(err?.message || 'Failed to save checkpoint', 'error');
    }
  };

  const handleDeleteCheckpoint = async (id: number) => {
    try {
      await apiFetch(`/patrol/checkpoints/${id}`, {
        method: 'DELETE'
      });
      setDeleteConfirmId(null);
      loadCheckpoints();
      addToast('Checkpoint deleted', 'success');
    } catch (err: any) {
      console.error('Error deleting checkpoint:', err);
      addToast(err?.message || 'Failed to delete checkpoint', 'error');
    }
  };

  const handleArchiveCheckpoint = async (id: number) => {
    try {
      await apiFetch(`/patrol/checkpoints/${id}/archive`, { method: 'POST' });
      loadCheckpoints();
      addToast('Checkpoint archived', 'success');
    } catch (err: any) {
      console.error('Error archiving checkpoint:', err);
      addToast(err?.message || 'Failed to archive checkpoint', 'error');
    }
  };

  const handleUnarchiveCheckpoint = async (id: number) => {
    try {
      await apiFetch(`/patrol/checkpoints/${id}/unarchive`, { method: 'POST' });
      loadCheckpoints();
      addToast('Checkpoint restored', 'success');
    } catch (err: any) {
      console.error('Error unarchiving checkpoint:', err);
      addToast(err?.message || 'Failed to restore checkpoint', 'error');
    }
  };

  const handleShowQr = (qrCode: string) => {
    setSelectedQrCode(qrCode);
    setShowQrModal(true);
  };

  // Encode the checkpoint token into a real, scannable symbol whenever the modal
  // opens. It encodes the RAW token (e.g. "CP-A1B2C3D4E5F6") — the same string
  // the modal prints and "Copy QR code" copies — because the token is matched
  // against patrol_checkpoints.qr_code on scan; there is no deep-link route that
  // would consume a URL form, so inventing one here would encode a dead link.
  //
  // Dynamic import keeps the encoder out of this already-large page's initial
  // chunk, matching how MyIdPage loads it. Standard dark-on-light polarity: this
  // is printed and posted at a physical checkpoint, then read by whatever scanner
  // an officer has, so it must be spec-compliant rather than theme-tinted.
  useEffect(() => {
    if (!showQrModal || !selectedQrCode) { setQrImageUrl(null); return; }
    let alive = true;
    (async () => {
      try {
        const QRCode = (await importWithRetry(() => import('qrcode'))).default;
        const url = await QRCode.toDataURL(selectedQrCode, {
          errorCorrectionLevel: 'H', // printed signage tolerates smudging/wear
          margin: 4,                 // ISO/IEC 18004 quiet zone
          width: 512,
          color: { dark: '#0a0a0a', light: '#ffffff' },
        });
        if (alive) setQrImageUrl(url);
      } catch {
        if (alive) setQrImageUrl(null); // token text below stays usable
      }
    })();
    return () => { alive = false; };
  }, [showQrModal, selectedQrCode]);

  // ── Build a checkpoint row context menu ──
  const buildCheckpointMenu = (cp: Checkpoint): ContextMenuItem[] => [
    m.action('Show QR code', () => handleShowQr(cp.qr_code), { icon: <Eye size={12} /> }),
    ...(cp.archived_at
      ? [m.action('Unarchive', () => handleUnarchiveCheckpoint(cp.id), { icon: <RotateCcw size={12} /> })]
      : [m.action('Edit checkpoint', () => handleEditCheckpoint(cp), { icon: <Pencil size={12} /> })]),
    m.separator(),
    m.copy('Copy name', cp.name),
    m.copy('Copy QR code', cp.qr_code),
    m.copyId(cp.id),
    ...(cp.archived_at ? [] : [
      m.separator(),
      m.action('Archive', () => handleArchiveCheckpoint(cp.id), { icon: <Archive size={12} /> }),
      ...(canDelete ? [m.action('Delete', () => setDeleteConfirmId(cp.id), { icon: <Trash2 size={12} />, danger: true })] : []),
    ]),
  ];

  // ── Build a scan-log row context menu ──
  // Read-only log row, but several useful jumps: hop to the checkpoint on the
  // Map tab (filtered), open the checkpoint editor, copy coords. The Map tab
  // auto-loads on entry now, so `?focus=<id>` will land with markers present.
  const buildScanMenu = (scan: Scan): ContextMenuItem[] => [
    m.copy('Copy checkpoint', scan.checkpoint_name),
    m.copy('Copy officer', scan.officer_name),
    m.copy('Copy property', scan.property_name),
    m.copyCoords(scan.latitude ?? undefined, scan.longitude ?? undefined),
    m.copyId(scan.id),
    m.separator(),
    m.action('View on Map', () => setActiveTab('map'), { icon: <MapIcon size={12} /> }),
    m.action('Edit checkpoint', () => {
      const cp = checkpoints.find((c) => c.id === scan.checkpoint_id);
      if (cp) handleEditCheckpoint(cp);
    }, { icon: <Pencil size={12} />, disabled: !checkpoints.some((c) => c.id === scan.checkpoint_id) }),
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'on_time':
        return 'text-green-400';
      case 'late':
        return 'text-amber-400';
      case 'missed':
        return 'text-red-400';
      default:
        return 'text-rmpg-300';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'on_time':
        return <CheckCircle className="w-4 h-4" />;
      case 'late':
        return <AlertTriangle className="w-4 h-4" />;
      case 'missed':
        return <XCircle className="w-4 h-4" />;
      default:
        return null;
    }
  };

  const getComplianceColor = (rate: number) => {
    if (rate >= 90) return 'text-green-400 border-green-400';
    if (rate >= 70) return 'text-amber-400 border-amber-400';
    return 'text-red-400 border-red-400';
  };

  const formatDateTime = (dateString: string) => {
    return parseTimestamp(dateString).toLocaleString('en-US', {
      timeZone: 'America/Denver', month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
  };

  const formatTimeAgo = (dateString: string | null) => {
    if (!dateString) return 'Never';
    const date = parseTimestamp(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `${diffDays}d ago`;
    if (diffHours > 0) return `${diffHours}h ago`;
    if (diffMins > 0) return `${diffMins}m ago`;
    return 'Just now';
  };

  const isOverdue = (nextDue: string | null) => {
    if (!nextDue) return false;
    return parseTimestamp(nextDue) < new Date();
  };

  // ── Feature 1: Route Optimization ──
  const [optimizedRoute, setOptimizedRoute] = useState<any>(null);
  const [optimizing, setOptimizing] = useState(false);
  const handleOptimizeRoute = async (propertyId?: string) => {
    setOptimizing(true);
    try {
      const params = new URLSearchParams();
      if (propertyId) params.set('property_id', propertyId);
      const data = await apiFetch<any>(`/patrol/optimize-route?${params}`);
      setOptimizedRoute(data);
      addToast(`Route optimized: ${data.optimized_order?.length || 0} checkpoints, ${data.total_distance_km} km`, 'success');
    } catch (err: any) { addToast(err?.message || 'Failed to optimize route', 'error'); }
    setOptimizing(false);
  };

  // ── Feature 2: Auto-generate Patrol Log ──
  const [patrolLog, setPatrolLog] = useState<any>(null);
  const handleGenerateLog = async (date?: string) => {
    try {
      const params = new URLSearchParams();
      if (date) params.set('date', date);
      const data = await apiFetch<any>(`/patrol/log/generate?${params}`);
      setPatrolLog(data);
      addToast('Patrol log generated', 'success');
    } catch (err: any) { addToast(err?.message || 'Failed to generate log', 'error'); }
  };

  // ── Feature 6: Exception Report ──
  const [exceptions, setExceptions] = useState<any>(null);
  const handleLoadExceptions = async () => {
    try {
      const data = await apiFetch<any>('/patrol/exceptions?days=7');
      setExceptions(data);
    } catch (err: any) { addToast(err?.message || 'Failed to load exceptions', 'error'); }
  };

  // ── Feature 7: Time Tracking ──
  const [timeTracking, setTimeTracking] = useState<any>(null);
  const handleLoadTimeTracking = async (date?: string) => {
    try {
      const params = new URLSearchParams();
      if (date) params.set('date', date);
      const data = await apiFetch<any>(`/patrol/time-tracking?${params}`);
      setTimeTracking(data);
    } catch (err: any) { addToast(err?.message || 'Failed to load time tracking', 'error'); }
  };

  const patrolTabs = [
    { id: 'checkpoints' as const, label: 'Checkpoints', icon: QrCode },
    { id: 'scans' as const, label: 'Scan Log', icon: Clock },
    { id: 'compliance' as const, label: 'Compliance', icon: CheckCircle },
    { id: 'map' as const, label: 'Map', icon: MapIcon },
    { id: 'summary' as const, label: 'Shift Summary', icon: CheckCircle },
    { id: 'mileage' as const, label: 'Mileage Audit', icon: Wrench },
    { id: 'pricing' as const, label: 'Pricing', icon: DollarSign },
    { id: 'contracts' as const, label: 'Contracts', icon: FileText },
    { id: 'billing' as const, label: 'Billing Review', icon: ClipboardCheck },
  ];

  // ── Esc smart-cascade: dismiss innermost open layer first ──
  // Priority: QR modal > Checkpoint modal, then stop. ConfirmDialog handles
  // its own Esc internally, so we don't need to mirror deleteConfirmId here.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showQrModal) { setShowQrModal(false); return; }
      if (showCheckpointModal) {
        clearFormDraft();
        setShowCheckpointModal(false);
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showQrModal, showCheckpointModal, clearFormDraft]);

  // ── N shortcut: open new Checkpoint form ──
  // Only active on the Checkpoints tab; suppressed while typing in a field
  // or when any modal is already open.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'n' && e.key !== 'N') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (t.isContentEditable) return;
      }
      if (activeTab !== 'checkpoints') return;
      if (showCheckpointModal || showQrModal || deleteConfirmId !== null) return;
      e.preventDefault();
      handleCreateCheckpoint();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, showCheckpointModal, showQrModal, deleteConfirmId]);

  // ── Esc smart-cascade: dismiss innermost open layer first ──
  // Priority: QR modal > Checkpoint modal, then stop. ConfirmDialog handles
  // its own Esc internally, so we don't need to mirror deleteConfirmId here.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showQrModal) { setShowQrModal(false); return; }
      if (showCheckpointModal) {
        clearFormDraft();
        setShowCheckpointModal(false);
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showQrModal, showCheckpointModal, clearFormDraft]);

  // ── N shortcut: open new Checkpoint form ──
  // Only active on the Checkpoints tab; suppressed while typing in a field
  // or when any modal is already open.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'n' && e.key !== 'N') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (t.isContentEditable) return;
      }
      if (activeTab !== 'checkpoints') return;
      if (showCheckpointModal || showQrModal || deleteConfirmId !== null) return;
      e.preventDefault();
      handleCreateCheckpoint();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, showCheckpointModal, showQrModal, deleteConfirmId]);

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Portal Header */}
      {isMobile ? (
        <div className="flex items-center gap-2 px-3 py-2 bg-surface-base border-b border-border-default">
          <RmpgLogo height={24} />
          <span className="text-[10px] font-bold uppercase tracking-wider text-rmpg-400">Patrol Operations</span>
        </div>
      ) : (
        <div className="panel-beveled bg-surface-base overflow-hidden">
          <div className="flex items-center gap-4 px-4 py-2.5 relative">
            <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, var(--surface-sunken), var(--spm-text-muted) 30%, var(--spm-text-muted) 70%, var(--surface-sunken))' }} />
            <RmpgLogo height={64} />
            <div className="flex-1">
              <h1 className="text-sm font-bold tracking-wider uppercase text-rmpg-200">Patrol Operations</h1>
              <p className="text-[9px] tracking-wide text-rmpg-600">Rocky Mountain Protective Group, LLC</p>
            </div>
          </div>
        </div>
      )}

      {isMobile ? (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-base border-b border-border-default">
          <span className="text-[9px] font-bold uppercase tracking-wider text-brand-400">PATROL MANAGEMENT</span>
          <div className="flex gap-1 ml-auto">
            {activeTab === 'checkpoints' && canCreate && (
              <button type="button" onClick={handleCreateCheckpoint} className="btn-gold btn-xs" aria-label="Create checkpoint"><Plus className="w-3 h-3" /></button>
            )}
            <button type="button" onClick={loadCompliance} className="btn-secondary btn-xs" aria-label="Refresh compliance"><RefreshCw className="w-3 h-3" /></button>
          </div>
        </div>
      ) : (
      <PanelTitleBar title="PATROL MANAGEMENT" icon={MapPin}>
        <PrintButton />
        {activeTab === 'scans' && (
          <ExportButton exportUrl="/patrol/scans/export?format=csv" exportFilename="patrol_scans_export.csv" />
        )}
        {activeTab === 'checkpoints' && canCreate && (
          <button type="button" onClick={handleCreateCheckpoint} className="toolbar-btn toolbar-btn-primary print:hidden">
            <Plus className="w-3.5 h-3.5" /> Add Checkpoint
          </button>
        )}
        {activeTab === 'compliance' && (
          <button type="button" onClick={loadCompliance} className="toolbar-btn">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        )}
      </PanelTitleBar>)}

      {/* Tabs — sticky so the section nav stays visible while tab content
          (esp. the Mileage Audit chain, which can run to hundreds of rows)
          scrolls underneath. Without this the user loses the way out of
          MILEAGE AUDIT as soon as they scroll down the chain. */}
      {/* Tab Navigation (grouped Spillman module strip) */}
      <div className="sticky top-0 z-30">
        <SpillmanModuleGroup
          groups={[
            {
              label: 'Field Ops',
              tone: 'steel',
              tabs: [
                { id: 'checkpoints', label: 'Checkpoints' },
                { id: 'scans',       label: 'Scan Log' },
                { id: 'compliance',  label: 'Compliance' },
                { id: 'map',         label: 'Map' },
              ],
            },
            {
              label: 'Reporting',
              tone: 'gold',
              tabs: [
                { id: 'summary',  label: 'Shift Summary' },
                { id: 'mileage',  label: 'Mileage Audit' },
              ],
            },
            {
              label: 'Finance',
              tone: 'neutral',
              tabs: [
                { id: 'pricing',   label: 'Pricing' },
                { id: 'contracts', label: 'Contracts' },
                { id: 'billing',   label: 'Billing Review' },
              ],
            },
          ] as ModuleGroupSpec[]}
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id as 'checkpoints' | 'scans' | 'compliance' | 'map' | 'summary' | 'mileage' | 'pricing' | 'contracts' | 'billing')}
        />
      </div>

      {/* Error Banner */}
      {error && (
        <div className="px-3 py-1.5 bg-red-900/30 border-b border-red-700/50 flex items-center gap-2 text-xs text-red-300 flex-shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <IconButton onClick={() => setError(null)} className="text-red-400 hover:text-red-200" aria-label="Dismiss error">
            <X className="w-3.5 h-3.5" />
          </IconButton>
        </div>
      )}

      {/* Stats Strip */}
      {!loading && (
        <div className={`px-4 py-1.5 border-b border-rmpg-700/50 flex items-center gap-4 text-[9px] font-mono flex-shrink-0 bg-surface-sunken ${isMobile ? 'flex-wrap gap-2' : ''}`}>
          <div className="flex items-center gap-1">
            <QrCode className="w-3 h-3 text-brand-400" />
            <span className="text-rmpg-400">Checkpoints:</span>
            <span className="text-brand-400 font-bold">{checkpoints.length}</span>
          </div>
          <div className="flex items-center gap-1">
            <CheckCircle className="w-3 h-3 text-green-400" />
            <span className="text-rmpg-400">Active:</span>
            <span className="text-green-400 font-bold">{checkpoints.filter(c => c.is_active).length}</span>
          </div>
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3 text-rmpg-400" />
            <span className="text-rmpg-400">Scans Today:</span>
            <span className="text-rmpg-400 font-bold">
              {scans.filter(s => {
                const today = new Date().toDateString();
                return parseTimestamp(s.scanned_at).toDateString() === today;
              }).length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <MapPin className="w-3 h-3 text-purple-400" />
            <span className="text-rmpg-400">Total Scans:</span>
            <span className="text-purple-400 font-bold">{scans.length}</span>
          </div>
          {/* Feature 1: Route Optimization */}
          <button type="button" onClick={() => handleOptimizeRoute()} disabled={optimizing} className="toolbar-btn ml-auto" title="Optimize patrol route">
            {optimizing ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <MapIcon className="w-3 h-3" />}
            <span className="text-[9px]">Optimize Route</span>
          </button>
          {/* Feature 2: Generate Patrol Log */}
          <button type="button" onClick={() => handleGenerateLog()} className="toolbar-btn" title="Generate patrol log">
            <Clock className="w-3 h-3" /><span className="text-[9px]">Gen Log</span>
          </button>
          {/* Feature 6: Exception Report */}
          <button type="button" onClick={handleLoadExceptions} className="toolbar-btn" title="Exception report">
            <AlertTriangle className="w-3 h-3" /><span className="text-[9px]">Exceptions</span>
          </button>
          {/* Feature 7: Time Tracking */}
          <button type="button" onClick={() => handleLoadTimeTracking()} className="toolbar-btn" title="Time tracking">
            <Clock className="w-3 h-3" /><span className="text-[9px]">Time Track</span>
          </button>
        </div>
      )}

      {/* Feature 1: Route Optimization Results */}
      {optimizedRoute && (
        <div className="mx-3 mt-2 panel-beveled bg-surface-raised p-2 text-xs text-rmpg-200">
          <div className="flex items-center justify-between mb-1">
            <span className="font-bold text-brand-gold-500 uppercase tracking-wide text-[10px]">Optimized Route — {optimizedRoute.optimized_order?.length || 0} checkpoints, {optimizedRoute.total_distance_km} km total</span>
            <IconButton onClick={() => setOptimizedRoute(null)} className="text-rmpg-500 hover:text-rmpg-300" aria-label="Close optimized route"><X className="w-3 h-3" /></IconButton>
          </div>
          <div className="space-y-0.5 text-[10px] max-h-32 overflow-y-auto">
            {optimizedRoute.optimized_order?.map((cp: any, i: number) => (
              <div key={cp.id} className="flex gap-2">
                <span className="text-rmpg-500 w-4">{i + 1}.</span>
                <span className="text-rmpg-100">{cp.name}</span>
                <span className="text-rmpg-500 ml-auto">{cp.distance_from_previous_km} km</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feature 2: Patrol Log Panel */}
      {patrolLog && (
        <div className="mx-3 mt-2 panel-beveled bg-surface-raised p-2 text-xs text-rmpg-200">
          <div className="flex items-center justify-between mb-1">
            <span className="font-bold text-brand-gold-500 uppercase tracking-wide text-[10px]">Patrol Log — {patrolLog.officer_name} ({patrolLog.date})</span>
            <IconButton onClick={() => setPatrolLog(null)} className="text-rmpg-500 hover:text-rmpg-300" aria-label="Close patrol log"><X className="w-3 h-3" /></IconButton>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] mb-2">
            <div><span className="text-rmpg-400">Checkpoints:</span> <span className="text-rmpg-100">{patrolLog.total_checkpoints_scanned}</span></div>
            <div><span className="text-rmpg-400">Total Time:</span> <span className="text-rmpg-100">{patrolLog.total_time_minutes} min</span></div>
            <div><span className="text-rmpg-400">On Time:</span> <span className="text-green-400">{patrolLog.on_time}</span></div>
            <div><span className="text-rmpg-400">Late:</span> <span className="text-amber-400">{patrolLog.late}</span></div>
          </div>
          <div className="space-y-0.5 text-[10px] max-h-32 overflow-y-auto">
            {patrolLog.entries?.map((e: any, i: number) => (
              <div key={i} className="flex gap-2">
                <span className="text-rmpg-500 w-24">{safeTimeStr(e.time)}</span>
                <span className="text-rmpg-100 flex-1">{e.checkpoint}</span>
                <span className={e.status === 'on_time' ? 'text-green-400' : 'text-amber-400'}>{e.status === 'on_time' ? 'On Time' : toDisplayLabel(e.status)}</span>
                {e.time_since_prev_min != null && <span className="text-rmpg-500">{e.time_since_prev_min}m</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feature 6: Exception Report Panel */}
      {exceptions && (
        <div className="mx-3 mt-2 panel-beveled bg-surface-raised p-2 text-xs text-rmpg-200">
          <div className="flex items-center justify-between mb-1">
            <span className="font-bold text-brand-gold-500 uppercase tracking-wide text-[10px]">Exception Report — {exceptions.period_days} days ({exceptions.late_count} late / {exceptions.total_scans} total = {exceptions.late_rate}% late)</span>
            <IconButton onClick={() => setExceptions(null)} className="text-rmpg-500 hover:text-rmpg-300" aria-label="Close exceptions"><X className="w-3 h-3" /></IconButton>
          </div>
          {exceptions.missed_checkpoints?.length > 0 && (
            <div className="mb-1">
              <div className="text-[9px] text-red-400 font-bold uppercase">Missed Checkpoints ({exceptions.missed_checkpoints.length})</div>
              {exceptions.missed_checkpoints.slice(0, 5).map((mc: any) => (
                <div key={mc.id} className="text-[10px] flex gap-2">
                  <span className="text-red-300">{mc.name}</span>
                  <span className="text-rmpg-500">{mc.property_name}</span>
                  <span className="text-rmpg-500 ml-auto">Last: {mc.last_scan ? formatTimeAgo(mc.last_scan) : 'Never'}</span>
                </div>
              ))}
            </div>
          )}
          <div className="text-[9px] text-amber-400 font-bold uppercase">Late Scans ({exceptions.late_scans?.length || 0})</div>
          <div className="max-h-24 overflow-y-auto space-y-0.5">
            {exceptions.late_scans?.slice(0, 10).map((ls: any) => (
              <div key={ls.id} className="text-[10px] flex gap-2">
                <span className="text-rmpg-500">{safeDateStr(ls.scanned_at)}</span>
                <span className="text-amber-300">{ls.checkpoint_name}</span>
                <span className="text-rmpg-500">{ls.officer_name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feature 7: Time Tracking Panel */}
      {timeTracking && (
        <div className="mx-3 mt-2 panel-beveled bg-surface-raised p-2 text-xs text-rmpg-200">
          <div className="flex items-center justify-between mb-1">
            <span className="font-bold text-brand-gold-500 uppercase tracking-wide text-[10px]">Time Tracking — {timeTracking.date}</span>
            <IconButton onClick={() => setTimeTracking(null)} className="text-rmpg-500 hover:text-rmpg-300" aria-label="Close time tracking"><X className="w-3 h-3" /></IconButton>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] mb-2">
            <div><span className="text-rmpg-400">Total Patrol:</span> <span className="text-rmpg-100">{timeTracking.total_patrol_minutes} min</span></div>
            <div><span className="text-rmpg-400">Checkpoints:</span> <span className="text-rmpg-100">{timeTracking.total_checkpoints}</span></div>
            <div><span className="text-rmpg-400">Avg Between:</span> <span className="text-rmpg-100">{timeTracking.average_between_minutes} min</span></div>
            <div><span className="text-rmpg-400">Longest Gap:</span> <span className="text-amber-400">{timeTracking.longest_gap_minutes} min</span></div>
          </div>
          <div className="max-h-24 overflow-y-auto space-y-0.5">
            {timeTracking.segments?.map((s: any, i: number) => (
              <div key={i} className="text-[10px] flex gap-2">
                <span className="text-rmpg-500">{s.from}</span>
                <span className="text-purple-500">→</span>
                <span className="text-rmpg-100">{s.to}</span>
                <span className="text-purple-400 ml-auto">{s.duration_minutes} min</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center items-center h-64 panel-inset">
          <Loader2 className="w-8 h-8 animate-spin text-brand-400" role="status" aria-label="Loading" />
        </div>
      ) : (
        <>
          {/* Checkpoints Tab */}
          {activeTab === 'checkpoints' && (
            <div className="panel-beveled overflow-hidden bg-[var(--surface-base)]">
              {isMobile ? (
                // Mobile card layout: a 6-column table is unusable on a phone
                // even with overflow-x-auto (constant horizontal scrolling).
                // Cards put each checkpoint's key info + a tap-revealed action
                // row on a single touch-sized surface (44pt minimum per row).
                <div className="space-y-2 p-2">
                  {checkpoints.map((checkpoint) => (
                    <div
                      key={checkpoint.id}
                      onContextMenu={(e) => openMenu(e, buildCheckpointMenu(checkpoint))}
                      className="panel-beveled bg-surface-raised p-3"
                    >
                      <div className="flex items-start gap-2 mb-2">
                        <span className={`led-dot mt-1 ${checkpoint.is_active ? 'led-green' : 'led-off'}`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-rmpg-100 truncate">{checkpoint.name}</div>
                          <div className="text-[10px] text-rmpg-400 truncate">{checkpoint.property_name}</div>
                        </div>
                        <span className={`text-[9px] font-bold uppercase ${checkpoint.is_active ? 'text-green-400' : 'text-rmpg-500'}`}>
                          {checkpoint.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      {checkpoint.description && (
                        <div className="text-[11px] text-rmpg-200 mb-2 line-clamp-2">{checkpoint.description}</div>
                      )}
                      <div className="flex items-center justify-between pt-2 border-t border-rmpg-700/50">
                        <span className="text-[10px] text-rmpg-400 font-mono">
                          {checkpoint.scan_required_interval_minutes} min interval
                        </span>
                        <div className="flex gap-1">
                          <IconButton
                            onClick={() => handleShowQr(checkpoint.qr_code)}
                            className="text-brand-400 p-2"
                            title="Show QR Code"
                            aria-label={`Show QR code for ${checkpoint.name}`}
                          >
                            <Eye className="w-4 h-4" />
                          </IconButton>
                          {!checkpoint.archived_at ? (
                            <>
                              <IconButton
                                onClick={() => handleEditCheckpoint(checkpoint)}
                                className="text-amber-400 p-2"
                                title="Edit"
                                aria-label={`Edit ${checkpoint.name}`}
                              >
                                <Pencil className="w-4 h-4" />
                              </IconButton>
                              <IconButton
                                onClick={() => handleArchiveCheckpoint(checkpoint.id)}
                                className="text-rmpg-400 p-2"
                                title="Archive"
                                aria-label={`Archive ${checkpoint.name}`}
                              >
                                <Archive className="w-4 h-4" />
                              </IconButton>
                              {canDelete && (
                                <IconButton
                                  onClick={() => setDeleteConfirmId(checkpoint.id)}
                                  className="text-red-400 p-2"
                                  title="Delete"
                                  aria-label={`Delete ${checkpoint.name}`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </IconButton>
                              )}
                            </>
                          ) : (
                            <IconButton
                              onClick={() => handleUnarchiveCheckpoint(checkpoint.id)}
                              className="text-green-400 p-2"
                              title="Unarchive"
                              aria-label={`Unarchive ${checkpoint.name}`}
                            >
                              <RotateCcw className="w-4 h-4" />
                            </IconButton>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
              <div>
              <table className="table-dark">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Property</th>
                    <th>Description</th>
                    <th>Interval</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {checkpoints.map((checkpoint) => (
                    <tr
                      key={checkpoint.id}
                      ref={(el) => { rowRefs.current.set(checkpoint.id, el); }}
                      onContextMenu={(e) => openMenu(e, buildCheckpointMenu(checkpoint))}
                      className={highlightId === checkpoint.id ? 'bg-brand-400/10 transition-colors' : ''}
                    >
                      <td>
                        <div className="flex items-center gap-2">
                          <span className={`led-dot ${checkpoint.is_active ? 'led-green' : 'led-off'}`} />
                          <span className="text-rmpg-100 font-medium text-xs">{checkpoint.name}</span>
                        </div>
                      </td>
                      <td className="text-xs text-rmpg-200">
                        {checkpoint.property_name}
                      </td>
                      <td className="text-xs text-rmpg-200 max-w-[200px] truncate">
                        {checkpoint.description || '-'}
                      </td>
                      <td className="text-xs text-rmpg-200 font-mono">
                        {checkpoint.scan_required_interval_minutes} min
                      </td>
                      <td>
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold uppercase panel-beveled ${
                            checkpoint.is_active
                              ? 'bg-green-900/50 text-green-400 border border-green-700/50'
                              : 'bg-rmpg-700/50 text-rmpg-400 border border-rmpg-600/50'
                          }`}
                        >
                          {checkpoint.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        <div className="flex justify-end gap-2">
                          <IconButton
                            onClick={() => handleShowQr(checkpoint.qr_code)}
                            className="text-brand-400 hover:text-brand-300"
                            title="Show QR Code"
                            aria-label={`Show QR code for ${checkpoint.name}`}
                          >
                            <Eye className="w-4 h-4" />
                          </IconButton>
                          {!checkpoint.archived_at && (
                            <>
                              <IconButton
                                onClick={() => handleEditCheckpoint(checkpoint)}
                                className="text-amber-400 hover:text-amber-300"
                                title="Edit"
                                aria-label={`Edit ${checkpoint.name}`}
                              >
                                <Pencil className="w-4 h-4" />
                              </IconButton>
                              <IconButton
                                onClick={() => handleArchiveCheckpoint(checkpoint.id)}
                                className="text-rmpg-400 hover:text-rmpg-300"
                                title="Archive"
                                aria-label={`Archive ${checkpoint.name}`}
                              >
                                <Archive className="w-4 h-4" />
                              </IconButton>
                              {canDelete && (
                                <IconButton
                                  onClick={() => setDeleteConfirmId(checkpoint.id)}
                                  className="text-red-400 hover:text-red-300"
                                  title="Delete"
                                  aria-label={`Delete ${checkpoint.name}`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </IconButton>
                              )}
                            </>
                          )}
                          {checkpoint.archived_at && (
                            <IconButton
                              onClick={() => handleUnarchiveCheckpoint(checkpoint.id)}
                              className="text-green-400 hover:text-green-300"
                              title="Unarchive"
                              aria-label={`Unarchive ${checkpoint.name}`}
                            >
                              <RotateCcw className="w-4 h-4" />
                            </IconButton>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              )}
              {checkpoints.length === 0 && (
                <div className="text-center py-12 text-rmpg-400">
                  <QrCode className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <div className="text-sm text-rmpg-300 mb-1">No checkpoints yet</div>
                  <div className="text-[11px] text-rmpg-500">Press <kbd className="font-mono bg-rmpg-700 px-1 rounded-sm">N</kbd> or use <span className="text-brand-400">+ Add Checkpoint</span> to create your first checkpoint.</div>
                </div>
              )}
            </div>
          )}

          {/* Scans Tab */}
          {activeTab === 'scans' && (
            <>
              {/* Filters */}
              <div className="panel-beveled p-4 mb-4 bg-[var(--surface-base)]">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <label htmlFor="ff-patrolpage-0" className="block text-sm font-medium text-rmpg-200 mb-1">
                      Checkpoint:
                    </label>
                    <select id="ff-patrolpage-0"
                      value={scanFilters.checkpointId}
                      onChange={(e) =>
                        setScanFilters(prev => ({ ...prev, checkpointId: e.target.value }))
                      }
                      className="select-dark"
                    >
                      <option value="">All Checkpoints</option>
                      {checkpoints.map((cp) => (
                        <option key={cp.id} value={cp.id}>
                          {cp.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="ff-patrolpage-1" className="block text-sm font-medium text-rmpg-200 mb-1">
                      Start Date:
                    </label>
                    <input id="ff-patrolpage-1"
                      type="datetime-local"
                      value={scanFilters.startDate}
                      onChange={(e) =>
                        setScanFilters(prev => ({ ...prev, startDate: e.target.value }))
                      }
                      className="input-dark min-h-[36px]"
                    />
                  </div>
                  <div>
                    <label htmlFor="ff-patrolpage-2" className="block text-sm font-medium text-rmpg-200 mb-1">
                      End Date:
                    </label>
                    <input id="ff-patrolpage-2"
                      type="datetime-local"
                      value={scanFilters.endDate}
                      onChange={(e) =>
                        setScanFilters(prev => ({ ...prev, endDate: e.target.value }))
                      }
                      className="input-dark min-h-[36px]"
                    />
                  </div>
                  <div className="flex items-end">
                    <button type="button"
                      onClick={() =>
                        setScanFilters({
                          checkpointId: '',
                          officerId: '',
                          startDate: '',
                          endDate: ''
                        })
                      }
                      className="toolbar-btn w-full justify-center"
                    >
                      <X className="w-4 h-4" />
                      Clear Filters
                    </button>
                  </div>
                </div>
              </div>

              <div className="panel-beveled overflow-hidden bg-[var(--surface-base)]">
                {isMobile ? (
                  <div className="space-y-2 p-2">
                    {scans.map((scan) => (
                      <div
                        key={scan.id}
                        onContextMenu={(e) => openMenu(e, buildScanMenu(scan))}
                        className="panel-beveled bg-surface-raised p-3"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className={`flex items-center gap-2 text-[11px] ${getStatusColor(scan.status)}`}>
                            {getStatusIcon(scan.status)}
                            <span className="capitalize font-bold">{toDisplayLabel(scan.status)}</span>
                          </div>
                          <span className="text-[10px] text-rmpg-400 font-mono">
                            {formatDateTime(scan.scanned_at)}
                          </span>
                        </div>
                        <div className="text-sm text-rmpg-100 font-medium truncate">{scan.checkpoint_name}</div>
                        <div className="text-[10px] text-rmpg-400 flex items-center gap-2 mb-1 truncate">
                          <span>{scan.property_name}</span>
                          <span className="text-rmpg-600">·</span>
                          <span>{scan.officer_name}</span>
                        </div>
                        {scan.notes && (
                          <div className="text-[11px] text-rmpg-200 pt-1 mt-1 border-t border-rmpg-700/50 line-clamp-2">{scan.notes}</div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                <div>
                <table className="table-dark">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Officer</th>
                      <th>Checkpoint</th>
                      <th>Property</th>
                      <th>Status</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scans.map((scan) => (
                      <tr key={scan.id} onContextMenu={(e) => openMenu(e, buildScanMenu(scan))}>
                        <td className="text-xs text-rmpg-200 font-mono whitespace-nowrap">
                          {formatDateTime(scan.scanned_at)}
                        </td>
                        <td className="text-xs text-rmpg-200">{scan.officer_name}</td>
                        <td className="text-xs text-rmpg-100 font-medium">{scan.checkpoint_name}</td>
                        <td className="text-xs text-rmpg-200">{scan.property_name}</td>
                        <td>
                          <div className={`flex items-center gap-2 text-xs ${getStatusColor(scan.status)}`}>
                            {getStatusIcon(scan.status)}
                            <span className="capitalize">{toDisplayLabel(scan.status)}</span>
                          </div>
                        </td>
                        <td className="text-xs text-rmpg-200 max-w-[200px] truncate">{scan.notes || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
                )}
                {scans.length === 0 && (
                  <div className="text-center py-12 text-rmpg-400">
                    <Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    {scanFilters.checkpointId || scanFilters.officerId || scanFilters.startDate || scanFilters.endDate ? (
                      <>
                        <div className="text-sm text-rmpg-300 mb-1">No scans match the current filters</div>
                        <div className="text-[11px] text-rmpg-500">Try widening the date range or clearing the filters.</div>
                      </>
                    ) : (
                      <>
                        <div className="text-sm text-rmpg-300 mb-1">No scan records yet</div>
                        <div className="text-[11px] text-rmpg-500">Scans are logged when officers scan QR codes at checkpoints.</div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Map Tab */}
          {activeTab === 'map' && (
            <PatrolMapView checkpoints={checkpoints} scans={scans} />
          )}

          {/* Feature 11/13/15: Shift Summary Tab */}
          {activeTab === 'summary' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <button type="button" onClick={loadShiftSummary} className="toolbar-btn toolbar-btn-primary print:hidden">
                  <RefreshCw className="w-3 h-3" /> {isMobile ? 'Reload' : 'Load Summary'}
                </button>
                <button type="button" onClick={loadEfficiency} className="toolbar-btn">
                  <CheckCircle className="w-3 h-3" /> {isMobile ? 'Efficiency' : 'Efficiency Score'}
                </button>
                <div className={`${isMobile ? 'w-full' : 'ml-auto'} flex items-center gap-2 ${isMobile ? 'justify-end' : ''}`}>
                  {/* Feature 13: Break tracking — hydrated from /patrol/breaks
                      on mount so a page refresh keeps the on-break state.
                      Live elapsed counter at 30s tick (officer reads minutes,
                      not seconds) so the button isn't just a binary toggle. */}
                  {isOnBreak ? (
                    <>
                      <span className="text-[10px] font-mono tabular-nums text-rmpg-400" title="Elapsed since break started">
                        {(() => {
                          const totalMin = Math.max(0, Math.floor(breakElapsedMs / 60_000));
                          return totalMin >= 60 ? `${Math.floor(totalMin / 60)}h ${totalMin % 60}m` : `${totalMin}m`;
                        })()}
                      </span>
                      <button type="button" onClick={endBreak} className="toolbar-btn text-red-400 border-red-700/50">
                        <Clock className="w-3 h-3" /> End Break
                      </button>
                    </>
                  ) : (
                    <div className="flex gap-1">
                      <button type="button" onClick={() => startBreak('break')} disabled={breakStarting} className="toolbar-btn disabled:opacity-50">Break</button>
                      <button type="button" onClick={() => startBreak('meal')} disabled={breakStarting} className="toolbar-btn disabled:opacity-50">Meal</button>
                    </div>
                  )}
                </div>
              </div>

              {/* Shift Summary Card */}
              {shiftSummary && (
                <div className="panel-beveled p-4 bg-surface-base space-y-3">
                  <h3 className="text-sm font-bold text-rmpg-100 mb-3">Shift Summary - {shiftSummary.date}</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-400 font-mono">{shiftSummary.scans_total}</div>
                      <div className="text-[10px] text-rmpg-400">Total Scans</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-rmpg-400 font-mono">{shiftSummary.scans_on_time}</div>
                      <div className="text-[10px] text-rmpg-400">On Time</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-amber-400 font-mono">{shiftSummary.scans_late}</div>
                      <div className="text-[10px] text-rmpg-400">Late</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-purple-400 font-mono">{shiftSummary.incidents_count}</div>
                      <div className="text-[10px] text-rmpg-400">Incidents</div>
                    </div>
                  </div>
                  <div className="border-t border-rmpg-600 pt-3 grid grid-cols-3 gap-4">
                    <div>
                      <span className="text-[10px] text-rmpg-400">Est. Mileage</span>
                      <div className="text-sm font-mono text-rmpg-100">{shiftSummary.estimated_mileage} mi</div>
                    </div>
                    <div>
                      <span className="text-[10px] text-rmpg-400">Break Time</span>
                      <div className="text-sm font-mono text-rmpg-100">{shiftSummary.total_break_minutes} min</div>
                    </div>
                    <div>
                      <span className="text-[10px] text-rmpg-400">Properties</span>
                      <div className="text-sm font-mono text-rmpg-100">{shiftSummary.properties_visited?.length || 0}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Feature 15: Efficiency Score Card */}
              {efficiency && (
                <div className="panel-beveled p-4 bg-surface-base">
                  <h3 className="text-sm font-bold text-rmpg-100 mb-3">Patrol Efficiency</h3>
                  <div className="flex items-center gap-6">
                    <div className="text-center">
                      <div className={`text-4xl font-bold font-mono ${efficiency.efficiency_score >= 80 ? 'text-green-400' : efficiency.efficiency_score >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                        {efficiency.efficiency_score}%
                      </div>
                      <div className="text-[10px] text-rmpg-400">Efficiency Score</div>
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className="flex justify-between text-xs">
                        <span className="text-rmpg-400">Completion</span>
                        <span className="text-rmpg-100 font-mono">{efficiency.completion_rate}%</span>
                      </div>
                      <div className="h-2 bg-rmpg-700 overflow-hidden">
                        <div className="h-full bg-brand-500" style={{ width: `${Math.min(efficiency.completion_rate, 100)}%` }} />
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-rmpg-400">On-Time Rate</span>
                        <span className="text-rmpg-100 font-mono">{efficiency.on_time_rate}%</span>
                      </div>
                      <div className="h-2 bg-rmpg-700 overflow-hidden">
                        <div className="h-full bg-green-500" style={{ width: `${Math.min(efficiency.on_time_rate, 100)}%` }} />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Compliance Tab */}
          {activeTab === 'compliance' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {compliance.map((item) => {
                const complianceColor = getComplianceColor(item.compliance_rate);
                const overdue = isOverdue(item.next_scan_due);

                return (
                  <div
                    key={item.checkpoint_id}
                    className={`panel-beveled p-3 border bg-surface-raised ${complianceColor}`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="min-w-0">
                        <h3 className="text-xs font-bold text-rmpg-100 uppercase tracking-wide truncate">
                          {item.checkpoint_name}
                        </h3>
                        <p className="text-[10px] text-rmpg-400 truncate">{item.property_name}</p>
                      </div>
                      <div className={`text-xl font-bold font-mono ${complianceColor}`}>
                        {item.compliance_rate}%
                      </div>
                    </div>

                    <div className="space-y-1 text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="text-rmpg-400">Scans Today</span>
                        <span className="text-rmpg-100 font-mono">{item.scans_today}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-rmpg-400">Last Scan</span>
                        <span className="text-rmpg-100 font-mono">{formatTimeAgo(item.last_scan_time)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-rmpg-400">Interval</span>
                        <span className="text-rmpg-100 font-mono">{item.scan_interval_minutes} min</span>
                      </div>
                      <div className="pt-2 mt-1 border-t border-rmpg-700 flex items-center justify-between">
                        <span className="text-rmpg-400">Next Due</span>
                        {item.next_scan_due ? (
                          <span className={`font-mono ${overdue ? 'text-red-400' : 'text-green-400'}`}>
                            {overdue ? 'OVERDUE' : formatTimeAgo(item.next_scan_due)}
                          </span>
                        ) : (
                          <span className="text-rmpg-500">Not scanned yet</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {compliance.length === 0 && (
                <div className="col-span-3 text-center py-12 text-rmpg-400">
                  <CheckCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <div className="text-sm text-rmpg-300 mb-1">No active checkpoints</div>
                  <div className="text-[11px] text-rmpg-500">Compliance data appears here once checkpoints are marked active. Create or activate checkpoints on the Checkpoints tab.</div>
                </div>
              )}
            </div>
          )}

          {/* Mileage Audit Tab */}
          {activeTab === 'mileage' && (
            <div className="p-2">
              <MileageAuditTab />
            </div>
          )}

          {/* Pricing Tab */}
          {activeTab === 'pricing' && <PricingTab />}

          {/* Contracts Tab */}
          {activeTab === 'contracts' && <ContractsTab />}

          {/* Billing Review Tab */}
          {activeTab === 'billing' && <BillingReviewTab />}
        </>
      )}

      {/* Checkpoint Modal */}
      {showCheckpointModal && (
        <div className="fixed inset-0 bg-black/60 flex items-start justify-center z-50 overflow-y-auto p-4" role="dialog" aria-modal="true" aria-labelledby={checkpointModalTitleId}>
          <div className="panel-beveled bg-surface-base p-6 max-w-md w-full mx-4 my-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 id={checkpointModalTitleId} className="text-xl font-bold text-rmpg-100">
                {editingCheckpoint ? 'Edit Checkpoint' : 'Create Checkpoint'}
              </h2>
              <div className="flex items-center gap-2">
                {formIsDirty && (
                  <span className="text-[8px] text-amber-400 font-bold uppercase tracking-wider">UNSAVED</span>
                )}
                <IconButton onClick={() => { clearFormDraft(); setShowCheckpointModal(false); }} className="text-rmpg-400 hover:text-rmpg-100" aria-label="Close">
                  <X className="w-5 h-5" />
                </IconButton>
              </div>
            </div>

            {formWasRestored && (
              <div className="flex items-center justify-between px-3 py-2 rounded-sm border border-amber-500/30 mb-4" style={{ background: 'rgb(var(--sev-warn-rgb) / 0.08)' }}>
                <div className="flex items-center gap-2">
                  <Clock size={14} className="text-amber-400" />
                  <span className="text-xs text-amber-400 font-medium">Restored pending draft</span>
                </div>
                <button type="button" onClick={clearFormDraft} className="text-[10px] text-amber-400 underline hover:text-amber-300">
                  Discard
                </button>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label htmlFor="ff-patrolpage-3" className="block text-sm font-medium text-rmpg-200 mb-1">
                  Property: *
                </label>
                <select id="ff-patrolpage-3"
                  value={formData.property_id}
                  onChange={(e) => setFormData(prev => ({ ...prev, property_id: e.target.value }))}
                  className="select-dark"
                  required
                >
                  <option value="">Select Property</option>
                  {properties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="ff-patrolpage-4" className="block text-sm font-medium text-rmpg-200 mb-1">
                  Checkpoint Name: *
                </label>
                <input id="ff-patrolpage-4"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="input-dark min-h-[36px]"
                  placeholder="e.g., Main Entrance"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-rmpg-200 mb-1">
                  Description:
                </label>
                <RichTextArea
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  className="textarea-dark"
                  rows={3}
                  placeholder="Optional description"
                />
              </div>

              <div>
                <label htmlFor="ff-patrolpage-5" className="block text-sm font-medium text-rmpg-200 mb-1">
                  Scan Interval (minutes): *
                </label>
                <input id="ff-patrolpage-5"
                  type="number"
                  value={formData.scan_required_interval_minutes}
                  onChange={(e) =>
                    setFormData(prev => ({
                      ...prev,
                      scan_required_interval_minutes: e.target.value
                    }))
                  }
                  className="input-dark min-h-[36px]"
                  placeholder="e.g., 60"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="ff-patrolpage-6" className="block text-sm font-medium text-rmpg-200 mb-1">
                    Latitude:
                  </label>
                  <input id="ff-patrolpage-6"
                    type="number"
                    step="any"
                    value={formData.latitude}
                    onChange={(e) => setFormData(prev => ({ ...prev, latitude: e.target.value }))}
                    className="input-dark min-h-[36px]"
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label htmlFor="ff-patrolpage-7" className="block text-sm font-medium text-rmpg-200 mb-1">
                    Longitude:
                  </label>
                  <input id="ff-patrolpage-7"
                    type="number"
                    step="any"
                    value={formData.longitude}
                    onChange={(e) => setFormData(prev => ({ ...prev, longitude: e.target.value }))}
                    className="input-dark min-h-[36px]"
                    placeholder="Optional"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_active"
                  checked={formData.is_active}
                  onChange={(e) => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
                  className="w-4 h-4 bg-rmpg-700 border-rmpg-600"
                />
                <label htmlFor="is_active" className="text-sm text-rmpg-200">
                  Active
                </label>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button type="button"
                onClick={() => { clearFormDraft(); setShowCheckpointModal(false); }}
                className="toolbar-btn flex-1 justify-center"
              >
                Cancel
              </button>
              <button type="button"
                onClick={handleSaveCheckpoint}
                className="toolbar-btn toolbar-btn-primary flex-1 justify-center"
                disabled={
                  !formData.property_id ||
                  !formData.name ||
                  !formData.scan_required_interval_minutes
                }
              >
                {editingCheckpoint ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR Code Modal */}
      {showQrModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" role="dialog" aria-modal="true" aria-labelledby={qrModalTitleId}>
          <div className="panel-beveled bg-surface-base p-6 max-w-lg w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h2 id={qrModalTitleId} className="text-xl font-bold text-rmpg-100">QR Code</h2>
              <IconButton
                onClick={() => setShowQrModal(false)}
                className="text-rmpg-300 hover:text-rmpg-100"
                aria-label="Close"
              >
                <X className="w-6 h-6" />
              </IconButton>
            </div>

            <div className="bg-surface-sunken panel-inset p-8 text-center">
              {qrImageUrl ? (
                <>
                  {/* White tile supplies the light quiet zone; a QR drawn straight
                      onto the sunken panel has no distinguishable margin. */}
                  <div className="bg-white p-3 inline-block mb-4">
                    <img src={qrImageUrl} alt={`QR code for checkpoint token ${selectedQrCode}`}
                      width={200} height={200} className="block" />
                  </div>
                  <p className="text-xs text-rmpg-300 mb-2">Scan this code with a QR scanner app:</p>
                </>
              ) : (
                <>
                  <QrCode className="w-16 h-16 text-brand-400 mx-auto mb-4" aria-hidden="true" />
                  <p className="text-xs text-fg-muted mb-2">Enter this checkpoint token manually:</p>
                </>
              )}
              <p className="text-2xl font-mono text-rmpg-100 break-all">{selectedQrCode}</p>
            </div>

            <p className="text-sm text-rmpg-300 mt-4">
              Officers should scan this QR code at the checkpoint location to log their patrol.
            </p>

            <button type="button"
              onClick={() => {
                navigator.clipboard.writeText(selectedQrCode);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="toolbar-btn toolbar-btn-primary w-full mt-4 justify-center py-2"
            >
              <Copy className="w-3.5 h-3.5" />
              {copied ? 'Copied!' : 'Copy to Clipboard'}
            </button>
          </div>
        </div>
      )}
      {/* Delete Checkpoint Confirmation */}
      <ConfirmDialog
        isOpen={deleteConfirmId !== null}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={() => deleteConfirmId && handleDeleteCheckpoint(deleteConfirmId)}
        title="Delete Checkpoint"
        message="Are you sure you want to delete this checkpoint? This action cannot be undone."
        confirmLabel="Delete"
        confirmVariant="danger"
      />
      <UnsavedChangesGuard hasUnsavedChanges={showCheckpointModal && formIsDirty} />
      <FloatingSaveBar
        visible={showCheckpointModal && formIsDirty}
        onSave={handleSaveCheckpoint}
        onCancel={() => { clearFormDraft(); setShowCheckpointModal(false); }}
        isSaving={false}
        saveLabel={editingCheckpoint ? 'Update Checkpoint' : 'Create Checkpoint'}
      />
    </div>
  );
};

export default PatrolPage;
