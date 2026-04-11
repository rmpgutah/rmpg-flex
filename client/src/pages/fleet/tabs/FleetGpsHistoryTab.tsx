import React, { useState, useEffect, useCallback } from 'react';
import {
  MapPin, Clock, Navigation2, Gauge, Zap, AlertTriangle,
  Car, Radio, RefreshCw, Loader2,
} from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';

interface Breadcrumb {
  id: number;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  unit_status: string | null;
  call_sign: string | null;
  officer_name: string | null;
  current_call_number: string | null;
  current_call_type: string | null;
  recorded_at: string;
  road_name: string | null;
  nearest_intersection: string | null;
  gps_source: string | null;
  odometer: number | null;
  ignition: number | null;
}

interface DashcamEvent {
  id: number;
  event_type: string;
  event_timestamp: string;
  latitude: number | null;
  longitude: number | null;
  speed_mph: number | null;
  address: string | null;
  status_code_text: string | null;
  video_available: number;
  odometer: number | null;
  driver_name: string | null;
  city: string | null;
  state_province: string | null;
}

interface Props {
  vehicleId: string;
}

const EVENT_TYPE_COLORS: Record<string, string> = {
  hard_brake: '#ef4444',
  hard_accel: '#f59e0b',
  hard_turn: '#f97316',
  speeding: '#dc2626',
  impact: '#dc2626',
  video_start: '#3b82f6',
  video_stop: '#6b7280',
  panic: '#dc2626',
  sos: '#dc2626',
  camera_motion: '#8b5cf6',
};

const EVENT_TYPE_ICONS: Record<string, React.ReactNode> = {
  hard_brake: <AlertTriangle style={{ width: 10, height: 10 }} />,
  speeding: <Gauge style={{ width: 10, height: 10 }} />,
  impact: <Zap style={{ width: 10, height: 10 }} />,
};

type SubTab = 'breadcrumbs' | 'events';

