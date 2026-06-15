// src/durable-objects/DeepResearchDO.ts
// One instance per research job. alarm() runs ONE pipeline stage per tick so a
// multi-minute run never blows a single request's CPU/subrequest budget and is
// resumable. The same alarm reschedules scheduled monitors. SQLite-backed
// (new_sqlite_classes) — free-plan compatible, like WelfareWatchDO.
// NOTE: a DO constructor receives the RAW bindings object (DB, AI, secrets, DO
// namespaces) — that is the `Bindings` type. `Env` in this codebase is the Hono
// context wrapper ({ Bindings, Variables }) used by routes, NOT what a DO gets.
import type { Bindings } from '../types';
import { execute } from '../utils/db';
import { firecrawlSearch, firecrawlScrape, FirecrawlConfigError } from '../utils/firecrawl';
import {
  runResearchLLM, parseAngles, mergeAngles, parseFindings, parseVerdict,
  deriveTrust, numberCitations, type Verdict, type RawFinding,
} from '../utils/researchEngine';
import { anglePrompt, extractPrompt, verifyPrompt, synthesisPrompt } from '../utils/researchPrompts';

const MAX_ANGLES = 6;
const MAX_SOURCES_PER_ANGLE = 5;
const MAX_TOTAL_SOURCES = 25;
const EXTRACT_BATCH = 5;
const VERIFY_CONFIDENCE_FLOOR = 0.5;
const VERIFY_TYPES = new Set(['risk_flag', 'entity', 'relationship']);
const STAGE_GAP_MS = 500;

type Stage = 'expand' | 'search' | 'extract' | 'verify' | 'synthesize' | 'done';
interface SourceRec { url: string; title: string; description: string; markdown: string; angle: string }
interface FindingRec extends RawFinding { verdict: Verdict; trust: number; status: 'proposed' | 'dismissed' }
interface JobMeta {
  jobId: string; orgId: number | null; subject: string; subjectType: string;
  context: string; seedAngles: string[]; monitorIntervalDays: number | null; runNo: number;
}
interface DOState { meta: JobMeta; stage: Stage; angles: string[]; sources: SourceRec[]; findings: FindingRec[] }

function nowIso(): string { return new Date().toISOString(); }

