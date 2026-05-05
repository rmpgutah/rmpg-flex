import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, Trash2, Copy, CheckCircle2, XCircle, Key, AlertTriangle,
  Loader2, RotateCcw, ShieldCheck, ShieldOff, Globe, Eye, EyeOff, Save, Link2,
  Shield, Database, Bell, Unlock, Cloud, Cpu, MapPin,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { safeDateStr } from '../../utils/dateUtils';
import AdminCustomIntegrationsSection from './AdminCustomIntegrationsSection';

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
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

// ── Reusable API Key Panel ────────────────────────────────────
// Generic panel for managing encrypted API keys via PUT /api/admin/third-party-keys
interface ApiKeyConfig {
  key: string;
  label: string;
  desc: string;
  /** Regex pattern the key must match, or null for no validation */
  pattern?: RegExp;
  /** Human-readable format hint shown below the input */
  formatHint?: string;
  /** When false, render the input as type=text instead of type=password —
   *  for non-secret config like URLs, boolean flags, and intervals.
   *  Defaults to true (treat unknown keys as secrets). */
  secret?: boolean;
}

function validateKey(value: string, config: ApiKeyConfig): string | null {
  if (!value.trim()) return null;
  if (config.pattern && !config.pattern.test(value.trim())) {
    return config.formatHint || 'Invalid key format';
  }
  return null; // valid
}

const GOOGLE_CLOUD_KEYS: ApiKeyConfig[] = [
  { key: 'google_maps_api_key', label: 'Maps JavaScript API', desc: 'Client-side map rendering — used by Map page, dispatch overlays, beat polygons', pattern: /^AIza[A-Za-z0-9_-]{35,}$/, formatHint: 'Must start with AIza (39+ characters)' },
  { key: 'google_maps_server_key', label: 'Geocoding / Directions API', desc: 'Server-side address resolution, route optimization, reverse geocoding', pattern: /^AIza[A-Za-z0-9_-]{35,}$/, formatHint: 'Must start with AIza (39+ characters)' },
  { key: 'google_places_api_key', label: 'Places Autocomplete API', desc: 'Address search autocomplete in New Call, Incident, and Serve Intake forms', pattern: /^AIza[A-Za-z0-9_-]{35,}$/, formatHint: 'Must start with AIza (39+ characters)' },
  { key: 'google_cloud_vision_key', label: 'Cloud Vision API', desc: 'Image analysis — DL photo OCR, evidence photo tagging, document scanning', pattern: /^AIza[A-Za-z0-9_-]{35,}$/, formatHint: 'Must start with AIza (39+ characters)' },
  { key: 'google_cloud_speech_key', label: 'Cloud Speech-to-Text API', desc: 'Voice transcription for radio recordings and body camera audio', pattern: /^AIza[A-Za-z0-9_-]{35,}$/, formatHint: 'Must start with AIza (39+ characters)' },
  { key: 'google_generative_language_key', label: 'Generative Language API (Gemini)', desc: 'AI-powered narrative generation, report summarization, CAD command intelligence', pattern: /^AIza[A-Za-z0-9_-]{35,}$/, formatHint: 'Must start with AIza (39+ characters)' },
];

const AI_ML_KEYS: ApiKeyConfig[] = [
  { key: 'openai_api_key', label: 'OpenAI', desc: 'GPT-4 / GPT-4o — narrative generation, report writing, evidence analysis', pattern: /^sk-[A-Za-z0-9_-]{40,}$/, formatHint: 'Starts with sk-' },
  { key: 'anthropic_api_key', label: 'Anthropic (Claude)', desc: 'Claude — document analysis, legal research, policy compliance checks', pattern: /^sk-ant-[A-Za-z0-9_-]+$/, formatHint: 'Starts with sk-ant-' },
  { key: 'replicate_api_key', label: 'Replicate', desc: 'Free tier — open-source AI models, image generation, facial similarity search' },
  { key: 'huggingface_api_key', label: 'Hugging Face', desc: 'Free tier — NLP models, text classification, entity extraction for reports', pattern: /^hf_[A-Za-z0-9]+$/, formatHint: 'Starts with hf_' },
  { key: 'deepgram_api_key', label: 'Deepgram', desc: 'Free tier: $200 credit — real-time speech-to-text, body camera transcription' },
  { key: 'assemblyai_api_key', label: 'AssemblyAI', desc: 'Free tier: 100hrs — audio transcription, speaker diarization for interviews' },
];

