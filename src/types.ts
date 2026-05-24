// Type-only import keeps types.ts free of runtime cycles — at compile
// time the import is elided, so containers/pdfToolsContainer.ts → types.ts
// stays one-way at runtime.
import type { PdfToolsContainer } from './containers/pdfToolsContainer';

export type Bindings = {
  DB: D1Database;
  KV: KVNamespace;
  MAP_DATA: R2Bucket;
  // User-uploaded files. PR-E uses the business-photos/ prefix; future
  // R2-backed routes share this bucket with their own key prefixes.
  UPLOADS: R2Bucket;
  JWT_SECRET: string;
  CORS_ORIGINS?: string;
  PRIMARY_DOMAIN?: string;
  // WelfareWatchDO namespace — DI-4 automated escalation timer
  WELFARE_WATCH: DurableObjectNamespace;
  // PDF Tools sidecar — Cloudflare Container holding qpdf + pdftotext
  // + ocrmypdf. Worker proxies to it via getContainer(env.PDF_TOOLS,
  // 'shared').fetch(req). Parameterized so getContainer<T> narrows
  // the stub type correctly.
  PDF_TOOLS: DurableObjectNamespace<PdfToolsContainer>;
};

export type Variables = {
  user: { id: number; username: string; role: string; full_name: string };
  userId: number;
};

export type Env = { Bindings: Bindings; Variables: Variables };
