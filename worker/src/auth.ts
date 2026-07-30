export function checkPassword(input: string, expected: string): boolean {
  return input === expected;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function signCookieValue(secret: string): Promise<string> {
  const payload = 'valid';
  const mac = await hmacHex(secret, payload);
  return `${payload}.${mac}`;
}

export async function verifyCookieValue(value: string | undefined, secret: string): Promise<boolean> {
  if (!value) return false;
  const [payload, mac] = value.split('.');
  if (!payload || !mac) return false;
  const expectedMac = await hmacHex(secret, payload);
  return mac === expectedMac && payload === 'valid';
}