const CLOUD_STORAGE_KEYS: ApiKeyConfig[] = [
  { key: 'aws_access_key_id', label: 'AWS Access Key ID', desc: 'S3 storage — evidence files, body camera video, backup archives', pattern: /^AKIA[A-Z0-9]{16}$/, formatHint: 'Starts with AKIA, 20 characters' },
  { key: 'aws_secret_access_key', label: 'AWS Secret Access Key', desc: 'AWS authentication secret (paired with Access Key ID above)' },
  { key: 'aws_s3_bucket', label: 'AWS S3 Bucket Name', desc: 'Target bucket for evidence uploads and backup storage' },
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
  { key: 'interpol_api_key', label: 'INTERPOL Red Notice', desc: 'Free — international wanted persons, stolen documents, stolen vehicles' },
  { key: 'nsopw_api_key', label: 'NSOPW (Sex Offender)', desc: 'Free — National Sex Offender Public Website search API' },
  { key: 'ofac_api_key', label: 'OFAC / SDN List', desc: 'Free — Treasury sanctions list, specially designated nationals for financial investigations' },
];

const GPS_WEBHOOK_KEYS: ApiKeyConfig[] = [
  { key: 'traccar_webhook_token', label: 'Traccar Webhook Token', desc: 'PRIMARY GPS source (replaced OwnTracks 2026-04-29). Bearer token for Traccar Client app + Traccar Server forward-webhook. Endpoint: POST /api/traccar?token=<TOKEN>. OwnTracks endpoints now return HTTP 410 Gone — devices must reconfigure.', secret: true },
  { key: 'traccar_url', label: 'Traccar Server URL (optional pull)', desc: 'If you run a self-hosted Traccar Server, set its base URL (e.g. https://traccar.example.com). RMPG Flex polls /api/positions on the configured interval using the credentials below. Leave blank to use webhook-only.', secret: false },
  { key: 'traccar_email', label: 'Traccar Server email', desc: 'Login email for the Traccar Server REST API session. AES-encrypted at rest.', secret: false },
  { key: 'traccar_password', label: 'Traccar Server password', desc: 'Password for the Traccar Server REST API session. AES-encrypted at rest.', secret: true },
  { key: 'traccar_enabled', label: 'Traccar pull enabled', desc: 'Set to "true" to activate the REST poller, "false" to use webhook-only (default true when URL+email+password are set).', secret: false },
  { key: 'traccar_poll_interval', label: 'Traccar poll interval (sec)', desc: 'Seconds between /api/positions polls. Range 5-300. Default 15.', secret: false },
];

