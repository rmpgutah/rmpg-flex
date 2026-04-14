import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';

const router = Router();
router.use(authenticateToken);

router.post('/pdf-engine-fallback', (req: Request, res: Response) => {
  const { formType, message } = req.body ?? {};
  if (!formType) return res.status(400).json({ error: 'formType required' });
  auditLog(req, 'pdf_engine_fallback', 'pdf_engine', 0,
    `form=${formType} error=${(message ?? '').toString().slice(0, 500)}`);
  res.json({ success: true });
});

export default router;
