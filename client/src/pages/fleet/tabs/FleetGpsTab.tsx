// ============================================================
// RMPG Flex — Fleet Detail: GPS Tab (ClearPathGPS data)
// Shows last location, trip history, and alerts for the vehicle
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import { MapPin, Navigation, AlertTriangle, Loader2, Clock, Route, Gauge, Zap } from 'lucide-react';
import type { CpgpsVehicle, CpgpsTrip, CpgpsAlert } from '../../../types';
import { apiFetch } from '../../../hooks/useApi';
import { parseTimestamp } from '../../../utils/dateUtils';

interface Props {
  vehicleId: string | number;
}

type SubTab = 'location' | 'trips' | 'alerts';

export default function FleetGpsTab({ vehicleId }: Props) {
  const [gpsVehicle, setGpsVehicle] = useState<CpgpsVehicle | null>(null);
  const [trips, setTrips] = useState<CpgpsTrip[]>([]);
  const [alerts, setAlerts] = useState<CpgpsAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [notLinked, setNotLinked] = useState(false);
  const [subTab, setSubTab] = useState<SubTab>('location');

  const fetchData = useCallback(async () => {
    try {
      const vehicles = await apiFetch<CpgpsVehicle[]>('/clearpathgps/vehicles');
      const linked = (Array.isArray(vehicles) ? vehicles : []).find(v => String(v.vehicle_id) === String(vehicleId));
      if (!linked) {
        setNotLinked(true);
        setLoading(false);
        return;
      }
      setGpsVehicle(linked);

      const [tripData, alertData] = await Promise.all([
        apiFetch<CpgpsTrip[]>(`/clearpathgps/vehicles/${linked.id}/trips`).catch(() => []),
        apiFetch<CpgpsAlert[]>(`/clearpathgps/vehicles/${linked.id}/alerts`).catch(() => []),
      ]);
      setTrips(Array.isArray(tripData) ? tripData : []);
      setAlerts(Array.isArray(alertData) ? alertData : []);
    } catch {
      setNotLinked(true);
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 text-brand-400 animate-spin" />
      </div>
    );
  }

  if (notLinked) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-rmpg-500">
        <MapPin className="w-8 h-8 mb-2" />
        <p className="text-xs">No ClearPathGPS device linked to this vehicle</p>
        <p className="text-[9px] mt-1 text-rmpg-600">Link a GPS device in Admin &rarr; Integrations &rarr; ClearPathGPS</p>
      </div>
    );
  }

  const formatDate = (d?: string) => {
    if (!d) return '-';
    return parseTimestamp(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '-';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  const SUB_TABS: { key: SubTab; label: string; icon: React.ComponentType<{ className?: string }>; count?: number }[] = [
    { key: 'location', label: 'Location', icon: MapPin },
    { key: 'trips', label: 'Trips', icon: Route, count: trips.length },
    { key: 'alerts', label: 'Alerts', icon: AlertTriangle, count: alerts.length },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Sub-tab bar */}
      <div className="flex items-center border-b border-rmpg-700 px-2 bg-surface-base">
        {SUB_TABS.map(({ key, label, icon: Icon, count }) => (
          <button
            key={key}
            className={`flex items-center gap-1 px-3 py-1.5 text-[9px] uppercase font-bold tracking-wider border-b-2 transition-colors ${
              subTab === key ? 'text-white border-brand-500' : 'text-rmpg-400 border-transparent hover:text-rmpg-200'
            }`}
            onClick={() => setSubTab(key)}
          >
            <Icon className={`w-3 h-3 ${subTab === key ? 'text-brand-400' : ''}`} />
            {label}
            {count !== undefined && <span className="text-[8px] text-rmpg-500 ml-0.5">({count})</span>}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Location Sub-Tab */}
        {subTab === 'location' && gpsVehicle && (
          <div className="space-y-4">
            {/* Last Known Location */}
            <div className="panel-inset p-4">
              <h4 className="text-[10px] font-bold uppercase text-rmpg-400 tracking-wider mb-3">Last Known Position</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="field-label flex items-center gap-1"><MapPin className="w-2.5 h-2.5" /> Coordinates</p>
                  <p className="text-xs text-rmpg-100 font-mono">
                    {gpsVehicle.last_lat != null && gpsVehicle.last_lon != null
                      ? `${Number(gpsVehicle.last_lat).toFixed(6)}, ${Number(gpsVehicle.last_lon).toFixed(6)}`
                      : 'No data'}
                  </p>
                </div>
                <div>
                  <p className="field-label flex items-center gap-1"><Gauge className="w-2.5 h-2.5" /> Speed</p>
                  <p className="text-xs text-rmpg-100 font-mono">
                    {gpsVehicle.last_speed != null ? `${gpsVehicle.last_speed} mph` : '-'}
                  </p>
                </div>
                <div>
                  <p className="field-label flex items-center gap-1"><Navigation className="w-2.5 h-2.5" /> Heading</p>
                  <p className="text-xs text-rmpg-100 font-mono">
                    {gpsVehicle.last_heading != null ? `${gpsVehicle.last_heading}°` : '-'}
                  </p>
                </div>
                <div>
                  <p className="field-label flex items-center gap-1"><Clock className="w-2.5 h-2.5" /> Last Report</p>
                  <p className="text-xs text-rmpg-100 font-mono">{formatDate(gpsVehicle.last_reported_at)}</p>
                </div>
              </div>
            </div>

            {/* Vehicle Info from GPS */}
            <div className="panel-inset p-4">
              <h4 className="text-[10px] font-bold uppercase text-rmpg-400 tracking-wider mb-3">GPS Device</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="field-label">Device Name</p>
                  <p className="text-xs text-rmpg-100">{gpsVehicle.name || '-'}</p>
                </div>
                <div>
                  <p className="field-label">Device Serial</p>
                  <p className="text-xs text-rmpg-100 font-mono">{gpsVehicle.device_serial || '-'}</p>
                </div>
                <div>
                  <p className="field-label">VIN</p>
                  <p className="text-xs text-rmpg-100 font-mono">{gpsVehicle.vin || '-'}</p>
                </div>
                <div>
                  <p className="field-label">Odometer</p>
                  <p className="text-xs text-rmpg-100 font-mono">
                    {gpsVehicle.odometer != null ? `${Number(gpsVehicle.odometer).toLocaleString()} mi` : '-'}
                  </p>
                </div>
                <div>
                  <p className="field-label">Engine Hours</p>
                  <p className="text-xs text-rmpg-100 font-mono">
                    {gpsVehicle.engine_hours != null ? `${Number(gpsVehicle.engine_hours).toLocaleString()} hrs` : '-'}
                  </p>
                </div>
                <div>
                  <p className="field-label">Last Sync</p>
                  <p className="text-xs text-rmpg-100 font-mono">{formatDate(gpsVehicle.synced_at)}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Trips Sub-Tab */}
        {subTab === 'trips' && (
          <div>
            {trips.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-rmpg-500">
                <Route className="w-6 h-6 mb-2" />
                <p className="text-xs">No trip data available</p>
              </div>
            ) : (
              <div className="space-y-2">
                {trips.slice(0, 50).map(trip => (
                  <div key={trip.id} className="panel-inset p-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-xs text-rmpg-100">
                          <span className="font-mono">{formatDate(trip.trip_start)}</span>
                          <span className="text-rmpg-600">&rarr;</span>
                          <span className="font-mono">{formatDate(trip.trip_end)}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-1.5 text-[9px] text-rmpg-400">
                          {trip.distance_miles != null && (
                            <span className="flex items-center gap-0.5">
                              <Route className="w-2.5 h-2.5" />
                              {Number(trip.distance_miles).toFixed(1)} mi
                            </span>
                          )}
                          {trip.drive_duration_seconds != null && (
                            <span className="flex items-center gap-0.5">
                              <Clock className="w-2.5 h-2.5" />
                              {formatDuration(trip.drive_duration_seconds)}
                            </span>
                          )}
                          {trip.max_speed != null && (
                            <span className="flex items-center gap-0.5">
                              <Gauge className="w-2.5 h-2.5" />
                              Max {trip.max_speed} mph
                            </span>
                          )}
                          {trip.idle_duration_seconds != null && trip.idle_duration_seconds > 60 && (
                            <span className="text-amber-500">
                              Idle {formatDuration(trip.idle_duration_seconds)}
                            </span>
                          )}
                        </div>
                        {(trip.start_address || trip.end_address) && (
                          <div className="mt-1 text-[9px] text-rmpg-500">
                            {trip.start_address && <span>{trip.start_address}</span>}
                            {trip.start_address && trip.end_address && <span> &rarr; </span>}
                            {trip.end_address && <span>{trip.end_address}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {trips.length > 50 && (
                  <p className="text-center text-[9px] text-rmpg-500 py-2">Showing 50 of {trips.length} trips</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Alerts Sub-Tab */}
        {subTab === 'alerts' && (
          <div>
            {alerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-rmpg-500">
                <Zap className="w-6 h-6 mb-2" />
                <p className="text-xs">No alerts recorded</p>
              </div>
            ) : (
              <div className="space-y-2">
                {alerts.slice(0, 50).map(alert => (
                  <div key={alert.id} className={`panel-inset p-3 border-l-2 ${
                    alert.severity === 'critical' ? 'border-l-red-500' :
                    alert.severity === 'high' ? 'border-l-amber-500' :
                    alert.severity === 'medium' ? 'border-l-yellow-500' :
                    'border-l-rmpg-600'
                  }`}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className={`w-3 h-3 flex-shrink-0 ${
                            alert.severity === 'critical' ? 'text-red-400' :
                            alert.severity === 'high' ? 'text-amber-400' :
                            'text-yellow-400'
                          }`} />
                          <span className="text-xs text-rmpg-100 font-bold uppercase">{alert.alert_type?.replace(/_/g, ' ') || 'Alert'}</span>
                          <span className={`text-[8px] px-1 py-0.5 font-bold uppercase ${
                            alert.severity === 'critical' ? 'bg-red-900/40 text-red-400' :
                            alert.severity === 'high' ? 'bg-amber-900/40 text-amber-400' :
                            'bg-rmpg-700 text-rmpg-400'
                          }`}>
                            {alert.severity}
                          </span>
                        </div>
                        {alert.message && (
                          <p className="text-[10px] text-rmpg-300 mt-1">{alert.message}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1.5 text-[9px] text-rmpg-500">
                          <span className="font-mono">{formatDate(alert.triggered_at)}</span>
                          {alert.lat != null && alert.lon != null && (
                            <span className="font-mono">
                              {Number(alert.lat).toFixed(4)}, {Number(alert.lon).toFixed(4)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {alerts.length > 50 && (
                  <p className="text-center text-[9px] text-rmpg-500 py-2">Showing 50 of {alerts.length} alerts</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
