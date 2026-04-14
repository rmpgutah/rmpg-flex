import type { FormSchema, LabeledField } from '../engine/types';

export type CitationBlankData = Record<string, never>;

function blankLabeled(label: string): LabeledField<CitationBlankData> {
  return { kind: 'labeled', label, accessor: () => '', editable: false };
}

export const citationBlankSchema: FormSchema<CitationBlankData> = {
  meta: {
    formNumber: 'FORM PS-209-BLK',
    title: 'CITATION',
    revision: '2026-04',
  },
  header: { kind: 'default', formId: 'citation_blank' },
  watermark: 'blank-form',
  sections: [
    {
      kind: 'section', title: 'CITATION INFORMATION', columns: 3,
      fields: [
        blankLabeled('Citation Number'),
        blankLabeled('Type'),
        blankLabeled('Status'),
      ],
    },
    {
      kind: 'section', title: 'TIMING & LEVEL', columns: 3,
      fields: [
        blankLabeled('Violation Date'),
        blankLabeled('Violation Time'),
        blankLabeled('Offense Level'),
      ],
    },
    {
      kind: 'section', title: 'LOCATION', columns: 1,
      fields: [blankLabeled('Location')],
    },
    {
      kind: 'section', title: 'SUBJECT', columns: 3,
      fields: [
        blankLabeled('Full Name'),
        blankLabeled('Date of Birth'),
        blankLabeled('DL Number'),
      ],
    },
    {
      kind: 'section', title: 'SUBJECT ADDRESS', columns: 1,
      fields: [blankLabeled('Address')],
    },
    {
      kind: 'section', title: 'VEHICLE INFORMATION', columns: 3,
      fields: [
        blankLabeled('License Plate'),
        blankLabeled('State'),
        blankLabeled('Vehicle Description'),
      ],
    },
    {
      kind: 'section', title: 'VIOLATION DETAILS', columns: 2,
      fields: [
        blankLabeled('Statute / Code'),
        blankLabeled('Fine Amount'),
      ],
    },
    {
      kind: 'section', title: 'VIOLATION DESCRIPTION', columns: 1,
      fields: [blankLabeled('Violation Description')],
    },
    {
      kind: 'section', title: 'COURT', columns: 2,
      fields: [
        blankLabeled('Court Date'),
        blankLabeled('Court Name'),
      ],
    },
    {
      kind: 'section', title: 'COURT ADDRESS', columns: 1,
      fields: [blankLabeled('Court Address')],
    },
    {
      kind: 'section', title: 'NOTES', columns: 1,
      fields: [
        {
          kind: 'narrative',
          label: 'Notes',
          accessor: () => '',
          minLines: 12,
          editable: false,
        },
      ],
    },
    {
      kind: 'section', title: 'SIGNATURES', columns: 1,
      fields: [
        {
          kind: 'signature',
          label: 'Issuing Officer',
          accessor: () => undefined,
          editable: false,
        },
        {
          kind: 'signature',
          label: 'Subject Acknowledgment',
          accessor: () => undefined,
          editable: false,
        },
      ],
    },
  ],
};
