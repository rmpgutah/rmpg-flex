// ============================================================
// IPED Digital Forensics API Routes
// ============================================================
// Configuration, hash computation, job processing,
// hash set management, and IPED Web API proxy.
// ============================================================

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getDb } from '../models/database';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { authenticateToken, requireRole } from '../middleware/auth';
import { validateParamId } from '../middleware/sanitize';
import { localNow } from '../utils/timeUtils';
import { auditLog } from '../utils/auditLogger';
import { broadcast } from '../utils/websocket';
import {
  getIpedConfig,
  setIpedConfigValues,
  clearIpedConfig,
  validateIpedInstallation,
  computeFileHashes,
  hashEvidenceAttachments,
  runIpedProcess,
  cancelIpedJob,
  getJobProgress,
  proxyIpedApi,
  testIpedApiConnection,
  importHashSet,
  importToIpedHashDb,
  getHashSetSummary,
  removeHashSet,
  checkAgainstHashSets,
  getIpedUsageStats,
} from '../utils/ipedManager';

const router = Router();
router.use(authenticateToken);

// ── GET /status — Configuration and installation status ─────
router.get('/status', (_req: Request, res: Response) => {
  try {
    const cfg = getIpedConfig();
    const stats = getIpedUsageStats();
    res.json({ ...cfg, ...stats });
  } catch (err: any) {
    console.error('IPED error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /config — Save IPED configuration ───────────────────
router.put('/config', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { installPath, javaHome, webApiUrl, webApiPort, defaultProfile,
            photodnaEnabled, autoHashOnUpload, hashSetsPath } = req.body;

    const values: Record<string, string> = {};
    if (installPath !== undefined) values.installPath = installPath;
    if (javaHome !== undefined) values.javaHome = javaHome;
    if (webApiUrl !== undefined) values.webApiUrl = webApiUrl;
    if (webApiPort !== undefined) values.webApiPort = String(webApiPort);
    if (defaultProfile !== undefined) values.defaultProfile = defaultProfile;
    if (photodnaEnabled !== undefined) values.photodnaEnabled = String(photodnaEnabled);
    if (autoHashOnUpload !== undefined) values.autoHashOnUpload = String(autoHashOnUpload);
    if (hashSetsPath !== undefined) values.hashSetsPath = hashSetsPath;

    setIpedConfigValues(values);
    auditLog(req, 'iped_config_updated', 'config', 'iped', `IPED config updated: ${Object.keys(values).join(', ')}`);
    res.json({ success: true, message: 'IPED configuration saved' });
  } catch (err: any) {
    console.error('IPED error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /config — Clear IPED configuration ───────────────
router.delete('/config', requireRole('admin'), (req: Request, res: Response) => {
  try {
    clearIpedConfig();
    auditLog(req, 'iped_config_cleared', 'config', 'iped', 'IPED configuration cleared');
    res.json({ success: true, message: 'IPED configuration cleared' });
  } catch (err: any) {
    console.error('IPED error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /validate — Validate IPED installation ─────────────
router.post('/validate', requireRole('admin'), (_req: Request, res: Response) => {
  try {
    const result = validateIpedInstallation();
    res.json(result);
  } catch (err: any) {
    console.error('IPED error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /test-api — Test IPED Web API connectivity ─────────
router.post('/test-api', requireRole('admin'), async (_req: Request, res: Response) => {
  try {
    const result = await testIpedApiConnection();
    res.json(result);
  } catch (err: any) {
    console.error('IPED error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /download/info — IPED bundle availability ───────────
router.get('/download/info', (_req: Request, res: Response) => {
  try {
    const downloadsDir = path.resolve(__dirname, '../../downloads');
    const bundles: Record<string, any> = {};

    if (fs.existsSync(downloadsDir)) {
      const files = fs.readdirSync(downloadsDir);
      for (const file of files) {
        if (!file.startsWith('IPED-') || !file.endsWith('.zip')) continue;
        const versionMatch = file.match(/(\d+\.\d+\.\d+)/);
        const version = versionMatch ? versionMatch[1] : 'unknown';
        const stat = fs.statSync(path.join(downloadsDir, file));

        if (file.includes('-mac') || file.includes('-darwin')) {
          bundles.mac = { filename: file, version, size: stat.size };
        } else if (file.includes('-win')) {
          bundles.win = { filename: file, version, size: stat.size };
        } else if (file.includes('-linux')) {
          bundles.linux = { filename: file, version, size: stat.size };
        }
      }
    }

    res.json({
      available: Object.keys(bundles).length > 0,
      bundles,
      downloadUrl: '/downloads',
      githubUrl: 'https://github.com/sepinf-inc/IPED/releases',
    });
  } catch (err: any) {
    console.error('IPED error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /jobs — Create a processing job ────────────────────
router.post('/jobs', requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { evidenceId, jobType, inputPath, outputPath, profile } = req.body;
    const userId = req.user?.userId;

    // Validate profile to prevent shell injection in IPED command
    if (profile && !/^[a-zA-Z0-9_-]+$/.test(profile)) {
      return res.status(400).json({ error: 'Invalid profile name — only alphanumeric, dashes, underscores allowed' });
    }

    if (!inputPath) return res.status(400).json({ error: 'inputPath is required' });
    if (!['hash', 'process', 'triage', 'csam_scan'].includes(jobType)) {
      return res.status(400).json({ error: 'Invalid jobType (hash/process/triage/csam_scan)' });
    }

    // Validate input path — block shell metacharacters and traversal
    if (/[;|&`$(){}]/.test(inputPath)) {
      return res.status(400).json({ error: 'Input path contains invalid characters' });
    }

    // Validate path exists
    if (!fs.existsSync(inputPath)) {
      return res.status(400).json({ error: 'Input path does not exist' });
    }

    const result = db.prepare(`
      INSERT INTO iped_jobs (evidence_id, job_type, status, profile, input_path, output_path, created_by, created_at, updated_at)
      VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?)
    `).run(evidenceId || null, jobType, profile || 'forensic', inputPath, outputPath || null, userId, now, now);

    const jobId = result.lastInsertRowid as number;

    // If it's a hash job on evidence, use Tier 1 built-in hashing
    if (jobType === 'hash' && evidenceId) {
      db.prepare('UPDATE iped_jobs SET status = ?, started_at = ?, updated_at = ? WHERE id = ?')
        .run('running', now, now, jobId);

      try {
        const hashResult = await hashEvidenceAttachments(evidenceId);
        db.prepare(`
          UPDATE iped_jobs SET status = 'completed', completed_at = ?, progress_percent = 100,
            items_found = ?, items_processed = ?, result_summary = ?, updated_at = ? WHERE id = ?
        `).run(
          localNow(), hashResult.hashed + hashResult.errors, hashResult.hashed,
          `Hashed: ${hashResult.hashed}, Errors: ${hashResult.errors}, Flagged: ${hashResult.flagged}`,
          localNow(), jobId
        );

        // Update evidence record
        db.prepare('UPDATE evidence SET iped_processed = 1, iped_last_job_id = ? WHERE id = ?')
          .run(jobId, evidenceId);

        return res.json({ success: true, jobId, completed: true, ...hashResult });
      } catch (err: any) {
        db.prepare("UPDATE iped_jobs SET status = 'failed', completed_at = ?, error_message = ?, updated_at = ? WHERE id = ?")
          .run(localNow(), err?.message || err, localNow(), jobId);
        console.error('IPED job error:', err?.message || err);
        return res.status(500).json({ error: 'Processing failed', jobId });
      }
    }

    // For IPED processing jobs, launch asynchronously
    if (jobType !== 'hash') {
      runIpedProcess({
        jobId,
        evidenceId: evidenceId || undefined,
        inputPath,
        outputPath: outputPath || path.join(inputPath, '../iped-output'),
        profile,
        jobType,
        createdBy: userId!,
      }).catch(err => {
        console.error(`[IPED] Job ${jobId} failed:`, err?.message || err);
      });
    }

    auditLog(req, 'iped_job_created', 'iped_job', jobId, `IPED ${jobType} job created for input: ${inputPath}`);
    res.json({ success: true, jobId, status: 'queued' });
  } catch (err: any) {
    console.error('IPED error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /jobs — List processing jobs ────────────────────────
router.get('/jobs', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const page = Math.min(10000, Math.max(1, parseInt(req.query.page as string, 10) || 1));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const offset = (page - 1) * limit;
    const status = (req.query.status as string || '').trim();

    let where = '';
    const params: any[] = [];
    if (status) {
      where = 'WHERE j.status = ?';
      params.push(status);
    }

    const total = (db.prepare(
      `SELECT COUNT(*) as c FROM iped_jobs j ${where}`
    ).get(...params) as any)?.c || 0;

    params.push(limit, offset);
    const jobs = db.prepare(`
      SELECT j.*, u.full_name as created_by_name
      FROM iped_jobs j
      LEFT JOIN users u ON j.created_by = u.id
      ${where}
      ORDER BY j.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params) as any[];

    res.json({ jobs, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err: any) {
    console.error('IPED error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /jobs/:id — Job details ─────────────────────────────
router.get('/jobs/:id', validateParamId, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const job = db.prepare(`
      SELECT j.*, u.full_name as created_by_name
      FROM iped_jobs j LEFT JOIN users u ON j.created_by = u.id
      WHERE j.id = ?
    `).get(id) as any;

    if (!job) return res.status(404).json({ error: 'Job not found' });

    // Get associated hash results
    const hashes = db.prepare(
      'SELECT * FROM digital_evidence_hashes WHERE iped_job_id = ? ORDER BY created_at'
    ).all(id) as any[];

    // Get live progress if running
    const progress = job.status === 'running' ? getJobProgress(id) : null;

    res.json({ ...job, hashes, progress });
  } catch (err: any) {
    console.error('IPED error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /jobs/:id/cancel — Cancel running job ──────────────
router.post('/jobs/:id/cancel', validateParamId, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const cancelled = cancelIpedJob(id);
    if (cancelled) auditLog(req, 'iped_job_cancelled', 'iped_job', id, `IPED job ${id} cancelled`);
    res.json({ success: cancelled, message: cancelled ? 'Job cancelled' : 'Job not running' });
  } catch (err: any) {
    console.error('IPED error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /hash/compute — Hash a single file ─────────────────
router.post('/hash/compute', requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const { filePath, attachmentId, evidenceId } = req.body;

    if (!filePath && !attachmentId) {
      return res.status(400).json({ error: 'filePath or attachmentId required' });
    }

    let targetPath = filePath;
    // Validate user-supplied filePath doesn't traverse outside expected directories
    if (filePath && (filePath.includes('..') || filePath.includes('\0'))) {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    if (attachmentId && !filePath) {
      const db = getDb();
      const att = db.prepare('SELECT file_path FROM attachments WHERE id = ?').get(attachmentId) as any;
      if (!att) return res.status(404).json({ error: 'Attachment not found' });
      const uploadsDir = process.env.RMPG_UPLOADS_DIR || path.resolve(process.cwd(), 'uploads');
      targetPath = path.join(uploadsDir, att.file_path);
      // Prevent path traversal — ensure resolved path stays within uploads directory
      const resolved = path.resolve(targetPath);
      if (!resolved.startsWith(path.resolve(uploadsDir))) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const hashes = await computeFileHashes(targetPath);
    const matches = checkAgainstHashSets(hashes);

    res.json({ ...hashes, matches, flagged: matches.length > 0 });
  } catch (err: any) {
    console.error('IPED error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /hash/batch — Batch hash all evidence attachments ──
router.post('/hash/batch', requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const { evidenceId } = req.body;
    if (!evidenceId) return res.status(400).json({ error: 'evidenceId required' });

    const result = await hashEvidenceAttachments(evidenceId);
    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('IPED error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /hash/results — Query hash results ──────────────────
router.get('/hash/results', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const evidenceId = req.query.evidenceId ? parseInt(req.query.evidenceId as string, 10) : null;
    const hashValue = (req.query.hash as string || '').trim();
    const flaggedOnly = req.query.flagged === 'true';

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (evidenceId) { where += ' AND h.evidence_id = ?'; params.push(evidenceId); }
    if (hashValue) { where += ' AND (h.md5 = ? OR h.sha256 = ?)'; params.push(hashValue, hashValue); }
    if (flaggedOnly) { where += ' AND h.flagged = 1'; }

    const results = db.prepare(`
      SELECT h.*, a.original_name as attachment_name
      FROM digital_evidence_hashes h
      LEFT JOIN attachments a ON h.attachment_id = a.id
      ${where}
      ORDER BY h.created_at DESC
      LIMIT 100
    `).all(...params) as any[];

    res.json({ results, count: results.length });
  } catch (err: any) {
    console.error('IPED error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /hash/check — Check hash against loaded sets ───────
router.post('/hash/check', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { md5, sha256 } = req.body;
    if (!md5 && !sha256) return res.status(400).json({ error: 'md5 or sha256 required' });

    const hashes = { md5: md5 || '', sha1: '', sha256: sha256 || '', sha512: '' };
    const matches = checkAgainstHashSets(hashes);

    res.json({ matches, hit: matches.length > 0 });
  } catch (err: any) {
    console.error('IPED error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /hash-sets — List loaded hash sets ──────────────────
router.get('/hash-sets', requireRole('admin'), (_req: Request, res: Response) => {
  try {
    res.json({ sets: getHashSetSummary() });
  } catch (err: any) {
    console.error('IPED error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /hash-sets/import — Import hash set file ───────────
router.post('/hash-sets/import', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { filePath, setName, category, hashType } = req.body;
    if (!filePath || !setName || !category) {
      return res.status(400).json({ error: 'filePath, setName, and category required' });
    }

    const count = importHashSet(filePath, setName, category, hashType || 'md5');
    auditLog(req, 'iped_hashset_imported', 'iped_hashset', setName, `Imported ${count} hashes into set "${setName}" (${category})`);
    res.json({ success: true, imported: count, setName, category });
  } catch (err: any) {
    console.error('IPED error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /hash-sets/upload — Upload a hash set file directly ────────
router.post('/hash-sets/upload', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { content, setName, category, hashType, fileName } = req.body;
    if (!content || !setName || !category) {
      return res.status(400).json({ error: 'content, setName, and category required' });
    }

    // fs and path already imported at top of file
    const hashSetsDir = path.join(__dirname, '..', '..', 'hash-sets');
    if (!fs.existsSync(hashSetsDir)) fs.mkdirSync(hashSetsDir, { recursive: true });

    // Save the file to disk
    const safeName = (fileName || `${setName.replace(/[^a-zA-Z0-9_-]/g, '_')}.${hashType || 'md5'}`)
      .replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(hashSetsDir, safeName);
    const header = `# Source: User Upload\n# Category: ${category}\n# Hash Type: ${hashType || 'md5'}\n# Description: Uploaded hash set: ${setName}\n# Last Updated: ${new Date().toISOString().split('T')[0]}\n#\n`;
    fs.writeFileSync(filePath, header + content, 'utf-8');

    // Import into database
    const count = importHashSet(filePath, setName, category, hashType || 'md5');
    auditLog(req, 'iped_hashset_uploaded', 'iped_hashset', setName, `Uploaded and imported ${count} hashes into set "${setName}" (${category})`);
    res.json({ success: true, imported: count, setName, category, filePath });
  } catch (err: any) {
    console.error('IPED error:', err?.message || err);
    res.status(500).json({ error: err?.message || 'Internal server error' });
  }
});

// ── GET /hash-sets/available — List hash set files on disk ──────────
router.get('/hash-sets/available', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    // fs and path already imported at top of file
    const hashSetsDir = path.join(__dirname, '..', '..', 'hash-sets');
    if (!fs.existsSync(hashSetsDir)) {
      return res.json({ data: [] });
    }
    const files = fs.readdirSync(hashSetsDir).filter((f: string) =>
      f.endsWith('.md5') || f.endsWith('.sha256') || f.endsWith('.sha1') || f.endsWith('.csv') || f.endsWith('.txt')
    );
    const sets = files.map((f: string) => {
      const content = fs.readFileSync(path.join(hashSetsDir, f), 'utf-8');
      const lines = content.split('\n');
      // Parse metadata from comment headers
      let source = '', category = 'custom', hashType = 'md5', description = '', name = f;
      const hashLines = lines.filter(l => l.trim() && !l.startsWith('#'));
      for (const line of lines) {
        if (line.startsWith('# Source:')) source = line.replace('# Source:', '').trim();
        if (line.startsWith('# Category:')) category = line.replace('# Category:', '').trim();
        if (line.startsWith('# Hash Type:')) hashType = line.replace('# Hash Type:', '').trim().toLowerCase();
        if (line.startsWith('# Description:')) description = line.replace('# Description:', '').trim();
      }
      // Derive display name from filename
      const displayName = f.replace(/\.(md5|sha256|sha1|csv|txt)$/, '')
        .replace(/-/g, ' ').replace(/_/g, ' ')
        .split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      return {
        fileName: f,
        filePath: path.join(hashSetsDir, f),
        displayName,
        source,
        category,
        hashType,
        description,
        hashCount: hashLines.length,
      };
    });
    res.json({ data: sets });
  } catch (err: any) {
    console.error('Error listing hash sets:', err?.message || err);
    res.status(500).json({ error: 'Failed to list available hash sets' });
  }
});

// ── POST /hash-sets/import-iped — Import into IPED native hash DB ──
router.post('/hash-sets/import-iped', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { filePath } = req.body;
    if (!filePath) {
      return res.status(400).json({ error: 'filePath required' });
    }
    const output = await importToIpedHashDb(filePath);
    res.json({ success: true, output });
  } catch (err: any) {
    console.error('IPED error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /hash-sets/:name — Remove hash set ───────────────
router.delete('/hash-sets/:name', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const removed = removeHashSet(req.params.name as string);
    if (removed) auditLog(req, 'iped_hashset_removed', 'iped_hashset', String(req.params.name), `Hash set "${req.params.name}" removed`);
    res.json({ success: true, removed });
  } catch (err: any) {
    console.error('IPED error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── IPED Web API Proxy Routes ───────────────────────────────

// List processed cases
router.get('/cases', requireRole('admin', 'manager'), async (_req: Request, res: Response) => {
  try {
    const data = await proxyIpedApi('/cases');
    res.json(data);
  } catch (err: any) {
    console.error('[IPED] List cases error:', err?.message || err);
    res.status(502).json({ error: 'IPED API unavailable' });
  }
});

// Search within a case
router.get('/cases/:caseId/search', requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const query = req.query.q as string || '';
    const data = await proxyIpedApi(`/cases/${encodeURIComponent(String(req.params.caseId))}/search?q=${encodeURIComponent(query)}`);
    res.json(data);
  } catch (err: any) {
    console.error('[IPED] Search error:', err?.message || err);
    res.status(502).json({ error: 'IPED API unavailable' });
  }
});

// Get file metadata
router.get('/cases/:caseId/file/:fileId', requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const data = await proxyIpedApi(`/cases/${encodeURIComponent(String(req.params.caseId))}/file/${encodeURIComponent(String(req.params.fileId))}`);
    res.json(data);
  } catch (err: any) {
    console.error('[IPED] File metadata error:', err?.message || err);
    res.status(502).json({ error: 'IPED API unavailable' });
  }
});

// Get file thumbnail
router.get('/cases/:caseId/file/:fileId/thumb', requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const data = await proxyIpedApi(`/cases/${encodeURIComponent(String(req.params.caseId))}/file/${encodeURIComponent(String(req.params.fileId))}/thumb`);
    res.json(data);
  } catch (err: any) {
    console.error('[IPED] File thumbnail error:', err?.message || err);
    res.status(502).json({ error: 'IPED API unavailable' });
  }
});

// ── GET /usage — Usage statistics ───────────────────────────
router.get('/usage', (_req: Request, res: Response) => {
  try {
    res.json(getIpedUsageStats());
  } catch (err: any) {
    console.error('IPED error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// Phase 3: Hash Review Workflow
// ============================================================

// ── GET /hash/flagged — Flagged hashes pending review ────────
router.get('/hash/flagged', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const page = Math.min(10000, Math.max(1, parseInt(req.query.page as string, 10) || 1));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.per_page as string, 10) || 20));
    const offset = (page - 1) * limit;

    const total = (db.prepare(`
      SELECT COUNT(*) as c FROM digital_evidence_hashes h
      WHERE h.flagged = 1 AND h.review_status IN ('pending', 'needs_analysis')
    `).get() as any)?.c || 0;

    const data = db.prepare(`
      SELECT h.*, e.evidence_number
      FROM digital_evidence_hashes h
      LEFT JOIN evidence e ON h.evidence_id = e.id
      WHERE h.flagged = 1 AND h.review_status IN ('pending', 'needs_analysis')
      ORDER BY h.created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset) as any[];

    res.json({ data, total, page, limit });
  } catch (err: any) {
    console.error('IPED error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /hash/results/:id/review — Review a flagged hash ─────
router.put('/hash/results/:id/review', validateParamId, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const { review_status, review_notes } = req.body;
    const validStatuses = ['confirmed_threat', 'false_positive', 'needs_analysis', 'pending'];
    if (!review_status || !validStatuses.includes(review_status)) {
      return res.status(400).json({ error: `review_status must be one of: ${validStatuses.join(', ')}` });
    }

    const existing = db.prepare('SELECT * FROM digital_evidence_hashes WHERE id = ?').get(id) as any;
    if (!existing) return res.status(404).json({ error: 'Hash record not found' });

    const reviewedAt = new Date().toISOString();
    const reviewedBy = req.user?.userId;

    db.prepare(`
      UPDATE digital_evidence_hashes
      SET review_status = ?, review_notes = ?, reviewed_by = ?, reviewed_at = ?
      WHERE id = ?
    `).run(review_status, review_notes || null, reviewedBy, reviewedAt, id);

    const updated = db.prepare('SELECT * FROM digital_evidence_hashes WHERE id = ?').get(id) as any;

    auditLog(req, 'REVIEW_HASH', 'digital_evidence_hashes', id,
      `Hash review: ${existing.review_status || 'none'} → ${review_status}` +
      (review_notes ? ` | Notes: ${review_notes}` : ''));

    broadcast('iped', 'hash:reviewed', { id, review_status, reviewed_by: reviewedBy, reviewed_at: reviewedAt });

    res.json(updated);
  } catch (err: any) {
    console.error('IPED error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /hash/review-stats — Review status counts ────────────
router.get('/hash/review-stats', requireRole('admin', 'manager', 'supervisor', 'officer'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT review_status, COUNT(*) as count
      FROM digital_evidence_hashes
      WHERE flagged = 1
      GROUP BY review_status
    `).all() as any[];

    const stats: Record<string, number> = {
      pending: 0,
      confirmed_threat: 0,
      false_positive: 0,
      needs_analysis: 0,
    };
    for (const row of rows) {
      if (row.review_status && row.review_status in stats) {
        stats[row.review_status] = row.count;
      }
    }

    res.json(stats);
  } catch (err: any) {
    console.error('IPED error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// Phase 5: Hash Verification
// ============================================================

// ── POST /hash/verify/:id — Re-verify a single hash record ──
router.post('/hash/verify/:id', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer'), async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const row = db.prepare('SELECT * FROM digital_evidence_hashes WHERE id = ?').get(id) as any;
    if (!row) return res.status(404).json({ error: 'Hash record not found' });

    // Resolve file path — try file_path on the row first, then look up attachment
    let filePath = row.file_path;
    if (!filePath && row.attachment_id) {
      const att = db.prepare('SELECT file_path FROM attachments WHERE id = ?').get(row.attachment_id) as any;
      if (att) {
        const uploadsDir = process.env.RMPG_UPLOADS_DIR || path.resolve(process.cwd(), 'uploads');
        filePath = path.join(uploadsDir, att.file_path);
      }
    }

    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Source file not found — cannot verify' });
    }

    const current = await computeFileHashes(filePath);
    const original = { md5: row.md5, sha1: row.sha1, sha256: row.sha256, sha512: row.sha512 };
    const mismatches: string[] = [];

    for (const algo of ['md5', 'sha1', 'sha256', 'sha512'] as const) {
      if (original[algo] && current[algo] && original[algo] !== current[algo]) {
        mismatches.push(algo);
      }
    }

    const verifiedAt = new Date().toISOString();
    const verifiedBy = req.user?.userId;
    const match = mismatches.length === 0;

    if (!match) {
      db.prepare(`
        UPDATE digital_evidence_hashes SET flagged = 1, flag_reason = 'INTEGRITY MISMATCH' WHERE id = ?
      `).run(id);
    }

    auditLog(req, 'VERIFY_HASH', 'digital_evidence_hashes', id,
      match ? 'Integrity verification passed' : `Integrity MISMATCH on: ${mismatches.join(', ')}`);

    res.json({ match, original, current, mismatches, verifiedAt, verifiedBy });
  } catch (err: any) {
    console.error('IPED error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /hash/verify-evidence/:evidenceId — Verify all hashes for evidence ──
router.post('/hash/verify-evidence/:evidenceId', requireRole('admin', 'manager', 'supervisor', 'officer'), async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const evidenceId = parseInt(req.params.evidenceId as string, 10);
    if (isNaN(evidenceId)) return res.status(400).json({ error: 'Invalid evidence ID' });

    const rows = db.prepare('SELECT * FROM digital_evidence_hashes WHERE evidence_id = ?').all(evidenceId) as any[];
    if (rows.length === 0) return res.status(404).json({ error: 'No hash records found for this evidence' });

    const uploadsDir = process.env.RMPG_UPLOADS_DIR || path.resolve(process.cwd(), 'uploads');
    let passed = 0;
    let failed = 0;
    const results: any[] = [];

    for (const row of rows) {
      let filePath = row.file_path;
      if (!filePath && row.attachment_id) {
        const att = db.prepare('SELECT file_path FROM attachments WHERE id = ?').get(row.attachment_id) as any;
        if (att) filePath = path.join(uploadsDir, att.file_path);
      }

      if (!filePath || !fs.existsSync(filePath)) {
        failed++;
        results.push({ id: row.id, file_name: row.file_name, match: false, error: 'File not found' });
        continue;
      }

      const current = await computeFileHashes(filePath);
      const original = { md5: row.md5, sha1: row.sha1, sha256: row.sha256, sha512: row.sha512 };
      const mismatches: string[] = [];

      for (const algo of ['md5', 'sha1', 'sha256', 'sha512'] as const) {
        if (original[algo] && current[algo] && original[algo] !== current[algo]) {
          mismatches.push(algo);
        }
      }

      const match = mismatches.length === 0;
      if (match) { passed++; } else {
        failed++;
        db.prepare(`
          UPDATE digital_evidence_hashes SET flagged = 1, flag_reason = 'INTEGRITY MISMATCH' WHERE id = ?
        `).run(row.id);
      }

      auditLog(req, 'VERIFY_HASH', 'digital_evidence_hashes', row.id,
        match ? 'Integrity verification passed' : `Integrity MISMATCH on: ${mismatches.join(', ')}`);

      results.push({ id: row.id, file_name: row.file_name, match, original, current, mismatches });
    }

    res.json({ evidenceId, totalFiles: rows.length, passed, failed, results });
  } catch (err: any) {
    console.error('IPED error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// Phase 6: Search + Export
// ============================================================

// ── GET /hash/search — Advanced hash search ──────────────────
router.get('/hash/search', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const page = Math.min(10000, Math.max(1, parseInt(req.query.page as string, 10) || 1));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.per_page as string, 10) || 20));
    const offset = (page - 1) * limit;

    const hash = (req.query.hash as string || '').trim();
    const hashSet = (req.query.hashSet as string || '').trim();
    const evidenceId = req.query.evidenceId ? parseInt(req.query.evidenceId as string, 10) : null;
    const flagged = req.query.flagged as string | undefined;
    const reviewStatus = (req.query.reviewStatus as string || '').trim();
    const from = (req.query.from as string || '').trim();
    const to = (req.query.to as string || '').trim();

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (hash) {
      where += ' AND (h.md5 LIKE ? OR h.sha256 LIKE ?)';
      params.push(`%${hash}%`, `%${hash}%`);
    }
    if (hashSet) {
      where += ' AND h.hash_set_name = ?';
      params.push(hashSet);
    }
    if (evidenceId) {
      where += ' AND h.evidence_id = ?';
      params.push(evidenceId);
    }
    if (flagged === 'true') {
      where += ' AND h.flagged = 1';
    } else if (flagged === 'false') {
      where += ' AND h.flagged = 0';
    }
    if (reviewStatus) {
      where += ' AND h.review_status = ?';
      params.push(reviewStatus);
    }
    if (from) {
      where += ' AND h.created_at >= ?';
      params.push(from);
    }
    if (to) {
      where += ' AND h.created_at <= ?';
      params.push(to);
    }

    const total = (db.prepare(
      `SELECT COUNT(*) as c FROM digital_evidence_hashes h ${where}`
    ).get(...params) as any)?.c || 0;

    const dataParams = [...params, limit, offset];
    const data = db.prepare(`
      SELECT h.*, e.evidence_number
      FROM digital_evidence_hashes h
      LEFT JOIN evidence e ON h.evidence_id = e.id
      ${where}
      ORDER BY h.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...dataParams) as any[];

    res.json({ data, total, page, limit });
  } catch (err: any) {
    console.error('IPED error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /hash/export — Export hash results as CSV ────────────
router.get('/hash/export', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();

    const hash = (req.query.hash as string || '').trim();
    const hashSet = (req.query.hashSet as string || '').trim();
    const evidenceId = req.query.evidenceId ? parseInt(req.query.evidenceId as string, 10) : null;
    const flagged = req.query.flagged as string | undefined;
    const reviewStatus = (req.query.reviewStatus as string || '').trim();
    const from = (req.query.from as string || '').trim();
    const to = (req.query.to as string || '').trim();

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (hash) {
      where += ' AND (h.md5 LIKE ? OR h.sha256 LIKE ?)';
      params.push(`%${hash}%`, `%${hash}%`);
    }
    if (hashSet) {
      where += ' AND h.hash_set_name = ?';
      params.push(hashSet);
    }
    if (evidenceId) {
      where += ' AND h.evidence_id = ?';
      params.push(evidenceId);
    }
    if (flagged === 'true') {
      where += ' AND h.flagged = 1';
    } else if (flagged === 'false') {
      where += ' AND h.flagged = 0';
    }
    if (reviewStatus) {
      where += ' AND h.review_status = ?';
      params.push(reviewStatus);
    }
    if (from) {
      where += ' AND h.created_at >= ?';
      params.push(from);
    }
    if (to) {
      where += ' AND h.created_at <= ?';
      params.push(to);
    }

    const rows = db.prepare(`
      SELECT h.*, e.evidence_number, u.full_name as reviewer_name
      FROM digital_evidence_hashes h
      LEFT JOIN evidence e ON h.evidence_id = e.id
      LEFT JOIN users u ON h.reviewed_by = u.id
      ${where}
      ORDER BY h.created_at DESC
    `).all(...params) as any[];

    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="hash-report-${dateStr}.csv"`);

    // UTF-8 BOM for Excel compatibility
    const BOM = '\uFEFF';
    const header = 'evidence_number,file_name,md5,sha1,sha256,sha512,flagged,review_status,reviewed_by,hash_set_name,created_at';

    const csvRows = rows.map((r: any) => {
      const fields = [
        r.evidence_number || '',
        r.file_name || '',
        r.md5 || '',
        r.sha1 || '',
        r.sha256 || '',
        r.sha512 || '',
        r.flagged ? '1' : '0',
        r.review_status || '',
        r.reviewer_name || '',
        r.hash_set_name || '',
        r.created_at || '',
      ];
      return fields.map(f => `"${String(f).replace(/"/g, '""')}"`).join(',');
    });

    res.send(BOM + header + '\n' + csvRows.join('\n'));
  } catch (err: any) {
    console.error('IPED error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
