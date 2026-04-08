// ============================================================
// RMPG Flex — Process Service Intake Route
// ============================================================
// PUBLIC endpoint (no JWT auth) that receives process service
// cases from rmpgutahps.us via Bearer token authentication.
// The caller (dispatchToFlex.js) sends:
//   Authorization: Bearer rmpg_ps_xxxxx
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { generateCallNumber, generateCaseNumber } from '../utils/caseNumbers';
import { broadcast, broadcastDispatchUpdate } from '../utils/websocket';
import { auditLogSystem } from '../utils/auditLogger';
import { hashApiKey } from '../utils/apiKeyHash';
import { localNow } from '../utils/timeUtils';
import { createServeQueueFromCall } from '../utils/serveQueueLinker';

const router = Router();

// ── Rate Limiting (30 req/min per IP) ───────────────────────

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  entry.count++;
  return entry.count <= 30;
}

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, 5 * 60_000);

// ── Bearer Token Validation ─────────────────────────────────

interface ApiKeyRow {
  id: number;
  name: string;
  is_active: number;
  scopes: string;
}

function validateBearerToken(req: Request, res: Response): ApiKeyRow | null {
  const authHeader = req.headers['authorization'] as string | undefined;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization required. Provide Bearer token.', code: 'AUTHORIZATION_REQUIRED_PROVIDE_BEARER' });
    return null;
  }

  const apiKey = authHeader.slice(7); // Strip "Bearer "

  if (!apiKey || apiKey.length < 10) {
    res.status(401).json({ error: 'Invalid authorization token.', code: 'INVALID_AUTHORIZATION_TOKEN' });
    return null;
  }

  const keyHash = hashApiKey(apiKey);
  const db = getDb();

  const row = db.prepare(
    'SELECT id, name, is_active, scopes FROM integration_api_keys WHERE key_hash = ?'
  ).get(keyHash) as ApiKeyRow | undefined;

  if (!row) {
    res.status(401).json({ error: 'Invalid API key.', code: 'INVALID_API_KEY' });
    return null;
  }

  if (!row.is_active) {
    res.status(403).json({ error: 'API key has been revoked.', code: 'API_KEY_REVOKED' });
    return null;
  }

  // Validate scope
  let scopes: string[];
  try {
    scopes = JSON.parse(row.scopes);
  } catch {
    scopes = [];
  }

  if (!scopes.includes('service_request')) {
    res.status(403).json({ error: 'API key does not have the required scope: service_request', code: 'API_KEY_INSUFFICIENT_SCOPE' });
    return null;
  }

  // Update usage tracking
  db.prepare(
    'UPDATE integration_api_keys SET last_used_at = ?, request_count = request_count + 1 WHERE id = ?'
  ).run(localNow(), row.id);

  return row;
}

// ── Service Type Mapping ────────────────────────────────────

function mapServiceType(serviceType: string): string {
  const lower = (serviceType || '').toLowerCase();
  if (lower.includes('subpoena')) return 'subpoena';
  if (lower.includes('summons')) return 'summons';
  if (lower.includes('complaint')) return 'complaint';
  if (lower.includes('eviction')) return 'eviction';
  if (lower.includes('restraining') || lower.includes('protective')) return 'restraining_order';
  return 'other';
}

// ── POST /intake ────────────────────────────────────────────

