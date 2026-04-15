// ============================================================
// PDF v2 Email Route
//
// Accepts a multipart upload (PDF + email metadata) from the
// PDF Review Modal's Email commit action and fans it through
// the unified sendEmail() helper, which tries Microsoft Graph
// first then falls back to SMTP.
// ============================================================

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { sendEmail } from '../utils/emailSender';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const router = Router();
router.use(authenticateToken);

// Only managers + admins can send email via the PDF flow
router.post('/email', requireRole('admin', 'manager'), upload.single('pdf'), async (req: Request, res: Response) => {
  const { to, cc, subject, body, form_type } = req.body ?? {};
  if (!to || !subject) {
    return res.status(400).json({ error: 'to and subject required' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'pdf file required (field name: pdf)' });
  }
  const toList = Array.isArray(to) ? to : String(to).split(',').map((s) => s.trim()).filter(Boolean);
  const ccList = cc ? (Array.isArray(cc) ? cc : String(cc).split(',').map((s) => s.trim()).filter(Boolean)) : [];

  try {
    const ok = await sendEmail({
      to: toList,
      cc: ccList,
      subject: String(subject),
      html: String(body ?? '').replace(/\n/g, '<br>') || '(no body)',
      attachments: [
        {
          filename: `${form_type ?? 'document'}.pdf`,
          content: req.file.buffer,
          contentType: 'application/pdf',
        },
      ],
    });
    if (!ok) {
      return res.status(502).json({ error: 'email transport not available or failed' });
    }
    auditLog(req, 'pdf_email_sent', 'pdf_engine', 0,
      `form=${form_type ?? 'unknown'} to=${toList.join(',')} cc=${ccList.join(',')}`);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'send failed' });
  }
});

export default router;
