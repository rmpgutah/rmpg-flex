/// <reference types="vite/client" />

// Module declarations for packages without bundled types
declare module '@mapbox/mapbox-gl-geocoder' {
  import type mapboxgl from 'mapbox-gl';

  interface GeocoderOptions {
    accessToken: string;
    mapboxgl?: typeof mapboxgl;
    marker?: boolean | object;
    placeholder?: string;
    proximity?: { longitude: number; latitude: number };
    bbox?: [number, number, number, number];
    countries?: string;
    types?: string;
    limit?: number;
    language?: string;
    zoom?: number;
    flyTo?: boolean | object;
    collapsed?: boolean;
    clearAndBlurOnEsc?: boolean;
    clearOnBlur?: boolean;
    enableEventLogging?: boolean;
    [key: string]: any;
  }

  class MapboxGeocoder implements mapboxgl.IControl {
    constructor(options: GeocoderOptions);
    onAdd(map: mapboxgl.Map): HTMLElement;
    onRemove(): void;
    query(query: string): this;
    setInput(value: string): this;
    setProximity(proximity: { longitude: number; latitude: number }): this;
    getProximity(): { longitude: number; latitude: number };
    setLanguage(language: string): this;
    getLanguage(): string;
    setZoom(zoom: number): this;
    getZoom(): number;
    setFlyTo(flyTo: boolean | object): this;
    getFlyTo(): boolean | object;
    setPlaceholder(placeholder: string): this;
    getPlaceholder(): string;
    setBbox(bbox: [number, number, number, number]): this;
    getBbox(): [number, number, number, number];
    setCountries(countries: string): this;
    getCountries(): string;
    setTypes(types: string): this;
    getTypes(): string;
    setLimit(limit: number): this;
    getLimit(): number;
    setFilter(filter: (feature: any) => boolean): this;
    setOrigin(origin: string): this;
    getOrigin(): string;
    on(type: string, listener: (event: any) => void): this;
    off(type: string, listener: (event: any) => void): this;
    clear(): void;
  }

  export default MapboxGeocoder;
}

interface ImportMetaEnv {
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

// @mapbox/mapbox-gl-geocoder — fallback declaration if package types missing
declare module '@mapbox/mapbox-gl-geocoder' {
  import type mapboxgl from 'mapbox-gl';
  interface GeocoderOptions {
    accessToken: string;
    mapboxgl?: any;
    marker?: boolean | object;
    placeholder?: string;
    proximity?: { longitude: number; latitude: number };
    countries?: string;
    limit?: number;
    collapsed?: boolean;
    clearOnBlur?: boolean;
    flyTo?: object | boolean;
    types?: string;
    language?: string;
    bbox?: [number, number, number, number];
    [key: string]: any;
  }
  class MapboxGeocoder implements mapboxgl.IControl {
    constructor(options: GeocoderOptions);
    onAdd(map: mapboxgl.Map): HTMLElement;
    onRemove(): void;
    query(query: string): this;
    setInput(value: string): this;
    setProximity(proximity: { longitude: number; latitude: number }): this;
    clear(): void;
    on(type: string, fn: (...args: any[]) => void): this;
    off(type: string, fn: (...args: any[]) => void): this;
  }
  export default MapboxGeocoder;
}
declare module '@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css' {}

// Web Speech API — not all browsers ship these types
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition;
}

interface Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}
