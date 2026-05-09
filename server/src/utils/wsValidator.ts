// WebSocket message validation and request deduplication

/** Valid WebSocket message types */
export const WS_MESSAGE_TYPES = [
  'auth',
  'subscribe',
  'unsubscribe',
  'ping',
  'pong',
  'dispatch_update',
  'unit_update',
  'gps_update',
  'radio_join',
  'radio_leave',
  'radio_ptt',
  'radio_ptt_release',
  'radio_channel_switch',
  'selcall',
  'private_call_request',
  'private_call_accept',
  'private_call_reject',
  'private_call_end',
  'presence',
  'message',
  'typing',
  'scan_update',
] as const;

export type WsMessageType = (typeof WS_MESSAGE_TYPES)[number];

/** Validate a WebSocket message structure */
export function validateWsMessage(data: unknown): {
  valid: boolean;
  type?: string;
  error?: string;
} {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Message must be an object' };
  }

  const msg = data as Record<string, unknown>;

  if (!msg.type || typeof msg.type !== 'string') {
    return { valid: false, error: 'Message must have a "type" string field' };
  }

  if (!WS_MESSAGE_TYPES.includes(msg.type as WsMessageType)) {
    return { valid: false, type: msg.type, error: `Unknown message type: ${msg.type}` };
  }

  return { valid: true, type: msg.type };
}

/** Simple request deduplication using a sliding window */
export class RequestDeduplicator {
  private seen = new Map<string, number>();
  private readonly windowMs: number;
  private readonly maxSize: number;

  constructor(windowMs = 5000, maxSize = 10000) {
    this.windowMs = windowMs;
    this.maxSize = maxSize;
  }

  /** Returns true if this is a duplicate request */
  isDuplicate(key: string): boolean {
    const now = Date.now();

    // Clean expired entries periodically
    if (this.seen.size > this.maxSize) {
      for (const [k, t] of this.seen) {
        if (now - t > this.windowMs) this.seen.delete(k);
      }
    }

    const lastSeen = this.seen.get(key);
    if (lastSeen && now - lastSeen < this.windowMs) {
      return true;
    }

    this.seen.set(key, now);
    return false;
  }

  /** Clear all tracked requests */
  clear(): void {
    this.seen.clear();
  }
}
