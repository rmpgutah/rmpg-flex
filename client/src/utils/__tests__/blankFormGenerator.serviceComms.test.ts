import { describe, it, expect } from 'vitest';
import { generateBlankForm, BLANK_FORMS } from '../blankFormGenerator';

// Smoke tests for the field-printable service + communications forms.
// jsPDF runs in jsdom (the v2 form snapshot tests rely on the same), so this
// exercises the real draw path and fails if a generator throws — coverage that
// typecheck alone can't give for the imperative drawing code.

const NEW_FORMS = [
  'serve_affidavit', 'service_log', 'serve_non_service', // service
  'radio_log', 'comms_message', 'bolo_broadcast',         // communications
];

describe('blank service + communications forms', () => {
  it('registers each new form with a category and a form number', () => {
    for (const id of NEW_FORMS) {
      const def = BLANK_FORMS.find((f) => f.id === id);
      expect(def, `BLANK_FORMS missing ${id}`).toBeTruthy();
      expect(['service', 'communications']).toContain(def!.category);
      expect(def!.formNumber).toMatch(/^FORM PS-\d/);
    }
  });

  it('generates a non-empty PDF for every new form without throwing', () => {
    for (const id of NEW_FORMS) {
      const doc = generateBlankForm(id);
      expect(doc.getNumberOfPages(), `${id} produced no pages`).toBeGreaterThanOrEqual(1);
      const bytes = doc.output('arraybuffer');
      expect(bytes.byteLength, `${id} PDF suspiciously small`).toBeGreaterThan(1000);
    }
  });
});
