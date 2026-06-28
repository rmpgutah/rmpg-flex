// HMAC-SHA256 signed-body contract matching edge/flex_edge/signer.py:
//   payload = `${timestamp}\n${body}` ; sig = "sha256=" + hex(HMAC) ; ±REPLAY_WINDOW_SEC.
export const REPLAY_WINDOW_SEC = 300;

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signEdgePayload(secret: string, timestamp: number, body: string): Promise<string> {
  return 'sha256=' + (await hmacHex(secret, `${timestamp}\n${body}`));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyEdgeSignature(args: {
  secret: string; timestamp: number; body: string; signature: string; nowSec: number;
}): Promise<boolean> {
  if (!args.signature?.startsWith('sha256=')) return false;
  if (Math.abs(args.nowSec - args.timestamp) > REPLAY_WINDOW_SEC) return false;
  const expected = await signEdgePayload(args.secret, args.timestamp, args.body);
  return safeEqual(expected, args.signature);
}
