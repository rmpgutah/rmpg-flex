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
    minLength: envInt('PASSWORD_MIN_LENGTH', 8),
    requireUppercase: envBool('PASSWORD_REQUIRE_UPPERCASE', true),
    requireLowercase: envBool('PASSWORD_REQUIRE_LOWERCASE', true),
    requireNumber: envBool('PASSWORD_REQUIRE_NUMBER', true),
    requireSpecial: envBool('PASSWORD_REQUIRE_SPECIAL', false),
    expiryDays: envInt('PASSWORD_EXPIRY_DAYS', 90),
    historyCount: envInt('PASSWORD_HISTORY_COUNT', 5),
    expiryWarningDays: envInt('PASSWORD_EXPIRY_WARNING_DAYS', 7),
  },

  // Two-Factor Authentication
  twoFactor: {
    issuer: process.env.TOTP_ISSUER || 'RMPG Flex',
    encryptionKey: process.env.TOTP_ENCRYPTION_KEY || (isProduction
      ? (() => {
          console.error('');
          console.error('╔═══════════════════════════════════════════════════════════╗');
          console.error('║  CRITICAL: TOTP_ENCRYPTION_KEY is not set!               ║');
          console.error('║  Generate one: openssl rand -hex 32                       ║');
          console.error('║  Set it in .env: TOTP_ENCRYPTION_KEY=<your-key>           ║');
          console.error('╚═══════════════════════════════════════════════════════════╝');
          console.error('');
          return crypto.randomBytes(32).toString('hex');
        })()
      // Dev fallback: deterministic key so TOTP secrets survive server restarts
      : 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2'
    ),
    tempTokenExpiry: process.env.TOTP_TEMP_TOKEN_EXPIRY || '3m',
    backupCodeCount: envInt('TOTP_BACKUP_CODE_COUNT', 10),
    trustedDeviceDays: envInt('TRUSTED_DEVICE_DAYS', 30),
  },

  // Session
  session: {
    maxPerUser: envInt('SESSION_MAX_PER_USER', 5),
  },

  // CORS
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000,http://localhost:4173,https://rmpgutah.us,http://rmpgutah.us,https://www.rmpgutah.us')
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
