// Vite's ?raw suffix yields the file's text. Declared so tsc accepts the
// migration imports in test-workers/ — see serveReceiptPublic.test.ts for
// why those cannot be read with fs at runtime.
declare module '*.sql?raw' {
  const content: string;
  export default content;
}
