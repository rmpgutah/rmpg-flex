import { Router, Request, Response } from 'express';
import { authenticateToken, requireRole } from '../middleware/auth';
import { analyzeCall, generateNarrative, suggestUnits, isAIAvailable } from '../utils/groqAI';
import aiManager from '../utils/aiManager';
import { checkSystemHealth, getHealthSummary } from '../utils/aiSystemHealth';
import { runDataCleanupScan, autoFixStaleCall, autoFixOrphanedUnit } from '../utils/aiDataCleanup';
import { getDb } from '../models/database';
import { auditLog } from '../utils/auditLogger';

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
    try { auditLog(req, 'AI_CONFIG_UPDATE' as any, 'system_config' as any, 0, `AI configuration updated`); } catch { /* non-critical */ }
    // Return masked version
    const masked = JSON.parse(JSON.stringify(saved));
    if (masked.providers.groq.apiKey) masked.providers.groq.apiKey = maskKey(masked.providers.groq.apiKey);
    if (masked.providers.gemini.apiKey) masked.providers.gemini.apiKey = maskKey(masked.providers.gemini.apiKey);
    if (masked.providers.openai.apiKey) masked.providers.openai.apiKey = maskKey(masked.providers.openai.apiKey);
    res.json({ success: true, config: masked });
  } catch (err: any) {
    console.error('[AI] PUT /config error:', err?.message || err);
    res.status(500).json({ error: 'Failed to save AI configuration', code: 'AI_CONFIG_SAVE_ERROR' });
  }
});

// ─── GET /test/:provider — test a specific provider connection ───
router.get('/test/:provider', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const result = await aiManager.testProvider(req.params.provider);
    res.json(result);
  } catch (err: any) {
    console.error('[AI] /test error:', err?.message || err);
    res.status(500).json({ ok: false, latencyMs: 0, error: 'Test failed unexpectedly', code: 'AI_TEST_ERROR' });
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
      res.status(400).json({ error: 'incident_type is required', code: 'AI_MISSING_INCIDENT_TYPE' });
      return;
    }

    const result = await analyzeCall({ incident_type, description, notes, location_address, existing_flags });
    try { auditLog(req, 'AI_ANALYSIS' as any, 'call' as any, req.body.call_id || 0, `AI analysis requested for incident_type=${incident_type}`); } catch { /* non-critical */ }
    res.json({ available: isAIAvailable(), result });
  } catch (err: any) {
    console.error('[AI] /analyze error:', err?.message || err);
    res.status(500).json({ error: 'AI analysis failed', code: 'AI_ANALYSIS_ERROR' });
  }
});

// ─── POST /narrative — generate a CAD narrative from dispatcher notes ───
router.post('/narrative', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), async (req: Request, res: Response) => {
  try {
    const { notes, incident_type, location_address } = req.body;

    if (!notes || typeof notes !== 'string' || !notes.trim()) {
      res.status(400).json({ error: 'notes must be a non-empty string', code: 'AI_MISSING_NOTES' });
      return;
    }

    const narrative = await generateNarrative({ notes, incident_type, location_address });
    try { auditLog(req, 'AI_NARRATIVE' as any, 'call' as any, req.body.call_id || 0, `AI narrative generated for incident_type=${incident_type || 'unknown'}`); } catch { /* non-critical */ }
    res.json({ available: isAIAvailable(), narrative });
  } catch (err: any) {
    console.error('[AI] /narrative error:', err?.message || err);
    res.status(500).json({ error: 'Narrative generation failed', code: 'AI_NARRATIVE_ERROR' });
  }
});

