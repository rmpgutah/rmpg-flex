import { describe, it, expect } from 'vitest';
import { renderPdfV2 } from '../../engine/renderer';
import { dossierSchema, type DossierData } from '../dossier';

function getDocText(doc: Awaited<ReturnType<typeof renderPdfV2>>): string {
  const buf = new Uint8Array(doc.output('arraybuffer'));
  let text = '';
  for (const b of buf) text += String.fromCharCode(b);
  return text;
}

const BASE_DATA: DossierData = {
  person: { id: 4021, first_name: 'John', last_name: 'Doe', dob: '1990-01-01', gender: 'M', race: 'W' },
  cluster: [],
  flags: ['GANG AFFILIATED'],
  timeline: [{ kind: 'call', id: 1, date: '2026-06-01', title: 'Traffic stop', subtitle: '', status: 'closed' }],
  associates: [{ person_id: 99, name: 'Jane Smith', shared_events: 2, kinds: ['call'] }],
  vehicles: [{ color: 'Blue', year: 2018, make: 'Honda', model: 'Civic', plate_number: 'ABC123', vin: '1HG' }],
  addresses: [{ address: '123 Main St', source: 'DL' }],
};

describe('dossierSchema', () => {
  it('renders the subject name in the header', async () => {
    const doc = await renderPdfV2(dossierSchema, BASE_DATA, { coreFontsOnly: true });
    expect(getDocText(doc)).toContain('John Doe');
  });

  it('renders identity, vehicles, and timeline sections', async () => {
    const doc = await renderPdfV2(dossierSchema, BASE_DATA, { coreFontsOnly: true });
    const text = getDocText(doc);
    expect(text).toContain('IDENTITY');
    expect(text).toContain('ABC123');
    expect(text).toContain('Traffic stop');
  });

  it('renders a flagged badge for each flag', async () => {
    const doc = await renderPdfV2(dossierSchema, BASE_DATA, { coreFontsOnly: true });
    expect(getDocText(doc)).toContain('GANG AFFILIATED');
  });

  it('degrades gracefully when timeline data is malformed', async () => {
    const badData: DossierData = { ...BASE_DATA, timeline: [{ kind: 'call' } as any] };
    await expect(renderPdfV2(dossierSchema, badData, { coreFontsOnly: true })).resolves.toBeDefined();
  });

  it('omits the associates section when there are none', async () => {
    const doc = await renderPdfV2(dossierSchema, { ...BASE_DATA, associates: [] }, { coreFontsOnly: true });
    expect(getDocText(doc)).not.toContain('KNOWN ASSOCIATES');
  });
});
