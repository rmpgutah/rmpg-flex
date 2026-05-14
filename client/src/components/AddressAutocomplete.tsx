// ============================================================
// RMPG Flex — Address Autocomplete
// Mapbox Geocoding API autocomplete for address input fields.
// Drop-in replacement for <input> with address suggestions.
// ============================================================

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { MapPin } from 'lucide-react';
import { getMapboxToken, getCachedMapboxToken } from '../utils/mapboxApiKey';
import { useDistrictIdentify, type DistrictInfo } from '../hooks/useDistrictLookup';

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
  /**
   * Dispatch geography resolved from lat/lng via point-in-polygon lookup.
   * Populated automatically when the picked place has coordinates AND the
   * server's /dispatch/districts/identify endpoint returns a match.
   * Undefined when lat/lng missing, no polygon matched, or lookup failed —
   * callers should treat absence as "unknown", not "no coverage".
   */
  district?: DistrictInfo;
}

// ── Mapbox Geocoding API response types ──────────────────────
interface MapboxFeature {
  place_name: string;
  center: [number, number]; // [lng, lat]
  text: string;
  address?: string;
  context?: Array<{ id: string; text: string; short_code?: string }>;
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

/** Parse a Mapbox feature into address components */
function parseMapboxFeature(feature: MapboxFeature): Omit<ParsedAddress, 'district'> {
  const ctx = feature.context || [];
  const findCtx = (prefix: string) => ctx.find(c => c.id.startsWith(prefix));

  const streetNum = feature.address || '';
  const route = feature.text || '';
  const street = streetNum ? `${streetNum} ${route}` : route;

  const place = findCtx('place');
  const region = findCtx('region');
  const postcode = findCtx('postcode');
  const country = findCtx('country');

  return {
    formatted: feature.place_name,
    street,
    city: place?.text || '',
    state: region?.short_code?.replace(/^US-/, '') || region?.text || '',
    zip: postcode?.text || '',
    country: country?.short_code?.toUpperCase() || '',
    latitude: feature.center[1],
    longitude: feature.center[0],
  };
}

// SLC proximity for biasing results
const SLC_PROXIMITY: [number, number] = [-111.891, 40.7608];

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
  const [loadError, setLoadError] = useState(false);
  const [suggestions, setSuggestions] = useState<MapboxFeature[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const skipNextChangeRef = useRef(false);
  const { identify } = useDistrictIdentify();

  // Fetch Mapbox token on mount (with retry for auth race conditions)
  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    const maxAttempts = 3;
    const tryFetch = async () => {
      try {
        const token = await getMapboxToken(attempt > 0);
        if (cancelled) return;
        if (token && token.startsWith('pk.')) {
          setLoadError(false);
        } else if (++attempt < maxAttempts) {
          setTimeout(() => { if (!cancelled) tryFetch(); }, attempt * 2000);
        } else {
          setLoadError(true);
        }
      } catch {
        if (!cancelled) {
          if (++attempt < maxAttempts) {
            setTimeout(() => { if (!cancelled) tryFetch(); }, attempt * 2000);
          } else {
            setLoadError(true);
          }
        }
      }
    };
    tryFetch();
    return () => { cancelled = true; };
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Fetch suggestions from Mapbox Geocoding API
  const fetchSuggestions = useCallback(async (query: string) => {
    const token = getCachedMapboxToken();
    if (!token || !token.startsWith('pk.') || query.length < 3) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }
    try {
      const types = addressOnly ? '&types=address,street' : '';
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${token}&proximity=${SLC_PROXIMITY[0]},${SLC_PROXIMITY[1]}&country=${country}&limit=5${types}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      const features: MapboxFeature[] = data.features || [];
      setSuggestions(features);
      setShowDropdown(features.length > 0);
      setHighlightIdx(-1);
    } catch {
      // Geocoding failed — silently degrade
    }
  }, [country, addressOnly]);

  // Handle selecting a suggestion
  const handleSelect = useCallback(async (feature: MapboxFeature) => {
    const parsed: ParsedAddress = parseMapboxFeature(feature);
    skipNextChangeRef.current = true;
    onChange(parsed.formatted);
    setSuggestions([]);
    setShowDropdown(false);

    if (onSelect) onSelect(parsed);

    if (parsed.latitude != null && parsed.longitude != null) {
      const district = await identify(parsed.latitude, parsed.longitude);
      if (district && onSelect) {
        onSelect({ ...parsed, district });
      }
    }
  }, [onChange, onSelect, identify]);

  // Handle input changes (normal typing)
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (skipNextChangeRef.current) {
        skipNextChangeRef.current = false;
        return;
      }
      const val = e.target.value;
      onChange(val);

      // Debounce geocoding requests
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => fetchSuggestions(val), 300);
    },
    [onChange, fetchSuggestions]
  );

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!showDropdown || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx(prev => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && highlightIdx >= 0) {
      e.preventDefault();
      handleSelect(suggestions[highlightIdx]);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  }, [showDropdown, suggestions, highlightIdx, handleSelect]);

  // If token failed to load, render a plain input
  if (loadError || disabled) {
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
        onFocus={() => { if (suggestions.length > 0) setShowDropdown(true); }}
        required={required}
        autoFocus={autoFocus}
        autoComplete="off"
        role="combobox"
        aria-expanded={showDropdown}
        aria-autocomplete="list"
      />
      {tokenReady && (
        <MapPin
          className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none transition-colors"
          style={{ width: 12, height: 12, color: value ? '#888888' : '#505050' }}
          aria-hidden="true"
        />
      )}
      {/* Suggestion dropdown */}
      {showDropdown && suggestions.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute left-0 right-0 z-[99999] mt-0.5"
          style={{
            background: '#141414',
            border: '1px solid #404040',
            borderRadius: 2,
            boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
            fontFamily: "'Courier New', monospace",
          }}
          role="listbox"
        >
          {suggestions.map((feat, idx) => (
            <div
              key={feat.place_name}
              role="option"
              aria-selected={idx === highlightIdx}
              className="cursor-pointer"
              style={{
                padding: '6px 10px',
                fontSize: 11,
                color: '#d1d5db',
                lineHeight: 1.4,
                borderTop: idx > 0 ? '1px solid #2b2b2b' : 'none',
                background: idx === highlightIdx ? '#181818' : '#141414',
              }}
              onMouseEnter={() => setHighlightIdx(idx)}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(feat); }}
            >
              <span style={{ color: '#e5e7eb', fontWeight: 700, fontSize: 11 }}>
                {feat.text}{feat.address ? ` ${feat.address}` : ''}
              </span>
              {feat.place_name !== feat.text && (
                <span style={{ color: '#6b7280', fontSize: 10, marginLeft: 4 }}>
                  {feat.place_name.replace(`${feat.address || ''} ${feat.text}, `, '').replace(`${feat.text}, `, '')}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
