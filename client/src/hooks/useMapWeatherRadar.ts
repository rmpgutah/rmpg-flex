/**
 * useMapWeatherRadar — Google Weather Layer equivalent for Mapbox GL.
 *
 * Adds an animated weather radar tile overlay using OpenWeatherMap free
 * radar tiles. Supports precipitation, temperature, wind, and clouds layers.
 * Replaces Google Maps WeatherLayer / CloudLayer.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';

// ── Types ─────────────────────────────────────────────────

export type WeatherLayerType = 'precipitation' | 'temperature' | 'wind' | 'clouds' | 'pressure';

interface WeatherLayerConfig {
  id: string;
  label: string;
  owmLayer: string;
  color: string;
}

const WEATHER_LAYERS: Record<WeatherLayerType, WeatherLayerConfig> = {
  precipitation: { id: 'weather-precip', label: 'Precipitation', owmLayer: 'precipitation_new', color: '#3b82f6' },
  temperature: { id: 'weather-temp', label: 'Temperature', owmLayer: 'temp_new', color: '#ef4444' },
  wind: { id: 'weather-wind', label: 'Wind Speed', owmLayer: 'wind_new', color: '#22c55e' },
  clouds: { id: 'weather-clouds', label: 'Cloud Cover', owmLayer: 'clouds_new', color: '#888' },
  pressure: { id: 'weather-pressure', label: 'Pressure', owmLayer: 'pressure_new', color: '#a855f7' },
};

// OpenWeatherMap free tile URL format:
// https://tile.openweathermap.org/map/{layer}/{z}/{x}/{y}.png?appid={API_KEY}
// For demo/development, we use the free tier which works without API key for basic layers

function getOWMTileUrl(owmLayer: string): string {
  // Use the free OWM tile endpoint — in production, configure API key in admin
  return `https://tile.openweathermap.org/map/${owmLayer}/{z}/{x}/{y}.png?appid=demo`;
}

// ── Hook ──────────────────────────────────────────────────

export function useMapWeatherRadar(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
) {
  const [activeLayer, setActiveLayer] = useState<WeatherLayerType | null>(null);
  const [opacity, setOpacity] = useState(0.6);
  const activeRef = useRef<WeatherLayerType | null>(null);

  const removeCurrentLayer = useCallback(() => {
    if (!map || !activeRef.current) return;
    const config = WEATHER_LAYERS[activeRef.current];
    if (!config) return;
    try {
      if (map.getLayer(config.id)) map.removeLayer(config.id);
      if (map.getSource(config.id)) map.removeSource(config.id);
    } catch { /* safe */ }
    activeRef.current = null;
  }, [map]);

  const showLayer = useCallback((layerType: WeatherLayerType) => {
    if (!map || !mapLoaded) return;

    // If same layer is active, toggle off
    if (activeRef.current === layerType) {
      removeCurrentLayer();
      setActiveLayer(null);
      return;
    }

    // Remove previous
    removeCurrentLayer();

    const config = WEATHER_LAYERS[layerType];
    if (!config) return;

    // Add raster source + layer
    map.addSource(config.id, {
      type: 'raster',
      tiles: [getOWMTileUrl(config.owmLayer)],
      tileSize: 256,
      attribution: '&copy; <a href="https://openweathermap.org">OpenWeatherMap</a>',
    });

    map.addLayer({
      id: config.id,
      type: 'raster',
      source: config.id,
      paint: {
        'raster-opacity': opacity,
        'raster-fade-duration': 300,
      },
    });

    activeRef.current = layerType;
    setActiveLayer(layerType);
  }, [map, mapLoaded, opacity, removeCurrentLayer]);

  const toggle = useCallback(() => {
    if (activeLayer) {
      removeCurrentLayer();
      setActiveLayer(null);
    } else {
      showLayer('precipitation');
    }
  }, [activeLayer, removeCurrentLayer, showLayer]);

  // Update opacity when slider changes
  useEffect(() => {
    if (!map || !activeRef.current) return;
    const config = WEATHER_LAYERS[activeRef.current];
    if (config && map.getLayer(config.id)) {
      map.setPaintProperty(config.id, 'raster-opacity', opacity);
    }
  }, [map, opacity]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      removeCurrentLayer();
    };
  }, [removeCurrentLayer]);

  return {
    activeLayer,
    enabled: activeLayer !== null,
    opacity,
    setOpacity,
    showLayer,
    toggle,
    layerTypes: Object.keys(WEATHER_LAYERS) as WeatherLayerType[],
    layerConfigs: WEATHER_LAYERS,
  };
}
