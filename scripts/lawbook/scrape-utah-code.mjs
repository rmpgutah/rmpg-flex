#!/usr/bin/env node
// ============================================================
// RMPG Flex — Utah Code scraper (le.utah.gov → JSONL)
// ------------------------------------------------------------
// Walks the official Utah Code tree and emits one JSON object per section,
// shaped to the utah_statutes columns (migration 0073/0074). This is the
// COMMITTED replacement for the throwaway /tmp/utahcode crawlers that were
// lost after the original 1,705-row seed (see the project-law-book memory).
//
// Tree shape (all fragments are server-rendered HTML, no JS needed):
//   Title{T}/{T}.html                 → has  versionDefault  (current title ver)
//   Title{T}/{titleVer}.html          → #childtbl lists CHAPTERS  (?v= per child)
//   Title{T}/Chapter{C}/C{T}-{C}_{v}.html
//        → #childtbl lists SECTIONS, or PARTS when the chapter is parted
//   Title{T}/Chapter{C}/C{T}-{C}-P{n}_{v}.html
//        → #childtbl lists the part's SECTIONS (or sub-parts)
//   Title{T}/Chapter{C}/C{T}-{C}-S{n}_{v}.html
//        → <div id="secdiv"> holds the verbatim text as a nested <table>
//          whose narrow cells carry the (1)/(a)/(i) markers as LITERAL text,
//          so a strip-tags + whitespace-collapse reproduces the exact inline
//          "(1) (a) …(b) …(2) …" form the existing rows store and the
//          LawBookPage parseOutline() reader already renders.
//
// Version picking: a section can list a current AND a future version. The
// authoritative in-force pick is the section wrapper page's versionDefault
// (NEVER guess by the date pair in the filename — memory recipe warning). We
// only pay that extra fetch when a section advertises >1 version.
//
// Usage:
//   node scrape-utah-code.mjs <titleCode> [--chapters=37,37a] [--category=foo]
//        [--out=path.jsonl] [--label="Display Name"]
//   node scrape-utah-code.mjs --target=77        # use a TARGETS preset
//   node scrape-utah-code.mjs --all-targets      # every preset, sequentially
//
// Output: scripts/lawbook/data/title-<code>[-<chapters>].jsonl  (resumable:
// re-running overwrites; pair with generate-summaries.mjs + build-seed.mjs).
// ============================================================
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://le.utah.gov/xcode';
const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(HERE, 'data');

// The LE-relevant expansion the operator approved. Each preset maps a Utah
// Code title (or a subset of its chapters) to a law-book category.
export const TARGETS = [
  { title: '25',  category: 'fraud',         label: 'Fraud' },
  { title: '77',  category: 'procedure',     label: 'Criminal Procedure' },
  { title: '53',  category: 'public_safety', label: 'Public Safety' },
  { title: '80',  category: 'juvenile',      label: 'Juvenile Justice' },
  { title: '23A', category: 'wildlife',      label: 'Wildlife Resources' },
  { title: '32B', category: 'alcohol',       label: 'Alcoholic Beverage Control' },
  { title: '58',  category: 'controlled',    label: 'Controlled Substances',
    chapters: ['37', '37a', '37b', '37c', '37d', '37e', '37f'] },
  { title: '78B', category: 'protective',    label: 'Protective Orders & Stalking Injunctions',
    chapters: ['7'] },
];

// ── tiny fetch layer: retry + politeness delay ───────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchText(url, { tries = 4, delay = 120 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 30000);
      const res = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'RMPG-Flex-lawbook/1.0' } });
      clearTimeout(t);
      if (res.status === 404) return null;            // missing section — skip
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await sleep(delay);                              // be a polite citizen
      return await res.text();
    } catch (err) {
      lastErr = err;
      await sleep(400 * (i + 1));
    }
  }
  throw new Error(`fetch failed ${url}: ${lastErr?.message}`);
}

