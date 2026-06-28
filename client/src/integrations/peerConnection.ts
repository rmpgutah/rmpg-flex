// ============================================================
// RMPG Flex — WebRTC Peer-to-Peer (PeerJS)
// ============================================================
// Simplified WebRTC for officer-to-dispatcher communication:
// - Direct video/audio between two endpoints
// - P2P evidence photo transfer (no server upload needed)
// - Fallback communication when dispatch server is unreachable
// ============================================================

import Peer from 'peerjs';
import type { DataConnection, MediaConnection } from 'peerjs';

// ── Types ─────────────────────────────────────────────────

export interface PeerConfig {
  /** Unique peer ID (e.g., `unit-${userId}` or `dispatch-${userId}`) */
  peerId: string;
  /** STUN/TURN server configuration */
  iceServers?: Array<{ urls: string; username?: string; credential?: string }>;
  /** Called when a data connection is received */
  onDataReceived?: (peerId: string, data: unknown) => void;
  /** Called when a media call is received */
  onCallReceived?: (call: MediaConnection, peerId: string) => void;
  /** Called when connection status changes */
  onStatusChange?: (status: 'connecting' | 'connected' | 'disconnected' | 'error') => void;
}

// ── Peer manager ──────────────────────────────────────────

let peer: Peer | null = null;
let dataConnections = new Map<string, DataConnection>();

/**
 * Initialize the PeerJS connection.
 */
export function initPeer(config: PeerConfig): Peer {
  if (peer) {
    peer.destroy();
  }

  const iceConfig = config.iceServers || [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  peer = new Peer(config.peerId, {
    config: {
      iceServers: iceConfig,
    },
  });

  peer.on('open', () => {
    config.onStatusChange?.('connected');
  });

  peer.on('disconnected', () => {
    config.onStatusChange?.('disconnected');
  });

  peer.on('error', () => {
    config.onStatusChange?.('error');
  });

  // Handle incoming data connections
  peer.on('connection', (conn) => {
    dataConnections.set(conn.peer, conn);
    conn.on('data', (data) => {
      config.onDataReceived?.(conn.peer, data);
    });
    conn.on('close', () => {
      dataConnections.delete(conn.peer);
    });
  });

  // Handle incoming calls
  peer.on('call', (call) => {
    config.onCallReceived?.(call, call.peer);
  });

  config.onStatusChange?.('connecting');
  return peer;
}

/**
 * Connect to a remote peer for data transfer.
 */
export function connectToPeer(remotePeerId: string): DataConnection | null {
  if (!peer) return null;

  const conn = peer.connect(remotePeerId, { reliable: true });
  dataConnections.set(remotePeerId, conn);

  conn.on('close', () => {
    dataConnections.delete(remotePeerId);
  });

  return conn;
}

/**
 * Send data to a connected peer.
 */
export function sendData(remotePeerId: string, data: unknown): boolean {
  const conn = dataConnections.get(remotePeerId);
  if (!conn || !conn.open) return false;
  conn.send(data);
  return true;
}

/**
 * Initiate a video/audio call to a remote peer.
 */
export async function callPeer(
  remotePeerId: string,
  options: { video?: boolean; audio?: boolean } = { video: true, audio: true }
): Promise<MediaConnection | null> {
  if (!peer) return null;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: options.video,
      audio: options.audio,
    });

    const call = peer.call(remotePeerId, stream);
    return call;
  } catch {
    return null;
  }
}

/**
 * Answer an incoming call with local media.
 */
export async function answerCall(
  call: MediaConnection,
  options: { video?: boolean; audio?: boolean } = { video: true, audio: true }
): Promise<MediaStream | null> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: options.video,
      audio: options.audio,
    });

    call.answer(stream);

    return new Promise((resolve) => {
      call.on('stream', (remoteStream) => {
        resolve(remoteStream);
      });
      call.on('error', () => resolve(null));
    });
  } catch {
    return null;
  }
}

/**
 * Send a file to a peer (evidence transfer).
 */
export function sendFile(
  remotePeerId: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<boolean> {
  return new Promise((resolve) => {
    const conn = dataConnections.get(remotePeerId);
    if (!conn || !conn.open) {
      resolve(false);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      conn.send({
        type: 'file',
        name: file.name,
        mimeType: file.type,
        size: file.size,
        data: reader.result,
      });
      onProgress?.(100);
      resolve(true);
    };
    reader.onerror = () => resolve(false);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Get current peer status.
 */
export function getPeerStatus(): {
  connected: boolean;
  peerId: string | null;
  connectionCount: number;
} {
  return {
    connected: peer?.open || false,
    peerId: peer?.id || null,
    connectionCount: dataConnections.size,
  };
}

/**
 * Destroy the peer connection and clean up.
 */
export function destroyPeer(): void {
  dataConnections.forEach(conn => conn.close());
  dataConnections.clear();
  if (peer) {
    peer.destroy();
    peer = null;
  }
}
