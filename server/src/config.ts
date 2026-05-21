// ============================================================
// RMPG Flex — Configuration
// ============================================================
// Supports both Node.js (development) and Cloudflare Workers (production).
// In Workers, environment variables come from wrangler.toml [vars] and secrets.
// ============================================================

import crypto from 'crypto';

// ─── Environment Variable Helpers ────────────────────────
function envBool(key: string, defaultVal: boolean): boolean {
  const val = typeof process !== 'undefined' ? process.env?.[key] : undefined;
  if (val === undefined) return defaultVal;
  return val === 'true' || val === '1';
}

function envStr(key: string, defaultVal: string): string {
  const val = typeof process !== 'undefined' ? process.env?.[key] : undefined;
  return val !== undefined ? val : defaultVal;
}

function envInt(key: string, defaultVal: number): number {
  const val = typeof process !== 'undefined' ? process.env?.[key] : undefined;
  if (val === undefined) return defaultVal;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? defaultVal : parsed;
}

// ─── JWT Secret Handling ───────────────────────────────
const isProduction = envStr('NODE_ENV', 'development') === 'production';
const defaultSecret = 'rmpg-flex-secret-change-me-in-production-2024';
const envSecret = typeof process !== 'undefined' ? process.env?.JWT_SECRET : undefined;

let jwtSecret: string;

if (!envSecret || envSecret === defaultSecret) {
  if (isProduction) {
    // In production (Workers), JWT_SECRET should be set as a secret
    // If not, generate a random one (tokens will invalidate on redeploy)
    jwtSecret = crypto.randomBytes(64).toString('hex');
    console.warn('[Config] JWT_SECRET not set — using random secret (tokens will invalidate on redeploy)');
  } else {
    jwtSecret = envSecret || crypto.randomBytes(64).toString('hex');
    if (!envSecret) {
      console.warn('⚠  WARNING: JWT_SECRET not set — using random secret (tokens will invalidate on restart)');
    }
  }
} else {
  jwtSecret = envSecret;
}

