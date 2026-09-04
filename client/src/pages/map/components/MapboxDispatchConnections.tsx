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

interface ClosestUnitResult {
  unit: { id: string; call_sign: string; latitude: number | null; longitude: number | null; status: string };
  distance: number;
  duration: number;
}

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
    } catch (error) {
      setResultText(error instanceof Error ? error.message : 'Mapbox action failed');
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
        borderTop: '1px solid var(--border-subtle)',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--surface-overlay)',
      }}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[9px] font-black uppercase tracking-wider" style={{ color: 'var(--sev-info)' }}>
          Mapbox Dispatch APIs
        </span>
        <span
          className="text-[8px] font-bold uppercase px-1.5 py-0.5"
          style={{
            borderRadius: 2,
            color: connected ? 'var(--sev-ok)' : 'var(--sev-warn)',
            border: `1px solid ${connected ? 'rgb(var(--sev-ok-rgb) / 0.25)' : 'rgb(var(--sev-warn-rgb) / 0.25)'}`,
            background: connected ? 'rgb(var(--sev-ok-rgb) / 0.07)' : 'rgb(var(--sev-warn-rgb) / 0.07)',
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
                border: '1px solid var(--border-subtle)',
                borderRadius: 2,
                background: 'var(--surface-overlay)',
                padding: '6px 8px',
              }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Icon className="w-3 h-3 shrink-0" style={{ color: active ? 'var(--sev-info)' : 'var(--text-muted)' }} />
                <div className="min-w-0">
                  <div className="text-[9px] font-bold" style={{ color: 'var(--text-secondary)' }}>{feature.label}</div>
                  <div className="text-[8px] truncate" style={{ color: 'var(--text-muted)' }}>{feature.note}</div>
                </div>
              </div>
              <span
                className="text-[8px] font-bold uppercase shrink-0"
                style={{ color: active ? 'var(--sev-ok)' : 'var(--text-muted)' }}
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
              border: '1px solid var(--border-subtle)',
              background: button.enabled ? 'var(--surface-sunken)' : 'var(--surface-overlay)',
              color: button.enabled ? 'var(--text-primary)' : 'var(--text-muted)',
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
          border: '1px solid var(--border-subtle)',
          background: 'var(--surface-overlay)',
          color: 'var(--sev-info)',
          padding: '6px 8px',
          wordBreak: 'break-word',
        }}
      >
        {resultText}
      </div>
    </div>
  );
}
