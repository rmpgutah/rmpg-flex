import React, { useState, useEffect, useCallback, useId } from 'react';
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
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import ConfirmDialog from '../components/ConfirmDialog';
import { usePersistedTab } from '../hooks/usePersistedState';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';
import RmpgLogo from '../components/RmpgLogo';
import PrintButton from '../components/PrintButton';
import ExportButton from '../components/ExportButton';
import TabBar from '../components/TabBar';
import { useIsMobile } from '../hooks/useIsMobile';
import { safeDateStr, safeTimeStr } from '../utils/dateUtils';
import { loadGoogleMaps, DARK_MAP_STYLE, registerMapInstance, unregisterMapInstance, onOnlineRetryMaps } from '../utils/googleMapsLoader';
import { getGoogleMapsApiKey } from '../utils/googleMapsApiKey';
import { useToast } from '../components/ToastProvider';

// Add global google type for TypeScript
declare global {
  interface Window {
    google: typeof google;
  }
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace google {
    // The google.maps types are available globally when the Maps script is loaded.
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
// Shows checkpoint markers + scan route polylines on Google Maps.

function PatrolMapView({ checkpoints, scans }: { checkpoints: Checkpoint[]; scans: Scan[] }) {
  const mapRef = React.useRef<HTMLDivElement>(null);
  const mapInstanceRef = React.useRef<google.maps.Map | null>(null);
  const [mapReady, setMapReady] = React.useState(false);

  React.useEffect(() => {
    if (!mapRef.current) return;

    let cancelled = false;

    function initPatrolMap() {
      if (cancelled || !mapRef.current || mapInstanceRef.current) return;

      const map = new google.maps.Map(mapRef.current, {
        center: { lat: 40.76, lng: -111.89 },
        zoom: 12,
        styles: DARK_MAP_STYLE,
        disableDefaultUI: true,
        zoomControl: true,
        backgroundColor: '#171717',
        gestureHandling: 'greedy',
      });
      mapInstanceRef.current = map;
      registerMapInstance(map);
      setMapReady(true);
    }

    // Retry with backoff (3 attempts) for intermittent WiFi
    function attemptLoad(apiKey: string, attempt: number) {
      if (cancelled) return;
      loadGoogleMaps(apiKey)
        .then(() => initPatrolMap())
        .catch(() => {
          if (cancelled) return;
          if (attempt < 3) {
            setTimeout(() => attemptLoad(apiKey, attempt + 1), [3000, 6000, 12000][attempt]);
          }
        });
    }
    let unsubOnline = () => {};
    (async () => {
      try {
        const apiKey = await getGoogleMapsApiKey();
        if (cancelled) return;
        attemptLoad(apiKey, 0);
        unsubOnline = onOnlineRetryMaps(apiKey, () => {
          if (!cancelled && !mapInstanceRef.current) initPatrolMap();
        });
      } catch {
        setMapReady(false);
      }
    })();

    return () => {
      cancelled = true;
      unsubOnline();
      if (mapInstanceRef.current) unregisterMapInstance(mapInstanceRef.current);
    };
  }, []);

  // Add markers + polylines when map is ready
  React.useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;

    const bounds = new google.maps.LatLngBounds();
    let hasPoints = false;

    // Checkpoint markers
    checkpoints.forEach(cp => {
      if (!cp.latitude || !cp.longitude) return;
      const pos = { lat: cp.latitude, lng: cp.longitude };
      bounds.extend(pos);
      hasPoints = true;

      const marker = new google.maps.Marker({
        map,
        position: pos,
        title: cp.name,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: cp.is_active ? '#22c55e' : '#666666',
          fillOpacity: 0.9,
          strokeColor: '#fff',
          strokeWeight: 2,
          scale: 8,
        },
      });

      const info = new google.maps.InfoWindow({
        content: `<div style="color:#000;font-size:12px;font-weight:bold">${cp.name}</div>
          <div style="color:#666;font-size:10px">${cp.is_active ? 'Active' : 'Inactive'} • Every ${cp.scan_required_interval_minutes || '?'} min</div>`,
      });
      marker.addListener('click', () => info.open(map, marker));
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

    const colors = ['#888888', '#a855f7', '#f59e0b', '#ef4444', '#22c55e'];
    let colorIdx = 0;
    scansByDate.forEach((dayScans) => {
      const sorted = dayScans.sort((a, b) => new Date(a.scanned_at).getTime() - new Date(b.scanned_at).getTime());
      const path = sorted.map(s => {
        const pos = { lat: s.latitude!, lng: s.longitude! };
        bounds.extend(pos);
        hasPoints = true;
        return pos;
      });

      if (path.length > 1) {
        new google.maps.Polyline({
          map,
          path,
          strokeColor: colors[colorIdx % colors.length],
          strokeOpacity: 0.7,
          strokeWeight: 2,
        });
      }
      colorIdx++;
    });

    if (hasPoints) {
      map.fitBounds(bounds, 50);
    }
  }, [mapReady, checkpoints, scans]);

  return (
    <div className="relative w-full flex-1" style={{ minHeight: 400 }}>
      <div ref={mapRef} className="absolute inset-0" />
      <div className="absolute top-2 left-2 text-[9px] font-mono text-rmpg-400 bg-black/60 px-2 py-1 border border-rmpg-700">
        {checkpoints.filter(c => c.latitude != null && c.longitude != null).length} checkpoints •{' '}
        {scans.filter(s => s.latitude != null && s.longitude != null).length} scan points
      </div>
    </div>
  );
}

const PatrolPage: React.FC = () => {
  const isMobile = useIsMobile();
  const { addToast } = useToast();

  // Set document title
  useEffect(() => { document.title = 'Patrol Tracking \u2014 RMPG Flex'; }, []);
  const checkpointModalTitleId = useId();
  const qrModalTitleId = useId();
  const [activeTab, setActiveTab] = usePersistedTab('rmpg_patrol_tab', 'checkpoints', ['checkpoints', 'scans', 'compliance', 'map', 'summary'] as const);
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
  const [editingCheckpoint, setEditingCheckpoint] = useState<Checkpoint | null>(null);
  const [formData, setFormData] = useState({
    property_id: '',
    name: '',
    description: '',
    latitude: '',
    longitude: '',
    scan_required_interval_minutes: '',
    is_active: true
  });

  // ── Feature 11/13/15: Shift summary, break tracking, efficiency ──
  const [shiftSummary, setShiftSummary] = useState<any>(null);
  const [isOnBreak, setIsOnBreak] = useState(false);
  const [efficiency, setEfficiency] = useState<any>(null);

  const loadShiftSummary = async () => {
    try {
      const data = await apiFetch<any>('/patrol/shift-summary');
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
    try {
      await apiFetch('/patrol/breaks/start', { method: 'POST', body: JSON.stringify({ break_type: breakType }) });
      setIsOnBreak(true);
      addToast('Break started', 'success');
    } catch (err: any) { addToast(err?.message || 'Failed to start break', 'error'); }
  };

  const endBreak = async () => {
    try {
      const data = await apiFetch<any>('/patrol/breaks/end', { method: 'POST' });
      setIsOnBreak(false);
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
      if (scanFilters.checkpointId) params.append('checkpointId', scanFilters.checkpointId);
      if (scanFilters.officerId) params.append('officerId', scanFilters.officerId);
      if (scanFilters.startDate) params.append('startDate', scanFilters.startDate);
      if (scanFilters.endDate) params.append('endDate', scanFilters.endDate);

      const data = await apiFetch<Scan[]>(`/patrol/scans?${params.toString()}`);
      setScans(data || []);
    } catch {
      setScans([]);
    }
  };

  const loadCompliance = async () => {
    try {
      const data = await apiFetch<Compliance[]>('/patrol/compliance');
      setCompliance(data || []);
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
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
  };

  const formatTimeAgo = (dateString: string | null) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
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
    return new Date(nextDue) < new Date();
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

  // ── Feature 4: Coverage Heatmap data ──
  const [coverageData, setCoverageData] = useState<any>(null);
  const handleLoadCoverage = async () => {
    try {
      const data = await apiFetch<any>('/patrol/coverage-heatmap?days=7');
      setCoverageData(data);
    } catch (err: any) { addToast(err?.message || 'Failed to load coverage data', 'error'); }
  };

  const patrolTabs = [
    { id: 'checkpoints' as const, label: 'Checkpoints', icon: QrCode },
    { id: 'scans' as const, label: 'Scan Log', icon: Clock },
    { id: 'compliance' as const, label: 'Compliance', icon: CheckCircle },
    { id: 'map' as const, label: 'Map', icon: MapIcon },
    { id: 'summary' as const, label: 'Shift Summary', icon: CheckCircle },
  ];

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Portal Header */}
      {!isMobile && (
        <div className="panel-beveled bg-surface-base overflow-hidden">
          <div className="flex items-center gap-4 px-4 py-2.5 relative">
            <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, #1a1a1a, #888888 30%, #888888 70%, #1a1a1a)' }} />
            <RmpgLogo height={64} />
            <div className="flex-1">
              <h1 className="text-sm font-bold tracking-wider uppercase text-rmpg-200">Patrol Operations</h1>
              <p className="text-[9px] tracking-wide text-rmpg-600">Rocky Mountain Protective Group, LLC</p>
            </div>
          </div>
        </div>
      )}

      {!isMobile && <PanelTitleBar title="PATROL MANAGEMENT" icon={MapPin}>
        <PrintButton />
        {activeTab === 'scans' && (
          <ExportButton exportUrl="/patrol/scans/export?format=csv" exportFilename="patrol_scans_export.csv" />
        )}
        {activeTab === 'checkpoints' && (
          <button type="button" onClick={handleCreateCheckpoint} className="toolbar-btn toolbar-btn-primary print:hidden">
            <Plus className="w-3.5 h-3.5" /> Add Checkpoint
          </button>
        )}
        {activeTab === 'compliance' && (
          <button type="button" onClick={loadCompliance} className="toolbar-btn">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        )}
      </PanelTitleBar>}

      {/* Tabs */}
      <TabBar
        tabs={patrolTabs}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as 'checkpoints' | 'scans' | 'compliance' | 'map')}
      />

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
            <Clock className="w-3 h-3 text-gray-400" />
            <span className="text-rmpg-400">Scans Today:</span>
            <span className="text-gray-400 font-bold">
              {scans.filter(s => {
                const today = new Date().toDateString();
                return new Date(s.scanned_at).toDateString() === today;
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
        <div className="mx-3 mt-2 p-2 bg-gray-900/20 border border-gray-700/50 text-xs text-gray-300">
          <div className="flex items-center justify-between mb-1">
            <span className="font-bold">Optimized Route — {optimizedRoute.optimized_order?.length || 0} checkpoints, {optimizedRoute.total_distance_km} km total</span>
            <IconButton onClick={() => setOptimizedRoute(null)} className="text-gray-500 hover:text-gray-300" aria-label="Close optimized route"><X className="w-3 h-3" /></IconButton>
          </div>
          <div className="space-y-0.5 text-[10px] max-h-32 overflow-y-auto">
            {optimizedRoute.optimized_order?.map((cp: any, i: number) => (
              <div key={cp.id} className="flex gap-2">
                <span className="text-gray-500 w-4">{i + 1}.</span>
                <span className="text-white">{cp.name}</span>
                <span className="text-gray-500 ml-auto">{cp.distance_from_previous_km} km</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feature 2: Patrol Log Panel */}
      {patrolLog && (
        <div className="mx-3 mt-2 p-2 bg-green-900/20 border border-green-700/50 text-xs text-green-300">
          <div className="flex items-center justify-between mb-1">
            <span className="font-bold">Patrol Log — {patrolLog.officer_name} ({patrolLog.date})</span>
            <IconButton onClick={() => setPatrolLog(null)} className="text-green-500 hover:text-green-300" aria-label="Close patrol log"><X className="w-3 h-3" /></IconButton>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] mb-2">
            <div><span className="text-rmpg-400">Checkpoints:</span> <span className="text-white">{patrolLog.total_checkpoints_scanned}</span></div>
            <div><span className="text-rmpg-400">Total Time:</span> <span className="text-white">{patrolLog.total_time_minutes} min</span></div>
            <div><span className="text-rmpg-400">On Time:</span> <span className="text-green-400">{patrolLog.on_time}</span></div>
            <div><span className="text-rmpg-400">Late:</span> <span className="text-amber-400">{patrolLog.late}</span></div>
          </div>
          <div className="space-y-0.5 text-[10px] max-h-32 overflow-y-auto">
            {patrolLog.entries?.map((e: any, i: number) => (
              <div key={i} className="flex gap-2">
                <span className="text-rmpg-500 w-24">{safeTimeStr(e.time)}</span>
                <span className="text-white flex-1">{e.checkpoint}</span>
                <span className={e.status === 'on_time' ? 'text-green-400' : 'text-amber-400'}>{e.status === 'on_time' ? 'On Time' : e.status.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</span>
                {e.time_since_prev_min != null && <span className="text-rmpg-500">{e.time_since_prev_min}m</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feature 6: Exception Report Panel */}
      {exceptions && (
        <div className="mx-3 mt-2 p-2 bg-amber-900/20 border border-amber-700/50 text-xs text-amber-300">
          <div className="flex items-center justify-between mb-1">
            <span className="font-bold">Exception Report — {exceptions.period_days} days ({exceptions.late_count} late / {exceptions.total_scans} total = {exceptions.late_rate}% late)</span>
            <IconButton onClick={() => setExceptions(null)} className="text-amber-500 hover:text-amber-300" aria-label="Close exceptions"><X className="w-3 h-3" /></IconButton>
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
        <div className="mx-3 mt-2 p-2 bg-purple-900/20 border border-purple-700/50 text-xs text-purple-300">
          <div className="flex items-center justify-between mb-1">
            <span className="font-bold">Time Tracking — {timeTracking.date}</span>
            <IconButton onClick={() => setTimeTracking(null)} className="text-purple-500 hover:text-purple-300" aria-label="Close time tracking"><X className="w-3 h-3" /></IconButton>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] mb-2">
            <div><span className="text-rmpg-400">Total Patrol:</span> <span className="text-white">{timeTracking.total_patrol_minutes} min</span></div>
            <div><span className="text-rmpg-400">Checkpoints:</span> <span className="text-white">{timeTracking.total_checkpoints}</span></div>
            <div><span className="text-rmpg-400">Avg Between:</span> <span className="text-white">{timeTracking.average_between_minutes} min</span></div>
            <div><span className="text-rmpg-400">Longest Gap:</span> <span className="text-amber-400">{timeTracking.longest_gap_minutes} min</span></div>
          </div>
          <div className="max-h-24 overflow-y-auto space-y-0.5">
            {timeTracking.segments?.map((s: any, i: number) => (
              <div key={i} className="text-[10px] flex gap-2">
                <span className="text-rmpg-500">{s.from}</span>
                <span className="text-purple-500">→</span>
                <span className="text-white">{s.to}</span>
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
              <div className={isMobile ? 'overflow-x-auto' : ''}>
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
                    <tr key={checkpoint.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <span className={`led-dot ${checkpoint.is_active ? 'led-green' : 'led-off'}`} />
                          <span className="text-white font-medium text-xs">{checkpoint.name}</span>
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
                              <IconButton
                                onClick={() => setDeleteConfirmId(checkpoint.id)}
                                className="text-red-400 hover:text-red-300"
                                title="Delete"
                                aria-label={`Delete ${checkpoint.name}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </IconButton>
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
              {checkpoints.length === 0 && (
                <div className="text-center py-12 text-rmpg-300">
                  No checkpoints found. Create one to get started.
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
                    <label className="block text-sm font-medium text-rmpg-200 mb-1">
                      Checkpoint:
                    </label>
                    <select
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
                    <label className="block text-sm font-medium text-rmpg-200 mb-1">
                      Start Date:
                    </label>
                    <input
                      type="datetime-local"
                      value={scanFilters.startDate}
                      onChange={(e) =>
                        setScanFilters(prev => ({ ...prev, startDate: e.target.value }))
                      }
                      className="input-dark min-h-[36px]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-rmpg-200 mb-1">
                      End Date:
                    </label>
                    <input
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
                <div className={isMobile ? 'overflow-x-auto' : ''}>
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
                      <tr key={scan.id}>
                        <td className="text-xs text-rmpg-200 font-mono whitespace-nowrap">
                          {formatDateTime(scan.scanned_at)}
                        </td>
                        <td className="text-xs text-rmpg-200">{scan.officer_name}</td>
                        <td className="text-xs text-white font-medium">{scan.checkpoint_name}</td>
                        <td className="text-xs text-rmpg-200">{scan.property_name}</td>
                        <td>
                          <div className={`flex items-center gap-2 text-xs ${getStatusColor(scan.status)}`}>
                            {getStatusIcon(scan.status)}
                            <span className="capitalize">{scan.status.replace(/_/g, ' ')}</span>
                          </div>
                        </td>
                        <td className="text-xs text-rmpg-200 max-w-[200px] truncate">{scan.notes || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
                {scans.length === 0 && (
                  <div className="text-center py-12 text-rmpg-300">
                    No scans found matching the filters.
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
              <div className="flex items-center gap-3 mb-4">
                <button type="button" onClick={loadShiftSummary} className="toolbar-btn toolbar-btn-primary print:hidden">
                  <RefreshCw className="w-3 h-3" /> Load Summary
                </button>
                <button type="button" onClick={loadEfficiency} className="toolbar-btn">
                  <CheckCircle className="w-3 h-3" /> Efficiency Score
                </button>
                <div className="ml-auto flex items-center gap-2">
                  {/* Feature 13: Break tracking */}
                  {isOnBreak ? (
                    <button type="button" onClick={endBreak} className="toolbar-btn text-red-400 border-red-700/50">
                      <Clock className="w-3 h-3" /> End Break
                    </button>
                  ) : (
                    <div className="flex gap-1">
                      <button type="button" onClick={() => startBreak('break')} className="toolbar-btn">Break</button>
                      <button type="button" onClick={() => startBreak('meal')} className="toolbar-btn">Meal</button>
                    </div>
                  )}
                </div>
              </div>

              {/* Shift Summary Card */}
              {shiftSummary && (
                <div className="panel-beveled p-4 bg-surface-base space-y-3">
                  <h3 className="text-sm font-bold text-white mb-3">Shift Summary - {shiftSummary.date}</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-400 font-mono">{shiftSummary.scans_total}</div>
                      <div className="text-[10px] text-rmpg-400">Total Scans</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-gray-400 font-mono">{shiftSummary.scans_on_time}</div>
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
                      <div className="text-sm font-mono text-white">{shiftSummary.estimated_mileage} mi</div>
                    </div>
                    <div>
                      <span className="text-[10px] text-rmpg-400">Break Time</span>
                      <div className="text-sm font-mono text-white">{shiftSummary.total_break_minutes} min</div>
                    </div>
                    <div>
                      <span className="text-[10px] text-rmpg-400">Properties</span>
                      <div className="text-sm font-mono text-white">{shiftSummary.properties_visited?.length || 0}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Feature 15: Efficiency Score Card */}
              {efficiency && (
                <div className="panel-beveled p-4 bg-surface-base">
                  <h3 className="text-sm font-bold text-white mb-3">Patrol Efficiency</h3>
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
                        <span className="text-white font-mono">{efficiency.completion_rate}%</span>
                      </div>
                      <div className="h-2 bg-rmpg-700 rounded-full overflow-hidden">
                        <div className="h-full bg-brand-500 rounded-full" style={{ width: `${Math.min(efficiency.completion_rate, 100)}%` }} />
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-rmpg-400">On-Time Rate</span>
                        <span className="text-white font-mono">{efficiency.on_time_rate}%</span>
                      </div>
                      <div className="h-2 bg-rmpg-700 rounded-full overflow-hidden">
                        <div className="h-full bg-green-500 rounded-full" style={{ width: `${Math.min(efficiency.on_time_rate, 100)}%` }} />
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
                    className={`panel-beveled p-6 border-2 bg-surface-base ${complianceColor}`}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="text-lg font-bold text-white mb-1">
                          {item.checkpoint_name}
                        </h3>
                        <p className="text-sm text-rmpg-300">{item.property_name}</p>
                      </div>
                      <div className={`text-2xl font-bold font-mono ${complianceColor}`}>
                        {item.compliance_rate}%
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-rmpg-300">Scans Today:</span>
                        <span className="text-white font-medium font-mono">{item.scans_today}</span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-sm text-rmpg-300">Last Scan:</span>
                        <span className="text-white font-medium font-mono">
                          {formatTimeAgo(item.last_scan_time)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-sm text-rmpg-300">Interval:</span>
                        <span className="text-white font-medium font-mono">
                          {item.scan_interval_minutes} min
                        </span>
                      </div>

                      <div className="pt-3 border-t border-rmpg-700">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-rmpg-300">Next Due:</span>
                          {item.next_scan_due ? (
                            <span
                              className={`text-sm font-medium ${
                                overdue ? 'text-red-400' : 'text-green-400'
                              }`}
                            >
                              {overdue ? 'OVERDUE' : formatTimeAgo(item.next_scan_due)}
                            </span>
                          ) : (
                            <span className="text-sm text-rmpg-400">Not scanned yet</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {compliance.length === 0 && (
                <div className="col-span-3 text-center py-12 text-rmpg-300">
                  No active checkpoints found.
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Checkpoint Modal */}
      {showCheckpointModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" role="dialog" aria-modal="true" aria-labelledby={checkpointModalTitleId}>
          <div className="panel-beveled bg-surface-base p-6 max-w-md w-full mx-4">
            <h2 id={checkpointModalTitleId} className="text-xl font-bold text-white mb-4">
              {editingCheckpoint ? 'Edit Checkpoint' : 'Create Checkpoint'}
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-rmpg-200 mb-1">
                  Property: *
                </label>
                <select
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
                <label className="block text-sm font-medium text-rmpg-200 mb-1">
                  Checkpoint Name: *
                </label>
                <input
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
                <label className="block text-sm font-medium text-rmpg-200 mb-1">
                  Scan Interval (minutes): *
                </label>
                <input
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
                  <label className="block text-sm font-medium text-rmpg-200 mb-1">
                    Latitude:
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={formData.latitude}
                    onChange={(e) => setFormData(prev => ({ ...prev, latitude: e.target.value }))}
                    className="input-dark min-h-[36px]"
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-rmpg-200 mb-1">
                    Longitude:
                  </label>
                  <input
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
                onClick={() => setShowCheckpointModal(false)}
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
              <h2 id={qrModalTitleId} className="text-xl font-bold text-white">QR Code</h2>
              <IconButton
                onClick={() => setShowQrModal(false)}
                className="text-rmpg-300 hover:text-white"
                aria-label="Close"
              >
                <X className="w-6 h-6" />
              </IconButton>
            </div>

            <div className="bg-surface-sunken panel-inset p-8 text-center">
              <QrCode className="w-16 h-16 text-brand-400 mx-auto mb-4" />
              <p className="text-xs text-rmpg-300 mb-2">Scan this code with a QR scanner app:</p>
              <p className="text-2xl font-mono text-white break-all">{selectedQrCode}</p>
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
    </div>
  );
};

export default PatrolPage;
