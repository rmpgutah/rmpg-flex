/**
 * useMapBookmarks — Google Maps Saved Places equivalent for Mapbox GL.
 *
 * Drop pins, name them, persist to localStorage, recall and fly to them.
 * Supports custom labels, colors, notes. Replaces Google Maps
 * "Save this place" / "Your Places" functionality.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';

// ── Types ─────────────────────────────────────────────────

export interface MapBookmark {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  color: string;
  notes: string;
  createdAt: number;
  zoom: number;
}

const STORAGE_KEY = 'rmpg_map_bookmarks';
const BOOKMARK_COLORS = ['#d4a017', '#ef4444', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#f59e0b', '#14b8a6'];

function loadBookmarks(): MapBookmark[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveBookmarks(bookmarks: MapBookmark[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
  } catch { /* quota exceeded, ignore */ }
}

// ── Hook ──────────────────────────────────────────────────

export function useMapBookmarks(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
) {
  const [bookmarks, setBookmarks] = useState<MapBookmark[]>(loadBookmarks);
  const [visible, setVisible] = useState(true);
  const [dropMode, setDropMode] = useState(false);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());

  // Sync markers with bookmarks
  useEffect(() => {
    if (!map || !mapLoaded || !visible) {
      // Remove all markers when hidden
      markersRef.current.forEach(m => m.remove());
      markersRef.current.clear();
      return;
    }

    const currentIds = new Set<string>();

    for (const bm of bookmarks) {
      currentIds.add(bm.id);
      const existing = markersRef.current.get(bm.id);
      if (existing) {
        existing.setLngLat([bm.longitude, bm.latitude]);
        continue;
      }

      // Create marker
      const el = document.createElement('div');
      el.style.cssText = `
        width:24px;height:24px;border-radius:2px;
        background:${bm.color};border:2px solid #fff;
        display:flex;align-items:center;justify-content:center;
        font-size:10px;cursor:pointer;color:#fff;font-weight:700;
        box-shadow:0 0 8px ${bm.color}80;
      `;
      el.textContent = '★';
      el.title = bm.name;

      const marker = new mapboxgl.Marker({ element: el, draggable: false })
        .setLngLat([bm.longitude, bm.latitude])
        .setPopup(
          new mapboxgl.Popup({ offset: 14, closeButton: true, className: 'mapbox-popup-dark' })
            .setHTML(`
              <div style="background:#141414;color:#e0e0e0;padding:8px 12px;border:1px solid #222;border-radius:2px;font-size:11px;min-width:140px;">
                <div style="font-weight:700;color:${bm.color};margin-bottom:2px;">★ ${bm.name}</div>
                ${bm.notes ? `<div style="color:#888;font-size:10px;margin-top:2px;">${bm.notes}</div>` : ''}
                <div style="color:#555;font-size:9px;margin-top:4px;">${bm.latitude.toFixed(5)}, ${bm.longitude.toFixed(5)}</div>
                <div style="color:#555;font-size:9px;">${new Date(bm.createdAt).toLocaleDateString()}</div>
              </div>
            `)
        )
        .addTo(map);

      markersRef.current.set(bm.id, marker);
    }

    // Remove stale markers
    markersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    });
  }, [map, mapLoaded, bookmarks, visible]);

  // Drop mode click handler
  useEffect(() => {
    if (!map || !mapLoaded || !dropMode) return;

    const handler = (e: mapboxgl.MapMouseEvent) => {
      const { lng, lat } = e.lngLat;
      const name = `Bookmark ${bookmarks.length + 1}`;
      const newBookmark: MapBookmark = {
        id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        latitude: lat,
        longitude: lng,
        color: BOOKMARK_COLORS[bookmarks.length % BOOKMARK_COLORS.length],
        notes: '',
        createdAt: Date.now(),
        zoom: map.getZoom(),
      };
      const updated = [...bookmarks, newBookmark];
      setBookmarks(updated);
      saveBookmarks(updated);
      setDropMode(false);
      map.getCanvas().style.cursor = '';
    };

    map.getCanvas().style.cursor = 'crosshair';
    map.once('click', handler);

    return () => {
      map.off('click', handler);
      map.getCanvas().style.cursor = '';
    };
  }, [map, mapLoaded, dropMode, bookmarks]);

  const addBookmark = useCallback((bm: Omit<MapBookmark, 'id' | 'createdAt'>) => {
    const newBm: MapBookmark = {
      ...bm,
      id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: Date.now(),
    };
    const updated = [...bookmarks, newBm];
    setBookmarks(updated);
    saveBookmarks(updated);
  }, [bookmarks]);

  const removeBookmark = useCallback((id: string) => {
    const updated = bookmarks.filter(b => b.id !== id);
    setBookmarks(updated);
    saveBookmarks(updated);
    const marker = markersRef.current.get(id);
    if (marker) {
      marker.remove();
      markersRef.current.delete(id);
    }
  }, [bookmarks]);

  const updateBookmark = useCallback((id: string, updates: Partial<MapBookmark>) => {
    const updated = bookmarks.map(b => b.id === id ? { ...b, ...updates } : b);
    setBookmarks(updated);
    saveBookmarks(updated);
  }, [bookmarks]);

  const flyToBookmark = useCallback((id: string) => {
    if (!map) return;
    const bm = bookmarks.find(b => b.id === id);
    if (!bm) return;
    map.flyTo({ center: [bm.longitude, bm.latitude], zoom: bm.zoom || 16, duration: 800 });
    const marker = markersRef.current.get(id);
    if (marker) marker.togglePopup();
  }, [map, bookmarks]);

  const clearAll = useCallback(() => {
    markersRef.current.forEach(m => m.remove());
    markersRef.current.clear();
    setBookmarks([]);
    saveBookmarks([]);
  }, []);

  const toggleVisible = useCallback(() => setVisible(v => !v), []);

  // Cleanup
  useEffect(() => {
    return () => {
      markersRef.current.forEach(m => m.remove());
      markersRef.current.clear();
    };
  }, []);

  return {
    bookmarks,
    visible,
    dropMode,
    setDropMode,
    addBookmark,
    removeBookmark,
    updateBookmark,
    flyToBookmark,
    clearAll,
    toggleVisible,
    colors: BOOKMARK_COLORS,
  };
}
