// ============================================================
// PDF Tools — server-side encryption + decryption
// ============================================================
// Endpoints that the client calls when it can't do the work in
// pure JS. Currently:
//   POST /api/pdf-tools/encrypt   — apply user/owner pw + perms
//   POST /api/pdf-tools/decrypt   — strip encryption (owner pw)
//   GET  /api/pdf-tools/health    — qpdf availability probe
//
// Auth: requires JWT. Multipart upload via `pdf` field. Hard 50MB
// cap per file (matches /api/uploads behavior). All processing
// happens in a per-request temp dir that's cleaned in finally.

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { authenticateToken } from '../middleware/auth';
import { encryptPdf, decryptPdf, isQpdfAvailable, type PdfPermissions } from '../utils/pdfEncrypt';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

const router = Router();
router.use(authenticateToken);

router.get('/health', async (_req: Request, res: Response) => {
  const available = await isQpdfAvailable();
  res.json({ qpdf: available });
});

router.post('/encrypt', upload.single('pdf'), async (req: Request, res: Response) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'pdf file required (multipart field "pdf")' }); return; }
    if (req.file.mimetype !== 'application/pdf') {
      res.status(400).json({ error: 'File must be application/pdf' });
      return;
    }

    const userPassword = typeof req.body.userPassword === 'string' ? req.body.userPassword : '';
    const ownerPassword = typeof req.body.ownerPassword === 'string' && req.body.ownerPassword.length > 0
      ? req.body.ownerPassword : undefined;
    const bitLengthRaw = parseInt(String(req.body.bitLength ?? '256'), 10);
    const bitLength = (bitLengthRaw === 40 || bitLengthRaw === 128 || bitLengthRaw === 256) ? bitLengthRaw : 256;

    const permissions: PdfPermissions = {};
    if (req.body['permissions.print']) permissions.print = req.body['permissions.print'];
    if (req.body['permissions.modify']) permissions.modify = req.body['permissions.modify'];
    if (req.body['permissions.extract'] !== undefined) permissions.extract = String(req.body['permissions.extract']) === 'true';
    if (req.body['permissions.accessibility'] !== undefined) permissions.accessibility = String(req.body['permissions.accessibility']) === 'true';
    if (req.body['permissions.fillForms'] !== undefined) permissions.fillForms = String(req.body['permissions.fillForms']) === 'true';

    const encrypted = await encryptPdf(req.file.buffer, { userPassword, ownerPassword, bitLength, permissions });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', 'attachment; filename="encrypted.pdf"');
    res.send(encrypted);
  } catch (err: any) {
    if (err?.code === 'QPDF_MISSING') { res.status(503).json({ error: err.message, code: 'QPDF_MISSING' }); return; }
    console.error('[pdf-tools] encrypt failed:', err);
    res.status(500).json({ error: err?.message || 'Encryption failed' });
  }
});

router.post('/decrypt', upload.single('pdf'), async (req: Request, res: Response) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'pdf file required' }); return; }
    if (typeof req.body.password !== 'string' || req.body.password.length === 0) {
      res.status(400).json({ error: 'password required' });
      return;
    }
    const decrypted = await decryptPdf(req.file.buffer, req.body.password);
    res.set('Content-Type', 'application/pdf');
    res.send(decrypted);
  } catch (err: any) {
    if (err?.code === 'QPDF_MISSING') { res.status(503).json({ error: err.message, code: 'QPDF_MISSING' }); return; }
    console.error('[pdf-tools] decrypt failed:', err);
    res.status(500).json({ error: err?.message || 'Decryption failed' });
  }
});

export default router;
