// One-off remediation: recompute DERIVED trust for cpg_dashcam alpr_captures and
// build a single UPDATE that overwrites the fabricated model self-report
// (confidence/plate_confidence) with the real trustScore, and demotes the
// falsely auto-accepted rows. HUMAN decisions ('confirmed'/'rejected') are left
// untouched. Mirrors src/utils/plateTrust.ts exactly (validated against its tests).

const AMBIGUITY = { O: '0', I: '1', S: '5', B: '8', Z: '2' };
function normalizePlate(raw) {
  const cleaned = (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return cleaned.replace(/[OISBZ]/g, (c) => AMBIGUITY[c] ?? c);
}
const PLATE_FORMATS = [
  { code: 'UT', regex: /^[A-Z]\d{2}[A-Z]{2}$|^\d{3}[A-Z]{3}$/ },
  { code: 'CA', regex: /^\d[A-Z]{3}\d{3}$/ },
  { code: 'AZ', regex: /^[A-Z]{3}\d{4}$/ },
  { code: 'NV', regex: /^\d{3}[A-Z]\d{2}$|^[A-Z]{3}\d{3}$/ },
  { code: 'ID', regex: /^[A-Z]\d{6}$|^\d[A-Z]\d{5}$/ },
  { code: 'WY', regex: /^\d{1,2}-?\d{3,5}$/ },
];
function formatScore(rawPlate) {
  const plate = (rawPlate ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/[OISBZ]/g, (ch) => AMBIGUITY[ch] ?? ch);
  if (plate.length < 2) return 0.1;
  for (const f of PLATE_FORMATS) if (f.regex.test(plate)) return 0.95;
  return /^[A-Z0-9]{5,8}$/.test(plate) ? 0.5 : 0.2;
}
function trustSingle(plate, modelPct) {
  const fmt = formatScore(plate);
  const m = modelPct == null ? 0 : (modelPct > 1 ? modelPct / 100 : modelPct);
  let score = 0.45 + 0.20 * fmt + 0.05 * Math.max(0, Math.min(1, m));
  score = Math.min(score, 0.84);              // single read cap
  return Number(Math.max(0, Math.min(1, score)).toFixed(3));
}

// Rows pulled from live D1 (cpg_dashcam captures with a plate).
const rows = [
  [17,'NOTLEGIBLE',0.5,'rejected'],[19,'NOTLEGIBLE',0.5,'rejected'],[20,'NOTLEGIBLE',0.5,'rejected'],
  [57,'6CJH444',1,'accepted'],[71,'AZ',0.5,'rejected'],[73,'6KJL345',0.8,'confirmed'],[84,'6CJH38',1,'accepted'],
  [86,'6LXK349',1,'accepted'],[95,'8KJ345',0.8,'rejected'],[97,'KJH123',0.8,'needs_review'],[98,'6LJH884',1,'accepted'],
  [100,'5GND',0.8,'needs_review'],[102,'6KJ345',1,'accepted'],[103,'6CJGK3',1,'accepted'],[112,'5J4KJU',1,'accepted'],
  [113,'5GKJ349',1,'accepted'],[114,'63',0.8,'rejected'],[116,'63',0.8,'rejected'],[122,'6KJ345',1,'accepted'],
  [123,'6KJ345',1,'accepted'],[124,'6KJ345',1,'accepted'],[130,'6JGK345',1,'accepted'],[131,'6CJH345',0.8,'needs_review'],
  [133,'5264AN',0.8,'confirmed'],[134,'NISSAN',1,'accepted'],[137,'6HJX445',1,'accepted'],[139,'6LXK',1,'accepted'],
  [140,'KJF345',1,'accepted'],[142,'63',0.8,'needs_review'],[143,'6KJG345',1,'accepted'],[144,'5KJH345',1,'accepted'],
  [148,'5JGZ629',1,'accepted'],[149,'5JGZ629',1,'accepted'],[152,'5KJF345',1,'accepted'],[153,'5T34K7',1,'accepted'],
  [156,'6CJ3K7',1,'accepted'],[157,'4GKJ345',1,'accepted'],[162,'6CJ4K7',1,'accepted'],[163,'6CJ5K7',1,'accepted'],
  [165,'KJH345',1,'accepted'],[166,'GZP345',1,'accepted'],[168,'UT15',0.5,'rejected'],[171,'AZ12345',0.8,'needs_review'],
  [172,'AZ12345',0.8,'rejected'],[173,'AZ12345',1,'accepted'],[176,'6LJH384',1,'accepted'],[180,'6KJ4L5',1,'accepted'],
  [181,'6KJ4L5',1,'accepted'],[187,'8KJ345',1,'accepted'],[190,'6KJF345',0.8,'needs_review'],[191,'6KJ3L8',1,'accepted'],
  [192,'6CJN394',1,'accepted'],[193,'4GKJ345',0.8,'needs_review'],[196,'KJH345',0.8,'rejected'],
];

// Touch only rows whose status was NOT a human decision (leave 'confirmed'/'rejected').
const touch = rows.filter(([, , , st]) => st === 'accepted' || st === 'needs_review');
const confCase = [], demoteIds = [];
for (const [id, plate, modelPct, st] of touch) {
  const d = trustSingle(plate, modelPct);
  confCase.push(`WHEN ${id} THEN ${d}`);
  if (st === 'accepted') demoteIds.push(id);   // false auto-accept → needs_review
}
const ids = touch.map((r) => r[0]);
const sql =
`UPDATE alpr_captures SET
  confidence = CASE id ${confCase.join(' ')} END,
  plate_confidence = CASE id ${confCase.join(' ')} END,
  accepted = CASE WHEN id IN (${demoteIds.join(',')}) THEN 0 ELSE accepted END,
  review_status = CASE WHEN id IN (${demoteIds.join(',')}) THEN 'needs_review' ELSE review_status END
WHERE id IN (${ids.join(',')});`;

console.log(`-- rows touched: ${touch.length} (demoted false-accepts: ${demoteIds.length})`);
console.log(`-- demoted ids: ${demoteIds.join(',')}`);
console.log(sql);
