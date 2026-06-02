// Type-only shim for the test typecheck pass (tsconfig.test.json).
//
// The test compilation loads BOTH `@types/node` (for node:fs / import.meta.url)
// and `@cloudflare/workers-types` (so src/** still type-checks). Both packages
// declare a global `URL` class, and TypeScript resolves the global to the
// workers-types definition. That `URL` is structurally incompatible with the
// `node:url` `URL` that `fs.readFileSync(path: PathOrFileDescriptor)` expects
// (their `searchParams.entries()` iterators differ), so passing the result of
// `new URL(..., import.meta.url)` to readFileSync fails to type-check.
//
// This augments node:fs so its path-accepting signatures also accept the
// (ambient global) `URL` produced by `new URL(...)`. It changes no runtime
// behavior and no test logic — at runtime Node already accepts a URL here.
declare module 'node:fs' {
  function readFileSync(
    path: URL,
    options: { encoding: BufferEncoding; flag?: string } | BufferEncoding
  ): string;
  function readFileSync(
    path: URL,
    options?: { encoding?: null; flag?: string } | null
  ): Buffer;
}
