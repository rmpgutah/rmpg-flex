import React, { useMemo, useState } from 'react';
import { Link2, Route, TimerReset, Search, Radar } from 'lucide-react';
import {
  buildMapboxStaticImageUrl,
  fetchMapboxForwardGeocode,
  fetchMapboxIsochrones,
  fetchMapboxMatchedPath,
  fetchMapboxReverseGeocode,
  fetchMapboxRoute,
  hasMapboxDirections,
} from '../../../utils/mapboxRouting';
import type { ActiveCall } from '../utils/mapConstants';
import type { ClosestUnitResult } from '../hooks/useClosestUnit';

interface MapboxDispatchConnectionsProps {
  call?: ActiveCall;
  results?: ClosestUnitResult[];
  matrixActive?: boolean;
  directionsActive?: boolean;
}

const FEATURES = [
  { key: 'directions', label: 'Directions', icon: Route, note: 'Officer-to-call turn routing + ETA' },
  { key: 'matrix', label: 'Matrix', icon: TimerReset, note: 'Closest-unit travel-time ranking' },
  { key: 'geocoding', label: 'Geocoding', icon: Search, note: 'Call and officer address lookup' },
  { key: 'isochrone', label: 'Isochrone', icon: Radar, note: 'Response-time coverage rings' },
  { key: 'matching', label: 'Map Matching', icon: Link2, note: 'Snap breadcrumb trails to roads' },
] as const;