// ─── Configuration ──────────────────────────────────────
export const config = {
  // Server
  port: envInt('PORT', 3001),
  httpsPort: envInt('HTTPS_PORT', 3443),
  nodeEnv: envStr('NODE_ENV', 'development'),
  isProduction,
  trustProxy: true, // Always behind Cloudflare proxy
  ssl: {
    enabled: envBool('SSL_ENABLED', false),
    cert: envStr('SSL_CERT', ''),
    key: envStr('SSL_KEY', ''),
    certPath: envStr('SSL_CERT_PATH', ''),
    keyPath: envStr('SSL_KEY_PATH', ''),
    httpRedirect: envBool('SSL_HTTP_REDIRECT', true),
    httpRedirectPort: envInt('SSL_HTTP_REDIRECT_PORT', 80),
  },

  // JWT
  jwt: {
    secret: jwtSecret,
    accessExpiry: envStr('JWT_ACCESS_EXPIRY', '15m'),
    refreshExpiry: envStr('JWT_REFRESH_EXPIRY', '7d'),
  },

  // Security
  security: {
    maxLoginAttempts: envInt('MAX_LOGIN_ATTEMPTS', 5),
    lockoutDurationMinutes: envInt('LOCKOUT_DURATION_MINUTES', 15),
    rateLimitWindowMs: envInt('RATE_LIMIT_WINDOW_MS', 60000),
    rateLimitMaxRequests: envInt('RATE_LIMIT_MAX_REQUESTS', 1000),
  },

  // Password Policy
  password: {
    minLength: envInt('PASSWORD_MIN_LENGTH', 12),
    requireUppercase: envBool('PASSWORD_REQUIRE_UPPERCASE', true),
    requireLowercase: envBool('PASSWORD_REQUIRE_LOWERCASE', true),
    requireNumber: envBool('PASSWORD_REQUIRE_NUMBER', true),
    requireSpecial: envBool('PASSWORD_REQUIRE_SPECIAL', true),
    historyCount: envInt('PASSWORD_HISTORY_COUNT', 5),
    expiryDays: envInt('PASSWORD_EXPIRY_DAYS', 90),
    expiryWarningDays: envInt('PASSWORD_EXPIRY_WARNING_DAYS', 14),
  },

  // Two-Factor Authentication (TOTP)
  totp: {
    encryptionKey: envStr('TOTP_ENCRYPTION_KEY', jwtSecret),
    issuer: envStr('TOTP_ISSUER', 'RMPG Flex'),
    requiredRoles: (envStr('TOTP_REQUIRED_ROLES', 'admin,manager,supervisor,officer,dispatcher,contract_manager'))
      .split(',').map(s => s.trim()).filter(Boolean),
    backupCodeCount: envInt('TOTP_BACKUP_CODE_COUNT', 10),
  },

  // Session
  session: {
    maxPerUser: envInt('SESSION_MAX_PER_USER', 5),
    enforceIpBinding: envBool('SESSION_ENFORCE_IP_BINDING', true),
    ipChangeAction: (envStr('SESSION_IP_CHANGE_ACTION', 'warn')) as 'invalidate' | 'reauth' | 'warn',
  },

  // CORS
  corsOrigins: (envStr('CORS_ORIGINS', 'http://localhost:5173,http://localhost:3000,http://localhost:4173,https://rmpgutah.us,http://rmpgutah.us,https://www.rmpgutah.us'))
    .split(',')
    .map(s => s.trim()),

  // Domain — primary domain for canonical redirects (www → apex)
  primaryDomain: envStr('PRIMARY_DOMAIN', 'rmpgutah.us'),

  // Auto-Update Server URL (where desktop apps check for updates)
  updateServerUrl: envStr('UPDATE_SERVER_URL', 'https://rmpgutah.us'),

  // Two-Factor Authentication (general 2FA settings)
  twoFactor: {
    trustedDeviceDays: envInt('TWO_FACTOR_TRUSTED_DEVICE_DAYS', 30),
  },

  // WebAuthn / FIDO2
  webauthn: {
    rpName: envStr('WEBAUTHN_RP_NAME', 'RMPG Flex'),
    rpID: envStr('WEBAUTHN_RP_ID', 'rmpgutah.us'),
    origin: isProduction ? 'https://rmpgutah.us' : 'http://localhost:5173',
  },

  // Integrations
  serveManagerApiKey: envStr('SERVEMANAGER_API_KEY', ''),

  // Email (Microsoft Graph)
  email: {
    clientId: envStr('AZURE_CLIENT_ID', ''),
    clientSecret: envStr('AZURE_CLIENT_SECRET', ''),
    tenantId: envStr('AZURE_TENANT_ID', ''),
  },
} as const;

// ─── Environment Variable Validation ──────────────────
const requiredInProduction = [
  { key: 'JWT_SECRET', label: 'JWT signing secret' },
];

const recommendedInProduction = [
  { key: 'CORS_ORIGINS', label: 'Allowed CORS origins' },
  { key: 'PRIMARY_DOMAIN', label: 'Primary domain for redirects' },
  { key: 'WEBAUTHN_RP_ID', label: 'WebAuthn relying party ID' },
];

if (isProduction && typeof process !== 'undefined' && process.env) {
  const missing = requiredInProduction.filter(({ key }) => !process.env![key] || process.env![key] === defaultSecret);
  if (missing.length > 0) {
    console.warn(`\n[Config] Missing required environment variables in production:`);
    missing.forEach(({ key, label }) => console.warn(`  - ${key}: ${label}`));
    console.warn('');
  }
  const unset = recommendedInProduction.filter(({ key }) => !process.env![key]);
  if (unset.length > 0) {
    console.warn(`[Config] Recommended environment variables not set:`);
    unset.forEach(({ key, label }) => console.warn(`  - ${key}: ${label}`));
    console.warn('');
  }
}

export default config;
