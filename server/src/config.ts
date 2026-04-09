import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

function envBool(key: string, defaultVal: boolean): boolean {
  const val = process.env[key];
  if (val === undefined) return defaultVal;
  return val === 'true' || val === '1';
}

function envInt(key: string, defaultVal: number): number {
  const val = process.env[key];
  if (val === undefined) return defaultVal;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? defaultVal : parsed;
}

function envTrustProxy(defaultVal: boolean | number | string): boolean | number | string {
  const val = process.env.TRUST_PROXY;
  if (val === undefined) return defaultVal;
  if (val === 'true' || val === '1') return true;
  if (val === 'false' || val === '0') return false;
  const parsed = parseInt(val, 10);
  return Number.isNaN(parsed) ? val : parsed;
}

// ─── JWT Secret Handling ───────────────────────────────
const isProduction = process.env.NODE_ENV === 'production';
const defaultSecret = 'rmpg-flex-secret-change-me-in-production-2024';
const envSecret = process.env.JWT_SECRET;

let jwtSecret: string;

if (!envSecret || envSecret === defaultSecret) {
  if (isProduction) {
    console.error('');
    console.error('╔═══════════════════════════════════════════════════════════╗');
    console.error('║  CRITICAL SECURITY WARNING                               ║');
    console.error('║  JWT_SECRET is not set or using default value!            ║');
    console.error('║  Generate a strong secret: openssl rand -hex 64           ║');
    console.error('║  Set it in .env: JWT_SECRET=<your-secret>                 ║');
    console.error('╚═══════════════════════════════════════════════════════════╝');
    console.error('');
    // In production, generate a random secret so the server still runs
    // but tokens will invalidate on restart
    jwtSecret = crypto.randomBytes(64).toString('hex');
  } else {
    // Development: use the default but warn
    jwtSecret = envSecret || crypto.randomBytes(64).toString('hex');
    if (!envSecret) {
      console.warn('⚠  WARNING: JWT_SECRET not set in .env — using random secret (tokens will invalidate on restart)');
    }
  }
} else {
  jwtSecret = envSecret;
}

// ─── SSL/TLS Certificate Detection ────────────────────
const sslCertPath = process.env.SSL_CERT_PATH || path.resolve(__dirname, '../certs/fullchain.pem');
const sslKeyPath = process.env.SSL_KEY_PATH || path.resolve(__dirname, '../certs/privkey.pem');

let sslEnabled = false;
let sslCert: string | undefined;
let sslKey: string | undefined;

try {
  if (fs.existsSync(sslCertPath) && fs.existsSync(sslKeyPath)) {
    sslCert = fs.readFileSync(sslCertPath, 'utf-8');
    sslKey = fs.readFileSync(sslKeyPath, 'utf-8');
    sslEnabled = true;
  }
} catch (err) {
  console.warn('⚠  SSL certificate files found but could not be read:', (err as Error).message);
}

export const config = {
  // Server
  port: envInt('PORT', 3001),
  httpsPort: envInt('HTTPS_PORT', 443),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction,
  trustProxy: envTrustProxy(isProduction ? 1 : false),

  // SSL/TLS
  ssl: {
    enabled: sslEnabled,
    cert: sslCert,
    key: sslKey,
    certPath: sslCertPath,
    keyPath: sslKeyPath,
    // Auto-redirect HTTP to HTTPS in production
    httpRedirect: envBool('SSL_HTTP_REDIRECT', true),
    httpRedirectPort: envInt('SSL_HTTP_REDIRECT_PORT', 80),
  },

  // JWT
  jwt: {
    secret: jwtSecret,
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
  },

  // Security
  security: {
    maxLoginAttempts: envInt('MAX_LOGIN_ATTEMPTS', 5),
    lockoutDurationMinutes: envInt('LOCKOUT_DURATION_MINUTES', 15),
    rateLimitWindowMs: envInt('RATE_LIMIT_WINDOW_MS', 1 * 60 * 1000),
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
    encryptionKey: process.env.TOTP_ENCRYPTION_KEY || jwtSecret,
    issuer: process.env.TOTP_ISSUER || 'RMPG Flex',
    requiredRoles: (process.env.TOTP_REQUIRED_ROLES || 'admin,manager,supervisor,officer,dispatcher,contract_manager').split(',').map(s => s.trim()).filter(Boolean),
    backupCodeCount: envInt('TOTP_BACKUP_CODE_COUNT', 10),
  },

  // Session
  session: {
    maxPerUser: envInt('SESSION_MAX_PER_USER', 5),
    enforceIpBinding: envBool('SESSION_ENFORCE_IP_BINDING', true),
    ipChangeAction: (process.env.SESSION_IP_CHANGE_ACTION || 'warn') as 'invalidate' | 'reauth' | 'warn',
  },

  // CORS
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000,http://localhost:4173,https://rmpgutah.us,http://rmpgutah.us,https://www.rmpgutah.us')
    .split(',')
    .map(s => s.trim()),

  // Domain — primary domain for canonical redirects (www → apex)
  primaryDomain: process.env.PRIMARY_DOMAIN || 'rmpgutah.us',

  // Auto-Update Server URL (where desktop apps check for updates)
  updateServerUrl: process.env.UPDATE_SERVER_URL || 'https://rmpgutah.us',

  // Two-Factor Authentication (general 2FA settings)
  twoFactor: {
    trustedDeviceDays: envInt('TWO_FACTOR_TRUSTED_DEVICE_DAYS', 30),
  },

  // WebAuthn / FIDO2
  webauthn: {
    rpName: process.env.WEBAUTHN_RP_NAME || 'RMPG Flex',
    rpID: process.env.WEBAUTHN_RP_ID || 'rmpgutah.us',
    origin: process.env.WEBAUTHN_ORIGIN || (isProduction ? 'https://rmpgutah.us' : 'http://localhost:5173'),
  },

  // Integrations
  serveManagerApiKey: process.env.SERVEMANAGER_API_KEY || '',

  // Email (Microsoft Graph)
  email: {
    clientId: process.env.AZURE_CLIENT_ID || '',
    clientSecret: process.env.AZURE_CLIENT_SECRET || '',
    tenantId: process.env.AZURE_TENANT_ID || '',
  },
} as const;

// ─── Environment Variable Validation ──────────────────
// Warn about missing critical env vars at startup
const requiredInProduction: Array<{ key: string; label: string }> = [
  { key: 'JWT_SECRET', label: 'JWT signing secret' },
];

const recommendedInProduction: Array<{ key: string; label: string }> = [
  { key: 'CORS_ORIGINS', label: 'Allowed CORS origins' },
  { key: 'PRIMARY_DOMAIN', label: 'Primary domain for redirects' },
  { key: 'WEBAUTHN_RP_ID', label: 'WebAuthn relying party ID' },
];

if (isProduction) {
  const missing = requiredInProduction.filter(({ key }) => !process.env[key] || process.env[key] === defaultSecret);
  if (missing.length > 0) {
    console.warn(`\n[Config] Missing required environment variables in production:`);
    missing.forEach(({ key, label }) => console.warn(`  - ${key}: ${label}`));
    console.warn('');
  }
  const unset = recommendedInProduction.filter(({ key }) => !process.env[key]);
  if (unset.length > 0) {
    console.warn(`[Config] Recommended environment variables not set:`);
    unset.forEach(({ key, label }) => console.warn(`  - ${key}: ${label}`));
    console.warn('');
  }
}

export default config;
