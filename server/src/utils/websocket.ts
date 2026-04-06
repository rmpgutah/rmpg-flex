import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { Server as HttpsServer } from 'https';
import jwt from 'jsonwebtoken';
import config from '../config';
import crypto from 'crypto';
import database from '../models/database';

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
  /** Current radio channel (null = not on radio) */
  radioChannel: string | null;
  /** Active private call ID (null = not in a call) */
  privateCallId: string | null;
  /** Client ID of private call partner */
  privateCallPartner: string | null;
  /** IP address of the connected client */
  ip?: string;
  /** ISO timestamp when the client connected */
  connectedAt: string;
  /** Heartbeat tracking — set to true on pong, false on ping */
  isAlive: boolean;
}

const clients: Map<string, WSClient> = new Map();
let wss: WebSocketServer | null = null;

// Authentication timeout — disconnect clients that don't authenticate within 10 seconds
const AUTH_TIMEOUT_MS = 10_000;

// [FIX 29] Cap max concurrent WebSocket connections to prevent resource exhaustion
const MAX_WS_CLIENTS = 500;

// [FIX 30] Max message size to prevent memory exhaustion from large payloads
const MAX_MESSAGE_SIZE = 1024 * 1024; // 1MB

// All channels every authenticated client auto-subscribes to
const DEFAULT_CHANNELS = ['dispatch', 'alerts', 'records', 'personnel', 'fleet', 'incidents', 'citations', 'patrol', 'admin', 'presence'];

// ─── Radio State ────────────────────────────────────────────
// Tracks which radio channel each client is on, and who is
// currently transmitting on each channel (one at a time).

/** channel → clientId of the active transmitter (null = channel is clear) */
const activeTransmitters: Map<string, string> = new Map();

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

export function initWebSocket(server: Server | HttpsServer): WebSocketServer {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws: WebSocket, req) => {
    // [FIX 31] Reject new connections when at capacity
    if (clients.size >= MAX_WS_CLIENTS) {
      ws.close(1013, 'Server at capacity');
      return;
    }

    const clientId = generateClientId();
    const clientIp = req.headers['x-forwarded-for']
      ? String(req.headers['x-forwarded-for']).split(',')[0].trim()
      : req.socket?.remoteAddress || 'unknown';
    const client: WSClient = {
      ws,
      authenticated: false,
      channels: new Set(DEFAULT_CHANNELS),
      radioChannel: null,
      privateCallId: null,
      privateCallPartner: null,
      ip: clientIp,
      connectedAt: new Date().toISOString(),
      isAlive: true,
    };
    clients.set(clientId, client);

    // Try to authenticate from URL query parameter (token in ?token=...)
    const url = req.url || '';
    const tokenMatch = url.match(/[?&]token=([^&]+)/);
    if (tokenMatch) {
      // [FIX 32] Catch decodeURIComponent errors for malformed URI sequences
      try {
        const token = decodeURIComponent(tokenMatch[1]);
        authenticateClient(client, token);
      } catch {
        // Malformed token in URL — continue, client can still authenticate via message
      }
    }

    // Auto-disconnect unauthenticated clients after timeout
    const authTimer = setTimeout(() => {
      if (!client.authenticated) {
        ws.send(JSON.stringify({
          type: 'error',
          code: 'AUTH_TIMEOUT',
<<<<<<< HEAD
          message: 'Authentication timeout',
=======
          message: 'Authentication required within 10 seconds',
>>>>>>> origin/main
        }));
        ws.close(4001, 'Authentication timeout');
        clients.delete(clientId);
      }
    }, AUTH_TIMEOUT_MS);

    ws.on('message', (data: Buffer) => {
      // [FIX 33] Reject oversized messages to prevent memory exhaustion
      if (data.length > MAX_MESSAGE_SIZE) {
        ws.send(JSON.stringify({ type: 'error', message: 'Message too large' }));
        return;
      }
      try {
        const message = JSON.parse(data.toString());
        // [FIX 34] Validate message has a type field before processing
        if (!message || typeof message.type !== 'string') {
          return;
        }
        handleClientMessage(clientId, message);
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      // Clean up private call and radio state before removing client
      handlePrivateCallDisconnect(clientId);
      handleRadioDisconnect(clientId);
      clients.delete(clientId);
      // Broadcast updated presence when a user disconnects
      setTimeout(() => broadcastPresence(), 100);
    });

    ws.on('error', () => {
      clearTimeout(authTimer);
      handlePrivateCallDisconnect(clientId);
      handleRadioDisconnect(clientId);
      clients.delete(clientId);
      setTimeout(() => broadcastPresence(), 100);
    });

    // Heartbeat: mark alive on pong response
    ws.on('pong', () => {
      client.isAlive = true;
    });

    // [FIX 35] Wrap welcome message send in try/catch in case connection closes during setup
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'connected',
          clientId,
          authenticated: client.authenticated,
          timestamp: new Date().toISOString(),
        }));
      }
    } catch {
      // Connection may have closed between acceptance and this point
    }
  });

  // Heartbeat interval — ping all clients every 30s, terminate dead ones
  const heartbeatInterval = setInterval(() => {
    clients.forEach((client, clientId) => {
      if (!client.isAlive) {
        // Client did not respond to last ping — terminate
        try { client.ws.terminate(); } catch { /* already closed */ }
        handlePrivateCallDisconnect(clientId);
        handleRadioDisconnect(clientId);
        clients.delete(clientId);
        return;
      }
      client.isAlive = false;
      try {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.ping();
        }
      } catch {
        // Failed to ping — remove on next cycle
      }
    });
  }, 30_000);

  // Clean up heartbeat when server closes
  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  return wss;
}

