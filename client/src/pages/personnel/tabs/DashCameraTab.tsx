// ============================================================
// RMPG Flex — Personnel: Dash Camera Tab (ClearPathGPS Integration)
// Read-only tab displaying dashcam devices and events synced
// from ClearPathGPS. Sub-tabs: Devices | Events.
// ============================================================

import React, { useEffect, useMemo, useState } from 'react';
import {
  Car, Search, Cpu, Zap, AlertTriangle, MapPin, Gauge,
  Video, Radio, Clock, RefreshCw, ExternalLink, Loader2,
} from 'lucide-react';
import type { DashcamEvent, CpgDeviceMapping } from '../../../types';
import { DASHCAM_EVENT_COLORS } from '../utils/personnelConstants';
import PrintButton from '../../../components/PrintButton';
import ExportButton from '../../../components/ExportButton';
import RmpgLogo from '../../../components/RmpgLogo';

// ── Filters ──────────────────────────────────────────────────

const EVENT_TYPE_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'hard_brake', label: 'Hard Brake' },
  { value: 'speeding', label: 'Speeding' },
  { value: 'impact', label: 'Impact' },
  { value: 'hard_accel', label: 'Hard Accel' },
  { value: 'hard_turn', label: 'Hard Turn' },
  { value: 'camera', label: 'Camera Events' },
];

type SubTab = 'devices' | 'events';

// ── Props ────────────────────────────────────────────────────

interface Props {
  dashcamEvents: DashcamEvent[];
  deviceMappings: CpgDeviceMapping[];
  loading?: boolean;
  onSelectOfficer?: (officerId: string) => void;
  onRefresh?: () => void;
}

// ── Component ────────────────────────────────────────────────

