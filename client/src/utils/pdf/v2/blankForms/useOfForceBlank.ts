import type { FormSchema, LabeledField, NarrativeField, SignatureField, CheckboxField } from '../engine/types';

export type UseOfForceBlankData = Record<string, never>;

function blankLabeled(label: string): LabeledField<UseOfForceBlankData> {
  return { kind: 'labeled', label, accessor: () => '', editable: false };
}

function flag(label: string): CheckboxField<UseOfForceBlankData> {
  return { kind: 'checkbox', label, accessor: () => false, editable: false };
}

export const useOfForceBlankSchema: FormSchema<UseOfForceBlankData> = {
  meta: {
    formNumber: 'PS-216-BLK',
    title: 'USE OF FORCE REPORT',
    revision: '2026-06',
  },
  header: { kind: 'default', formId: 'use_of_force_blank' },
  watermark: 'blank-form',
  sections: [
    {
      kind: 'section', title: 'INCIDENT INFORMATION', columns: 2,
      fields: [
        blankLabeled('Incident Report Number'),
        blankLabeled('Date of Incident'),
        blankLabeled('Time of Incident'),
        blankLabeled('Location of Incident'),
      ],
    },
    {
      kind: 'section', title: 'REPORTING OFFICER', columns: 2,
      fields: [
        blankLabeled('Officer Name'),
        blankLabeled('Badge Number'),
        blankLabeled('Unit / Assignment'),
        blankLabeled('Years of Service'),
      ],
    },
    {
      kind: 'section', title: 'SUBJECT INFORMATION', columns: 2,
      fields: [
        blankLabeled('Subject Name'),
        blankLabeled('Date of Birth'),
        blankLabeled('Gender'),
        blankLabeled('Race'),
      ],
    },
    {
      kind: 'section', title: 'SUBJECT PHYSICAL', columns: 2,
      fields: [
        blankLabeled('Height'),
        blankLabeled('Weight'),
        blankLabeled('Build'),
        blankLabeled('Clothing Description'),
      ],
    },
    {
      kind: 'section', title: 'FORCE TYPE', columns: 3,
      fields: [
        flag('Physical Control'),
        flag('Empty Hand'),
        flag('Less-Lethal'),
        flag('Firearm'),
        flag('K-9'),
        flag('Chemical Agent'),
        flag('Electronic Control'),
        flag('Impact Weapon'),
        flag('Vehicle Intervention'),
      ],
    },
    {
      kind: 'section', title: 'FORCE DETAILS', columns: 2,
      fields: [
        blankLabeled('Force Used'),
        blankLabeled('Body Area Targeted'),
        blankLabeled('Number of Strikes'),
        blankLabeled('Duration of Force'),
      ],
    },
    {
      kind: 'section', title: 'SUBJECT INJURIES', columns: 2,
      fields: [
        blankLabeled('Injuries Sustained'),
        blankLabeled('Medical Treatment Required'),
        blankLabeled('EMS Called'),
        blankLabeled('Transported To'),
      ],
    },
    {
      kind: 'section', title: 'OFFICER INJURIES', columns: 2,
      fields: [
        blankLabeled('Officer Injuries'),
        blankLabeled('Medical Treatment Received'),
      ],
    },
    {
      kind: 'section', title: 'WITNESSES', columns: 2,
      fields: [
        blankLabeled('Witness 1 Name'),
        blankLabeled('Witness 1 Statement'),
        blankLabeled('Witness 2 Name'),
        blankLabeled('Witness 2 Statement'),
      ],
    },
    {
      kind: 'section', title: 'WEAPONS', columns: 2,
      fields: [
        blankLabeled('Subject Weapon'),
        blankLabeled('Weapon Description'),
        blankLabeled('Weapon Disposition'),
        blankLabeled('Evidence Reference'),
      ],
    },
    {
      kind: 'section', title: 'FORCE JUSTIFICATION', columns: 1,
      fields: [
        blankLabeled('Reason for Force'),
      ],
    },
    {
      kind: 'section', title: 'FORCE EVALUATION', columns: 2,
      fields: [
        flag('Within Policy'),
        flag('Exceeds Policy'),
        flag('Pending Review'),
        flag('De-escalation Attempted'),
      ],
    },
    {
      kind: 'section', title: 'NARRATIVE', columns: 1,
      fields: [
        {
          kind: 'narrative',
          label: 'Use of Force Narrative',
          accessor: () => '',
          minLines: 20,
          editable: false,
        } as NarrativeField<UseOfForceBlankData>,
      ],
    },
    {
      kind: 'section', title: 'SIGNATURES', columns: 2,
      fields: [
        {
          kind: 'signature',
          label: 'Reporting Officer',
          accessor: () => undefined,
          editable: false,
        } as SignatureField<UseOfForceBlankData>,
        {
          kind: 'signature',
          label: 'Supervisor Review',
          accessor: () => undefined,
          editable: false,
        } as SignatureField<UseOfForceBlankData>,
      ],
    },
  ],
};
