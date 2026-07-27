// Locks in the 2026-07-27 telemetry fix in mapboxLoader.ts.
//
// Mapbox GL v3 exposes config.EVENTS_URL as a GETTER derived from API_URL.
// A previous attempt used plain assignment (`config.EVENTS_URL = '...'`),
// which no-ops against a getter without throwing — so the "fix" shipped and
// did nothing, and every blocked beacon kept spamming ERR_CONNECTION_REFUSED
// on operator networks that sinkhole events.mapbox.com.
//
// The regression this guards against is therefore a SILENT one: nothing
// crashes, the map still renders, and only a console full of network errors
// on someone else's machine reveals it. Hence a test rather than a comment.
import { describe, it, expect } from 'vitest';
import mapboxgl from 'mapbox-gl';
import '../mapboxLoader';

describe('mapbox telemetry suppression', () => {
  it('resolves EVENTS_URL to null so the SDK never posts a beacon', () => {
    // Every telemetry path in the SDK starts `if (!config.EVENTS_URL) return;`
    // — a falsy value means the request is never issued at all.
    expect(mapboxgl.config.EVENTS_URL).toBeFalsy();
  });

  it('keeps API_URL intact — only the events endpoint is disabled', () => {
    // EVENTS_URL is *derived* from API_URL, so the tempting shortcut is to
    // blank API_URL. That would also kill style/tile/sprite loading, i.e. the
    // whole map. Assert we did not take it.
    expect(mapboxgl.config.API_URL).toBeTruthy();
  });

  it('leaves the override configurable so a later re-define cannot throw', () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      mapboxgl.config,
      'EVENTS_URL',
    );
    expect(descriptor?.configurable).toBe(true);
  });
});
