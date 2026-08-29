// Type-only import keeps types.ts free of runtime cycles — at compile
// time the import is elided, so containers/pdfToolsContainer.ts → types.ts
// stays one-way at runtime.
import type { PdfToolsContainer } from './containers/pdfToolsContainer';
import type { TesseractOcrContainer } from './containers/tesseractOcrContainer';
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
  TESSERACT_TRAINING: R2Bucket;
  // Desktop/mobile installers R2 bucket. Served via /downloads/* and
  // /updates/* routes. Contains .exe, .dmg, .apk, .zip, .blockmap, .yml.
  DOWNLOADS: R2Bucket;
  // Kiosk Linux sub-project 4: device registry. Optional — routes in
  // src/routes/kioskLinux.ts return { ok:false, code:'not_configured' }
  // when unset, per the established pattern for optional integrations.
  KIOSK_DB?: D1Database;
  KIOSK_DEVICES?: R2Bucket;
  // R2 S3-API credentials for presigned direct uploads (src/utils/r2Presign.ts).
  // Optional — presign routes return `{ ok:false, code:'not_configured' }` when
  // unset instead of crashing. Set via `wrangler secret put R2_ACCESS_KEY_ID`
  // and `wrangler secret put R2_SECRET_ACCESS_KEY` (never committed).
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  // Cloudflare account id — not secret, also set as a plain var below.
  R2_ACCOUNT_ID?: string;
  JWT_SECRET: string;
  // Optional dedicated Ed25519 signing seed (base64 of 32 raw seed bytes) for
  // PDF chain-of-custody signatures. When unset, /pdf-tools/sign-payload derives
  // a stable seed from JWT_SECRET so signing still works (see pdfTools.ts).
  PDF_SIGNING_KEY?: string;
  // Master Key-Encryption-Key for envelope-encrypted R2 storage (src/utils/encryptedR2.ts).
  // Wraps a fresh random per-file Data Encryption Key for each protected upload. Base64 of
  // 32 random bytes — provision via:
  //   node scripts/generate-quantum-key.mjs 32 | wrangler secret put FILE_ENCRYPTION_KEK
  // Optional: when unset, encryptedR2 derives a stable KEK from JWT_SECRET
  // (same pattern as PDF_SIGNING_KEY). Reads also try JWT-derived and
  // FILE_ENCRYPTION_KEK_PREVIOUS / JWT_SECRET_PREVIOUS so adding a dedicated
  // KEK does not brick files already wrapped under JWT_SECRET. R2 bytes are
  // never rewritten; only the D1 wrapped DEK is re-wrapped on a successful
  // historical unwrap.
  FILE_ENCRYPTION_KEK?: string;
  FILE_ENCRYPTION_KEK_PREVIOUS?: string;
  JWT_SECRET_PREVIOUS?: string;
  CORS_ORIGINS?: string;
  PRIMARY_DOMAIN?: string;
  // SPA origin used for OIDC/SSO redirects (src/routes/oidc.ts). Optional —
  // falls back to the incoming request's origin so non-prod environments
  // (previews, local dev) redirect back to themselves instead of prod.
  APP_ORIGIN?: string;
  // Mapbox access token (secret, optional). When set, the Worker can call
  // the Mapbox Directions API for true drive-time ETAs (see src/utils/eta.ts);
  // the geocode route also hands it to the client. Absent → ETA falls back to
  // a straight-line estimate and the client geocoder falls back to Nominatim.
  MAPBOX_ACCESS_TOKEN?: string;
  // Secret Mapbox token for server-side route matrix calls (Directions API).
  // Optional — route optimization falls back to haversine when unset.
  MAPBOX_SECRET_TOKEN?: string;
  // WelfareWatchDO namespace — DI-4 automated escalation timer
  WELFARE_WATCH: DurableObjectNamespace;
  // DeepResearchDO namespace — one instance per research job; alarm-driven
  // pipeline (expand → search → extract → verify → synthesize) + scheduled
  // monitors. See src/durable-objects/DeepResearchDO.ts.
  DEEP_RESEARCH: DurableObjectNamespace;
  // PersonIntelDO namespace — one instance per dossier (idFromName(`pi-${id}`));
  // alarm-driven multi-phase intelligence pipeline. See
  // src/durable-objects/PersonIntelDO.ts.
  PERSON_INTEL_DO: DurableObjectNamespace;
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
  // DispatchHub DO — single global instance used by broadcast.ts for
  // dispatch-update fan-out. Aliased from ALERT_HUB at DO level.
  HUB: DurableObjectNamespace;
  // PDF Tools sidecar — Cloudflare Container holding qpdf + pdftotext
  // + ocrmypdf. Worker proxies to it via getContainer(env.PDF_TOOLS,
  // 'shared').fetch(req). Parameterized so getContainer<T> narrows
  // the stub type correctly.
  PDF_TOOLS: DurableObjectNamespace<PdfToolsContainer>;
  // Custom Tesseract OCR sidecar — self-hosted, fine-tuned, data-sovereignty
  // motivated (see docs/superpowers/specs/2026-08-08-custom-tesseract-ocr-design.md).
  // NOT wired into production OCR — measurement-only via
  // scripts/serve-intake-vision-ab.ts. Parameterized so getContainer<T>
  // narrows the stub type correctly, matching the PDF_TOOLS pattern above.
  TESSERACT_OCR: DurableObjectNamespace<TesseractOcrContainer>;
  // Workers AI — vision-LLM OCR + structured field extraction for
  // process-service intake. See src/routes/serveIntake.ts.
  AI: Ai;
  // Optional LoRA fine-tune name/id for the serve-intake field extractor.
  // When set, extractFromText() applies this adapter on top of the 70B base
  // (with raw:true). Created via `wrangler ai finetune create` from the
  // adapter trained on training/data (see training/README.md). Unset → stock
  // 70B, so the fine-tune is a safe, reversible opt-in via wrangler var/secret.
  SERVE_INTAKE_LORA?: string;
  // Optional integration secrets (set via `wrangler secret put <NAME>`)
  FIRECRAWL_API_KEY?: string;
  FIRECRAWL_API_URL?: string;
  ALPR_EDGE_SECRET?: string;
  CPG_ENC_KEY?: string;
  TRACCAR_ENC_KEY?: string;
  ROBOFLOW_API_KEY?: string;
  ROBOFLOW_API_URL?: string;
  USPS_USER_ID?: string;
  OPENCORPORATES_API_KEY?: string;
  OPENSANCTIONS_API_KEY?: string;
  NUMVERIFY_API_KEY?: string;
  CARXE_API_KEY?: string;
  CARXE_API_BASE?: string;
  PLATE_TO_VIN_API_KEY?: string;
  VIN_DECODER_API_KEY?: string;
  PLATE_DECODER_API_KEY?: string;
  RESEND_API_KEY?: string;
  IPED_API_KEY?: string;
  EMAIL_FIELD_ENCRYPTION_KEK?: string;
  // Microsoft 365 / Azure AD app registration (optional — Admin → Email tab
  // stores encrypted copies in D1; env bindings take precedence when set).
  MS_EMAIL_CLIENT_ID?: string;
  MS_EMAIL_CLIENT_SECRET?: string;
  MS_EMAIL_TENANT_ID?: string;
  // Analytics pipeline (optional — provisioned separately)
  ANALYTICS?: AnalyticsPipeline;
  EVENTS?: AnalyticsPipeline;
  R2_ANALYTICS_WAREHOUSE?: string;
  R2_SQL_TOKEN?: string;
  // Recovery key for the admin auth-recover-all endpoint. Set via
  // `wrangler secret put RECOVERY_KEY`; used as a bypass when no one can log in.
  // Pass as `X-Recovery-Key` header. Keep secure — resets ALL user passwords.
  RECOVERY_KEY?: string;
  // Dial Connect SSO (OIDC relying party) config — see src/routes/oidc.ts and src/routes/ssoAuth.ts.
  // Set via wrangler.toml vars (issuer/client id/redirect uri) + `wrangler secret put DIALER_OIDC_CLIENT_SECRET`.
  // uri) + `wrangler secret put DIALER_OIDC_CLIENT_SECRET`. DIALER_OIDC_ISSUER
  // is the full discovery-DOCUMENT URL (ends in /.well-known/openid-configuration),
  // not a bare issuer.
  DIALER_OIDC_ISSUER?: string;
  DIALER_OIDC_CLIENT_ID?: string;
  DIALER_OIDC_CLIENT_SECRET?: string;
  DIALER_OIDC_REDIRECT_URI?: string;
  // Outbound status-sync webhook to Dial Connect (fire-and-forget, called
  // from POST /:id/status in src/routes/dispatch/calls.ts). Set via
  // wrangler.toml vars (URL) + `wrangler secret put DIAL_CONNECT_WEBHOOK_SECRET`.
  DIAL_CONNECT_WEBHOOK_URL?: string;
  DIAL_CONNECT_WEBHOOK_SECRET?: string;
  // WebBrowserSessionDO namespace — one instance per active Web Company
  // Browser session (idFromName(sessionId)). Holds a real headless Chrome
  // instance via Browser Rendering and streams screenshot frames to the
  // one connected client. See src/durable-objects/WebBrowserSessionDO.ts.
  WEB_BROWSER_SESSION: DurableObjectNamespace;
  // Browser Rendering binding — passed to @cloudflare/puppeteer's
  // puppeteer.launch(). Fetcher is the correct binding type here (same
  // shape as a service binding); puppeteer.launch() accepts it structurally.
  BROWSER: Fetcher;
};

export type Variables = {
  user: { id: number; username: string; role: string; full_name: string };
  userId: number;
  sessionId?: string | null;
  traceId?: string;
  // Set by src/middleware/kioskDeviceAuth.ts on successful device-bearer-token
  // auth (checkin/upload routes in src/routes/kioskLinux.ts) — distinct from
  // the JWT `user` above, since devices have no user account.
  kioskDevice?: { id: string; label: string };
};

export type Env = { Bindings: Bindings; Variables: Variables };
