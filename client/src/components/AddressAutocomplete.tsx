// ============================================================
// RMPG Flex — Address Autocomplete
// Google Places Autocomplete for address input fields.
// Drop-in replacement for <input> with address suggestions.
// ============================================================

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { MapPin } from 'lucide-react';
import { loadGoogleMaps as loadGoogleMapsShared } from '../utils/googleMapsLoader';

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
}

// ── Helpers ──────────────────────────────────────────────────

/** Extract a component value from Google place result */
function getComponent(
  components: google.maps.GeocoderAddressComponent[] | undefined,
  type: string,
  useShort = false
): string {
  if (!components) return '';
  const match = components.find((c) => c.types.includes(type));
  return match ? (useShort ? match.short_name : match.long_name) : '';
}

// Use the shared Google Maps loader — single source of truth with retry + offline resilience.
// Previously had its own duplicate loader here which caused race conditions and had no timeout.
const loadGoogleMaps = loadGoogleMapsShared;

// Dark dropdown styles injected once
const AUTOCOMPLETE_STYLE_ID = 'rmpg-autocomplete-styles';
function injectAutocompleteStyles() {
  if (document.getElementById(AUTOCOMPLETE_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = AUTOCOMPLETE_STYLE_ID;
  style.textContent = `
    .pac-container {
      background: #141e2b !important;
      border: 1px solid #404040 !important;
      border-radius: 4px !important;
      box-shadow: 0 8px 24px rgba(0,0,0,0.6) !important;
      font-family: 'Courier New', monospace !important;
      z-index: 99999 !important;
      margin-top: 2px !important;
    }
    .pac-item {
      background: #141e2b !important;
      border-top: 1px solid #1e3048 !important;
      color: #d1d5db !important;
      padding: 6px 10px !important;
      font-size: 11px !important;
      cursor: pointer !important;
      line-height: 1.4 !important;
    }
    .pac-item:first-child {
      border-top: none !important;
    }
    .pac-item:hover, .pac-item-selected {
      background: #182840 !important;
    }
    .pac-item-query {
      color: #e5e7eb !important;
      font-weight: 700 !important;
      font-size: 11px !important;
    }
    .pac-icon {
      display: none !important;
    }
    .pac-matched {
      color: #1a5a9e !important;
      font-weight: 900 !important;
    }
    .pac-item span:last-child {
      color: #6b7280 !important;
      font-size: 10px !important;
    }
    .pac-logo::after {
      display: none !important;
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
}: AddressAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [placesLoaded, setPlacesLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const skipNextChangeRef = useRef(false);

  // Load Places library on mount
  useEffect(() => {
    const apiKey = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY as string;
    if (!apiKey) {
      setLoadError(true);
      return;
    }

    loadGoogleMaps(apiKey)
      .then(() => {
        setPlacesLoaded(true);
        injectAutocompleteStyles();
      })
      .catch(() => {
        setLoadError(true);
      });
  }, []);

  // Initialize Autocomplete on the input element
  useEffect(() => {
    if (!placesLoaded || !inputRef.current || autocompleteRef.current) return;

    const autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
      types: addressOnly ? ['address'] : ['geocode'],
      componentRestrictions: { country },
      fields: ['address_components', 'formatted_address', 'geometry'],
    });

    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      if (!place || !place.formatted_address) return;

      const formatted = place.formatted_address;
      const comps = place.address_components;

      const streetNumber = getComponent(comps, 'street_number');
      const route = getComponent(comps, 'route');
      const street = streetNumber ? `${streetNumber} ${route}` : route;

      const parsed: ParsedAddress = {
        formatted,
        street,
        city:
          getComponent(comps, 'locality') ||
          getComponent(comps, 'sublocality_level_1') ||
          getComponent(comps, 'administrative_area_level_2'),
        state: getComponent(comps, 'administrative_area_level_1', true),
        zip: getComponent(comps, 'postal_code'),
        country: getComponent(comps, 'country', true),
        latitude: place.geometry?.location?.lat() ?? null,
        longitude: place.geometry?.location?.lng() ?? null,
      };

      // Update the controlled value without triggering an extra onChange
      skipNextChangeRef.current = true;
      onChange(formatted);

      if (onSelect) {
        onSelect(parsed);
      }
    });

    autocompleteRef.current = autocomplete;

    return () => {
      google.maps.event.clearInstanceListeners(autocomplete);
      autocompleteRef.current = null;
    };
  }, [placesLoaded, country, addressOnly]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // If Places failed to load, render a plain input
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
        required={required}
        autoComplete="off"
      />
      {placesLoaded && (
        <MapPin
          className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ width: 12, height: 12, color: '#505050' }}
        />
      )}
    </div>
  );
}
