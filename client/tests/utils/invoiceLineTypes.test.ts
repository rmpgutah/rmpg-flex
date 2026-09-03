import { describe, it, expect } from 'vitest';
import { INVOICE_LINE_TYPES, INVOICE_LINE_TYPE_LABELS } from '../../src/utils/invoiceLineTypes';

describe('invoice line types', () => {
  it('offers PSO Client Request as a billable line', () => {
    expect(INVOICE_LINE_TYPES.some((t) => t.value === 'pso_client_request')).toBe(true);
    expect(INVOICE_LINE_TYPE_LABELS.pso_client_request).toBe('PSO Client Request');
  });
});
