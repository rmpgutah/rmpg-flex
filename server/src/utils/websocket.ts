import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { Server as HttpsServer } from 'https';
import jwt from 'jsonwebtoken';
import config from '../config';
import crypto from 'crypto';

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
}

const clients: Map<string, WSClient> = new Map();
let wss: WebSocketServer | null = null;

// Authentication timeout — disconnect clients that don't authenticate within 10 seconds
const AUTH_TIMEOUT_MS = 10_000;

// All channels every authenticated client auto-subscribes to
const DEFAULT_CHANNELS = ['dispatch', 'alerts', 'records', 'personnel', 'fleet', 'incidents', 'citations', 'patrol', 'admin', 'presence'];

// ─── Radio State ────────────────────────────────────────────
// Tracks which radio channel each client is on, and who is
// currently transmitting on each channel (one at a time).

/** channel → clientId of the active transmitter (null = channel is clear) */
const activeTransmitters: Map<string, string> = new Map();

const RADIO_CHANNELS = ['dispatch', 'tac-1', 'tac-2', 'tac-3', 'patrol', 'admin'];

export function initWebSocket(server: Server | HttpsServer): WebSocketServer {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws: WebSocket, req) => {
    const clientId = generateClientId();
    const client: WSClient = {
      ws,
      authenticated: false,
      channels: new Set(DEFAULT_CHANNELS),
      radioChannel: null,
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
        ws.send(JSON.stringify({
          type: 'error',
          code: 'AUTH_TIMEOUT',
          message: 'Authentication required within 10 seconds',
        }));
        ws.close(4001, 'Authentication timeout');
        clients.delete(clientId);
      }
    }, AUTH_TIMEOUT_MS);

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        handleClientMessage(clientId, message);
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      // Clean up radio state before removing client
      handleRadioDisconnect(clientId);
      clients.delete(clientId);
      // Broadcast updated presence when a user disconnects
      setTimeout(() => broadcastPresence(), 100);
    });

    ws.on('error', () => {
      clearTimeout(authTimer);
      handleRadioDisconnect(clientId);
      clients.delete(clientId);
      setTimeout(() => broadcastPresence(), 100);
    });

    // Send welcome message (but don't confirm authentication yet)
    ws.send(JSON.stringify({
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
      client.ws.send(JSON.stringify({
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
    client.ws.send(JSON.stringify({
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
      client.ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
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
    if (client.authenticated && client.channels.has(channel) && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
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
    if (client.authenticated && client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
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
  const payload = JSON.stringify({
    type: 'panic_alert',
    data,
    timestamp: new Date().toISOString(),
  });

  clients.forEach((client) => {
    if (client.authenticated && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
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
      client.ws.readyState === WebSocket.OPEN &&
      id !== excludeClientId
    ) {
      client.ws.send(payload);
    }
  });
}

/** Handle a client joining a radio channel */
function handleRadioJoin(clientId: string, radioChannel: string): void {
  const client = clients.get(clientId);
  if (!client || !RADIO_CHANNELS.includes(radioChannel)) return;

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
  if (!client || !client.radioChannel) return;

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

/** Handle PTT key-up — stop transmitting */
function handleRadioTransmitEnd(clientId: string): void {
  const client = clients.get(clientId);
  if (!client || !client.radioChannel) return;

  const channel = client.radioChannel;

  // Only the active transmitter can end
  if (activeTransmitters.get(channel) !== clientId) return;

  activeTransmitters.delete(channel);

  // Notify all channel members
  const payload = JSON.stringify({
    type: 'radio_transmit_end',
    data: {
      userId: client.userId,
      username: client.username,
      fullName: client.fullName || client.username || 'Unknown',
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

/** Relay radio audio chunk to all clients on the same channel (except sender) */
function relayRadioAudio(senderClientId: string, data: any): void {
  const sender = clients.get(senderClientId);
  if (!sender || !sender.radioChannel) return;

  const channel = sender.radioChannel;

  // Only the active transmitter can send audio
  if (activeTransmitters.get(channel) !== senderClientId) return;

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

  clients.forEach((client, id) => {
    if (
      id !== senderClientId &&
      client.authenticated &&
      client.radioChannel === channel &&
      client.ws.readyState === WebSocket.OPEN
    ) {
      client.ws.send(payload);
    }
  });
}

/** Clean up radio state when a client disconnects */
function handleRadioDisconnect(clientId: string): void {
  const client = clients.get(clientId);
  if (!client || !client.radioChannel) return;
  handleRadioLeave(clientId);
}
