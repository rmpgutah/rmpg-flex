import { createClient, type Client, type InValue } from '@libsql/client/web';

export type { Client, InValue };

let _singleton: Client | null = null;

export function createTursoClient(env: {
  TURSO_URL?: string;
  TURSO_AUTH_TOKEN?: string;
}): Client | null {
  if (!env.TURSO_URL || !env.TURSO_AUTH_TOKEN) return null;
  return createClient({ url: env.TURSO_URL, authToken: env.TURSO_AUTH_TOKEN });
}

export function initTursoSingleton(env: {
  TURSO_URL?: string;
  TURSO_AUTH_TOKEN?: string;
}): void {
  if (_singleton !== null) return;
  _singleton = createTursoClient(env);
}

export function getTursoClient(): Client | null {
  return _singleton;
}

/** Test-only reset. Never call from production code. */
export function setTursoClient(client: Client | null): void {
  _singleton = client;
}
