// ============================================================
// SkipTracer V2 — Enhanced Skip Tracing with Dossier Support
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';

const router = Router();
router.use(authenticateToken);

// ─── Sources ───────────────────────────────────────────────

router.get('/sources', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    // Return configured search sources
    const sources = db.prepare(
      "SELECT config_key, config_value FROM system_config WHERE category = 'skiptracer' AND is_active = 1"
    ).all() as { config_key: string; config_value: string }[];

    const sourceList = [
      { name: 'microbilt', label: 'MicroBilt', enabled: sources.some(s => s.config_key === 'microbilt_enabled' && s.config_value === '1'), type: 'api' },
      { name: 'local_records', label: 'Local Records', enabled: true, type: 'local' },
    ];

    res.json(sourceList);
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

router.put('/sources/:name/config', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name } = req.params;
    const key = `${name}_enabled`;
    const value = req.body.enabled ? '1' : '0';

    const existing = db.prepare(
      "SELECT id FROM system_config WHERE config_key = ? AND category = 'skiptracer'"
    ).get(key) as any;

    if (existing) {
      db.prepare("UPDATE system_config SET config_value = ? WHERE id = ?").run(value, existing.id);
    } else {
      db.prepare("INSERT INTO system_config (config_key, config_value, category, is_active) VALUES (?, ?, 'skiptracer', 1)").run(key, value);
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

// ─── Dossiers ──────────────────────────────────────────────

router.get('/dossiers', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, page, per_page } = req.query;
    const pageNum = parseInt(page as string, 10) || 1;
    const perPage = parseInt(per_page as string, 10) || 25;

    let where = '1=1';
    const params: any[] = [];
    if (status) { where += ' AND status = ?'; params.push(status); }

    const total = (db.prepare(`SELECT COUNT(*) as cnt FROM skiptracer_dossiers WHERE ${where}`).get(...params) as any)?.cnt || 0;
    const dossiers = db.prepare(`
      SELECT d.*, u.full_name as created_by_name
      FROM skiptracer_dossiers d
      LEFT JOIN users u ON d.created_by = u.id
      WHERE ${where}
      ORDER BY d.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, perPage, (pageNum - 1) * perPage);

    res.json({ data: dossiers, total, page: pageNum, per_page: perPage });
  } catch {
    // Table may not exist yet
    res.json({ data: [], total: 0, page: 1, per_page: 25 });
  }
});

router.get('/dossiers/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const dossier = db.prepare('SELECT * FROM skiptracer_dossiers WHERE id = ?').get(req.params.id);
    if (!dossier) { res.status(404).json({ error: 'Dossier not found', code: 'DOSSIER_NOT_FOUND' }); return; }
    res.json(dossier);
  } catch {
    res.status(404).json({ error: 'Dossier not found', code: 'DOSSIER_NOT_FOUND' });
  }
});

router.post('/dossiers', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { subject_name, subject_dob, notes, search_results } = req.body;
    const result = db.prepare(`
      INSERT INTO skiptracer_dossiers (subject_name, subject_dob, notes, search_results, status, created_by, created_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)
    `).run(subject_name, subject_dob || null, notes || null, JSON.stringify(search_results || {}), req.user!.userId, localNow());
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  } catch {
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

router.delete('/dossiers/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM skiptracer_dossiers WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

router.get('/dossiers/:id/pdf', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const dossier = db.prepare('SELECT * FROM skiptracer_dossiers WHERE id = ?').get(req.params.id) as any;
    if (!dossier) { res.status(404).json({ error: 'Dossier not found', code: 'DOSSIER_NOT_FOUND' }); return; }

    const { jsPDF } = require('jspdf');
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 20;

    // Title
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('SkipTracer Dossier Report', pageWidth / 2, y, { align: 'center' });
    y += 12;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Generated: ${localNow()}`, pageWidth / 2, y, { align: 'center' });
    y += 10;

    // Divider
    doc.setDrawColor(100);
    doc.line(15, y, pageWidth - 15, y);
    y += 10;

    // Subject info
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Subject Information', 15, y);
    y += 8;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    const fields: [string, string][] = [
      ['Name', dossier.subject_name || 'N/A'],
      ['Date of Birth', dossier.subject_dob || 'N/A'],
      ['Status', dossier.status || 'N/A'],
      ['Created', dossier.created_at || 'N/A'],
    ];

    for (const [label, value] of fields) {
      doc.setFont('helvetica', 'bold');
      doc.text(`${label}:`, 15, y);
      doc.setFont('helvetica', 'normal');
      doc.text(String(value), 60, y);
      y += 7;
    }
    y += 5;

    // Notes
    if (dossier.notes) {
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('Notes', 15, y);
      y += 8;
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      const noteLines = doc.splitTextToSize(dossier.notes, pageWidth - 30);
      doc.text(noteLines, 15, y);
      y += noteLines.length * 5 + 5;
    }

    // Search results
    if (dossier.search_results) {
      let results: any = {};
      try { results = typeof dossier.search_results === 'string' ? JSON.parse(dossier.search_results) : dossier.search_results; } catch {}

      if (Object.keys(results).length > 0) {
        if (y > 250) { doc.addPage(); y = 20; }
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Search Results', 15, y);
        y += 8;
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        const resultText = JSON.stringify(results, null, 2);
        const resultLines = doc.splitTextToSize(resultText, pageWidth - 30);
        for (const line of resultLines) {
          if (y > 280) { doc.addPage(); y = 20; }
          doc.text(line, 15, y);
          y += 4.5;
        }
      }
    }

    // Footer
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'italic');
      doc.text(`RMPG Flex — SkipTracer Dossier #${dossier.id} — Page ${i} of ${totalPages}`, pageWidth / 2, 290, { align: 'center' });
    }

    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="dossier_${dossier.id}_${(dossier.subject_name || 'unknown').replace(/\s+/g, '_')}.pdf"`);
    res.send(pdfBuffer);
  } catch (error: any) {
    console.error('[SkipTracer V2] PDF export error:', error);
    res.status(500).json({ error: 'Failed to generate PDF', code: 'PDF_EXPORT_ERROR' });
  }
});

// ─── Search ────────────────────────────────────────────────

router.get('/search', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { first_name, last_name, dob, address, phone, email, ssn_last4 } = req.query;

    // Search local persons database
    let where = '1=1';
    const params: any[] = [];

    if (first_name) { where += ' AND LOWER(first_name) LIKE LOWER(?)'; params.push(`%${first_name}%`); }
    if (last_name) { where += ' AND LOWER(last_name) LIKE LOWER(?)'; params.push(`%${last_name}%`); }
    if (dob) { where += ' AND dob = ?'; params.push(dob); }
    if (phone) { where += ' AND phone LIKE ?'; params.push(`%${phone}%`); }

    const localResults = db.prepare(`
      SELECT id, first_name, last_name, dob, address, phone, email
      FROM persons WHERE ${where} LIMIT 50
    `).all(...params);

    res.json({
      results: localResults.map((p: any) => ({
        ...p,
        source: 'local_records',
        confidence: 100,
      })),
      total: localResults.length,
      sources_checked: ['local_records'],
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

// ─── History ───────────────────────────────────────────────

router.get('/history', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const history = db.prepare(`
      SELECT al.*, u.full_name as user_name
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.action LIKE '%skiptracer%' OR al.entity_type = 'skiptracer'
      ORDER BY al.created_at DESC
      LIMIT 100
    `).all();
    res.json(history);
  } catch {
    res.json([]);
  }
});

// ─── Stats ─────────────────────────────────────────────────

router.get('/stats', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const totalSearches = (db.prepare(
      "SELECT COUNT(*) as cnt FROM activity_log WHERE action LIKE '%skiptracer%'"
    ).get() as any)?.cnt || 0;

    const totalDossiers = (() => {
      try { return (db.prepare('SELECT COUNT(*) as cnt FROM skiptracer_dossiers').get() as any)?.cnt || 0; } catch { return 0; }
    })();

    res.json({
      totalSearches,
      totalDossiers,
      sourcesActive: 1,
      lastSearchAt: null,
    });
  } catch {
    res.json({ totalSearches: 0, totalDossiers: 0, sourcesActive: 0, lastSearchAt: null });
  }
});

export default router;
