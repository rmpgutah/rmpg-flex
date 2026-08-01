import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const importer = vi.fn(() => Promise.resolve({}));
vi.mock('../../routes/routeModules', () => ({
  getRouteImporter: (path: string) => (path === '/known' ? importer : null),
}));

describe('prefetchRoute', () => {
  beforeEach(async () => {
    importer.mockClear();
    const m = await import('../useRoutePrefetch');
    m.__resetPrefetchCacheForTests();
  });
  afterEach(() => {
    delete (navigator as any).connection;
  });

  it('invokes the importer for a known path', async () => {
    const { prefetchRoute } = await import('../useRoutePrefetch');
    prefetchRoute('/known');
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('dedupes repeat prefetches of the same path', async () => {
    const { prefetchRoute } = await import('../useRoutePrefetch');
    prefetchRoute('/known');
    prefetchRoute('/known');
    prefetchRoute('/known');
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('is a no-op for an unregistered path', async () => {
    const { prefetchRoute } = await import('../useRoutePrefetch');
    prefetchRoute('/unknown');
    expect(importer).not.toHaveBeenCalled();
  });

  it('skips when the connection reports saveData', async () => {
    (navigator as any).connection = { saveData: true, effectiveType: '4g' };
    const { prefetchRoute } = await import('../useRoutePrefetch');
    prefetchRoute('/known');
    expect(importer).not.toHaveBeenCalled();
  });

  it('skips on 2g', async () => {
    (navigator as any).connection = { saveData: false, effectiveType: '2g' };
    const { prefetchRoute } = await import('../useRoutePrefetch');
    prefetchRoute('/known');
    expect(importer).not.toHaveBeenCalled();
  });

  it('swallows a rejecting importer without an unhandled rejection', async () => {
    importer.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    const { prefetchRoute } = await import('../useRoutePrefetch');
    expect(() => prefetchRoute('/known')).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });

  it('retries after a failure rather than caching the failure', async () => {
    importer.mockImplementationOnce(() => Promise.reject(new Error('blip')));
    const { prefetchRoute } = await import('../useRoutePrefetch');
    prefetchRoute('/known');
    await new Promise((r) => setTimeout(r, 0));
    prefetchRoute('/known');
    expect(importer).toHaveBeenCalledTimes(2);
  });
});

describe('createPrefetchIntentController', () => {
  beforeEach(async () => {
    importer.mockClear();
    const m = await import('../useRoutePrefetch');
    m.__resetPrefetchCacheForTests();
    vi.useFakeTimers();
  });
  afterEach(() => {
    delete (navigator as any).connection;
    vi.useRealTimers();
  });

  it('does not prefetch when hover is cancelled before the intent delay elapses', async () => {
    const { createPrefetchIntentController } = await import('../useRoutePrefetch');
    const controller = createPrefetchIntentController();

    controller.schedule('item-1', '/known');
    vi.advanceTimersByTime(60);
    controller.cancel('item-1');
    vi.advanceTimersByTime(200);

    expect(importer).not.toHaveBeenCalled();
  });

  it('prefetches exactly once when hover survives the intent delay', async () => {
    const { createPrefetchIntentController } = await import('../useRoutePrefetch');
    const controller = createPrefetchIntentController();

    controller.schedule('item-1', '/known');
    vi.advanceTimersByTime(200);

    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('cancelAll clears every pending timer', async () => {
    const { createPrefetchIntentController } = await import('../useRoutePrefetch');
    const controller = createPrefetchIntentController();

    controller.schedule('a', '/known');
    controller.schedule('b', '/known');
    controller.cancelAll();
    vi.advanceTimersByTime(200);

    expect(importer).not.toHaveBeenCalled();
  });

  it('is a no-op when path is missing or falsy', async () => {
    const { createPrefetchIntentController } = await import('../useRoutePrefetch');
    const controller = createPrefetchIntentController();

    controller.schedule('item-1', undefined);
    vi.advanceTimersByTime(200);

    expect(importer).not.toHaveBeenCalled();
  });
});
