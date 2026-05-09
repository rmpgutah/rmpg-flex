// Graceful shutdown handler
import { Server } from 'http';
import { Server as HttpsServer } from 'https';
import { logger } from './logger';

interface ShutdownOptions {
  timeout?: number; // Max ms to wait for connections to drain (default: 10000)
  onShutdown?: () => Promise<void>; // Custom cleanup callback
}

const shutdownCallbacks: Array<() => Promise<void>> = [];

/** Register a callback to run during shutdown */
export function onShutdown(cb: () => Promise<void>): void {
  shutdownCallbacks.push(cb);
}

/** Setup graceful shutdown handlers for HTTP/HTTPS servers */
export function setupGracefulShutdown(
  servers: Array<Server | HttpsServer>,
  options: ShutdownOptions = {}
): void {
  const { timeout = 10_000, onShutdown: customCleanup } = options;
  let isShuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info({ signal }, 'Graceful shutdown initiated');

    // Stop accepting new connections
    const closePromises = servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    );

    // Run registered shutdown callbacks
    for (const cb of shutdownCallbacks) {
      try {
        await cb();
      } catch (err) {
        logger.error({ err }, 'Shutdown callback failed');
      }
    }

    // Run custom cleanup
    if (customCleanup) {
      try {
        await customCleanup();
      } catch (err) {
        logger.error({ err }, 'Custom shutdown cleanup failed');
      }
    }

    // Wait for connections to drain with timeout
    const timer = setTimeout(() => {
      logger.warn('Shutdown timeout reached, forcing exit');
      process.exit(1);
    }, timeout);

    await Promise.all(closePromises);
    clearTimeout(timer);

    logger.info('Graceful shutdown complete');
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
