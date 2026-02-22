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
  role?: string;
  authenticated: boolean;
  channels: Set<string>;
}

const clients: Map<string, WSClient> = new Map();
let wss: WebSocketServer | null = null;

// Authentication timeout — disconnect clients that don't authenticate within 10 seconds
const AUTH_TIMEOUT_MS = 10_000;

// All channels every authenticated client auto-subscribes to
const DEFAULT_CHANNELS = ['dispatch', 'alerts', 'records', 'personnel', 'fleet', 'incidents', 'citations', 'patrol', 'admin', 'presence'];

export function initWebSocket(server: Server | HttpsServer): WebSocketServer {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws: WebSocket, req) => {
    const clientId = generateClientId();
    const client: WSClient = {
      ws,
      authenticated: false,
      channels: new Set(DEFAULT_CHANNELS),
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
      clients.delete(clientId);
      // Broadcast updated presence when a user disconnects
      setTimeout(() => broadcastPresence(), 100);
    });

    ws.on('error', () => {
      clearTimeout(authTimer);
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
  }
}

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

// ─── Module-specific broadcast helpers ────────────────────────
// Each module broadcasts to its own channel so clients can subscribe selectively.

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
// Broadcasts the list of connected users to all clients.

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
