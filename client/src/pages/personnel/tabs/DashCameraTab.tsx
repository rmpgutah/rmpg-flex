// ============================================================
// RMPG Flex — Personnel: Dash Camera Tab (Traccar GPS Integration)
// Sub-tabs: Devices | Events | Video Library
// Video Library shows locally stored dashcam footage (manual uploads
// and GPS-synced clips). Devices & Events remain read-only.
// ============================================================

import React, { useMemo, useState } from 'react';
import {
  Car, Search, Cpu, Zap, AlertTriangle, MapPin, Gauge,
  Video, Radio, Clock, RefreshCw, Loader2, Upload, Play, Trash2, Film,
} from 'lucide-react';
import type { DashcamEvent, CpgDeviceMapping, DashcamVideo } from '../../../types';
import {
  DASHCAM_EVENT_COLORS,
  DASHCAM_VIDEO_SOURCE_COLORS,
  VIDEO_CLASSIFICATION_COLORS,
} from '../utils/personnelConstants';
import PrintButton from '../../../components/PrintButton';
import ExportButton from '../../../components/ExportButton';
import RmpgLogo from '../../../components/RmpgLogo';

// ── Filters ──────────────────────────────────────────────────

const EVENT_TYPE_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'driving', label: 'Driving Behavior' },
  { value: 'hard_brake', label: 'Hard Brake' },
  { value: 'speeding', label: 'Speeding' },
  { value: 'impact', label: 'Impact' },
  { value: 'hard_accel', label: 'Hard Accel' },
  { value: 'hard_turn', label: 'Hard Turn' },
  { value: 'ignition', label: 'Ignition' },
  { value: 'position', label: 'Position' },
  { value: 'camera', label: 'Camera Events' },
];

const SOURCE_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'All Sources' },
  { value: 'manual', label: 'Manual' },
  { value: 'cpg_sync', label: 'CPG Sync' },
  { value: 'cpg_proxy', label: 'CPG Proxy' },
];

const CLASSIFICATION_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'routine', label: 'Routine' },
  { value: 'evidence', label: 'Evidence' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'restricted', label: 'Restricted' },
];

type SubTab = 'devices' | 'events' | 'videos';

// ── Props ────────────────────────────────────────────────────

interface Props {
  dashcamEvents: DashcamEvent[];
  deviceMappings: CpgDeviceMapping[];
  dashcamVideos: DashcamVideo[];
  loading?: boolean;
  onSelectOfficer?: (officerId: string) => void;
  onRefresh?: () => void;
  onPlayVideo?: (video: DashcamVideo) => void;
  onDeleteVideo?: (videoId: number) => void;
  onUploadVideo?: () => void;
  onSyncNow?: () => void;
  canManage?: boolean;
}

// ── Component ────────────────────────────────────────────────