const timeAgo = (date: string): string => {
  if (!date) return '—';
  const parsed = new Date(date).getTime();
  if (Number.isNaN(parsed)) return '—';
  const ms = Date.now() - parsed;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

export default function DashCameraTab({
  dashcamEvents, deviceMappings, loading = false,
  onSelectOfficer, onRefresh,
}: Props) {
  const [subTab, setSubTab] = useState<SubTab>('devices');
  const [eventTypeFilter, setEventTypeFilter] = useState('all');
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
    return { totalDevices, activeDevices, totalEvents, hardBrakes, speeding, impacts, videoEvents };
  }, [dashcamEvents, deviceMappings]);

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

  // ── Helpers ──────────────────────────────────────────────

  function formatDateTime(dateStr?: string): string {
    if (!dateStr) return '-';
    return new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00').toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function formatDate(dateStr?: string | null): string {
    if (!dateStr) return '-';
    return new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00').toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  }

  function eventLabel(eventType: string): string {
    return eventType.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
  }

  function statusLedClass(isActive: boolean): string {
    return isActive ? 'led-dot led-green' : 'led-dot led-off';
  }

  // ── Summary Cards ────────────────────────────────────────

  const SUMMARY_CARDS = [
    { label: 'Devices', value: stats.totalDevices, color: 'text-rmpg-300', bgClass: 'bg-surface-base', border: 'border-rmpg-700', topBorder: 'border-t-rmpg-500' },
    { label: 'Active', value: stats.activeDevices, color: 'text-green-400', bgClass: 'bg-[#0a1a0a]', border: 'border-green-700/30', topBorder: 'border-t-green-500' },
    { label: 'Events', value: stats.totalEvents, color: 'text-blue-400', bgClass: 'bg-[#0a0f1a]', border: 'border-blue-700/30', topBorder: 'border-t-blue-500' },
    { label: 'Hard Brakes', value: stats.hardBrakes, color: 'text-red-400', bgClass: 'bg-[#1a0a0a]', border: 'border-red-700/30', topBorder: 'border-t-red-500' },
    { label: 'Speeding', value: stats.speeding, color: 'text-amber-400', bgClass: 'bg-[#1a150a]', border: 'border-amber-700/30', topBorder: 'border-t-amber-500' },
    { label: 'Video Clips', value: stats.videoEvents, color: 'text-purple-400', bgClass: 'bg-[#140a1a]', border: 'border-purple-700/30', topBorder: 'border-t-purple-500' },
  ];

  // ── Render ───────────────────────────────────────────────

  // Set document title
  useEffect(() => { document.title = 'Personnel - Dash Cameras \u2014 RMPG Flex'; }, []);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Car className="w-4 h-4 text-brand-400" />
          <h2 className="text-sm font-bold text-rmpg-200 uppercase tracking-wider">Dash Cameras</h2>
          <span className="text-[8px] text-rmpg-500 font-mono uppercase bg-surface-base px-1.5 py-0.5 border border-rmpg-700">
            ClearPathGPS
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <RmpgLogo height={20} iconOnly />
          <PrintButton />
          <ExportButton exportUrl="/clearpathgps/dashcam-events/export?format=csv" exportFilename="dashcam-events.csv" />
          {onRefresh && (
            <button type="button" onClick={onRefresh} disabled={loading} className="toolbar-btn text-[10px] px-3 py-1.5 flex items-center gap-1.5">
              {loading ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <RefreshCw className="w-3 h-3" />}
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
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
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

      {/* ── Sub-Tabs (Devices / Events) ── */}
      <div className="flex items-center gap-0 border-b border-rmpg-700">
        <button type="button"
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
        <button type="button"
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
      </div>

      {/* ── Search + Filters ── */}
      <div className="panel-inset p-2 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-[280px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={subTab === 'devices' ? 'Search devices, units...' : 'Search events, call signs...'}
            className="input-dark text-[10px] pl-7 pr-2 py-1 w-full min-h-[36px]"
          />
        </div>
        {subTab === 'events' && (
          <>
            <div className="h-4 w-px bg-rmpg-700" />
            {EVENT_TYPE_FILTERS.map(f => (
              <button type="button"
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
      </div>

      {/* ── Loading overlay ── */}
      {loading && (
        <div className="flex items-center justify-center py-8 gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-brand-400" role="status" aria-label="Loading" />
          <span className="text-[10px] text-rmpg-400">Loading ClearPathGPS data...</span>
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
                    <p className="text-[10px] text-rmpg-500">No ClearPathGPS devices mapped.</p>
                    <p className="text-[9px] text-rmpg-600 mt-0.5">Devices are auto-discovered when ClearPathGPS credentials are configured.</p>
                  </td>
                </tr>
              ) : (
                filteredDevices.map(dev => (
                  <tr
                    key={dev.id}
                    className="cursor-pointer hover:bg-surface-hover"
                    onClick={() => {
                      // Find the officer for this unit — if available in mappings
                      if (dev.officer_name && onSelectOfficer) {
                        // We don't have officer_id on mappings, so use unit lookup
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
                      <p className="text-[9px] text-rmpg-600 mt-0.5">Events are automatically synced from ClearPathGPS.</p>
                    </td>
                  </tr>
                ) : (
                  filteredEvents.map(evt => (
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
                        {evt.video_available ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-purple-900/50 text-purple-400 border border-purple-700/50 text-[9px] font-bold" title="Video clip available in ClearPathGPS portal">
                            <Video className="w-2.5 h-2.5" />
                            CLIP
                          </span>
                        ) : (
                          <span className="text-rmpg-600 text-[9px]">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Video portal note */}
          {stats.videoEvents > 0 && (
            <div className="panel-beveled p-2.5 flex items-center gap-2 border border-purple-700/30 bg-purple-900/5">
              <ExternalLink className="w-3 h-3 text-purple-400 flex-shrink-0" />
              <span className="text-[10px] text-rmpg-400">
                Video clips are available for download in the{' '}
                <span className="text-purple-400 font-semibold">ClearPathGPS portal</span>.
                {' '}Events marked "CLIP" have associated video footage.
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
