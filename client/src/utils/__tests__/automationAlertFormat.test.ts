/**
 * Unit tests for the automation_alert toast formatting logic
 * extracted from the DispatchPage.tsx handler.
 *
 * The handler is inline (not a separate module) so we replicate
 * the pure derivation logic here to catch regressions without
 * mounting a full React tree.
 */

import { describe, it, expect } from 'vitest';
import { toDisplayLabel } from '../formatters';

// ---------------------------------------------------------------------------
// Pure helpers that mirror the handler logic in DispatchPage.tsx
// ---------------------------------------------------------------------------

const CRITICAL_ACTIONS = new Set(['trigger_welfare_check', 'change_unit_status']);

function deriveSeverity(actionType: string): 'error' | 'warning' {
  return CRITICAL_ACTIONS.has(actionType) ? 'error' : 'warning';
}

function buildDetail(data: {
  trigger_lat?: number | null;
  trigger_lng?: number | null;
  context?: {
    speed?: number | null;
    call_id?: number | string | null;
    geofence_name?: string | null;
  };
}): string {
  const parts: string[] = [];
  if (data.trigger_lat != null && data.trigger_lng != null) {
    parts.push(
      `${Number(data.trigger_lat).toFixed(4)}, ${Number(data.trigger_lng).toFixed(4)}`,
    );
  }
  const ctx = data.context ?? {};
  if (ctx.speed != null) parts.push(`${ctx.speed} mph`);
  if (ctx.call_id != null) parts.push(`Call #${ctx.call_id}`);
  if (ctx.geofence_name) parts.push(ctx.geofence_name);
  return parts.length > 0 ? ` — ${parts.join(' | ')}` : '';
}

function buildMessage(data: {
  action_type?: string;
  source?: string;
  trigger_lat?: number | null;
  trigger_lng?: number | null;
  context?: Record<string, unknown>;
}): string {
  const actionType: string = data.action_type ?? '';
  const source = data.source === 'officer' ? 'Officer' : 'System';
  const label = toDisplayLabel(actionType) || actionType;
  const detail = buildDetail(data as Parameters<typeof buildDetail>[0]);
  return `[Auto / ${source}] ${label}${detail}`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('automation_alert toast formatting', () => {
  it('maps officer source correctly', () => {
    const msg = buildMessage({ action_type: 'notify_dispatch', source: 'officer' });
    expect(msg).toContain('[Auto / Officer]');
  });

  it('maps server source correctly', () => {
    const msg = buildMessage({ action_type: 'notify_dispatch', source: 'system' });
    expect(msg).toContain('[Auto / System]');
  });

  it('humanises action_type via toDisplayLabel', () => {
    const msg = buildMessage({ action_type: 'trigger_welfare_check', source: 'system' });
    // toDisplayLabel converts underscores to spaces and title-cases
    expect(msg).toMatch(/Trigger Welfare Check/i);
  });

  it('marks trigger_welfare_check as critical', () => {
    expect(deriveSeverity('trigger_welfare_check')).toBe('error');
  });

  it('marks change_unit_status as critical', () => {
    expect(deriveSeverity('change_unit_status')).toBe('error');
  });

  it('marks notify_supervisor as non-critical', () => {
    expect(deriveSeverity('notify_supervisor')).toBe('warning');
  });

  it('includes coordinates formatted to 4 decimal places', () => {
    const detail = buildDetail({ trigger_lat: 40.76012345, trigger_lng: -111.89123456 });
    expect(detail).toContain('40.7601, -111.8912');
  });

  it('omits coordinates when not present', () => {
    const detail = buildDetail({});
    expect(detail).toBe('');
  });

  it('includes speed from context', () => {
    const detail = buildDetail({ context: { speed: 95 } });
    expect(detail).toContain('95 mph');
  });

  it('includes call_id from context', () => {
    const detail = buildDetail({ context: { call_id: 42 } });
    expect(detail).toContain('Call #42');
  });

  it('includes geofence_name from context', () => {
    const detail = buildDetail({ context: { geofence_name: 'Downtown Zone A' } });
    expect(detail).toContain('Downtown Zone A');
  });

  it('combines multiple context fields with pipe separator', () => {
    const detail = buildDetail({
      trigger_lat: 40.76,
      trigger_lng: -111.89,
      context: { speed: 80, call_id: 7 },
    });
    expect(detail).toContain(' | ');
    expect(detail).toContain('80 mph');
    expect(detail).toContain('Call #7');
  });
});