router.post('/', (req: Request, res: Response) => {
  try {
    // Rate limit check
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(ip)) {
      return res.status(429).json({ error: 'Rate limit exceeded. Max 30 requests per minute.', code: 'RATE_LIMIT_EXCEEDED_MAX' });
    }

    // Authenticate via Bearer token
    const apiKeyRow = validateBearerToken(req, res);
    if (!apiKeyRow) return; // Response already sent

    const body = req.body;

    // Basic validation
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Request body is required.', code: 'REQUEST_BODY_IS_REQUIRED' });
    }

    if (!body.source_id || typeof body.source_id !== 'string') {
      return res.status(400).json({ error: 'source_id is required and must be a string.', code: 'SOURCEID_IS_REQUIRED' });
    }

    if (body.source_id.length > 500) {
      return res.status(400).json({ error: 'source_id must be 500 characters or less.', code: 'SOURCEID_TOO_LONG' });
    }

    // Validate subject_name length
    if (body.subject_name && typeof body.subject_name === 'string' && body.subject_name.length > 500) {
      return res.status(400).json({ error: 'subject_name must be 500 characters or less.', code: 'SUBJECT_NAME_TOO_LONG' });
    }

    // Validate subject_address length
    if (body.subject_address && typeof body.subject_address === 'string' && body.subject_address.length > 1000) {
      return res.status(400).json({ error: 'subject_address must be 1000 characters or less.', code: 'SUBJECT_ADDRESS_TOO_LONG' });
    }

    const db = getDb();

    // Check for duplicate source_id to prevent double-dispatch
    const existing = db.prepare(
      "SELECT id, call_number FROM calls_for_service WHERE source_id = ?"
    ).get(body.source_id) as any;

    if (existing) {
      return res.status(409).json({
        error: 'Duplicate request. This case has already been dispatched.',
        code: 'DUPLICATE_SOURCE_ID',
        call_id: existing.id,
        call_number: existing.call_number,
      });
    }

    // Generate call and case numbers
    const call_number = generateCallNumber(db);
    const case_number = generateCaseNumber(db, 'service');

    // Map priority
    const isHighPriority = body.priority === 'high' ||
      body.job_type === 'Rush' ||
      body.job_type === 'Same Day';
    const priority = isHighPriority ? 'P2' : 'P3';

    // Build description with court info and source tracking
    const descParts: string[] = [];
    if (body.docs_to_serve) descParts.push(`Documents: ${body.docs_to_serve}`);
    if (body.court_case_number) descParts.push(`Court Case: ${body.court_case_number}`);
    if (body.court) descParts.push(`Court: ${body.court}`);
    if (body.county) descParts.push(`County: ${body.county}`);
    if (body.plaintiff) descParts.push(`Plaintiff: ${body.plaintiff}`);
    if (body.defendant) descParts.push(`Defendant: ${body.defendant}`);
    if (body.judge) descParts.push(`Judge: ${body.judge}`);
    if (body.case_type) descParts.push(`Case Type: ${body.case_type}`);
    if (body.description) descParts.push(body.description);
    if (body.due_date) descParts.push(`Due: ${body.due_date}`);
    if (body.filing_deadline) descParts.push(`Filing Deadline: ${body.filing_deadline}`);
    if (body.recipient_dob) descParts.push(`DOB: ${body.recipient_dob}`);
    if (body.subject_description) descParts.push(`Description: ${body.subject_description}`);
    // Source tracking tags
    descParts.push(`[source:${body.source || 'rmpgutahps.us'}]`);
    descParts.push(`[source_id:${body.source_id}]`);
    if (body.case_number) descParts.push(`[portal_case:${body.case_number}]`);

    const description = descParts.join(' | ');

    // Build notes from service instructions
    const notesParts: string[] = [];
    if (body.service_instructions) notesParts.push(body.service_instructions);
    if (body.court_address) notesParts.push(`Court Address: ${body.court_address}`);
    if (body.department) notesParts.push(`Department: ${body.department}`);
    const notes = notesParts.join(' | ') || null;

    const now = localNow();

    // Insert into calls_for_service
    const result = db.prepare(`
      INSERT INTO calls_for_service (
        call_number, case_number, incident_type, source, status, priority,
        location_address, description, notes,
        pso_service_type, pso_requestor_name, pso_requestor_phone, pso_requestor_email,
        process_service_type, process_served_to, process_served_address,
        process_attempts, process_service_result,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      call_number,
      case_number,
      'process_service',
      'online',
      'pending',
      priority,
      body.subject_address || '',
      description,
      notes,
      'process_service',
      body.client_name || '',
      body.client_phone || '',
      body.client_email || '',
      mapServiceType(body.service_type || body.docs_to_serve || ''),
      body.subject_name || '',
      body.subject_address || '',
      0,
      null,
      now,
      now,
    );

    const callId = Number(result.lastInsertRowid);

    // Broadcast to connected dispatch clients
    broadcastDispatchUpdate({
      action: 'call_created',
      call: {
        id: callId,
        call_number,
        case_number,
        incident_type: 'process_service',
        source: 'online',
        status: 'pending',
        priority,
        location_address: body.subject_address || '',
        description,
        notes,
        pso_service_type: 'process_service',
        pso_requestor_name: body.client_name || '',
        process_served_to: body.subject_name || '',
        process_served_address: body.subject_address || '',
        created_at: now,
      },
    });

    // Audit log (system-level since no JWT user)
    auditLogSystem(
      'call_created',
      'call',
      callId,
      `Process service intake via API (${apiKeyRow.name}): ${call_number} — Serve ${body.subject_name || 'unknown'} at ${body.subject_address || 'unknown address'}`,
    );

    // Auto-send to serve queue for process service calls
    let serveJobId: number | null = null;
    try {
      const fullCall = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(callId) as any;
      serveJobId = createServeQueueFromCall(db, fullCall);
      if (serveJobId) {
        broadcast('serve', 'serve_created', { id: serveJobId, call_id: callId });
        console.log(`[Intake] Auto-sent to serve queue: serve_id=${serveJobId} call_id=${callId}`);
      }
    } catch (serveErr) {
      console.error('[Intake] Auto-send to serve queue failed (non-fatal):', serveErr instanceof Error ? serveErr.message : serveErr);
    }

    console.log(`[Intake] Process service received: ${call_number} (source_id: ${body.source_id}, key_id: ${apiKeyRow.id})`);

    res.status(201).json({
      success: true,
      call_id: callId,
      call_number,
      case_number,
      status: 'pending',
      serve_queue_id: serveJobId || undefined,
      message: 'Process service request received and dispatched',
    });
  } catch (error: any) {
    console.error('[Intake] Error processing request:', error);
    res.status(500).json({ error: 'Internal server error processing intake request.', code: 'INTERNAL_SERVER_ERROR_PROCESSING' });
  }
});

export default router;
