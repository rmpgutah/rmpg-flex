// NOTE: these fixtures are SYNTHETIC approximations of each state's detail
// page (no live sample was available when this was written — see
// docs/superpowers/specs/2026-07-04-sor-state-enrichment-design.md).
// Replace with real captured HTML once a human confirms actual page
// structure post-merge; the parsers are intentionally tolerant/label-driven
// so they degrade gracefully rather than throw on a format mismatch.
import { describe, it, expect } from 'vitest';
import { utahAdapter } from '../../src/utils/sorEnrichment/adapters/utah';
import { idahoAdapter } from '../../src/utils/sorEnrichment/adapters/idaho';
import { nevadaAdapter } from '../../src/utils/sorEnrichment/adapters/nevada';
import { wyomingAdapter } from '../../src/utils/sorEnrichment/adapters/wyoming';
import { coloradoAdapter } from '../../src/utils/sorEnrichment/adapters/colorado';
import { arizonaAdapter } from '../../src/utils/sorEnrichment/adapters/arizona';

describe('utahAdapter', () => {
  it('extracts offense, risk level, and tier from a label-driven page', () => {
    const html = `<div class="offender-detail">
      <p>Offense: Lewdness Involving a Child</p>
      <p>Risk Level: High</p>
      <p>Tier: 3</p>
      <p>Registration Status: Compliant</p>
    </div>`;
    const result = utahAdapter.parseDetailPage(html);
    expect(result.offense).toBe('Lewdness Involving a Child');
    expect(result.risk_level).toBe('High');
    expect(result.tier).toBe(3);
    expect(result.registration_status).toBe('Compliant');
  });

  it('returns nulls for all fields on unrecognized HTML rather than throwing', () => {
    const result = utahAdapter.parseDetailPage('<html><body>Not found</body></html>');
    expect(result).toEqual({ offense: null, risk_level: null, tier: null, registration_status: null });
  });

  it('treats a label with no value before the next tag/newline as not-found (null, not empty string)', () => {
    const html = `<div class="offender-detail">
      <p>Offense: </p>
      <p>Risk Level: High</p>
    </div>`;
    const result = utahAdapter.parseDetailPage(html);
    expect(result.offense).toBeNull();
    expect(result.risk_level).toBe('High');
  });
});

describe('idahoAdapter', () => {
  it('extracts fields from a label-driven page', () => {
    const html = `<span>Charge: Sexual Abuse of a Minor</span><span>Risk Tier: 2</span>`;
    const result = idahoAdapter.parseDetailPage(html);
    expect(result.offense).toBe('Sexual Abuse of a Minor');
    expect(result.tier).toBe(2);
  });
});

describe('nevadaAdapter', () => {
  it('extracts fields from a label-driven page', () => {
    const html = `<td>Conviction: Statutory Sexual Seduction</td><td>Tier Level: 1</td>`;
    const result = nevadaAdapter.parseDetailPage(html);
    expect(result.offense).toBe('Statutory Sexual Seduction');
    expect(result.tier).toBe(1);
  });
});

describe('wyomingAdapter', () => {
  it('extracts fields from a label-driven page', () => {
    const html = `<p>Offense(s): Sexual Assault in the Second Degree</p><p>Tier: 3</p>`;
    const result = wyomingAdapter.parseDetailPage(html);
    expect(result.offense).toBe('Sexual Assault in the Second Degree');
    expect(result.tier).toBe(3);
  });
});

describe('coloradoAdapter', () => {
  it('extracts fields from a label-driven page', () => {
    const html = `<div>Offense Description: Sexual Assault on a Child</div><div>Registration Status: Non-Compliant</div>`;
    const result = coloradoAdapter.parseDetailPage(html);
    expect(result.offense).toBe('Sexual Assault on a Child');
    expect(result.registration_status).toBe('Non-Compliant');
  });
});

describe('arizonaAdapter', () => {
  it('extracts fields from a label-driven page', () => {
    const html = `<li>Crime: Molestation of a Child</li><li>Level: 3</li>`;
    const result = arizonaAdapter.parseDetailPage(html);
    expect(result.offense).toBe('Molestation of a Child');
    expect(result.tier).toBe(3);
  });
});
