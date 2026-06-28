-- 0089: Admin-editable Doc Writer letterhead (Admin → Settings → documents).
-- Read by the client at template-insert time (GET /admin/settings/values);
-- blank tagline/address drops that line from the letterhead entirely.
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, ui_order) VALUES
  ('documents', 'doc_header_org_name', 'ROCKY MOUNTAIN PROTECTIVE GROUP', 'text', 'Letterhead — Organization Name', 'Top line of the document letterhead (rendered in tracked caps).', 1),
  ('documents', 'doc_header_tagline', 'Private Security &middot; Process Service', 'text', 'Letterhead — Tagline', 'Second letterhead line. Leave blank to omit. Use &middot; between terms.', 2),
  ('documents', 'doc_header_address', 'Salt Lake City, Utah &middot; rmpgutah.us', 'text', 'Letterhead — Address Line', 'Third letterhead line. Leave blank to omit.', 3);