// ── HTML helpers (zero-dependency) ───────────────────────────
function decodeEntities(s) {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&sect;/gi, '§');
}
const stripTags = (s) => s.replace(/<[^>]+>/g, ' ');
const collapse = (s) => decodeEntities(stripTags(s)).replace(/\s+/g, ' ').trim();

function getVersionDefault(html) {
  const m = html.match(/versionDefault\s*=\s*"([^"]+)"/);
  return m ? m[1] : null;
}

// Every version token a page advertises (var versionArr = [[file,label,token]…]).
function parseVersionArr(html) {
  return [...html.matchAll(/'(C[\dA-Za-z.\-]+_\d{16})'/g)].map((m) => m[1]);
}

// Effective date of a version token. The 16-digit suffix is
// {enactmentDate}{effectiveDate} — the SECOND 8 digits are the in-force date
// (verified: token …_2026050620270101 is labeled "Effective 1/1/2027", and
// …_2025050720250507 is "Current"). The first 8 (session/enactment date) is a
// red herring — keying on it pulls future versions into an as-of query.
function effDateOf(token) {
  const m = token && token.match(/_\d{8}(\d{8})$/);
  return m ? m[1] : null;
}

// Pick the version in force AS OF a date (YYYYMMDD): the latest effective date
// on or before the cutoff; tie-break to the newest token. This is the
// deliberate "as-of" path — distinct from the default "current today" pick
// which trusts the wrapper's versionDefault — so it captures a future-dated
// (e.g. 7/1/2026) amendment without over-reaching to a still-later one.
function pickVersionAsOf(tokens, asOf) {
  const uniq = [...new Set(tokens.filter(Boolean))];
  if (!uniq.length) return null;
  let best = null;
  let bestKey = '';
  for (const t of uniq) {
    const ed = effDateOf(t);
    if (!ed || ed > asOf) continue;
    const key = `${ed}|${t}`;
    if (key > bestKey) { bestKey = key; best = t; }
  }
  // None in force yet by the cutoff → the earliest (first to take effect).
  return best || uniq.slice().sort((a, b) => (effDateOf(a) || '').localeCompare(effDateOf(b) || ''))[0];
}

// Pull the rows of the #childtbl table → [{ href, label, desc }].
function parseChildtbl(html) {
  const tbl = html.match(/<table id="childtbl">([\s\S]*?)<\/table>/i);
  if (!tbl) return [];
  const rows = [];
  for (const rm of tbl[1].matchAll(/<tr>([\s\S]*?)<\/tr>/gi)) {
    const row = rm[1];
    const a = row.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    // The label/description sit in separate <td>s; grab the LAST td as the
    // human name ("Assault and Related Offenses").
    const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((t) => collapse(t[1]));
    rows.push({ href: a[1], label: collapse(a[2]), desc: tds.length ? tds[tds.length - 1] : '' });
  }
  return rows;
}

// Classify a child href by its filename.
//   76-5-S102.html   → section (n='102')
//   76-5-P1.html     → part    (n='1')
//   76-5.html        → chapter
function classifyChild(href) {
  const file = href.split('?')[0].split('/').pop() || '';
  let m;
  if ((m = file.match(/^(\d+[A-Za-z]?)-([\dA-Za-z]+)-S([\d.]+)\.html$/i))) {
    return { kind: 'section', title: m[1], chapter: m[2], section: m[3] };
  }
  if ((m = file.match(/^(\d+[A-Za-z]?)-([\dA-Za-z]+)-(P[\dA-Za-z]+(?:-P[\dA-Za-z]+)*)\.html$/i))) {
    return { kind: 'part', title: m[1], chapter: m[2], part: m[3] };
  }
  if ((m = file.match(/^(\d+[A-Za-z]?)-([\dA-Za-z]+)\.html$/i))) {
    return { kind: 'chapter', title: m[1], chapter: m[2] };
  }
  return { kind: 'other' };
}

