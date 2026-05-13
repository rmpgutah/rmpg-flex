// ============================================================
// RMPG Flex — Mapbox API Routes
// ============================================================
// Server-side proxy routes for Mapbox web service APIs.
// Protects the access token and enforces rate limiting.
// All routes require authentication.
//
// Endpoints:
//   GET  /api/mapbox/geocode/forward   — Forward geocode
//   GET  /api/mapbox/geocode/reverse   — Reverse geocode
//   GET  /api/mapbox/isochrone         — Isochrone polygons
//   POST /api/mapbox/matrix            — Travel time matrix
//   GET  /api/mapbox/static            — Static map image URL
//   GET  /api/mapbox/static/image      — Static map image (binary)
//   POST /api/mapbox/map-match         — GPS trace snapping
//   POST /api/mapbox/directions        — Turn-by-turn directions
//   GET  /api/mapbox/tilequery         — Query features near point
// ============================================================

import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth';
import { logger } from '../utils/logger';
import {
  mapboxGeocode,
  mapboxReverseGeocode,
  mapboxIsochrone,
  mapboxMatrix,
  mapboxStaticImageUrl,
  mapboxStaticImage,
  mapboxMapMatch,
  mapboxDirections,
  mapboxTilequery,
  mapboxOptimization,
} from '../utils/mapboxApi';

const router = Router();
router.use(authenticateToken);

// ── Forward Geocode ───────────────────────────────────────

router.get('/geocode/forward', async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q || q.length < 2) return res.json({ results: [] });

    const limit = Math.min(parseInt(String(req.query.limit || '5'), 10) || 5, 10);
    const country = String(req.query.country || 'us');

    let proximity: [number, number] | undefined;
    if (req.query.proximity) {
      const parts = String(req.query.proximity).split(',').map(Number);
      if (parts.length === 2 && parts.every(Number.isFinite)) {
        proximity = [parts[0], parts[1]];
      }
    }

    const results = await mapboxGeocode(q, { limit, country, proximity });
    res.json({ results });
  } catch (err: any) {
    logger.warn({ err }, '[mapbox/geocode/forward] failed');
    res.status(502).json({ error: 'Geocoding failed', results: [] });
  }
});

// ── Reverse Geocode ───────────────────────────────────────

router.get('/geocode/reverse', async (req: Request, res: Response) => {
  try {
    const lng = parseFloat(String(req.query.lng || ''));
    const lat = parseFloat(String(req.query.lat || ''));
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return res.status(400).json({ error: 'lng and lat required' });
    }

    const results = await mapboxReverseGeocode(lng, lat, {
      types: String(req.query.types || ''),
      limit: parseInt(String(req.query.limit || '1'), 10) || 1,
    });
    res.json({ results });
  } catch (err: any) {
    logger.warn({ err }, '[mapbox/geocode/reverse] failed');
    res.status(502).json({ error: 'Reverse geocoding failed', results: [] });
  }
});

// ── Isochrone ─────────────────────────────────────────────

router.get('/isochrone', async (req: Request, res: Response) => {
  try {
    const lng = parseFloat(String(req.query.lng || ''));
    const lat = parseFloat(String(req.query.lat || ''));
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return res.status(400).json({ error: 'lng and lat required' });
    }

    const profile = (['driving', 'walking', 'cycling'].includes(String(req.query.profile))
      ? String(req.query.profile) : 'driving') as 'driving' | 'walking' | 'cycling';

    let contours_minutes = [5, 10, 15];
    if (req.query.minutes) {
      contours_minutes = String(req.query.minutes).split(',').map(Number).filter(Number.isFinite);
    }

    const data = await mapboxIsochrone(lng, lat, { profile, contours_minutes });
    res.json(data);
  } catch (err: any) {
    logger.warn({ err }, '[mapbox/isochrone] failed');
    res.status(502).json({ error: 'Isochrone request failed' });
  }
});

// ── Matrix ────────────────────────────────────────────────

router.post('/matrix', async (req: Request, res: Response) => {
  try {
    const { coordinates, profile, annotations, sources, destinations } = req.body;
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      return res.status(400).json({ error: 'At least 2 coordinates required' });
    }
    if (coordinates.length > 25) {
      return res.status(400).json({ error: 'Maximum 25 coordinates' });
    }

    const data = await mapboxMatrix(coordinates, {
      profile: profile || 'driving',
      annotations: annotations || ['duration', 'distance'],
      sources,
      destinations,
    });
    res.json(data);
  } catch (err: any) {
    logger.warn({ err }, '[mapbox/matrix] failed');
    res.status(502).json({ error: 'Matrix request failed' });
  }
});

// ── Static Image URL ──────────────────────────────────────