function generateClientId(): string {
  return `ws-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function authenticateClient(client: WSClient, token: string): boolean {
  // [FIX 43] Validate token is a non-empty string
  if (!token || typeof token !== 'string' || token.length > 4096) {
    try {
      client.ws.send(JSON.stringify({ type: 'auth_error', message: 'Invalid token format' }));
    } catch { /* ignore */ }
    return false;
  }
  try {
    const decoded = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] }) as JwtPayload;

<<<<<<< HEAD
    // Only accept access tokens — reject refresh and mfa_pending tokens
    if (decoded.type !== 'access') {
      safeSend(client.ws, JSON.stringify({
=======
    // Reject refresh tokens
    if (decoded.type === 'refresh') {
      client.ws.send(JSON.stringify({
>>>>>>> origin/main
        type: 'auth_error',
        message: 'Invalid token type',
      }));
      return false;
    }

    client.userId = decoded.userId;
    client.username = decoded.username;
    client.fullName = decoded.fullName;
    client.role = decoded.role;
    client.authenticated = true;

    client.ws.send(JSON.stringify({
      type: 'authenticated',
      userId: decoded.userId,
      username: decoded.username,
      timestamp: new Date().toISOString(),
    }));

    // Broadcast updated presence to all clients
    setTimeout(() => broadcastPresence(), 100);

    return true;
  } catch (err: any) {
    // [FIX 44] Wrap error response in try/catch — client may already be disconnected
    try {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({
          type: 'auth_error',
          message: err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token',
        }));
      }
    } catch {
      // Client disconnected during auth error send
    }
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
        client.ws.send(JSON.stringify({
          type: 'auth_error',
          message: 'Token required for authentication',
        }));
      }
      break;

    case 'subscribe':
      if (!client.authenticated) {
        client.ws.send(JSON.stringify({ type: 'error', message: 'Authentication required' }));
        return;
      }
      // [FIX 41] Validate channel name is a non-empty string and limit channel set size
      if (message.channel && typeof message.channel === 'string' && message.channel.length <= 64) {
        if (client.channels.size < 50) {
          client.channels.add(message.channel);
        }
      }
      break;

    case 'unsubscribe':
      if (message.channel) {
        client.channels.delete(message.channel);
      }
      break;

    case 'ping':
      // [FIX 42] Wrap pong reply in try/catch
      try {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
        }
      } catch {
        // Client may have disconnected
      }
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
      handleRadioTransmitEnd(clientId, message.data);
      break;

    case 'radio_audio':
      if (!client.authenticated) return;
      relayRadioAudio(clientId, message.data);
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
  // [FIX 36] Wrap JSON.stringify in try/catch to handle circular references or BigInt
  let payload: string;
  try {
    payload = JSON.stringify({
      channel,
      type,
      data,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[WS] Failed to serialize broadcast payload:', err);
    return;
  }

  clients.forEach((client) => {
    if (client.authenticated && client.channels.has(channel) && client.ws.readyState === WebSocket.OPEN) {
      // [FIX 37] Wrap individual sends in try/catch so one failed client doesn't halt broadcast
      try {
        client.ws.send(payload);
      } catch {
        // Client may have disconnected between readyState check and send
      }
    }
  });
}

export function sendToUser(userId: number, type: string, data: any): void {
  // [FIX 38] Validate userId before iteration
  if (!userId || typeof userId !== 'number') return;

  let payload: string;
  try {
    payload = JSON.stringify({
      channel: 'direct',
      type,
      data,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return;
  }

  clients.forEach((client) => {
    if (client.authenticated && client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
      // [FIX 39] Wrap send in try/catch for resilience
      try {
        client.ws.send(payload);
      } catch {
        // Client may have disconnected
      }
    }
  });
}

// ─── Module-specific broadcast helpers ────────────────────────

export function broadcastDispatchUpdate(data: any): void {
  broadcast('dispatch', 'dispatch_update', data);
}

export function broadcastAlert(data: any): void {
  broadcast('alerts', 'alert', data);
}

export function broadcastUnitUpdate(data: any): void {
  broadcast('dispatch', 'unit_update', data);
}

export function broadcastNewMessage(data: any): void {
  broadcast('messages', 'new_message', data);
}

export function broadcastPanic(data: any): void {
  // Panic alerts bypass channel filtering — send to ALL authenticated clients
  let payload: string;
  try {
    payload = JSON.stringify({
      type: 'panic_alert',
      data,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return;
  }

  clients.forEach((client) => {
    if (client.authenticated && client.ws.readyState === WebSocket.OPEN) {
      // [FIX 40] Wrap panic send in try/catch — panic must not crash server
      try {
        client.ws.send(payload);
      } catch {
        // Client disconnected during send
      }
    }
  });
}

export function broadcastPanicAudio(senderClientId: string, data: any): void {
  // Relay audio chunks to ALL authenticated clients EXCEPT the sender
  // Inject the sender's userId so receivers can talk back
  const senderClient = clients.get(senderClientId);
  const enrichedData = {
    ...data,
    fromUserId: senderClient?.userId ?? null,
    fromUser: senderClient?.username ?? null,
  };

  const payload = JSON.stringify({
    type: 'panic_audio',
    data: enrichedData,
    timestamp: new Date().toISOString(),
  });

  clients.forEach((client, id) => {
    if (id !== senderClientId && client.authenticated && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
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

export function getConnectedClients(): { userId: number; username: string; role: string; connectedAt: string; ip: string }[] {
  const result: { userId: number; username: string; role: string; connectedAt: string; ip: string }[] = [];
  clients.forEach((client) => {
    if (client.authenticated && client.userId) {
      result.push({
        userId: client.userId,
        username: client.username || 'Unknown',
        role: client.role || 'unknown',
        connectedAt: client.connectedAt,
        ip: client.ip || 'unknown',
      });
    }
  });
  return result;
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
  let payload: string;
  try {
    payload = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  } catch { return; }

  clients.forEach((client, id) => {
    if (
      client.authenticated &&
      client.radioChannel === radioChannel &&
      client.ws.readyState === WebSocket.OPEN &&
      id !== excludeClientId
    ) {
      // [FIX 45] Wrap radio broadcast send in try/catch
      try {
        client.ws.send(payload);
      } catch {
        // Client disconnected during send
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

  // [FIX 47] Wrap channel state send in try/catch
  try {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify({
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
  } catch {
    // Client disconnected during send
  }
}

/** Handle a client leaving their radio channel */
function handleRadioLeave(clientId: string): void {
  const client = clients.get(clientId);
  if (!client || !client.radioChannel) return;

  const channel = client.radioChannel;

  // If this client was transmitting, end the transmission
  if (activeTransmitters.get(channel) === clientId) {
    activeTransmitters.delete(channel);
    broadcastToRadioChannel(channel, 'radio_transmit_end', {
      userId: client.userId,
      username: client.username,
    }, clientId);
  }

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
    client.ws.send(JSON.stringify({
      type: 'radio_transmit_start',
      data: { denied: true, reason: 'Channel busy' },
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  activeTransmitters.set(channel, clientId);

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
    if (c.authenticated && c.radioChannel === channel && c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(payload);
    }
  });
}

/** Handle PTT key-up — stop transmitting, save transcript to DB */
function handleRadioTransmitEnd(clientId: string, data?: any): void {
  const client = clients.get(clientId);
  if (!client || !client.radioChannel) return;

  const channel = client.radioChannel;

  // Only the active transmitter can end
  if (activeTransmitters.get(channel) !== clientId) return;

  activeTransmitters.delete(channel);

  const transcript = data?.transcript || null;
  const duration = data?.duration || 0;

  // Save transcript to database (non-blocking — don't let DB errors block radio)
  try {
    const db = database.getDb();
    db.prepare(
      `INSERT INTO radio_transcripts (user_id, username, full_name, channel, transcript, duration, transmitted_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))`
    ).run(
      client.userId,
      client.username || 'Unknown',
      client.fullName || client.username || 'Unknown',
      channel,
      transcript,
      duration
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
    },
    timestamp: new Date().toISOString(),
  });

  clients.forEach((c) => {
    if (c.authenticated && c.radioChannel === channel && c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(payload);
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

  const enrichedData = {
    ...data,
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
    if (
      id !== senderClientId &&
      client.authenticated &&
      client.radioChannel === channel &&
      client.ws.readyState === WebSocket.OPEN
    ) {
      client.ws.send(payload);
      recipientCount++;
    }
  });

  // Log first chunk per transmission for debugging (don't spam every chunk)
  if (!data._logged) {
    console.log('[Radio] audio relaying from', sender.username, 'on', channel, '→', recipientCount, 'recipients');
    data._logged = true;
  }
}

/** Clean up radio state when a client disconnects */
function handleRadioDisconnect(clientId: string): void {
  const client = clients.get(clientId);
  if (!client || !client.radioChannel) return;
  handleRadioLeave(clientId);
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
    caller.ws.send(JSON.stringify({
      type: 'private_call_error',
      data: { error: 'You are already in a call' },
    }));
    return;
  }

  // Find the target user
  const target = findClientByUserId(targetUserId);
  if (!target) {
    caller.ws.send(JSON.stringify({
      type: 'private_call_error',
      data: { error: 'User is not online' },
    }));
    return;
  }

  // Check if target is already in a call
  if (target.client.privateCallId) {
    caller.ws.send(JSON.stringify({
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
  caller.ws.send(JSON.stringify({
    type: 'private_call_ringing',
    data: {
      callId,
      targetUserId,
      targetName: call.receiverName,
    },
  }));

  // Notify receiver of incoming call
  target.client.ws.send(JSON.stringify({
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
  caller.ws.send(JSON.stringify({
    ...connectedPayload,
    data: { callId, partnerUserId: receiver.userId, partnerName: call.receiverName },
  }));

  // Send to receiver
  receiver.ws.send(JSON.stringify({
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
    caller.ws.send(JSON.stringify({
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
    receiver.ws.send(JSON.stringify({
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
        partner.ws.send(JSON.stringify({
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

  // [FIX 46] Wrap end-call notify in try/catch and readyState check
  try {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify({
        type: 'private_call_ended',
        data: {
          callId,
          endedBy: client.userId,
          duration: durationSeconds,
        },
      }));
    }
  } catch {
    // Client disconnected
  }

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

  partner.ws.send(JSON.stringify({
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
        other.ws.send(JSON.stringify({
          type: 'private_call_ended',
          data: { callId, endedBy: client.userId, duration: 0, reason: 'Partner disconnected' },
        }));
      }
    }
  }
}
