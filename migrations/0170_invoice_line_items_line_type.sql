-- ============================================================
-- Migration 0170 — invoice_line_items.line_type
-- ============================================================
-- AdminInvoiceTab.tsx has always sent + rendered a per-line-item
-- "type" (custom/labor/parts/etc., via TYPE_ICON lookup) but the
-- column never existed, so every add-line-item call silently
-- dropped it (same class of bug as the internal_notes/notes fix
-- in this same PR). Adding it so it actually persists.
-- ============================================================

ALTER TABLE invoice_line_items ADD COLUMN line_type TEXT DEFAULT 'custom';