router.get('/static', (req: Request, res: Response) => {
  try {
    const lng = parseFloat(String(req.query.lng || ''));
    const lat = parseFloat(String(req.query.lat || ''));
    const zoom = parseFloat(String(req.query.zoom || '14'));
    const width = parseInt(String(req.query.width || '600'), 10);
    const height = parseInt(String(req.query.height || '400'), 10);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return res.status(400).json({ error: 'lng and lat required' });
    }

    const style = String(req.query.style || 'mapbox/dark-v11');
    const highRes = req.query.retina === 'true';

    // Parse markers from query: markers=lng,lat,color,label;lng,lat,color,label
    let markers: Array<{ lng: number; lat: number; color?: string; label?: string }> | undefined;
    if (req.query.markers) {
      markers = String(req.query.markers).split(';').map(m => {
        const [mLng, mLat, color, label] = m.split(',');
        return { lng: parseFloat(mLng), lat: parseFloat(mLat), color, label };
      }).filter(m => Number.isFinite(m.lng) && Number.isFinite(m.lat));
    }

    const url = mapboxStaticImageUrl({ lng, lat, zoom, width, height, style, highRes, markers });
    res.json({ url });
  } catch (err: any) {
    logger.warn({ err }, '[mapbox/static] failed');
    res.status(500).json({ error: 'Failed to generate static image URL' });
  }
});

// ── Static Image Binary ──────────────────────────────────

router.get('/static/image', async (req: Request, res: Response) => {
  try {
    const lng = parseFloat(String(req.query.lng || ''));
    const lat = parseFloat(String(req.query.lat || ''));
    const zoom = parseFloat(String(req.query.zoom || '14'));
    const width = Math.min(parseInt(String(req.query.width || '600'), 10), 1280);
    const height = Math.min(parseInt(String(req.query.height || '400'), 10), 1280);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return res.status(400).json({ error: 'lng and lat required' });
    }

    const style = String(req.query.style || 'mapbox/dark-v11');
    const highRes = req.query.retina === 'true';

    // Parse markers from query: markers=lng,lat,color,label;lng,lat,color,label
    let markers: Array<{ lng: number; lat: number; color?: string; label?: string }> | undefined;
    if (req.query.markers) {
      markers = String(req.query.markers).split(';').map(m => {
        const [mLng, mLat, color, label] = m.split(',');
        return { lng: parseFloat(mLng), lat: parseFloat(mLat), color, label };
      }).filter(m => Number.isFinite(m.lng) && Number.isFinite(m.lat));
    }

    const buffer = await mapboxStaticImage({ lng, lat, zoom, width, height, style, highRes, markers });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(buffer);
  } catch (err: any) {
    logger.warn({ err }, '[mapbox/static/image] failed');
    res.status(502).json({ error: 'Failed to fetch static image' });
  }
});

// ── Map Matching ──────────────────────────────────────────

router.post('/map-match', async (req: Request, res: Response) => {
  try {
    const { coordinates, profile, timestamps, radiuses } = req.body;
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      return res.status(400).json({ error: 'At least 2 coordinates required' });
    }
    if (coordinates.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 coordinates' });
    }

    const data = await mapboxMapMatch(coordinates, {
      profile: profile || 'driving',
      timestamps,
      radiuses,
    });
    res.json(data);
  } catch (err: any) {
    logger.warn({ err }, '[mapbox/map-match] failed');
    res.status(502).json({ error: 'Map matching failed' });
  }
});

// ── Directions ────────────────────────────────────────────

router.post('/directions', async (req: Request, res: Response) => {
  try {
    const { coordinates, profile, steps, alternatives } = req.body;
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      return res.status(400).json({ error: 'At least 2 coordinates required' });
    }
    if (coordinates.length > 25) {
      return res.status(400).json({ error: 'Maximum 25 waypoints' });
    }

    const data = await mapboxDirections(coordinates, {
      profile: profile || 'driving',
      steps: steps ?? true,
      alternatives: alternatives ?? false,
    });
    res.json(data);
  } catch (err: any) {
    logger.warn({ err }, '[mapbox/directions] failed');
    res.status(502).json({ error: 'Directions request failed' });
  }
});

// ── Tilequery ─────────────────────────────────────────────

router.get('/tilequery', async (req: Request, res: Response) => {
  try {
    const tileset = String(req.query.tileset || 'mapbox.mapbox-streets-v8');
    const lng = parseFloat(String(req.query.lng || ''));
    const lat = parseFloat(String(req.query.lat || ''));
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return res.status(400).json({ error: 'lng and lat required' });
    }

    const radius = parseInt(String(req.query.radius || '1000'), 10);
    const limit = Math.min(parseInt(String(req.query.limit || '10'), 10), 50);
    const layers = req.query.layers ? String(req.query.layers).split(',') : undefined;

    const data = await mapboxTilequery(tileset, lng, lat, { radius, limit, layers });
    res.json(data);
  } catch (err: any) {
    logger.warn({ err }, '[mapbox/tilequery] failed');
    res.status(502).json({ error: 'Tilequery failed' });
  }
});

// ── Optimization (Traveling Salesman) ─────────────────────

router.post('/optimization', async (req: Request, res: Response) => {
  try {
    const { coordinates, profile, steps, roundtrip, source, destination } = req.body;
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      return res.status(400).json({ error: 'At least 2 coordinates required' });
    }
    if (coordinates.length > 12) {
      return res.status(400).json({ error: 'Maximum 12 waypoints for optimization' });
    }

    const data = await mapboxOptimization(coordinates, {
      profile: profile || 'driving',
      steps: steps ?? true,
      roundtrip: roundtrip ?? true,
      source: source || 'first',
      destination: destination || 'last',
    });
    res.json(data);
  } catch (err: any) {
    logger.warn({ err }, '[mapbox/optimization] failed');
    res.status(502).json({ error: 'Optimization request failed' });
  }
});

export default router;
