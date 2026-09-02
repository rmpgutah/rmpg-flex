import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, Trash2, Copy, CheckCircle2, XCircle, Key, AlertTriangle,
  Loader2, RotateCcw, ShieldCheck, ShieldOff, Globe, Eye, EyeOff, Save, Link2,
  Shield, Database, Bell, Unlock, Cloud, Cpu, MapPin, Navigation, Server, Hash,
  ExternalLink, Zap,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { asArray } from '../../utils/asArray';
import { safeDateStr, parseTimestamp } from '../../utils/dateUtils';
import { useContextMenu, type ContextMenuItem } from '../../context/ContextMenuContext';
import { useMenuActions } from '../../utils/contextMenuActions';
import { getMapboxToken } from '../../utils/mapboxApiKey';

interface Props {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

interface ApiKey {
  id: number;
  name: string;
  key_prefix: string;
  status: 'active' | 'revoked';
  last_used_at: string | null;
  request_count: number;
  created_at: string;
}

interface RequestLogEntry {
  id: number;
  created_at: string;
  details: string;
  ip_address: string | null;
  entity_id: string | null;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = parseTimestamp(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return parseTimestamp(dateStr).toLocaleDateString();
}

interface ApiKeyConfig {
  key: string;
  label: string;
  desc: string;
  pattern?: RegExp;
  formatHint?: string;
  secret?: boolean;
  testable?: boolean;
}

function validateKey(value: string, config: ApiKeyConfig): string | null {
  if (!value.trim()) return null;
  if (config.pattern && !config.pattern.test(value.trim())) {
    return config.formatHint || 'Invalid key format';
  }
  return null; // valid
}

const MAPBOX_KEYS: ApiKeyConfig[] = [
  { key: 'mapbox_username', label: 'Account Username', desc: 'Your Mapbox account username — used in style URLs and studio access (mapbox.com → Account)' },
  // NOTE: Do NOT add a `mapbox_password` field here. The app authenticates to
  // Mapbox solely via the public `mapbox_access_token` (pk.) below — the account
  // password is never used by any code path. It was previously stored in
  // system_config in PLAINTEXT (mapbox keys are not encrypted at rest on this
  // stack) and was purged 2026-06-02 as a credential-hygiene fix. Re-adding the
  // field would recreate the plaintext-secret leak.
  { key: 'mapbox_style_url', label: 'Custom Style URL', desc: 'Your Mapbox Studio custom style URL — creates a branded map (mapbox://styles/username/style_id)', formatHint: 'mapbox://styles/{username}/{style_id}' },
  { key: 'mapbox_access_token', label: 'Public Access Token', desc: 'PRIMARY — Client-side map rendering, geocoding, directions. Starts with pk.', pattern: /^pk\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, formatHint: 'Starts with pk. — from account.mapbox.com → Access Tokens' },
];

const MAP_PROVIDER_KEYS: ApiKeyConfig[] = [
  { key: 'mapbox_api_key', label: 'Mapbox Access Token', desc: 'Primary client-side map rendering engine for Map page, dispatch overlays, and beat polygons', pattern: /^pk\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, formatHint: 'Starts with pk. — from account.mapbox.com → Tokens' },
  { key: 'mapbox_username', label: 'Mapbox Username', desc: 'Your Mapbox account username — used for account-specific style access', secret: false },
  { key: 'mapbox_password', label: 'Mapbox Password', desc: 'Mapbox account password — stored encrypted, used for direct account authentication' },
  { key: 'mapbox_style_url', label: 'Mapbox Style URL', desc: 'Custom map style link — e.g. mapbox://styles/username/styleid or full URL from Mapbox Studio → Share', secret: false, formatHint: 'mapbox://styles/... or https://api.mapbox.com/styles/v1/...' },
];

const AI_ML_KEYS: ApiKeyConfig[] = [
  { key: 'openai_api_key', label: 'OpenAI', desc: 'GPT-4o / 4o-mini — narrative generation, report writing, evidence analysis. Used as fallback below Claude in the callAi() chain across Deep Research, OCR, Intel AI. Test sends a minimal Chat Completions ping.', pattern: /^sk-(?:proj-)?[A-Za-z0-9_-]{40,}$/, formatHint: 'Starts with sk- or sk-proj-', testable: true },
  { key: 'anthropic_api_key', label: 'Anthropic (Claude)', desc: 'Claude — document analysis, legal research, policy compliance checks. Deep Research & OCR silently fall back to free Workers AI when this is invalid or out of credit — use Test to confirm it actually works.', pattern: /^sk-ant-[A-Za-z0-9_-]+$/, formatHint: 'Starts with sk-ant-', testable: true },
  { key: 'replicate_api_key', label: 'Replicate', desc: 'Free tier — open-source AI models, image generation, facial similarity search' },
  { key: 'huggingface_api_key', label: 'Hugging Face', desc: 'Free tier — NLP models, text classification, entity extraction for reports', pattern: /^hf_[A-Za-z0-9]+$/, formatHint: 'Starts with hf_' },
  { key: 'deepgram_api_key', label: 'Deepgram', desc: 'Free tier: $200 credit — real-time speech-to-text, body camera transcription' },
  { key: 'assemblyai_api_key', label: 'AssemblyAI', desc: 'Free tier: 100hrs — audio transcription, speaker diarization for interviews' },
];

const CLOUD_STORAGE_KEYS: ApiKeyConfig[] = [
  { key: 'aws_access_key_id', label: 'AWS Access Key ID', desc: 'S3 storage — evidence files, body camera video, backup archives', pattern: /^AKIA[A-Z0-9]{16}$/, formatHint: 'Starts with AKIA, 20 characters' },
  { key: 'aws_secret_access_key', label: 'AWS Secret Access Key', desc: 'AWS authentication secret (paired with Access Key ID above)' },
  { key: 'aws_s3_bucket', label: 'AWS S3 Bucket Name', desc: 'Target bucket for evidence uploads and backup storage (reserved — uploads currently route through Worker R2 binding)' },
  { key: 'backblaze_key_id', label: 'Backblaze B2 Key ID', desc: 'Free tier: 10GB — low-cost evidence archival, database backups' },
  { key: 'backblaze_app_key', label: 'Backblaze B2 App Key', desc: 'Backblaze authentication (paired with Key ID above)' },
  { key: 'cloudflare_api_key', label: 'Cloudflare', desc: 'Free tier — CDN, DDoS protection, DNS management, R2 object storage' },
  { key: 'wasabi_access_key', label: 'Wasabi Access Key', desc: 'S3-compatible hot storage — no egress fees, evidence and video archival' },
];

const THIRD_PARTY_KEYS: ApiKeyConfig[] = [
  { key: 'lead_gen_rapidapi_key', label: 'Lead Generation (RapidAPI)', desc: 'Used by Overwatch → Firecrawl → Lead Gen tab', pattern: /^[a-f0-9]{40,64}$/i, formatHint: 'RapidAPI key — 40-64 hex characters' },
  { key: 'dl_ocr_rapidapi_key', label: 'DL OCR Scanner (RapidAPI)', desc: 'Used by Records → DL Search → Scan DL photo', pattern: /^[a-f0-9]{40,64}$/i, formatHint: 'RapidAPI key — 40-64 hex characters' },
  { key: 'plate_recognizer_api_key', label: 'Plate Recognizer', desc: 'Free tier: 2500/month — automatic license plate recognition from photos/video' },
  { key: 'roboflow_api_key', label: 'Roboflow', desc: 'Free tier: 10k inferences — weapon detection, vehicle classification from camera feeds' },
  { key: 'carjam_api_key', label: 'CarJam / VINAudit', desc: 'Vehicle history reports — title, accident, theft, odometer for investigations' },
  { key: 'spokeo_api_key', label: 'Spokeo / BeenVerified', desc: 'People search — reverse phone, address history, social profiles for skip tracing' },
];

const LAW_ENFORCEMENT_KEYS: ApiKeyConfig[] = [
  { key: 'ncic_api_key', label: 'NCIC / NLETS Gateway', desc: 'National Crime Information Center — warrant checks, stolen vehicle lookups, person queries' },
  { key: 'utah_dps_api_key', label: 'Utah DPS / BCI', desc: 'Utah Department of Public Safety — criminal history, sex offender registry, driver records' },
  { key: 'utah_courts_api_key', label: 'Utah Courts Xchange', desc: 'Court case search, docket lookups, hearing schedules' },
  { key: 'fbi_wanted_api_key', label: 'FBI Wanted API', desc: 'FBI Most Wanted list — free, no key required but slot reserved for future auth' },
  { key: 'dea_api_key', label: 'DEA ARCOS / Diversion', desc: 'Drug Enforcement Administration — controlled substance tracking, diversion reports' },
  { key: 'usms_api_key', label: 'US Marshals Service', desc: 'Federal fugitive warrants, sex offender registry, witness protection coordination' },
  { key: 'atf_api_key', label: 'ATF eTrace / FFL', desc: 'Firearms tracing, Federal Firearms Licensee lookups, explosives permits' },
  { key: 'interpol_api_key', label: 'INTERPOL Notices', desc: 'Public API — no key needed; INTERPOL screening source is built-in' },
  { key: 'screening_ofac_csl_api_key', label: 'OFAC / CSL (optional)', desc: 'Free ITA developer key — enables live fuzzy sanctions search; bulk-ingest works without it' },
  { key: 'nsopw_api_key', label: 'NSOPW (Sex Offender)', desc: 'Free — National Sex Offender Public Website search API' },
  { key: 'ofac_api_key', label: 'OFAC / SDN List', desc: 'Free — Treasury sanctions list, specially designated nationals for financial investigations' },
];

const GPS_WEBHOOK_KEYS: ApiKeyConfig[] = [
  { key: 'owntracks_webhook_token', label: 'OwnTracks Webhook Token', desc: 'Shared secret for OwnTracks iPhone/Android background GPS → POST /api/dispatch/gps/owntracks' },
  { key: 'traccar_webhook_token', label: 'Traccar Webhook Token', desc: 'Shared secret for Traccar Client background GPS (same endpoint, auto-detected format)' },
];

const FREE_OPEN_APIS: ApiKeyConfig[] = [
  { key: 'openweathermap_api_key', label: 'OpenWeatherMap', desc: 'Free tier: 1000 calls/day — current weather, forecasts, alerts for dispatch scene conditions', formatHint: '32-character hex key from openweathermap.org' },
  { key: 'nominatim_api_key', label: 'OpenStreetMap Nominatim', desc: 'Free geocoding — address-to-coordinates fallback (email as key)' },
  { key: 'opencage_api_key', label: 'OpenCage Geocoder', desc: 'Free tier: 2500 calls/day — reverse geocoding, address parsing, timezone lookup' },
  { key: 'ipinfo_api_key', label: 'IPinfo', desc: 'Free tier: 50k/month — IP geolocation for login audit, session tracking, threat intel' },
  { key: 'virustotal_api_key', label: 'VirusTotal', desc: 'Free tier: 4 lookups/min — file hash checks, URL scanning for evidence/forensics' },
  { key: 'abuseipdb_api_key', label: 'AbuseIPDB', desc: 'Free tier: 1000/day — check IP addresses against abuse database for security monitoring' },
  { key: 'shodan_api_key', label: 'Shodan', desc: 'Free tier: limited — internet-connected device search for OSINT/investigations' },
  { key: 'have_i_been_pwned_key', label: 'Have I Been Pwned', desc: 'Free tier: breach lookups — check if officer/suspect emails appear in data breaches' },
  { key: 'censys_api_key', label: 'Censys', desc: 'Free tier: 250/month — internet host/certificate search for OSINT, infrastructure recon' },
  { key: 'hunter_io_api_key', label: 'Hunter.io', desc: 'Free tier: 25/month — email finder, domain search for skip tracing and investigations' },
  { key: 'numverify_api_key', label: 'NumVerify', desc: 'Free tier: 100/month — phone number validation, carrier lookup, line type detection' },
  { key: 'usa_people_search_rapidapi_key', label: 'USA People Search (RapidAPI)', desc: 'Free tier: 100/month — name/phone/email public-records skip trace (RapidAPI Basic)' },
  { key: 'pdl_api_key', label: 'People Data Labs', desc: 'Free plan: 100 records/month — person enrich (contact fields hidden on free)' },
  { key: 'apollo_api_key', label: 'Apollo People Search', desc: 'Free search endpoint (0 credits) — name/title/company, no phone/email until paid enrich' },
  { key: 'hibp_api_key', label: 'HIBP API key (alias)', desc: 'Same Have I Been Pwned key; Skip Tracer also reads have_i_been_pwned_key' },
  { key: 'courtlistener_token', label: 'CourtListener token (optional)', desc: 'Free — raises rate limit; anonymous CourtListener search works without a token' },
  { key: 'abstract_api_key', label: 'AbstractAPI (Phone/Email)', desc: 'Free tier: 100/month — phone validation, email verification, IP geolocation bundle' },
  { key: 'whoisxml_api_key', label: 'WhoisXML / RDAP', desc: 'Free tier: 500/month — domain WHOIS lookup, DNS records, reverse IP for cyber investigations' },
  { key: 'urlscan_api_key', label: 'urlscan.io', desc: 'Free tier: 50/day — scan and analyze suspicious URLs, phishing detection for evidence' },
  { key: 'emailrep_api_key', label: 'EmailRep.io', desc: 'Free — email reputation scoring, breach history, social profile links for OSINT' },
];

const NOTIFICATION_KEYS: ApiKeyConfig[] = [
  { key: 'twilio_api_key', label: 'Twilio SMS / Voice', desc: 'SMS notifications, automated phone alerts, 2FA verification codes', pattern: /^SK[a-f0-9]{32}$/, formatHint: 'Twilio API key — starts with SK, 34 characters' },
  { key: 'twilio_account_sid', label: 'Twilio Account SID', desc: 'Twilio account identifier (paired with API key above)', pattern: /^AC[a-f0-9]{32}$/, formatHint: 'Starts with AC, 34 characters' },
  { key: 'sendgrid_api_key', label: 'SendGrid Email', desc: 'Transactional email delivery — court reminders, serve deadlines, report distribution', pattern: /^SG\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, formatHint: 'SendGrid key — starts with SG.' },
  { key: 'pushover_api_key', label: 'Pushover', desc: 'Free app — push notifications to officer phones for panic alerts, warrant hits, court reminders' },
  { key: 'ntfy_topic_key', label: 'ntfy.sh Topic', desc: 'Free open-source push notifications — no account required, self-hostable' },
  { key: 'slack_webhook_url', label: 'Slack Webhook', desc: 'Incoming webhook — post dispatch alerts, shift changes, BOLO updates to a Slack channel' },
  { key: 'discord_webhook_url', label: 'Discord Webhook', desc: 'Incoming webhook — post alerts and notifications to a Discord channel' },
  { key: 'telegram_bot_token', label: 'Telegram Bot', desc: 'Free — send alerts via Telegram bot to officer group chats' },
];

const DATA_SERVICE_KEYS: ApiKeyConfig[] = [
  { key: 'openmeteo_api_key', label: 'Open-Meteo / Weather', desc: 'Completely free — weather conditions for dispatch calls, incident reports, scene documentation' },
  { key: 'clearpath_gps_api_key', label: 'ClearPathGPS', desc: 'Fleet GPS tracking — vehicle positions, speed, geofence alerts' },
  { key: 'microbilt_client_id', label: 'MicroBilt Client ID', desc: 'Skip tracing — person search, address history, phone lookups' },
  { key: 'microbilt_client_secret', label: 'MicroBilt Client Secret', desc: 'MicroBilt API authentication secret (paired with Client ID above)' },
  { key: 'nhtsa_api_key', label: 'NHTSA Vehicle API', desc: 'Free — VIN decoding, vehicle recalls, crash ratings, complaints' },
  { key: 'fcc_api_key', label: 'FCC Broadband / ULS', desc: 'Free — radio license lookups, broadband coverage maps for communication planning' },
  { key: 'here_api_key', label: 'HERE Maps', desc: 'Free tier: 250k/month — routing, traffic, fleet telematics, geocoding alternative' },
  { key: 'what3words_api_key', label: 'what3words', desc: 'Free tier: 1000/month — 3-word address system for precise location sharing in the field' },
  { key: 'plaid_api_key', label: 'Plaid', desc: 'Financial investigations — bank account verification, transaction monitoring' },
  { key: 'clearbit_api_key', label: 'Clearbit', desc: 'Free tier: 50/month — company/person enrichment for skip tracing and background checks' },
  { key: 'pipl_api_key', label: 'Pipl', desc: 'People search — social profiles, emails, phones, addresses for investigations' },
  { key: 'towerdata_api_key', label: 'TowerData', desc: 'Email intelligence — identity verification, email-to-name resolution for OSINT' },
];

// Where to obtain each key — the provider's API-key / credentials page (or the
// official portal for gov/LE sources that have no self-serve key). Rendered as a
// "Get key ↗" link beside each input so admins don't have to hunt for the source.
const SOURCE_URLS: Record<string, string> = {
  // Mapbox
  mapbox_username: 'https://account.mapbox.com/',
  mapbox_style_url: 'https://studio.mapbox.com/',
  mapbox_access_token: 'https://account.mapbox.com/access-tokens/',
  // AI / ML
  openai_api_key: 'https://platform.openai.com/api-keys',
  anthropic_api_key: 'https://console.anthropic.com/settings/keys',
  replicate_api_key: 'https://replicate.com/account/api-tokens',
  huggingface_api_key: 'https://huggingface.co/settings/tokens',
  deepgram_api_key: 'https://console.deepgram.com/',
  assemblyai_api_key: 'https://www.assemblyai.com/app/account',
  roboflow_api_key: 'https://app.roboflow.com/settings/api',
  // Cloud storage
  aws_access_key_id: 'https://console.aws.amazon.com/iam/home#/security_credentials',
  aws_secret_access_key: 'https://console.aws.amazon.com/iam/home#/security_credentials',
  aws_s3_bucket: 'https://console.aws.amazon.com/s3/',
  backblaze_key_id: 'https://secure.backblaze.com/app_keys.htm',
  backblaze_app_key: 'https://secure.backblaze.com/app_keys.htm',
  cloudflare_api_key: 'https://dash.cloudflare.com/profile/api-tokens',
  wasabi_access_key: 'https://console.wasabisys.com/',
  // Third-party data / RapidAPI
  lead_gen_rapidapi_key: 'https://rapidapi.com/developer/apps',
  dl_ocr_rapidapi_key: 'https://rapidapi.com/developer/apps',
  plate_recognizer_api_key: 'https://app.platerecognizer.com/',
  carjam_api_key: 'https://www.vinaudit.com/api',
  spokeo_api_key: 'https://www.spokeo.com/',
  microbilt_client_id: 'https://developer.microbilt.com/',
  microbilt_client_secret: 'https://developer.microbilt.com/',
  clearpath_gps_api_key: 'https://www.clearpathgps.com/',
  // Law enforcement / gov (portals — no self-serve key)
  ncic_api_key: 'https://www.fbi.gov/services/cjis/ncic',
  utah_dps_api_key: 'https://bci.utah.gov/',
  utah_courts_api_key: 'https://legacy.utcourts.gov/xchange/',
  fbi_wanted_api_key: 'https://api.fbi.gov/',
  dea_api_key: 'https://www.deadiversion.usdoj.gov/arcos/',
  usms_api_key: 'https://www.usmarshals.gov/',
  atf_api_key: 'https://www.atf.gov/firearms/etrace-internet',
  interpol_api_key: 'https://interpol.api.bund.dev/',
  screening_ofac_csl_api_key: 'https://developer.trade.gov/',
  nsopw_api_key: 'https://www.nsopw.gov/',
  ofac_api_key: 'https://sanctionssearch.ofac.treas.gov/',
  // GPS webhooks (admin-chosen shared secret — link to the integration docs)
  owntracks_webhook_token: 'https://owntracks.org/booklet/features/http/',
  traccar_webhook_token: 'https://www.traccar.org/forward/',
  // Free / open APIs
  openweathermap_api_key: 'https://home.openweathermap.org/api_keys',
  openmeteo_api_key: 'https://open-meteo.com/',
  nominatim_api_key: 'https://operations.osmfoundation.org/policies/nominatim/',
  opencage_api_key: 'https://opencagedata.com/dashboard',
  ipinfo_api_key: 'https://ipinfo.io/account/token',
  here_api_key: 'https://developer.here.com/',
  what3words_api_key: 'https://developer.what3words.com/public-api',
  nhtsa_api_key: 'https://vpic.nhtsa.dot.gov/api/',
  fcc_api_key: 'https://www.fcc.gov/reports-research/developers',
  // Notifications
  twilio_api_key: 'https://console.twilio.com/us1/account/keys-credentials/api-keys',
  twilio_account_sid: 'https://console.twilio.com/',
  sendgrid_api_key: 'https://app.sendgrid.com/settings/api_keys',
  slack_webhook_url: 'https://api.slack.com/messaging/webhooks',
  discord_webhook_url: 'https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks',
  telegram_bot_token: 'https://t.me/botfather',
  pushover_api_key: 'https://pushover.net/apps/build',
  ntfy_topic_key: 'https://docs.ntfy.sh/',
  // Data services / OSINT
  numverify_api_key: 'https://numverify.com/dashboard',
  hunter_io_api_key: 'https://hunter.io/api-keys',
  usa_people_search_rapidapi_key: 'https://rapidapi.com/digital-insights-digital-insights-default/api/usa-people-search-public-records',
  pdl_api_key: 'https://www.peopledatalabs.com/signup',
  apollo_api_key: 'https://developer.apollo.io/keys',
  hibp_api_key: 'https://haveibeenpwned.com/API/Key',
  courtlistener_token: 'https://www.courtlistener.com/help/api/rest/v4/',
  clearbit_api_key: 'https://dashboard.clearbit.com/api',
  pipl_api_key: 'https://pipl.com/api',
  towerdata_api_key: 'https://www.towerdata.com/',
  abstract_api_key: 'https://app.abstractapi.com/',
  abuseipdb_api_key: 'https://www.abuseipdb.com/account/api',
  censys_api_key: 'https://search.censys.io/account/api',
  emailrep_api_key: 'https://emailrep.io/key',
  have_i_been_pwned_key: 'https://haveibeenpwned.com/API/Key',
  shodan_api_key: 'https://account.shodan.io/',
  urlscan_api_key: 'https://urlscan.io/user/profile/',
  virustotal_api_key: 'https://www.virustotal.com/gui/my-apikey',
  whoisxml_api_key: 'https://user.whoisxmlapi.com/products',
  plaid_api_key: 'https://dashboard.plaid.com/developers/keys',
};

function ApiKeyPanel({ title, icon, keys: keyConfigs }: { title: string; icon: React.ReactNode; keys: ApiKeyConfig[] }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [configured, setConfigured] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; message: string } | null>>({});