// ─── POST /suggest-units — suggest best units to dispatch ───
router.post('/suggest-units', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), async (req: Request, res: Response) => {
  try {
    const { call, units } = req.body;

    if (!call || !Array.isArray(units)) {
      res.status(400).json({ error: 'call object and units array are required', code: 'AI_MISSING_CALL_OR_UNITS' });
      return;
    }

    const suggestions = await suggestUnits({ call, units });
    res.json({ available: isAIAvailable(), suggestions });
  } catch (err: any) {
    console.error('[AI] /suggest-units error:', err?.message || err);
    res.status(500).json({ error: 'Unit suggestion failed', code: 'AI_SUGGEST_UNITS_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Master AI Orchestrator Endpoints
// ═══════════════════════════════════════════════════════════════════════════

// ─── GET /activity — recent AI activity log (admin only) ───
router.get('/activity', requireRole('admin'), (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  res.json(aiManager.getActivityLog(limit));
});

// ─── GET /master-config — master prompt + chain mode + routing (admin only) ───
router.get('/master-config', requireRole('admin'), (_req: Request, res: Response) => {
  const config = aiManager.getConfig();
  res.json({
    masterPrompt: config.masterPrompt,
    chainMode: config.chainMode,
    routingRules: config.routingRules,
    providerPriority: config.providerPriority,
  });
});

// ─── PUT /master-config — update master prompt + chain mode + routing (admin only) ───
router.put('/master-config', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { masterPrompt, chainMode, routingRules, providerPriority } = req.body;
    const updates: any = {};

    if (masterPrompt !== undefined) updates.masterPrompt = masterPrompt;
    if (chainMode !== undefined) updates.chainMode = chainMode;
    if (routingRules) updates.routingRules = routingRules;
    if (providerPriority && Array.isArray(providerPriority)) updates.providerPriority = providerPriority;

    aiManager.saveConfig(updates);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[AI] PUT /master-config error:', err?.message || err);
    res.status(500).json({ error: 'Failed to save master AI configuration', code: 'AI_MASTER_CONFIG_SAVE_ERROR' });
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
    res.status(500).json({ error: 'Health check failed', code: 'AI_HEALTH_CHECK_ERROR' });
  }
});

// ─── GET /cleanup/scan — run data cleanup scan (admin only) ───
router.get('/cleanup/scan', requireRole('admin'), async (_req: Request, res: Response) => {
  try {
    const report = await runDataCleanupScan();
    res.json(report);
  } catch (err: any) {
    console.error('[AI] /cleanup/scan error:', err?.message || err);
    res.status(500).json({ error: 'Data cleanup scan failed', code: 'AI_CLEANUP_SCAN_ERROR' });
  }
});

// ─── POST /cleanup/fix — execute a specific fix action (admin only) ───
router.post('/cleanup/fix', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { type, id, action } = req.body;

    if (!type || !id) {
      res.status(400).json({ error: 'type and id are required', code: 'AI_CLEANUP_MISSING_PARAMS' });
      return;
    }

    let success = false;

    if (type === 'stale_call') {
      if (!['clear', 'close', 'escalate'].includes(action)) {
        res.status(400).json({ error: 'action must be clear, close, or escalate', code: 'AI_CLEANUP_INVALID_ACTION' });
        return;
      }
      success = await autoFixStaleCall(Number(id), action);
    } else if (type === 'orphaned_unit') {
      success = await autoFixOrphanedUnit(Number(id));
    } else {
      res.status(400).json({ error: 'type must be stale_call or orphaned_unit', code: 'AI_CLEANUP_INVALID_TYPE' });
      return;
    }

    if (success) {
      res.json({ success: true, message: `${type} #${id} fixed with action: ${action || 'reset'}` });
    } else {
      res.status(404).json({ error: `${type} #${id} not found`, code: 'AI_CLEANUP_NOT_FOUND' });
    }
  } catch (err: any) {
    console.error('[AI] /cleanup/fix error:', err?.message || err);
    res.status(500).json({ error: 'Fix action failed', code: 'AI_CLEANUP_FIX_ERROR' });
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
    res.status(500).json({ error: 'Failed to fetch cleanup history', code: 'AI_CLEANUP_HISTORY_ERROR' });
  }
});

