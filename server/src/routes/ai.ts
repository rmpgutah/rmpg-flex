import { Router, Request, Response } from 'express';
import { authenticateToken, requireRole } from '../middleware/auth';
import { analyzeCall, generateNarrative, suggestUnits, isAIAvailable } from '../utils/groqAI';

const router = Router();
router.use(authenticateToken);

// GET /status — check if AI API key is configured
router.get('/status', (_req: Request, res: Response) => {
  res.json({ available: isAIAvailable() });
});

// POST /analyze — call analysis (risk factors, flags, safety briefing)
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

// POST /narrative — generate a CAD narrative from dispatcher notes
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

// POST /suggest-units — suggest best units to dispatch
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

export default router;
