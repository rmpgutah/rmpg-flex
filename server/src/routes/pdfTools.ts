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
import {
  signPdfWithEnv, verifyPdfSignature, type PdfSignaturePayload,
} from '../utils/pdfSigner';
import { loadKeypairFromEnv } from '../utils/evidenceSigner';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

const router = Router();
router.use(authenticateToken);

router.get('/health', async (_req: Request, res: Response) => {
  const available = await isQpdfAvailable();
  const signingConfigured = loadKeypairFromEnv() !== null;
  res.json({ qpdf: available, signing: signingConfigured });
});

// ── PDF payload signing (Phase D — court-grade integrity) ──
//
// Signs an Ed25519 message that binds together:
//   - the form key (e.g. 'incident', 'case', 'jail_booking')
//   - the case/event/citation number
//   - the SHA-256 of the canonical-JSON record payload
//   - a server-minted timestamp
//
// Returns 503 with code SIGNING_NOT_CONFIGURED when the keypair
// env vars are unset — the client falls back gracefully and
// renders the trailer page with "UNSIGNED" instead of failing
// the whole PDF generation.
router.post('/sign-payload', (req: Request, res: Response) => {
  try {
    const formKey = typeof req.body?.formKey === 'string' ? req.body.formKey.trim() : '';
    const caseNumber = typeof req.body?.caseNumber === 'string' ? req.body.caseNumber.trim() : '';
    const payloadHash = typeof req.body?.payloadHash === 'string' ? req.body.payloadHash.trim().toLowerCase() : '';
    if (!formKey || !payloadHash) {
      res.status(400).json({ error: 'formKey and payloadHash are required' });
      return;
    }
    // SHA-256 hex is 64 chars — reject anything that doesn't look like one
    // so we never sign garbage input that a client typo'd.
    if (!/^[0-9a-f]{64}$/.test(payloadHash)) {
      res.status(400).json({ error: 'payloadHash must be a 64-char lowercase SHA-256 hex string' });
      return;
    }

    const payload: PdfSignaturePayload = {
      formKey,
      caseNumber: caseNumber || '',
      payloadHash,
      signedAt: new Date().toISOString(),
    };
    const result = signPdfWithEnv(payload);
    if (!result) {
      res.status(503).json({
        error: 'PDF signing is not configured on this server',
        code: 'SIGNING_NOT_CONFIGURED',
      });
      return;
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: 'Signing failed', detail: err?.message });
  }
});

// Verification endpoint — useful for offline exhibit auditors
// who pasted a PDF's payload-hash + signature into a verifier UI.
router.post('/verify-signature', (req: Request, res: Response) => {
  try {
    const formKey = typeof req.body?.formKey === 'string' ? req.body.formKey.trim() : '';
    const caseNumber = typeof req.body?.caseNumber === 'string' ? req.body.caseNumber.trim() : '';
    const payloadHash = typeof req.body?.payloadHash === 'string' ? req.body.payloadHash.trim().toLowerCase() : '';
    const signedAt = typeof req.body?.signedAt === 'string' ? req.body.signedAt.trim() : '';
    const signature = typeof req.body?.signature === 'string' ? req.body.signature.trim() : '';
    const publicKey = typeof req.body?.publicKey === 'string'
      ? req.body.publicKey.trim()
      : (loadKeypairFromEnv()?.publicKey || '');

    if (!formKey || !payloadHash || !signedAt || !signature || !publicKey) {
      res.status(400).json({
        error: 'formKey, payloadHash, signedAt, signature, and publicKey are required',
      });
      return;
    }
    const valid = verifyPdfSignature(publicKey, {
      formKey, caseNumber: caseNumber || '', payloadHash, signedAt,
    }, signature);
    res.json({ valid });
  } catch (err: any) {
    res.status(500).json({ error: 'Verification failed', detail: err?.message });
  }
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