export class DeepResearchDO {
  state: DurableObjectState;
  env: Bindings;
  constructor(state: DurableObjectState, env: Bindings) { this.state = state; this.env = env; }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/start')) {
      const meta = (await request.json()) as JobMeta;
      const init: DOState = { meta, stage: 'expand', angles: [], sources: [], findings: [] };
      await this.state.storage.put('s', init);
      await this.state.storage.setAlarm(Date.now() + STAGE_GAP_MS);
      return Response.json({ ok: true });
    }
    return new Response('not found', { status: 404 });
  }

  private async update(fields: Record<string, unknown>): Promise<void> {
    const cols = Object.keys(fields);
    if (!cols.length) return;
    const set = cols.map((c) => `${c} = ?`).join(', ');
    const vals = cols.map((c) => fields[c]);
    await execute(this.env.DB, `UPDATE deep_research_jobs SET ${set}, updated_at = datetime('now') WHERE id = ?`, ...vals, (await this.s()).meta.jobId);
  }

  private async s(): Promise<DOState> {
    return (await this.state.storage.get<DOState>('s'))!;
  }

  async alarm(): Promise<void> {
    const st = await this.state.storage.get<DOState>('s');
    if (!st) return;
    try {
      switch (st.stage) {
        case 'expand': await this.expand(st); break;
        case 'search': await this.search(st); break;
        case 'extract': await this.extract(st); break;
        case 'verify': await this.verify(st); break;
        case 'synthesize': await this.synthesize(st); break;
        default: return;
      }
      await this.state.storage.put('s', st);
      // Stage methods mutate `st.stage` by reference; tsc's control-flow can't
      // see that across method calls and narrows it away from 'done' after the
      // switch, so widen back to Stage for the comparison.
      if ((st.stage as Stage) !== 'done') await this.state.storage.setAlarm(Date.now() + STAGE_GAP_MS);
    } catch (e: any) {
      const msg = e instanceof FirecrawlConfigError ? 'FIRECRAWL_API_KEY not set' : String(e?.message || e).slice(0, 300);
      await this.update({ status: 'error', error: msg, stage_detail: `Failed at ${st.stage}` });
    }
  }

  private async expand(st: DOState): Promise<void> {
    const { system, user } = anglePrompt(st.meta.subject, st.meta.subjectType, st.meta.context);
    const text = await runResearchLLM(this.env, { system, user, maxTokens: 512 });
    st.angles = mergeAngles(st.meta.seedAngles, parseAngles(text, MAX_ANGLES), MAX_ANGLES);
    st.stage = 'search';
    await this.update({ status: 'searching', progress: 20, angles_json: JSON.stringify(st.angles), stage_detail: `Planned ${st.angles.length} angles` });
  }

  private async search(st: DOState): Promise<void> {
    const out: SourceRec[] = [];
    const seen = new Set<string>();
    for (const angle of st.angles) {
      if (out.length >= MAX_TOTAL_SOURCES) break;
      let results: Awaited<ReturnType<typeof firecrawlSearch>> = [];
      try { results = await firecrawlSearch(this.env, `${st.meta.subject} ${angle}`, { limit: MAX_SOURCES_PER_ANGLE, scrape: true }); }
      catch (e) { if (e instanceof FirecrawlConfigError) throw e; /* else skip this angle */ }
      for (const r of results) {
        if (seen.has(r.url) || out.length >= MAX_TOTAL_SOURCES) continue;
        seen.add(r.url);
        out.push({ url: r.url, title: r.title, description: r.description, markdown: r.markdown || '', angle });
      }
    }
    // Backfill markdown for high-value sources the search didn't inline.
    for (const s of out) {
      if (!s.markdown) { try { s.markdown = await firecrawlScrape(this.env, s.url); } catch { /* leave empty */ } }
    }
    st.sources = out;
    st.stage = 'extract';
    for (const s of out) {
      await execute(this.env.DB,
        `INSERT INTO research_sources (job_id, run_no, url, title, description, angle, scraped, markdown_excerpt) VALUES (?,?,?,?,?,?,?,?)`,
        st.meta.jobId, st.meta.runNo, s.url, s.title, s.description, s.angle, s.markdown ? 1 : 0, s.markdown.slice(0, 2000));
    }
    await this.update({ status: 'extracting', progress: 50, source_count: out.length, stage_detail: `Collected ${out.length} sources` });
  }

  private async extract(st: DOState): Promise<void> {
    const withMd = st.sources.filter((s) => s.markdown && s.markdown.length > 100);
    const raw: RawFinding[] = [];
    for (let i = 0; i < withMd.length; i += EXTRACT_BATCH) {
      const batch = withMd.slice(i, i + EXTRACT_BATCH);
      const { system, user } = extractPrompt(st.meta.subject, batch);
      const text = await runResearchLLM(this.env, { system, user, maxTokens: 2048 });
      raw.push(...parseFindings(text));
    }
    st.findings = raw.map((f) => ({ ...f, verdict: 'uncertain' as Verdict, trust: 0, status: 'proposed' as const }));
    st.stage = 'verify';
    await this.update({ status: 'verifying', progress: 70, finding_count: st.findings.length, stage_detail: `Extracted ${st.findings.length} findings` });
  }

  private async verify(st: DOState): Promise<void> {
    const md = new Map(st.sources.map((s) => [s.url, s.markdown]));
    for (const f of st.findings) {
      const impactful = f.confidence >= VERIFY_CONFIDENCE_FLOOR || VERIFY_TYPES.has(f.finding_type);
      let verdict: Verdict = 'supported';
      if (impactful) {
        const srcs = f.source_urls.map((u) => ({ url: u, markdown: md.get(u) || '' })).filter((s) => s.markdown);
        if (srcs.length) {
          try { const { system, user } = verifyPrompt(f, srcs); verdict = parseVerdict(await runResearchLLM(this.env, { system, user, maxTokens: 256 })); }
          catch { verdict = 'uncertain'; }
        } else { verdict = 'uncertain'; }
      }
      f.verdict = verdict;
      f.trust = deriveTrust({ confidence: f.confidence, sourceCount: new Set(f.source_urls).size, verdict });
      f.status = verdict === 'refuted' ? 'dismissed' : 'proposed';
      await execute(this.env.DB,
        `INSERT INTO research_findings (job_id, run_no, org_id, finding_type, title, detail, confidence, trust, verdict, source_urls_json, status) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        st.meta.jobId, st.meta.runNo, st.meta.orgId, f.finding_type, f.title, f.detail, f.confidence, f.trust, f.verdict, JSON.stringify(f.source_urls), f.status);
    }
    st.stage = 'synthesize';
    await this.update({ status: 'synthesizing', progress: 85, stage_detail: 'Verified findings' });
  }

  private async synthesize(st: DOState): Promise<void> {
    const kept = st.findings.filter((f) => f.status !== 'dismissed');
    const allUrls: string[] = [];
    for (const f of kept) for (const u of f.source_urls) allUrls.push(u);
    const cite = numberCitations(allUrls);
    const reportSources = [...cite.entries()].map(([url, n]) => {
      const s = st.sources.find((x) => x.url === url);
      return { n, url, title: s?.title || url };
    });
    const reportFindings = kept.map((f) => ({
      title: f.title, detail: f.detail, trust: f.trust,
      citations: [...new Set(f.source_urls.map((u) => cite.get(u)).filter((n): n is number => !!n))],
    }));
    let report = '';
    try {
      const { system, user } = synthesisPrompt(st.meta.subject, reportFindings, reportSources);
      report = await runResearchLLM(this.env, { system, user, maxTokens: 3000 });
    } catch { /* leave report empty; findings still persisted */ }
    if (!report.trim()) {
      report = `# ${st.meta.subject}\n\n${kept.map((f) => `- **${f.title}** — ${f.detail}`).join('\n')}\n\n## Sources\n${reportSources.map((s) => `[${s.n}] ${s.url}`).join('\n')}`;
    }
    await execute(this.env.DB,
      `INSERT INTO research_runs (job_id, run_no, finished_at, new_findings, source_count) VALUES (?,?,datetime('now'),?,?)`,
      st.meta.jobId, st.meta.runNo, kept.length, st.sources.length);
    st.stage = 'done';
    const monitor = st.meta.monitorIntervalDays;
    const nextRun = monitor ? new Date(Date.now() + monitor * 86400000).toISOString() : null;
    await this.update({
      status: 'done', progress: 100, report_md: report, last_run_at: nowIso(),
      run_count: st.meta.runNo, next_run_at: nextRun, stage_detail: 'Complete',
    });
    if (monitor && nextRun) {
      // Re-run as a monitor: bump run_no and restart the pipeline at the alarm.
      const next: DOState = { ...st, meta: { ...st.meta, runNo: st.meta.runNo + 1 }, stage: 'expand', angles: [], sources: [], findings: [] };
      await this.state.storage.put('s', next);
      await this.state.storage.setAlarm(Date.parse(nextRun));
    }
  }
}
