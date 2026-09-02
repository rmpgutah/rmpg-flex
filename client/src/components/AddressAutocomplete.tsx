// ============================================================
// RMPG Flex — Address Autocomplete
// Mapbox Geocoding API for address input fields.
// Drop-in replacement for <input> with address suggestions.
// ============================================================

import React, { useEffect, useId, useRef, useState, useCallback } from 'react';
import { MapPin } from 'lucide-react';
import { getMapboxAccessToken } from '../utils/mapboxApiKey';

// ── Parsed address components returned by onSelect ───────────
export interface ParsedAddress {
  /** Full formatted address string */
  formatted: string;
  /** The feature's primary name (street name, city name, state, or ZIP
   *  depending on the result type) */
  text: string;
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
  /** Called when the operator TYPES an address and leaves the field WITHOUT
   *  picking a suggestion. Lets callers forward-geocode the freehand text so
   *  typed addresses still auto-fill cross-street / district, not just picks. */
  onResolveTyped?: (value: string) => void;
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
  /** Explicit Mapbox feature types (overrides addressOnly). Use to scope a
   *  field to one component, e.g. 'place' for a City field, 'region' for
   *  State, 'postcode' for ZIP. */
  types?: string;
  /** What to write into the input when a suggestion is picked (default
   *  'formatted'). 'street' = street line only (for forms with separate
   *  city/state/zip fields); 'text' = the feature's primary name (city
   *  name, state name, or ZIP — for the scoped sub-fields). */
  fillWith?: 'formatted' | 'street' | 'text';
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

interface MapboxSuggestion {
  id: string;
  place_name: string;
  center?: [number, number];
  place_type: string[];
  context?: Array<{ id: string; text: string; short_code?: string }>;
  text?: string;
  address?: string;
  properties?: { short_code?: string };
}

/** Parse Mapbox Geocoding feature into structured address components */
function parseAddressFromFeature(feature: MapboxSuggestion): ParsedAddress {
  const props: Record<string, string> = {};
  const ctx = feature.context || [];

  // State abbreviation: region context entries carry short_code "US-UT".
  // When the feature itself IS a region (State sub-field), it's on
  // feature.properties instead.
  let regionShort = '';
  for (const c of ctx) {
    const idParts = c.id.split('.');
    if (idParts.length > 1) {
      const type = idParts[0] as string;
      props[type] = c.text;
      if (type === 'region' && c.short_code) regionShort = c.short_code.replace(/^US-/, '');
    }
  }
  if (!regionShort && feature.place_type?.includes('region') && feature.properties?.short_code) {
    regionShort = feature.properties.short_code.replace(/^US-/, '');
  }

  const street = feature.address
    ? [feature.address, feature.text].filter(Boolean).join(' ')
    : feature.place_name.split(',')[0]?.trim() || '';

  return {
    formatted: feature.place_name,
    text: feature.text || feature.place_name.split(',')[0]?.trim() || '',
    street,
    city: props.place || props.locality || '',
    state: regionShort || props.region || '',
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
      background: var(--surface-sunken) !important;
      border: 1px solid var(--border-default) !important;
      border-radius: 2px !important;
      box-shadow: 0 8px 24px rgba(0 0 0 / 0.6) !important;
      font-family: 'Arial, sans-serif' !important;
      z-index: 99999 !important;
      margin-top: 2px !important;
      position: absolute;
      left: 0;
      right: 0;
      max-height: 240px;
      overflow-y: auto;
    }
    .rmpg-geocoder-item {
      background: var(--surface-sunken) !important;
      border-top: 1px solid var(--border-subtle) !important;
      color: var(--text-secondary) !important;
      padding: 6px 10px !important;
      font-size: 11px !important;
      cursor: pointer !important;
      line-height: 1.4 !important;
    }
    .rmpg-geocoder-item:first-child {
      border-top: none !important;
    }
    .rmpg-geocoder-item:hover, .rmpg-geocoder-item-selected {
      background: var(--surface-raised) !important;
    }
    .rmpg-geocoder-item strong {
      color: var(--text-primary) !important;
      font-weight: 700 !important;
    }
    .rmpg-geocoder-item .rmpg-geocoder-secondary {
      color: var(--text-muted) !important;
      font-size: 10px !important;
    }
    .rmpg-geocoder-no-results {
      background: var(--surface-sunken) !important;
      color: var(--text-muted) !important;
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
  onResolveTyped,
  placeholder = 'Start typing an address...',
  className = 'input-dark',
  required = false,
  name,
  disabled = false,
  country = 'us',
  addressOnly = true,
  types,
  fillWith = 'formatted',
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
  // True for a brief window right after a suggestion is picked, so the input's
  // blur handler doesn't ALSO re-resolve the same address.
  const justSelectedRef = useRef(false);
  const reqIdRef = useRef(0);
  // True only when the latest value change came from a keystroke in this
  // input (set in handleChange, consumed by the debounce effect).
  const userTypedRef = useRef(false);

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
  const fetchSuggestions = useCallback(async (query: string, reqId?: number) => {
    if (!query || query.length < 3) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }

    const isStale = () => reqId != null && reqId !== reqIdRef.current;

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
        if (!isStale()) { setSuggestions(mapped); setShowDropdown(mapped.length > 0); setSelectedIdx(-1); }
        return;
      }

      const token = await getMapboxAccessToken();
      if (!token) return;

      const resultTypes = types || (addressOnly ? 'address,place' : 'address,place,poi,neighborhood');
      // Utah bias for Mapbox direct calls:
      //   proximity = SLC center (-111.89, 40.76) — Mapbox ranks
      //               results closer to this point higher
      //   bbox      = Utah bounding box (west,south,east,north) —
      //               soft constraint, not as strict as Nominatim's
      //               `bounded=1`, but combined with proximity it
      //               keeps Wasatch Front addresses on top
      // Without this, "South 200 East" matches Indiana grid streets
      // before SLC's identically-named arterial.
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${token}&country=${country}&autocomplete=true&types=${resultTypes}&limit=5&proximity=-111.89,40.76&bbox=-114.052,36.998,-109.041,42.001`;

      const res = await fetch(url);
      if (!res.ok) {
        if (!isStale()) setUseNominatim(true);
        return;
      }

      const mapData = await res.json();
      if (isStale()) return;

      const features: MapboxSuggestion[] = mapData.features || [];

      const mapped: Suggestion[] = features.map((f: MapboxSuggestion) => ({
        place_name: f.place_name,
        id: f.id,
        source: 'mapbox',
        raw: f,
      }));

      if (!isStale()) { setSuggestions(mapped); setShowDropdown(mapped.length > 0); setSelectedIdx(-1); }
    } catch {
      if (!isStale()) setUseNominatim(true);
    }
  }, [country, addressOnly, types, useNominatim]);

  // Debounced geocoding on input change — ONLY for changes the user typed
  // into THIS input. The `value` prop also changes when a parent autofills
  // the field programmatically (e.g. picking a street suggestion fills the
  // sibling City/State/ZIP fields); without this gate every autofilled
  // sibling fired its own geocode and opened a dropdown the user never
  // asked for, stacking irrelevant suggestion panels across the form.
  useEffect(() => {
    if (!userTypedRef.current) {
      // Programmatic change: never open (or keep open) a dropdown for it.
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }
    userTypedRef.current = false;
    if (!tokenReady && !useNominatim) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const reqId = ++reqIdRef.current;
    debounceRef.current = setTimeout(() => {
      fetchSuggestions(value, reqId);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [value, tokenReady, useNominatim, fetchSuggestions]);

  // Handle suggestion selection — fetch detail and parse address
  const handleSelectSuggestion = useCallback(async (suggestion: Suggestion) => {
    setShowDropdown(false);
    setSuggestions([]);
    skipNextChangeRef.current = true;
    justSelectedRef.current = true;   // suppress the blur-triggered typed-resolve

    // What lands in the input: the full formatted address by default, the
    // street line for forms with separate city/state/zip fields, or the
    // feature's primary name for scoped sub-fields (City/State/ZIP).
    const fillValue = (parsed: ParsedAddress) =>
      (fillWith === 'street' ? parsed.street : fillWith === 'text' ? parsed.text : parsed.formatted)
      || parsed.formatted;

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
      const parsed: ParsedAddress = {
        formatted: suggestion.place_name,
        text: street || suggestion.place_name.split(',')[0]?.trim() || '',
        street,
        city,
        state,
        zip,
        country: a.country || 'United States',
        latitude: Number.isFinite(lat) ? lat : null,
        longitude: Number.isFinite(lng) ? lng : null,
      };
      onChange(fillValue(parsed));
      if (onSelect) onSelect(parsed);
      return;
    }

    // Mapbox path. Use the feature already returned by the initial
    // forward-geocode (stashed in `suggestion.raw`) instead of refetching.
    //
    // Why the refetch was wrong: previously we hit
    //   /geocoding/v5/mapbox.places/{suggestion.id}.json
    // intending it as a feature-detail lookup, but that endpoint treats
    // the path segment as a SEARCH QUERY — feeding it a feature id like
    // "address.7438274632" matches whatever Mapbox's text search returns
    // for that opaque string, often a less-specific feature (street
    // only, or a different city with similar tokens). onSelect then
    // overwrote the full place_name from onChange with this partial
    // result, which is what the operator saw as "address fills out
    // partially." The forward-geocode response already includes
    // place_name + context + center, so re-parsing from `raw` is both
    // accurate and one fewer network round-trip.
    const feature = (suggestion.raw as MapboxSuggestion | undefined);
    const parsed: ParsedAddress = feature
      ? parseAddressFromFeature(feature)
      : {
          formatted: suggestion.place_name,
          text: suggestion.place_name.split(',')[0]?.trim() || '',
          street: '', city: '', state: '', zip: '', country: '',
          latitude: null, longitude: null,
        };
    onChange(fillValue(parsed));
    if (onSelect) onSelect(parsed);
  }, [onChange, onSelect, fillWith]);

  // Operator typed an address and tabbed/clicked away WITHOUT picking a
  // suggestion. Prefer resolving from the best autocomplete match (Mapbox
  // quality — the server Nominatim geocode is format-sensitive and misses
  // abbreviated street types). Only fall back to the freehand-text geocode
  // (onResolveTyped) when there are no suggestions. Deferred so a click on a
  // suggestion (which blurs the input first) still wins.
  const handleBlur = useCallback(() => {
    setTimeout(() => {
      if (justSelectedRef.current) { justSelectedRef.current = false; return; }
      const v = (value || '').trim();
      if (v.length < 5) return;
      if (suggestions.length > 0) handleSelectSuggestion(suggestions[0]);
      else if (onResolveTyped) onResolveTyped(v);
    }, 200);
  }, [value, suggestions, handleSelectSuggestion, onResolveTyped]);

  // Handle input changes (normal typing)
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (skipNextChangeRef.current) {
        skipNextChangeRef.current = false;
        return;
      }
      userTypedRef.current = true;
      onChange(e.target.value);
    },
    [onChange, fetchSuggestions]
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

  // ARIA combobox wiring — audit caught (2026-06-21) that the input
  // had no role=combobox / aria-expanded / aria-activedescendant so
  // screen readers heard "edit" with no announcement that suggestions
  // appeared, and voice-control / Switch Control users couldn't
  // enumerate options. Every call-intake form depends on this widget,
  // so this fix is load-bearing for assistive-tech access to the CAD.
  const aidPrefix = useId();
  const listboxId = `${aidPrefix}-listbox`;
  const optionId = (i: number) => `${aidPrefix}-opt-${i}`;
  const activeId = selectedIdx >= 0 && selectedIdx < suggestions.length ? optionId(selectedIdx) : undefined;
  const dropdownOpen = showDropdown && (suggestions.length > 0 || value.length >= 3);

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
        onBlur={handleBlur}
        required={required}
        autoFocus={autoFocus}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={dropdownOpen}
        aria-controls={listboxId}
        aria-activedescendant={activeId}
        aria-haspopup="listbox"
      />
      {/* MapPin indicator with brand color when loaded */}
      {tokenReady && (
        <MapPin
          className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none transition-colors"
          style={{ width: 12, height: 12, color: value ? 'var(--text-muted)' : 'rgb(var(--text-muted-rgb) / 0.5)' }}
          aria-hidden="true"
        />
      )}

      {/* Custom dropdown — role=listbox + role=option for screen readers
          and voice-control assistive tech. */}
      {showDropdown && suggestions.length > 0 && (
        <div
          ref={dropdownRef}
          className="rmpg-geocoder-dropdown"
          role="listbox"
          id={listboxId}
          aria-label="Address suggestions"
        >
          {suggestions.map((s, idx) => (
            <div
              key={s.id}
              id={optionId(idx)}
              role="option"
              aria-selected={idx === selectedIdx}
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
        <div ref={dropdownRef} className="rmpg-geocoder-dropdown" role="listbox" id={listboxId} aria-label="Address suggestions">
          <div className="rmpg-geocoder-no-results" role="status" aria-live="polite">No addresses found</div>
        </div>
      )}
    </div>
  );
}
