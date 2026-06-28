#!/usr/bin/env node
// ============================================================
// RMPG Flex — Jail Scraper Runner (external, Playwright)
// ============================================================
// Drives JS-rendered Utah county jail portals (which the Cloudflare
// Worker can't) and POSTs structured bookings into the intel pipeline
// (POST /api/intel/jail/ingest-bookings → cross-hit). Run on a Mac, a
// VPS, or via cron/launchd. Per-county isolation; --dry-run prints only.
//
// Env:
//   RMPG_API   (default https://api.rmpgutah.us)
//   RMPG_JWT   a valid bearer token, OR
//   RMPG_USER + RMPG_PASS  (the runner logs in to get a token)
//
// Usage:
//   node index.mjs              # scrape all enabled counties + post
//   node index.mjs --dry-run    # scrape + print, no POST
//   node index.mjs --only ut-davis
// ============================================================
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { usableBookings } from './lib/extract.mjs';

const API = process.env.RMPG_API || 'https://api.rmpgutah.us';
const DRY = process.argv.includes('--dry-run');
const onlyIdx = process.argv.indexOf('--only');
const ONLY = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;
const DELAY_MS = 4000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getToken() {
  if (process.env.RMPG_JWT) return process.env.RMPG_JWT;
  const user = process.env.RMPG_USER, pass = process.env.RMPG_PASS;
  if (!user || !pass) throw new Error('Set RMPG_JWT, or RMPG_USER + RMPG_PASS');
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass }),
  });
  if (!res.ok) throw new Error(`login failed: HTTP ${res.status}`);
  const j = await res.json();
  if (!j.token) throw new Error('login returned no token');
  return j.token;
}

async function scrapeCounty(browser, cfg) {
  const page = await browser.newPage();
  try {
    await page.goto(cfg.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (cfg.waitFor) await page.waitForSelector(cfg.waitFor, { timeout: 15000 }).catch(() => {});
    const sel = cfg.selectors;
    const rows = await page.$$eval(sel.row, (els, sel) => els.map((el) => {
      const pick = (s) => (s && el.querySelector(s) ? el.querySelector(s).textContent : null);
      return {
        name: pick(sel.name),
        dob: pick(sel.dob),
        bookingDate: pick(sel.bookingDate),
        charges: pick(sel.charges),
        bookingId: pick(sel.bookingId),
        mugshot: sel.mugshot && el.querySelector(sel.mugshot) ? el.querySelector(sel.mugshot).getAttribute('src') : null,
        detail: sel.detail && el.querySelector(sel.detail) ? el.querySelector(sel.detail).getAttribute('href') : null,
      };
    }), sel);
    return usableBookings(rows, cfg.county);
  } finally {
    await page.close();
  }
}

async function postBookings(token, sourceKey, bookings) {
  const res = await fetch(`${API}/api/intel/jail/ingest-bookings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ source_key: sourceKey, bookings }),
  });
  if (!res.ok) throw new Error(`ingest failed: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
  return res.json();
}

async function main() {
  const { counties } = JSON.parse(await readFile(new URL('./counties.json', import.meta.url)));
  const enabled = counties.filter((c) => c.enabled && (!ONLY || c.key === ONLY));
  if (!enabled.length) {
    console.log('No enabled counties (set enabled:true in counties.json after verifying selectors).');
    return;
  }
  const token = DRY ? 'dry-run' : await getToken();
  const browser = await chromium.launch({ headless: true });
  const summary = [];
  try {
    for (const cfg of enabled) {
      try {
        const bookings = await scrapeCounty(browser, cfg);
        if (DRY) {
          console.log(`[${cfg.key}] ${bookings.length} bookings (dry-run):`);
          console.log(JSON.stringify(bookings.slice(0, 5), null, 2));
          summary.push({ key: cfg.key, scraped: bookings.length, posted: false });
        } else if (bookings.length) {
          const r = await postBookings(token, cfg.key, bookings);
          console.log(`[${cfg.key}] scraped ${bookings.length} → ingested ${r.ingested}, matched ${r.matched}, alerts ${r.alerts}`);
          summary.push({ key: cfg.key, scraped: bookings.length, ...r });
        } else {
          console.log(`[${cfg.key}] 0 bookings (check selectors / page)`);
          summary.push({ key: cfg.key, scraped: 0 });
        }
      } catch (err) {
        console.error(`[${cfg.key}] FAILED: ${err.message}`);
        summary.push({ key: cfg.key, error: err.message });
      }
      await sleep(DELAY_MS);
    }
  } finally {
    await browser.close();
  }
  console.log('\nSUMMARY:', JSON.stringify(summary));
}

main().catch((err) => { console.error(err); process.exit(1); });
