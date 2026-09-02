-- ============================================================
-- Migration 0275 — invoice billing-period + PSO line-item links
-- ============================================================
-- InvoicesPage / AdminInvoiceTab collect period_start / period_end /
-- internal_notes, but those columns never existed on `invoices`, so
-- create + generate silently dropped them. Line items already have
-- line_type (0170); add linked_entity_* so a PSO Client Request line
-- can point at the originating CFS and not be billed twice.
-- D1 has no IF NOT EXISTS on ADD COLUMN — re-apply may fail; the
-- billing route reconciles the same columns at boot.
-- ============================================================

ALTER TABLE invoices ADD COLUMN period_start TEXT;
ALTER TABLE invoices ADD COLUMN period_end TEXT;
ALTER TABLE invoices ADD COLUMN internal_notes TEXT;

ALTER TABLE invoice_line_items ADD COLUMN linked_entity_type TEXT;
ALTER TABLE invoice_line_items ADD COLUMN linked_entity_id INTEGER;
