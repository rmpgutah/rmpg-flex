// ============================================================
// RMPG Flex — Address Autocomplete
// Mapbox Geocoding API for address input fields.
// Drop-in replacement for <input> with address suggestions.
// ============================================================

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { MapPin } from 'lucide-react';
import { getMapboxAccessToken } from '../utils/mapboxApiKey';

// ── Parsed address components returned by onSelect ───────────
export interface ParsedAddress {
  /** Full formatted address string */
  formatted: string;
  /** Street number + route (e.g., "123 Main St") */
  street: string;
  /** City / locality */
  city: string;
  /** State / admin area level 1 (abbreviated, e.g., "UT") */
  state: string;
  /** ZIP / postal code */
  zip: string;
  /** Country */
  country: string;
  /** Latitude (if available) */
  latitude: number | null;
  /** Longitude (if available) */
  longitude: number | null;
}

// ── Component Props ──────────────────────────────────────────
interface AddressAutocompleteProps {
  /** Current input value (controlled) */
  value: string;
  /** Called on every keystroke (like a normal input) */
  onChange: (value: string) => void;
  /** Called when user picks a suggestion — provides parsed address components */
  onSelect?: (address: ParsedAddress) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Additional CSS class (added to the input) */
  className?: string;
  /** Whether the field is required */
  required?: boolean;
  /** Input name attribute */
  name?: string;
  /** Disable the autocomplete (falls back to plain input) */
  disabled?: boolean;
  /** Bias results toward a specific country (ISO 3166-1 alpha-2, default: 'us') */
  country?: string;
  /** Restrict to address results only (default: true) */
  addressOnly?: boolean;
  /** Auto-focus on mount */
  autoFocus?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────

interface Suggestion {
  place_name: string;
  id: string;
  /** source: 'mapbox' or 'nominatim' */
  source?: string;
  /** raw feature/result for detail lookup */
  raw?: any;
}

interface MapboxFeature {
  id: string;
  place_name: string;
  center?: [number, number];
  place_type: string[];
  context?: Array<{ id: string; text: string }>;
  text?: string;
  address?: string;
}

/** Parse Mapbox Geocoding feature into structured address components */
function parseAddressFromFeature(feature: MapboxFeature): ParsedAddress {
  const props: Record<string, string> = {};
  const ctx = feature.context || [];

  for (const c of ctx) {
    const idParts = c.id.split('.');
    if (idParts.length > 1) {
      const type = idParts[0] as string;
      props[type] = c.text;
    }
  }

  const street = feature.address
    ? [feature.address, feature.text].filter(Boolean).join(' ')
    : feature.place_name.split(',')[0]?.trim() || '';

  return {
    formatted: feature.place_name,
    street,
    city: props.place || props.locality || '',
    state: props.region || '',
    zip: props.postcode || '',
    country: props.country || '',
    latitude: feature.center?.[1] ?? null,
    longitude: feature.center?.[0] ?? null,
  };
}

// Dark dropdown styles injected once
const AUTOCOMPLETE_STYLE_ID = 'rmpg-autocomplete-styles';
function injectAutocompleteStyles() {
  if (document.getElementById(AUTOCOMPLETE_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = AUTOCOMPLETE_STYLE_ID;
  style.textContent = `
    .rmpg-geocoder-dropdown {
      background: #141414 !important;
      border: 1px solid #404040 !important;
      border-radius: 2px !important;
      box-shadow: 0 8px 24px rgba(0,0,0,0.6) !important;
      font-family: 'Courier New', monospace !important;
      z-index: 99999 !important;
      margin-top: 2px !important;
      position: absolute;
      left: 0;
      right: 0;
      max-height: 240px;
      overflow-y: auto;
    }
    .rmpg-geocoder-item {
      background: #141414 !important;
      border-top: 1px solid #2b2b2b !important;
      color: #d1d5db !important;
      padding: 6px 10px !important;
      font-size: 11px !important;
      cursor: pointer !important;
      line-height: 1.4 !important;
    }
    .rmpg-geocoder-item:first-child {
      border-top: none !important;
    }
    .rmpg-geocoder-item:hover, .rmpg-geocoder-item-selected {
      background: #181818 !important;
    }
    .rmpg-geocoder-item strong {
      color: #e5e7eb !important;
      font-weight: 700 !important;
    }
    .rmpg-geocoder-item .rmpg-geocoder-secondary {
      color: #6b7280 !important;
      font-size: 10px !important;
    }
    .rmpg-geocoder-no-results {
      background: #141414 !important;
      color: #6b7280 !important;
      padding: 6px 10px !important;
      font-size: 11px !important;
      font-style: italic;
    }
  `;
  document.head.appendChild(style);
}

// ── Component ────────────────────────────────────────────────

export default function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = 'Start typing an address...',
  className = 'input-dark',
  required = false,
  name,
  disabled = false,
  country = 'us',
  addressOnly = true,
  autoFocus = false,
}: AddressAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [loadError, setLoadError] = useState(false);
  const [tokenReady, setTokenReady] = useState(false);
  const [useNominatim, setUseNominatim] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextChangeRef = useRef(false);

  // Fetch Mapbox token on mount + on tab-visible.
  // Previous behavior: token was tried once on mount; if the endpoint
  // returned "not configured", useNominatim=true latched forever in
  // that tab. After the operator added the MAPBOX_ACCESS_TOKEN secret,
  // tabs that loaded before the secret never picked up Mapbox.
  // Now: also re-probe when the tab becomes visible (user came back),
  // and force-refresh the token cache so a stale "not configured"
  // response doesn't poison the recovery path.
  useEffect(() => {
    let cancelled = false;
    setLoadError(false);

    const probe = async (force = false) => {
      try {
        const token = await getMapboxAccessToken(force);
        if (cancelled) return;
        if (!token) {
          setUseNominatim(true);
          setLoadError(false);
          injectAutocompleteStyles();
          return;
        }
        // Token available — switch back to Mapbox path even if we
        // had previously latched to Nominatim.
        setUseNominatim(false);
        setTokenReady(true);
        injectAutocompleteStyles();
      } catch {
        if (!cancelled) { setUseNominatim(true); injectAutocompleteStyles(); }
      }
    };

    probe();

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        // Force refresh — bypass the module-level token cache so we
        // discover newly-configured Mapbox keys without a hard reload.
        probe(true);
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Geocode query via Mapbox or Nominatim fallback
  const fetchSuggestions = useCallback(async (query: string) => {
    if (!query || query.length < 3) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }

    try {
      if (useNominatim) {
        const res = await fetch(`/api/geocode/search?q=${encodeURIComponent(query)}&limit=5`);
        if (!res.ok) return;
        const data = await res.json();
        const results: any[] = data.results || [];
        const mapped: Suggestion[] = results.map((r: any, i: number) => ({
          place_name: r.display_name,
          id: `nom-${i}`,
          source: 'nominatim',
          raw: r,
        }));
        setSuggestions(mapped);
        setShowDropdown(mapped.length > 0);
        setSelectedIdx(-1);
        return;
      }

      const token = await getMapboxAccessToken();
      if (!token) return;

      const types = addressOnly ? 'address,place' : 'address,place,poi,neighborhood';
      // Utah bias for Mapbox direct calls:
      //   proximity = SLC center (-111.89, 40.76) — Mapbox ranks
      //               results closer to this point higher
      //   bbox      = Utah bounding box (west,south,east,north) —
      //               soft constraint, not as strict as Nominatim's
      //               `bounded=1`, but combined with proximity it
      //               keeps Wasatch Front addresses on top
      // Without this, "South 200 East" matches Indiana grid streets
      // before SLC's identically-named arterial.
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${token}&country=${country}&autocomplete=true&types=${types}&limit=5&proximity=-111.89,40.76&bbox=-114.052,36.998,-109.041,42.001`;

      const res = await fetch(url);
      if (!res.ok) {
        setUseNominatim(true);
        return;
      }

      const mapData = await res.json();
      const features: MapboxFeature[] = mapData.features || [];

      const mapped: Suggestion[] = features.map((f: MapboxFeature) => ({
        place_name: f.place_name,
        id: f.id,
        source: 'mapbox',
        raw: f,
      }));

      setSuggestions(mapped);
      setShowDropdown(mapped.length > 0);
      setSelectedIdx(-1);
    } catch {
      setUseNominatim(true);
    }
  }, [country, addressOnly, useNominatim]);

  // Debounced geocoding on input change
  useEffect(() => {
    if (!tokenReady && !useNominatim) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchSuggestions(value);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [value, tokenReady, useNominatim, fetchSuggestions]);

  // Handle suggestion selection — fetch detail and parse address
  const handleSelectSuggestion = useCallback(async (suggestion: Suggestion) => {
    setShowDropdown(false);
    setSuggestions([]);
    skipNextChangeRef.current = true;
    onChange(suggestion.place_name);

    if (suggestion.source === 'nominatim') {
      // Nominatim raw shape:
      //   { lat: "40.76...", lon: "-111.89...",
      //     address: { house_number, road, city|town|village, state, postcode, ... } }
      // Previous code read addr.street/addr.zip/addr.latitude — all undefined.
      // Result: autofill silently dropped lat/lng and the district lookup
      // (which keys off lat/lng) never fired. Bug fix: read the actual
      // Nominatim field names.
      const raw: any = suggestion.raw || {};
      const a = raw.address || {};
      const houseNumber = a.house_number || '';
      const road = a.road || a.pedestrian || a.cycleway || '';
      const street = [houseNumber, road].filter(Boolean).join(' ');
      const city = a.city || a.town || a.village || a.hamlet || a.suburb || '';
      const state = a.state || '';
      const zip = a.postcode || '';
      const lat = raw.lat != null ? Number(raw.lat) : null;
      const lng = raw.lon != null ? Number(raw.lon) : null;
      if (onSelect) {
        onSelect({
          formatted: suggestion.place_name,
          street,
          city,
          state,
          zip,
          country: a.country || 'United States',
          latitude: Number.isFinite(lat) ? lat : null,
          longitude: Number.isFinite(lng) ? lng : null,
        });
      }
      return;
    }

    try {
      const token = await getMapboxAccessToken();
      if (!token) {
        if (onSelect) onSelect({ formatted: suggestion.place_name, street: '', city: '', state: '', zip: '', country: '', latitude: null, longitude: null });
        return;
      }

      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${suggestion.id}.json?access_token=${token}&types=address,place`;
      const res = await fetch(url);
      if (!res.ok) {
        if (onSelect) onSelect({ formatted: suggestion.place_name, street: '', city: '', state: '', zip: '', country: '', latitude: null, longitude: null });
        return;
      }

      const data = await res.json();
      const feature = data.features?.[0] as MapboxFeature | undefined;

      if (feature && onSelect) {
        onSelect(parseAddressFromFeature(feature));
      } else if (onSelect) {
        onSelect({ formatted: suggestion.place_name, street: '', city: '', state: '', zip: '', country: '', latitude: null, longitude: null });
      }
    } catch {
      if (onSelect) onSelect({ formatted: suggestion.place_name, street: '', city: '', state: '', zip: '', country: '', latitude: null, longitude: null });
    }
  }, [onChange, onSelect]);

  // Handle input changes (normal typing)
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (skipNextChangeRef.current) {
        skipNextChangeRef.current = false;
        return;
      }
      onChange(e.target.value);
    },
    [onChange]
  );

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(prev => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(prev => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter' && selectedIdx >= 0) {
      e.preventDefault();
      handleSelectSuggestion(suggestions[selectedIdx]);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  }, [showDropdown, suggestions, selectedIdx, handleSelectSuggestion]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.contains(e.target as Node) &&
          dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // If explicitly disabled, render a plain input
  if (disabled) {
    return (
      <input
        type="text"
        name={name}
        className={className}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        disabled={disabled}
        autoFocus={autoFocus}
      />
    );
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        name={name}
        className={className}
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        required={required}
        autoFocus={autoFocus}
        autoComplete="off"
      />
      {/* MapPin indicator with brand color when loaded */}
      {tokenReady && (
        <MapPin
          className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none transition-colors"
          style={{ width: 12, height: 12, color: value ? '#888888' : '#505050' }}
          aria-hidden="true"
        />
      )}

      {/* Custom dropdown */}
      {showDropdown && suggestions.length > 0 && (
        <div ref={dropdownRef} className="rmpg-geocoder-dropdown">
          {suggestions.map((s, idx) => (
            <div
              key={s.id}
              className={`rmpg-geocoder-item${idx === selectedIdx ? ' rmpg-geocoder-item-selected' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); handleSelectSuggestion(s); }}
              onMouseEnter={() => setSelectedIdx(idx)}
            >
              {s.place_name}
            </div>
          ))}
        </div>
      )}

      {showDropdown && suggestions.length === 0 && value.length >= 3 && (
        <div ref={dropdownRef} className="rmpg-geocoder-dropdown">
          <div className="rmpg-geocoder-no-results">No addresses found</div>
        </div>
      )}
    </div>
  );
}