export default function FleetGpsHistoryTab({ vehicleId }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('breadcrumbs');
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [events, setEvents] = useState<DashcamEvent[]>([]);
  const [unitId, setUnitId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<any>(`/fleet/${vehicleId}/gps-history?days=${days}&limit=1000`);
      setBreadcrumbs(data.breadcrumbs || []);
      setEvents(data.dashcam_events || []);
      setUnitId(data.unit_id);
      setMessage(data.message || null);
    } catch (err) {
      console.error('Failed to fetch GPS history:', err);
      setMessage('Failed to load GPS history');
    } finally {
      setLoading(false);
    }
  }, [vehicleId, days]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const formatTime = (dt: string) => {
    const d = new Date(dt);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  const formatDate = (dt: string) => {
    const d = new Date(dt);
    return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' });
  };

  if (!unitId && !loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Car className="w-8 h-8 text-rmpg-500 mb-3" />
        <p className="text-[11px] text-rmpg-400 font-bold uppercase">Not Assigned to a Unit</p>
        <p className="text-[10px] text-rmpg-500 mt-1">Assign this vehicle to a unit to see GPS history</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Controls bar */}
      <div className="flex items-center gap-2 px-3 py-2 panel-inset" style={{ background: '#0a0a0a' }}>
        <div className="flex gap-0.5">
          {(['breadcrumbs', 'events'] as const).map(t => (
            <button
              key={t}
              onClick={() => setSubTab(t)}
              className={subTab === t ? 'toolbar-btn toolbar-btn-primary' : 'toolbar-btn'}
            >
              {t === 'breadcrumbs' ? <Navigation2 style={{ width: 10, height: 10 }} /> : <Zap style={{ width: 10, height: 10 }} />}
              <span>{t === 'breadcrumbs' ? `GPS (${breadcrumbs.length})` : `Events (${events.length})`}</span>
            </button>
          ))}
        </div>
        <div className="toolbar-separator" />
        <div className="flex gap-0.5">
          {[1, 3, 7, 14, 30].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={days === d ? 'toolbar-btn toolbar-btn-primary' : 'toolbar-btn'}
            >
              {d}d
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button onClick={fetchData} className="toolbar-btn" disabled={loading}>
          {loading ? <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" /> : <RefreshCw style={{ width: 10, height: 10 }} />}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 text-rmpg-400 animate-spin" />
          </div>
        ) : subTab === 'breadcrumbs' ? (
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-rmpg-400 uppercase text-left" style={{ background: '#0a0a0a' }}>
                <th className="px-2 py-1.5 font-bold">Time</th>
                <th className="px-2 py-1.5 font-bold">Location</th>
                <th className="px-2 py-1.5 font-bold">Speed</th>
                <th className="px-2 py-1.5 font-bold">Status</th>
                <th className="px-2 py-1.5 font-bold">Source</th>
              </tr>
            </thead>
            <tbody>
              {breadcrumbs.map(bc => (
                <tr key={bc.id} className="border-b border-rmpg-800/50 hover:bg-rmpg-800/30">
                  <td className="px-2 py-1 text-rmpg-300 font-mono whitespace-nowrap">
                    <div>{formatTime(bc.recorded_at)}</div>
                    <div className="text-[8px] text-rmpg-500">{formatDate(bc.recorded_at)}</div>
                  </td>
                  <td className="px-2 py-1 text-rmpg-200">
                    {bc.road_name || `${bc.latitude.toFixed(4)}, ${bc.longitude.toFixed(4)}`}
                    {bc.nearest_intersection && <div className="text-[8px] text-rmpg-500">x {bc.nearest_intersection}</div>}
                  </td>
                  <td className="px-2 py-1 text-rmpg-200 font-mono">
                    {bc.speed != null ? `${Math.round(bc.speed)} mph` : '-'}
                  </td>
                  <td className="px-2 py-1">
                    <span className="text-[8px] font-bold uppercase px-1 py-0.5" style={{
                      color: bc.unit_status === 'available' ? '#22c55e' : bc.unit_status === 'enroute' ? '#3b82f6' : '#a0a0a0',
                    }}>
                      {bc.unit_status || '-'}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-[8px] text-rmpg-500 uppercase">{bc.gps_source || 'browser'}</td>
                </tr>
              ))}
              {breadcrumbs.length === 0 && (
                <tr><td colSpan={5} className="py-8 text-center text-rmpg-500">No GPS breadcrumbs in the last {days} days</td></tr>
              )}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-rmpg-400 uppercase text-left" style={{ background: '#0a0a0a' }}>
                <th className="px-2 py-1.5 font-bold">Time</th>
                <th className="px-2 py-1.5 font-bold">Event</th>
                <th className="px-2 py-1.5 font-bold">Location</th>
                <th className="px-2 py-1.5 font-bold">Speed</th>
                <th className="px-2 py-1.5 font-bold">Driver</th>
              </tr>
            </thead>
            <tbody>
              {events.map(ev => {
                const color = EVENT_TYPE_COLORS[ev.event_type] || '#6b7280';
                const icon = EVENT_TYPE_ICONS[ev.event_type] || <Radio style={{ width: 10, height: 10 }} />;
                return (
                  <tr key={ev.id} className="border-b border-rmpg-800/50 hover:bg-rmpg-800/30">
                    <td className="px-2 py-1 text-rmpg-300 font-mono whitespace-nowrap">
                      <div>{formatTime(ev.event_timestamp)}</div>
                      <div className="text-[8px] text-rmpg-500">{formatDate(ev.event_timestamp)}</div>
                    </td>
                    <td className="px-2 py-1">
                      <span className="flex items-center gap-1 text-[9px] font-bold uppercase px-1.5 py-0.5" style={{ color, background: color + '15', border: `1px solid ${color}30` }}>
                        {icon}
                        {ev.event_type.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-rmpg-200 text-[9px]">
                      {ev.address || (ev.city ? `${ev.city}, ${ev.state_province}` : '-')}
                    </td>
                    <td className="px-2 py-1 text-rmpg-200 font-mono">
                      {ev.speed_mph != null ? `${Math.round(ev.speed_mph)} mph` : '-'}
                    </td>
                    <td className="px-2 py-1 text-rmpg-300 text-[9px]">{ev.driver_name || '-'}</td>
                  </tr>
                );
              })}
              {events.length === 0 && (
                <tr><td colSpan={5} className="py-8 text-center text-rmpg-500">No dashcam events in the last {days} days</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
