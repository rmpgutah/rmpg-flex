import type { FormSchema } from '../engine/types';

const registry: Record<string, FormSchema<any>> = {};

export function registerV2Schema(formType: string, schema: FormSchema<any>): void {
  registry[formType] = schema;
}

export function getV2Schema(formType: string): FormSchema<any> {
  const s = registry[formType];
  if (!s) throw new Error(`No v2 schema registered for form: ${formType}`);
  return s;
}

import { incidentBlankSchema } from '../blankForms/incidentBlank';
registerV2Schema('incident_blank', incidentBlankSchema);

import { personBlankSchema } from '../blankForms/personBlank';
registerV2Schema('person_blank', personBlankSchema);

import { vehicleBlankSchema } from '../blankForms/vehicleBlank';
registerV2Schema('vehicle_blank', vehicleBlankSchema);

import { propertyBlankSchema } from '../blankForms/propertyBlank';
registerV2Schema('property_blank', propertyBlankSchema);

import { citationBlankSchema } from '../blankForms/citationBlank';
registerV2Schema('citation_blank', citationBlankSchema);

import { fieldInterviewBlankSchema } from '../blankForms/fieldInterviewBlank';
registerV2Schema('field_interview_blank', fieldInterviewBlankSchema);
