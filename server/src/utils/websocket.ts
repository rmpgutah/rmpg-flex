import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { Server as HttpsServer } from 'https';
import jwt from 'jsonwebtoken';
import config from '../config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import database from '../models/database';

const __ws_filename = fileURLToPath(import.meta.url);
const __ws_dirname = path.dirname(__ws_filename);

interface JwtPayload {
  userId: number;
  username: string;
  role: string;
  fullName: string;
  sessionId?: string;
  type?: 'access' | 'refresh';
}

interface WSClient {
  ws: WebSocket;
  userId?: number;
  username?: string;
  fullName?: string;
  role?: string;
  authenticated: boolean;
  channels: Set<string>;
  /** Unit call sign (e.g. "1A12") for MDC selcall addressing */
  unitCallSign?: string;
  /** Current radio channel (null = not on radio) */
  radioChannel: string | null;
  /** Active private call ID (null = not in a call) */
  privateCallId: string | null;
  /** Client ID of private call partner */
  privateCallPartner: string | null;
  /** Channels being scanned (monitored) in addition to the primary radio channel */
  scanChannels?: string[];
}

const clients: Map<string, WSClient> = new Map();
let wss: WebSocketServer | null = null;

/** Safe send — only sends if the WebSocket is OPEN, prevents unhandled errors */
function safeSend(ws: WebSocket, data: string): boolean {
  if (ws.readyState === WebSocket.OPEN) {
    try { ws.send(data); return true; } catch { return false; }
  }
  return false;
}

// Authentication timeout — disconnect clients that don't authenticate within 8 seconds
// Increased from 3s to accommodate field officers on slow cellular networks
const AUTH_TIMEOUT_MS = 8_000;

// All channels every authenticated client auto-subscribes to
const DEFAULT_CHANNELS = ['dispatch', 'alerts', 'records', 'personnel', 'fleet', 'incidents', 'citations', 'patrol', 'admin', 'presence', 'messages', 'email', 'serve'];

// ─── Radio State ────────────────────────────────────────────
// Tracks which radio channel each client is on, and who is
// currently transmitting on each channel (one at a time).

/** channel → clientId of the active transmitter (null = channel is clear) */
const activeTransmitters: Map<string, string> = new Map();

/** Track which transmissions have been logged (to avoid spamming console with per-chunk logs) */
const loggedTransmissions: Set<string> = new Set();

/** Buffer audio chunks per transmission for saving to disk: "channel:clientId" → Buffer[] */
const audioBuffers: Map<string, Buffer[]> = new Map();

/** Audio buffer timeout timers: "channel:clientId" → timer (auto-end unterminated transmissions) */
const audioBufferTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
const AUDIO_BUFFER_TIMEOUT_MS = 120_000; // 2 minutes

/** Emergency override auto-clear timers: channel → timer */
const emergencyOverrideTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
const EMERGENCY_OVERRIDE_DURATION_MS = 30_000; // 30 seconds

/** Per-client message rate limiting */
const clientMessageRates: Map<string, { count: number; resetAt: number }> = new Map();
const WS_RATE_LIMIT_WINDOW_MS = 1000; // 1 second window
const WS_RATE_LIMIT_MAX = 15;         // max messages per second

/** Per-IP message rate limiting — prevents abuse via multiple client connections */
const ipMessageRates: Map<string, { count: number; resetAt: number }> = new Map();
const WS_IP_RATE_LIMIT_MAX = 60;      // max messages per second per IP (across all connections)

/** Per-message-type rate limits — prevents flooding of sensitive message types */
const MESSAGE_TYPE_LIMITS: Record<string, number> = {
  'panic_audio': 5,           // 5 per second
  'radio_channel_join': 3,    // 3 per second
  'radio_channel_leave': 3,
  'radio_audio': 10,          // 10 per second (streaming audio)
  'private_call_offer': 2,
  'private_call_answer': 2,
  'subscribe': 5,
  'unsubscribe': 5,
};
const messageTypeRates: Map<string, { count: number; resetAt: number }> = new Map();

// Periodic cleanup of stale rate-limit entries and orphaned radio state (every 5 min)
setInterval(() => {
  const now = Date.now();
  // Collect keys to delete first, then delete — avoids delete-during-iteration
  const rateKeysToDelete: string[] = [];
  for (const [id, rate] of clientMessageRates) {
    if (now > rate.resetAt && !clients.has(id)) rateKeysToDelete.push(id);
  }
  for (const k of rateKeysToDelete) clientMessageRates.delete(k);

  // Clean stale IP rate entries
  const ipRateKeysToDelete: string[] = [];
  for (const [ip, rate] of ipMessageRates) {
    if (now > rate.resetAt) ipRateKeysToDelete.push(ip);
  }
  for (const k of ipRateKeysToDelete) ipMessageRates.delete(k);

  // Clean stale per-message-type rate entries
  const typeRateKeysToDelete: string[] = [];
  for (const [key, rate] of messageTypeRates) {
    if (now > rate.resetAt) typeRateKeysToDelete.push(key);
  }
  for (const k of typeRateKeysToDelete) messageTypeRates.delete(k);

  const logKeysToDelete: string[] = [];
  for (const key of loggedTransmissions) {
    const clientId = key.split(':')[1];
    if (clientId && !clients.has(clientId)) logKeysToDelete.push(key);
  }
  for (const k of logKeysToDelete) loggedTransmissions.delete(k);

  const audioKeysToDelete: string[] = [];
  for (const key of audioBuffers.keys()) {
    const clientId = key.split(':')[1];
    if (clientId && !clients.has(clientId)) audioKeysToDelete.push(key);
  }
  for (const key of audioKeysToDelete) {
    audioBuffers.delete(key);
    const timer = audioBufferTimers.get(key);
    if (timer) { clearTimeout(timer); audioBufferTimers.delete(key); }
  }
}, 5 * 60 * 1000).unref();

// NOTE: Session revalidation (disconnect revoked sessions, deactivated accounts,
// role changes) is handled inside initWebSocket() to avoid duplicate timers
// and to ensure it only runs after the WS server is initialized.

/** Directory where radio recordings are saved */
const RADIO_UPLOAD_DIR = path.resolve(__ws_dirname, '../../uploads/radio');

const DEFAULT_RADIO_CHANNELS = ['dispatch', 'tac-1', 'tac-2', 'tac-3', 'patrol', 'admin'];

/** Dynamically load active radio channel names from DB, with fallback to defaults */
function getRadioChannelNames(): string[] {
  try {
    const db = database.getDb();
    const rows = db.prepare(
      "SELECT config_key FROM system_config WHERE category = 'radio_channel' AND is_active = 1 ORDER BY sort_order"
    ).all() as { config_key: string }[];
    if (rows.length > 0) return rows.map(r => r.config_key);
  } catch { /* DB not ready yet or no rows — use defaults */ }
  return DEFAULT_RADIO_CHANNELS;
}

// Allowed origins for WebSocket connections — only include dev origins outside production
const ALLOWED_ORIGINS = new Set([
  'https://rmpgutah.us',
  ...(config.isProduction ? [] : [
    'http://localhost:5173',   // Vite dev server
    'http://localhost:3001',   // Express dev server
  ]),
]);

// Per-IP connection limit — prevents resource exhaustion from a single source
const MAX_WS_CONNECTIONS_PER_IP = 10;
const ipConnectionCounts: Map<string, number> = new Map();

// Per-user connection limit — prevents a single authenticated user from hogging resources
const MAX_WS_CONNECTIONS_PER_USER = 5;
const userConnectionCounts: Map<number, number> = new Map();

// Periodic token re-validation interval (check every 2 minutes)
const TOKEN_REVALIDATION_INTERVAL_MS = 2 * 60 * 1000;