// ─── POST /smart-search — parse natural language into structured search filters ───
router.post('/smart-search', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (req: Request, res: Response) => {
  try {
    const { query, searchType } = req.body;
    if (!query || typeof query !== 'string' || !query.trim()) {
      res.status(400).json({ error: 'query is required', code: 'AI_SMART_SEARCH_MISSING_QUERY' });
      return;
    }

    const validTypes = ['persons', 'vehicles', 'incidents'];
    const type = validTypes.includes(searchType) ? searchType : 'general';

    const schemaHints: Record<string, string> = {
      persons: 'For persons: { name, dob, race, gender, height, weight, hair, eyes, address }.',
      vehicles: 'For vehicles: { plate, make, model, color, year_min, year_max }.',
      incidents: 'For incidents: { type, date_from, date_to, location, status }.',
      general: 'For persons: { name, dob, race, gender, height, weight, hair, eyes, address }. For vehicles: { plate, make, model, color, year_min, year_max }. For incidents: { type, date_from, date_to, location, status }.',
    };

    const result = await aiManager.chat(
      `You are a police records search assistant. Parse the user's natural language search query into structured filters for a ${type} search. Return JSON with relevant filter fields. ${schemaHints[type]} Only include fields mentioned in the query. Return ONLY valid JSON, no markdown.`,
      query,
      { taskType: 'general', maxTokens: 200, jsonMode: true }
    );

    if (!result) {
      res.json({ available: false, filters: null });
      return;
    }

    try {
      const filters = JSON.parse(result);
      res.json({ available: true, filters });
    } catch {
      res.json({ available: false, filters: null });
    }
  } catch (err: any) {
    console.error('[AI] /smart-search error:', err?.message || err);
    res.status(500).json({ error: 'Smart search failed', code: 'AI_SMART_SEARCH_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Enhanced AI Admin Endpoints
// ═══════════════════════════════════════════════════════════════════════════

// ─── Model Parameters ───
router.get('/model-params', requireRole('admin'), (_req: Request, res: Response) => {
  const cfg = aiManager.getConfig();
  res.json({
    defaultParams: cfg.defaultParams,
    featureParams: cfg.featureParams,
  });
});

router.put('/model-params', requireRole('admin'), (req: Request, res: Response) => {
  const { defaultParams, featureParams } = req.body;
  aiManager.saveConfig({ defaultParams, featureParams });
  res.json({ success: true });
});

// ─── Model Presets ───
router.get('/presets', requireRole('admin'), (_req: Request, res: Response) => {
  const database = getDb();
  const presets = database.prepare('SELECT * FROM ai_model_presets ORDER BY name').all();
  res.json(presets);
});

router.post('/presets', requireRole('admin'), (req: Request, res: Response) => {
  const { name, temperature, max_tokens, top_p, repeat_penalty } = req.body;
  if (!name) { res.status(400).json({ error: 'name required' }); return; }
  const database = getDb();
  const result = database.prepare(
    'INSERT INTO ai_model_presets (name, temperature, max_tokens, top_p, repeat_penalty) VALUES (?, ?, ?, ?, ?)'
  ).run(name, temperature ?? 0.3, max_tokens ?? 500, top_p ?? 0.9, repeat_penalty ?? 1.1);
  res.status(201).json({ success: true, id: result.lastInsertRowid });
});

router.delete('/presets/:id', requireRole('admin'), (req: Request, res: Response) => {
  const database = getDb();
  database.prepare('DELETE FROM ai_model_presets WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─── Prompt Templates ───
router.get('/templates', requireRole('admin'), (_req: Request, res: Response) => {
  const database = getDb();
  const templates = database.prepare('SELECT * FROM ai_prompt_templates ORDER BY category, name').all();
  res.json(templates);
});

router.post('/templates', requireRole('admin'), (req: Request, res: Response) => {
  const { name, category, system_prompt, user_prompt_template, variables } = req.body;
  if (!name || !category || !system_prompt) { res.status(400).json({ error: 'name, category, system_prompt required' }); return; }
  const database = getDb();
  const result = database.prepare(
    'INSERT INTO ai_prompt_templates (name, category, system_prompt, user_prompt_template, variables) VALUES (?, ?, ?, ?, ?)'
  ).run(name, category, system_prompt, user_prompt_template || '', JSON.stringify(variables || []));
  res.status(201).json({ success: true, id: result.lastInsertRowid });
});

router.put('/templates/:id', requireRole('admin'), (req: Request, res: Response) => {
  const { name, category, system_prompt, user_prompt_template, variables } = req.body;
  const database = getDb();
  database.prepare(
    `UPDATE ai_prompt_templates SET name=?, category=?, system_prompt=?, user_prompt_template=?, variables=?, updated_at=datetime('now','localtime') WHERE id=?`
  ).run(name, category, system_prompt, user_prompt_template || '', JSON.stringify(variables || []), req.params.id);
  res.json({ success: true });
});

router.delete('/templates/:id', requireRole('admin'), (req: Request, res: Response) => {
  const database = getDb();
  database.prepare('DELETE FROM ai_prompt_templates WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─── Prompt Testing ───
router.post('/prompt-test', requireRole('admin'), async (req: Request, res: Response) => {
  const { systemPrompt, userMessage, temperature, maxTokens } = req.body;
  if (!systemPrompt || !userMessage) { res.status(400).json({ error: 'systemPrompt and userMessage required' }); return; }
  const start = Date.now();
  try {
    const response = await aiManager.chat(systemPrompt, userMessage, {
      taskType: 'general',
      temperature: temperature ?? 0.3,
      maxTokens: maxTokens ?? 500,
    });
    res.json({ content: response, latencyMs: Date.now() - start });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Test failed' });
  }
});

// ─── Behavior Config ───
router.get('/behavior', requireRole('admin'), (_req: Request, res: Response) => {
  const cfg = aiManager.getConfig();
  res.json(cfg.behavior);
});

router.put('/behavior', requireRole('admin'), (req: Request, res: Response) => {
  aiManager.saveConfig({ behavior: req.body });
  res.json({ success: true });
});

// ─── Enhanced Activity Log (from DB) ───
router.get('/activity-log', requireRole('admin'), (req: Request, res: Response) => {
  const database = getDb();
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const offset = parseInt(req.query.offset as string) || 0;
  const taskType = req.query.taskType as string;
  const from = req.query.from as string;
  const to = req.query.to as string;

  let where = 'WHERE 1=1';
  const params: any[] = [];
  if (taskType && taskType !== 'all') { where += ' AND task_type = ?'; params.push(taskType); }
  if (from) { where += ' AND created_at >= ?'; params.push(from); }
  if (to) { where += ' AND created_at <= ?'; params.push(to + ' 23:59:59'); }

  const total = (database.prepare(`SELECT COUNT(*) as count FROM ai_activity_log ${where}`).get(...params) as any).count;
  const rows = database.prepare(`SELECT * FROM ai_activity_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  res.json({ rows, total, limit, offset });
});

router.get('/activity-log/export/csv', requireRole('admin'), (_req: Request, res: Response) => {
  const database = getDb();
  const rows = database.prepare('SELECT id, task_type, provider, model, latency_ms, success, error, prompt_preview, tokens_used, rating, created_at FROM ai_activity_log ORDER BY id DESC LIMIT 1000').all() as any[];

  const headers = 'id,task_type,provider,model,latency_ms,success,error,prompt_preview,tokens_used,rating,created_at';
  const csvRows = rows.map((r: any) =>
    `${r.id},"${r.task_type}","${r.provider}","${r.model || ''}",${r.latency_ms},${r.success},"${(r.error || '').replace(/"/g, '""')}","${(r.prompt_preview || '').replace(/"/g, '""')}",${r.tokens_used || 0},${r.rating || ''},${r.created_at}`
  );

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=ai-activity-log.csv');
  res.send(headers + '\n' + csvRows.join('\n'));
});

router.get('/activity-log/:id', requireRole('admin'), (req: Request, res: Response) => {
  const database = getDb();
  const row = database.prepare('SELECT * FROM ai_activity_log WHERE id = ?').get(req.params.id);
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(row);
});

router.put('/activity-log/:id/rate', requireRole('admin'), (req: Request, res: Response) => {
  const { rating } = req.body;
  const database = getDb();
  database.prepare('UPDATE ai_activity_log SET rating = ? WHERE id = ?').run(rating, req.params.id);
  res.json({ success: true });
});


// ─── Helpers ───

function maskKey(key: string): string {
  if (!key || key.length < 8) return key ? '••••' : '';
  return '••••••••' + key.slice(-4);
}

export default router;
