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
    const { status, q, page, per_page } = req.query;
    const pageNum = parseInt(page as string, 10) || 1;
    const perPage = parseInt(per_page as string, 10) || 25;

    let where = '1=1';
    const params: any[] = [];
    if (status) { where += ' AND d.status = ?'; params.push(status); }
    if (q) { where += ' AND LOWER(d.subject_name) LIKE LOWER(?)'; params.push(`%${q}%`); }

    const total = (db.prepare(`SELECT COUNT(*) as cnt FROM skiptracer_dossiers d WHERE ${where}`).get(...params) as any)?.cnt || 0;
    const dossiers = db.prepare(`
      SELECT d.*, u.full_name as created_by_name
      FROM skiptracer_dossiers d
      LEFT JOIN users u ON d.created_by = u.id
      WHERE ${where}
      ORDER BY d.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, perPage, (pageNum - 1) * perPage);

    // Frontend expects { dossiers: [...] }
    res.json({ dossiers, total, page: pageNum, per_page: perPage });
  } catch {
    // Table may not exist yet
    res.json({ dossiers: [], total: 0, page: 1, per_page: 25 });
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

// POST /dossiers — Create a new dossier
// Frontend sends: { subjectName, profileSnapshot, notes, tags }
// Also accepts legacy: { subject_name, subject_dob, notes, search_results }
router.post('/dossiers', (req: Request, res: Response) => {
  try {
    const db = getDb();
    // Accept both frontend camelCase and legacy snake_case field names
    const subjectName = req.body.subjectName || req.body.subject_name || 'Unknown';
    const subjectDob = req.body.subject_dob || null;
    const notes = req.body.notes || null;
    const searchResults = req.body.profileSnapshot || req.body.search_results || {};
    const tags = req.body.tags || [];
    const linkedIncidentId = req.body.linkedIncidentId || null;
    const linkedCaseId = req.body.linkedCaseId || null;

    const result = db.prepare(`
      INSERT INTO skiptracer_dossiers (subject_name, subject_dob, notes, search_results, status, created_by, created_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)
    `).run(
      subjectName,
      subjectDob,
      notes,
      JSON.stringify(searchResults),
      req.user!.userId,
      localNow()
    );

    const id = Number(result.lastInsertRowid);
    res.status(201).json({ id, dossierId: id });
  } catch (error: any) {
    console.error('[SkipTracer V2] Create dossier error:', error);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

// PUT /dossiers/:id — Update dossier (notes, status, etc.)
router.put('/dossiers/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = req.params.id;
    const dossier = db.prepare('SELECT * FROM skiptracer_dossiers WHERE id = ?').get(id);
    if (!dossier) { res.status(404).json({ error: 'Dossier not found', code: 'DOSSIER_NOT_FOUND' }); return; }

    const updates: string[] = [];
    const params: any[] = [];

    if (req.body.notes !== undefined) { updates.push('notes = ?'); params.push(req.body.notes); }
    if (req.body.status !== undefined) { updates.push('status = ?'); params.push(req.body.status); }
    if (req.body.subject_name !== undefined) { updates.push('subject_name = ?'); params.push(req.body.subject_name); }
    if (req.body.subjectName !== undefined) { updates.push('subject_name = ?'); params.push(req.body.subjectName); }
    if (req.body.search_results !== undefined) { updates.push('search_results = ?'); params.push(JSON.stringify(req.body.search_results)); }
    if (req.body.profileSnapshot !== undefined) { updates.push('search_results = ?'); params.push(JSON.stringify(req.body.profileSnapshot)); }

    if (updates.length === 0) { res.json({ success: true }); return; }

    params.push(id);
    db.prepare(`UPDATE skiptracer_dossiers SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[SkipTracer V2] Update dossier error:', error);
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

    // Search results / profile snapshot
    if (dossier.search_results) {
      let results: any = {};
      try { results = typeof dossier.search_results === 'string' ? JSON.parse(dossier.search_results) : dossier.search_results; } catch {}

      if (Object.keys(results).length > 0) {
        if (y > 250) { doc.addPage(); y = 20; }
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Profile Data', 15, y);
        y += 8;

        // Render profile fields in a readable format
        const renderField = (label: string, value: any) => {
          if (!value) return;
          if (y > 275) { doc.addPage(); y = 20; }
          doc.setFontSize(9);
          doc.setFont('helvetica', 'bold');
          doc.text(`${label}:`, 15, y);
          doc.setFont('helvetica', 'normal');
          const valStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
          const lines = doc.splitTextToSize(valStr, pageWidth - 65);
          doc.text(lines, 55, y);
          y += Math.max(lines.length * 4.5, 5);
        };

        // Render known profile fields
        renderField('Full Name', results.fullName);
        renderField('First Name', results.firstName);
        renderField('Last Name', results.lastName);
        renderField('DOB', results.dob);
        renderField('Gender', results.gender);
        renderField('Aliases', results.aliases?.join(', '));

        if (results.addresses?.length) {
          doc.setFontSize(11); doc.setFont('helvetica', 'bold');
          if (y > 270) { doc.addPage(); y = 20; }
          doc.text('Addresses', 15, y); y += 6;
          for (const addr of results.addresses) {
            const line = [addr.address || addr.street, addr.city, addr.state, addr.zip].filter(Boolean).join(', ');
            renderField(addr.type || 'Address', line || JSON.stringify(addr));
          }
        }
        if (results.phones?.length) {
          doc.setFontSize(11); doc.setFont('helvetica', 'bold');
          if (y > 270) { doc.addPage(); y = 20; }
          doc.text('Phones', 15, y); y += 6;
          for (const ph of results.phones) {
            renderField(ph.type || 'Phone', `${ph.number}${ph.carrier ? ` (${ph.carrier})` : ''}`);
          }
        }
        if (results.emails?.length) {
          doc.setFontSize(11); doc.setFont('helvetica', 'bold');
          if (y > 270) { doc.addPage(); y = 20; }
          doc.text('Emails', 15, y); y += 6;
          for (const em of results.emails) renderField(em.type || 'Email', em.email || em.address);
        }
        if (results.courtRecords?.length) {
          doc.setFontSize(11); doc.setFont('helvetica', 'bold');
          if (y > 270) { doc.addPage(); y = 20; }
          doc.text('Court Records', 15, y); y += 6;
          for (const cr of results.courtRecords) {
            renderField(cr.caseNumber || 'Case', `${cr.caseType || cr.type || ''} — ${cr.charge || cr.charges?.join('; ') || ''} (${cr.status || 'N/A'})`);
          }
        }
        if (results.associates?.length) {
          doc.setFontSize(11); doc.setFont('helvetica', 'bold');
          if (y > 270) { doc.addPage(); y = 20; }
          doc.text('Associates', 15, y); y += 6;
          for (const a of results.associates) renderField(a.relationship || 'Associate', a.name);
        }

        // Fallback: dump any remaining keys not already handled
        const handled = new Set(['fullName','firstName','lastName','middleName','suffix','dob','age','gender','ssn_last4','aliases','city','state','photoUrl','confidenceScore','sources','addresses','phones','emails','socialProfiles','associates','courtRecords','businesses','watchlistFlags','propertyRecords','licenses','vehicles','custodyRecords','sexOffenderRecords','id']);
        for (const [key, val] of Object.entries(results)) {
          if (!handled.has(key) && val && !(Array.isArray(val) && val.length === 0)) {
            renderField(key, val);
          }
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
    const startTime = Date.now();
    const { q, first_name, last_name, dob, address, phone, email, ssn_last4, categories } = req.query;

    // Search local persons database
    let where = '1=1';
    const params: any[] = [];

    // Handle free-text 'q' param — split into first/last name
    if (q) {
      const parts = (q as string).trim().split(/\s+/);
      if (parts.length >= 2) {
        where += ' AND (LOWER(first_name) LIKE LOWER(?) AND LOWER(last_name) LIKE LOWER(?))';
        params.push(`%${parts[0]}%`, `%${parts.slice(1).join(' ')}%`);
      } else {
        where += ' AND (LOWER(first_name) LIKE LOWER(?) OR LOWER(last_name) LIKE LOWER(?) OR LOWER(COALESCE(first_name,\'\') || \' \' || COALESCE(last_name,\'\')) LIKE LOWER(?))';
        params.push(`%${parts[0]}%`, `%${parts[0]}%`, `%${parts[0]}%`);
      }
    }

    if (first_name) { where += ' AND LOWER(first_name) LIKE LOWER(?)'; params.push(`%${first_name}%`); }
    if (last_name) { where += ' AND LOWER(last_name) LIKE LOWER(?)'; params.push(`%${last_name}%`); }
    if (dob) { where += ' AND dob = ?'; params.push(dob); }
    if (phone) { where += ' AND phone LIKE ?'; params.push(`%${phone}%`); }
    if (email) { where += ' AND LOWER(email) LIKE LOWER(?)'; params.push(`%${email}%`); }
    if (address) { where += ' AND LOWER(address) LIKE LOWER(?)'; params.push(`%${address}%`); }

    const localResults = db.prepare(`
      SELECT id, first_name, last_name, middle_name, dob, address, city, state, zip, phone, email, gender, race
      FROM persons WHERE ${where} LIMIT 50
    `).all(...params) as any[];

    const durationMs = Date.now() - startTime;

    // Transform local person records into the Profile shape the frontend expects
    const profiles = localResults.map((p: any) => ({
      id: String(p.id),
      fullName: [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' '),
      firstName: p.first_name || '',
      middleName: p.middle_name || '',
      lastName: p.last_name || '',
      dob: p.dob || undefined,
      gender: p.gender || undefined,
      city: p.city || undefined,
      state: p.state || undefined,
      confidenceScore: 100,
      sources: ['local_records'],
      addresses: p.address ? [{
        address: p.address,
        city: p.city,
        state: p.state,
        zip: p.zip,
        type: 'current',
        source: 'local_records',
      }] : [],
      phones: p.phone ? [{
        number: p.phone,
        type: 'primary',
        source: 'local_records',
      }] : [],
      emails: p.email ? [{
        email: p.email,
        type: 'primary',
        source: 'local_records',
      }] : [],
      associates: [],
      courtRecords: [],
      socialProfiles: [],
      businesses: [],
      watchlistFlags: [],
      propertyRecords: [],
      licenses: [],
      vehicles: [],
      custodyRecords: [],
      sexOffenderRecords: [],
    }));

    // Return in the format the frontend SearchResult interface expects
    res.json({
      profiles,
      sourcesQueried: ['local_records'],
      sourcesResponded: ['local_records'],
      sourcesFailed: [],
      totalResults: profiles.length,
      totalCost: 0,
      durationMs,
    });
  } catch (error: any) {
    console.error('[SkipTracer V2] Search error:', error);
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
    // Frontend expects { searches: [...] }
    res.json({ searches: history });
  } catch {
    res.json({ searches: [] });
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
