// Shared invoice line-item types for InvoicesPage + AdminInvoiceTab.
// Keep this list in sync with POST /billing/invoices/:id/items.

export const INVOICE_LINE_TYPES = [
  { value: 'custom', label: 'Custom' },
  { value: 'pso_client_request', label: 'PSO Client Request' },
  { value: 'contract_base', label: 'Contract Base' },
  { value: 'service_hours', label: 'Service Hours' },
  { value: 'dispatch_call', label: 'Dispatch Call' },
  { value: 'incident_response', label: 'Incident Response' },
  { value: 'citation', label: 'Citation' },
  { value: 'late_fee', label: 'Late Fee' },
  { value: 'discount', label: 'Discount' },
] as const;

export const INVOICE_LINE_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  INVOICE_LINE_TYPES.map((t) => [t.value, t.label]),
);
