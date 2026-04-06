// ============================================================
// Colorado DOC Offender Search Routes
// ============================================================
// API endpoints for searching Colorado Department of Corrections
// offender records. Proxies live queries to CDOC's public search
// and caches results locally.
// ============================================================

import { Router, Request, Response } from 'express';
import { authenticateToken, requireRole } from '../middleware/auth';
import { searchCdocOffenders, getCdocOffender, getCdocStats } from '../utils/coloradoDocScraper';
import { auditLog } from '../utils/auditLogger';

const router = Router();
router.use(authenticateToken);

// GET /api/colorado-doc/search — Search CDOC offenders by name
router.get('/search', async (req: Request, res: Response) => {
  try {
    const { lastName, firstName } = req.query;

    if (!lastName || (lastName as string).trim().length < 2) {
      res.status(400).json({ error: 'lastName is required (minimum 2 characters)' });
      return;
    }

    const results = await searchCdocOffenders(
      lastName as string,
      firstName as string | undefined
    );

    auditLog(req, 'SEARCH', 'colorado_doc_offenders', 0,
      JSON.stringify({ query: { lastName, firstName }, results: results.length }));

    res.json({ data: results, total: results.length });
  } catch (error: any) {
    console.error('CDOC search error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Colorado DOC search failed' });
  }
});

// GET /api/colorado-doc/offender/:docNumber — Get specific offender by DOC number
router.get('/offender/:docNumber', (req: Request, res: Response) => {
  try {
    const offender = getCdocOffender(req.params.docNumber as string);
    if (!offender) {
      res.status(404).json({ error: 'Offender not found' });
      return;
    }
    res.json(offender);
  } catch (error: any) {
    console.error('CDOC offender lookup error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/colorado-doc/stats — Get CDOC cache statistics
router.get('/stats', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const stats = getCdocStats();
    res.json(stats);
  } catch (error: any) {
    console.error('CDOC stats error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
