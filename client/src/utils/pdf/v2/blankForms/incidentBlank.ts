import type { FormSchema, CheckboxField, LabeledField } from '../engine/types';

// Blank form — no data. The data type is effectively empty.
export type IncidentBlankData = Record<string, never>;

/** Returns a CheckboxField with the given label, always accessed as false. */
function flag(label: string): CheckboxField<IncidentBlankData> {
  return { kind: 'checkbox', label, accessor: () => false, editable: false };
}

/** Returns a LabeledField that never has a value (blank form). */
function blankLabeled(label: string): LabeledField<IncidentBlankData> {
  return { kind: 'labeled', label, accessor: () => '', editable: false };
}

const OPERATIONAL_FLAGS = [
  'Alcohol Involved', 'Drugs Involved', 'Domestic Violence', 'Injuries Reported',
  'Mental Health Crisis', 'Juvenile Involved', 'Felony in Progress', 'Officer Safety',
  'K9 Requested', 'EMS Requested', 'Fire Requested', 'HAZMAT',
  'Gang Related', 'Evidence Collected', 'Body Camera Active', 'Photos Taken',
  'Trespass Issued', 'Vehicle Pursuit', 'Foot Pursuit', 'LE Notified',
] as const;

export const incidentBlankSchema: FormSchema<IncidentBlankData> = {
  meta: {
    formNumber: 'PS-205-BLK',
    title: 'INCIDENT REPORT',
    revision: '2026-04',
  },
  header: { kind: 'default', formId: 'incident_blank' },
  watermark: 'blank-form',
  sections: [
    {
      kind: 'section', title: 'CLASSIFICATION', columns: 3,
      fields: [
        blankLabeled('Incident Type'),
        blankLabeled('Priority'),
        blankLabeled('Status'),
      ],
    },
    {
      kind: 'section', title: 'DATE & TIME', columns: 2,
      fields: [
        blankLabeled('Occurred Date'),
        blankLabeled('Occurred Time'),
        blankLabeled('End Date'),
        blankLabeled('End Time'),
      ],
    },
    {
      kind: 'section', title: 'LOCATION', columns: 1,
      fields: [
        blankLabeled('Location Address'),
      ],
    },
    {
      kind: 'section', title: 'GEOGRAPHY', columns: 3,
      fields: [
        blankLabeled('Section'),
        blankLabeled('Zone'),
        blankLabeled('Beat'),
      ],
    },
    {
      kind: 'section', title: 'SCENE DETAILS', columns: 3,
      fields: [
        blankLabeled('Weather Conditions'),
        blankLabeled('Lighting Conditions'),
        blankLabeled('Weapons Involved'),
        blankLabeled('Damage Estimate'),
        blankLabeled('Injury Description'),
      ],
    },
    // Operational flags — render callback for 4-column checkbox grid
    (ctx, _data) => {
      ctx.section('OPERATIONAL FLAGS', (inner) => {
        const flags = OPERATIONAL_FLAGS;
        for (let i = 0; i < flags.length; i += 4) {
          const row: CheckboxField<IncidentBlankData>[] = [];
          for (let j = 0; j < 4 && i + j < flags.length; j++) {
            row.push(flag(flags[i + j]));
          }
          inner.checkboxRow(row, _data);
        }
        inner.spacer(2);
      });
    },
    {
      kind: 'section', title: 'LINKED RECORDS', columns: 3,
      fields: [
        blankLabeled('Call Number'),
        blankLabeled('Responding LE Agency'),
        blankLabeled('LE Case Number'),
        blankLabeled('Client / Property'),
        blankLabeled('Contract ID'),
        blankLabeled('Disposition'),
      ],
    },
    {
      kind: 'section', title: 'NARRATIVE / REPORT', columns: 1,
      fields: [
        {
          kind: 'narrative',
          label: 'Narrative',
          accessor: () => '',
          minLines: 25,
          editable: false,
        },
      ],
    },
    {
      kind: 'section', title: 'SIGNATURES', columns: 1,
      fields: [
        {
          kind: 'signature',
          label: 'Reporting Officer',
          accessor: () => undefined,
          editable: false,
        },
        {
          kind: 'signature',
          label: 'Supervisor Review',
          accessor: () => undefined,
          editable: false,
        },
      ],
    },
  ],
};
