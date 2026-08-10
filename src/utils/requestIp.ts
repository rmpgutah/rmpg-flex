// Shared client-IP extraction for Cloudflare Workers.
//
// Cloudflare stamps every edge request with `CF-Connecting-IP` (the single
// true client IP after terminating TLS). `x-forwarded-for` is a comma-
// separated chain that may include intermediate proxies — only the FIRST
// entry is the original client. `x-real-ip` is a common fallback set by
// upstream reverse proxies.
//
// On `wrangler dev` / Miniflare none of these headers exist, so the
// fallback is `'unknown'` — never an empty string, because downstream
// code uses the IP as a KV rate-limit key and an empty key collides
// across all callers.

export function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  const cfIp = c.req.header('cf-connecting-ip');
  if (cfIp) return cfIp;

  const xff = c.req.header('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();

  const realIp = c.req.header('x-real-ip');
  if (realIp) return realIp;

  return 'unknown';
}
