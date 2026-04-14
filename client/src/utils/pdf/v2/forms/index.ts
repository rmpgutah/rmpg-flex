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
