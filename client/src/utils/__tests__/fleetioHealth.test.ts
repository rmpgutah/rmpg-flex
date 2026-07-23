import { describe, it, expect } from 'vitest';
import { isFleetioSyncStatusUnhealthy } from '../fleetioHealth';

describe('isFleetioSyncStatusUnhealthy', () => {
  const NOW = Date.parse('2026-07-23T12:00:00Z');

  it('is healthy with no failures and no pending events', () => {
    expect(isFleetioSyncStatusUnhealthy({ failed_total: 0, outbound_failed_total: 0, oldest_pending_created_at: null }, NOW)).toBe(false);
  });

  it('is unhealthy at exactly 5 failed events (boundary)', () => {
    expect(isFleetioSyncStatusUnhealthy({ failed_total: 5, outbound_failed_total: 5, oldest_pending_created_at: null }, NOW)).toBe(true);
  });

  it('is healthy at 4 failed events', () => {
    expect(isFleetioSyncStatusUnhealthy({ failed_total: 4, outbound_failed_total: 4, oldest_pending_created_at: null }, NOW)).toBe(false);
  });

  it('is unhealthy when the oldest pending event is over 2h old', () => {
    const oldest = new Date(NOW - (2 * 60 * 60 * 1000 + 1000)).toISOString(); // new-date-ok — epoch-ms arithmetic on a fixed test constant, not a server timestamp string
    expect(isFleetioSyncStatusUnhealthy({ failed_total: 0, outbound_failed_total: 0, oldest_pending_created_at: oldest }, NOW)).toBe(true);
  });

  it('uses outbound_failed_total, not failed_total, for the threshold', () => {
    // failed_total (all-directions) is high but outbound_failed_total is low — should stay healthy.
    expect(isFleetioSyncStatusUnhealthy({ failed_total: 10, outbound_failed_total: 0, oldest_pending_created_at: null }, NOW)).toBe(false);
  });
});
