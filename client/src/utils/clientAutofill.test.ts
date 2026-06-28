import { describe, it, expect } from 'vitest';
import { autofillFromClient, applyFillBlanks } from './clientAutofill';

const client = {
  id: '7', name: 'ICU Investigations, LLC.', contact_name: 'Jane Doe',
  contact_phone: '(435) 976-1200', contact_email: 'a1@example.com',
  address: '250 N Red Cliffs Dr', client_code: '0175',
  contracts: [{ id: 99 }],
};

describe('autofillFromClient', () => {
  it('maps client fields to call fields', () => {
    const patch = autofillFromClient(client as any);
    expect(patch.caller_name).toBe('Jane Doe');
    expect(patch.caller_phone).toBe('(435) 976-1200');
    expect(patch.pso_requestor_email).toBe('a1@example.com');
    expect(patch.pso_billing_code).toBe('0175');
    expect(patch.caller_relationship).toBe('client');
  });
});

describe('applyFillBlanks', () => {
  it('fills only blank fields, never overwrites', () => {
    const current = { caller_name: 'Typed Already', caller_phone: '' };
    const next = applyFillBlanks(current, { caller_name: 'Jane Doe', caller_phone: '(435) 976-1200' });
    expect(next.caller_name).toBe('Typed Already'); // preserved
    expect(next.caller_phone).toBe('(435) 976-1200'); // filled
  });
});
