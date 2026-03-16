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
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
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

export default router;