const FREE_OPEN_APIS: ApiKeyConfig[] = [
  { key: 'openweathermap_api_key', label: 'OpenWeatherMap', desc: 'Free tier: 1000 calls/day — current weather, forecasts, alerts for dispatch scene conditions', formatHint: '32-character hex key from openweathermap.org' },
  { key: 'mapbox_api_key', label: 'Mapbox', desc: 'Free tier: 50k loads/month — satellite imagery, routing, isochrones, offline maps', pattern: /^pk\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, formatHint: 'Starts with pk. — from account.mapbox.com' },
  { key: 'nominatim_api_key', label: 'OpenStreetMap Nominatim', desc: 'Free geocoding — address-to-coordinates fallback when Google quota exceeded (email as key)' },
  { key: 'opencage_api_key', label: 'OpenCage Geocoder', desc: 'Free tier: 2500 calls/day — reverse geocoding, address parsing, timezone lookup' },
  { key: 'ipinfo_api_key', label: 'IPinfo', desc: 'Free tier: 50k/month — IP geolocation for login audit, session tracking, threat intel' },
  { key: 'virustotal_api_key', label: 'VirusTotal', desc: 'Free tier: 4 lookups/min — file hash checks, URL scanning for evidence/forensics' },
  { key: 'abuseipdb_api_key', label: 'AbuseIPDB', desc: 'Free tier: 1000/day — check IP addresses against abuse database for security monitoring' },
  { key: 'shodan_api_key', label: 'Shodan', desc: 'Free tier: limited — internet-connected device search for OSINT/investigations' },
  { key: 'have_i_been_pwned_key', label: 'Have I Been Pwned', desc: 'Free tier: breach lookups — check if officer/suspect emails appear in data breaches' },
  { key: 'censys_api_key', label: 'Censys', desc: 'Free tier: 250/month — internet host/certificate search for OSINT, infrastructure recon' },
  { key: 'hunter_io_api_key', label: 'Hunter.io', desc: 'Free tier: 25/month — email finder, domain search for skip tracing and investigations' },
  { key: 'numverify_api_key', label: 'NumVerify', desc: 'Free tier: 100/month — phone number validation, carrier lookup, line type detection' },
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

function ApiKeyPanel({ title, icon, keys: keyConfigs }: { title: string; icon: React.ReactNode; keys: ApiKeyConfig[] }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [configured, setConfigured] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  useEffect(() => {
    // Check which keys are configured
    (async () => {
      try {
        const data = await apiFetch<Array<{ config_key: string; has_value: boolean }>>('/admin/third-party-keys');
        const map: Record<string, boolean> = {};
        for (const item of data) map[item.config_key] = item.has_value;
        setConfigured(map);
      } catch {
        // Endpoint may not exist yet — check individually
        for (const { key } of keyConfigs) {
          try {
            const resp = await apiFetch<{ configured: boolean }>(`/admin/third-party-keys/${key}`);
            setConfigured(prev => ({ ...prev, [key]: resp.configured }));
          } catch { /* silent */ }
        }
      }
    })();
  }, []);

  const handleSave = async (configKey: string) => {
    const value = values[configKey]?.trim();
    if (!value) return;
    const cfg = keyConfigs.find(k => k.key === configKey);
    if (cfg) {
      const err = validateKey(value, cfg);
      if (err) { setErrors(prev => ({ ...prev, [configKey]: err })); return; }
    }
    setErrors(prev => ({ ...prev, [configKey]: null }));
    setSaving(configKey);
    try {
      await apiFetch('/admin/third-party-keys', {
        method: 'PUT',
        body: JSON.stringify({ key: configKey, value }),
      });
      setConfigured(prev => ({ ...prev, [configKey]: true }));
      setValues(prev => ({ ...prev, [configKey]: '' }));
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
    } catch { /* silent */ }
    setSaving(null);
  };

  return (
    <div className="panel-beveled bg-surface-base border border-[#2b2b2b] rounded-sm">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[#2b2b2b]">
        {icon}
        <h2 className="text-sm font-semibold text-rmpg-300">{title}</h2>
      </div>
      <div className="p-4 space-y-4">
        {keyConfigs.map(({ key, label, desc, formatHint, secret }) => {
          // Default to secret=true for back-compat — every legacy key was
          // a credential. Only the explicit `secret: false` rows render as
          // plain text (URLs, boolean flags, numeric intervals).
          const isSecret = secret !== false;
          return (
          <div key={key} className="flex flex-col gap-2 p-3 bg-[#0c0c0c] border border-[#2b2b2b] rounded-sm">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-rmpg-300">{label}</div>
                <div className="text-[10px] text-rmpg-600">{desc}</div>
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
              <div className="relative flex-1">
                <input
                  type={!isSecret || showKey[key] ? 'text' : 'password'}
                  value={values[key] || ''}
                  onChange={e => setValues(prev => ({ ...prev, [key]: e.target.value }))}
                  placeholder={configured[key]
                    ? (isSecret ? '••••••••••••••••••••' : '(saved — type to overwrite)')
                    : (isSecret ? 'Paste API key here...' : 'Type or paste value...')}
                  autoComplete={isSecret ? 'off' : 'on'}
                  spellCheck={false}
                  className="w-full px-3 py-2 pr-8 bg-[#141414] border border-[#2b2b2b] rounded-sm text-xs text-white font-mono placeholder-[#525252] focus:outline-none focus:border-brand-500"
                />
                {isSecret && (
                  <button type="button" onClick={() => setShowKey(prev => ({ ...prev, [key]: !prev[key] }))} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-600 hover:text-rmpg-400" aria-label={showKey[key] ? 'Hide value' : 'Show value'}>
                    {showKey[key] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleSave(key)}
                disabled={!values[key]?.trim() || saving === key}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white rounded-sm transition-colors"
              >
                {saving === key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save
              </button>
              {configured[key] && (
                <button
                  type="button"
                  onClick={() => handleClear(key)}
                  disabled={saving === key}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs text-red-400 hover:text-red-300 bg-red-900/20 hover:bg-red-900/30 border border-red-700/30 rounded-sm transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {errors[key] && <div className="text-[10px] text-red-400 font-medium">⚠ {errors[key]}</div>}
            {formatHint && !errors[key] && <div className="text-[9px] text-rmpg-600 italic">{formatHint}</div>}
            <div className="text-[9px] text-rmpg-700 font-mono">config_key: {key}</div>
          </div>
          );
        })}
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
      setKeys(data);
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
      setRequestLog(data);
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

  // ── Render ──

  // Set document title
  useEffect(() => { document.title = 'Admin - Integrations \u2014 RMPG Flex'; }, []);

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
      <div className="panel-beveled bg-surface-base border border-[#2b2b2b] rounded-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2b2b2b]">
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
              <label className="block text-xs text-rmpg-500 mb-1">Portal URL</label>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 flex-1 px-3 py-2 bg-[#0c0c0c] border border-[#2b2b2b] rounded-sm">
                  <Link2 className="w-3.5 h-3.5 text-rmpg-500" />
                  <input
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
              <label className="block text-xs text-rmpg-500 mb-1">
                API Key {svcConfigured && svcKeyPreview && <span className="text-rmpg-600 ml-1">(current: {svcKeyPreview})</span>}
              </label>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 flex-1 px-3 py-2 bg-[#0c0c0c] border border-[#2b2b2b] rounded-sm">
                  <Key className="w-3.5 h-3.5 text-rmpg-500" />
                  <input
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
                </div>
                <button type="button"
                  onClick={handleSaveSvc}
                  disabled={savingSvc || !svcApiKey.trim()}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-brand-600 hover:bg-brand-500 text-white rounded-sm transition-colors disabled:opacity-50"
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
      <ApiKeyPanel title="GPS Background Tracking — Traccar (PRIMARY)" icon={<MapPin className="w-4 h-4 text-emerald-400" />} keys={GPS_WEBHOOK_KEYS} />
      <TraccarPullStatusCard />

      {/* ── Google Cloud Console Keys ── */}
      <ApiKeyPanel title="Google Cloud Console" icon={<Globe className="w-4 h-4 text-gray-400" />} keys={GOOGLE_CLOUD_KEYS} />

      {/* ── Law Enforcement / Government APIs ── */}
      <ApiKeyPanel title="Law Enforcement / Government" icon={<Shield className="w-4 h-4 text-red-400" />} keys={LAW_ENFORCEMENT_KEYS} />

      {/* ── Free / Open Source APIs ── */}
      <ApiKeyPanel title="Free / Open Source APIs" icon={<Unlock className="w-4 h-4 text-green-400" />} keys={FREE_OPEN_APIS} />

      {/* ── Notifications ── */}
      <ApiKeyPanel title="Notifications & Messaging" icon={<Bell className="w-4 h-4 text-amber-400" />} keys={NOTIFICATION_KEYS} />

      {/* ── AI / Machine Learning ── */}
      <ApiKeyPanel title="AI / Machine Learning" icon={<Cpu className="w-4 h-4 text-purple-400" />} keys={AI_ML_KEYS} />

      {/* ── Cloud Storage & Infrastructure ── */}
      <ApiKeyPanel title="Cloud Storage & Infrastructure" icon={<Cloud className="w-4 h-4 text-gray-400" />} keys={CLOUD_STORAGE_KEYS} />

      {/* ── Data Services ── */}
      <ApiKeyPanel title="Data Services" icon={<Database className="w-4 h-4 text-gray-400" />} keys={DATA_SERVICE_KEYS} />

      {/* ── RapidAPI & Third-Party ── */}
      <ApiKeyPanel title="RapidAPI & Third-Party" icon={<Key className="w-4 h-4 text-brand-400" />} keys={THIRD_PARTY_KEYS} />

      {/* ── API Keys Panel ── */}
      <div className="panel-beveled bg-surface-base border border-[#2b2b2b] rounded-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2b2b2b]">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-brand-400" />
            <h2 className="text-sm font-semibold text-rmpg-300">Integration API Keys</h2>
          </div>
          <button type="button"
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-brand-600 hover:bg-brand-500 text-white rounded-sm transition-colors"
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
                <tr className="border-b border-[#2b2b2b] text-rmpg-500 text-xs uppercase tracking-wider">
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
                    className={`border-b border-[#2b2b2b]/50 hover:bg-[#181818] transition-colors ${
                      idx % 2 === 0 ? 'bg-transparent' : 'bg-[#0c0c0c]/30'
                    }`}
                  >
                    <td className="px-4 py-2.5 text-rmpg-300">{k.name}</td>
                    <td className="px-4 py-2.5">
                      <code className="text-xs font-mono text-rmpg-400 bg-[#0c0c0c] px-1.5 py-0.5 rounded-sm">
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
                              className="px-2 py-1 text-xs text-rmpg-500 hover:text-rmpg-400 bg-[#181818] rounded-sm transition-colors"
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
      <div className="panel-beveled bg-surface-base border border-[#2b2b2b] rounded-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2b2b2b]">
          <div className="flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-brand-400" />
            <h2 className="text-sm font-semibold text-rmpg-300">Recent Service Requests</h2>
          </div>
          <button type="button"
            onClick={() => { setLoadingLog(true); fetchRequestLog(); }}
            className="flex items-center gap-1 px-2 py-1 text-xs text-rmpg-400 hover:text-rmpg-300 bg-[#181818] hover:bg-[#181818]/80 rounded-sm transition-colors"
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
                <tr className="border-b border-[#2b2b2b] text-rmpg-500 text-xs uppercase tracking-wider">
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
                    className={`border-b border-[#2b2b2b]/50 hover:bg-[#181818] transition-colors ${
                      idx % 2 === 0 ? 'bg-transparent' : 'bg-[#0c0c0c]/30'
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

      {/* ── Custom External Integrations ── */}
      {/* Outbound HTTP credentials for calling other software FROM Flex.
          Distinct from the inbound API keys above. Added 2026-05-05. */}
      <AdminCustomIntegrationsSection />

      {/* ── Create Key Modal ── */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60" role="dialog" aria-modal="true">
          <div className="bg-surface-raised border border-[#2b2b2b] rounded-sm shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#2b2b2b]">
              <h3 className="text-sm font-semibold text-rmpg-300">Create API Key</h3>
              {createdKey && (
                <button type="button"
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
                    <label className="block text-xs text-rmpg-500 mb-1">Key Name</label>
                    <input
                      type="text"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      placeholder="e.g. Process Service API"
                      className="w-full px-3 py-2 text-sm bg-[#0c0c0c] border border-[#2b2b2b] rounded-sm text-rmpg-300 placeholder-rmpg-600 focus:outline-none focus:border-brand-500"
                      onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                      autoFocus
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button type="button"
                      onClick={closeCreateModal}
                      className="px-3 py-1.5 text-xs text-rmpg-400 hover:text-rmpg-300 bg-[#181818] rounded-sm transition-colors"
                    >
                      Cancel
                    </button>
                    <button type="button"
                      onClick={handleCreate}
                      disabled={creating || !newKeyName.trim()}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-brand-600 hover:bg-brand-500 text-white rounded-sm transition-colors disabled:opacity-50"
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
                        className="flex-shrink-0 flex items-center gap-1 px-3 py-2.5 text-xs font-medium bg-brand-600 hover:bg-brand-500 text-white rounded-sm transition-colors"
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
                      className="px-3 py-1.5 text-xs font-medium bg-brand-600 hover:bg-brand-500 text-white rounded-sm transition-colors"
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

// ─── Traccar Pull-Mode Status Card ──────────────────────────────────
// Polls /api/admin/traccar-pull-status every 5s. Renders a coloured
// status pill so the operator can see at a glance whether the REST
// poller is logging in successfully.

function TraccarPullStatusCard() {
  const [status, setStatus] = useState<{ status: string; kind: 'ok' | 'error' | 'disabled' | 'unknown'; serverUrl: string | null } | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await apiFetch<{ status: string; kind: 'ok' | 'error' | 'disabled' | 'unknown'; serverUrl: string | null }>('/api/admin/traccar-pull-status');
      setStatus(r);
    } catch {
      setStatus({ status: '(could not load)', kind: 'unknown', serverUrl: null });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const pill = (kind: typeof status extends null ? never : NonNullable<typeof status>['kind']) => {
    if (kind === 'ok') return 'bg-emerald-900/40 text-emerald-300 border-emerald-700/40';
    if (kind === 'error') return 'bg-red-900/40 text-red-300 border-red-700/40';
    if (kind === 'disabled') return 'bg-amber-900/40 text-amber-300 border-amber-700/40';
    return 'bg-rmpg-800/40 text-rmpg-400 border-rmpg-700/40';
  };

  return (
    <div className="panel-beveled bg-surface-base p-3 mt-2">
      <div className="flex items-center gap-2 mb-2">
        <MapPin className="w-3.5 h-3.5 text-emerald-400" />
        <h3 className="text-[11px] font-bold text-white uppercase tracking-wider">Traccar Server Pull Status</h3>
        <button type="button" onClick={refresh}
          className="ml-auto text-[10px] text-rmpg-400 hover:text-white border border-rmpg-700 px-1.5 py-0.5">
          Refresh
        </button>
      </div>
      {loading && !status ? (
        <div className="text-[11px] text-rmpg-400">Loading…</div>
      ) : status ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 border ${pill(status.kind)}`}>
              {status.kind === 'ok' ? 'OK' : status.kind === 'error' ? 'ERROR' : status.kind === 'disabled' ? 'DISABLED' : 'UNKNOWN'}
            </span>
            {status.serverUrl && <span className="text-[10px] text-rmpg-500 font-mono truncate">{status.serverUrl}</span>}
          </div>
          <div className="text-[11px] text-rmpg-300 font-mono break-all">{status.status || '(no heartbeat yet — waiting for first poll)'}</div>
          {status.kind === 'error' && status.status.includes('401') && (
            <div className="text-[10px] text-amber-300 mt-1">
              The Traccar Server rejected the login. Check the email + password fields above; password is AES-encrypted at rest, so re-enter it after any rotation.
            </div>
          )}
          <div className="text-[9px] text-rmpg-500">Refreshes every 5 seconds. Poller runs at the configured interval (default 15 s) regardless of this UI.</div>
        </div>
      ) : null}
    </div>
  );
}
