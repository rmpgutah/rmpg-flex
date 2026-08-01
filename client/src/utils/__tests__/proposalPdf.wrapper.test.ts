import { describe, it, expect, vi } from 'vitest';

// `save` is assigned as an own instance property inside jsPDF's constructor
// (not on the prototype), so vi.spyOn(jsPDF.prototype, 'save') cannot see it.
// Wrap the constructor instead so every instance's `save` is a spy — see
// darPdf.test.ts / patrolTrackingPdfGenerator.wrapper.test.ts for precedent.
const saveSpy = vi.fn();
vi.mock('jspdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jspdf')>();
  class PatchedJsPDF extends actual.jsPDF {
    constructor(...args: ConstructorParameters<typeof actual.jsPDF>) {
      super(...args);
      const self = this;
      function patchedSave(filename?: string): PatchedJsPDF;
      function patchedSave(filename: string, options: { returnPromise: true }): Promise<void>;
      function patchedSave(
        filename?: string,
        options?: { returnPromise: true },
      ): PatchedJsPDF | Promise<void> {
        saveSpy(filename);
        return options?.returnPromise ? Promise.resolve() : self;
      }
      this.save = patchedSave;
    }
  }
  return { ...actual, default: PatchedJsPDF, jsPDF: PatchedJsPDF };
});

import { generateProposalPdf, buildProposalPdf } from '../proposalPdf';

function baseProposal() {
  return {
    proposal_number: 'PROP-2026-0417',
    stage: 'sent',
    valid_until: '2026-07-31',
    created_at: '2026-07-01',
    title: 'Retail Corridor Patrol Services Proposal',
    total_value: 4817.5,
  };
}

function baseClient() {
  return { name: 'Wasatch Retail Holdings, LLC' };
}

describe('proposalPdf wrapper (builder-extraction)', () => {
  it('generateProposalPdf still returns void and triggers a save', async () => {
    saveSpy.mockClear();
    const result = await generateProposalPdf(baseProposal(), baseClient());
    expect(result).toBeUndefined();
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy.mock.calls[0][0]).toBe('PROPOSAL-PROP-2026-0417.pdf');
  });

  it('buildProposalPdf returns the jsPDF document without saving', async () => {
    saveSpy.mockClear();
    const doc = await buildProposalPdf(baseProposal(), baseClient());
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('generateProposalPdf falls back to DRAFT filename when no proposal number is set', async () => {
    saveSpy.mockClear();
    await generateProposalPdf({}, {});
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy.mock.calls[0][0]).toBe('PROPOSAL-DRAFT.pdf');
  });
});