export function initWebSocket(server: Server | HttpsServer): WebSocketServer {
  wss = new WebSocketServer({
    server,
    maxPayload: 1 * 1024 * 1024, // 1 MB — prevents oversized frame DoS
  });

  // Periodic session re-validation — disconnects clients whose session was revoked,
  // account was deactivated, or role was changed
  const revalidationTimer = setInterval(() => {
    for (const [clientId, client] of clients) {
      if (!client.authenticated || !client.userId) continue;
      try {
        const db = database.getDb();

        // Check if user still has at least one active session
        const activeSession = db.prepare(
          'SELECT 1 FROM sessions WHERE user_id = ? AND is_active = 1 LIMIT 1'
        ).get(client.userId);
        if (!activeSession) {
          safeSend(client.ws, JSON.stringify({ type: 'session_revoked', message: 'Your session has been terminated' }));
          client.ws.close(4003, 'Session revoked');
          // Do NOT delete from clients here — the 'close' event handler performs
          // the decrement of userConnectionCounts and full cleanup. Deleting early
          // causes clients.get(clientId) to return undefined in the close handler,
          // skipping the decrement and permanently drifting the counter upward,
          // which eventually locks the officer out with "Too many active connections".
          continue;
        }

        // Check if user account is still active and role hasn't changed
        const user = db.prepare('SELECT status, role FROM users WHERE id = ?').get(client.userId) as { status: string; role: string } | undefined;
        if (!user || user.status !== 'active') {
          safeSend(client.ws, JSON.stringify({ type: 'error', code: 'SESSION_REVOKED', message: 'Account deactivated' }));
          client.ws.close(4002, 'Account deactivated');
          // Let the 'close' event handler do the cleanup and counter decrement
        } else if (client.role && user.role !== client.role) {
          // Role changed — force reconnection so client picks up new permissions
          safeSend(client.ws, JSON.stringify({ type: 'error', code: 'ROLE_CHANGED', message: 'Your role has been updated. Please refresh.' }));
          client.ws.close(4003, 'Role changed');
          // Let the 'close' event handler do the cleanup and counter decrement
        }
      } catch { /* DB unavailable — leave connection intact until next check */ }
    }
  }, TOKEN_REVALIDATION_INTERVAL_MS);
  revalidationTimer.unref();

  wss.on('connection', (ws: WebSocket, req) => {
    // ── Origin validation ──────────────────────────────────────
    // Electron/Capacitor clients send no Origin header — allow those.
    // Browser clients must match an allowed origin.
    const origin = req.headers.origin;
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      console.warn(`[WS] Rejected connection from disallowed origin: ${origin}`);
      ws.close(4003, 'Origin not allowed');
      return;
    }

    // ── Per-IP connection limit ────────────────────────────────
    const forwarded = req.headers['x-forwarded-for'];
    const clientIp = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : null)
      || req.socket.remoteAddress || 'unknown';
    const currentCount = ipConnectionCounts.get(clientIp) || 0;
    if (currentCount >= MAX_WS_CONNECTIONS_PER_IP) {
      console.warn(`[WS] Rejected connection from ${clientIp} — exceeds ${MAX_WS_CONNECTIONS_PER_IP} connections`);
      ws.close(4009, 'Too many connections');
      return;
    }
    ipConnectionCounts.set(clientIp, currentCount + 1);

    const clientId = generateClientId();
    const client: WSClient = {
      ws,
      authenticated: false,
      channels: new Set(DEFAULT_CHANNELS),
      radioChannel: null,
      privateCallId: null,
      privateCallPartner: null,
    };
    clients.set(clientId, client);

    // URL token auth — DEPRECATED and disabled in production after 2026-04-15
    // URL tokens are visible in server access logs and browser history, making them
    // vulnerable to log exfiltration attacks. Use message-based auth instead.
    const url = req.url || '';
    const tokenMatch = url.match(/[?&]token=([^&]+)/);
    if (tokenMatch) {
      const isProductionMode = process.env.NODE_ENV === 'production';
      const pastDeadline = Date.now() >= new Date('2026-04-15T07:00:00Z').getTime(); // 00:00 Mountain Time (UTC-7)
      if (isProductionMode && pastDeadline) {
        console.warn(`[WS] Rejected URL token auth (deprecated) from ${clientIp}`);
        safeSend(ws, JSON.stringify({
          type: 'error',
          code: 'URL_TOKEN_REJECTED',
          message: 'URL token authentication has been removed. Update your client.',
        }));
        // Decrement IP counter before early return — close handler isn't registered yet
        const cnt = ipConnectionCounts.get(clientIp) || 1;
        if (cnt <= 1) ipConnectionCounts.delete(clientIp);
        else ipConnectionCounts.set(clientIp, cnt - 1);
        clients.delete(clientId);
        ws.close(4010, 'URL token auth removed');
        return;
      }
      const token = decodeURIComponent(tokenMatch[1]);
      console.warn(`[WS] Client authenticating via URL token (deprecated) from ${clientIp}`);
      authenticateClient(client, token);
      safeSend(ws, JSON.stringify({
        type: 'warning',
        code: 'URL_TOKEN_DEPRECATED',
        message: 'URL token authentication is deprecated and will be removed on 2026-04-15. Use message-based auth.',
      }));
    }

    // Auto-disconnect unauthenticated clients after timeout
    const authTimer = setTimeout(() => {
      if (!client.authenticated) {
        safeSend(ws, JSON.stringify({
          type: 'error',
          code: 'AUTH_TIMEOUT',
          message: 'Authentication timeout',
        }));
        ws.close(4001, 'Authentication timeout');
        clients.delete(clientId);
      }
    }, AUTH_TIMEOUT_MS);

    ws.on('message', (data: Buffer) => {
      // Per-client rate limiting
      const now = Date.now();
      let rate = clientMessageRates.get(clientId);
      if (!rate || now > rate.resetAt) {
        rate = { count: 0, resetAt: now + WS_RATE_LIMIT_WINDOW_MS };
        clientMessageRates.set(clientId, rate);
      }
      rate.count++;
      if (rate.count > WS_RATE_LIMIT_MAX) {
        safeSend(ws, JSON.stringify({ type: 'error', code: 'RATE_LIMITED', message: 'Too many messages' }));
        ws.close(4008, 'Rate limit exceeded');
        clients.delete(clientId);
        clientMessageRates.delete(clientId);
        return;
      }

      // Per-IP rate limiting — prevents abuse via spawning multiple WebSocket connections
      let ipRate = ipMessageRates.get(clientIp);
      if (!ipRate || now > ipRate.resetAt) {
        ipRate = { count: 0, resetAt: now + WS_RATE_LIMIT_WINDOW_MS };
        ipMessageRates.set(clientIp, ipRate);
      }
      ipRate.count++;
      if (ipRate.count > WS_IP_RATE_LIMIT_MAX) {
        safeSend(ws, JSON.stringify({ type: 'error', code: 'RATE_LIMITED', message: 'Too many messages from this IP' }));
        ws.close(4008, 'IP rate limit exceeded');
        clients.delete(clientId);
        return;
      }

      // Reject oversized messages before parsing
      if (data.length > 65536) {
        safeSend(ws, JSON.stringify({ type: 'error', code: 'MESSAGE_TOO_LARGE', message: 'Message exceeds 64KB limit' }));
        return;
      }

      try {
        const message = JSON.parse(data.toString());

        // Validate message structure — must be an object with a string 'type'
        if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
          safeSend(ws, JSON.stringify({ type: 'error', code: 'INVALID_MESSAGE', message: 'Message must have a string "type" field' }));
          return;
        }

        // Per-message-type rate limiting for sensitive operations
        const msgType = message?.type;
        if (msgType && MESSAGE_TYPE_LIMITS[msgType]) {
          const typeKey = `${clientId}:${msgType}`;
          let typeRate = messageTypeRates.get(typeKey);
          if (!typeRate || now > typeRate.resetAt) {
            typeRate = { count: 0, resetAt: now + WS_RATE_LIMIT_WINDOW_MS };
            messageTypeRates.set(typeKey, typeRate);
          }
          typeRate.count++;
          if (typeRate.count > MESSAGE_TYPE_LIMITS[msgType]) {
            safeSend(ws, JSON.stringify({ type: 'error', code: 'TYPE_RATE_LIMITED', message: `Too many ${msgType} messages` }));
            return;
          }
        }

        try {
          handleClientMessage(clientId, message);
        } catch (handlerErr) {
          console.error(`[WS] Error handling message type=${message?.type}:`, handlerErr);
        }
      } catch {
        // Log malformed messages (potential abuse detection)
        const client = clients.get(clientId);
        console.warn(`[WS] Malformed message from ${client?.username || clientId}`);
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      // Decrement per-IP connection counter
      const count = ipConnectionCounts.get(clientIp) || 1;
      if (count <= 1) ipConnectionCounts.delete(clientIp);
      else ipConnectionCounts.set(clientIp, count - 1);
      // Decrement per-user connection counter
      const closingClient = clients.get(clientId);
      if (closingClient?.userId) {
        const uc = userConnectionCounts.get(closingClient.userId) || 1;
        if (uc <= 1) userConnectionCounts.delete(closingClient.userId);
        else userConnectionCounts.set(closingClient.userId, uc - 1);
      }
      // Clean up private call and radio state before removing client
      try { handlePrivateCallDisconnect(clientId); } catch (e) { console.error('[WS] Error in private call disconnect:', e); }
      try { handleRadioDisconnect(clientId); } catch (e) { console.error('[WS] Error in radio disconnect:', e); }
      clients.delete(clientId);
      clientMessageRates.delete(clientId);
      // Broadcast updated presence when a user disconnects
      setTimeout(() => { try { broadcastPresence(); } catch (e) { console.error('[WS] Error broadcasting presence:', e); } }, 100);
    });

    ws.on('error', () => {
      clearTimeout(authTimer);
      // Decrement per-IP connection counter
      const count = ipConnectionCounts.get(clientIp) || 1;
      if (count <= 1) ipConnectionCounts.delete(clientIp);
      else ipConnectionCounts.set(clientIp, count - 1);
      // Decrement per-user connection counter (must happen before clients.delete)
      const errorClient = clients.get(clientId);
      if (errorClient?.userId) {
        const uc = userConnectionCounts.get(errorClient.userId) || 1;
        if (uc <= 1) userConnectionCounts.delete(errorClient.userId);
        else userConnectionCounts.set(errorClient.userId, uc - 1);
      }
      try { handlePrivateCallDisconnect(clientId); } catch (e) { console.error('[WS] Error in private call disconnect:', e); }
      try { handleRadioDisconnect(clientId); } catch (e) { console.error('[WS] Error in radio disconnect:', e); }
      clients.delete(clientId);
      clientMessageRates.delete(clientId);
      setTimeout(() => { try { broadcastPresence(); } catch (e) { console.error('[WS] Error broadcasting presence:', e); } }, 100);
    });

    // Send welcome message (but don't confirm authentication yet)
    safeSend(ws, JSON.stringify({
      type: 'connected',
      clientId,
      authenticated: client.authenticated,
      timestamp: new Date().toISOString(),
    }));
  });

  // ── Server-side keepalive — detect dead connections ──────────
  const PING_INTERVAL_MS = 30_000;
  const pingInterval = setInterval(() => {
    wss!.clients.forEach((ws) => {
      if ((ws as any).__isAlive === false) {
        ws.terminate();
        return;
      }
      // Only ping sockets that are fully open — ping() throws synchronously on
      // CLOSING/CLOSED sockets, which would abort the forEach and skip remaining clients
      if (ws.readyState !== WebSocket.OPEN) return;
      (ws as any).__isAlive = false;
      try { ws.ping(); } catch { /* ignore — socket may have closed between readyState check and ping */ }
    });
  }, PING_INTERVAL_MS);
  pingInterval.unref();

  wss.on('close', () => clearInterval(pingInterval));

  // Server-level error handler — prevents unhandled 'error' events on the wss
  // EventEmitter from falling through to the process uncaughtException handler
  wss.on('error', (err) => {
    console.error('[WS] WebSocketServer error:', err.message);
  });

  // Mark connections alive on pong
  wss.on('connection', (ws) => {
    (ws as any).__isAlive = true;
    ws.on('pong', () => { (ws as any).__isAlive = true; });
  });

  return wss;
}

