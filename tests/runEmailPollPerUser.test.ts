import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('runEmailPoll loops over connected users', () => {
  it('calls listConnectedUserIds instead of reading a singleton oauthInitiator', () => {
    const src = readFileSync(new URL('../src/routes/email.ts', import.meta.url), 'utf-8');
    const fnMatch = src.match(/export async function runEmailPoll[\s\S]*?\n\}\n/);
    expect(fnMatch).toBeTruthy();
    const fnSrc = fnMatch![0];
    expect(fnSrc).toMatch(/listConnectedUserIds/);
  });

  it('a single users poll failure is caught per-user (does not throw out of the whole function)', () => {
    const src = readFileSync(new URL('../src/routes/email.ts', import.meta.url), 'utf-8');
    const fnMatch = src.match(/export async function runEmailPoll[\s\S]*?\n\}\n/);
    const fnSrc = fnMatch![0];
    // Expect at least one try/catch inside the per-user loop body, distinct
    // from the existing per-message try/catch already in this function.
    const tryCount = (fnSrc.match(/\btry\s*\{/g) || []).length;
    expect(tryCount).toBeGreaterThanOrEqual(2);
  });
});