export default function MapboxDispatchConnections({
  call,
  results = [],
  matrixActive = false,
  directionsActive = false,
}: MapboxDispatchConnectionsProps) {
  const connected = hasMapboxDirections();
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [resultText, setResultText] = useState<string>('Ready');

  const bestUnit = useMemo(
    () => results.find(result => result.unit.latitude != null && result.unit.longitude != null) || null,
    [results],
  );

  const callCoords = call?.latitude != null && call?.longitude != null
    ? { lat: call.latitude, lng: call.longitude }
    : null;

  const runAction = async (action: string, fn: () => Promise<string>) => {
    if (!connected) {
      setResultText('Mapbox token required');
      return;
    }
    setBusyAction(action);
    try {
      setResultText(await fn());
    } catch (error: any) {
      setResultText(error?.message || 'Mapbox action failed');
    } finally {
      setBusyAction(null);
    }
  };

  const actionButtons = [
    {
      key: 'route',
      label: 'Best Route',
      enabled: Boolean(bestUnit && callCoords),
      run: async () => {
        if (!bestUnit || !callCoords || bestUnit.unit.latitude == null || bestUnit.unit.longitude == null) {
          return 'Route unavailable';
        }
        const route = await fetchMapboxRoute(
          { lat: bestUnit.unit.latitude, lng: bestUnit.unit.longitude },
          callCoords,
        );
        return route
          ? `${bestUnit.unit.call_sign} route ${route.distance} • ${route.eta}`
          : 'No route returned';
      },
    },
    {
      key: 'geocode',
      label: 'Validate Address',
      enabled: Boolean(call?.location_address),
      run: async () => {
        const features = await fetchMapboxForwardGeocode(call?.location_address || '', callCoords || undefined);
        if (!features.length) return 'No address candidates found';
        const top = features[0];
        return `Top geocode: ${top.placeName}`;
      },
    },
    {
      key: 'reverse',
      label: 'Reverse Lookup',
      enabled: Boolean(callCoords),
      run: async () => {
        if (!callCoords) return 'Call coordinates missing';
        const features = await fetchMapboxReverseGeocode(callCoords);
        return features[0]?.placeName || 'No reverse geocode result';
      },
    },
    {
      key: 'isochrone',
      label: 'Response Rings',
      enabled: Boolean(callCoords),
      run: async () => {
        if (!callCoords) return 'Call coordinates missing';
        const contours = await fetchMapboxIsochrones(callCoords, [5, 10, 15]);
        return contours.length
          ? `Loaded ${contours.map(contour => `${contour.minutes}m`).join(', ')} coverage`
          : 'No isochrone contours returned';
      },
    },
    {
      key: 'static',
      label: 'Static Snapshot',
      enabled: Boolean(callCoords),
      run: async () => {
        if (!callCoords) return 'Call coordinates missing';
        const url = buildMapboxStaticImageUrl(callCoords, {
          pinCoordinates: [
            callCoords,
            ...(bestUnit?.unit.latitude != null && bestUnit.unit.longitude != null
              ? [{ lat: bestUnit.unit.latitude, lng: bestUnit.unit.longitude }]
              : []),
          ],
        });
        return url ? `Static image ready: ${url}` : 'Static image URL unavailable';
      },
    },
    {
      key: 'matching',
      label: 'Snap Route',
      enabled: Boolean(bestUnit && callCoords),
      run: async () => {
        if (!bestUnit || !callCoords || bestUnit.unit.latitude == null || bestUnit.unit.longitude == null) {
          return 'Match path unavailable';
        }
        const matched = await fetchMapboxMatchedPath([
          { lat: bestUnit.unit.latitude, lng: bestUnit.unit.longitude },
          callCoords,
        ]);
        return matched.length ? `Matched ${matched.length} road-snapped points` : 'No snapped path returned';
      },
    },
  ] as const;

  return (
    <div
      className="mt-2 px-3 py-2"
      style={{
        borderTop: '1px solid #22222230',
        borderBottom: '1px solid #22222230',
        background: '#0a0a0a',
      }}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[9px] font-black uppercase tracking-wider" style={{ color: '#60a5fa' }}>
          Mapbox Dispatch APIs
        </span>
        <span
          className="text-[8px] font-bold uppercase px-1.5 py-0.5"
          style={{
            borderRadius: 2,
            color: connected ? '#22c55e' : '#f59e0b',
            border: `1px solid ${connected ? '#22c55e40' : '#f59e0b40'}`,
            background: connected ? '#22c55e12' : '#f59e0b12',
          }}
        >
          {connected ? 'Connected' : 'Token Required'}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-1.5">
        {FEATURES.map(feature => {
          const Icon = feature.icon;
          const active = feature.key === 'matrix'
            ? matrixActive
            : feature.key === 'directions'
              ? directionsActive
              : connected;
          return (
            <div
              key={feature.key}
              className="flex items-center justify-between gap-2"
              style={{
                border: '1px solid #1f293720',
                borderRadius: 2,
                background: '#050505',
                padding: '6px 8px',
              }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Icon className="w-3 h-3 shrink-0" style={{ color: active ? '#60a5fa' : '#6b7280' }} />
                <div className="min-w-0">
                  <div className="text-[9px] font-bold" style={{ color: '#d1d5db' }}>{feature.label}</div>
                  <div className="text-[8px] truncate" style={{ color: '#6b7280' }}>{feature.note}</div>
                </div>
              </div>
              <span
                className="text-[8px] font-bold uppercase shrink-0"
                style={{ color: active ? '#22c55e' : '#6b7280' }}
              >
                {active ? 'Live' : 'Standby'}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {actionButtons.map(button => (
          <button
            key={button.key}
            type="button"
            disabled={!button.enabled || busyAction != null}
            onClick={() => void runAction(button.key, button.run)}
            className="text-left px-2 py-1.5 transition-colors"
            style={{
              borderRadius: 2,
              border: '1px solid #1d4ed840',
              background: button.enabled ? '#0f172a' : '#111827',
              color: button.enabled ? '#bfdbfe' : '#6b7280',
              opacity: busyAction === button.key ? 0.7 : 1,
            }}
          >
            <div className="text-[8px] font-black uppercase tracking-wider">
              {busyAction === button.key ? 'Running…' : button.label}
            </div>
          </button>
        ))}
      </div>

      <div
        className="mt-2 text-[8px] leading-4"
        style={{
          borderRadius: 2,
          border: '1px solid #1f2937',
          background: '#030712',
          color: '#93c5fd',
          padding: '6px 8px',
          wordBreak: 'break-word',
        }}
      >
        {resultText}
      </div>
    </div>
  );
}
