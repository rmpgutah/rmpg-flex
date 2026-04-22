import type { FormSchema, CheckboxField, LabeledField } from '../engine/types';

// Blank form — no data.
export type PersonBlankData = Record<string, never>;

function flag(label: string): CheckboxField<PersonBlankData> {
  return { kind: 'checkbox', label, accessor: () => false, editable: false };
}

function blankLabeled(label: string): LabeledField<PersonBlankData> {
  return { kind: 'labeled', label, accessor: () => '', editable: false };
}

const FLAG_LABELS = [
  'Sex Offender', 'Veteran', 'Gang Affiliation', 'Probation/Parole',
] as const;

export const personBlankSchema: FormSchema<PersonBlankData> = {
  meta: {
    formNumber: 'FORM PS-206-BLK',
    title: 'PERSON RECORD',
    revision: '2026-04',
  },
  header: { kind: 'default', formId: 'person_blank' },
  watermark: 'blank-form',
  sections: [
    {
      kind: 'section', title: 'IDENTITY', columns: 3,
      fields: [
        blankLabeled('Last Name'),
        blankLabeled('First Name'),
        blankLabeled('Middle Name'),
        blankLabeled('Date of Birth'),
        blankLabeled('Place of Birth'),
        blankLabeled('Alias / Nickname'),
      ],
    },
    // Physical build fields — the engine only supports 1/2/3 columns, so we
    // split the 4-col "build" row into a 2-col section and repeat for
    // appearance.
    {
      kind: 'section', title: 'PHYSICAL DESCRIPTION', columns: 2,
      fields: [
        blankLabeled('Gender'),
        blankLabeled('Race'),
        blankLabeled('Height'),
        blankLabeled('Weight'),
        blankLabeled('Build'),
        blankLabeled('Complexion'),
        blankLabeled('Hair Color'),
        blankLabeled('Eye Color'),
      ],
    },
    {
      kind: 'section', title: 'PHYSICAL DESCRIPTION (CONT.)', columns: 3,
      fields: [
        blankLabeled('Facial Hair'),
        blankLabeled('Glasses'),
        blankLabeled('Hair Style'),
      ],
    },
    {
      kind: 'section', title: 'MARKS & CLOTHING', columns: 1,
      fields: [
        blankLabeled('Scars / Marks / Tattoos'),
        blankLabeled('Clothing Description'),
      ],
    },
    {
      kind: 'section', title: 'CONTACT', columns: 3,
      fields: [
        blankLabeled('Phone'),
        blankLabeled('Secondary Phone'),
        blankLabeled('Email'),
      ],
    },
    {
      kind: 'section', title: 'ADDRESS', columns: 1,
      fields: [blankLabeled('Street Address')],
    },
    {
      kind: 'section', title: 'CITY / STATE / ZIP', columns: 3,
      fields: [
        blankLabeled('City'),
        blankLabeled('State'),
        blankLabeled('ZIP'),
      ],
    },
    // 4-col DL details split into a 2-col section (2 rows of 2).
    {
      kind: 'section', title: 'IDENTIFICATION', columns: 2,
      fields: [
        blankLabeled('DL Number'),
        blankLabeled('DL State'),
        blankLabeled('DL Class'),
        blankLabeled('DL Expiry'),
      ],
    },
    {
      kind: 'section', title: 'IDENTIFICATION (CONT.)', columns: 3,
      fields: [
        blankLabeled('Alt ID Type'),
        blankLabeled('Alt ID Number'),
        blankLabeled('Alt ID State'),
      ],
    },
    {
      kind: 'section', title: 'IDENTIFICATION: SSN', columns: 2,
      fields: [
        blankLabeled('SSN (Last 4)'),
        blankLabeled('Citizenship'),
      ],
    },
    {
      kind: 'section', title: 'EMPLOYMENT', columns: 3,
      fields: [
        blankLabeled('Employer'),
        blankLabeled('Occupation'),
        blankLabeled('Language'),
      ],
    },
    {
      kind: 'section', title: 'DEMOGRAPHICS', columns: 2,
      fields: [
        blankLabeled('Marital Status'),
        blankLabeled('Social Media'),
      ],
    },
    // Flags & Status — checkbox row, then 2-col labeled detail, then
    // full-width caution line. Rendered via a callback because the section
    // mixes checkboxes and labeled rows in specific ordering.
    (ctx, data) => {
      ctx.section('FLAGS & STATUS', (inner) => {
        const row: CheckboxField<PersonBlankData>[] = FLAG_LABELS.map(flag);
        inner.checkboxRow(row, data);
        inner.spacer(1);
        // Rely on sequential labeledField calls (each full-width) — matches
        // how the engine renders single-column sections.
        inner.labeledField(blankLabeled('Gang Affiliation Details'), data);
        inner.labeledField(blankLabeled('Probation/Parole Officer'), data);
        inner.labeledField(blankLabeled('Caution Flags / Known Associates'), data);
      });
    },
    {
      kind: 'section', title: 'EMERGENCY CONTACT', columns: 3,
      fields: [
        blankLabeled('Contact Name'),
        blankLabeled('Phone'),
        blankLabeled('Relationship'),
      ],
    },
    {
      kind: 'section', title: 'NOTES', columns: 1,
      fields: [
        {
          kind: 'narrative',
          label: 'Notes',
          accessor: () => '',
          minLines: 10,
          editable: false,
        },
      ],
    },
    {
      kind: 'section', title: 'SIGNATURES', columns: 1,
      fields: [
        {
          kind: 'signature',
          label: 'Recording Officer',
          accessor: () => undefined,
          editable: false,
        },
      ],
    },
  ],
};
