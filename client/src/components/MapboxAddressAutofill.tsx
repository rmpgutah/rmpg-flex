// ============================================================
// RMPG Flex — Mapbox Address Autofill Component
// ============================================================
// Reusable address autofill powered by @mapbox/search-js-react.
// Provides real-time address suggestions as the user types in
// any address field across the CAD/RMS application.
//
// Mapbox Developer Cheatsheet: Search Box / Address Autofill
// ============================================================

import { useRef, useCallback, useState, useEffect } from 'react';
import { AddressAutofill, config } from '@mapbox/search-js-react';
import { getMapboxTokenStatus } from '../utils/mapboxApiKey';

// ── Types ──────────────────────────────────────────────────

export interface AddressComponents {
  address: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  full_address: string;
  latitude?: number;
  longitude?: number;
}

export interface MapboxAddressAutofillProps {
  /** Current address value */
  value: string;
  /** Callback when address text changes */
  onChange: (value: string) => void;
  /** Callback when a complete address is selected from suggestions */
  onSelect?: (components: AddressComponents) => void;
  /** Input placeholder */
  placeholder?: string;
  /** Additional CSS classes for the input */
  className?: string;
  /** Input name attribute */
  name?: string;
  /** Input id attribute */
  id?: string;
  /** Whether the input is disabled */
  disabled?: boolean;
  /** Country filter (default: 'US') */
  country?: string;
  /** Proximity bias [lng, lat] for better local results */
  proximity?: [number, number];
}

// ── Salt Lake City default proximity ───────────────────────
const SLC_PROXIMITY: [number, number] = [-111.891, 40.7608];

// ── Component ──────────────────────────────────────────────

export default function MapboxAddressAutofill({
  value,
  onChange,
  onSelect,
  placeholder = 'Enter address…',
  className = '',
  name,
  id,
  disabled = false,
  country = 'US',
  proximity = SLC_PROXIMITY,
}: MapboxAddressAutofillProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [token, setToken] = useState<string | null>(null);
  const [tokenChecked, setTokenChecked] = useState(false);

  // Resolve Mapbox token
  useEffect(() => {
    let cancelled = false;
    getMapboxTokenStatus().then(status => {
      if (!cancelled) {
        setToken(status.configured ? status.token ?? null : null);
        setTokenChecked(true);
      }
    }).catch(() => {
      if (!cancelled) setTokenChecked(true);
    });
    return () => { cancelled = true; };
  }, []);

  // Configure the Mapbox Search JS SDK
  useEffect(() => {
    if (token) {
      config.accessToken = token;
    }
  }, [token]);

  // Handle input changes
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  }, [onChange]);

  // Handle suggestion retrieval
  const handleRetrieve = useCallback((res: any) => {
    if (!onSelect || !res?.features?.[0]) return;
    const feature = res.features[0];
    const props = feature.properties || {};
    const coords = feature.geometry?.coordinates;

    const components: AddressComponents = {
      address: props.address_line1 || props.full_address || value,
      city: props.address_level2 || props.place || '',
      state: props.address_level1 || props.region || '',
      zip: props.postcode || '',
      country: props.country || country,
      full_address: props.full_address || `${props.address_line1 || ''}, ${props.address_level2 || ''}, ${props.address_level1 || ''} ${props.postcode || ''}`.trim(),
      latitude: coords?.[1],
      longitude: coords?.[0],
    };

    onSelect(components);
  }, [onSelect, value, country]);

  // Spillman dark theme input styles
  const inputClasses = `w-full bg-[#141414] border border-[#222222] text-[#e0e0e0] text-xs px-3 py-1.5 
    placeholder-[#555555] focus:border-[#d4a017] focus:outline-none transition-colors
    ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`;

  // Fall back to a plain input if no Mapbox token is available
  if (!tokenChecked) {
    return (
      <input
        ref={inputRef}
        type="text"
        name={name}
        id={id}
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        className={inputClasses}
        style={{ borderRadius: 2 }}
        autoComplete="street-address"
      />
    );
  }

  if (!token) {
    return (
      <input
        ref={inputRef}
        type="text"
        name={name}
        id={id}
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        className={inputClasses}
        style={{ borderRadius: 2 }}
        autoComplete="street-address"
      />
    );
  }

  return (
    <AddressAutofill
      accessToken={token}
      onRetrieve={handleRetrieve}
      options={{
        country,
        proximity: proximity ? { lng: proximity[0], lat: proximity[1] } as any : undefined,
        language: 'en',
      }}
    >
      <input
        ref={inputRef}
        type="text"
        name={name}
        id={id}
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        className={inputClasses}
        style={{ borderRadius: 2 }}
        autoComplete="street-address"
      />
    </AddressAutofill>
  );
}