function generateClientId(): string {
  return `ws-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function authenticateClient(client: WSClient, token: string): boolean {
  try {
    // Verify with iss/aud claims for consistency with main authenticateToken
    const JWT_VERIFY_OPTIONS = { issuer: 'rmpg-flex', audience: 'rmpg-flex-api', algorithms: ['HS256'] as jwt.Algorithm[] };
    let decoded: JwtPayload;
    try {
      decoded = jwt.verify(token, config.jwt.secret, JWT_VERIFY_OPTIONS) as JwtPayload;
    } catch (strictErr: any) {
      // Legacy token backward compat — enforce strict validation after 2026-04-15
      if (strictErr.message?.includes('jwt issuer invalid') || strictErr.message?.includes('jwt audience invalid')) {
        decoded = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] }) as JwtPayload;
      } else {
        throw strictErr;
      }
    }

    // Only accept access tokens — reject refresh and mfa_pending tokens
    if (decoded.type !== 'access') {
      safeSend(client.ws, JSON.stringify({
        type: 'auth_error',
        message: 'Invalid token type',
      }));
      return false;
    }

    // Verify session is still active in database — reject revoked sessions
    if (decoded.sessionId) {
      try {
        const db = database.getDb();
        const session = db.prepare(
          'SELECT is_active FROM sessions WHERE session_id = ? AND is_active = 1'
        ).get(decoded.sessionId) as { is_active: number } | undefined;
        if (!session) {
          safeSend(client.ws, JSON.stringify({
            type: 'auth_error',
            message: 'Session has been revoked',
            code: 'SESSION_REVOKED',
          }));
          return false;
        }
      } catch { /* DB not ready — allow through rather than blocking */ }
    }

    // Per-user connection limit — prevent resource abuse
    const userCount = userConnectionCounts.get(decoded.userId) || 0;
    if (userCount >= MAX_WS_CONNECTIONS_PER_USER) {
      safeSend(client.ws, JSON.stringify({
        type: 'auth_error',
        message: 'Too many active connections for this user',
      }));
      client.ws.close(4010, 'User connection limit exceeded');
      return false;
    }
    userConnectionCounts.set(decoded.userId, userCount + 1);

    client.userId = decoded.userId;
    client.username = decoded.username;
    client.fullName = decoded.fullName;
    client.role = decoded.role;
    client.authenticated = true;

    // Auto-populate unitCallSign from units table (for selcall addressing)
    try {
      const db = database.getDb();
      const unit = db.prepare(
        "SELECT call_sign FROM units WHERE officer_id = ? AND status != 'off_duty' LIMIT 1"
      ).get(decoded.userId) as { call_sign: string } | undefined;
      if (unit?.call_sign) {
        client.unitCallSign = unit.call_sign;
      }
    } catch { /* DB not ready or no unit assigned — unitCallSign stays undefined */ }

    safeSend(client.ws, JSON.stringify({
      type: 'authenticated',
      userId: decoded.userId,
      username: decoded.username,
      timestamp: new Date().toISOString(),
    }));

    // Broadcast updated presence to all clients
    setTimeout(() => broadcastPresence(), 100);

    return true;
  } catch (err: any) {
    safeSend(client.ws, JSON.stringify({
      type: 'auth_error',
      message: err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token',
    }));
    return false;
  }
}

function handleClientMessage(clientId: string, message: any): void {
  const client = clients.get(clientId);
  if (!client) return;

  switch (message.type) {
    case 'authenticate':
      // JWT-based authentication
      if (message.token) {
        authenticateClient(client, message.token);
      } else {
        safeSend(client.ws, JSON.stringify({
          type: 'auth_error',
          message: 'Token required for authentication',
        }));
      }
      break;

    case 'subscribe':
      if (!client.authenticated) {
        safeSend(client.ws, JSON.stringify({ type: 'error', message: 'Authentication required' }));
        return;
      }
      if (message.channel) {
        client.channels.add(message.channel);
      }
      break;

    case 'unsubscribe':
      if (!client.authenticated) {
        safeSend(client.ws, JSON.stringify({ type: 'error', message: 'Authentication required' }));
        return;
      }
      if (message.channel) {
        client.channels.delete(message.channel);
      }
      break;

    case 'ping':
      safeSend(client.ws, JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
      break;

    case 'panic_audio':
      // Relay audio chunk from panic sender to ALL other authenticated clients
      if (!client.authenticated) return;
      broadcastPanicAudio(clientId, message.data);

      // ── Server-side panic audio recording (Task 4) ──
      // Write incoming audio chunks to disk for post-incident review
      if (message.data?.panicId) {
        const panicUploadDir = path.join(__ws_dirname, '../../uploads/panic');
        try {
          if (!fs.existsSync(panicUploadDir)) {
            fs.mkdirSync(panicUploadDir, { recursive: true });
          }
        } catch (mkdirErr) {
          console.error('[Panic Audio] Failed to create uploads/panic directory:', mkdirErr);
        }

        if (message.data.chunk === true && message.data.audioData) {
          // Append base64-decoded audio chunk to raw file
          try {
            const rawPath = path.join(panicUploadDir, `${message.data.panicId}_raw.webm`);
            const audioBuffer = Buffer.from(message.data.audioData, 'base64');
            fs.appendFileSync(rawPath, audioBuffer);
          } catch (writeErr) {
            console.error(`[Panic Audio] Failed to write chunk for panic #${message.data.panicId}:`, writeErr);
          }
        }

        if (message.data.end === true) {
          // Audio stream ended — create attachment record and link to panic
          try {
            const panicId = message.data.panicId;
            const rawPath = path.join(panicUploadDir, `${panicId}_raw.webm`);
            if (fs.existsSync(rawPath)) {
              const stats = fs.statSync(rawPath);
              const timestamp = Date.now();
              const fileId = `panic_${panicId}_${timestamp}`;
              const storedName = `${panicId}_raw.webm`;
              const db = database.getDb();

              db.prepare(`
                INSERT INTO attachments (file_id, original_name, stored_name, file_path, mime_type, file_size, entity_type, entity_id, uploaded_by, created_at)
                VALUES (?, ?, ?, ?, 'audio/webm', ?, 'panic_alert', ?, ?, datetime('now','localtime'))
              `).run(
                fileId,
                `panic_${panicId}_audio.webm`,
                storedName,
                rawPath,
                stats.size,
                panicId,
                client.userId || 0
              );

              // Link audio to panic_alerts record
              const updateFields: string[] = ['audio_file_id = ?'];
              const updateValues: any[] = [fileId];
              if (message.data.duration != null) {
                updateFields.push('audio_duration_seconds = ?');
                updateValues.push(Math.round(message.data.duration));
              }
              updateValues.push(panicId);
              db.prepare(`UPDATE panic_alerts SET ${updateFields.join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`)
                .run(...updateValues);

              console.log(`[Panic Audio] Saved ${stats.size} bytes for panic #${panicId} -> ${fileId}`);
            }
          } catch (endErr) {
            console.error(`[Panic Audio] Failed to finalize audio for panic #${message.data.panicId}:`, endErr);
          }
        }
      }
      break;

    case 'panic_audio_response':
      // Relay audio response from responder to the original panic sender
      if (!client.authenticated) return;
      if (message.targetUserId) {
        sendToUser(message.targetUserId, 'panic_audio_response', {
          ...message.data,
          fromUser: client.username,
          fromUserId: client.userId,
        });
      }
      break;

    // ─── Radio PTT ──────────────────────────────────────────
    case 'radio_channel_join':
      if (!client.authenticated) return;
      handleRadioJoin(clientId, message.radioChannel);
      break;

    case 'radio_channel_leave':
      if (!client.authenticated) return;
      handleRadioLeave(clientId);
      break;

    case 'radio_transmit_start':
      if (!client.authenticated) return;
      handleRadioTransmitStart(clientId);
      break;

    case 'radio_transmit_end':
      if (!client.authenticated) return;
      handleRadioTransmitEnd(clientId, message.data);
      break;

    case 'radio_audio':
      if (!client.authenticated) return;
      relayRadioAudio(clientId, message.data);
      break;

    // ─── MDC Selcall ────────────────────────────────────────
    case 'selcall_page':
      if (!client.authenticated) return;
      handleSelcallPage(clientId, message.data);
      break;
    case 'emergency_override':
      if (!client.authenticated) return;
      handleEmergencyOverride(clientId, message.data);
      break;
    case 'set_call_sign':
      if (!client.authenticated) return;
      if (typeof message.callSign === 'string' && message.callSign.length <= 20) {
        client.unitCallSign = message.callSign.trim() || undefined;
      }
      break;

    case 'scan_subscribe':
      if (!client.authenticated) return;
      handleScanSubscribe(clientId, message.data);
      break;
    case 'scan_unsubscribe':
      if (!client.authenticated) return;
      handleScanUnsubscribe(clientId);
      break;

    // ─── Private Calls (Full-Duplex) ─────────────────────
    case 'private_call_request':
      if (!client.authenticated) return;
      handlePrivateCallRequest(clientId, message.targetUserId);
      break;

    case 'private_call_accept':
      if (!client.authenticated) return;
      handlePrivateCallAccept(clientId, message.callId);
      break;

    case 'private_call_decline':
      if (!client.authenticated) return;
      handlePrivateCallDecline(clientId, message.callId);
      break;

    case 'private_call_end':
      if (!client.authenticated) return;
      handlePrivateCallEnd(clientId);
      break;

    case 'private_call_audio':
      if (!client.authenticated) return;
      relayPrivateCallAudio(clientId, message.data);
      break;

    default:
      // Reject unknown message types — prevents abuse via crafted payloads
      if (message.type && typeof message.type === 'string') {
        safeSend(client.ws, JSON.stringify({
          type: 'error',
          code: 'UNKNOWN_MESSAGE_TYPE',
          message: `Unknown message type: ${String(message.type).slice(0, 50)}`,
        }));
      }
      break;
  }
}

