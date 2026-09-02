import { describe, it, expect } from 'vitest';
import { parseCentraliaLlm, CENTRALIA_SYSTEM } from '../src/utils/personIntel/centraliaExtractAi';
import { buildSkipTraceMeta } from '../src/utils/personIntel/adapters/skiptracer';

// ─── centralia LLM reply parsing ─────────────────────────────
describe('parseCentraliaLlm', () => {
  it('parses a well-formed grounded reply', () => {
    const reply = JSON.stringify({
      cluster: {
        case_name: 'State v. Doe', docket_number: 'DA 25-0040',
        citation: '2025 MT 40', date_filed: 'May 1, 2025', date_filed_iso: '2025-05-01',
      },
      opinions: [
        { author: 'Justice McKinnon', type: 'majority' },
        { author: 'Justice Shea', type: 'concurrence' },
        { author: null, type: 'dissent' }, // authorless → dropped
        { author: 'Justice Rice', type: 'concurring nonsense' }, // bad type → kept, type dropped
      ],
      warnings: ['page 3 scanned'],
    });
    const p = parseCentraliaLlm(reply)!;
    expect(p.cluster?.case_name).toBe('State v. Doe');
    expect(p.cluster?.date_filed_iso).toBe('2025-05-01');
    expect(p.opinions).toHaveLength(3); // authorless dropped
    expect(p.opinions?.find(o => o.author === 'Justice Rice')?.type).toBeUndefined();
    expect(p.warnings).toEqual(['page 3 scanned']);
  });

  it('accepts JSON wrapped in prose (loose parsing)', () => {
    const reply = 'Here is the structure:\n```json\n{"cluster":{"case_name":"State v. Doe"},"opinions":[]}\n```';
    expect(parseCentraliaLlm(reply)?.cluster?.case_name).toBe('State v. Doe');
  });

  it('treats sentinel values as absent, not as data', () => {
    const p = parseCentraliaLlm(JSON.stringify({
      cluster: { case_name: 'None', docket_number: 'N/A', citation: 'unknown', date_filed: null },
      opinions: [{ author: 'Justice X', type: 'majority' }],
    }))!;
    expect(p.cluster?.case_name).toBeUndefined();
    expect(p.cluster?.docket_number).toBeUndefined();
    // Still grounded via the opinion.
    expect(p.opinions).toHaveLength(1);
  });

  it('returns null when nothing is grounded (no fields, no opinions)', () => {
    expect(parseCentraliaLlm(JSON.stringify({ cluster: {}, opinions: [] }))).toBeNull();
    expect(parseCentraliaLlm('the model refused and wrote a paragraph instead')).toBeNull();
    expect(parseCentraliaLlm('')).toBeNull();
  });
});

// ─── skip-trace profile meta (WebOlivia shape) ───────────────
describe('buildSkipTraceMeta', () => {
  const record = {
    firstName: 'James', lastName: 'Whitsitt', age: '76', born: 'February 1949',
    phones: [
      { number: '(214) 534-2474', type: 'Wireless', provider: 'New Cingular Wireless PCS LLC - IL' },
      { number: '(812) 555-0100' },
    ],
    previousAddresses: [{
      streetAddress: '928 Meadowcove Cir', addressLocality: 'Garland',
      addressRegion: 'TX', postalCode: '75043', timespan: 'Recorded July 1989',
    }],
    relatives: [{ Name: 'Janice Whitsitt', Age: '79' }, { name: 'Goldie Whitsitt', age: '75' }],
    associates: ['Lola Sonnenberg'],
    personLink: 'https://example.com/james-whitsitt_id_G-123',
  };

  it('preserves the pairings the flat data points lose', () => {
    const m = buildSkipTraceMeta(record) as Record<string, any>;
    expect(m.firstName).toBe('James');
    expect(m.phones[0]).toEqual({ number: '(214) 534-2474', type: 'Wireless', provider: 'New Cingular Wireless PCS LLC - IL' });
    expect(m.phones[1]).toEqual({ number: '(812) 555-0100', type: undefined, provider: undefined });
    const pa = m.previousAddresses[0];
    expect(pa.street).toBe('928 Meadowcove Cir');
    expect(pa.timespan).toBe('Recorded July 1989');
    expect(m.relatives.map((r: any) => r.name)).toEqual(['Janice Whitsitt', 'Goldie Whitsitt']);
    expect(m.relatives[0].age).toBe('79'); // WebOlivia capitalised keys normalised
    expect(m.associates).toEqual([{ name: 'Lola Sonnenberg', age: undefined }]);
    expect(m.personLink).toContain('james-whitsitt');
  });

  it('is total — never throws on an empty or hostile record', () => {
    expect(buildSkipTraceMeta({})).toBeTruthy();
    expect(buildSkipTraceMeta(null)).toBeTruthy();
    expect(buildSkipTraceMeta(undefined)).toBeTruthy();
    expect((buildSkipTraceMeta([]) as any).phones).toEqual([]);
  });
});
