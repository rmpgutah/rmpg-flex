// Dispatch Tool Panel — integrated geocode + isochrone + nearest-unit + tilequery
// Collapsible sidebar panel for map dispatch operations
import React, { useState, useCallback } from 'react';
import { Search, Clock, Route, MapPin, Loader2, X, Gauge } from 'lucide-react';
import PanelTitleBar from '../../../components/PanelTitleBar';
import IconButton from '../../../components/IconButton';

interface DispatchToolPanelProps {
  // Geocode
  geocodeSearch: (q: string, limit?: number) => Promise<void>;
  geocodeSuggestions: { id: string; place_name: string; center: [number, number]; text: string }[];
  geocodeLoading: boolean;
  geocodeSelect: (s: { center: [number, number]; text: string }) => void;
  geocodeClear: () => void;

  // Isochrone
  isochroneResult: { contours: any[]; center: [number, number]; minutes: number[]; loading: boolean };
  isochroneFetch: (lng: number, lat: number, minutes?: number[], profile?: string) => Promise<void>;
  isochroneClear: () => void;

  // Matrix (nearest unit)
  matrixResults: { etas: any[]; loading: boolean };
  matrixCompute: (units: any[], call: any, profile?: string) => Promise<void>;
  matrixClear: () => void;

  // Tilequery
  tilequeryQuery: (lng: number, lat: number) => Promise<any>;
  tilequeryResult: any;
  tilequeryLoading: boolean;

  // Common
  className?: string;
}

type TabId = 'geocode' | 'isochrone' | 'matrix' | 'tilequery';

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'geocode', label: 'Search', icon: Search },
  { id: 'matrix', label: 'Nearest', icon: Route },
  { id: 'isochrone', label: 'Coverage', icon: Clock },
  { id: 'tilequery', label: 'Identify', icon: MapPin },
];

const ISOCHRONE_PRESETS = [5, 10, 15];
const ISOCHRONE_FAST = [2, 5];

