import { Router, Request, Response } from 'express';
import { authenticateToken, requireRole } from '../middleware/auth';
import { analyzeCall, generateNarrative, suggestUnits, isAIAvailable } from '../utils/groqAI';
import aiManager from '../utils/aiManager';
import { checkSystemHealth, getHealthSummary } from '../utils/aiSystemHealth';
import { runDataCleanupScan, autoFixStaleCall, autoFixOrphanedUnit } from '../utils/aiDataCleanup';
import { getDb } from '../models/database';

const router = Router();
router.use(authenticateToken);

// ─── GET /status — check if AI is configured and which provider ───
router.get('/status', (_req: Request, res: Response) => {
  res.json(aiManager.getStatus());
});

// ─── GET /config — returns current AI configuration (admin only) ───
router.get('/config', requireRole('admin'), (_req: Request, res: Response) => {
  const cfg = aiManager.getConfig();
  // Mask API keys for security — only send last 4 chars
  const masked = JSON.parse(JSON.stringify(cfg));
  if (masked.providers.groq.apiKey) {
    masked.providers.groq.apiKey = maskKey(masked.providers.groq.apiKey);
  }
  if (masked.providers.gemini.apiKey) {
    masked.providers.gemini.apiKey = maskKey(masked.providers.gemini.apiKey);
  }
  if (masked.providers.openai.apiKey) {
    masked.providers.openai.apiKey = maskKey(masked.providers.openai.apiKey);
  }
  res.json(masked);
});

// ─── PUT /config — update AI configuration (admin only) ───
router.put('/config', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const updates = req.body;

    // If API keys are masked (contain bullets), strip them so they don't overwrite real keys
    if (updates.providers) {
      for (const pName of ['groq', 'gemini', 'openai'] as const) {
        if (updates.providers[pName]?.apiKey && updates.providers[pName].apiKey.includes('•')) {
          delete updates.providers[pName].apiKey;
        }
      }
    }

    const saved = aiManager.saveConfig(updates);
    // Return masked version
    const masked = JSON.parse(JSON.stringify(saved));
    if (masked.providers.groq.apiKey) masked.providers.groq.apiKey = maskKey(masked.providers.groq.apiKey);
    if (masked.providers.gemini.apiKey) masked.providers.gemini.apiKey = maskKey(masked.providers.gemini.apiKey);
    if (masked.providers.openai.apiKey) masked.providers.openai.apiKey = maskKey(masked.providers.openai.apiKey);
    res.json({ success: true, config: masked });
  } catch (err: any) {
    console.error('[AI] PUT /config error:', err?.message || err);
    res.status(500).json({ error: 'Failed to save AI configuration' });
  }
});

// ─── GET /test/:provider — test a specific provider connection ───
router.get('/test/:provider', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const result = await aiManager.testProvider(req.params.provider);
    res.json(result);
  } catch (err: any) {
    console.error('[AI] /test error:', err?.message || err);
    res.status(500).json({ ok: false, latencyMs: 0, error: 'Test failed unexpectedly' });
  }
});

// ─── GET /stats — usage statistics ───
router.get('/stats', requireRole('admin'), (_req: Request, res: Response) => {
  res.json(aiManager.getUsageStats());
});

// ─── POST /analyze — call analysis (risk factors, flags, safety briefing) ───
router.post('/analyze', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), async (req: Request, res: Response) => {
  try {
    const { incident_type, description, notes, location_address, existing_flags } = req.body;

    if (!incident_type) {
      res.status(400).json({ error: 'incident_type is required' });
      return;
    }

    const result = await analyzeCall({ incident_type, description, notes, location_address, existing_flags });
    res.json({ available: isAIAvailable(), result });
  } catch (err: any) {
    console.error('[AI] /analyze error:', err?.message || err);
    res.status(500).json({ error: 'AI analysis failed' });
  }
});

