// Configuration validation and startup checks
import config from '../config';
import { logger } from './logger';
import { checkDbHealth } from './dbHealth';

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** Validate all configuration at startup */
export function validateConfig(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // JWT configuration
  if (config.jwt.secret.length < 32) {
    warnings.push('JWT_SECRET should be at least 32 characters for security');
  }

  // Rate limiting
  if (config.security.rateLimitMaxRequests > 10000) {
    warnings.push(
      'Rate limit is very high (>10000 requests per window). Consider reducing.'
    );
  }
  if (config.security.rateLimitWindowMs < 10000) {
    warnings.push(
      'Rate limit window is very short (<10s). This may cause false positives.'
    );
  }

  // Password policy
  if (config.password.minLength < 8) {
    errors.push(
      'Password minimum length must be at least 8 characters (CJIS requirement)'
    );
  }

  // Session config
  if (config.session.maxPerUser > 20) {
    warnings.push('Maximum sessions per user is very high (>20).');
  }

  // CORS
  if (config.isProduction && config.corsOrigins.includes('http://localhost:5173')) {
    warnings.push(
      'Development CORS origin (localhost:5173) is enabled in production'
    );
  }

  // Port conflicts
  if (config.port === config.httpsPort) {
    errors.push('HTTP and HTTPS ports cannot be the same');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/** Run startup self-tests */
export async function runStartupChecks(): Promise<{
  passed: boolean;
  results: Record<string, string>;
}> {
  const results: Record<string, string> = {};
  let passed = true;

  // 1. Config validation
  const configResult = validateConfig();
  results['config'] = configResult.valid
    ? 'ok'
    : `errors: ${configResult.errors.join('; ')}`;
  if (!configResult.valid) passed = false;

  // Log warnings even if valid
  for (const w of configResult.warnings) {
    logger.warn({ check: 'config' }, w);
  }

  // 2. Database health
  try {
    const dbHealth = checkDbHealth();
    results['database'] = dbHealth.status;
    if (dbHealth.status === 'error') passed = false;
  } catch {
    results['database'] = 'error';
    passed = false;
  }

  // 3. Environment
  results['node_version'] = process.version;
  results['environment'] = config.nodeEnv;
  results['ssl'] = config.ssl.enabled ? 'enabled' : 'disabled';

  return { passed, results };
}

/** Get environment-specific default values */
export function getEnvDefaults(
  env: string
): Record<string, any> {
  switch (env) {
    case 'production':
      return {
        logLevel: 'info',
        rateLimitMax: 1000,
        sessionTimeout: '15m',
        corsStrict: true,
      };
    case 'test':
      return {
        logLevel: 'error',
        rateLimitMax: 10000,
        sessionTimeout: '1h',
        corsStrict: false,
      };
    default:
      return {
        logLevel: 'debug',
        rateLimitMax: 10000,
        sessionTimeout: '24h',
        corsStrict: false,
      };
  }
}
