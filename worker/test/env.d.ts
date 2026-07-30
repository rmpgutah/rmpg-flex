// Types the `env` object exported by `cloudflare:test` (vitest-pool-workers).
// Mirrors the bindings configured in vitest.config.ts.
declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database;
    TEST_MIGRATIONS: D1Migration[];
  }
}
