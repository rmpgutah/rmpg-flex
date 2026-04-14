import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';

const ALL_FORMS = [
  'call','person','vehicle','warrant','evidence','fleet','personnel','property','citation',
  'incident_blank','person_blank','vehicle_blank','property_blank','citation_blank','field_interview_blank',
  'affidavit_service','affidavit_non_service','service_log',
  'patrol_tracking','invoice','proposal','bolo','warrant_summary',
] as const;
type FormKey = typeof ALL_FORMS[number];

const CONFIG_KEY = 'pdf.v2.enabled_forms';

function readFlags(): Record<string, boolean> {
  const db = getDb();
  const row = db.prepare(
    "SELECT config_value FROM system_config WHERE config_key = ? AND category = 'pdf_engine' AND is_active = 1"
  ).get(CONFIG_KEY) as { config_value?: string } | undefined;
  const stored: Record<string, boolean> = row?.config_value ? JSON.parse(row.config_value) : {};
  const result: Record<string, boolean> = {};
  for (const f of ALL_FORMS) result[f] = Boolean(stored[f]);
  return result;
}

function writeFlags(flags: Record<string, boolean>): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("DELETE FROM system_config WHERE config_key = ? AND category = 'pdf_engine'").run(CONFIG_KEY);
  db.prepare(
    "INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at) VALUES (?, ?, 'pdf_engine', 0, 1, ?, ?)"
  ).run(CONFIG_KEY, JSON.stringify(flags), now, now);
}

const router = Router();
router.use(authenticateToken);

router.get('/flags', (_req: Request, res: Response) => {
  res.json(readFlags());
});

router.put('/flags/:form', requireRole('admin'), (req: Request, res: Response) => {
  const form = req.params.form as FormKey;
  if (!ALL_FORMS.includes(form)) return res.status(400).json({ error: 'unknown form' });
  const enabled = Boolean(req.body?.enabled);
  const flags = readFlags();
  const previous = flags[form];
  flags[form] = enabled;
  writeFlags(flags);
  auditLog(req, 'pdf_engine_flag_change', 'pdf_engine', 0, `form=${form} ${previous} -> ${enabled}`);
  res.json({ success: true, form, enabled });
});

router.put('/revert-all', requireRole('admin'), (req: Request, res: Response) => {
  const flags = readFlags();
  const changed = Object.keys(flags).filter(k => flags[k]);
  const reset: Record<string, boolean> = {};
  for (const f of ALL_FORMS) reset[f] = false;
  writeFlags(reset);
  auditLog(req, 'pdf_engine_revert_all', 'pdf_engine', 0, `reverted ${changed.length} forms: ${changed.join(',')}`);
  res.json({ success: true, revertedForms: changed });
});

export default router;
