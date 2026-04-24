// Geocoding search proxy — exposes Nominatim's /search endpoint to
// authenticated clients without leaking the User-Agent / rate-limit
// concerns that would come from calling Nominatim directly from the
// browser. Used by the /map address search bar.
//
// Single-result geocoding for back-end use cases (incident address →
// lat/lng) lives in ../utils/geocode.ts. This route is for autocomplete
// where the client wants a list of candidates.

import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = Router();
router.use(authenticateToken);

const NOMINATIM_TIMEOUT_MS = 8_000;
const MIN_QUERY_LENGTH = 3;
const MAX_QUERY_LENGTH = 200;
const MAX_LIMIT = 10;
const USER_AGENT = 'RMPG-Flex-CAD/5.7 (rmpgutah.us)';

// Naive in-process rate limiter — Nominatim's policy is 1 req/sec
// across the whole IP. We serialize with a 1s minimum spacing.
let lastRequestMs = 0;
const MIN_INTERVAL_MS = 1100;

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
  place_id?: number;
  type?: string;
  importance?: number;
}

interface SearchResult {
  display_name: string;
  latitude: number;
  longitude: number;
  type?: string;
}

router.get('/search', async (req: Request, res: Response) => {
  const q = String(req.query.q || '').trim();
  const limitRaw = parseInt(String(req.query.limit || '5'), 10);
  const limit = Math.min(Math.max(1, isNaN(limitRaw) ? 5 : limitRaw), MAX_LIMIT);

  if (q.length < MIN_QUERY_LENGTH) {
    return res.json({ results: [] });
  }
  if (q.length > MAX_QUERY_LENGTH) {
    return res.status(400).json({ error: 'query too long' });
  }

  // Rate limit
  const now = Date.now();
  const wait = MIN_INTERVAL_MS - (now - lastRequestMs);
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastRequestMs = Date.now();

  const url =
    `https://nominatim.openstreetmap.org/search?` +
    `q=${encodeURIComponent(q)}&format=json&limit=${limit}&countrycodes=us&addressdetails=0`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS);
  try {
    const upstream = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!upstream.ok) {
      logger.warn({ status: upstream.status, q }, '[geocode/search] Nominatim non-OK');
      return res.status(502).json({ error: 'geocoder unavailable', results: [] });
    }
    const data: NominatimResult[] = await upstream.json();
    const results: SearchResult[] = (Array.isArray(data) ? data : [])
      .map((r) => ({
        display_name: r.display_name,
        latitude: parseFloat(r.lat),
        longitude: parseFloat(r.lon),
        type: r.type,
      }))
      .filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude));
    return res.json({ results });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return res.status(504).json({ error: 'geocoder timeout', results: [] });
    }
    logger.warn({ err }, '[geocode/search] failed');
    return res.status(502).json({ error: 'geocoder failed', results: [] });
  } finally {
    clearTimeout(timeout);
  }
});

export default router;
