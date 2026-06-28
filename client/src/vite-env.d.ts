/// <reference types="vite/client" />
/// <reference types="google.maps" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
  readonly VITE_GOOGLE_MAPS_MAP_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface ImportMetaEnv {
  readonly VITE_MAPBOX_ACCESS_TOKEN?: string;
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
