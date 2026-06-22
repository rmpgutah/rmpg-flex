// Type-only import keeps types.ts free of runtime cycles — at compile
// time the import is elided, so containers/pdfToolsContainer.ts → types.ts
// stays one-way at runtime.
import type { PdfToolsContainer } from './containers/pdfToolsContainer';
import type { AnalyticsPipeline } from './utils/analytics';

export type Bindings = {
  DB: D1Database;
  // Dedicated statewide address-points DB (rmpg-geo). Optional so contexts
  // without the binding don't break; geo routes guard on it.
  GEO_DB?: D1Database;
  KV: KVNamespace;
  MAP_DATA: R2Bucket;
  // User-uploaded files. PR-E uses the business-photos/ prefix; future
  // R2-backed routes share this bucket with their own key prefixes.
  UPLOADS: R2Bucket;
  // Desktop/mobile installers R2 bucket. Served via /downloads/* and
  // /updates/* routes. Contains .exe, .dmg, .apk, .zip, .blockmap, .yml.
  DOWNLOADS: R2Bucket;
  JWT_SECRET: string;
  // Optional dedicated Ed25519 signing seed (base64 of 32 raw seed bytes) for
  // PDF chain-of-custody signatures. When unset, /pdf-tools/sign-payload derives
  // a stable seed from JWT_SECRET so signing still works (see pdfTools.ts).
  PDF_SIGNING_KEY?: string;
  CORS_ORIGINS?: string;
  PRIMARY_DOMAIN?: string;
  // Mapbox access token (secret, optional). When set, the Worker can call
  // the Mapbox Directions API for true drive-time ETAs (see src/utils/eta.ts);
  // the geocode route also hands it to the client. Absent → ETA falls back to
  // a straight-line estimate and the client geocoder falls back to Nominatim.
  MAPBOX_ACCESS_TOKEN?: string;
  // WelfareWatchDO namespace — DI-4 automated escalation timer
  WELFARE_WATCH: DurableObjectNamespace;
  // DeepResearchDO namespace — one instance per research job; alarm-driven
  // pipeline (expand → search → extract → verify → synthesize) + scheduled
  // monitors. See src/durable-objects/DeepResearchDO.ts.
  DEEP_RESEARCH: DurableObjectNamespace;
  // VoiceHubDO namespace — one instance per radio channel / panic
  // incident; the single shared hub that relays + records live voice.
  // See src/durable-objects/VoiceHubDO.ts.
  VOICE_HUB: DurableObjectNamespace;
  // AlertHubDO namespace — ONE global instance (idFromName('global')) that
  // every client holds an alert socket to. The shared bus for agency-wide
  // officer-safety broadcasts (panic) + forced-ack. See
  // src/durable-objects/AlertHubDO.ts + src/utils/alertHub.ts.
  ALERT_HUB: DurableObjectNamespace;
  // FlexCamRemuxDO namespace — one instance per footage_request_id
  // (idFromName('rmx-' + id)) for lazy MP4 → fMP4 remux. Triggered
  // by POST /api/flexcam/render/:id for format='mp4'. Free-plan
  // compatible (new_sqlite_classes; see wrangler.toml).
  FLEXCAM_REMUX: DurableObjectNamespace;
  // PDF Tools sidecar — Cloudflare Container holding qpdf + pdftotext
  // + ocrmypdf. Worker proxies to it via getContainer(env.PDF_TOOLS,
  // 'shared').fetch(req). Parameterized so getContainer<T> narrows
  // the stub type correctly.
  PDF_TOOLS: DurableObjectNamespace<PdfToolsContainer>;
  // Workers AI — vision-LLM OCR + structured field extraction for
  // process-service intake. See src/routes/serveIntake.ts.
  AI: Ai;
  // Optional LoRA fine-tune name/id for the serve-intake field extractor.
  // When set, extractFromText() applies this adapter on top of the 70B base
  // (with raw:true). Created via `wrangler ai finetune create` from the
  // adapter trained on training/data (see training/README.md). Unset → stock
  // 70B, so the fine-tune is a safe, reversible opt-in via wrangler var/secret.
  SERVE_INTAKE_LORA?: string;
  // Roboflow API key for the "ALPR Vehicle Details Capture" serverless
  // workflow (src/routes/alpr.ts → src/utils/roboflowAlpr.ts). Set via
  // `wrangler secret put ROBOFLOW_API_KEY`; unset → /api/alpr returns 503.
  // Never hard-coded; read only from c.env.
  ROBOFLOW_API_KEY?: string;
  // Optional override of the Roboflow serverless base origin
  // (default https://serverless.roboflow.com). For self-hosted inference.
  ROBOFLOW_API_URL?: string;
  // Optional override of the lean plate-only fast-scan workflow slug
  // (default 'rmpg-flex-plate-fast'). See src/utils/roboflowPlateFast.ts.
  ROBOFLOW_FAST_WORKFLOW_ID?: string;
  // Firecrawl API key — powers the iCrimeWatch SOR scrape (DataDome bypass via
  // stealth proxy) AND /api/deep-research (Worker-safe v1 REST search+scrape,
  // src/utils/firecrawl.ts). Set via `wrangler secret put FIRECRAWL_API_KEY`
  // (local dev: .dev.vars); unset → those routes return 503. Read only from c.env.
  FIRECRAWL_API_KEY?: string;
  // Optional override of the Firecrawl base origin (default https://api.firecrawl.dev).
  FIRECRAWL_API_URL?: string;
  // AES-GCM-256 key (base64, 32 bytes) encrypting the ClearPath client_secret at
  // rest in system_config. Set via `wrangler secret put CPG_ENC_KEY`; unset →
  // ClearPath credential save/use returns a clear 503. See src/utils/cpgCrypto.ts.
  CPG_ENC_KEY?: string;
  // ClearPath connection: a long-lived refresh token (from a logged-in session)
  // exchanged server-side for short access tokens. Optional ops override of the
  // admin-tab values; when set, takes precedence over system_config. Set via
  // `wrangler secret put CPG_REFRESH_TOKEN` (+ optional CPG_USER_ID).
  // See src/utils/clearpathGps.ts (getApiConfig).
  CPG_REFRESH_TOKEN?: string;
  CPG_USER_ID?: string;
  // HMAC-SHA256 shared secret for edge device (Jetson vision-LoRA) ingest.
  // Set via `wrangler secret put ALPR_EDGE_SECRET`; unset → /api/alpr/edge returns 503.
  ALPR_EDGE_SECRET?: string;
  // ─── Analytics lakehouse (R2 Data Catalog / Iceberg) ─────────────────────
  // Cloudflare Pipelines stream binding. OPTIONAL: when unset, the ALPR
  // dual-write (src/routes/alpr.ts) and the query routes (src/routes/analytics.ts)
  // no-op so the Worker is safe to deploy before the pipeline is provisioned.
  // Typed structurally (src/utils/analytics.ts) to avoid a hard dependency on the
  // `cloudflare:pipelines` ambient types at typecheck time. Wired in wrangler.toml
  // via `[[pipelines]] binding="ANALYTICS"` once `wrangler pipelines setup` runs.
  ANALYTICS?: AnalyticsPipeline;
  // Second Pipelines stream for the UNIFIED system-wide event table
  // (default.flex_events) — GPS/AVL, calls-for-service, citations, incidents,
  // patrol scans, DAR. OPTIONAL; same no-op-when-unset semantics as ANALYTICS.
  // Wired via `[[pipelines]] binding="EVENTS"` once provisioned. Every emit is
  // fire-and-forget (waitUntil), so instrumenting core CAD paths is non-blocking.
  EVENTS?: AnalyticsPipeline;
  // R2 SQL warehouse id ("<account_id>_<bucket>") printed by `wrangler pipelines
  // setup`. Unset → /api/analytics returns 503. (var in wrangler.toml)
  // Shared by both tables (alpr_reads + flex_events) when both streams write to
  // the SAME analytics bucket/catalog.
  R2_ANALYTICS_WAREHOUSE?: string;
  // Bearer token for the R2 SQL HTTP API (needs R2 SQL + R2 Data Catalog + R2
  // read on the analytics bucket). Set via `wrangler secret put R2_SQL_TOKEN`;
  // unset → /api/analytics returns 503. Read only from c.env, never hard-coded.
  R2_SQL_TOKEN?: string;
};

export type Variables = {
  user: { id: number; username: string; role: string; full_name: string };
  userId: number;
};

export type Env = { Bindings: Bindings; Variables: Variables };