export default function DispatchToolPanel(props: DispatchToolPanelProps) {
  const {
    geocodeSearch, geocodeSuggestions, geocodeLoading, geocodeSelect, geocodeClear,
    isochroneResult, isochroneFetch, isochroneClear,
    matrixResults, matrixCompute, matrixClear,
    tilequeryQuery, tilequeryResult, tilequeryLoading,
    className = '',
  } = props;

  const [activeTab, setActiveTab] = useState<TabId>('geocode');
  const [query, setQuery] = useState('');
  const [isoMinutes, setIsoMinutes] = useState<number[]>(ISOCHRONE_PRESETS);
  const [isoLng, setIsoLng] = useState('');
  const [isoLat, setIsoLat] = useState('');

  const handleGeocodeSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) geocodeSearch(query);
  }, [query, geocodeSearch]);

  const handleIsochroneSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const lng = parseFloat(isoLng);
    const lat = parseFloat(isoLat);
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      isochroneFetch(lng, lat, isoMinutes);
    }
  }, [isoLng, isoLat, isoMinutes, isochroneFetch]);

  const handleGeocodeSelect = useCallback((s: any) => {
    geocodeSelect(s);
    setIsoLng(String(s.center[0]));
    setIsoLat(String(s.center[1]));
  }, [geocodeSelect]);

  return (
    <div
      className={`flex flex-col ${className}`}
      style={{ background: '#0a0a0a', border: '1px solid #222222', borderRadius: 2, maxHeight: 'calc(100vh - 200px)' }}
    >
      <PanelTitleBar title="DISPATCH TOOLS" icon={Gauge} statusLed="green" ledPulse />

      {/* Tab bar */}
      <div className="flex border-b border-[#222222]" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors"
            style={{
              borderBottom: activeTab === tab.id ? '2px solid #d4a017' : '2px solid transparent',
              color: activeTab === tab.id ? '#d4a017' : '#666666',
              background: activeTab === tab.id ? '#141414' : 'transparent',
            }}
          >
            <tab.icon className="w-3 h-3" aria-hidden="true" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 300px)' }}>
        {/* ── Geocode Search ── */}
        {activeTab === 'geocode' && (
          <div className="p-2.5 space-y-2">
            <form onSubmit={handleGeocodeSubmit} className="flex gap-1.5">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Address or place..."
                className="flex-1 px-2 py-1 text-[11px] border border-[#3a3a3a] outline-none"
                style={{ background: '#050505', color: '#cccccc', borderRadius: 2 }}
              />
              <button
                type="submit"
                disabled={geocodeLoading || !query.trim()}
                className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider border border-[#3a3a3a] hover:border-[#d4a017] disabled:opacity-40 transition-colors"
                style={{ background: '#141414', color: '#d4a017', borderRadius: 2 }}
              >
                {geocodeLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Go'}
              </button>
            </form>

            {geocodeSuggestions.length > 0 && (
              <div className="space-y-0.5">
                {geocodeSuggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => handleGeocodeSelect(s)}
                    className="w-full text-left px-2 py-1.5 text-[10px] hover:bg-[#1a1a1a] border border-transparent hover:border-[#2e2e2e] transition-colors"
                    style={{ borderRadius: 2, color: '#999999' }}
                  >
                    <div className="font-semibold text-[#cccccc] text-[11px]">{s.text}</div>
                    <div className="truncate">{s.place_name}</div>
                  </button>
                ))}
              </div>
            )}

            {!geocodeLoading && !geocodeSuggestions.length && query.length > 1 && (
              <p className="text-[10px] text-[#555555] italic px-1">No results found</p>
            )}
          </div>
        )}

        {/* ── Nearest Unit (Matrix) ── */}
        {activeTab === 'matrix' && (
          <div className="p-2.5 space-y-2">
            {matrixResults.loading && (
              <div className="flex items-center gap-2 text-[11px] text-[#888888]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Computing nearest units...
              </div>
            )}

            {!matrixResults.loading && matrixResults.etas.length > 0 && (
              <div className="space-y-1">
                <div className="flex justify-between items-center mb-1.5">
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: '#888888' }}
                  >
                    Distance to Call
                  </span>
                  {matrixResults.etas.length > 0 && (
                    <IconButton
                      onClick={matrixClear}
                      aria-label="Clear nearest unit results"
                      className="w-5 h-5"
                    >
                      <X className="w-3 h-3" />
                    </IconButton>
                  )}
                </div>
                {matrixResults.etas.map((eta, i) => (
                  <div
                    key={`${eta.unitId}-${eta.callId}`}
                    className="flex items-center gap-2 px-2 py-1.5"
                    style={{
                      background: i === 0 ? '#1a1a0d' : '#0a0a0a',
                      border: i === 0 ? '1px solid #d4a017' : '1px solid #1a1a1a',
                      borderRadius: 2,
                    }}
                  >
                    <span
                      className="text-[10px] font-bold min-w-[28px] text-center"
                      style={{ color: i === 0 ? '#d4a017' : '#555555' }}
                    >
                      #{i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-semibold text-[#cccccc] truncate">
                        {eta.callSign}
                      </div>
                      <div className="text-[9px] text-[#666666]">
                        to {eta.callNumber}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[12px] font-bold" style={{ color: '#d4a017' }}>
                        {eta.etaText}
                      </div>
                      <div className="text-[9px] text-[#666666]">{eta.distanceText}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!matrixResults.loading && !matrixResults.etas.length && (
              <p className="text-[10px] text-[#555555] italic text-center py-4">
                Select a call on the map to compute nearest unit ETAs
              </p>
            )}
          </div>
        )}

        {/* ── Isochrone Coverage ── */}
        {activeTab === 'isochrone' && (
          <div className="p-2.5 space-y-2">
            <form onSubmit={handleIsochroneSubmit} className="space-y-1.5">
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={isoLng}
                  onChange={(e) => setIsoLng(e.target.value)}
                  placeholder="Longitude"
                  className="flex-1 px-2 py-1 text-[10px] border border-[#3a3a3a] outline-none"
                  style={{ background: '#050505', color: '#cccccc', borderRadius: 2 }}
                />
                <input
                  type="text"
                  value={isoLat}
                  onChange={(e) => setIsoLat(e.target.value)}
                  placeholder="Latitude"
                  className="flex-1 px-2 py-1 text-[10px] border border-[#3a3a3a] outline-none"
                  style={{ background: '#050505', color: '#cccccc', borderRadius: 2 }}
                />
              </div>

              <div className="flex flex-wrap gap-1">
                {[2, 5, 10, 15].map((min) => (
                  <button
                    key={min}
                    type="button"
                    onClick={() => setIsoMinutes((prev) =>
                      prev.includes(min) ? prev.filter((m) => m !== min) : [...prev, min].sort()
                    )}
                    className="px-2 py-0.5 text-[9px] font-semibold border transition-colors"
                    style={{
                      borderRadius: 2,
                      borderColor: isoMinutes.includes(min) ? '#d4a017' : '#3a3a3a',
                      color: isoMinutes.includes(min) ? '#d4a017' : '#666666',
                      background: isoMinutes.includes(min) ? '#1a1a0d' : '#0a0a0a',
                    }}
                  >
                    {min}m
                  </button>
                ))}
              </div>

              <div className="flex gap-1.5">
                <button
                  type="submit"
                  disabled={isochroneResult.loading}
                  className="flex-1 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider border border-[#3a3a3a] hover:border-[#d4a017] disabled:opacity-40 transition-colors"
                  style={{ background: '#141414', color: '#d4a017', borderRadius: 2 }}
                >
                  {isochroneResult.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" /> : 'Generate'}
                </button>
                {isochroneResult.contours.length > 0 && (
                  <button
                    type="button"
                    onClick={isochroneClear}
                    className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider border border-[#3a3a3a] hover:border-[#f03c3c] transition-colors"
                    style={{ background: '#141414', color: '#888888', borderRadius: 2 }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </form>

            {isochroneResult.contours.length > 0 && (
              <div className="space-y-0.5 pt-1 border-t border-[#1a1a1a]">
                <div className="text-[9px] font-semibold uppercase tracking-wider text-[#666666] mb-1">
                  Coverage Rings
                </div>
                {isochroneResult.contours.map((c, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-[10px] text-[#888888]">
                    <span
                      className="w-3 h-3 shrink-0 border"
                      style={{
                        borderRadius: 1,
                        background: c.minutes <= 5 ? 'rgba(100,210,100,0.25)' : c.minutes <= 10 ? 'rgba(240,180,40,0.25)' : 'rgba(240,60,60,0.2)',
                        borderColor: c.minutes <= 5 ? '#64d264' : c.minutes <= 10 ? '#f0b428' : '#f03c3c',
                      }}
                    />
                    <span className="font-semibold text-[#cccccc]">{c.minutes} min</span>
                    <span className="text-[#555555]">drive time</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Tilequery Identify ── */}
        {activeTab === 'tilequery' && (
          <div className="p-2.5 space-y-2">
            {tilequeryLoading && (
              <div className="flex items-center gap-2 text-[11px] text-[#888888]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Identifying location...
              </div>
            )}

            {!tilequeryLoading && tilequeryResult && (
              <div className="space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#666666]">
                  Location Info
                </div>

                {tilequeryResult.city && (
                  <div className="flex justify-between items-center px-2 py-1 text-[10px] border border-[#1a1a1a]"
                    style={{ background: '#050505', borderRadius: 2 }}>
                    <span className="text-[#666666]">City</span>
                    <span className="font-semibold text-[#cccccc]">{tilequeryResult.city}</span>
                  </div>
                )}

                {tilequeryResult.county && (
                  <div className="flex justify-between items-center px-2 py-1 text-[10px] border border-[#1a1a1a]"
                    style={{ background: '#050505', borderRadius: 2 }}>
                    <span className="text-[#666666]">County</span>
                    <span className="font-semibold text-[#cccccc]">{tilequeryResult.county}</span>
                  </div>
                )}

                {tilequeryResult.state && (
                  <div className="flex justify-between items-center px-2 py-1 text-[10px] border border-[#1a1a1a]"
                    style={{ background: '#050505', borderRadius: 2 }}>
                    <span className="text-[#666666]">State</span>
                    <span className="font-semibold text-[#cccccc]">{tilequeryResult.state}</span>
                  </div>
                )}

                {tilequeryResult.sectorName && (
                  <div className="flex justify-between items-center px-2 py-1 text-[10px] border border-[#1a1a1a]"
                    style={{ background: '#050505', borderRadius: 2 }}>
                    <span className="text-[#666666]">Area</span>
                    <span className="font-semibold text-[#cccccc]">{tilequeryResult.sectorName}</span>
                  </div>
                )}

                <div className="flex justify-between items-center px-2 py-1 text-[9px]"
                  style={{ background: '#050505', borderRadius: 2, color: '#444444' }}>
                  <span>{String(tilequeryResult.location[0]).substring(0, 8)}</span>
                  <span>{String(tilequeryResult.location[1]).substring(0, 8)}</span>
                </div>
              </div>
            )}

            {!tilequeryLoading && !tilequeryResult && (
              <p className="text-[10px] text-[#555555] italic text-center py-4">
                Click a location on the map to identify features
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
