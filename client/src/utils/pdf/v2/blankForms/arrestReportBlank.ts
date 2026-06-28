import type { FormSchema, LabeledField, NarrativeField, SignatureField, CheckboxField } from '../engine/types';

export type ArrestReportBlankData = Record<string, never>;

function blankLabeled(label: string): LabeledField<ArrestReportBlankData> {
  return { kind: 'labeled', label, accessor: () => '', editable: false };
}

function flag(label: string): CheckboxField<ArrestReportBlankData> {
  return { kind: 'checkbox', label, accessor: () => false, editable: false };
}

export const arrestReportBlankSchema: FormSchema<ArrestReportBlankData> = {
  meta: {
    formNumber: 'PS-215-BLK',
    title: 'ARREST REPORT',
    revision: '2026-06',
  },
  header: { kind: 'default', formId: 'arrest_report_blank' },
  watermark: 'blank-form',
  sections: [
    {
      kind: 'section', title: 'ARREST INFORMATION', columns: 2,
      fields: [
        blankLabeled('Arrest Report Number'),
        blankLabeled('Arrest Date'),
        blankLabeled('Arrest Time'),
        blankLabeled('Arrest Location'),
      ],
    },
    {
      kind: 'section', title: 'ARRESTING OFFICER', columns: 2,
      fields: [
        blankLabeled('Officer Name'),
        blankLabeled('Badge Number'),
        blankLabeled('Unit / Assignment'),
        blankLabeled('Radio Call Sign'),
      ],
    },
    {
      kind: 'section', title: 'ARRESTEE INFORMATION', columns: 2,
      fields: [
        blankLabeled('Last Name'),
        blankLabeled('First Name'),
        blankLabeled('Middle Name'),
        blankLabeled('Date of Birth'),
      ],
    },
    {
      kind: 'section', title: 'ARRESTEE PHYSICAL', columns: 2,
      fields: [
        blankLabeled('Gender'),
        blankLabeled('Race'),
        blankLabeled('Height'),
        blankLabeled('Weight'),
      ],
    },
    {
      kind: 'section', title: 'ARRESTEE IDENTIFICATION', columns: 2,
      fields: [
        blankLabeled('DL Number'),
        blankLabeled('DL State'),
        blankLabeled('SSN (Last 4)'),
        blankLabeled('Alien Registration'),
      ],
    },
    {
      kind: 'section', title: 'ADDRESS', columns: 1,
      fields: [
        blankLabeled('Street Address'),
      ],
    },
    {
      kind: 'section', title: 'CITY / STATE / ZIP', columns: 3,
      fields: [
        blankLabeled('City'),
        blankLabeled('State'),
        blankLabeled('ZIP'),
      ],
    },
    {
      kind: 'section', title: 'CHARGES', columns: 2,
      fields: [
        blankLabeled('Charge 1 — Statute'),
        blankLabeled('Charge 1 — Description'),
        blankLabeled('Charge 1 — Offense Level'),
        blankLabeled('Charge 1 — Bond Amount'),
        blankLabeled('Charge 2 — Statute'),
        blankLabeled('Charge 2 — Description'),
      ],
    },
    {
      kind: 'section', title: 'ARREST CIRCUMSTANCES', columns: 1,
      fields: [
        blankLabeled('Probable Cause Summary'),
      ],
    },
    {
      kind: 'section', title: 'ARREST FLAGS', columns: 3,
      fields: [
        flag('Resisting Arrest'),
        flag('Use of Force'),
        flag('Injuries Sustained'),
        flag('Weapon Seized'),
        flag('Miranda Given'),
        flag('Juvenile'),
      ],
    },
    {
      kind: 'section', title: 'VEHICLE INFORMATION', columns: 2,
      fields: [
        blankLabeled('Vehicle Plate'),
        blankLabeled('Vehicle Description'),
        blankLabeled('Vehicle Impounded'),
        blankLabeled('Impound Location'),
      ],
    },
    {
      kind: 'section', title: 'PROCESSING', columns: 2,
      fields: [
        blankLabeled('Booking Officer'),
        blankLabeled('Booking Facility'),
        blankLabeled('Booking Date/Time'),
        blankLabeled('Fingerprint Status'),
      ],
    },
    {
      kind: 'section', title: 'NARRATIVE', columns: 1,
      fields: [
        {
          kind: 'narrative',
          label: 'Arrest Narrative',
          accessor: () => '',
          minLines: 20,
          editable: false,
        } as NarrativeField<ArrestReportBlankData>,
      ],
    },
    {
      kind: 'section', title: 'SIGNATURES', columns: 2,
      fields: [
        {
          kind: 'signature',
          label: 'Arresting Officer',
          accessor: () => undefined,
          editable: false,
        } as SignatureField<ArrestReportBlankData>,
        {
          kind: 'signature',
          label: 'Supervisor Approval',
          accessor: () => undefined,
          editable: false,
        } as SignatureField<ArrestReportBlankData>,
      ],
    },
  ],
};
