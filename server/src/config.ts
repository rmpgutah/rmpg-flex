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
// When running behind a reverse proxy (nginx), set DISABLE_SSL=true in .env
// so the server only listens on PORT (default 3001) as plain HTTP.
const disableSsl = envBool('DISABLE_SSL', false);
const sslCertPath = process.env.SSL_CERT_PATH || path.resolve(__dirname, '../certs/fullchain.pem');
const sslKeyPath = process.env.SSL_KEY_PATH || path.resolve(__dirname, '../certs/privkey.pem');

let sslEnabled = false;
let sslCert: string | undefined;
let sslKey: string | undefined;

if (disableSsl) {
  console.log('ℹ  SSL disabled via DISABLE_SSL=true — running HTTP-only behind reverse proxy');
} else {
  try {
    if (fs.existsSync(sslCertPath) && fs.existsSync(sslKeyPath)) {
      sslCert = fs.readFileSync(sslCertPath, 'utf-8');
      sslKey = fs.readFileSync(sslKeyPath, 'utf-8');
      sslEnabled = true;
    }
  } catch (err) {
    console.warn('⚠  SSL certificate files found but could not be read:', (err as Error).message);
  }
}

// Warn in production if TOTP_ENCRYPTION_KEY is not explicitly set
if (isProduction && !process.env.TOTP_ENCRYPTION_KEY) {
  console.error('');
  console.error('╔═══════════════════════════════════════════════════════════╗');
  console.error('║  WARNING: TOTP_ENCRYPTION_KEY is not set!                ║');
  console.error('║  Falling back to JWT_SECRET for TOTP encryption.         ║');
  console.error('║  Generate one: openssl rand -hex 32                       ║');
  console.error('║  Set it in .env: TOTP_ENCRYPTION_KEY=<your-key>           ║');
  console.error('╚═══════════════════════════════════════════════════════════╝');
  console.error('');
}

export const config = {
  // Server
  port: envInt('PORT', 3001),
  httpsPort: envInt('HTTPS_PORT', 443),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction,

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
    expiryWarningDays: envInt('PASSWORD_EXPIRY_WARNING_DAYS', 7),
    historyCount: envInt('PASSWORD_HISTORY_COUNT', 5),
  },

  // Two-Factor Authentication (TOTP)
  totp: {
    encryptionKey: process.env.TOTP_ENCRYPTION_KEY || jwtSecret,
    issuer: process.env.TOTP_ISSUER || 'RMPG Flex',
    requiredRoles: (process.env.TOTP_REQUIRED_ROLES || 'admin,manager,supervisor,officer,dispatcher,contract_manager').split(',').map(s => s.trim()).filter(Boolean),
    backupCodeCount: envInt('TOTP_BACKUP_CODE_COUNT', 10),
    tempTokenExpiry: process.env.TOTP_TEMP_TOKEN_EXPIRY || '3m',
    trustedDeviceDays: envInt('TRUSTED_DEVICE_DAYS', 30),
  },

  // WebAuthn / Security Key (YubiKey, Touch ID, Windows Hello)
  webauthn: {
    rpName: process.env.WEBAUTHN_RP_NAME || 'RMPG Flex',
    rpID: process.env.WEBAUTHN_RP_ID || 'rmpgutah.us',
    origin: (process.env.WEBAUTHN_ORIGIN || 'https://rmpgutah.us,http://localhost:5173,http://localhost:3001').split(',').map(s => s.trim()),
  },

  // Alias for utilities that reference config.twoFactor
  twoFactor: {
    issuer: process.env.TOTP_ISSUER || 'RMPG Flex',
    encryptionKey: process.env.TOTP_ENCRYPTION_KEY || jwtSecret,
    tempTokenExpiry: process.env.TOTP_TEMP_TOKEN_EXPIRY || '3m',
    backupCodeCount: envInt('TOTP_BACKUP_CODE_COUNT', 10),
    trustedDeviceDays: envInt('TRUSTED_DEVICE_DAYS', 30),
  },

  // Session
  session: {
    maxPerUser: envInt('SESSION_MAX_PER_USER', 5),
    enforceIpBinding: envBool('SESSION_ENFORCE_IP_BINDING', true),
    ipChangeAction: (process.env.SESSION_IP_CHANGE_ACTION || 'warn') as 'invalidate' | 'reauth' | 'warn',
  },

  // CORS
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000,http://localhost:4173,https://rmpgutah.us,http://rmpgutah.us,https://www.rmpgutah.us,https://crm.rmpgutah.us')
    .split(',')
    .map(s => s.trim()),

  // Domain — primary domain for canonical redirects (www → apex)
  primaryDomain: process.env.PRIMARY_DOMAIN || 'rmpgutah.us',

  // Auto-Update Server URL (where desktop apps check for updates)
  updateServerUrl: process.env.UPDATE_SERVER_URL || 'https://rmpgutah.us',

  // Integrations
  serveManagerApiKey: process.env.SERVEMANAGER_API_KEY || '',
} as const;

export default config;