// Extract the version token (C..._16digits) from a child ?v= link.
function versionFromHref(href) {
  const m = href.match(/[?&]v=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// version token → "M/D/YYYY" using the effective date (SECOND 8 digits; see
// effDateOf). The 1800-01-01 sentinel means "in force since before electronic
// records" → no usable date.
function effectiveDateFromVersion(vtoken) {
  const d = effDateOf(vtoken);
  if (!d) return null;
  const y = +d.slice(0, 4);
  if (y < 1900) return null;
  return `${+d.slice(4, 6)}/${+d.slice(6, 8)}/${y}`;
}

// ── secdiv → inline statutory text + catchline ───────────────
function flattenSection(html) {
  const div = html.match(/<div id="secdiv">([\s\S]*?)<\/div>/i);
  if (!div) return null;
  let inner = div[1];

  // The secdiv opens with an optional "<b><i>Effective M/D/YYYY</i></b><br>"
  // banner, then the heading "<b>76-5-102.&nbsp;</b><b>Assault.</b>", and ends
  // with a "<br>Amended by Chapter N, YYYY General Session" footer. The
  // existing 1,705 rows store NONE of those three, so we strip all of them:
  // find the bold whose text reads like the citation, take the next bold as
  // the catchline, and discard everything up through it (which also removes the
  // effective banner that precedes it).
  let citation = null;
  let catchline = '';
  const bolds = [...inner.matchAll(/<b>([\s\S]*?)<\/b>/gi)];
  const citIdx = bolds.findIndex((b) => /^\s*\d+[A-Za-z]?-[\dA-Za-z.-]+\.?\s*$/.test(collapse(b[1])));
  if (citIdx >= 0) {
    citation = collapse(bolds[citIdx][1]).replace(/\.\s*$/, '');
    const catchB = bolds[citIdx + 1];
    catchline = catchB ? collapse(catchB[1]).replace(/\.\s*$/, '') : '';
    const last = catchB || bolds[citIdx];
    inner = inner.slice((last.index ?? 0) + last[0].length);
  }

  // Drop the empty id/name anchors, keep any anchor inner text, then flatten.
  inner = inner
    .replace(/<a\b[^>]*>\s*<\/a>/gi, '')
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1')
    .replace(/<br\s*\/?>/gi, ' ');
  let body = collapse(inner);

  // Strip the source-note footer ("Enacted/Amended/Repealed by Chapter N,
  // YYYY General Session …") — anchored on "General Session" so a stray
  // in-text "amended by" can't trigger it.
  body = body.replace(
    /\s*(?:Enacted|Amended|Repealed|Renumbered|Replaced|Reenacted|Re-enacted|Substituted)\s+by\s+[\s\S]*?\d{4}\s+General Session\b[\s\S]*$/i,
    '',
  ).trim();
  // Belt-and-suspenders: drop a leading "Effective/Superseded/Repealed M/D/YYYY"
  // banner for the rare section with no bold heading to anchor on.
  body = body.replace(/^\s*(?:Effective|Superseded|Repealed)\s+\d{1,2}\/\d{1,2}\/\d{4}\s*/i, '').trim();

  return { citation, catchline, body };
}

// ── offense level detection (most-severe class mentioned) ────
const LEVEL_PATTERNS = [
  ['capital_felony',        /\bcapital felony\b/i],
  ['first_degree_felony',   /\b(?:first degree felony|felony of the first degree)\b/i],
  ['second_degree_felony',  /\b(?:second degree felony|felony of the second degree)\b/i],
  ['third_degree_felony',   /\b(?:third degree felony|felony of the third degree)\b/i],
  ['class_a_misdemeanor',   /\bclass A misdemeanor\b/i],
  ['class_b_misdemeanor',   /\bclass B misdemeanor\b/i],
  ['class_c_misdemeanor',   /\bclass C misdemeanor\b/i],
  ['infraction',            /\binfraction\b/i],
];
// Only penal categories define offenses; procedural/administrative titles
// merely *reference* penalty classes, so tagging them would pollute the
// severity filter + "classified offenses" stat.
const PENAL_CATEGORIES = new Set(['criminal', 'vehicle', 'controlled', 'wildlife', 'alcohol']);
function detectOffenseLevel(text, category) {
  if (!PENAL_CATEGORIES.has(category)) return null;
  for (const [key, re] of LEVEL_PATTERNS) if (re.test(text)) return key;
  return null;
}

// ── recursive collector: a fragment URL → [{ section meta }] ─
async function collectSections(fragUrl, ctx, out) {
  const html = await fetchText(fragUrl);
  if (!html) return;
  for (const child of parseChildtbl(html)) {
    const abs = new URL(child.href, fragUrl).toString();
    const cls = classifyChild(child.href);
    if (cls.kind === 'section') {
      const ver = versionFromHref(child.href);
      const key = `${cls.title}-${cls.chapter}-S${cls.section}`;
      const rec = out.byKey.get(key) || {
        title: cls.title, chapter: cls.chapter, section: cls.section,
        catchline: child.desc || child.label, part_name: ctx.part_name,
        versions: [], wrapper: abs.split('?')[0],
      };
      if (ver) rec.versions.push(ver);
      out.byKey.set(key, rec);
      if (!out.order.includes(key)) out.order.push(key);
    } else if (cls.kind === 'part') {
      // child.href points at the part WRAPPER (JS-driven, no childtbl). The
      // listable content fragment is C{T}-{C}-P{n}_{ver}.html — same trick as
      // the chapter level — so build it from the ?v= token before recursing.
      const ver = versionFromHref(child.href);
      const partFrag = ver ? new URL(`${ver}.html`, abs).toString() : abs;
      await collectSections(partFrag, { ...ctx, part_name: child.desc || child.label }, out);
    }
  }
}

// ── scrape one chapter → section records (with text) ─────────
async function scrapeChapter(titleCode, chapterHref, chapterName, category, asOf) {
  const chapterFragUrl = (() => {
    // chapter child href: Title{T}/Chapter{C}/{T}-{C}.html?v=C{T}-{C}_{ver}
    const vtoken = versionFromHref(chapterHref);
    const wrap = chapterHref.split('?')[0];
    return new URL(`${vtoken}.html`, new URL(wrap, `${BASE}/Title${titleCode}/`)).toString();
  })();

  const collected = { byKey: new Map(), order: [] };
  await collectSections(chapterFragUrl, { part_name: null }, collected);

  const rows = [];
  for (const key of collected.order) {
    const rec = collected.byKey.get(key);
    // Pick the in-force version. With --as-of, choose by date (captures
    // future-dated amendments). Otherwise: unique → use it; ambiguous (a
    // current + future version both listed today) → the wrapper's versionDefault.
    let version;
    if (asOf) {
      version = pickVersionAsOf(rec.versions, asOf);
    } else {
      version = rec.versions[0];
      if (new Set(rec.versions).size > 1) {
        const wrapHtml = await fetchText(rec.wrapper);
        version = (wrapHtml && getVersionDefault(wrapHtml)) || version;
      }
    }
    if (!version) continue;
    const contentUrl = new URL(`${version}.html`, rec.wrapper).toString();
    const secHtml = await fetchText(contentUrl);
    if (!secHtml) continue;
    const flat = flattenSection(secHtml);
    if (!flat || !flat.body) continue;

    const citation = flat.citation || `${rec.title}-${rec.chapter}-${rec.section}`;
    const [tCode, cCode, ...secParts] = citation.split('-');
    const sectionNo = secParts.join('-');
    rows.push({
      title: parseInt(tCode, 10),
      chapter: parseInt(cCode, 10) || null,
      chapter_code: cCode,
      section: sectionNo,
      subsection: null,
      citation,
      short_title: flat.catchline || rec.catchline || citation,
      description: flat.body,
      offense_level: detectOffenseLevel(flat.body, category),
      category,
      subcategory: chapterName,
      part_name: rec.part_name && rec.part_name !== chapterName ? rec.part_name : null,
      code_type: 'statute',
      effective_date: effectiveDateFromVersion(version),
      source_url: `${BASE}/Title${tCode}/Chapter${cCode}/${tCode}-${cCode}-S${sectionNo}.html`,
      citation_fine: null,
    });
  }
  return rows;
}

// ── scrape a whole title (optionally a chapter subset) ───────
async function scrapeTitle({ title, category, chapters, label, asOf }) {
  const landing = await fetchText(`${BASE}/Title${title}/${title}.html`);
  if (!landing) throw new Error(`Title ${title} landing not found`);
  // As-of: pick the title-structure version effective ≤ cutoff (so a new chapter
  // added by a 7/1 bill is enumerated). Otherwise the current versionDefault.
  const titleVer = (asOf ? pickVersionAsOf(parseVersionArr(landing), asOf) : null)
    || getVersionDefault(landing);
  if (!titleVer) throw new Error(`Title ${title} has no versionDefault`);

  const titleFrag = await fetchText(`${BASE}/Title${title}/${titleVer}.html`);
  const chapterRows = parseChildtbl(titleFrag).filter((r) => classifyChild(r.href).kind === 'chapter');
  const wanted = chapters ? new Set(chapters.map((c) => c.toLowerCase())) : null;

  const all = [];
  for (const ch of chapterRows) {
    const cls = classifyChild(ch.href);
    if (wanted && !wanted.has(cls.chapter.toLowerCase())) continue;
    process.stderr.write(`  · ${label || title} — chapter ${cls.chapter} (${ch.desc})\n`);
    const rows = await scrapeChapter(title, ch.href, ch.desc || ch.label, category, asOf);
    process.stderr.write(`      ${rows.length} sections\n`);
    all.push(...rows);
  }
  return all;
}

// ── CLI ──────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { _: [] };
  for (const tok of argv) {
    const m = tok.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) a[m[1]] = m[2] === undefined ? true : m[2];
    else a._.push(tok);
  }
  return a;
}

