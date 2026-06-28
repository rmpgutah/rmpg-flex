import { describe, it, expect } from 'vitest';
import { formatPlayerStatus } from './flexcamPlayerStatus';

describe('formatPlayerStatus', () => {
  it('surfaces a fetch/decoder error before any progress text', () => {
    expect(formatPlayerStatus({
      err: 'HTTP 500', chunkCount: 27, downloadedCount: 19, requestStatus: 'partial',
    })).toEqual({ label: 'Failed: HTTP 500', severity: 'error' });
  });

  it('renders a "failed" request status as a hard error even when no fetch err', () => {
    expect(formatPlayerStatus({
      err: null, chunkCount: 47, downloadedCount: 0, requestStatus: 'failed',
    })).toEqual({ label: 'Footage capture failed — try repair', severity: 'error' });
  });

  it('shows progress label while still fulfilling with zero clips', () => {
    expect(formatPlayerStatus({
      err: null, chunkCount: 24, downloadedCount: 0, requestStatus: 'fulfilling',
    })).toEqual({ label: 'Downloading footage…', severity: 'progress' });
  });

  it('shows partial-clip count when some chunks landed but not all', () => {
    expect(formatPlayerStatus({
      err: null, chunkCount: 27, downloadedCount: 19, requestStatus: 'fulfilling',
    })).toEqual({ label: '19 of 27 clips ready', severity: 'progress' });
  });

  it('shows "No footage available" for a stopped request with zero clips', () => {
    expect(formatPlayerStatus({
      err: null, chunkCount: 10, downloadedCount: 0, requestStatus: 'partial',
    })).toEqual({ label: 'No footage available', severity: 'idle' });
  });

  it('returns the ready/idle state when every chunk is downloaded', () => {
    expect(formatPlayerStatus({
      err: null, chunkCount: 27, downloadedCount: 27, requestStatus: 'complete',
    })).toEqual({ label: 'Ready', severity: 'idle' });
  });
});