export default function DashCameraTab({
  dashcamEvents, deviceMappings, dashcamVideos, loading = false,
  onSelectOfficer, onRefresh, onPlayVideo, onDeleteVideo,
  onUploadVideo, onSyncNow, canManage = true,
}: Props) {
  const [subTab, setSubTab] = useState<SubTab>('devices');
  const [eventTypeFilter, setEventTypeFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [classificationFilter, setClassificationFilter] = useState('all');
  const [search, setSearch] = useState('');

  // ── Stats ────────────────────────────────────────────────

  const stats = useMemo(() => {
    const totalDevices = deviceMappings.length;
    const activeDevices = deviceMappings.filter(d => d.is_active).length;
    const totalEvents = dashcamEvents.length;
    const hardBrakes = dashcamEvents.filter(e => e.event_type === 'hard_brake').length;
    const speeding = dashcamEvents.filter(e => e.event_type === 'speeding').length;
    const impacts = dashcamEvents.filter(e => e.event_type === 'impact').length;
    const videoEvents = dashcamEvents.filter(e => e.video_available).length;
    const totalVideos = dashcamVideos.length;
    return { totalDevices, activeDevices, totalEvents, hardBrakes, speeding, impacts, videoEvents, totalVideos };
  }, [dashcamEvents, deviceMappings, dashcamVideos]);

  // ── Filtered lists ───────────────────────────────────────

  const filteredDevices = useMemo(() => {
    let list = deviceMappings;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(d =>
        d.cpg_display_name?.toLowerCase().includes(q) ||
        d.cpg_serial_number?.toLowerCase().includes(q) ||
        d.call_sign?.toLowerCase().includes(q) ||
        d.officer_name?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [deviceMappings, search]);

  const filteredEvents = useMemo(() => {
    let list = dashcamEvents;
    if (eventTypeFilter !== 'all') {
      if (eventTypeFilter === 'camera') {
        list = list.filter(e =>
          e.event_type.startsWith('camera_') ||
          e.event_type.startsWith('video_')
        );
      } else if (eventTypeFilter === 'driving') {
        list = list.filter(e =>
          ['hard_brake', 'hard_accel', 'hard_turn', 'hard_cornering', 'speeding', 'impact'].includes(e.event_type)
        );
      } else if (eventTypeFilter === 'ignition') {
        list = list.filter(e =>
          e.event_type.startsWith('ignition_') || e.event_type.includes('ignition')
        );
      } else if (eventTypeFilter === 'position') {
        list = list.filter(e =>
          e.event_type === 'position_update' || e.event_type.startsWith('inmotion') ||
          e.event_type === 'stopped' || e.event_type.startsWith('idle')
        );
      } else {
        list = list.filter(e => e.event_type === eventTypeFilter);
      }
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(e =>
        e.call_sign?.toLowerCase().includes(q) ||
        e.officer_name?.toLowerCase().includes(q) ||
        e.device_name?.toLowerCase().includes(q) ||
        e.address?.toLowerCase().includes(q) ||
        e.event_type.toLowerCase().includes(q)
      );
    }
    return list;
  }, [dashcamEvents, eventTypeFilter, search]);

  const filteredVideos = useMemo(() => {
    let list = dashcamVideos;
    if (sourceFilter !== 'all') {
      list = list.filter(v => v.source === sourceFilter);
    }
    if (classificationFilter !== 'all') {
      list = list.filter(v => v.classification === classificationFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(v =>
        v.title?.toLowerCase().includes(q) ||
        v.officer_name?.toLowerCase().includes(q) ||
        v.device_name?.toLowerCase().includes(q) ||
        v.case_number?.toLowerCase().includes(q) ||
        v.address?.toLowerCase().includes(q) ||
        v.event_type?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [dashcamVideos, sourceFilter, classificationFilter, search]);

  // ── Helpers ──────────────────────────────────────────────

  function formatDateTime(dateStr?: string | null): string {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function formatDate(dateStr?: string | null): string {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  }

  function eventLabel(eventType: string): string {
    return eventType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function statusLedClass(isActive: boolean): string {
    return isActive ? 'led-dot led-green' : 'led-dot led-off';
  }

  function sourceLabel(s: string): string {
    return s === 'cpg_sync' ? 'CPG Sync' : s === 'cpg_proxy' ? 'CPG Proxy' : 'Manual';
  }

  function classLabel(cls: string): string {
    return cls.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  const formatDuration = (seconds?: number | null) => {
    if (!seconds) return '-';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const formatSize = (bytes: number) => {
    if (bytes <= 0) return '-';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  // ── Summary Cards ────────────────────────────────────────

  const SUMMARY_CARDS = [
    { label: 'Devices', value: stats.totalDevices, color: 'text-rmpg-300', bgClass: 'bg-surface-base', border: 'border-rmpg-700', topBorder: 'border-t-rmpg-500' },
    { label: 'Active', value: stats.activeDevices, color: 'text-green-400', bgClass: 'bg-[#0a1a0a]', border: 'border-green-700/30', topBorder: 'border-t-green-500' },
    { label: 'Events', value: stats.totalEvents, color: 'text-blue-400', bgClass: 'bg-[#0a0f1a]', border: 'border-blue-700/30', topBorder: 'border-t-blue-500' },
    { label: 'Hard Brakes', value: stats.hardBrakes, color: 'text-red-400', bgClass: 'bg-[#1a0a0a]', border: 'border-red-700/30', topBorder: 'border-t-red-500' },
    { label: 'Speeding', value: stats.speeding, color: 'text-amber-400', bgClass: 'bg-[#1a150a]', border: 'border-amber-700/30', topBorder: 'border-t-amber-500' },
    { label: 'Videos', value: stats.totalVideos, color: 'text-purple-400', bgClass: 'bg-[#140a1a]', border: 'border-purple-700/30', topBorder: 'border-t-purple-500' },
  ];

  // ── Render ───────────────────────────────────────────────

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Car className="w-4 h-4 text-brand-400" />
          <h2 className="text-sm font-bold text-rmpg-200 uppercase tracking-wider">Dash Cameras</h2>
          <span className="text-[8px] text-rmpg-500 font-mono uppercase bg-surface-base px-1.5 py-0.5 border border-rmpg-700">
            Traccar GPS
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <RmpgLogo height={20} iconOnly />
          <PrintButton />
          <ExportButton exportUrl="/traccar/dashcam-events/export?format=csv" exportFilename="dashcam-events.csv" />
          {canManage && onSyncNow && (
            <button onClick={onSyncNow} disabled={loading} className="toolbar-btn text-[10px] px-3 py-1.5 flex items-center gap-1.5">
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Sync Now
            </button>
          )}
          {canManage && onUploadVideo && (
            <button onClick={onUploadVideo} className="toolbar-btn toolbar-btn-primary text-[10px] px-3 py-1.5 flex items-center gap-1.5">
              <Upload className="w-3 h-3" />
              Upload Video
            </button>
          )}
          {onRefresh && (
            <button onClick={onRefresh} disabled={loading} className="toolbar-btn text-[10px] px-3 py-1.5 flex items-center gap-1.5">
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Refresh
            </button>
          )}
        </div>
      </div>

      {/* ── Alert Banner — Impacts ── */}
      {stats.impacts > 0 && (
        <div className="panel-beveled p-3 flex items-center gap-3 border border-red-700/40 border-l-2 border-l-red-500 bg-[#1a0a0a]">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <span className="text-xs text-red-400 font-semibold">
            {stats.impacts} impact event{stats.impacts !== 1 ? 's' : ''} detected — review immediately
          </span>
        </div>
      )}

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-6 gap-2">
        {SUMMARY_CARDS.map(card => (
          <div
            key={card.label}
            className={`panel-beveled p-2.5 text-center border border-t-2 ${card.border} ${card.bgClass} ${card.topBorder}`}
          >
            <div className={`text-sm font-bold font-mono ${card.color}`}>{card.value}</div>
            <div className="text-[7px] text-rmpg-500 uppercase">{card.label}</div>
          </div>
        ))}
      </div>

      {/* ── Sub-Tabs (Devices / Events / Videos) ── */}
      <div className="flex items-center gap-0 border-b border-rmpg-700">
        <button
          onClick={() => setSubTab('devices')}
          className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-4 py-2 border-b-2 transition-colors ${
            subTab === 'devices'
              ? 'text-brand-400 border-brand-500'
              : 'text-rmpg-500 border-transparent hover:text-rmpg-300'
          }`}
        >
          <Cpu className="w-3 h-3" />
          Devices ({deviceMappings.length})
        </button>
        <button
          onClick={() => setSubTab('events')}
          className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-4 py-2 border-b-2 transition-colors ${
            subTab === 'events'
              ? 'text-amber-400 border-amber-500'
              : 'text-rmpg-500 border-transparent hover:text-rmpg-300'
          }`}
        >
          <Zap className="w-3 h-3" />
          Events ({dashcamEvents.length})
          {stats.impacts > 0 && (
            <span className="ml-1 px-1.5 py-0.5 bg-red-900/60 text-red-400 text-[8px] font-bold border border-red-700/50">
              {stats.impacts} IMPACT
            </span>
          )}
        </button>
        <button
          onClick={() => setSubTab('videos')}
          className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-4 py-2 border-b-2 transition-colors ${
            subTab === 'videos'
              ? 'text-purple-400 border-purple-500'
              : 'text-rmpg-500 border-transparent hover:text-rmpg-300'
          }`}
        >
          <Film className="w-3 h-3" />
          Video Library ({dashcamVideos.length})
        </button>
      </div>

      {/* ── Search + Filters ── */}
      <div className="panel-inset p-2 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-[280px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={
              subTab === 'devices' ? 'Search devices, units...' :
              subTab === 'events' ? 'Search events, call signs...' :
              'Search videos, officers, cases...'
            }
            className="input-dark text-[10px] pl-7 pr-2 py-1 w-full"
          />
        </div>
        {subTab === 'events' && (
          <>
            <div className="h-4 w-px bg-rmpg-700" />
            {EVENT_TYPE_FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setEventTypeFilter(f.value)}
                className={`text-[10px] px-2.5 py-1 ${
                  eventTypeFilter === f.value ? 'toolbar-btn-primary' : 'toolbar-btn'
                }`}
              >
                {f.label}
              </button>
            ))}
          </>
        )}
        {subTab === 'videos' && (
          <>
            <div className="h-4 w-px bg-rmpg-700" />
            {SOURCE_FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setSourceFilter(f.value)}
                className={`text-[10px] px-2.5 py-1 ${
                  sourceFilter === f.value ? 'toolbar-btn-primary' : 'toolbar-btn'
                }`}
              >
                {f.label}
              </button>
            ))}
            <div className="h-4 w-px bg-rmpg-700" />
            {CLASSIFICATION_FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setClassificationFilter(f.value)}
                className={`text-[10px] px-2.5 py-1 ${
                  classificationFilter === f.value ? 'toolbar-btn-primary' : 'toolbar-btn'
                }`}
              >
                {f.label}
              </button>
            ))}
          </>
        )}
      </div>

      {/* ── Loading overlay ── */}
      {loading && (
        <div className="flex items-center justify-center py-8 gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-brand-400" />
          <span className="text-[10px] text-rmpg-400">Loading GPS tracking data...</span>
        </div>
      )}

      {/* ── Device Table ── */}
      {!loading && subTab === 'devices' && (
        <div className="panel-beveled overflow-x-auto bg-surface-sunken">
          <table className="table-dark w-full">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="text-left">Device Name</th>
                <th className="text-left">Serial</th>
                <th className="text-left">Call Sign</th>
                <th className="text-left">Officer</th>
                <th className="text-left">Last Synced</th>
                <th className="text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredDevices.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8">
                    <div className="w-12 h-12 mx-auto mb-2 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-base">
                      <Cpu className="w-6 h-6 text-rmpg-600" />
                    </div>
                    <p className="text-[10px] text-rmpg-500">No GPS tracking devices mapped.</p>
                    <p className="text-[9px] text-rmpg-600 mt-0.5">Devices are auto-discovered when Traccar GPS credentials are configured.</p>
                  </td>
                </tr>
              ) : (
                filteredDevices.map(dev => (
                  <tr
                    key={dev.id}
                    className="cursor-pointer hover:bg-surface-hover"
                    onClick={() => {
                      if (dev.officer_id && onSelectOfficer) {
                        onSelectOfficer(String(dev.officer_id));
                      }
                    }}
                  >
                    <td>
                      <div className="flex items-center gap-1.5">
                        <Car className="w-3 h-3 text-brand-400 flex-shrink-0" />
                        <span className="text-xs font-semibold text-rmpg-200">{dev.cpg_display_name}</span>
                      </div>
                    </td>
                    <td>
                      <span className="text-xs font-mono text-rmpg-400">{dev.cpg_serial_number || '-'}</span>
                    </td>
                    <td>
                      <span className="text-xs font-mono text-brand-400 font-semibold">{dev.call_sign || '-'}</span>
                    </td>
                    <td>
                      <span className="text-xs text-rmpg-200">{dev.officer_name || '-'}</span>
                    </td>
                    <td>
                      <span className="text-xs font-mono text-rmpg-400">{formatDate(dev.last_synced_at)}</span>
                    </td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <span className={statusLedClass(dev.is_active)} />
                        <span className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold ${
                          dev.is_active
                            ? 'bg-green-900/50 text-green-400 border border-green-700/50'
                            : 'bg-rmpg-700 text-rmpg-400 border border-rmpg-600'
                        }`}>
                          {dev.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Events Table ── */}
      {!loading && subTab === 'events' && (
        <>
          {/* Event Stat Bar */}
          <div className="flex items-center gap-4 text-[10px] text-rmpg-400">
            <span className="flex items-center gap-1">
              <Zap className="w-3 h-3" />
              Total: <span className="font-mono text-rmpg-200">{filteredEvents.length}</span>
            </span>
            <span className="flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 text-red-400" />
              Hard Brakes: <span className="font-mono text-red-300">{stats.hardBrakes}</span>
            </span>
            <span className="flex items-center gap-1">
              <Gauge className="w-3 h-3 text-amber-400" />
              Speeding: <span className="font-mono text-amber-300">{stats.speeding}</span>
            </span>
            <span className="flex items-center gap-1">
              <Video className="w-3 h-3 text-purple-400" />
              Video Clips: <span className="font-mono text-purple-300">{stats.videoEvents}</span>
            </span>
          </div>

          <div className="panel-beveled overflow-x-auto bg-surface-sunken">
            <table className="table-dark w-full">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="text-left">Timestamp</th>
                  <th className="text-left">Event Type</th>
                  <th className="text-left">Call Sign</th>
                  <th className="text-left">Device</th>
                  <th className="text-right">Speed</th>
                  <th className="text-left">Address</th>
                  <th className="text-left">Coordinates</th>
                  <th className="text-center">Video</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8">
                      <div className="w-12 h-12 mx-auto mb-2 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-base">
                        <Zap className="w-6 h-6 text-rmpg-600" />
                      </div>
                      <p className="text-[10px] text-rmpg-500">No dashcam events recorded.</p>
                      <p className="text-[9px] text-rmpg-600 mt-0.5">Events are automatically synced from Traccar GPS.</p>
                    </td>
                  </tr>
                ) : (
                  filteredEvents.map(evt => {
                    // Check if this event has a linked video record
                    const linkedVideo = dashcamVideos.find(v => v.cpg_event_id === evt.id);
                    return (
                      <tr
                        key={evt.id}
                        className={`hover:bg-surface-hover ${
                          evt.event_type === 'impact' ? 'bg-red-900/10' :
                          evt.event_type === 'speeding' ? 'bg-amber-900/5' : ''
                        }`}
                      >
                        <td>
                          <span className="text-xs font-mono text-rmpg-300 flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5 text-rmpg-500" />
                            {formatDateTime(evt.event_timestamp)}
                          </span>
                        </td>
                        <td>
                          <span className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold ${
                            DASHCAM_EVENT_COLORS[evt.event_type] || 'bg-rmpg-700 text-rmpg-300 border border-rmpg-600'
                          }`}>
                            {eventLabel(evt.event_type)}
                          </span>
                        </td>
                        <td>
                          <span className="text-xs font-mono text-brand-400 font-semibold">{evt.call_sign || '-'}</span>
                        </td>
                        <td>
                          <span className="text-xs text-rmpg-400">{evt.device_name || '-'}</span>
                        </td>
                        <td className="text-right">
                          {evt.speed_mph != null ? (
                            <span className={`text-xs font-mono font-bold ${
                              evt.speed_mph > 80 ? 'text-red-400' :
                              evt.speed_mph > 60 ? 'text-amber-400' :
                              'text-rmpg-300'
                            }`}>
                              {evt.speed_mph} mph
                            </span>
                          ) : (
                            <span className="text-xs text-rmpg-600">-</span>
                          )}
                        </td>
                        <td>
                          <span className="text-xs text-rmpg-300 max-w-[200px] truncate block" title={evt.address || undefined}>
                            {evt.address || '-'}
                          </span>
                        </td>
                        <td>
                          {evt.latitude != null && evt.longitude != null ? (
                            <span className="text-[9px] font-mono text-rmpg-500 flex items-center gap-1">
                              <MapPin className="w-2.5 h-2.5" />
                              {evt.latitude.toFixed(4)}, {evt.longitude.toFixed(4)}
                            </span>
                          ) : (
                            <span className="text-xs text-rmpg-600">-</span>
                          )}
                        </td>
                        <td className="text-center">
                          {linkedVideo && onPlayVideo ? (
                            <button
                              onClick={() => onPlayVideo(linkedVideo)}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-green-900/50 text-green-400 border border-green-700/50 text-[9px] font-bold hover:bg-green-800/50 transition-colors"
                              title="Play linked video"
                            >
                              <Play className="w-2.5 h-2.5" />
                              PLAY
                            </button>
                          ) : evt.video_available ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-purple-900/50 text-purple-400 border border-purple-700/50 text-[9px] font-bold" title="Video clip available — use Sync Now to pull">
                              <Video className="w-2.5 h-2.5" />
                              CLIP
                            </span>
                          ) : (
                            <span className="text-rmpg-600 text-[9px]">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Video Library Table ── */}
      {!loading && subTab === 'videos' && (
        <>
          {/* Video Stat Bar */}
          <div className="flex items-center gap-4 text-[10px] text-rmpg-400">
            <span className="flex items-center gap-1">
              <Film className="w-3 h-3 text-purple-400" />
              Total: <span className="font-mono text-rmpg-200">{filteredVideos.length}</span>
            </span>
            <span className="flex items-center gap-1">
              Manual: <span className="font-mono text-blue-300">{dashcamVideos.filter(v => v.source === 'manual').length}</span>
            </span>
            <span className="flex items-center gap-1">
              CPG Sync: <span className="font-mono text-green-300">{dashcamVideos.filter(v => v.source === 'cpg_sync').length}</span>
            </span>
            <span className="flex items-center gap-1">
              Evidence: <span className="font-mono text-amber-300">{dashcamVideos.filter(v => v.classification === 'evidence').length}</span>
            </span>
          </div>

          <div className="panel-beveled overflow-x-auto bg-surface-sunken">
            <table className="table-dark w-full">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="text-left">Title</th>
                  <th className="text-left">Source</th>
                  <th className="text-left">Officer</th>
                  <th className="text-left">Device</th>
                  <th className="text-left">Event Type</th>
                  <th className="text-right">Duration</th>
                  <th className="text-right">Size</th>
                  <th className="text-left">Recorded</th>
                  <th className="text-left">Classification</th>
                  <th className="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredVideos.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center py-8">
                      <div className="w-12 h-12 mx-auto mb-2 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-base">
                        <Film className="w-6 h-6 text-rmpg-600" />
                      </div>
                      <p className="text-[10px] text-rmpg-500">No dash camera videos.</p>
                      <p className="text-[9px] text-rmpg-600 mt-0.5">Upload footage or use Sync Now to import video clips.</p>
                    </td>
                  </tr>
                ) : (
                  filteredVideos.map(vid => (
                    <tr key={vid.id} className="hover:bg-surface-hover">
                      <td>
                        <div className="flex items-center gap-1.5">
                          <Car className="w-3 h-3 text-brand-400 flex-shrink-0" />
                          <span className="text-xs font-semibold text-rmpg-200 max-w-[180px] truncate" title={vid.title}>
                            {vid.title}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold ${
                          DASHCAM_VIDEO_SOURCE_COLORS[vid.source] || 'bg-rmpg-700 text-rmpg-300'
                        }`}>
                          {sourceLabel(vid.source)}
                        </span>
                      </td>
                      <td>
                        <span className="text-xs text-rmpg-200">{vid.officer_name || '-'}</span>
                      </td>
                      <td>
                        <span className="text-xs text-rmpg-400">{vid.device_name || '-'}</span>
                      </td>
                      <td>
                        {vid.event_type ? (
                          <span className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold ${
                            DASHCAM_EVENT_COLORS[vid.event_type] || 'bg-rmpg-700 text-rmpg-300 border border-rmpg-600'
                          }`}>
                            {eventLabel(vid.event_type)}
                          </span>
                        ) : (
                          <span className="text-xs text-rmpg-600">-</span>
                        )}
                      </td>
                      <td className="text-right">
                        <span className="text-xs font-mono text-rmpg-300">{formatDuration(vid.duration_seconds)}</span>
                      </td>
                      <td className="text-right">
                        <span className="text-xs font-mono text-rmpg-400">{formatSize(vid.file_size)}</span>
                      </td>
                      <td>
                        <span className="text-xs font-mono text-rmpg-300">{formatDateTime(vid.recorded_at)}</span>
                      </td>
                      <td>
                        <span className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold ${
                          VIDEO_CLASSIFICATION_COLORS[vid.classification] || 'bg-rmpg-700 text-rmpg-300'
                        }`}>
                          {classLabel(vid.classification)}
                        </span>
                      </td>
                      <td className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          {onPlayVideo && (
                            <button
                              onClick={() => onPlayVideo(vid)}
                              className="toolbar-btn p-1"
                              title="Play video"
                            >
                              <Play className="w-3 h-3 text-green-400" />
                            </button>
                          )}
                          {canManage && onDeleteVideo && (
                            <button
                              onClick={() => onDeleteVideo(vid.id)}
                              className="toolbar-btn p-1"
                              title="Delete video"
                            >
                              <Trash2 className="w-3 h-3 text-red-400" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