async function run(job) {
  process.stderr.write(`▶ scraping Title ${job.title}${job.chapters ? ` ch ${job.chapters.join(',')}` : ''}${job.asOf ? ` as-of ${job.asOf}` : ''} → ${job.category}\n`);
  const rows = await scrapeTitle(job);
  await mkdir(DATA_DIR, { recursive: true });
  const suffix = job.chapters ? `-${job.chapters.join('_')}` : '';
  const outPath = job.out ? resolve(process.cwd(), job.out) : resolve(DATA_DIR, `title-${job.title}${suffix}.jsonl`);
  await writeFile(outPath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  process.stderr.write(`✔ ${rows.length} sections → ${outPath}\n`);
  return rows.length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args['all-targets']) {
    let total = 0;
    for (const t of TARGETS) total += await run(t);
    process.stderr.write(`\n══ done: ${total} sections across ${TARGETS.length} targets\n`);
    return;
  }
  if (args.target) {
    const t = TARGETS.find((x) => x.title.toLowerCase() === String(args.target).toLowerCase());
    if (!t) throw new Error(`no TARGETS preset for ${args.target}`);
    await run({ ...t, out: args.out });
    return;
  }
  const title = args._[0];
  if (!title) {
    process.stderr.write('usage: node scrape-utah-code.mjs <titleCode> [--chapters=..] [--category=..] | --target=77 | --all-targets\n');
    process.exit(1);
  }
  await run({
    title,
    category: args.category || 'misc',
    label: args.label,
    chapters: args.chapters ? String(args.chapters).split(',').map((s) => s.trim()) : undefined,
    asOf: args['as-of'] ? String(args['as-of']).replace(/-/g, '') : undefined,
    out: args.out,
  });
}

main().catch((err) => { process.stderr.write(`✖ ${err.stack || err}\n`); process.exit(1); });
