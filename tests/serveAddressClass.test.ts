// tests/serveAddressClass.test.ts
// ============================================================
// Address-class resolution (spec §3.1)
// ============================================================
// BINDING RULE (operator decision D-2): address class describes the
// LOCATION, never the recipient. A registered agent is frequently at a
// residence, and a residence needs residential attempt windows.
// Unconfirmed must never yield business timing.
// ============================================================

import { describe, it, expect } from 'vitest';
import { resolveAddressClass } from '../src/utils/serveAddressClass';

describe('resolveAddressClass', () => {
  it('maps commercial and gated aliases from the intake review dropdown', () => {
    expect(resolveAddressClass({ operatorOverride: 'commercial' })).toEqual({
      klass: 'business', confirmed: true, source: 'operator',
    });
    expect(resolveAddressClass({ operatorOverride: 'gated' })).toEqual({
      klass: 'residential', confirmed: true, source: 'operator',
    });
  });

  it('an existing property record outranks the extracted value', () => {
    const r = resolveAddressClass({ extracted: 'business', propertyRecordClass: 'residential' });
    expect(r.klass).toBe('residential');
    expect(r.confirmed).toBe(true);
    expect(r.source).toBe('property_record');
  });

  it('a matched business record confirms business', () => {
    const r = resolveAddressClass({ businessRecordMatched: true });
    expect(r).toEqual({ klass: 'business', confirmed: true, source: 'business_record' });
  });

  it('uses the extracted value when nothing outranks it, but marks it unconfirmed', () => {
    const r = resolveAddressClass({ extracted: 'business' });
    expect(r.klass).toBe('business');
    expect(r.confirmed).toBe(false);
    expect(r.source).toBe('extracted');
  });

  it('reads explicit packet language when no field was extracted', () => {
    const r = resolveAddressClass({ instructionsText: 'BUSINESS ADDRESS. Serve during hours.' });
    expect(r.klass).toBe('business');
    expect(r.source).toBe('packet_language');
  });

  it('does NOT treat a registered-agent mention as a business address', () => {
    // D-2: agents are frequently at residences.
    const r = resolveAddressClass({ instructionsText: 'Serve the registered agent at this address' });
    expect(r.klass).toBe('unknown');
    expect(r.confirmed).toBe(false);
  });

  it('returns unknown/unconfirmed when there is nothing to go on', () => {
    expect(resolveAddressClass({})).toEqual({ klass: 'unknown', confirmed: false, source: 'none' });
  });

  it('never reports confirmed for an unknown class', () => {
    const r = resolveAddressClass({ extracted: 'unknown' });
    expect(r.klass).toBe('unknown');
    expect(r.confirmed).toBe(false);
  });

  it('pins residential-before-business ordering: dual-signal packet language resolves to residential', () => {
    // D-2: this is the safety-critical ordering that prevents a future refactor
    // from silently swapping the RESIDENTIAL/BUSINESS if-checks. Both signals
    // present; residential must win.
    const r = resolveAddressClass({
      instructionsText: "Registered agent's home address, also filed as the business address in corporate filings.",
    });
    expect(r.klass).toBe('residential');
    expect(r.source).toBe('packet_language');
  });

  it('ensures packet language beats extracted: residential text + business extraction', () => {
    // Packet language (tier 3) outranks extracted field (tier 4).
    // Proves that tier ordering is enforced at the resolution point.
    const r = resolveAddressClass({
      instructionsText: 'This is a residential address. Owner currently resides here.',
      extracted: 'business',
    });
    expect(r.klass).toBe('residential');
    expect(r.source).toBe('packet_language');
    expect(r.confirmed).toBe(false);
  });
});
