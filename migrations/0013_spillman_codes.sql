-- 0013_spillman_codes.sql
-- Rename sector codes to Spillman-style <prefix>1 and strip zone prefix from beat codes.
-- Sectors renamed: 29
-- Beat codes: strip everything before and including '/' (SLA/A1 -> A1, LOG/B3 -> B3)
-- Sync calls_for_service.sector_id/beat_id to match (1 row affected)
-- Clear calls_for_service.dispatch_code to force recomputation on next save

-- ── Sectors (29 UPDATEs) ──
UPDATE dispatch_sectors SET sector_code = 'BV1' WHERE sector_code = 'BVR';
UPDATE dispatch_sectors SET sector_code = 'BE1' WHERE sector_code = 'BXE';
UPDATE dispatch_sectors SET sector_code = 'CA1' WHERE sector_code = 'CCH';
UPDATE dispatch_sectors SET sector_code = 'CB1' WHERE sector_code = 'CRB';
UPDATE dispatch_sectors SET sector_code = 'DG1' WHERE sector_code = 'DGT';
UPDATE dispatch_sectors SET sector_code = 'DA1' WHERE sector_code = 'DVS';
UPDATE dispatch_sectors SET sector_code = 'DU1' WHERE sector_code = 'DCH';
UPDATE dispatch_sectors SET sector_code = 'EM1' WHERE sector_code = 'EMR';
UPDATE dispatch_sectors SET sector_code = 'GA1' WHERE sector_code = 'GRF';
UPDATE dispatch_sectors SET sector_code = 'GR1' WHERE sector_code = 'GRD';
UPDATE dispatch_sectors SET sector_code = 'IR1' WHERE sector_code = 'IRN';
UPDATE dispatch_sectors SET sector_code = 'JU1' WHERE sector_code = 'JUB';
UPDATE dispatch_sectors SET sector_code = 'KA1' WHERE sector_code = 'KNE';
UPDATE dispatch_sectors SET sector_code = 'MI1' WHERE sector_code = 'MLD';
UPDATE dispatch_sectors SET sector_code = 'MO1' WHERE sector_code = 'MRG';
UPDATE dispatch_sectors SET sector_code = 'PI1' WHERE sector_code = 'PUT';
UPDATE dispatch_sectors SET sector_code = 'RI1' WHERE sector_code = 'RCH';
UPDATE dispatch_sectors SET sector_code = 'SL1' WHERE sector_code = 'SLC';
UPDATE dispatch_sectors SET sector_code = 'SJ1' WHERE sector_code = 'SJN';
UPDATE dispatch_sectors SET sector_code = 'SP1' WHERE sector_code = 'SNP';
UPDATE dispatch_sectors SET sector_code = 'SE1' WHERE sector_code = 'SVR';
UPDATE dispatch_sectors SET sector_code = 'SU1' WHERE sector_code = 'SMT';
UPDATE dispatch_sectors SET sector_code = 'TO1' WHERE sector_code = 'TOO';
UPDATE dispatch_sectors SET sector_code = 'UI1' WHERE sector_code = 'UNT';
UPDATE dispatch_sectors SET sector_code = 'UT1' WHERE sector_code = 'UTC';
UPDATE dispatch_sectors SET sector_code = 'WS1' WHERE sector_code = 'WSC';
UPDATE dispatch_sectors SET sector_code = 'WA1' WHERE sector_code = 'WSH';
UPDATE dispatch_sectors SET sector_code = 'WY1' WHERE sector_code = 'WYN';
UPDATE dispatch_sectors SET sector_code = 'WB1' WHERE sector_code = 'WBR';

-- ── Sync calls_for_service.sector_id ──
UPDATE calls_for_service SET sector_id = 'BV1' WHERE sector_id = 'BVR';
UPDATE calls_for_service SET sector_id = 'BE1' WHERE sector_id = 'BXE';
UPDATE calls_for_service SET sector_id = 'CA1' WHERE sector_id = 'CCH';
UPDATE calls_for_service SET sector_id = 'CB1' WHERE sector_id = 'CRB';
UPDATE calls_for_service SET sector_id = 'DG1' WHERE sector_id = 'DGT';
UPDATE calls_for_service SET sector_id = 'DA1' WHERE sector_id = 'DVS';
UPDATE calls_for_service SET sector_id = 'DU1' WHERE sector_id = 'DCH';
UPDATE calls_for_service SET sector_id = 'EM1' WHERE sector_id = 'EMR';
UPDATE calls_for_service SET sector_id = 'GA1' WHERE sector_id = 'GRF';
UPDATE calls_for_service SET sector_id = 'GR1' WHERE sector_id = 'GRD';
UPDATE calls_for_service SET sector_id = 'IR1' WHERE sector_id = 'IRN';
UPDATE calls_for_service SET sector_id = 'JU1' WHERE sector_id = 'JUB';
UPDATE calls_for_service SET sector_id = 'KA1' WHERE sector_id = 'KNE';
UPDATE calls_for_service SET sector_id = 'MI1' WHERE sector_id = 'MLD';
UPDATE calls_for_service SET sector_id = 'MO1' WHERE sector_id = 'MRG';
UPDATE calls_for_service SET sector_id = 'PI1' WHERE sector_id = 'PUT';
UPDATE calls_for_service SET sector_id = 'RI1' WHERE sector_id = 'RCH';
UPDATE calls_for_service SET sector_id = 'SL1' WHERE sector_id = 'SLC';
UPDATE calls_for_service SET sector_id = 'SJ1' WHERE sector_id = 'SJN';
UPDATE calls_for_service SET sector_id = 'SP1' WHERE sector_id = 'SNP';
UPDATE calls_for_service SET sector_id = 'SE1' WHERE sector_id = 'SVR';
UPDATE calls_for_service SET sector_id = 'SU1' WHERE sector_id = 'SMT';
UPDATE calls_for_service SET sector_id = 'TO1' WHERE sector_id = 'TOO';
UPDATE calls_for_service SET sector_id = 'UI1' WHERE sector_id = 'UNT';
UPDATE calls_for_service SET sector_id = 'UT1' WHERE sector_id = 'UTC';
UPDATE calls_for_service SET sector_id = 'WS1' WHERE sector_id = 'WSC';
UPDATE calls_for_service SET sector_id = 'WA1' WHERE sector_id = 'WSH';
UPDATE calls_for_service SET sector_id = 'WY1' WHERE sector_id = 'WYN';
UPDATE calls_for_service SET sector_id = 'WB1' WHERE sector_id = 'WBR';

-- ── Beats: strip '<zone>/' prefix from beat_code (719 rows) ──
UPDATE dispatch_beats SET beat_code = SUBSTR(beat_code, INSTR(beat_code, '/') + 1)
WHERE INSTR(beat_code, '/') > 0;

-- ── Sync calls_for_service.beat_id (strip same prefix) ──
UPDATE calls_for_service SET beat_id = SUBSTR(beat_id, INSTR(beat_id, '/') + 1)
WHERE beat_id IS NOT NULL AND INSTR(beat_id, '/') > 0;

-- ── Clear stale dispatch_code so it re-derives from new sector/zone/beat ──
-- (PUT /calls/:id rewrites this from current sector_id/zone_id/beat_id values)
UPDATE calls_for_service SET dispatch_code = NULL WHERE dispatch_code IS NOT NULL;
