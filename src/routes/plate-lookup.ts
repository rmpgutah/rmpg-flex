import { Hono } from 'hono';
import type { Env } from '../types';
import { notConfigured } from '../utils/notConfigured';
import { PlateToVinClient, PlateValidationError, AutoDevApiError } from '../auto-dev/plate-to-vin';
import { log } from '../utils/logger';

const router = new Hono<Env>();

// GET /api/plate-lookup/:state/:plate
// Thin wrapper around the Auto.dev Plate-to-VIN API.
// Returns the flat PlateToVinResponse on 200 hit.
// Returns 503 { ok:false, code:'not_configured' } when AUTO_DEV_API_KEY is unset.
// Returns structured errors for validation failures and API 4xx.
router.get('/:state/:plate', async (c) => {
  const apiKey = c.env.AUTO_DEV_API_KEY;
  if (!apiKey) return notConfigured(c, 'AUTO_DEV_API_KEY');

  const { state, plate } = c.req.param();

  const client = new PlateToVinClient({
    apiKey,
    cacheTtlMs: 86_400_000,
    maxRetries: 2,
    initialBackoffMs: 300,
  });

  try {
    const result = await client.lookup({ state, plate });
    return c.json({ ok: true, data: result });
  } catch (err) {
    if (err instanceof PlateValidationError) {
      return c.json({ ok: false, code: 'VALIDATION_ERROR', message: (err as Error).message }, 400);
    }
    if (err instanceof AutoDevApiError) {
      const apiErr = err as AutoDevApiError;
      return c.json(
        { ok: false, code: apiErr.code, message: apiErr.message, requestId: apiErr.requestId },
        apiErr.statusCode as 400 | 404,
      );
    }
    log.error('plate-lookup: unexpected error', { state, plate }, err instanceof Error ? err : new Error(String(err)));
    return c.json({ ok: false, code: 'SERVER_ERROR', message: 'Lookup failed' }, 500);
  }
});

export default router;
