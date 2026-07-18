// ============================================================
// RMPG Flex — integration_api_keys shared helpers
// ============================================================
// SHA-256 hex digest via Web Crypto (Worker-safe, no node:crypto). This is
// the single source of truth for hashing integration API keys — both the
// admin key-issuance handler (src/routes/integrations.ts POST /keys) and
// the inbound key-validation middleware (src/middleware/apiKeyAuth.ts) call
// this so the hash format can never drift between "how we store it" and
// "how we check it".
// ============================================================

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