// ─── Generic Broadcast / Send ─────────────────────────────────

export function broadcast(channel: string, type: string, data: any): void {
  let payload: string;
  try {
    payload = JSON.stringify({
      channel,
      type,
      data,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    // Circular references or non-serializable values in `data` would otherwise
    // propagate back into the calling HTTP handler and return a 500 — while
    // silently dropping the broadcast. Log it here and bail safely.
    console.error(`[WS] broadcast() JSON.stringify failed for type="${type}" channel="${channel}":`, err?.message ?? err);
    return;
  }

  clients.forEach((client) => {
    if (client.authenticated && client.channels.has(channel)) {
      safeSend(client.ws, payload);
    }
  });
}

export function sendToUser(userId: number, type: string, data: any): void {
  const payload = JSON.stringify({
    channel: 'direct',
    type,
    data,
    timestamp: new Date().toISOString(),
  });

  clients.forEach((client) => {
    if (client.authenticated && client.userId === userId) {
      safeSend(client.ws, payload);
    }
  });
}

// ─── Module-specific broadcast helpers ────────────────────────

/** Strip caller PII from call objects before broadcasting to all subscribers.
 *  Dispatch broadcasts go to ALL authenticated clients (including contract_manager),
 *  but caller PII (name, phone, address) should only be accessible via
 *  authenticated API calls where role checks apply. */
function stripCallPii(call: any): any {
  if (!call || typeof call !== 'object') return call;
  const {
    caller_name, caller_phone, caller_address, caller_relationship,
    pso_requestor_name, pso_requestor_phone, pso_requestor_email,
    process_served_to, process_served_address,
    ...safe
  } = call;
  return safe;
}

export function broadcastDispatchUpdate(data: any): void {
  // Auto-strip PII from any call object nested in the broadcast data
  const sanitized = data?.call ? { ...data, call: stripCallPii(data.call) } : data;
  broadcast('dispatch', 'dispatch_update', sanitized);
}

export function broadcastAlert(data: any): void {
  broadcast('alerts', 'alert', data);
}

/** Strip officer PII (personal phone) from unit objects before broadcasting.
 *  Unit broadcasts go to ALL authenticated clients including contract_manager,
 *  who should not receive officer personal phone numbers. */
function stripUnitPii(unit: any): any {
  if (!unit || typeof unit !== 'object') return unit;
  const { officer_phone, ...safe } = unit;
  return safe;
}

export function broadcastUnitUpdate(data: any): void {
  const sanitized = data?.unit ? { ...data, unit: stripUnitPii(data.unit) } : data;
  broadcast('dispatch', 'unit_update', sanitized);
}

export function broadcastNewMessage(data: any): void {
  // Strip message content — broadcast only a notification with metadata.
  // Full message text is fetched via authenticated API with role checks.
  const minimal = data ? {
    id: data.id,
    channel: data.channel,
    from_user_id: data.from_user_id,
    from_name: data.from_name,
    priority: data.priority,
    created_at: data.created_at,
  } : data;
  broadcast('messages', 'new_message', minimal);
}

export function broadcastPanic(data: any): void {
  // Panic alerts bypass channel filtering — send to ALL authenticated clients
  const payload = JSON.stringify({
    type: 'panic_alert',
    data,
    timestamp: new Date().toISOString(),
  });

  clients.forEach((client) => {
    if (client.authenticated) {
      safeSend(client.ws, payload);
    }
  });
}

export function broadcastPanicAudio(senderClientId: string, data: any): void {
  // Relay audio chunks to ALL authenticated clients EXCEPT the sender.
  // Also skip other connections from the SAME userId to prevent echo/reverb
  // when the officer has the app open on multiple devices (MDT + phone) in
  // close physical proximity — speakers on one device feed back into the
  // open mic on the other.
  const senderClient = clients.get(senderClientId);
  const senderUserId = senderClient?.userId ?? null;
  const enrichedData = {
    ...data,
    fromUserId: senderUserId,
    fromUser: senderClient?.username ?? null,
  };

  const payload = JSON.stringify({
    type: 'panic_audio',
    data: enrichedData,
    timestamp: new Date().toISOString(),
  });

  clients.forEach((client, id) => {
    // Skip the exact sender connection AND any other connections from the same user
    if (id === senderClientId) return;
    if (senderUserId && client.userId === senderUserId) return;
    if (client.authenticated) {
      safeSend(client.ws, payload);
    }
  });
}

export function getConnectedClientCount(): number {
  let count = 0;
  clients.forEach((client) => {
    if (client.authenticated) count++;
  });
  return count;
}

export function broadcastRecordUpdate(data: any): void {
  broadcast('records', 'record_update', data);
}

export function broadcastPersonnelUpdate(data: any): void {
  broadcast('personnel', 'personnel_update', data);
}

export function broadcastFleetUpdate(data: any): void {
  broadcast('fleet', 'fleet_update', data);
}

export function broadcastIncidentUpdate(data: any): void {
  broadcast('incidents', 'incident_update', data);
}

export function broadcastCitationUpdate(data: any): void {
  broadcast('citations', 'citation_update', data);
}

export function broadcastPatrolUpdate(data: any): void {
  broadcast('patrol', 'patrol_update', data);
}

export function broadcastAdminUpdate(data: any): void {
  broadcast('admin', 'admin_update', data);
}

// ─── Presence system ──────────────────────────────────────────

export function broadcastPresence(): void {
  const users: { userId: number; username: string; role: string }[] = [];
  const seen = new Set<number>();

  clients.forEach((client) => {
    if (client.authenticated && client.userId && !seen.has(client.userId)) {
      seen.add(client.userId);
      users.push({
        userId: client.userId,
        username: client.username || 'Unknown',
        role: client.role || 'unknown',
      });
    }
  });

  broadcast('presence', 'presence_update', { users, count: users.length });
}

export function getConnectedUsers(): { userId: number; username: string; role: string }[] {
  const users: { userId: number; username: string; role: string }[] = [];
  const seen = new Set<number>();

  clients.forEach((client) => {
    if (client.authenticated && client.userId && !seen.has(client.userId)) {
      seen.add(client.userId);
      users.push({
        userId: client.userId,
        username: client.username || 'Unknown',
        role: client.role || 'unknown',
      });
    }
  });

  return users;
}

// ─── Radio System ─────────────────────────────────────────────
// PTT two-way radio with named channels. Only one user can
// transmit per channel at a time.

/** Build the list of users on a specific radio channel */
function getRadioChannelUsers(radioChannel: string): Array<{ userId: number; username: string; fullName: string; role: string }> {
  const users: Array<{ userId: number; username: string; fullName: string; role: string }> = [];
  const seen = new Set<number>();

  clients.forEach((client) => {
    if (client.authenticated && client.radioChannel === radioChannel && client.userId && !seen.has(client.userId)) {
      seen.add(client.userId);
      users.push({
        userId: client.userId,
        username: client.username || 'Unknown',
        fullName: client.fullName || client.username || 'Unknown',
        role: client.role || 'unknown',
      });
    }
  });

  return users;
}

/** Send a message to all clients on a specific radio channel */
function broadcastToRadioChannel(radioChannel: string, type: string, data: any, excludeClientId?: string): void {
  const payload = JSON.stringify({
    type,
    data,
    timestamp: new Date().toISOString(),
  });

  clients.forEach((client, id) => {
    if (
      client.authenticated &&
      client.radioChannel === radioChannel &&
      id !== excludeClientId
    ) {
      safeSend(client.ws, payload);
    }

    // Also send to clients scanning this channel (for audio relay too)
    const scanChannels = client.scanChannels;
    if (scanChannels?.includes(radioChannel) && id !== excludeClientId) {
      // Already sent above if client is on the channel, skip duplicates
      if (client.radioChannel !== radioChannel) {
        safeSend(client.ws, payload);
      }
    }
  });
}

/** Handle a client joining a radio channel */
function handleRadioJoin(clientId: string, radioChannel: string): void {
  const client = clients.get(clientId);
  const validChannels = getRadioChannelNames();
  if (!client) {
    console.warn('[Radio] join failed: client not found', clientId);
    return;
  }
  if (!validChannels.includes(radioChannel)) {
    console.warn('[Radio] join failed: invalid channel', radioChannel,
      '| valid:', validChannels.join(', '), '| user:', client.username);
    return;
  }
  console.log('[Radio]', client.username, 'joining channel', radioChannel);

  // Leave current channel first
  if (client.radioChannel) {
    handleRadioLeave(clientId);
  }

  client.radioChannel = radioChannel;

  // Notify everyone on that channel about the new user
  broadcastToRadioChannel(radioChannel, 'radio_channel_join', {
    userId: client.userId,
    username: client.username,
    fullName: client.fullName,
    role: client.role,
  });

  // Send the full channel state to the joining client
  const transmitterClientId = activeTransmitters.get(radioChannel);
  const transmitter = transmitterClientId ? clients.get(transmitterClientId) : null;

  safeSend(client.ws, JSON.stringify({
    type: 'radio_channel_state',
    data: {
      radioChannel,
      users: getRadioChannelUsers(radioChannel),
      activeSpeaker: transmitter ? {
        userId: transmitter.userId,
        username: transmitter.username,
        fullName: transmitter.fullName,
      } : null,
    },
    timestamp: new Date().toISOString(),
  }));
}

/** Handle a client leaving their radio channel */
function handleRadioLeave(clientId: string): void {
  const client = clients.get(clientId);
  if (!client || !client.radioChannel) return;

  const channel = client.radioChannel;

  // If this client was transmitting, end the transmission
  if (activeTransmitters.get(channel) === clientId) {
    activeTransmitters.delete(channel);
    loggedTransmissions.delete(`${channel}:${clientId}`);
    broadcastToRadioChannel(channel, 'radio_transmit_end', {
      userId: client.userId,
      username: client.username,
    }, clientId);
  }

  // Clean up any orphaned audio buffers and timers for this client
  const bufKey = `${channel}:${clientId}`;
  if (audioBuffers.has(bufKey)) audioBuffers.delete(bufKey);
  const bufTimer = audioBufferTimers.get(bufKey);
  if (bufTimer) { clearTimeout(bufTimer); audioBufferTimers.delete(bufKey); }

  client.radioChannel = null;

  // Notify remaining channel members
  broadcastToRadioChannel(channel, 'radio_channel_leave', {
    userId: client.userId,
    username: client.username,
  });
}

/** Handle PTT key-down — start transmitting */
function handleRadioTransmitStart(clientId: string): void {
  const client = clients.get(clientId);
  if (!client || !client.radioChannel) {
    console.warn('[Radio] transmit_start failed: client not found or not on channel',
      clientId, client?.username, 'radioChannel:', client?.radioChannel);
    return;
  }
  console.log('[Radio]', client.username, 'keying up on', client.radioChannel);

  const channel = client.radioChannel;

  // Enforce one-at-a-time: reject if someone else is already transmitting
  const currentTransmitter = activeTransmitters.get(channel);
  if (currentTransmitter && currentTransmitter !== clientId) {
    // Defensive: if the transmitter's client no longer exists or is disconnected, clear the stale entry
    const transmitterClient = clients.get(currentTransmitter);
    if (!transmitterClient || transmitterClient.ws.readyState !== WebSocket.OPEN) {
      activeTransmitters.delete(channel);
      loggedTransmissions.delete(`${channel}:${currentTransmitter}`);
      console.warn('[Radio] Cleared stale transmitter on', channel, '(client gone)');
    } else {
      safeSend(client.ws, JSON.stringify({
        type: 'radio_transmit_start',
        data: { denied: true, reason: 'Channel busy' },
        timestamp: new Date().toISOString(),
      }));
      return;
    }
  }

  activeTransmitters.set(channel, clientId);

  // Initialize audio buffer for this transmission
  const bufferKey = `${channel}:${clientId}`;
  audioBuffers.set(bufferKey, []);

  // Auto-end unterminated transmissions after 2 minutes
  const existingTimer = audioBufferTimers.get(bufferKey);
  if (existingTimer) clearTimeout(existingTimer);
  audioBufferTimers.set(bufferKey, setTimeout(() => {
    if (activeTransmitters.get(channel) === clientId) {
      console.warn(`[Radio] Auto-ending unterminated transmission from ${client.username} on ${channel} (${AUDIO_BUFFER_TIMEOUT_MS / 1000}s timeout)`);
      handleRadioTransmitEnd(clientId, { transcript: '[Transmission auto-ended — timeout]', duration: AUDIO_BUFFER_TIMEOUT_MS / 1000 });
    }
    audioBufferTimers.delete(bufferKey);
  }, AUDIO_BUFFER_TIMEOUT_MS));

  // Notify all channel members + scanners (including sender for confirmation)
  const startPayload = JSON.stringify({
    type: 'radio_transmit_start',
    data: {
      userId: client.userId,
      username: client.username,
      fullName: client.fullName,
      role: client.role,
    },
    timestamp: new Date().toISOString(),
  });

  clients.forEach((c) => {
    if (!c.authenticated) return;
    if (c.radioChannel === channel) {
      safeSend(c.ws, startPayload);
    } else if (c.scanChannels?.includes(channel)) {
      safeSend(c.ws, startPayload);
    }
  });
}

/** Handle PTT key-up — stop transmitting */
function handleRadioTransmitEnd(clientId: string, data?: { transcript?: string; duration?: number; linked_call_id?: number }): void {
  const client = clients.get(clientId);
  if (!client || !client.radioChannel) return;

  const channel = client.radioChannel;

  // Only the active transmitter can end
  if (activeTransmitters.get(channel) !== clientId) return;

  activeTransmitters.delete(channel);
  loggedTransmissions.delete(`${channel}:${clientId}`);

  const transcript = data?.transcript || null;
  const duration = data?.duration || 0;
  const linkedCallId = data?.linked_call_id || null;

  // ── Save buffered audio to file ───────────────────────────
  let audioFilePath: string | null = null;
  let fileSize = 0;
  const bufferKey = `${channel}:${clientId}`;
  const chunks = audioBuffers.get(bufferKey);
  audioBuffers.delete(bufferKey); // always clean up

  // Clear audio buffer timeout timer
  const bufferTimer = audioBufferTimers.get(bufferKey);
  if (bufferTimer) { clearTimeout(bufferTimer); audioBufferTimers.delete(bufferKey); }

  if (chunks && chunks.length > 0) {
    try {
      // Ensure upload directory exists
      if (!fs.existsSync(RADIO_UPLOAD_DIR)) {
        fs.mkdirSync(RADIO_UPLOAD_DIR, { recursive: true });
      }
      const combined = Buffer.concat(chunks);
      fileSize = combined.length;
      // Only save if there's meaningful audio (> 1KB to skip empty/glitch transmissions)
      if (fileSize > 1024) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `radio-${channel}-${client.username || 'unknown'}-${timestamp}.webm`;
        const filePath = path.join(RADIO_UPLOAD_DIR, filename);
        fs.writeFileSync(filePath, combined);
        audioFilePath = `radio/${filename}`; // relative path for DB storage
        console.log(`[Radio] Saved audio recording: ${filename} (${(fileSize / 1024).toFixed(1)} KB)`);
      }
    } catch (err) {
      console.error('[Radio] Failed to save audio file:', err);
    }
  }

  // Save transcript + audio file path to database (non-blocking — don't let DB errors block radio)
  try {
    const db = database.getDb();
    db.prepare(
      `INSERT INTO radio_transcripts (user_id, username, full_name, channel, transcript, duration, audio_file, file_size, linked_call_id, transmitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))`
    ).run(
      client.userId,
      client.username || 'Unknown',
      client.fullName || client.username || 'Unknown',
      channel,
      transcript,
      duration,
      audioFilePath,
      fileSize > 1024 ? fileSize : null,
      linkedCallId
    );
  } catch (err) {
    console.error('Failed to save radio transcript:', err);
  }

  // Notify all channel members + scanners (include transcript so listeners can display it)
  const endPayload = JSON.stringify({
    type: 'radio_transmit_end',
    data: {
      userId: client.userId,
      username: client.username,
      fullName: client.fullName || client.username || 'Unknown',
      role: client.role,
      transcript,
      duration,
      hasAudio: !!audioFilePath,
    },
    timestamp: new Date().toISOString(),
  });

  clients.forEach((c) => {
    if (!c.authenticated) return;
    if (c.radioChannel === channel) {
      safeSend(c.ws, endPayload);
    } else if (c.scanChannels?.includes(channel)) {
      safeSend(c.ws, endPayload);
    }
  });
}

/** Relay radio audio chunk to all clients on the same channel (except sender) */
function relayRadioAudio(senderClientId: string, data: any): void {
  const sender = clients.get(senderClientId);
  if (!sender) {
    console.warn('[Radio] audio dropped: sender client not found', senderClientId);
    return;
  }
  if (!sender.radioChannel) {
    console.warn('[Radio] audio dropped: sender not on any channel', sender.username);
    return;
  }

  const channel = sender.radioChannel;

  // Only the active transmitter can send audio
  const activeId = activeTransmitters.get(channel);
  if (activeId !== senderClientId) {
    console.warn('[Radio] audio dropped: sender is not active transmitter on', channel,
      '| sender:', senderClientId, '| active:', activeId || 'NONE');
    return;
  }

  // Accumulate audio chunk into buffer for file saving
  if (data?.audio) {
    const bufferKey = `${channel}:${senderClientId}`;
    const chunks = audioBuffers.get(bufferKey);
    if (chunks) {
      try {
        chunks.push(Buffer.from(data.audio, 'base64'));
      } catch { /* ignore malformed base64 */ }
    }
  }

  // Strip any client-injected internal flags before relaying
  const { _logged, ...cleanData } = data || {};

  const enrichedData = {
    ...cleanData,
    fromUserId: sender.userId,
    fromUser: sender.username,
    fromFullName: sender.fullName,
    radioChannel: channel,
  };

  const payload = JSON.stringify({
    type: 'radio_audio',
    data: enrichedData,
    timestamp: new Date().toISOString(),
  });

  let recipientCount = 0;
  clients.forEach((client, id) => {
    if (id === senderClientId || !client.authenticated) return;

    // Send to clients on the same radio channel
    if (client.radioChannel === channel) {
      if (safeSend(client.ws, payload)) recipientCount++;
      return; // already sent, skip scan check to avoid duplicate
    }

    // Also relay to clients scanning this channel
    if (client.scanChannels?.includes(channel)) {
      if (safeSend(client.ws, payload)) recipientCount++;
    }
  });

  // Log once per transmission session (not per chunk) to avoid console spam
  const txKey = `${channel}:${senderClientId}`;
  if (!loggedTransmissions.has(txKey)) {
    loggedTransmissions.add(txKey);
    console.log('[Radio] audio relaying from', sender.username, 'on', channel, '→', recipientCount, 'recipients');
  }
}

/** Clean up radio state when a client disconnects */
function handleRadioDisconnect(clientId: string): void {
  const client = clients.get(clientId);
  if (client?.radioChannel) {
    handleRadioLeave(clientId);
  }
  // Also sweep any orphaned audioBuffers/timers for this clientId (handles edge cases
  // where radioChannel was cleared but buffers remain from a stalled transmission)
  for (const key of audioBuffers.keys()) {
    if (key.endsWith(`:${clientId}`)) {
      audioBuffers.delete(key);
      const timer = audioBufferTimers.get(key);
      if (timer) { clearTimeout(timer); audioBufferTimers.delete(key); }
      loggedTransmissions.delete(key);
    }
  }
}

// ─── MDC Selcall System ──────────────────────────────────────
// Motorola MDC-1200 inspired features: unit paging, emergency
// override, silent monitor, and cross-patch.

/** Page a specific unit — sends an alert tone + notification to target */
function handleSelcallPage(senderClientId: string, data: any): void {
  const sender = clients.get(senderClientId);
  if (!sender || !sender.authenticated) return;

  const targetUserId = data?.target_user_id;
  const targetCallSign = data?.target_call_sign;
  const message = data?.message || '';
  const channel = data?.channel || sender.radioChannel;

  if (!targetUserId && !targetCallSign) return;

  console.log(`[Selcall] ${sender.username} paging ${targetCallSign || `user:${targetUserId}`} on ${channel || 'direct'}`);

  // Find target client(s) — a user may have multiple sessions
  const targets: string[] = [];
  clients.forEach((client, id) => {
    if (!client.authenticated) return;
    if (targetUserId && client.userId === targetUserId) targets.push(id);
    else if (targetCallSign && client.unitCallSign === targetCallSign) targets.push(id);
  });

  const pagePayload = JSON.stringify({
    type: 'selcall_page',
    data: {
      from_user_id: sender.userId,
      from_username: sender.username,
      from_full_name: sender.fullName,
      from_call_sign: sender.unitCallSign || null,
      target_call_sign: targetCallSign || null,
      channel,
      message,
      timestamp: new Date().toISOString(),
    },
    timestamp: new Date().toISOString(),
  });

  targets.forEach(id => {
    const client = clients.get(id);
    if (client) safeSend(client.ws, pagePayload);
  });

  // Confirm to sender
  safeSend(sender.ws, JSON.stringify({
    type: 'selcall_page_sent',
    data: { target_call_sign: targetCallSign, target_user_id: targetUserId, delivered: targets.length },
    timestamp: new Date().toISOString(),
  }));
}

/** Emergency override — force-interrupts the current transmitter on a channel */
function handleEmergencyOverride(clientId: string, data: any): void {
  const client = clients.get(clientId);
  if (!client || !client.authenticated) return;

  const channel = data?.channel || client.radioChannel;
  if (!channel) return;

  // Check role — only supervisors+ or dispatchers can emergency override
  const allowedRoles = ['admin', 'manager', 'supervisor', 'dispatcher'];
  if (!allowedRoles.includes(client.role || '')) {
    safeSend(client.ws, JSON.stringify({
      type: 'emergency_override_denied',
      data: { reason: 'Insufficient role for emergency override' },
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  console.log(`[Radio] EMERGENCY OVERRIDE by ${client.username} on ${channel}`);

  // Force-end current transmitter
  const currentTransmitter = activeTransmitters.get(channel);
  if (currentTransmitter && currentTransmitter !== clientId) {
    const transmitter = clients.get(currentTransmitter);
    if (transmitter) {
      // Notify the interrupted user
      safeSend(transmitter.ws, JSON.stringify({
        type: 'radio_transmit_end',
        data: { forced: true, reason: 'Emergency override' },
        timestamp: new Date().toISOString(),
      }));
    }
    activeTransmitters.delete(channel);
    loggedTransmissions.delete(`${channel}:${currentTransmitter}`);

    // Clean up audio buffer
    const bufKey = `${channel}:${currentTransmitter}`;
    audioBuffers.delete(bufKey);
    const bufTimer = audioBufferTimers.get(bufKey);
    if (bufTimer) { clearTimeout(bufTimer); audioBufferTimers.delete(bufKey); }
  }

  // Clear any existing override timer for this channel
  const existingOverrideTimer = emergencyOverrideTimers.get(channel);
  if (existingOverrideTimer) clearTimeout(existingOverrideTimer);

  // Broadcast emergency override notification to all channel members
  broadcastToRadioChannel(channel, 'emergency_override', {
    userId: client.userId,
    username: client.username,
    fullName: client.fullName,
    channel,
    duration: EMERGENCY_OVERRIDE_DURATION_MS / 1000,
  });

  // Auto-clear override after timeout — broadcast channel_clear so clients know it's safe
  emergencyOverrideTimers.set(channel, setTimeout(() => {
    emergencyOverrideTimers.delete(channel);
    broadcastToRadioChannel(channel, 'emergency_override_clear', {
      channel,
      reason: 'Override expired',
    });
    console.log(`[Radio] Emergency override on ${channel} auto-cleared after ${EMERGENCY_OVERRIDE_DURATION_MS / 1000}s`);
  }, EMERGENCY_OVERRIDE_DURATION_MS));
}

/** Channel scan subscription — client wants to monitor additional channels */
function handleScanSubscribe(clientId: string, data: any): void {
  const client = clients.get(clientId);
  if (!client || !client.authenticated) return;

  const channels: string[] = data?.channels || [];
  const validChannels = getRadioChannelNames();
  const validScanChannels = channels.filter(ch => validChannels.includes(ch) && ch !== client.radioChannel);

  // Store scan channels on the client
  client.scanChannels = validScanChannels;

  safeSend(client.ws, JSON.stringify({
    type: 'scan_subscribed',
    data: { channels: validScanChannels },
    timestamp: new Date().toISOString(),
  }));
}

/** Unsubscribe from channel scanning */
function handleScanUnsubscribe(clientId: string): void {
  const client = clients.get(clientId);
  if (!client) return;
  client.scanChannels = [];

  safeSend(client.ws, JSON.stringify({
    type: 'scan_unsubscribed',
    data: {},
    timestamp: new Date().toISOString(),
  }));
}

// ─── Private Call System (Full-Duplex) ──────────────────────
// 1:1 voice calls between two users. Both parties transmit and
// receive simultaneously (full-duplex, like a phone call).

interface PrivateCall {
  callId: string;
  callerClientId: string;
  callerUserId: number;
  callerName: string;
  receiverClientId: string;
  receiverUserId: number;
  receiverName: string;
  status: 'ringing' | 'connected' | 'ended';
  startedAt: number;
  /** Auto-decline timer */
  declineTimer: ReturnType<typeof setTimeout> | null;
}

/** Active calls: callId → PrivateCall */
const activeCalls: Map<string, PrivateCall> = new Map();

/** Auto-decline timeout (seconds) */
const CALL_RING_TIMEOUT = 30;

/** Find a connected client by userId */
function findClientByUserId(userId: number): { clientId: string; client: WSClient } | null {
  for (const [id, client] of clients.entries()) {
    if (client.authenticated && client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
      return { clientId: id, client };
    }
  }
  return null;
}

/** Initiate a private call to another user */
function handlePrivateCallRequest(callerClientId: string, targetUserId: number): void {
  const caller = clients.get(callerClientId);
  if (!caller) return;

  // Check if caller is already in a call
  if (caller.privateCallId) {
    safeSend(caller.ws, JSON.stringify({
      type: 'private_call_error',
      data: { error: 'You are already in a call' },
    }));
    return;
  }

  // Find the target user
  const target = findClientByUserId(targetUserId);
  if (!target) {
    safeSend(caller.ws, JSON.stringify({
      type: 'private_call_error',
      data: { error: 'User is not online' },
    }));
    return;
  }

  // Check if target is already in a call
  if (target.client.privateCallId) {
    safeSend(caller.ws, JSON.stringify({
      type: 'private_call_error',
      data: { error: 'User is already in a call' },
    }));
    return;
  }

  const callId = `call-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  // Set up auto-decline timer
  const declineTimer = setTimeout(() => {
    const call = activeCalls.get(callId);
    if (call && call.status === 'ringing') {
      handlePrivateCallDecline(target.clientId, callId, true);
    }
  }, CALL_RING_TIMEOUT * 1000);

  const call: PrivateCall = {
    callId,
    callerClientId,
    callerUserId: caller.userId!,
    callerName: caller.fullName || caller.username || 'Unknown',
    receiverClientId: target.clientId,
    receiverUserId: targetUserId,
    receiverName: target.client.fullName || target.client.username || 'Unknown',
    status: 'ringing',
    startedAt: Date.now(),
    declineTimer,
  };

  activeCalls.set(callId, call);

  // Notify caller that the call is ringing
  safeSend(caller.ws, JSON.stringify({
    type: 'private_call_ringing',
    data: {
      callId,
      targetUserId,
      targetName: call.receiverName,
    },
  }));

  // Notify receiver of incoming call
  safeSend(target.client.ws, JSON.stringify({
    type: 'private_call_incoming',
    data: {
      callId,
      callerUserId: caller.userId,
      callerName: call.callerName,
    },
  }));

  console.log(`[PrivateCall] ${call.callerName} → ${call.receiverName} (${callId})`);
}

/** Accept an incoming private call */
function handlePrivateCallAccept(receiverClientId: string, callId: string): void {
  const call = activeCalls.get(callId);
  if (!call || call.status !== 'ringing') return;
  if (call.receiverClientId !== receiverClientId) return;

  const caller = clients.get(call.callerClientId);
  const receiver = clients.get(receiverClientId);
  if (!caller || !receiver) return;

  // Clear auto-decline timer
  if (call.declineTimer) clearTimeout(call.declineTimer);
  call.declineTimer = null;

  call.status = 'connected';
  call.startedAt = Date.now();

  // Link both clients
  caller.privateCallId = callId;
  caller.privateCallPartner = receiverClientId;
  receiver.privateCallId = callId;
  receiver.privateCallPartner = call.callerClientId;

  // Notify both parties
  const connectedPayload = {
    type: 'private_call_connected',
    data: {
      callId,
      partnerUserId: 0,
      partnerName: '',
    },
  };

  // Send to caller
  safeSend(caller.ws, JSON.stringify({
    ...connectedPayload,
    data: { callId, partnerUserId: receiver.userId, partnerName: call.receiverName },
  }));

  // Send to receiver
  safeSend(receiver.ws, JSON.stringify({
    ...connectedPayload,
    data: { callId, partnerUserId: caller.userId, partnerName: call.callerName },
  }));

  console.log(`[PrivateCall] CONNECTED: ${call.callerName} ↔ ${call.receiverName} (${callId})`);
}

/** Decline an incoming private call */
function handlePrivateCallDecline(clientId: string, callId: string, autoDecline = false): void {
  const call = activeCalls.get(callId);
  if (!call || call.status !== 'ringing') return;

  // Authorization: only the intended receiver (or auto-decline timer) can decline
  if (!autoDecline && clientId !== call.receiverClientId) {
    console.warn(`[PrivateCall] Unauthorized decline attempt: ${clientId} tried to decline call ${callId} intended for ${call.receiverClientId}`);
    return;
  }

  // Clear auto-decline timer
  if (call.declineTimer) clearTimeout(call.declineTimer);

  call.status = 'ended';

  // Notify the caller
  const caller = clients.get(call.callerClientId);
  if (caller && caller.ws.readyState === WebSocket.OPEN) {
    safeSend(caller.ws, JSON.stringify({
      type: 'private_call_declined',
      data: {
        callId,
        reason: autoDecline ? 'No answer' : 'Call declined',
      },
    }));
  }

  // Notify the receiver too (in case they also need to clean up UI)
  const receiver = clients.get(call.receiverClientId);
  if (receiver && receiver.ws.readyState === WebSocket.OPEN) {
    safeSend(receiver.ws, JSON.stringify({
      type: 'private_call_declined',
      data: {
        callId,
        reason: autoDecline ? 'No answer' : 'Call declined',
      },
    }));
  }

  activeCalls.delete(callId);
  console.log(`[PrivateCall] DECLINED: ${callId} (${autoDecline ? 'auto' : 'manual'})`);
}

/** End an active private call */
function handlePrivateCallEnd(clientId: string): void {
  const client = clients.get(clientId);
  if (!client || !client.privateCallId) return;

  const callId = client.privateCallId;
  const partnerId = client.privateCallPartner;
  const call = activeCalls.get(callId);

  // Calculate duration
  const durationSeconds = call ? Math.round((Date.now() - call.startedAt) / 1000) : 0;

  // Clean up caller
  client.privateCallId = null;
  client.privateCallPartner = null;

  // Clean up partner
  if (partnerId) {
    const partner = clients.get(partnerId);
    if (partner) {
      partner.privateCallId = null;
      partner.privateCallPartner = null;

      // Notify partner
      if (partner.ws.readyState === WebSocket.OPEN) {
        safeSend(partner.ws, JSON.stringify({
          type: 'private_call_ended',
          data: {
            callId,
            endedBy: client.userId,
            duration: durationSeconds,
          },
        }));
      }
    }
  }

  // Notify the ender too
  safeSend(client.ws, JSON.stringify({
    type: 'private_call_ended',
    data: {
      callId,
      endedBy: client.userId,
      duration: durationSeconds,
    },
  }));

  // Remove call from active map
  if (call) {
    if (call.declineTimer) clearTimeout(call.declineTimer);
    activeCalls.delete(callId);
  }

  console.log(`[PrivateCall] ENDED: ${callId} (${durationSeconds}s)`);
}

/** Relay audio chunk from one call participant to the other */
function relayPrivateCallAudio(senderClientId: string, data: any): void {
  const sender = clients.get(senderClientId);
  if (!sender || !sender.privateCallPartner) return;

  const partner = clients.get(sender.privateCallPartner);
  if (!partner || partner.ws.readyState !== WebSocket.OPEN) return;

  safeSend(partner.ws, JSON.stringify({
    type: 'private_call_audio',
    data: {
      ...data,
      fromUserId: sender.userId,
    },
    timestamp: new Date().toISOString(),
  }));
}

/** Clean up private call state when a client disconnects */
function handlePrivateCallDisconnect(clientId: string): void {
  const client = clients.get(clientId);
  if (!client) return;

  // If in a call, end it
  if (client.privateCallId) {
    handlePrivateCallEnd(clientId);
  }

  // Also clean up any pending (ringing) calls where this client is involved
  for (const [callId, call] of activeCalls.entries()) {
    if (call.callerClientId === clientId || call.receiverClientId === clientId) {
      if (call.declineTimer) clearTimeout(call.declineTimer);
      activeCalls.delete(callId);

      // Notify the other party
      const otherId = call.callerClientId === clientId ? call.receiverClientId : call.callerClientId;
      const other = clients.get(otherId);
      if (other && other.ws.readyState === WebSocket.OPEN) {
        safeSend(other.ws, JSON.stringify({
          type: 'private_call_ended',
          data: { callId, endedBy: client.userId, duration: 0, reason: 'Partner disconnected' },
        }));
      }
    }
  }
}
