import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { wrapText, expirationLine, bannerStyleFor } from '../trespassOrderPdf';
import type { TrespassOrder } from '../../types';

describe('wrapText', () => {
  it('returns a single empty entry for empty input', () => {
    expect(wrapText('', 20)).toEqual(['']);
  });
  it('keeps short strings as one line', () => {
    expect(wrapText('hello world', 20)).toEqual(['hello world']);
  });
  it('wraps at word boundaries', () => {
    // 10-char budget — "one two" = 7, "+three" overruns, breaks before "three"
    expect(wrapText('one two three four', 10)).toEqual(['one two', 'three four']);
  });
  it('preserves explicit newlines as paragraph breaks', () => {
    expect(wrapText('first line\nsecond line', 50)).toEqual(['first line', 'second line']);
  });
  it('does not lose data when a single word is longer than the budget', () => {
    const out = wrapText('ANTIDISESTABLISHMENTARIANISM', 10);
    expect(out.length).toBe(1);
    expect(out[0]).toBe('ANTIDISESTABLISHMENTARIANISM');
  });
});

describe('expirationLine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Anchor "now" to a fixed instant so the relative day-math is deterministic.
    vi.setSystemTime(new Date('2026-06-22T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "Permanent" when no expiration_date is set', () => {
    expect(expirationLine({ status: 'active' })).toBe('Permanent');
  });
  it('omits the relative callout for non-active orders', () => {
    // Expired/lifted/served already convey their state via the status banner;
    // adding "(X days remaining)" on top would be misleading.
    const line = expirationLine({ status: 'lifted', expiration_date: '2026-12-31' });
    expect(line).toBe('Expires Dec 31, 2026');
  });
  it('annotates active orders expiring within 30 days', () => {
    const line = expirationLine({ status: 'active', expiration_date: '2026-07-12' });
    // 20 days out from anchor "now"
    expect(line).toContain('Expires Jul 12, 2026');
    expect(line).toMatch(/\(20 days remaining\)/);
  });
  it('does NOT annotate active orders more than 30 days out', () => {
    const line = expirationLine({ status: 'active', expiration_date: '2026-12-31' });
    expect(line).toBe('Expires Dec 31, 2026');
  });
  it('marks an active order as EXPIRED when the date is in the past', () => {
    const line = expirationLine({ status: 'active', expiration_date: '2026-06-01' });
    // ~21 days ago
    expect(line).toMatch(/EXPIRED \d+ days? ago/);
  });
  it('uses singular "day" when exactly 1 day remains or has passed', () => {
    const tomorrow = expirationLine({ status: 'active', expiration_date: '2026-06-23' });
    expect(tomorrow).toMatch(/\(1 day remaining\)/);
  });
});

describe('bannerStyleFor', () => {
  it('renders active and violated as red high-attention banners', () => {
    const a = bannerStyleFor('active');
    const v = bannerStyleFor('violated');
    expect(a.label).toMatch(/ACTIVE/);
    expect(v.label).toMatch(/VIOLATED/);
    // Same alert palette for both
    expect(a.bg).toBe(v.bg);
    expect(a.fg).toBe(v.fg);
  });
  it('renders served as an amber mid-attention banner', () => {
    const s = bannerStyleFor('served');
    expect(s.label).toMatch(/SERVED/);
    // Amber, distinct from active red and from gray closed states
    expect(s.fg).toBe('#b45309');
  });
  it('renders expired and lifted as muted closed-state banners', () => {
    const e = bannerStyleFor('expired');
    const l = bannerStyleFor('lifted');
    expect(e.label).toMatch(/EXPIRED/);
    expect(l.label).toMatch(/LIFTED/);
  });
  it('safely handles an unexpected status string (defensive)', () => {
    // The type system narrows TrespassOrderStatus, but the function is
    // called on data that originated from D1 — guard against drift.
    const x = bannerStyleFor('something-new' as any);
    expect(x.label).toBeTruthy();
    expect(x.fg).toBeTruthy();
  });
});

describe('TrespassOrder fixture compatibility', () => {
  it('accepts a minimum-shape TrespassOrder without throwing in pure helpers', () => {
    const minimal: Partial<TrespassOrder> = {
      id: 1,
      order_number: 'TO-001',
      subject_first_name: 'John',
      subject_last_name: 'Doe',
      location: '123 Main',
      order_type: 'trespass_warning',
      status: 'active',
      issued_by: 0,
      created_at: '2026-06-22T00:00:00Z',
      updated_at: '2026-06-22T00:00:00Z',
    };
    // None of the pure helpers should throw on a minimum-shape record.
    expect(() => expirationLine(minimal as TrespassOrder)).not.toThrow();
    expect(() => bannerStyleFor(minimal.status!)).not.toThrow();
  });
});