  useEffect(() => {
    // Check which keys are configured — single bulk request, no N+1.
    // Fixed 2026-06-06: the previous fallback path fired one request per key
    // (50+ keys × N panels) on every mount when the bulk endpoint 404'd.
    // The Worker now has /api/admin/third-party-keys (real handler) so the
    // bulk path always succeeds and the per-key fallback is dead code.
    (async () => {
      try {
        const data = await apiFetch<Array<{ config_key: string; has_value: boolean }>>('/admin/third-party-keys');
        const map: Record<string, boolean> = {};
        for (const item of data) map[item.config_key] = item.has_value;
        setConfigured(map);
      } catch {
        // Bulk endpoint unreachable — leave all keys in default "not set" state.
        // The per-key N+1 fallback has been removed; on a broken bulk endpoint
        // the page simply shows "Not Set" everywhere until the API recovers.
      }
    })();
  }, []);

  const handleSave = async (configKey: string) => {
    const value = values[configKey]?.trim();
    if (!value) return;
    setSaving(configKey);
    try {
      await apiFetch('/admin/third-party-keys', {
        method: 'PUT',
        body: JSON.stringify({ key: configKey, value }),
      });
      setConfigured(prev => ({ ...prev, [configKey]: true }));
      setValues(prev => ({ ...prev, [configKey]: '' }));
      // Invalidate client-side Mapbox token cache so the map page
      // picks up the new token without a full page reload.
      if (configKey.startsWith('mapbox_')) {
        getMapboxToken(true);
      }
    } catch { /* silent */ }
    setSaving(null);
  };

