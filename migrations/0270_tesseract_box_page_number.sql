-- migrations/0270_tesseract_box_page_number.sql
-- Box annotations are in original-image pixel space. Serve-intake documents
-- are almost all multi-page PDFs, so a box without a page number cannot be
-- mapped back onto the page an operator actually marked. Default 1 keeps
-- existing (image / single-page) rows valid.
ALTER TABLE tesseract_box_annotations ADD COLUMN page_number INTEGER NOT NULL DEFAULT 1;
