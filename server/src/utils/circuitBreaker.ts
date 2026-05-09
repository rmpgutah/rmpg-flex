// Circuit breaker with retry logic
import { logger } from './logger';

type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitBreakerOptions {
  failureThreshold?: number; // Failures before opening (default: 5)
  resetTimeoutMs?: number; // Time before attempting reset (default: 30000)
  name: string; // Service name for logging
}

interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  lastFailure: number;
  lastSuccess: number;
  totalCalls: number;
  totalFailures: number;
}

const circuits = new Map<string, CircuitBreakerState>();

/** Get or create a circuit breaker state */
function getCircuit(name: string): CircuitBreakerState {
  if (!circuits.has(name)) {
    circuits.set(name, {
      state: 'closed',
      failures: 0,
      lastFailure: 0,
      lastSuccess: 0,
      totalCalls: 0,
      totalFailures: 0,
    });
  }
  return circuits.get(name)!;
}

/** Execute a function with circuit breaker protection */
export async function withCircuitBreaker<T>(
  fn: () => Promise<T>,
  options: CircuitBreakerOptions
): Promise<T> {
  const { failureThreshold = 5, resetTimeoutMs = 30_000, name } = options;
  const circuit = getCircuit(name);

  circuit.totalCalls++;

  // Check if circuit is open
  if (circuit.state === 'open') {
    if (Date.now() - circuit.lastFailure > resetTimeoutMs) {
      circuit.state = 'half-open';
      logger.info({ service: name }, 'Circuit breaker entering half-open state');
    } else {
      throw new Error(`Circuit breaker open for service: ${name}`);
    }
  }

  try {
    const result = await fn();

    // Success — reset circuit
    if (circuit.state === 'half-open') {
      logger.info({ service: name }, 'Circuit breaker closing after successful probe');
    }
    circuit.state = 'closed';
    circuit.failures = 0;
    circuit.lastSuccess = Date.now();

    return result;
  } catch (err) {
    circuit.failures++;
    circuit.totalFailures++;
    circuit.lastFailure = Date.now();

    if (circuit.failures >= failureThreshold) {
      circuit.state = 'open';
      logger.warn(
        { service: name, failures: circuit.failures },
        'Circuit breaker opened'
      );
    }

    throw err;
  }
}

/** Retry a function with exponential backoff */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; baseDelayMs?: number; label?: string } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 500, label = 'operation' } = options;

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 100;
        logger.warn(
          { attempt: attempt + 1, maxRetries, delayMs: Math.round(delay), label },
          'Retrying after failure'
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/** Get all circuit breaker states for diagnostics */
export function getCircuitBreakerStates(): Record<string, CircuitBreakerState> {
  const result: Record<string, CircuitBreakerState> = {};
  for (const [name, state] of circuits) {
    result[name] = { ...state };
  }
  return result;
}
