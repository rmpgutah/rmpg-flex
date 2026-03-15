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

// Authentication timeout — disconnect clients that don't authenticate within 10 seconds
const AUTH_TIMEOUT_MS = 10_000;

// All channels every authenticated client auto-subscribes to
const DEFAULT_CHANNELS = ['dispatch', 'alerts', 'records', 'personnel', 'fleet', 'incidents', 'citations', 'patrol', 'admin', 'presence', 'messages', 'email'];

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

/** Per-client message rate limiting */
const clientMessageRates: Map<string, { count: number; resetAt: number }> = new Map();
const WS_RATE_LIMIT_WINDOW_MS = 1000; // 1 second window
const WS_RATE_LIMIT_MAX = 30;         // max messages per second

// Periodic cleanup of stale rate-limit entries and orphaned radio state (every 5 min)
setInterval(() => {
  const now = Date.now();
  // Clean expired rate-limit entries for disconnected clients
  for (const [id, rate] of clientMessageRates) {
    if (now > rate.resetAt && !clients.has(id)) clientMessageRates.delete(id);
  }
  // Clean stale loggedTransmissions for clients that are no longer connected
  for (const key of loggedTransmissions) {
    const clientId = key.split(':')[1];
    if (clientId && !clients.has(clientId)) loggedTransmissions.delete(key);
  }
  // Clean orphaned audio buffers for disconnected clients
  for (const key of audioBuffers.keys()) {
    const clientId = key.split(':')[1];
    if (clientId && !clients.has(clientId)) {
      audioBuffers.delete(key);
      const timer = audioBufferTimers.get(key);
      if (timer) { clearTimeout(timer); audioBufferTimers.delete(key); }
    }
  }
}, 5 * 60 * 1000);

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

// Allowed origins for WebSocket connections (production + local dev)
const ALLOWED_ORIGINS = new Set([
  'https://rmpgutah.us',
  'http://localhost:5173',   // Vite dev server
  'http://localhost:3001',   // Express dev server
]);

export function initWebSocket(server: Server | HttpsServer): WebSocketServer {
  wss = new WebSocketServer({
    server,
    maxPayload: 1 * 1024 * 1024, // 1 MB — prevents oversized frame DoS
  });

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

    // Try to authenticate from URL query parameter (token in ?token=...)
    const url = req.url || '';
    const tokenMatch = url.match(/[?&]token=([^&]+)/);
    if (tokenMatch) {
      const token = decodeURIComponent(tokenMatch[1]);
      authenticateClient(client, token);
    }

    // Auto-disconnect unauthenticated clients after timeout
    const authTimer = setTimeout(() => {
      if (!client.authenticated) {
        safeSend(ws, JSON.stringify({
          type: 'error',
          code: 'AUTH_TIMEOUT',
          message: 'Authentication required within 10 seconds',
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

      try {
        const message = JSON.parse(data.toString());
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

  return wss;
}

function generateClientId(): string {
  return `ws-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function authenticateClient(client: WSClient, token: string): boolean {
  try {
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;

    // Reject refresh tokens
    if (decoded.type === 'refresh') {
      safeSend(client.ws, JSON.stringify({
        type: 'auth_error',
        message: 'Invalid token type — use access token',
      }));
      return false;
    }

    client.userId = decoded.userId;
    client.username = decoded.username;
    client.fullName = decoded.fullName;
    client.role = decoded.role;
    client.authenticated = true;

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
      handleRadioTransmitEnd(clientId);
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
  }
}

// ─── Generic Broadcast / Send ─────────────────────────────────

export function broadcast(channel: string, type: string, data: any): void {
  const payload = JSON.stringify({
    channel,
    type,
    data,
    timestamp: new Date().toISOString(),
  });

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

  // Notify all channel members (including sender for confirmation)
  const payload = JSON.stringify({
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
    if (c.authenticated && c.radioChannel === channel) {
      safeSend(c.ws, payload);
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

  // Notify all channel members (include transcript so listeners can display it)
  const payload = JSON.stringify({
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
    if (c.authenticated && c.radioChannel === channel) {
      safeSend(c.ws, payload);
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

  // Broadcast emergency override notification to all channel members
  broadcastToRadioChannel(channel, 'emergency_override', {
    userId: client.userId,
    username: client.username,
    fullName: client.fullName,
    channel,
  });
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