  const handleClear = async (configKey: string) => {
    setSaving(configKey);
    try {
      await apiFetch('/admin/third-party-keys', {
        method: 'DELETE',
        body: JSON.stringify({ key: configKey }),
      });
      setConfigured(prev => ({ ...prev, [configKey]: false }));
      setTestResult(prev => ({ ...prev, [configKey]: null }));
    } catch { /* silent */ }
    setSaving(null);
  };

  // Live-probe the stored key. Endpoint always returns 200 with { ok, message }.
  const handleTest = async (configKey: string) => {
    setTesting(configKey);
    setTestResult(prev => ({ ...prev, [configKey]: null }));
    try {
      const r = await apiFetch<{ ok: boolean; message: string }>(`/admin/third-party-keys/${configKey}/test`, { method: 'POST' });
      setTestResult(prev => ({ ...prev, [configKey]: { ok: !!r.ok, message: r.message || (r.ok ? 'OK' : 'Failed') } }));
    } catch (e: any) {
      setTestResult(prev => ({ ...prev, [configKey]: { ok: false, message: e?.message || 'Test request failed' } }));
    }
    setTesting(null);
  };

  return (
    <div className="panel-beveled bg-surface-base border border-border-default rounded-sm">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-default">
        <Key className="w-4 h-4 text-brand-400" />
        <h2 className="text-sm font-semibold text-rmpg-300">API Integrations</h2>
      </div>
      <div className="p-4 space-y-4">
        {keyConfigs.map(({ key, label, desc, formatHint, testable }) => (
          <div key={key} className="flex flex-col gap-2 p-3 bg-surface-sunken border border-rmpg-700 rounded-sm">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-rmpg-300">{label}</div>
                <div className="text-[10px] text-rmpg-600">{desc}</div>
                {SOURCE_URLS[key] && (
                  <a
                    href={SOURCE_URLS[key]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-1 text-[10px] text-brand-400 hover:text-brand-300 hover:underline"
                  >
                    <ExternalLink className="w-2.5 h-2.5" />
                    Get key / API source
                  </a>
                )}
              </div>
              {configured[key] ? (
                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-sm bg-green-900/30 text-green-400 border border-green-700/40">
                  <CheckCircle2 className="w-3 h-3" />
                  Configured
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-sm bg-yellow-900/30 text-yellow-400 border border-yellow-700/40">
                  <AlertTriangle className="w-3 h-3" />
                  Not Set
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <form
                onSubmit={(e) => { e.preventDefault(); handleSave(key); }}
                className="relative flex-1 flex items-center"
              >
                <input id={`ff-adminintegrationstab-${key}`}
                  type={showKey[key] ? 'text' : 'password'}
                  value={values[key] || ''}
                  onChange={e => setValues(prev => ({ ...prev, [key]: e.target.value }))}
                  placeholder={configured[key] ? '••••••••••••••••••••' : 'Paste API key here...'}
                  className="w-full px-3 py-2 pr-8 bg-surface-raised border border-rmpg-700 rounded-sm text-xs text-rmpg-100 font-mono placeholder-rmpg-600 focus:outline-none focus:border-brand-500"
                />
                <button type="button" onClick={() => setShowKey(prev => ({ ...prev, [key]: !showKey[key] }))} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-600 hover:text-rmpg-400">
                  {showKey[key] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
                <input type="submit" hidden />
              </form>
              <button
                type="button"
                onClick={() => handleSave(key)}
                disabled={!values[key]?.trim() || saving === key}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-rmpg-100 rounded-sm transition-colors"
              >
                {saving === key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save
              </button>
              {testable && configured[key] && (
                <button
                  type="button"
                  onClick={() => handleTest(key)}
                  disabled={testing === key}
                  title="Send a minimal live request to verify the key works (valid + funded)"
                  className="flex items-center gap-1.5 px-3 py-2 text-xs text-brand-300 hover:text-brand-200 bg-brand-900/20 hover:bg-brand-900/30 border border-brand-700/30 rounded-sm transition-colors disabled:opacity-40"
                >
                  {testing === key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                  Test
                </button>
              )}
              {configured[key] && (
                <button aria-label="Clear"
                  type="button"
                  onClick={() => handleClear(key)}
                  disabled={saving === key}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs text-red-400 hover:text-red-300 bg-red-900/20 hover:bg-red-900/30 border border-red-700/30 rounded-sm transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {testResult[key] && (
              <div className={`flex items-center gap-1.5 text-[10px] font-medium ${testResult[key]!.ok ? 'text-green-400' : 'text-red-400'}`}>
                {testResult[key]!.ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                {testResult[key]!.message}
              </div>
            )}
            {errors[key] && <div className="text-[10px] text-red-400 font-medium">⚠ {errors[key]}</div>}
            {formatHint && !errors[key] && <div className="text-[9px] text-rmpg-600 italic">{formatHint}</div>}
            <div className="text-[9px] text-rmpg-700 font-mono">config_key: {key}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminIntegrationsTab({ LoadingSpinner, error, setError }: Props) {
  // ── Connected Service: rmpgutahps.us ──
  const [svcConfigured, setSvcConfigured] = useState(false);
  const [svcUrl, setSvcUrl] = useState('https://rmpgutahps.us');
  const [svcKeyPreview, setSvcKeyPreview] = useState<string | null>(null);
  const [svcApiKey, setSvcApiKey] = useState('');
  const [svcUrlInput, setSvcUrlInput] = useState('https://rmpgutahps.us');
  const [showSvcKey, setShowSvcKey] = useState(false);
  const [savingSvc, setSavingSvc] = useState(false);
  const [loadingSvc, setLoadingSvc] = useState(true);

  // ── API Keys ──
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);

  // ── Request Log ──
  const [requestLog, setRequestLog] = useState<RequestLogEntry[]>([]);
  const [loadingLog, setLoadingLog] = useState(true);

  // ── Create Modal ──
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // ── Delete confirm ──
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // ── Right-click context menu ──
  const { openMenu } = useContextMenu();
  const m = useMenuActions();

  // ── Data fetching ──

  const fetchSvcConfig = useCallback(async () => {
    try {
      const data = await apiFetch<{ configured: boolean; url: string; key_preview: string | null }>('/integrations/services/rmpgutahps');
      setSvcConfigured(data.configured);
      setSvcUrl(data.url);
      setSvcUrlInput(data.url);
      setSvcKeyPreview(data.key_preview);
    } catch (err) {
      console.error('Failed to fetch rmpgutahps config:', err);
    } finally {
      setLoadingSvc(false);
    }
  }, []);

  const handleSaveSvc = async () => {
    if (!svcApiKey.trim()) return;
    setSavingSvc(true);
    try {
      await apiFetch('/integrations/services/rmpgutahps', {
        method: 'PUT',
        body: JSON.stringify({ api_key: svcApiKey.trim(), url: svcUrlInput.trim() }),
      });
      setSvcApiKey('');
      setShowSvcKey(false);
      await fetchSvcConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save API key');
    } finally {
      setSavingSvc(false);
    }
  };

  const handleClearSvc = async () => {
    try {
      await apiFetch('/integrations/services/rmpgutahps', { method: 'DELETE' });
      await fetchSvcConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear API key');
    }
  };

  const fetchKeys = useCallback(async () => {
    try {
      const data = await apiFetch<ApiKey[]>('/integrations/keys');
      setKeys(asArray<ApiKey>(data));
    } catch (err) {
      console.error('Failed to fetch integration keys:', err);
      setError(err instanceof Error ? err.message : 'Failed to load API keys');
    } finally {
      setLoadingKeys(false);
    }
  }, [setError]);

  const fetchRequestLog = useCallback(async () => {
    try {
      const data = await apiFetch<RequestLogEntry[]>('/integrations/keys/request-log');
      setRequestLog(asArray<RequestLogEntry>(data));
    } catch (err) {
      console.error('Failed to fetch request log:', err);
    } finally {
      setLoadingLog(false);
    }
  }, []);

  useEffect(() => {
    fetchSvcConfig();
    fetchKeys();
    fetchRequestLog();
  }, [fetchSvcConfig, fetchKeys, fetchRequestLog]);

  // ── Actions ──

  const handleCreate = async () => {
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const res = await apiFetch<{ key: string; id: number; name: string; key_prefix: string }>(
        '/integrations/keys',
        { method: 'POST', body: JSON.stringify({ name: newKeyName.trim() }) }
      );
      setCreatedKey(res.key);
      fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create API key');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: number) => {
    try {
      await apiFetch(`/integrations/keys/${id}/revoke`, { method: 'PATCH' });
      fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke key');
    }
  };

  const handleActivate = async (id: number) => {
    try {
      await apiFetch(`/integrations/keys/${id}/activate`, { method: 'PATCH' });
      fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to activate key');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await apiFetch(`/integrations/keys/${id}`, { method: 'DELETE' });
      setDeletingId(null);
      fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete key');
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
    setNewKeyName('');
    setCreatedKey(null);
    setCopied(false);
  };

  // ── Context menus ──
  // Integration API key row: revoke/activate toggle + delete (routes through
  // the existing inline confirm) + copy name / prefix.
  const buildKeyMenu = (k: ApiKey): ContextMenuItem[] => [
    k.status === 'active'
      ? m.action('Revoke key', () => handleRevoke(k.id), { icon: <ShieldOff size={12} /> })
      : m.action('Activate key', () => handleActivate(k.id), { icon: <ShieldCheck size={12} /> }),
    m.separator(),
    m.copy('Copy name', k.name),
    m.copy('Copy key prefix', k.key_prefix),
    m.copyId(k.id),
    m.separator(),
    m.action('Delete key', () => setDeletingId(k.id), { icon: <Trash2 size={12} />, danger: true }),
  ];

  // Request log row: read-only, copy fields only.
  const buildLogMenu = (entry: RequestLogEntry): ContextMenuItem[] => [
    m.copy('Copy details', entry.details),
    ...(entry.ip_address ? [m.copy('Copy IP address', entry.ip_address)] : []),
    ...(entry.entity_id ? [m.copy('Copy Call ID', entry.entity_id, <Hash size={12} />)] : []),
    m.copyId(entry.id),
  ];

  // ── Render ──

  // Set document title
  useEffect(() => { document.title = 'Admin - Integrations — RMPG Flex'; }, []);

  // Keyboard shortcut: Escape to close modals
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowCreateModal(false); setShowCreateModal(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="space-y-6">
      {/* ── Connected Service: rmpgutahps.us ── */}
      <div className="panel-beveled bg-surface-base border border-rmpg-700 rounded-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-700">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-brand-400" />
            <h2 className="text-sm font-semibold text-rmpg-300">rmpgutahps.us — Process Service Portal</h2>
          </div>
          <div className="flex items-center gap-2">
            {svcConfigured ? (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-sm bg-green-900/30 text-green-400 border border-green-700/40">
                <CheckCircle2 className="w-3 h-3" />
                Connected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-sm bg-yellow-900/30 text-yellow-400 border border-yellow-700/40">
                <AlertTriangle className="w-3 h-3" />
                Not Configured
              </span>
            )}
          </div>
        </div>

        {loadingSvc ? (
          <div className="flex justify-center py-8"><LoadingSpinner /></div>
        ) : (
          <div className="p-4 space-y-4">
            {/* URL */}
            <div>
              <label htmlFor="ff-adminintegrationstab-1" className="block text-xs text-rmpg-500 mb-1">Portal URL</label>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 flex-1 px-3 py-2 bg-surface-sunken border border-rmpg-700 rounded-sm">
                  <Link2 className="w-3.5 h-3.5 text-rmpg-500" />
                  <input id="ff-adminintegrationstab-1"
                    type="text"
                    value={svcUrlInput}
                    onChange={(e) => setSvcUrlInput(e.target.value)}
                    placeholder="https://rmpgutahps.us"
                    className="flex-1 bg-transparent text-sm text-rmpg-300 placeholder-rmpg-600 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* API Key */}
            <div>
              <label htmlFor="ff-adminintegrationstab-2" className="block text-xs text-rmpg-500 mb-1">
                API Key {svcConfigured && svcKeyPreview && <span className="text-rmpg-600 ml-1">(current: {svcKeyPreview})</span>}
              </label>
              <div className="flex items-center gap-2">
                <form
                  onSubmit={(e) => { e.preventDefault(); handleSaveSvc(); }}
                  className="flex items-center gap-1.5 flex-1 px-3 py-2 bg-surface-sunken border border-rmpg-700 rounded-sm"
                >
                  <Key className="w-3.5 h-3.5 text-rmpg-500" />
                  <input id="ff-adminintegrationstab-2"
                    type={showSvcKey ? 'text' : 'password'}
                    value={svcApiKey}
                    onChange={(e) => setSvcApiKey(e.target.value)}
                    placeholder={svcConfigured ? 'Enter new key to replace' : 'Paste API key from rmpgutahps.us'}
                    className="flex-1 bg-transparent text-sm text-rmpg-300 placeholder-rmpg-600 focus:outline-none font-mono"
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveSvc()}
                  />
                  <button type="button"
                    onClick={() => setShowSvcKey(!showSvcKey)}
                    className="text-rmpg-500 hover:text-rmpg-300 transition-colors"
                  >
                    {showSvcKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                  <input type="submit" hidden />
                </form>
                <button type="button"
                  onClick={handleSaveSvc}
                  disabled={savingSvc || !svcApiKey.trim()}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-brand-600 hover:bg-brand-500 text-rmpg-100 rounded-sm transition-colors disabled:opacity-50"
                >
                  {savingSvc ? <Loader2 className="w-3.5 h-3.5 animate-spin" role="status" aria-label="Loading" /> : <Save className="w-3.5 h-3.5" />}
                  Save
                </button>
                {svcConfigured && (
                  <button type="button"
                    onClick={handleClearSvc}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs text-red-400 hover:text-red-300 bg-red-900/20 hover:bg-red-900/30 border border-red-700/30 rounded-sm transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Clear
                  </button>
                )}
              </div>
            </div>

            {svcConfigured && (
              <p className="text-xs text-rmpg-600">
                API key is encrypted and stored securely. The portal at {svcUrl} can submit process service requests to this system.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── GPS Background Tracking ── */}
      <ApiKeyPanel title="GPS Background Tracking (OwnTracks / Traccar)" icon={<MapPin className="w-4 h-4 text-emerald-400" />} keys={GPS_WEBHOOK_KEYS} />

      {/* ── Mapbox API (DOMINANT MAP SOURCE) ── */}
      <ApiKeyPanel title="Mapbox API — Primary Map System" icon={<Navigation className="w-4 h-4 text-brand-400" />} keys={MAPBOX_KEYS} />

      {/* ── Law Enforcement / Government APIs ── */}
      <ApiKeyPanel title="Law Enforcement / Government" icon={<Shield className="w-4 h-4 text-red-400" />} keys={LAW_ENFORCEMENT_KEYS} />

      {/* ── Free / Open Source APIs ── */}
      <ApiKeyPanel title="Free / Open Source APIs" icon={<Unlock className="w-4 h-4 text-green-400" />} keys={FREE_OPEN_APIS} />

      {/* ── Notifications ── */}
      <ApiKeyPanel title="Notifications & Messaging" icon={<Bell className="w-4 h-4 text-amber-400" />} keys={NOTIFICATION_KEYS} />

      {/* ── AI / Machine Learning ── */}
      <ApiKeyPanel title="AI / Machine Learning" icon={<Cpu className="w-4 h-4 text-purple-400" />} keys={AI_ML_KEYS} />

      {/* ── Cloud Storage & Infrastructure ── */}
      <ApiKeyPanel title="Cloud Storage & Infrastructure" icon={<Cloud className="w-4 h-4 text-rmpg-400" />} keys={CLOUD_STORAGE_KEYS} />

      {/* ── Data Services ── */}
      <ApiKeyPanel title="Data Services" icon={<Database className="w-4 h-4 text-rmpg-400" />} keys={DATA_SERVICE_KEYS} />

      {/* ── RapidAPI & Third-Party ── */}
      <ApiKeyPanel title="RapidAPI & Third-Party" icon={<Key className="w-4 h-4 text-brand-400" />} keys={THIRD_PARTY_KEYS} />

      {/* ── API Keys Panel ── */}
      <div className="panel-beveled bg-surface-base border border-rmpg-700 rounded-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-700">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-brand-400" />
            <h2 className="text-sm font-semibold text-rmpg-300">Integration API Keys</h2>
          </div>
          <button type="button"
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-brand-600 hover:bg-brand-500 text-rmpg-100 rounded-sm transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Create API Key
          </button>
        </div>

        {loadingKeys ? (
          <div className="flex justify-center py-8">
            <LoadingSpinner />
          </div>
        ) : keys.length === 0 ? (
          <div className="text-center py-8 text-rmpg-500 text-sm">
            No API keys created yet. Create one to enable integrations.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-rmpg-700 text-rmpg-500 text-xs uppercase tracking-wider">
                  <th className="text-left px-4 py-2 font-medium">Name</th>
                  <th className="text-left px-4 py-2 font-medium">Key Prefix</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-left px-4 py-2 font-medium">Last Used</th>
                  <th className="text-right px-4 py-2 font-medium">Requests</th>
                  <th className="text-left px-4 py-2 font-medium">Created</th>
                  <th className="text-right px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k, idx) => (
                  <tr
                    key={k.id}
                    onContextMenu={(e) => openMenu(e, buildKeyMenu(k))}
                    className={`border-b border-rmpg-700/50 hover:bg-surface-raised transition-colors ${
                      idx % 2 === 0 ? 'bg-transparent' : 'bg-surface-sunken/30'
                    }`}
                  >
                    <td className="px-4 py-2.5 text-rmpg-300">{k.name}</td>
                    <td className="px-4 py-2.5">
                      <code className="text-xs font-mono text-rmpg-400 bg-surface-sunken px-1.5 py-0.5 rounded-sm">
                        {k.key_prefix}
                      </code>
                    </td>
                    <td className="px-4 py-2.5">
                      {k.status === 'active' ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-sm bg-green-900/30 text-green-400 border border-green-700/40">
                          <CheckCircle2 className="w-3 h-3" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-sm bg-red-900/30 text-red-400 border border-red-700/40">
                          <XCircle className="w-3 h-3" />
                          Revoked
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-rmpg-500 text-xs">
                      {k.last_used_at ? timeAgo(k.last_used_at) : 'Never'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-rmpg-400 font-mono text-xs">
                      {k.request_count.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-rmpg-500 text-xs">
                      {safeDateStr(k.created_at)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {k.status === 'active' ? (
                          <button type="button"
                            onClick={() => handleRevoke(k.id)}
                            className="flex items-center gap-1 px-2 py-1 text-xs text-yellow-400 hover:text-yellow-300 bg-yellow-900/20 hover:bg-yellow-900/30 border border-yellow-700/30 rounded-sm transition-colors"
                            title="Revoke key"
                          >
                            <ShieldOff className="w-3 h-3" />
                            Revoke
                          </button>
                        ) : (
                          <button type="button"
                            onClick={() => handleActivate(k.id)}
                            className="flex items-center gap-1 px-2 py-1 text-xs text-green-400 hover:text-green-300 bg-green-900/20 hover:bg-green-900/30 border border-green-700/30 rounded-sm transition-colors"
                            title="Re-activate key"
                          >
                            <ShieldCheck className="w-3 h-3" />
                            Activate
                          </button>
                        )}
                        {deletingId === k.id ? (
                          <div className="flex items-center gap-1">
                            <button type="button"
                              onClick={() => handleDelete(k.id)}
                              className="px-2 py-1 text-xs text-red-400 hover:text-red-300 bg-red-900/30 hover:bg-red-900/40 border border-red-700/40 rounded-sm transition-colors"
                            >
                              Confirm
                            </button>
                            <button type="button"
                              onClick={() => setDeletingId(null)}
                              className="px-2 py-1 text-xs text-rmpg-500 hover:text-rmpg-400 bg-surface-raised rounded-sm transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button type="button"
                            onClick={() => setDeletingId(k.id)}
                            className="flex items-center gap-1 px-2 py-1 text-xs text-red-400 hover:text-red-300 bg-red-900/20 hover:bg-red-900/30 border border-red-700/30 rounded-sm transition-colors"
                            title="Delete key"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Request Log Panel ── */}
      <div className="panel-beveled bg-surface-base border border-rmpg-700 rounded-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-700">
          <div className="flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-brand-400" />
            <h2 className="text-sm font-semibold text-rmpg-300">Recent Service Requests</h2>
          </div>
          <button type="button"
            onClick={() => { setLoadingLog(true); fetchRequestLog(); }}
            className="flex items-center gap-1 px-2 py-1 text-xs text-rmpg-400 hover:text-rmpg-300 bg-surface-raised hover:bg-surface-raised/80 rounded-sm transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Refresh
          </button>
        </div>

        {loadingLog ? (
          <div className="flex justify-center py-8">
            <LoadingSpinner />
          </div>
        ) : requestLog.length === 0 ? (
          <div className="text-center py-8 text-rmpg-500 text-sm">
            No requests yet
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-rmpg-700 text-rmpg-500 text-xs uppercase tracking-wider">
                  <th className="text-left px-4 py-2 font-medium">Time</th>
                  <th className="text-left px-4 py-2 font-medium">Details</th>
                  <th className="text-left px-4 py-2 font-medium">IP Address</th>
                  <th className="text-left px-4 py-2 font-medium">Call ID</th>
                </tr>
              </thead>
              <tbody>
                {requestLog.map((entry, idx) => (
                  <tr
                    key={entry.id}
                    onContextMenu={(e) => openMenu(e, buildLogMenu(entry))}
                    className={`border-b border-rmpg-700/50 hover:bg-surface-raised transition-colors ${
                      idx % 2 === 0 ? 'bg-transparent' : 'bg-surface-sunken/30'
                    }`}
                  >
                    <td className="px-4 py-2.5 text-rmpg-500 text-xs whitespace-nowrap">
                      {timeAgo(entry.created_at)}
                    </td>
                    <td className="px-4 py-2.5 text-rmpg-300 text-xs">
                      {entry.details}
                    </td>
                    <td className="px-4 py-2.5 text-rmpg-400 font-mono text-xs">
                      {entry.ip_address || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-rmpg-400 font-mono text-xs">
                      {entry.entity_id || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Create Key Modal ── */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60" role="dialog" aria-modal="true">
          <div className="bg-surface-raised border border-rmpg-700 rounded-sm shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-700">
              <h3 className="text-sm font-semibold text-rmpg-300">Create API Key</h3>
              {createdKey && (
                <button aria-label="Close" type="button"
                  onClick={closeCreateModal}
                  className="text-rmpg-500 hover:text-rmpg-300 transition-colors"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="p-4 space-y-4">
              {!createdKey ? (
                <>
                  <div>
                    <label htmlFor="ff-adminintegrationstab-3" className="block text-xs text-rmpg-500 mb-1">Key Name</label>
                    <input id="ff-adminintegrationstab-3"
                      type="text"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      placeholder="e.g. Process Service API"
                      className="w-full px-3 py-2 text-sm bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-300 placeholder-rmpg-600 focus:outline-none focus:border-brand-500"
                      onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                      autoFocus
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button type="button"
                      onClick={closeCreateModal}
                      className="px-3 py-1.5 text-xs text-rmpg-400 hover:text-rmpg-300 bg-surface-raised rounded-sm transition-colors"
                    >
                      Cancel
                    </button>
                    <button type="button"
                      onClick={handleCreate}
                      disabled={creating || !newKeyName.trim()}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-brand-600 hover:bg-brand-500 text-rmpg-100 rounded-sm transition-colors disabled:opacity-50"
                    >
                      {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" role="status" aria-label="Loading" /> : <Plus className="w-3.5 h-3.5" />}
                      Create
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs text-rmpg-500 mb-1">Your API Key</label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 px-3 py-2.5 text-sm font-mono bg-green-900/20 border border-green-700/40 rounded-sm text-green-300 break-all select-all">
                        {createdKey}
                      </code>
                      <button type="button"
                        onClick={() => handleCopy(createdKey)}
                        className="flex-shrink-0 flex items-center gap-1 px-3 py-2.5 text-xs font-medium bg-brand-600 hover:bg-brand-500 text-rmpg-100 rounded-sm transition-colors"
                        title="Copy to clipboard"
                      >
                        {copied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 p-3 bg-yellow-900/20 border border-yellow-700/30 rounded-sm">
                    <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-yellow-300">
                      Save this API key now — it cannot be retrieved again.
                    </p>
                  </div>
                  <div className="flex justify-end">
                    <button type="button"
                      onClick={closeCreateModal}
                      className="px-3 py-1.5 text-xs font-medium bg-brand-600 hover:bg-brand-500 text-rmpg-100 rounded-sm transition-colors"
                    >
                      Close
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
