// ============================================================
// Document Intake — generalized OCR + field-extraction route
// ============================================================
// /api/document-intake — supports court records, ICU
// investigation docs, information forms, and field sheets.
// Returns structured field bags WITHOUT writing to the DB —
// the caller (clerk UI) reviews and commits separately so a
// regex miss can't silently corrupt records.
//
// Endpoints:
//   POST /extract         multipart pdf → DocumentExtraction
//   POST /classify-text   JSON {text} → kind + score (no extraction)
//   GET  /types           list of registered kinds + tiers
//   GET  /health          probe pdftotext + ocrmypdf availability
//
// Distinct from /api/serve-intake which is hardwired to the serve
// queue workflow. Both share serveIntakeOcr's binary helpers.

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { authenticateToken } from '../middleware/auth';
import {
  extractFromPdf, extractFromText, listRegisteredKinds, detectKind,
} from '../utils/documentIntake';
import {
  isOcrmypdfAvailable, isTesseractAvailable,
} from '../utils/serveIntakeOcr';
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const router = Router();
router.use(authenticateToken);

router.get('/health', async (_req: Request, res: Response) => {
  let pdftotext = false;
  try { await execFileAsync('pdftotext', ['-v'], { timeout: 5_000 }); pdftotext = true; } catch { /* missing */ }
  const [ocrmypdf, tesseract] = await Promise.all([isOcrmypdfAvailable(), isTesseractAvailable()]);
  res.json({
    pdftotext,
    ocrmypdf,
    tesseract,
    ready: pdftotext, // OCR is optional; pdftotext is required
    registeredKinds: listRegisteredKinds(),
  });
});

router.get('/types', (_req: Request, res: Response) => {
  res.json({ kinds: listRegisteredKinds() });
});

// JSON-only classification — useful for pre-flight UX where the
// client has already extracted text some other way (e.g. paste
// from clipboard).
router.post('/classify-text', (req: Request, res: Response) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text : '';
    if (!text.trim()) {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    res.json(detectKind(text));
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Classification failed' });
  }
});

// Same JSON shape as /extract but for callers who already have
// OCR'd text. Skips the pdftotext+OCR pipeline entirely.
router.post('/extract-text', (req: Request, res: Response) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text : '';
    if (!text.trim()) {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    const forceKind = typeof req.body?.forceKind === 'string' ? req.body.forceKind : undefined;
    const result = extractFromText(text, { forceKind: forceKind as any });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Extraction failed' });
  }
});

router.post('/extract', upload.single('pdf'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'pdf file required (multipart field "pdf")' });
      return;
    }
    if (req.file.mimetype !== 'application/pdf') {
      res.status(400).json({ error: 'File must be application/pdf' });
      return;
    }
    const forceKind = typeof req.body?.forceKind === 'string' ? req.body.forceKind : undefined;
    const result = await extractFromPdf(req.file.buffer, { forceKind: forceKind as any });
    res.json(result);
  } catch (err: any) {
    console.error('[document-intake] extract failed:', err);
    res.status(500).json({ error: err?.message || 'Extraction failed' });
  }
});

export default router;