// ─── POST /narrative — generate a CAD narrative from dispatcher notes ───
router.post('/narrative', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), async (req: Request, res: Response) => {
  try {
    const { notes, incident_type, location_address } = req.body;

    if (!notes || typeof notes !== 'string' || !notes.trim()) {
      res.status(400).json({ error: 'notes must be a non-empty string' });
      return;
    }

    const narrative = await generateNarrative({ notes, incident_type, location_address });
    res.json({ available: isAIAvailable(), narrative });
  } catch (err: any) {
    console.error('[AI] /narrative error:', err?.message || err);
    res.status(500).json({ error: 'Narrative generation failed' });
  }
});

// ─── POST /suggest-units — suggest best units to dispatch ───
router.post('/suggest-units', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), async (req: Request, res: Response) => {
  try {
    const { call, units } = req.body;

    if (!call || !Array.isArray(units)) {
      res.status(400).json({ error: 'call object and units array are required' });
      return;
    }

    const suggestions = await suggestUnits({ call, units });
    res.json({ available: isAIAvailable(), suggestions });
  } catch (err: any) {
    console.error('[AI] /suggest-units error:', err?.message || err);
    res.status(500).json({ error: 'Unit suggestion failed' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// System Health & Data Cleanup Endpoints
// ═══════════════════════════════════════════════════════════════════════════

// ─── GET /health — system health report (admin only) ───
router.get('/health', requireRole('admin'), async (_req: Request, res: Response) => {
  try {
    const [report, summary] = await Promise.all([
      checkSystemHealth(),
      getHealthSummary(),
    ]);
    res.json({ ...report, aiSummary: summary });
  } catch (err: any) {
    console.error('[AI] /health error:', err?.message || err);
    res.status(500).json({ error: 'Health check failed' });
  }
});

// ─── GET /cleanup/scan — run data cleanup scan (admin only) ───
router.get('/cleanup/scan', requireRole('admin'), async (_req: Request, res: Response) => {
  try {
    const report = await runDataCleanupScan();
    res.json(report);
  } catch (err: any) {
    console.error('[AI] /cleanup/scan error:', err?.message || err);
    res.status(500).json({ error: 'Data cleanup scan failed' });
  }
});

// ─── POST /cleanup/fix — execute a specific fix action (admin only) ───
router.post('/cleanup/fix', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { type, id, action } = req.body;

    if (!type || !id) {
      res.status(400).json({ error: 'type and id are required' });
      return;
    }

    let success = false;

    if (type === 'stale_call') {
      if (!['clear', 'close', 'escalate'].includes(action)) {
        res.status(400).json({ error: 'action must be clear, close, or escalate' });
        return;
      }
      success = await autoFixStaleCall(Number(id), action);
    } else if (type === 'orphaned_unit') {
      success = await autoFixOrphanedUnit(Number(id));
    } else {
      res.status(400).json({ error: 'type must be stale_call or orphaned_unit' });
      return;
    }

    if (success) {
      res.json({ success: true, message: `${type} #${id} fixed with action: ${action || 'reset'}` });
    } else {
      res.status(404).json({ error: `${type} #${id} not found` });
    }
  } catch (err: any) {
    console.error('[AI] /cleanup/fix error:', err?.message || err);
    res.status(500).json({ error: 'Fix action failed' });
  }
});

// ─── GET /cleanup/history — recent cleanup actions from audit log (admin only) ───
router.get('/cleanup/history', requireRole('admin'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, user_id, action, entity_type, entity_id, details, created_at
      FROM activity_log
      WHERE details LIKE '%AI Data Cleanup%'
      ORDER BY created_at DESC
      LIMIT 50
    `).all();
    res.json(rows);
  } catch (err: any) {
    console.error('[AI] /cleanup/history error:', err?.message || err);
    res.status(500).json({ error: 'Failed to fetch cleanup history' });
  }
});

// ─── Helpers ───

function maskKey(key: string): string {
  if (!key || key.length < 8) return key ? '••••' : '';
  return '••••••••' + key.slice(-4);
}

export default router;
