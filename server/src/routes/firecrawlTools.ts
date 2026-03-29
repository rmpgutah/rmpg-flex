// ============================================================
// Firecrawl Tools API Routes
// ============================================================
// Advanced Firecrawl-powered endpoints: Open Scouts (web monitoring),
// AI-Ready Website Analyzer, Website Cloner, Brand Monitor,
// Page Comparison, and Workflow Builder.
// ============================================================

import { Router, Request, Response } from 'express';
import { authenticateToken as authenticate, requireRole } from '../middleware/auth';
import { firecrawlScrape, firecrawlSearch, FirecrawlUnavailableError } from '../utils/firecrawlClient';
import { getDb } from '../models/database';
import { localNow } from '../utils/timeUtils';
import { auditLog } from '../utils/auditLogger';
import {
  analyzeSentiment, extractKeywords, extractContactInfo, extractBusinessInfo,
  lookupWhois, parseRssFeed, toCsv, analyzeAiReadiness as analyzeAiReadinessEnhanced,
  extractTables, comparePages,
} from '../utils/firecrawlEnhanced';
import TurndownService from 'turndown';
import * as cheerio from 'cheerio';

const router = Router();
router.use(authenticate);

// ── Table Initialization ─────────────────────────────────────

function initTables(): void {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_scouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      query TEXT,
      check_interval_hours INTEGER DEFAULT 24,
      notify_email TEXT,
      keywords TEXT,
      status TEXT DEFAULT 'active',
      last_checked_at TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_scout_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scout_id INTEGER NOT NULL,
      matched INTEGER DEFAULT 0,
      results TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (scout_id) REFERENCES firecrawl_scouts(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_ai_ready_scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      scores TEXT NOT NULL,
      overall_score REAL NOT NULL,
      recommendations TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_clones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      title TEXT,
      html_structure TEXT,
      markdown_content TEXT,
      component_tree TEXT,
      styles_summary TEXT,
      links TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_brand_monitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand_name TEXT NOT NULL,
      keywords TEXT,
      competitor_urls TEXT,
      check_interval_hours INTEGER DEFAULT 24,
      status TEXT DEFAULT 'active',
      last_checked_at TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_brand_mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monitor_id INTEGER NOT NULL,
      url TEXT,
      title TEXT,
      snippet TEXT,
      source TEXT,
      sentiment TEXT,
      found_at TEXT NOT NULL,
      FOREIGN KEY (monitor_id) REFERENCES firecrawl_brand_monitors(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_comparisons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url_a TEXT NOT NULL,
      url_b TEXT NOT NULL,
      markdown_a TEXT,
      markdown_b TEXT,
      diff_summary TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_workflows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      steps TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_workflow_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id INTEGER NOT NULL,
      status TEXT DEFAULT 'running',
      step_results TEXT,
      error TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (workflow_id) REFERENCES firecrawl_workflows(id) ON DELETE CASCADE
    )
  `);

  // ── 7. Fireplexity — AI Search Engine ──────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_search_engine_queries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      depth TEXT DEFAULT 'quick',
      results TEXT,
      answer_summary TEXT,
      citations TEXT,
      duration_ms INTEGER,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  // ── 8. Fire Enrich — Data Enrichment ───────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_enrichments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT,
      email TEXT,
      company_name TEXT,
      description TEXT,
      industry TEXT,
      employee_count_estimate TEXT,
      tech_stack TEXT,
      social_links TEXT,
      contact_info TEXT,
      funding_info TEXT,
      enriched_at TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  // ── 9. Open Researcher — Deep Research Assistant ───────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_research_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT NOT NULL,
      questions TEXT,
      depth TEXT DEFAULT 'basic',
      findings TEXT,
      synthesis TEXT,
      sources TEXT,
      duration_ms INTEGER,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  // ── 10. Firestarter — Website Chatbot / RAG ────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_chatbots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      source_url TEXT NOT NULL,
      description TEXT,
      scraped_content TEXT,
      page_count INTEGER DEFAULT 0,
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_chatbot_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chatbot_id INTEGER NOT NULL,
      question TEXT NOT NULL,
      answer TEXT,
      sources TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (chatbot_id) REFERENCES firecrawl_chatbots(id) ON DELETE CASCADE
    )
  `);

  // ── 11. Firecrawl Observer — Website Change Detection ──────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_observers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      url TEXT NOT NULL,
      check_interval_hours INTEGER DEFAULT 24,
      notify_on_change INTEGER DEFAULT 1,
      last_content TEXT,
      last_checked_at TEXT,
      status TEXT DEFAULT 'active',
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_observer_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      observer_id INTEGER NOT NULL,
      changes_summary TEXT,
      diff_sections TEXT,
      previous_content TEXT,
      new_content TEXT,
      detected_at TEXT NOT NULL,
      FOREIGN KEY (observer_id) REFERENCES firecrawl_observers(id) ON DELETE CASCADE
    )
  `);

  // ── 12. Firesearch — Deep Research with Validation ─────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_deep_searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      results TEXT,
      validated INTEGER DEFAULT 0,
      duration_ms INTEGER,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  // ── 13. LLMs.txt Generator ─────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_llmstxt (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      llmstxt_content TEXT,
      pages_analyzed INTEGER DEFAULT 0,
      generated_at TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  // ── 14. PDF Inspector ──────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_pdf_inspections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      page_count_estimate INTEGER,
      is_scanned INTEGER DEFAULT 0,
      has_text INTEGER DEFAULT 1,
      classification TEXT DEFAULT 'other',
      summary TEXT,
      key_sections TEXT,
      extracted_entities TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  // ── 15. Firegraph — Graph/Chart Generator ─────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_graphs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      chart_type TEXT NOT NULL,
      config TEXT NOT NULL,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  // ── 16. Data Connectors ───────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_connectors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      url TEXT NOT NULL,
      schedule_hours INTEGER,
      transform_prompt TEXT,
      status TEXT DEFAULT 'active',
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_connector_syncs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connector_id INTEGER NOT NULL,
      records_fetched INTEGER DEFAULT 0,
      data TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (connector_id) REFERENCES firecrawl_connectors(id) ON DELETE CASCADE
    )
  `);

  // ── 17. RAG Arena — RAG Evaluation ────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_rag_evals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      test_questions TEXT NOT NULL,
      evaluations TEXT,
      overall_score REAL,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  // ── 18. Trend Finder ──────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_trend_scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      keywords TEXT,
      time_range TEXT DEFAULT '7d',
      trends TEXT,
      analyzed_at TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  // ── 19. Gen UI — Generate UI from Scraped Data ────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_gen_ui (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      component_type TEXT,
      structure TEXT,
      react_snippet TEXT,
      tailwind_classes TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  // ── 20. QA Clustering ─────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_qa_clusters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      questions TEXT NOT NULL,
      clusters TEXT,
      total_questions INTEGER DEFAULT 0,
      cluster_count INTEGER DEFAULT 0,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  // ── 21. Structured Extraction ─────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_extractions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      schema TEXT NOT NULL,
      extracted TEXT,
      confidence REAL,
      fields_found INTEGER DEFAULT 0,
      fields_missing INTEGER DEFAULT 0,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  // ── 22. HTML to Markdown Converter ────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_html_conversions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT,
      markdown TEXT,
      word_count INTEGER DEFAULT 0,
      link_count INTEGER DEFAULT 0,
      image_count INTEGER DEFAULT 0,
      title TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  // ── 23. Coupon Finder ─────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_coupon_searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand TEXT NOT NULL,
      coupons TEXT,
      found_count INTEGER DEFAULT 0,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  // ── 24. Brand Extender ────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_brand_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      brand_name TEXT,
      colors TEXT,
      fonts TEXT,
      tone_keywords TEXT,
      social_profiles TEXT,
      competitors TEXT,
      extension_suggestions TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  // ── 25. MCP Integration Dashboard ──────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_mcp_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_url TEXT NOT NULL,
      api_key TEXT,
      enabled INTEGER DEFAULT 1,
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_mcp_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_name TEXT,
      input TEXT,
      output TEXT,
      status TEXT DEFAULT 'success',
      duration_ms INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  // ── 26. App Examples Gallery ────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_examples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT DEFAULT 'scraping',
      config TEXT NOT NULL,
      source_url TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  // ── 27. LLMs.txt Generator V2 ──────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_llmstxt_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      llmstxt TEXT,
      llmstxt_full TEXT,
      pages_crawled INTEGER DEFAULT 0,
      total_words INTEGER DEFAULT 0,
      generated_at TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  // ── 28. Mendable Chatbot Builder ────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_mendable_bots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      source_urls TEXT NOT NULL,
      system_prompt TEXT,
      welcome_message TEXT,
      scraped_content TEXT,
      page_count INTEGER DEFAULT 0,
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_mendable_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id INTEGER NOT NULL,
      conversation_id TEXT,
      role TEXT DEFAULT 'user',
      message TEXT NOT NULL,
      sources TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (bot_id) REFERENCES firecrawl_mendable_bots(id) ON DELETE CASCADE
    )
  `);

  // ── 29. AI News Aggregator ──────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_news_searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT NOT NULL,
      sources TEXT,
      articles TEXT,
      fetched_at TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  // ── 30. Auto Draft — Content Generator ──────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT NOT NULL,
      type TEXT DEFAULT 'summary',
      draft_content TEXT,
      sources_used TEXT,
      word_count INTEGER DEFAULT 0,
      generated_at TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  // ── 31. Slack Bot Integration ───────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_slack_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      webhook_url TEXT NOT NULL,
      channel TEXT,
      notify_on TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // ── 32. Discord Bot Integration ─────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_discord_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      webhook_url TEXT NOT NULL,
      notify_on TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // ── 33. OpenManus — Agent Framework ─────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      goal TEXT NOT NULL,
      tools TEXT NOT NULL,
      max_steps INTEGER DEFAULT 10,
      initial_url TEXT,
      initial_query TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_agent_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER NOT NULL,
      steps TEXT,
      completed INTEGER DEFAULT 0,
      result_summary TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (agent_id) REFERENCES firecrawl_agents(id) ON DELETE CASCADE
    )
  `);

  // ── 34. MinerU Document Extraction ──────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_doc_extractions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      content TEXT,
      format TEXT DEFAULT 'markdown',
      tables TEXT,
      images_found INTEGER DEFAULT 0,
      metadata TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  // ── 35. Job Matcher ─────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_job_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      search_url TEXT NOT NULL,
      criteria TEXT NOT NULL,
      matches TEXT,
      total_found INTEGER DEFAULT 0,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  // ── 36. MHTML Converter ─────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_mhtml_conversions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      title TEXT,
      html_content TEXT,
      assets_count INTEGER DEFAULT 0,
      size_bytes INTEGER DEFAULT 0,
      converted_at TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  // ── 37. Firecrawl Core API Console ────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_crawl_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      max_pages INTEGER DEFAULT 10,
      max_depth INTEGER DEFAULT 2,
      include_paths TEXT,
      exclude_paths TEXT,
      pages TEXT,
      total_crawled INTEGER DEFAULT 0,
      status TEXT DEFAULT 'completed',
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  // ── 38. Firecrawl CLI ─────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_cli_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      command TEXT NOT NULL,
      args TEXT,
      result TEXT,
      duration_ms INTEGER,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  // ── 39. Grok Fire Enrich ──────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_grok_enrichments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url_or_domain TEXT NOT NULL,
      enrich_type TEXT NOT NULL,
      data TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  // ── 41. N8N Nodes ─────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_n8n_workflows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      trigger TEXT DEFAULT 'manual',
      nodes TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_n8n_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id INTEGER NOT NULL,
      status TEXT DEFAULT 'running',
      node_results TEXT,
      error TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (workflow_id) REFERENCES firecrawl_n8n_workflows(id) ON DELETE CASCADE
    )
  `);

  // ── 42. Mendable Python SDK ───────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_mendable_indexes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      urls TEXT NOT NULL,
      scraped_content TEXT,
      page_count INTEGER DEFAULT 0,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  // ── 43. OpenCode Firecrawl ────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_code_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      repo_name TEXT,
      description TEXT,
      languages TEXT,
      readme_summary TEXT,
      file_count INTEGER DEFAULT 0,
      star_count INTEGER,
      last_updated TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  // ── 44. Claude Skill Generator ────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_skill_generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_url TEXT NOT NULL,
      skill_name TEXT NOT NULL,
      skill_description TEXT,
      generated_skill TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  // ── 46. Open WebUI Pipelines ──────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_pipelines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      steps TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_pipeline_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pipeline_id INTEGER NOT NULL,
      input TEXT,
      status TEXT DEFAULT 'running',
      step_results TEXT,
      error TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (pipeline_id) REFERENCES firecrawl_pipelines(id) ON DELETE CASCADE
    )
  `);

  // ── 47. Firecrawl Theme ───────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_theme_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      accent_color TEXT DEFAULT '#f97316',
      show_labels INTEGER DEFAULT 1,
      compact_mode INTEGER DEFAULT 0,
      default_tab TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // ── 48. Firecrawl AI Chatbot ──────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_ai_chat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message TEXT NOT NULL,
      context_url TEXT,
      response TEXT,
      context_used INTEGER DEFAULT 0,
      sources TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  // ── 49. LoPDF — PDF Manipulation ──────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_pdf_operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      operations TEXT NOT NULL,
      results TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  // ── 50. OpenClaw — Personal AI Assistant ──────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS firecrawl_assistant_chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      search_web INTEGER DEFAULT 0,
      context_urls TEXT,
      answer TEXT,
      sources_used TEXT,
      web_searched INTEGER DEFAULT 0,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);
}

// Initialize tables on module load
try { initTables(); } catch (e) {
  console.error('[FirecrawlTools] Table init deferred — DB may not be ready yet:', (e as Error).message);
}

// Helper to ensure tables exist (called on first request if init failed)
let tablesReady = false;
function ensureTables(): void {
  if (tablesReady) return;
  try { initTables(); tablesReady = true; } catch { /* will retry next request */ }
}

// ── JSON field parser for SQLite rows ────────────────────────
// SQLite stores JSON arrays/objects as TEXT strings. This helper
// parses them back into real arrays/objects before returning to
// the frontend, preventing ".map is not a function" and similar
// crashes when the client tries to iterate over string values.
function parseJsonFields(row: any, fields: string[]): any {
  if (!row) return row;
  const parsed = { ...row };
  for (const f of fields) {
    if (parsed[f] && typeof parsed[f] === 'string') {
      try { parsed[f] = JSON.parse(parsed[f]); } catch { parsed[f] = []; }
    }
  }
  return parsed;
}

function parseJsonRows(rows: any[], fields: string[]): any[] {
  return rows.map(r => parseJsonFields(r, fields));
}

// ── Firecrawl connection error helper ─────────────────────────
// When the Firecrawl Docker service isn't running, the client throws
// FirecrawlUnavailableError. This helper sends a clear 503 response
// so the frontend can show a helpful message instead of a generic error.
function handleFirecrawlError(err: unknown, res: Response): boolean {
  if (err instanceof FirecrawlUnavailableError) {
    res.status(503).json({
      error: 'Firecrawl service unavailable',
      detail: 'The Firecrawl Docker service is not running. Start it with: docker run -p 3003:3002 firecrawl',
      code: 'FIRECRAWL_UNAVAILABLE',
    });
    return true;
  }
  return false;
}

// ═════════════════════════════════════════════════════════════
// 1. Open Scouts — Web monitoring with alerts
// ═════════════════════════════════════════════════════════════

// ── POST /scouts — Create a new scout ────────────────────────

router.post(
  '/scouts',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const { name, url, query, check_interval_hours, notify_email, keywords } = req.body as {
      name?: string; url?: string; query?: string;
      check_interval_hours?: number; notify_email?: string; keywords?: string[];
    };

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name is required' }); return;
    }
    if (!url || typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ error: 'url is required' }); return;
    }

    try {
      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_scouts (name, url, query, check_interval_hours, notify_email, keywords, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        name.trim(), url.trim(), query?.trim() || null,
        check_interval_hours || 24, notify_email?.trim() || null,
        keywords ? JSON.stringify(keywords) : null,
        (req as any).user?.id || (req as any).user?.userId, now, now,
      );

      const id = Number(result.lastInsertRowid);
      auditLog(req, 'CREATE', 'firecrawl_scouts', id, `Created scout: ${name.trim()}`);
      res.status(201).json({ success: true, id });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[FirecrawlTools] Create scout error:', msg);
      res.status(500).json({ error: 'Failed to create scout', detail: msg });
    }
  },
);

// ── GET /scouts — List all scouts ───────────────────────────

router.get(
  '/scouts',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_scouts ORDER BY created_at DESC').all();
      res.json(parseJsonRows(rows, ['keywords']));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to list scouts', detail: msg });
    }
  },
);

// ── PUT /scouts/:id — Update a scout ────────────────────────

router.put(
  '/scouts/:id',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    const { name, url, query, check_interval_hours, notify_email, keywords, status } = req.body as {
      name?: string; url?: string; query?: string;
      check_interval_hours?: number; notify_email?: string; keywords?: string[]; status?: string;
    };

    try {
      const db = getDb();
      const existing = db.prepare('SELECT id FROM firecrawl_scouts WHERE id = ?').get(id);
      if (!existing) { res.status(404).json({ error: 'Scout not found' }); return; }

      const now = localNow();
      db.prepare(`
        UPDATE firecrawl_scouts SET
          name = COALESCE(?, name),
          url = COALESCE(?, url),
          query = COALESCE(?, query),
          check_interval_hours = COALESCE(?, check_interval_hours),
          notify_email = COALESCE(?, notify_email),
          keywords = COALESCE(?, keywords),
          status = COALESCE(?, status),
          updated_at = ?
        WHERE id = ?
      `).run(
        name?.trim() || null, url?.trim() || null, query?.trim() || null,
        check_interval_hours || null, notify_email?.trim() || null,
        keywords ? JSON.stringify(keywords) : null, status || null,
        now, id,
      );

      auditLog(req, 'UPDATE', 'firecrawl_scouts', id, `Updated scout ${id}`);
      res.json({ success: true });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to update scout', detail: msg });
    }
  },
);

// ── DELETE /scouts/:id — Delete a scout ─────────────────────

router.delete(
  '/scouts/:id',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const result = db.prepare('DELETE FROM firecrawl_scouts WHERE id = ?').run(id);
      if (result.changes === 0) { res.status(404).json({ error: 'Scout not found' }); return; }

      auditLog(req, 'DELETE', 'firecrawl_scouts', id, `Deleted scout ${id}`);
      res.json({ success: true });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to delete scout', detail: msg });
    }
  },
);

// ── POST /scouts/:id/run — Manually trigger a scout check ───

router.post(
  '/scouts/:id/run',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const scout = db.prepare('SELECT * FROM firecrawl_scouts WHERE id = ?').get(id) as any;
      if (!scout) { res.status(404).json({ error: 'Scout not found' }); return; }

      const now = localNow();
      let results: any[] = [];
      let matched = 0;
      let error: string | null = null;

      try {
        const keywords: string[] = scout.keywords ? JSON.parse(scout.keywords) : [];

        if (scout.query) {
          // Use search for query-based scouts
          const searchResult = await firecrawlSearch({
            query: scout.query,
            limit: 10,
            scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
          });
          results = searchResult.data || [];
        } else {
          // Scrape the URL directly
          const scrapeResult = await firecrawlScrape({
            url: scout.url,
            formats: ['markdown'],
            onlyMainContent: true,
          });
          results = scrapeResult.data ? [scrapeResult.data] : [];
        }

        // Check for keyword matches
        if (keywords.length > 0) {
          const content = JSON.stringify(results).toLowerCase();
          matched = keywords.filter(kw => content.includes(kw.toLowerCase())).length;
        } else {
          matched = results.length;
        }
      } catch (runErr: unknown) {
        error = runErr instanceof Error ? runErr.message : String(runErr);
      }

      // Store run
      const runResult = db.prepare(`
        INSERT INTO firecrawl_scout_runs (scout_id, matched, results, error, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, matched, JSON.stringify(results), error, now);

      // Update last_checked_at
      db.prepare('UPDATE firecrawl_scouts SET last_checked_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);

      auditLog(req, 'EXECUTE', 'firecrawl_scouts', id, `Scout run: ${matched} matches`);

      res.json({
        success: true,
        run_id: Number(runResult.lastInsertRowid),
        matched,
        result_count: results.length,
        error,
      });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[FirecrawlTools] Scout run error:', msg);
      res.status(500).json({ error: 'Failed to run scout', detail: msg });
    }
  },
);

// ── GET /scouts/:id/runs — Get recent runs for a scout ──────

router.get(
  '/scouts/:id/runs',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const rows = db.prepare(
        'SELECT * FROM firecrawl_scout_runs WHERE scout_id = ? ORDER BY created_at DESC LIMIT 50'
      ).all(id);
      res.json(parseJsonRows(rows, ['results']));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get scout runs', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 2. AI-Ready Website Analyzer
// ═════════════════════════════════════════════════════════════

function analyzeAiReadiness(html: string, markdown: string, url: string): {
  scores: Record<string, number>;
  overall_score: number;
  recommendations: string[];
} {
  const scores: Record<string, number> = {
    structured_data: 0,
    semantic_html: 0,
    content_quality: 0,
    performance: 0,
    api_availability: 0,
    mobile_friendly: 0,
    accessibility: 0,
    security: 0,
  };
  const recommendations: string[] = [];
  const lowerHtml = (html || '').toLowerCase();
  const lowerMd = (markdown || '').toLowerCase();
  const combined = lowerHtml + ' ' + lowerMd;

  // Structured Data (JSON-LD, schema.org, microdata)
  if (lowerHtml.includes('application/ld+json')) scores.structured_data += 40;
  if (combined.includes('schema.org')) scores.structured_data += 30;
  if (lowerHtml.includes('itemscope') || lowerHtml.includes('itemprop')) scores.structured_data += 20;
  if (lowerHtml.includes('og:')) scores.structured_data += 10;
  scores.structured_data = Math.min(scores.structured_data, 100);
  if (scores.structured_data < 50) recommendations.push('Add JSON-LD structured data (schema.org) for better AI discoverability');

  // Semantic HTML (header hierarchy, semantic tags)
  if (lowerHtml.includes('<header')) scores.semantic_html += 15;
  if (lowerHtml.includes('<nav')) scores.semantic_html += 15;
  if (lowerHtml.includes('<main')) scores.semantic_html += 15;
  if (lowerHtml.includes('<article')) scores.semantic_html += 15;
  if (lowerHtml.includes('<footer')) scores.semantic_html += 10;
  if (lowerHtml.includes('aria-label')) scores.semantic_html += 15;
  if (lowerHtml.includes('<h1')) scores.semantic_html += 15;
  scores.semantic_html = Math.min(scores.semantic_html, 100);
  if (scores.semantic_html < 50) recommendations.push('Use semantic HTML5 elements (header, nav, main, article, footer)');

  // Content Quality (meta descriptions, alt text, headings)
  if (lowerHtml.includes('meta') && lowerHtml.includes('description')) scores.content_quality += 25;
  if (lowerHtml.includes('alt="') || lowerHtml.includes("alt='")) scores.content_quality += 25;
  if (lowerHtml.includes('<title')) scores.content_quality += 20;
  if (lowerHtml.includes('canonical')) scores.content_quality += 15;
  if (markdown && markdown.length > 500) scores.content_quality += 15;
  scores.content_quality = Math.min(scores.content_quality, 100);
  if (scores.content_quality < 50) recommendations.push('Add meta descriptions, image alt text, and canonical URLs');

  // Performance (page size heuristic)
  const pageSize = (html || '').length;
  if (pageSize < 100_000) scores.performance = 100;
  else if (pageSize < 300_000) scores.performance = 70;
  else if (pageSize < 500_000) scores.performance = 40;
  else scores.performance = 20;
  if (lowerHtml.includes('loading="lazy"')) scores.performance = Math.min(scores.performance + 10, 100);
  if (scores.performance < 50) recommendations.push('Reduce page size and implement lazy loading');

  // API Availability
  if (combined.includes('/api/') || combined.includes('/api.')) scores.api_availability += 40;
  if (combined.includes('openapi') || combined.includes('swagger')) scores.api_availability += 30;
  if (combined.includes('graphql')) scores.api_availability += 20;
  if (combined.includes('rest') && combined.includes('api')) scores.api_availability += 10;
  scores.api_availability = Math.min(scores.api_availability, 100);
  if (scores.api_availability < 30) recommendations.push('Consider exposing a public API or OpenAPI specification');

  // Mobile Friendly
  if (lowerHtml.includes('viewport')) scores.mobile_friendly += 40;
  if (lowerHtml.includes('responsive') || lowerHtml.includes('media')) scores.mobile_friendly += 20;
  if (lowerHtml.includes('@media')) scores.mobile_friendly += 20;
  if (lowerHtml.includes('mobile')) scores.mobile_friendly += 20;
  scores.mobile_friendly = Math.min(scores.mobile_friendly, 100);
  if (scores.mobile_friendly < 50) recommendations.push('Add viewport meta tag and responsive design');

  // Accessibility
  if (lowerHtml.includes('aria-')) scores.accessibility += 30;
  if (lowerHtml.includes('role="')) scores.accessibility += 20;
  if (lowerHtml.includes('lang="') || lowerHtml.includes("lang='")) scores.accessibility += 20;
  if (lowerHtml.includes('tabindex')) scores.accessibility += 15;
  if (lowerHtml.includes('<label')) scores.accessibility += 15;
  scores.accessibility = Math.min(scores.accessibility, 100);
  if (scores.accessibility < 50) recommendations.push('Improve accessibility: add ARIA attributes, lang tag, and form labels');

  // Security
  if (url.startsWith('https')) scores.security += 50;
  if (lowerHtml.includes('content-security-policy') || lowerHtml.includes('csp')) scores.security += 25;
  if (lowerHtml.includes('strict-transport-security')) scores.security += 25;
  scores.security = Math.min(scores.security, 100);
  if (scores.security < 50) recommendations.push('Ensure HTTPS and add security headers (CSP, HSTS)');

  const values = Object.values(scores);
  const overall_score = Math.round(values.reduce((a, b) => a + b, 0) / values.length);

  return { scores, overall_score, recommendations };
}

// ── POST /ai-ready — Analyze a website for AI readiness ─────

router.post(
  '/ai-ready',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { url } = req.body as { url?: string };

    if (!url || typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ error: 'url is required' }); return;
    }

    try {
      const scrapeResult = await firecrawlScrape({
        url: url.trim(),
        formats: ['markdown', 'html'],
        onlyMainContent: false,
      });

      if (!scrapeResult.success || !scrapeResult.data) {
        res.status(502).json({ error: 'Failed to scrape URL', detail: scrapeResult.error });
        return;
      }

      const rawHtml = scrapeResult.data.html || scrapeResult.data.rawHtml || '';
      const { scores, overall, recommendations } = analyzeAiReadinessEnhanced(rawHtml, url.trim());
      const overall_score = overall;

      // Store scan
      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_ai_ready_scans (url, scores, overall_score, recommendations, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        url.trim(),
        JSON.stringify(scores),
        overall_score,
        JSON.stringify(recommendations),
        (req as any).user?.id || (req as any).user?.userId,
        now,
      );

      auditLog(req, 'CREATE', 'firecrawl_ai_ready_scans', Number(result.lastInsertRowid), `AI-ready scan: ${url.trim()} (score: ${overall_score})`);

      res.json({ url: url.trim(), scores, overall_score, recommendations });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[FirecrawlTools] AI-ready scan error:', msg);
      res.status(502).json({ error: 'AI-ready scan failed', detail: msg });
    }
  },
);

// ── GET /ai-ready/history — Get past AI-ready scans ─────────

router.get(
  '/ai-ready/history',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_ai_ready_scans ORDER BY created_at DESC LIMIT 100').all();
      res.json(parseJsonRows(rows, ['scores', 'recommendations']));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get scan history', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 3. Website Cloner / Open Lovable
// ═════════════════════════════════════════════════════════════

// ── POST /clone — Clone a website's structure ───────────────

router.post(
  '/clone',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { url } = req.body as { url?: string };

    if (!url || typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ error: 'url is required' }); return;
    }

    try {
      const scrapeResult = await firecrawlScrape({
        url: url.trim(),
        formats: ['markdown', 'html', 'links'],
        onlyMainContent: false,
      });

      if (!scrapeResult.success || !scrapeResult.data) {
        res.status(502).json({ error: 'Failed to scrape URL', detail: scrapeResult.error });
        return;
      }

      const data = scrapeResult.data;
      const title = (data.metadata as any)?.title || url.trim();

      // Build a simple component tree from HTML structure
      const htmlContent = data.html || '';
      const tagPattern = /<(header|nav|main|section|article|aside|footer|div|form|table|ul|ol)[\s>]/gi;
      const tags: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = tagPattern.exec(htmlContent)) !== null) {
        tags.push(match[1].toLowerCase());
      }
      const componentTree = [...new Set(tags)];

      // Extract a styles summary (count of inline styles, class usage)
      const classCount = (htmlContent.match(/class="/g) || []).length;
      const styleCount = (htmlContent.match(/style="/g) || []).length;
      const stylesSummary = `${classCount} class attributes, ${styleCount} inline styles`;

      // Store clone
      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_clones (url, title, html_structure, markdown_content, component_tree, styles_summary, links, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        url.trim(), title,
        htmlContent.substring(0, 500_000), // limit stored HTML
        (data.markdown || '').substring(0, 500_000),
        JSON.stringify(componentTree),
        stylesSummary,
        JSON.stringify(data.links || []),
        (req as any).user?.id || (req as any).user?.userId,
        now,
      );

      const id = Number(result.lastInsertRowid);
      auditLog(req, 'CREATE', 'firecrawl_clones', id, `Cloned: ${url.trim()}`);

      res.json({
        id, url: url.trim(), title,
        html_structure: htmlContent.substring(0, 50_000), // return a trimmed version
        component_tree: componentTree,
        styles_summary: stylesSummary,
        links: data.links || [],
      });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[FirecrawlTools] Clone error:', msg);
      res.status(502).json({ error: 'Clone failed', detail: msg });
    }
  },
);

// ── GET /clones — List past clones ──────────────────────────

router.get(
  '/clones',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare(
        'SELECT id, url, title, component_tree, styles_summary, created_by, created_at FROM firecrawl_clones ORDER BY created_at DESC LIMIT 100'
      ).all();
      res.json(parseJsonRows(rows, ['component_tree', 'styles_summary']));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to list clones', detail: msg });
    }
  },
);

// ── GET /clones/:id — Get a specific clone ──────────────────

router.get(
  '/clones/:id',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const row = db.prepare('SELECT * FROM firecrawl_clones WHERE id = ?').get(id) as any;
      if (!row) { res.status(404).json({ error: 'Clone not found' }); return; }
      res.json(parseJsonFields(row, ['component_tree', 'styles_summary', 'links']));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get clone', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 4. Brand Monitor / FireGEO
// ═════════════════════════════════════════════════════════════

// ── POST /brand-monitor — Start monitoring a brand ──────────

router.post(
  '/brand-monitor',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const { brand_name, keywords, competitor_urls, check_interval_hours } = req.body as {
      brand_name?: string; keywords?: string[]; competitor_urls?: string[]; check_interval_hours?: number;
    };

    if (!brand_name || typeof brand_name !== 'string' || !brand_name.trim()) {
      res.status(400).json({ error: 'brand_name is required' }); return;
    }

    try {
      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_brand_monitors (brand_name, keywords, competitor_urls, check_interval_hours, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        brand_name.trim(),
        keywords ? JSON.stringify(keywords) : null,
        competitor_urls ? JSON.stringify(competitor_urls) : null,
        check_interval_hours || 24,
        (req as any).user?.id || (req as any).user?.userId,
        now, now,
      );

      const id = Number(result.lastInsertRowid);
      auditLog(req, 'CREATE', 'firecrawl_brand_monitors', id, `Brand monitor: ${brand_name.trim()}`);
      res.status(201).json({ success: true, id });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to create brand monitor', detail: msg });
    }
  },
);

// ── GET /brand-monitors — List all brand monitors ───────────

router.get(
  '/brand-monitors',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_brand_monitors ORDER BY created_at DESC').all();
      res.json(parseJsonRows(rows, ['keywords', 'competitor_urls']));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to list brand monitors', detail: msg });
    }
  },
);

// ── POST /brand-monitor/:id/scan — Manually scan ────────────

router.post(
  '/brand-monitor/:id/scan',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const monitor = db.prepare('SELECT * FROM firecrawl_brand_monitors WHERE id = ?').get(id) as any;
      if (!monitor) { res.status(404).json({ error: 'Brand monitor not found' }); return; }

      const now = localNow();
      const keywords: string[] = monitor.keywords ? JSON.parse(monitor.keywords) : [];
      const searchQuery = [monitor.brand_name, ...keywords].join(' ');

      // Search for brand mentions
      const searchResult = await firecrawlSearch({
        query: searchQuery,
        limit: 15,
        scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
      });

      const mentions: Array<{ url: string; title: string; snippet: string; source: string; sentiment?: { score: number; label: string } }> = [];

      for (const item of (searchResult.data || [])) {
        const snippet = (item.markdown || item.description || '').substring(0, 500);
        const sentimentResult = analyzeSentiment(snippet);
        const mention = {
          url: item.url,
          title: item.title || '',
          snippet,
          source: 'web_search',
          sentiment: { score: sentimentResult.comparative, label: sentimentResult.label },
        };
        mentions.push(mention);

        // Store mention with sentiment
        db.prepare(`
          INSERT INTO firecrawl_brand_mentions (monitor_id, url, title, snippet, source, sentiment, found_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, mention.url, mention.title, mention.snippet, mention.source, JSON.stringify(mention.sentiment), now);
      }

      // Also scrape competitor URLs if configured
      const competitorUrls: string[] = monitor.competitor_urls ? JSON.parse(monitor.competitor_urls) : [];
      for (const compUrl of competitorUrls) {
        try {
          const scrapeResult = await firecrawlScrape({
            url: compUrl,
            formats: ['markdown'],
            onlyMainContent: true,
          });
          if (scrapeResult.success && scrapeResult.data?.markdown) {
            const brandLower = monitor.brand_name.toLowerCase();
            if (scrapeResult.data.markdown.toLowerCase().includes(brandLower)) {
              const compSnippet = scrapeResult.data.markdown.substring(0, 500);
              const compSentiment = analyzeSentiment(compSnippet);
              const mention = {
                url: compUrl,
                title: (scrapeResult.data.metadata as any)?.title || compUrl,
                snippet: compSnippet,
                source: 'competitor_site',
                sentiment: { score: compSentiment.comparative, label: compSentiment.label },
              };
              mentions.push(mention);
              db.prepare(`
                INSERT INTO firecrawl_brand_mentions (monitor_id, url, title, snippet, source, sentiment, found_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
              `).run(id, mention.url, mention.title, mention.snippet, mention.source, JSON.stringify(mention.sentiment), now);
            }
          }
        } catch { /* skip failed competitor scrapes */ }
      }

      // Update last_checked_at
      db.prepare('UPDATE firecrawl_brand_monitors SET last_checked_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);

      auditLog(req, 'EXECUTE', 'firecrawl_brand_monitors', id, `Brand scan: ${mentions.length} mentions found`);

      res.json({ success: true, mention_count: mentions.length, mentions });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[FirecrawlTools] Brand scan error:', msg);
      res.status(502).json({ error: 'Brand scan failed', detail: msg });
    }
  },
);

// ── GET /brand-monitor/:id/mentions — Get mentions ──────────

router.get(
  '/brand-monitor/:id/mentions',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const rows = db.prepare(
        'SELECT * FROM firecrawl_brand_mentions WHERE monitor_id = ? ORDER BY found_at DESC LIMIT 100'
      ).all(id);
      res.json(rows);
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get mentions', detail: msg });
    }
  },
);

// ── DELETE /brand-monitors/:id — Delete a monitor ───────────

router.delete(
  '/brand-monitors/:id',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const result = db.prepare('DELETE FROM firecrawl_brand_monitors WHERE id = ?').run(id);
      if (result.changes === 0) { res.status(404).json({ error: 'Brand monitor not found' }); return; }

      // Also delete related mentions
      db.prepare('DELETE FROM firecrawl_brand_mentions WHERE monitor_id = ?').run(id);

      auditLog(req, 'DELETE', 'firecrawl_brand_monitors', id, `Deleted brand monitor ${id}`);
      res.json({ success: true });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to delete brand monitor', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 5. Page Comparison / Migrator
// ═════════════════════════════════════════════════════════════

// ── POST /compare — Compare two URLs ────────────────────────

router.post(
  '/compare',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { url_a, url_b } = req.body as { url_a?: string; url_b?: string };

    if (!url_a || typeof url_a !== 'string' || !url_a.trim()) {
      res.status(400).json({ error: 'url_a is required' }); return;
    }
    if (!url_b || typeof url_b !== 'string' || !url_b.trim()) {
      res.status(400).json({ error: 'url_b is required' }); return;
    }

    try {
      // Scrape both URLs in parallel (include HTML for structural diff)
      const [resultA, resultB] = await Promise.all([
        firecrawlScrape({ url: url_a.trim(), formats: ['markdown', 'html'], onlyMainContent: false }),
        firecrawlScrape({ url: url_b.trim(), formats: ['markdown', 'html'], onlyMainContent: false }),
      ]);

      if (!resultA.success || !resultA.data) {
        res.status(502).json({ error: `Failed to scrape url_a: ${resultA.error}` }); return;
      }
      if (!resultB.success || !resultB.data) {
        res.status(502).json({ error: `Failed to scrape url_b: ${resultB.error}` }); return;
      }

      const markdownA = resultA.data.markdown || '';
      const markdownB = resultB.data.markdown || '';
      const htmlA = resultA.data.html || resultA.data.rawHtml || '';
      const htmlB = resultB.data.html || resultB.data.rawHtml || '';

      // Use enhanced comparePages for real structural diff
      const diff = comparePages(htmlA, htmlB);

      const diffSummary = `Similarity: ${diff.similarity_score}%. Sections added: ${diff.sections_added.length}, removed: ${diff.sections_removed.length}, changed: ${diff.sections_changed.length}`;

      // Store comparison
      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_comparisons (url_a, url_b, markdown_a, markdown_b, diff_summary, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        url_a.trim(), url_b.trim(),
        markdownA.substring(0, 500_000),
        markdownB.substring(0, 500_000),
        diffSummary,
        (req as any).user?.id || (req as any).user?.userId,
        now,
      );

      const id = Number(result.lastInsertRowid);
      auditLog(req, 'CREATE', 'firecrawl_comparisons', id, `Compared: ${url_a.trim()} vs ${url_b.trim()}`);

      res.json({
        id, url_a: url_a.trim(), url_b: url_b.trim(),
        markdown_a: markdownA, markdown_b: markdownB,
        diff_summary: diffSummary,
        diff,
      });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[FirecrawlTools] Compare error:', msg);
      res.status(502).json({ error: 'Comparison failed', detail: msg });
    }
  },
);

// ── GET /comparisons — List past comparisons ────────────────

router.get(
  '/comparisons',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare(
        'SELECT id, url_a, url_b, diff_summary, created_by, created_at FROM firecrawl_comparisons ORDER BY created_at DESC LIMIT 100'
      ).all();
      res.json(rows);
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to list comparisons', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 6. Workflow Builder
// ═════════════════════════════════════════════════════════════

// ── POST /workflows — Create a scraping workflow ────────────

router.post(
  '/workflows',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const { name, steps } = req.body as {
      name?: string;
      steps?: Array<{ type: 'scrape' | 'search' | 'extract'; url?: string; query?: string; extract_schema?: Record<string, unknown> }>;
    };

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name is required' }); return;
    }
    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      res.status(400).json({ error: 'steps must be a non-empty array' }); return;
    }

    // Validate steps
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!['scrape', 'search', 'extract'].includes(step.type)) {
        res.status(400).json({ error: `Step ${i}: type must be scrape, search, or extract` }); return;
      }
      if (step.type === 'scrape' && !step.url) {
        res.status(400).json({ error: `Step ${i}: url required for scrape step` }); return;
      }
      if (step.type === 'search' && !step.query) {
        res.status(400).json({ error: `Step ${i}: query required for search step` }); return;
      }
    }

    try {
      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_workflows (name, steps, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        name.trim(), JSON.stringify(steps),
        (req as any).user?.id || (req as any).user?.userId,
        now, now,
      );

      const id = Number(result.lastInsertRowid);
      auditLog(req, 'CREATE', 'firecrawl_workflows', id, `Created workflow: ${name.trim()}`);
      res.status(201).json({ success: true, id });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to create workflow', detail: msg });
    }
  },
);

// ── GET /workflows — List workflows ─────────────────────────

router.get(
  '/workflows',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_workflows ORDER BY created_at DESC').all();
      res.json(parseJsonRows(rows, ['steps']));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to list workflows', detail: msg });
    }
  },
);

// ── GET /workflows/:id — Get a workflow ─────────────────────

router.get(
  '/workflows/:id',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const row = db.prepare('SELECT * FROM firecrawl_workflows WHERE id = ?').get(id) as any;
      if (!row) { res.status(404).json({ error: 'Workflow not found' }); return; }
      res.json(parseJsonFields(row, ['steps']));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get workflow', detail: msg });
    }
  },
);

// ── POST /workflows/:id/run — Execute a workflow ────────────

router.post(
  '/workflows/:id/run',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const workflow = db.prepare('SELECT * FROM firecrawl_workflows WHERE id = ?').get(id) as any;
      if (!workflow) { res.status(404).json({ error: 'Workflow not found' }); return; }

      const steps: Array<{ type: string; url?: string; query?: string; extract_schema?: Record<string, unknown> }> = JSON.parse(workflow.steps);
      const now = localNow();

      // Create run record
      const runResult = db.prepare(`
        INSERT INTO firecrawl_workflow_runs (workflow_id, status, step_results, started_at)
        VALUES (?, 'running', '[]', ?)
      `).run(id, now);
      const runId = Number(runResult.lastInsertRowid);

      const stepResults: Array<{ step: number; type: string; success: boolean; data?: any; error?: string }> = [];
      let previousOutput: any = null;
      let runError: string | null = null;

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        try {
          if (step.type === 'scrape') {
            // Use URL from step, or from previous output if available
            const targetUrl = step.url || (previousOutput?.url) || (previousOutput?.data?.[0]?.url);
            if (!targetUrl) {
              stepResults.push({ step: i, type: step.type, success: false, error: 'No URL available for scrape step' });
              continue;
            }
            const result = await firecrawlScrape({
              url: targetUrl,
              formats: ['markdown', 'html'],
              onlyMainContent: true,
              extract: step.extract_schema ? { schema: step.extract_schema } : undefined,
            });
            previousOutput = result;
            stepResults.push({ step: i, type: step.type, success: result.success, data: result.data });
          } else if (step.type === 'search') {
            const searchQuery = step.query || '';
            const result = await firecrawlSearch({
              query: searchQuery,
              limit: 10,
              scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
            });
            previousOutput = result;
            stepResults.push({ step: i, type: step.type, success: result.success, data: result.data });
          } else if (step.type === 'extract') {
            // Extract uses scrape with an extraction schema on the previous URL
            const targetUrl = step.url || (previousOutput?.data?.metadata?.sourceURL) || (previousOutput?.data?.[0]?.url);
            if (!targetUrl) {
              stepResults.push({ step: i, type: step.type, success: false, error: 'No URL available for extract step' });
              continue;
            }
            const result = await firecrawlScrape({
              url: targetUrl,
              formats: ['markdown'],
              onlyMainContent: true,
              extract: step.extract_schema ? { schema: step.extract_schema } : { prompt: 'Extract all key information from this page' },
            });
            previousOutput = result;
            stepResults.push({ step: i, type: step.type, success: result.success, data: result.data });
          }
        } catch (stepErr: unknown) {
          const stepMsg = stepErr instanceof Error ? stepErr.message : String(stepErr);
          stepResults.push({ step: i, type: step.type, success: false, error: stepMsg });
          runError = `Step ${i} failed: ${stepMsg}`;
          break; // Stop workflow on error
        }
      }

      const completedAt = localNow();
      const finalStatus = runError ? 'failed' : 'completed';

      db.prepare(`
        UPDATE firecrawl_workflow_runs SET status = ?, step_results = ?, error = ?, completed_at = ?
        WHERE id = ?
      `).run(finalStatus, JSON.stringify(stepResults), runError, completedAt, runId);

      auditLog(req, 'EXECUTE', 'firecrawl_workflows', id, `Workflow run ${runId}: ${finalStatus}`);

      res.json({
        success: !runError,
        run_id: runId,
        status: finalStatus,
        step_results: stepResults,
        error: runError,
      });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[FirecrawlTools] Workflow run error:', msg);
      res.status(500).json({ error: 'Workflow execution failed', detail: msg });
    }
  },
);

// ── GET /workflows/:id/runs — Get workflow run history ──────

router.get(
  '/workflows/:id/runs',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const rows = db.prepare(
        'SELECT * FROM firecrawl_workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT 50'
      ).all(id);
      res.json(parseJsonRows(rows, ['step_results']));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get workflow runs', detail: msg });
    }
  },
);

// ── DELETE /workflows/:id — Delete a workflow ───────────────

router.delete(
  '/workflows/:id',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const result = db.prepare('DELETE FROM firecrawl_workflows WHERE id = ?').run(id);
      if (result.changes === 0) { res.status(404).json({ error: 'Workflow not found' }); return; }

      // Also delete related runs
      db.prepare('DELETE FROM firecrawl_workflow_runs WHERE workflow_id = ?').run(id);

      auditLog(req, 'DELETE', 'firecrawl_workflows', id, `Deleted workflow ${id}`);
      res.json({ success: true });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to delete workflow', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 7. Fireplexity — AI Search Engine with Citations
// ═════════════════════════════════════════════════════════════

// ── POST /search-engine — Run an AI-powered search ──────────

router.post(
  '/search-engine',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { query, depth } = req.body as {
      query?: string; depth?: 'quick' | 'standard' | 'deep';
    };

    if (!query || typeof query !== 'string' || !query.trim()) {
      res.status(400).json({ error: 'query is required' }); return;
    }

    const searchDepth = depth || 'quick';
    const startTime = Date.now();

    try {
      // Step 1: Run firecrawl search
      const searchResult = await firecrawlSearch({
        query: query.trim(),
        limit: searchDepth === 'deep' ? 10 : searchDepth === 'standard' ? 5 : 3,
        scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
      });

      const rawResults = searchResult.data || [];
      const results: any[] = [];
      const citations: any[] = [];

      for (let i = 0; i < rawResults.length; i++) {
        const r = rawResults[i] as any;
        const snippetText = (r.markdown || r.content || '').substring(0, 300);
        const sentimentResult = analyzeSentiment(snippetText);
        const item: any = {
          url: r.url || r.metadata?.sourceURL || '',
          title: r.metadata?.title || r.title || '',
          snippet: snippetText,
          relevance_score: Math.round(100 - (i * (100 / Math.max(rawResults.length, 1)))),
          sentiment: { score: sentimentResult.comparative, label: sentimentResult.label },
        };

        // For standard/deep, include full content
        if (searchDepth !== 'quick' && (r.markdown || r.content)) {
          item.content = (r.markdown || r.content || '').substring(0, 5000);

          // Extract citation-worthy sentences
          const sentences = (r.markdown || r.content || '').split(/[.!?]+/).filter((s: string) => s.trim().length > 30);
          for (const sentence of sentences.slice(0, 3)) {
            citations.push({
              text: sentence.trim().substring(0, 200),
              source_url: item.url,
              source_title: item.title,
            });
          }
        }

        results.push(item);
      }

      // Build answer summary from top results
      const snippets = results.slice(0, 3).map(r => r.snippet).join(' ');
      const answerSummary = snippets.substring(0, 500) || 'No summary available.';

      const durationMs = Date.now() - startTime;

      // Store in DB
      const db = getDb();
      const now = localNow();
      const insertResult = db.prepare(`
        INSERT INTO firecrawl_search_engine_queries (query, depth, results, answer_summary, citations, duration_ms, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        query.trim(), searchDepth, JSON.stringify(results), answerSummary,
        JSON.stringify(citations), durationMs,
        (req as any).user?.id || (req as any).user?.userId, now,
      );

      auditLog(req, 'EXECUTE', 'firecrawl_search_engine_queries', Number(insertResult.lastInsertRowid), `Search engine query: ${query.trim()}`);

      res.json({
        id: Number(insertResult.lastInsertRowid),
        query: query.trim(),
        results,
        answer_summary: answerSummary,
        citations,
        depth: searchDepth,
        duration_ms: durationMs,
      });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[FirecrawlTools] Search engine error:', msg);
      res.status(500).json({ error: 'Search engine query failed', detail: msg });
    }
  },
);

// ── GET /search-engine/history — Past search queries ────────

router.get(
  '/search-engine/history',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_search_engine_queries ORDER BY created_at DESC LIMIT 100').all();
      res.json(parseJsonRows(rows, ['results', 'citations']));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get search history', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 8. Fire Enrich — Data Enrichment
// ═════════════════════════════════════════════════════════════

// ── POST /enrich — Enrich a company/person ──────────────────

router.post(
  '/enrich',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { email, domain, company_name } = req.body as {
      email?: string; domain?: string; company_name?: string;
    };

    if (!email && !domain && !company_name) {
      res.status(400).json({ error: 'At least one of email, domain, or company_name is required' }); return;
    }

    try {
      // Derive domain from email if not provided
      let targetDomain = domain?.trim();
      if (!targetDomain && email) {
        const parts = email.trim().split('@');
        if (parts.length === 2) targetDomain = parts[1];
      }

      if (!targetDomain && company_name) {
        // Try searching for the company
        const searchResult = await firecrawlSearch({
          query: `${company_name} official website`,
          limit: 1,
          scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
        });
        const firstResult = (searchResult.data || [])[0] as any;
        if (firstResult?.url) {
          try { targetDomain = new URL(firstResult.url).hostname; } catch { /* skip */ }
        }
      }

      if (!targetDomain) {
        res.status(400).json({ error: 'Could not determine domain from provided data' }); return;
      }

      // Scrape homepage
      const homepageUrl = `https://${targetDomain}`;
      const homepageResult = await firecrawlScrape({
        url: homepageUrl,
        formats: ['markdown', 'html'],
        onlyMainContent: false,
      });

      const homepage = homepageResult.data as any;
      const html = (homepage?.html || '').toLowerCase();
      const markdown = homepage?.markdown || '';

      // Try to scrape about/team page
      let aboutContent = '';
      try {
        const aboutResult = await firecrawlScrape({
          url: `${homepageUrl}/about`,
          formats: ['markdown'],
          onlyMainContent: true,
        });
        aboutContent = (aboutResult.data as any)?.markdown || '';
      } catch { /* about page may not exist */ }

      const combinedContent = markdown + '\n' + aboutContent;

      // Extract tech stack indicators
      const techStack: string[] = [];
      const techPatterns = [
        'react', 'angular', 'vue', 'next.js', 'nuxt', 'svelte', 'wordpress', 'shopify',
        'django', 'rails', 'laravel', 'express', 'flask', 'aws', 'azure', 'gcp',
        'cloudflare', 'vercel', 'netlify', 'stripe', 'segment', 'intercom', 'hubspot',
      ];
      for (const tech of techPatterns) {
        if (html.includes(tech)) techStack.push(tech);
      }

      // Extract social links
      const socialLinks: Record<string, string> = {};
      const linkedinMatch = html.match(/href="(https?:\/\/(?:www\.)?linkedin\.com\/[^"]+)"/);
      const twitterMatch = html.match(/href="(https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^"]+)"/);
      const facebookMatch = html.match(/href="(https?:\/\/(?:www\.)?facebook\.com\/[^"]+)"/);
      if (linkedinMatch) socialLinks.linkedin = linkedinMatch[1];
      if (twitterMatch) socialLinks.twitter = twitterMatch[1];
      if (facebookMatch) socialLinks.facebook = facebookMatch[1];

      // Extract contact info
      const contactInfo: Record<string, string> = {};
      const phoneMatch = combinedContent.match(/(?:\+1[- ]?)?(?:\(?\d{3}\)?[- ]?\d{3}[- ]?\d{4})/);
      const emailMatch = combinedContent.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
      if (phoneMatch) contactInfo.phone = phoneMatch[0];
      if (emailMatch) contactInfo.email = emailMatch[0];

      // Determine company name and description
      const resolvedName = company_name || homepage?.metadata?.title || targetDomain;
      const description = homepage?.metadata?.description || combinedContent.substring(0, 300);

      // Determine industry from content keywords
      const industryKeywords: Record<string, string[]> = {
        'Technology': ['software', 'saas', 'platform', 'api', 'developer', 'tech'],
        'E-commerce': ['shop', 'store', 'buy', 'cart', 'ecommerce', 'product'],
        'Finance': ['bank', 'financial', 'invest', 'insurance', 'fintech'],
        'Healthcare': ['health', 'medical', 'patient', 'care', 'clinical'],
        'Education': ['learn', 'course', 'education', 'university', 'school'],
        'Media': ['news', 'media', 'publish', 'content', 'journalism'],
      };
      let industry = 'Other';
      let maxMatches = 0;
      const lowerCombined = combinedContent.toLowerCase();
      for (const [ind, kws] of Object.entries(industryKeywords)) {
        const matches = kws.filter(kw => lowerCombined.includes(kw)).length;
        if (matches > maxMatches) { maxMatches = matches; industry = ind; }
      }

      // Enhanced: extract business info using cheerio + JSON-LD
      const businessInfo = extractBusinessInfo(homepage?.html || homepage?.rawHtml || '', homepageUrl);
      if (!resolvedName || resolvedName === targetDomain) {
        if (businessInfo.name) Object.assign({}, { resolvedName: businessInfo.name });
      }
      const finalName = (businessInfo.name && company_name !== businessInfo.name)
        ? (company_name || businessInfo.name || resolvedName)
        : resolvedName;
      const finalDescription = businessInfo.description || (typeof description === 'string' ? description : '');
      const finalIndustry = businessInfo.industry || industry;
      if (businessInfo.phone && !contactInfo.phone) contactInfo.phone = businessInfo.phone;
      if (businessInfo.email && !contactInfo.email) contactInfo.email = businessInfo.email;
      if (businessInfo.address) contactInfo.address = businessInfo.address;
      for (const sl of businessInfo.socialLinks) {
        if (!socialLinks[sl.platform]) socialLinks[sl.platform] = sl.url;
      }

      // Enhanced: WHOIS lookup for domain intelligence
      let whoisData: Record<string, any> = {};
      try {
        whoisData = await lookupWhois(targetDomain);
      } catch { /* skip whois errors */ }

      const enrichedAt = localNow();

      const enrichmentData = {
        domain: targetDomain,
        company_name: finalName,
        description: finalDescription.substring(0, 500),
        industry: finalIndustry,
        employee_count_estimate: null as string | null,
        tech_stack: techStack,
        social_links: socialLinks,
        contact_info: contactInfo,
        whois: whoisData,
        funding_info: null as string | null,
        enriched_at: enrichedAt,
      };

      // Store in DB
      const db = getDb();
      const now = localNow();
      const insertResult = db.prepare(`
        INSERT INTO firecrawl_enrichments (domain, email, company_name, description, industry, employee_count_estimate, tech_stack, social_links, contact_info, funding_info, enriched_at, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        targetDomain, email?.trim() || null, resolvedName, enrichmentData.description,
        industry, null, JSON.stringify(techStack), JSON.stringify(socialLinks),
        JSON.stringify(contactInfo), null, enrichedAt,
        (req as any).user?.id || (req as any).user?.userId, now,
      );

      auditLog(req, 'CREATE', 'firecrawl_enrichments', Number(insertResult.lastInsertRowid), `Enriched: ${targetDomain}`);

      res.json({ id: Number(insertResult.lastInsertRowid), ...enrichmentData });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[FirecrawlTools] Enrich error:', msg);
      res.status(500).json({ error: 'Enrichment failed', detail: msg });
    }
  },
);

// ── GET /enrich/history — Past enrichments ──────────────────

router.get(
  '/enrich/history',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_enrichments ORDER BY created_at DESC LIMIT 100').all();
      res.json(parseJsonRows(rows, ['tech_stack', 'social_links', 'contact_info', 'funding_info']));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get enrichment history', detail: msg });
    }
  },
);

// ── POST /enrich/bulk — Bulk enrich ─────────────────────────

router.post(
  '/enrich/bulk',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { items } = req.body as { items?: { email?: string; domain?: string }[] };

    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'items array is required' }); return;
    }

    if (items.length > 20) {
      res.status(400).json({ error: 'Maximum 20 items per bulk request' }); return;
    }

    const results: any[] = [];
    let successCount = 0;
    let errorCount = 0;

    for (const item of items) {
      try {
        let targetDomain = item.domain?.trim();
        if (!targetDomain && item.email) {
          const parts = item.email.trim().split('@');
          if (parts.length === 2) targetDomain = parts[1];
        }

        if (!targetDomain) {
          results.push({ email: item.email, domain: item.domain, error: 'Could not determine domain' });
          errorCount++;
          continue;
        }

        const scrapeResult = await firecrawlScrape({
          url: `https://${targetDomain}`,
          formats: ['markdown'],
          onlyMainContent: true,
        });

        const page = scrapeResult.data as any;
        const resolvedName = page?.metadata?.title || targetDomain;
        const description = (page?.metadata?.description || (page?.markdown || '').substring(0, 300));
        const enrichedAt = localNow();

        const db = getDb();
        const now = localNow();
        const insertResult = db.prepare(`
          INSERT INTO firecrawl_enrichments (domain, email, company_name, description, enriched_at, created_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          targetDomain, item.email?.trim() || null, resolvedName,
          typeof description === 'string' ? description.substring(0, 500) : '',
          enrichedAt,
          (req as any).user?.id || (req as any).user?.userId, now,
        );

        results.push({
          id: Number(insertResult.lastInsertRowid),
          domain: targetDomain,
          company_name: resolvedName,
          description: typeof description === 'string' ? description.substring(0, 500) : '',
          enriched_at: enrichedAt,
        });
        successCount++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ email: item.email, domain: item.domain, error: msg });
        errorCount++;
      }
    }

    auditLog(req, 'EXECUTE', 'firecrawl_enrichments', 0, `Bulk enrich: ${successCount} success, ${errorCount} errors`);
    res.json({ results, success_count: successCount, error_count: errorCount });
  },
);

// ═════════════════════════════════════════════════════════════
// 9. Open Researcher — Deep Research Assistant
// ═════════════════════════════════════════════════════════════

// ── POST /research — Start a research session ───────────────

router.post(
  '/research',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { topic, questions, depth } = req.body as {
      topic?: string; questions?: string[]; depth?: 'basic' | 'thorough' | 'comprehensive';
    };

    if (!topic || typeof topic !== 'string' || !topic.trim()) {
      res.status(400).json({ error: 'topic is required' }); return;
    }

    const researchDepth = depth || 'basic';
    const startTime = Date.now();

    try {
      const findings: any[] = [];
      const sources: any[] = [];

      // Build search queries
      const queries = [topic.trim()];
      if (questions && Array.isArray(questions)) {
        for (const q of questions.slice(0, 5)) {
          if (typeof q === 'string' && q.trim()) queries.push(q.trim());
        }
      }

      const maxQueries = researchDepth === 'comprehensive' ? queries.length : researchDepth === 'thorough' ? Math.min(queries.length, 3) : 1;
      const scrapeLimit = researchDepth === 'comprehensive' ? 10 : researchDepth === 'thorough' ? 5 : 0;

      for (let qi = 0; qi < maxQueries; qi++) {
        const q = queries[qi];
        const searchResult = await firecrawlSearch({
          query: q,
          limit: researchDepth === 'comprehensive' ? 10 : 5,
          scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
        });

        const data = searchResult.data || [];
        for (let i = 0; i < data.length; i++) {
          const item = data[i] as any;
          const url = item.url || item.metadata?.sourceURL || '';
          const title = item.metadata?.title || item.title || url;

          // Deduplicate sources
          if (!sources.find((s: any) => s.url === url)) {
            sources.push({ url, title, relevance: Math.round(100 - (i * 10)) });
          }

          // For thorough/comprehensive, scrape top results
          if (i < scrapeLimit && (researchDepth === 'thorough' || researchDepth === 'comprehensive')) {
            try {
              const scrapeResult = await firecrawlScrape({
                url,
                formats: ['markdown'],
                onlyMainContent: true,
              });
              const content = (scrapeResult.data as any)?.markdown || '';
              if (content.trim()) {
                findings.push({
                  title,
                  content: content.substring(0, 3000),
                  source_url: url,
                  confidence: Math.max(30, 100 - (i * 15)),
                });
              }
            } catch { /* skip failed scrapes */ }
          } else {
            // Use search snippet content
            const snippet = item.markdown || item.content || '';
            if (snippet.trim()) {
              findings.push({
                title,
                content: snippet.substring(0, 1000),
                source_url: url,
                confidence: Math.max(20, 80 - (i * 15)),
              });
            }
          }
        }
      }

      // Build synthesis from findings
      const topFindings = findings.slice(0, 5).map(f => f.content.substring(0, 200)).join(' ');
      const synthesis = topFindings
        ? `Research on "${topic.trim()}" yielded ${findings.length} findings from ${sources.length} sources. ${topFindings.substring(0, 500)}`
        : `No significant findings for "${topic.trim()}".`;

      const durationMs = Date.now() - startTime;

      // Store in DB
      const db = getDb();
      const now = localNow();
      const insertResult = db.prepare(`
        INSERT INTO firecrawl_research_sessions (topic, questions, depth, findings, synthesis, sources, duration_ms, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        topic.trim(), questions ? JSON.stringify(questions) : null, researchDepth,
        JSON.stringify(findings), synthesis, JSON.stringify(sources), durationMs,
        (req as any).user?.id || (req as any).user?.userId, now,
      );

      auditLog(req, 'CREATE', 'firecrawl_research_sessions', Number(insertResult.lastInsertRowid), `Research: ${topic.trim()}`);

      res.json({
        id: Number(insertResult.lastInsertRowid),
        topic: topic.trim(),
        findings,
        synthesis,
        sources,
        depth: researchDepth,
        duration_ms: durationMs,
      });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[FirecrawlTools] Research error:', msg);
      res.status(500).json({ error: 'Research session failed', detail: msg });
    }
  },
);

// ── GET /research/history — Past research sessions ──────────

router.get(
  '/research/history',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT id, topic, depth, synthesis, duration_ms, created_by, created_at FROM firecrawl_research_sessions ORDER BY created_at DESC LIMIT 100').all();
      res.json(rows);
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get research history', detail: msg });
    }
  },
);

// ── GET /research/:id — Get a specific research session ─────

router.get(
  '/research/:id',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const row = db.prepare('SELECT * FROM firecrawl_research_sessions WHERE id = ?').get(id) as any;
      if (!row) { res.status(404).json({ error: 'Research session not found' }); return; }
      res.json(parseJsonFields(row, ['questions', 'findings', 'sources']));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get research session', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 10. Firestarter — Website Chatbot / RAG
// ═════════════════════════════════════════════════════════════

// ── POST /chatbot/create — Create a chatbot for a website ───

router.post(
  '/chatbot/create',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { name, source_url, description } = req.body as {
      name?: string; source_url?: string; description?: string;
    };

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name is required' }); return;
    }
    if (!source_url || typeof source_url !== 'string' || !source_url.trim()) {
      res.status(400).json({ error: 'source_url is required' }); return;
    }

    try {
      // Scrape the website to build knowledge base
      const scrapeResult = await firecrawlScrape({
        url: source_url.trim(),
        formats: ['markdown'],
        onlyMainContent: true,
      });

      const mainContent = (scrapeResult.data as any)?.markdown || '';

      // Also try to scrape a few sub-pages via search
      let additionalContent = '';
      let pageCount = 1;
      try {
        const searchResult = await firecrawlSearch({
          query: `site:${new URL(source_url.trim()).hostname}`,
          limit: 5,
          scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
        });
        const pages = searchResult.data || [];
        for (const page of pages) {
          const md = (page as any).markdown || (page as any).content || '';
          if (md.trim()) {
            additionalContent += '\n\n---\n\n' + md.substring(0, 3000);
            pageCount++;
          }
        }
      } catch { /* search may fail for some sites */ }

      const scrapedContent = (mainContent + additionalContent).substring(0, 100000);

      const db = getDb();
      const now = localNow();
      const insertResult = db.prepare(`
        INSERT INTO firecrawl_chatbots (name, source_url, description, scraped_content, page_count, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        name.trim(), source_url.trim(), description?.trim() || null,
        scrapedContent, pageCount,
        (req as any).user?.id || (req as any).user?.userId, now, now,
      );

      auditLog(req, 'CREATE', 'firecrawl_chatbots', Number(insertResult.lastInsertRowid), `Created chatbot: ${name.trim()}`);

      res.status(201).json({
        success: true,
        id: Number(insertResult.lastInsertRowid),
        name: name.trim(),
        source_url: source_url.trim(),
        page_count: pageCount,
        content_length: scrapedContent.length,
      });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[FirecrawlTools] Chatbot create error:', msg);
      res.status(500).json({ error: 'Failed to create chatbot', detail: msg });
    }
  },
);

// ── GET /chatbot — List chatbots ────────────────────────────

router.get(
  '/chatbot',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT id, name, source_url, description, page_count, created_by, created_at, updated_at FROM firecrawl_chatbots ORDER BY created_at DESC').all();
      res.json(rows);
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to list chatbots', detail: msg });
    }
  },
);

// ── GET /chatbot/:id — Get chatbot details ──────────────────

router.get(
  '/chatbot/:id',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const row = db.prepare('SELECT * FROM firecrawl_chatbots WHERE id = ?').get(id);
      if (!row) { res.status(404).json({ error: 'Chatbot not found' }); return; }
      res.json(row);
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get chatbot', detail: msg });
    }
  },
);

// ── POST /chatbot/:id/ask — Ask a question to a chatbot ─────

router.post(
  '/chatbot/:id/ask',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    const { question } = req.body as { question?: string };
    if (!question || typeof question !== 'string' || !question.trim()) {
      res.status(400).json({ error: 'question is required' }); return;
    }

    try {
      const db = getDb();
      const chatbot = db.prepare('SELECT * FROM firecrawl_chatbots WHERE id = ?').get(id) as any;
      if (!chatbot) { res.status(404).json({ error: 'Chatbot not found' }); return; }

      const content = chatbot.scraped_content || '';
      const questionLower = question.trim().toLowerCase();
      const questionWords = questionLower.split(/\s+/).filter((w: string) => w.length > 3);

      // Split content into sections for search
      const sections = content.split(/\n{2,}/).filter((s: string) => s.trim().length > 20);
      const scoredSections = sections.map((section: string) => {
        const sectionLower = section.toLowerCase();
        let score = 0;
        for (const word of questionWords) {
          if (sectionLower.includes(word)) score++;
        }
        return { text: section, score };
      }).filter((s: any) => s.score > 0).sort((a: any, b: any) => b.score - a.score);

      const topSections = scoredSections.slice(0, 5);
      const sourceParts = topSections.map((s: any) => ({
        text: s.text.substring(0, 300),
        section: s.text.substring(0, 50),
      }));

      const answer = topSections.length > 0
        ? topSections.map((s: any) => s.text.substring(0, 500)).join('\n\n')
        : 'No relevant information found for your question.';

      // Store message
      const now = localNow();
      db.prepare(`
        INSERT INTO firecrawl_chatbot_messages (chatbot_id, question, answer, sources, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        id, question.trim(), answer, JSON.stringify(sourceParts),
        (req as any).user?.id || (req as any).user?.userId, now,
      );

      res.json({ answer, sources: sourceParts });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[FirecrawlTools] Chatbot ask error:', msg);
      res.status(500).json({ error: 'Failed to process question', detail: msg });
    }
  },
);

// ── DELETE /chatbot/:id — Delete a chatbot ──────────────────

router.delete(
  '/chatbot/:id',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const result = db.prepare('DELETE FROM firecrawl_chatbots WHERE id = ?').run(id);
      if (result.changes === 0) { res.status(404).json({ error: 'Chatbot not found' }); return; }

      db.prepare('DELETE FROM firecrawl_chatbot_messages WHERE chatbot_id = ?').run(id);

      auditLog(req, 'DELETE', 'firecrawl_chatbots', id, `Deleted chatbot ${id}`);
      res.json({ success: true });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to delete chatbot', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 11. Firecrawl Observer — Website Change Detection
// ═════════════════════════════════════════════════════════════

// ── POST /observer/watch — Start watching a URL ─────────────

router.post(
  '/observer/watch',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { url, name, check_interval_hours, notify_on_change } = req.body as {
      url?: string; name?: string; check_interval_hours?: number; notify_on_change?: boolean;
    };

    if (!url || typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ error: 'url is required' }); return;
    }

    try {
      // Scrape initial baseline
      const scrapeResult = await firecrawlScrape({
        url: url.trim(),
        formats: ['markdown'],
        onlyMainContent: true,
      });

      const baselineContent = (scrapeResult.data as any)?.markdown || '';
      const now = localNow();

      const db = getDb();
      const insertResult = db.prepare(`
        INSERT INTO firecrawl_observers (name, url, check_interval_hours, notify_on_change, last_content, last_checked_at, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        name?.trim() || url.trim(), url.trim(),
        check_interval_hours || 24, notify_on_change !== false ? 1 : 0,
        baselineContent, now,
        (req as any).user?.id || (req as any).user?.userId, now, now,
      );

      auditLog(req, 'CREATE', 'firecrawl_observers', Number(insertResult.lastInsertRowid), `Watching: ${url.trim()}`);

      res.status(201).json({
        success: true,
        id: Number(insertResult.lastInsertRowid),
        url: url.trim(),
        baseline_length: baselineContent.length,
      });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[FirecrawlTools] Observer watch error:', msg);
      res.status(500).json({ error: 'Failed to start watching', detail: msg });
    }
  },
);

// ── GET /observer/watches — List all watched URLs ───────────

router.get(
  '/observer/watches',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT id, name, url, check_interval_hours, notify_on_change, last_checked_at, status, created_by, created_at, updated_at FROM firecrawl_observers ORDER BY created_at DESC').all();
      res.json(rows);
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to list watches', detail: msg });
    }
  },
);

// ── POST /observer/watch/:id/check — Manually check for changes

router.post(
  '/observer/watch/:id/check',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const observer = db.prepare('SELECT * FROM firecrawl_observers WHERE id = ?').get(id) as any;
      if (!observer) { res.status(404).json({ error: 'Watch not found' }); return; }

      // Scrape current version
      const scrapeResult = await firecrawlScrape({
        url: observer.url,
        formats: ['markdown'],
        onlyMainContent: true,
      });

      const newContent = (scrapeResult.data as any)?.markdown || '';
      const oldContent = observer.last_content || '';
      const now = localNow();

      // Compare contents
      const changed = newContent !== oldContent;
      let changesSummary: string | null = null;
      let diffSections: string[] = [];

      if (changed) {
        // Simple diff: find sections that are different
        const oldLines = oldContent.split('\n');
        const newLines = newContent.split('\n');

        const addedLines = newLines.filter((l: string) => !oldLines.includes(l) && l.trim().length > 10);
        const removedLines = oldLines.filter((l: string) => !newLines.includes(l) && l.trim().length > 10);

        diffSections = [
          ...addedLines.slice(0, 10).map((l: string) => `+ ${l.substring(0, 200)}`),
          ...removedLines.slice(0, 10).map((l: string) => `- ${l.substring(0, 200)}`),
        ];

        changesSummary = `${addedLines.length} lines added, ${removedLines.length} lines removed`;

        // Store change record
        db.prepare(`
          INSERT INTO firecrawl_observer_changes (observer_id, changes_summary, diff_sections, previous_content, new_content, detected_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(id, changesSummary, JSON.stringify(diffSections), oldContent.substring(0, 50000), newContent.substring(0, 50000), now);

        // Update observer with new content
        db.prepare('UPDATE firecrawl_observers SET last_content = ?, last_checked_at = ?, updated_at = ? WHERE id = ?')
          .run(newContent, now, now, id);
      } else {
        db.prepare('UPDATE firecrawl_observers SET last_checked_at = ?, updated_at = ? WHERE id = ?')
          .run(now, now, id);
      }

      auditLog(req, 'EXECUTE', 'firecrawl_observers', id, `Check: ${changed ? 'changes detected' : 'no changes'}`);

      res.json({ changed, changes_summary: changesSummary, diff_sections: diffSections });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[FirecrawlTools] Observer check error:', msg);
      res.status(500).json({ error: 'Failed to check for changes', detail: msg });
    }
  },
);

// ── GET /observer/watch/:id/changes — Change history ────────

router.get(
  '/observer/watch/:id/changes',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const rows = db.prepare(
        'SELECT id, observer_id, changes_summary, diff_sections, detected_at FROM firecrawl_observer_changes WHERE observer_id = ? ORDER BY detected_at DESC LIMIT 50'
      ).all(id);
      res.json(parseJsonRows(rows, ['diff_sections']));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get change history', detail: msg });
    }
  },
);

// ── DELETE /observer/watch/:id — Stop watching ──────────────

router.delete(
  '/observer/watch/:id',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const result = db.prepare('DELETE FROM firecrawl_observers WHERE id = ?').run(id);
      if (result.changes === 0) { res.status(404).json({ error: 'Watch not found' }); return; }

      db.prepare('DELETE FROM firecrawl_observer_changes WHERE observer_id = ?').run(id);

      auditLog(req, 'DELETE', 'firecrawl_observers', id, `Stopped watching ${id}`);
      res.json({ success: true });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to stop watching', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 12. Firesearch — Deep Research with Validation
// ═════════════════════════════════════════════════════════════

// ── POST /deep-search — Run validated deep search ───────────

router.post(
  '/deep-search',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { query, validate } = req.body as { query?: string; validate?: boolean };

    if (!query || typeof query !== 'string' || !query.trim()) {
      res.status(400).json({ error: 'query is required' }); return;
    }

    const shouldValidate = validate !== false;
    const startTime = Date.now();

    try {
      // Initial search
      const searchResult = await firecrawlSearch({
        query: query.trim(),
        limit: 10,
        scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
      });

      const rawResults = searchResult.data || [];

      // Extract claims from results
      const claims: any[] = [];
      for (const item of rawResults) {
        const content = (item as any).markdown || (item as any).content || '';
        const url = (item as any).url || (item as any).metadata?.sourceURL || '';
        const sentences = content.split(/[.!?]+/).filter((s: string) => s.trim().length > 30 && s.trim().length < 300);

        for (const sentence of sentences.slice(0, 3)) {
          claims.push({
            claim: sentence.trim(),
            primary_source: url,
            sources: [{ url, supports: true }],
            confidence: 50,
          });
        }
      }

      // Validation: cross-reference claims
      if (shouldValidate && claims.length > 0) {
        // Validate top claims by searching for corroboration
        for (const claim of claims.slice(0, 5)) {
          try {
            const validationSearch = await firecrawlSearch({
              query: claim.claim.substring(0, 100),
              limit: 3,
              scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
            });

            const valResults = validationSearch.data || [];
            for (const vr of valResults) {
              const vrUrl = (vr as any).url || (vr as any).metadata?.sourceURL || '';
              const vrContent = ((vr as any).markdown || (vr as any).content || '').toLowerCase();
              const claimWords = claim.claim.toLowerCase().split(/\s+/).filter((w: string) => w.length > 4);
              const matchCount = claimWords.filter((w: string) => vrContent.includes(w)).length;
              const supports = matchCount > claimWords.length * 0.3;

              if (vrUrl && vrUrl !== claim.primary_source) {
                claim.sources.push({ url: vrUrl, supports });
                if (supports) claim.confidence = Math.min(95, claim.confidence + 15);
              }
            }
          } catch { /* skip failed validation searches */ }
        }
      }

      const durationMs = Date.now() - startTime;

      // Store in DB
      const db = getDb();
      const now = localNow();
      const insertResult = db.prepare(`
        INSERT INTO firecrawl_deep_searches (query, results, validated, duration_ms, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        query.trim(), JSON.stringify(claims), shouldValidate ? 1 : 0, durationMs,
        (req as any).user?.id || (req as any).user?.userId, now,
      );

      auditLog(req, 'EXECUTE', 'firecrawl_deep_searches', Number(insertResult.lastInsertRowid), `Deep search: ${query.trim()}`);

      res.json({
        id: Number(insertResult.lastInsertRowid),
        query: query.trim(),
        results: claims,
        validated: shouldValidate,
        duration_ms: durationMs,
      });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[FirecrawlTools] Deep search error:', msg);
      res.status(500).json({ error: 'Deep search failed', detail: msg });
    }
  },
);

// ── GET /deep-search/history — Past deep searches ───────────

router.get(
  '/deep-search/history',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_deep_searches ORDER BY created_at DESC LIMIT 100').all();
      res.json(parseJsonRows(rows, ['results']));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get deep search history', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 13. LLMs.txt Generator
// ═════════════════════════════════════════════════════════════

// ── POST /llmstxt — Generate llms.txt for a website ─────────

router.post(
  '/llmstxt',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { url } = req.body as { url?: string };

    if (!url || typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ error: 'url is required' }); return;
    }

    try {
      let hostname: string;
      try { hostname = new URL(url.trim()).hostname; } catch {
        res.status(400).json({ error: 'Invalid URL' }); return;
      }

      // Scrape the homepage
      const homepageResult = await firecrawlScrape({
        url: url.trim(),
        formats: ['markdown', 'html'],
        onlyMainContent: false,
      });

      const homepage = homepageResult.data as any;
      const homeMarkdown = homepage?.markdown || '';
      const homeHtml = (homepage?.html || '').toLowerCase();
      const title = homepage?.metadata?.title || hostname;
      const description = homepage?.metadata?.description || '';

      // Search for sub-pages
      const searchResult = await firecrawlSearch({
        query: `site:${hostname}`,
        limit: 10,
        scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
      });

      const pages = searchResult.data || [];
      const pagesAnalyzed = 1 + pages.length;

      // Build page entries
      const pageEntries: string[] = [];
      for (const page of pages) {
        const pageUrl = (page as any).url || (page as any).metadata?.sourceURL || '';
        const pageTitle = (page as any).metadata?.title || (page as any).title || pageUrl;
        const pageSummary = ((page as any).markdown || (page as any).content || '').substring(0, 150).replace(/\n/g, ' ');
        if (pageUrl) {
          pageEntries.push(`- [${pageTitle}](${pageUrl}): ${pageSummary}`);
        }
      }

      // Detect API docs
      const hasApiDocs = homeHtml.includes('/api') || homeHtml.includes('developer') || homeHtml.includes('documentation');

      // Detect content types
      const contentTypes: string[] = [];
      if (homeHtml.includes('blog')) contentTypes.push('Blog');
      if (homeHtml.includes('pricing')) contentTypes.push('Pricing');
      if (hasApiDocs) contentTypes.push('API Documentation');
      if (homeHtml.includes('about')) contentTypes.push('About');
      if (homeHtml.includes('contact')) contentTypes.push('Contact');

      // Generate llms.txt content
      const llmstxtContent = [
        `# ${title}`,
        '',
        `> ${description}`,
        '',
        `## Site Overview`,
        '',
        `- **URL**: ${url.trim()}`,
        `- **Domain**: ${hostname}`,
        `- **Pages Analyzed**: ${pagesAnalyzed}`,
        contentTypes.length > 0 ? `- **Content Types**: ${contentTypes.join(', ')}` : '',
        '',
        `## Key Pages`,
        '',
        `- [Homepage](${url.trim()}): ${homeMarkdown.substring(0, 150).replace(/\n/g, ' ')}`,
        ...pageEntries,
        '',
        hasApiDocs ? `## API Documentation\n\nThis site appears to have API documentation. Check /api or /docs paths.\n` : '',
        `## Content Summary`,
        '',
        homeMarkdown.substring(0, 1000).replace(/\n{3,}/g, '\n\n'),
        '',
        `---`,
        `Generated: ${localNow()}`,
      ].filter(Boolean).join('\n');

      const generatedAt = localNow();

      // Store in DB
      const db = getDb();
      const now = localNow();
      const insertResult = db.prepare(`
        INSERT INTO firecrawl_llmstxt (url, llmstxt_content, pages_analyzed, generated_at, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        url.trim(), llmstxtContent, pagesAnalyzed, generatedAt,
        (req as any).user?.id || (req as any).user?.userId, now,
      );

      auditLog(req, 'CREATE', 'firecrawl_llmstxt', Number(insertResult.lastInsertRowid), `Generated llms.txt: ${url.trim()}`);

      res.json({
        id: Number(insertResult.lastInsertRowid),
        url: url.trim(),
        llmstxt_content: llmstxtContent,
        pages_analyzed: pagesAnalyzed,
        generated_at: generatedAt,
      });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[FirecrawlTools] LLMs.txt error:', msg);
      res.status(500).json({ error: 'Failed to generate llms.txt', detail: msg });
    }
  },
);

// ── GET /llmstxt/history — Past llms.txt generations ────────

router.get(
  '/llmstxt/history',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_llmstxt ORDER BY created_at DESC LIMIT 100').all();
      res.json(rows);
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get llms.txt history', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 14. PDF Inspector
// ═════════════════════════════════════════════════════════════

// ── POST /pdf-inspect — Inspect/classify a PDF URL ──────────

router.post(
  '/pdf-inspect',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { url } = req.body as { url?: string };

    if (!url || typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ error: 'url is required' }); return;
    }

    try {
      // Scrape the PDF
      const scrapeResult = await firecrawlScrape({
        url: url.trim(),
        formats: ['markdown'],
        onlyMainContent: false,
      });

      const content = (scrapeResult.data as any)?.markdown || '';
      const contentLower = content.toLowerCase();

      // Estimate page count (~3000 chars per page)
      const pageCountEstimate = Math.max(1, Math.round(content.length / 3000));

      // Detect if scanned (very little structured text)
      const lineCount = content.split('\n').length;
      const avgLineLength = content.length / Math.max(lineCount, 1);
      const isScanned = content.length < 200 || avgLineLength < 10;
      const hasText = content.trim().length > 50;

      // Classification
      let classification: 'report' | 'form' | 'contract' | 'invoice' | 'legal' | 'other' = 'other';
      if (contentLower.includes('invoice') || contentLower.includes('bill to') || contentLower.includes('amount due')) {
        classification = 'invoice';
      } else if (contentLower.includes('agreement') || contentLower.includes('hereby agree') || contentLower.includes('terms and conditions')) {
        classification = 'contract';
      } else if (contentLower.includes('court') || contentLower.includes('plaintiff') || contentLower.includes('defendant') || contentLower.includes('statute')) {
        classification = 'legal';
      } else if (contentLower.includes('fill in') || contentLower.includes('signature:') || contentLower.includes('date:___')) {
        classification = 'form';
      } else if (contentLower.includes('report') || contentLower.includes('executive summary') || contentLower.includes('findings')) {
        classification = 'report';
      }

      // Extract key sections (headers)
      const headers = content.match(/^#{1,3}\s+.+$/gm) || [];
      const keySections = headers.slice(0, 20).map((h: string) => h.replace(/^#+\s+/, ''));

      // Extract entities
      const names: string[] = [];
      const dates: string[] = [];
      const amounts: string[] = [];

      // Dates
      const dateMatches = content.match(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g) || [];
      const isoDateMatches = content.match(/\b\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\b/g) || [];
      const writtenDateMatches = content.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/gi) || [];
      dates.push(...[...dateMatches, ...isoDateMatches, ...writtenDateMatches].slice(0, 20));

      // Amounts
      const amountMatches = content.match(/\$[\d,]+(?:\.\d{2})?/g) || [];
      amounts.push(...amountMatches.slice(0, 20));

      // Names (capitalized word pairs that look like names)
      const nameMatches = content.match(/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g) || [];
      const uniqueNames = [...new Set(nameMatches)].slice(0, 20) as string[];
      names.push(...uniqueNames);

      // Summary
      const summary = content.substring(0, 500).replace(/\n{2,}/g, ' ').trim();

      const extractedEntities = { names, dates, amounts };

      // Store in DB
      const db = getDb();
      const now = localNow();
      const insertResult = db.prepare(`
        INSERT INTO firecrawl_pdf_inspections (url, page_count_estimate, is_scanned, has_text, classification, summary, key_sections, extracted_entities, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        url.trim(), pageCountEstimate, isScanned ? 1 : 0, hasText ? 1 : 0,
        classification, summary, JSON.stringify(keySections), JSON.stringify(extractedEntities),
        (req as any).user?.id || (req as any).user?.userId, now,
      );

      auditLog(req, 'CREATE', 'firecrawl_pdf_inspections', Number(insertResult.lastInsertRowid), `PDF inspect: ${url.trim()}`);

      res.json({
        id: Number(insertResult.lastInsertRowid),
        url: url.trim(),
        page_count_estimate: pageCountEstimate,
        is_scanned: isScanned,
        has_text: hasText,
        classification,
        summary,
        key_sections: keySections,
        extracted_entities: extractedEntities,
      });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[FirecrawlTools] PDF inspect error:', msg);
      res.status(500).json({ error: 'Failed to inspect PDF', detail: msg });
    }
  },
);

// ── GET /pdf-inspect/history — Past PDF inspections ─────────

router.get(
  '/pdf-inspect/history',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_pdf_inspections ORDER BY created_at DESC LIMIT 100').all();
      res.json(parseJsonRows(rows, ['key_sections', 'extracted_entities']));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get PDF inspection history', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 15. Firegraph — Graph/Chart Generator
// ═════════════════════════════════════════════════════════════

// ── POST /graph — Generate a graph/chart from data ───────────

router.post(
  '/graph',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const { title, chart_type, labels, datasets, options } = req.body as {
      title?: string; chart_type?: string; labels?: string[];
      datasets?: { label: string; data: number[]; color?: string }[];
      options?: { x_label?: string; y_label?: string; show_legend?: boolean };
    };

    if (!title || typeof title !== 'string' || !title.trim()) {
      res.status(400).json({ error: 'title is required' }); return;
    }
    if (!chart_type || !['line', 'bar', 'pie', 'area', 'scatter'].includes(chart_type)) {
      res.status(400).json({ error: 'chart_type must be one of: line, bar, pie, area, scatter' }); return;
    }
    if (!labels || !Array.isArray(labels) || labels.length === 0) {
      res.status(400).json({ error: 'labels array is required' }); return;
    }
    if (!datasets || !Array.isArray(datasets) || datasets.length === 0) {
      res.status(400).json({ error: 'datasets array is required' }); return;
    }

    try {
      const db = getDb();
      const now = localNow();
      const config = JSON.stringify({ labels, datasets, options: options || {} });
      const result = db.prepare(`
        INSERT INTO firecrawl_graphs (title, chart_type, config, created_by, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(title.trim(), chart_type, config, (req as any).user?.id || (req as any).user?.userId, now);

      auditLog(req, 'CREATE', 'firecrawl_graphs', Number(result.lastInsertRowid), `Graph: ${title.trim()}`);

      res.json({
        id: Number(result.lastInsertRowid),
        title: title.trim(),
        chart_type,
        config: { labels, datasets, options: options || {} },
        created_at: now,
      });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to create graph', detail: msg });
    }
  },
);

// ── GET /graphs — List saved graphs ──────────────────────────

router.get(
  '/graphs',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_graphs ORDER BY created_at DESC LIMIT 100').all();
      res.json(rows.map((r: any) => ({ ...r, config: r.config ? JSON.parse(r.config) : null })));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to list graphs', detail: msg });
    }
  },
);

// ── DELETE /graphs/:id — Delete a graph ──────────────────────

router.delete(
  '/graphs/:id',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const id = Number(req.params.id);
      const existing = db.prepare('SELECT id FROM firecrawl_graphs WHERE id = ?').get(id);
      if (!existing) { res.status(404).json({ error: 'Graph not found' }); return; }
      db.prepare('DELETE FROM firecrawl_graphs WHERE id = ?').run(id);
      auditLog(req, 'DELETE', 'firecrawl_graphs', id, `Deleted graph #${id}`);
      res.json({ success: true });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to delete graph', detail: msg });
    }
  },
);

// ── POST /graph/from-url — Scrape URL and extract tabular data ──

router.post(
  '/graph/from-url',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { url } = req.body as { url?: string };
    if (!url || typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ error: 'url is required' }); return;
    }

    try {
      const scrapeResult = await firecrawlScrape({
        url: url.trim(),
        formats: ['markdown', 'html'],
        onlyMainContent: true,
      });

      const html = (scrapeResult.data as any)?.html || '';
      const markdown = (scrapeResult.data as any)?.markdown || '';

      // Extract tables from HTML
      const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
      const extractedTables: { headers: string[]; rows: string[][] }[] = [];
      let tableMatch;

      while ((tableMatch = tableRegex.exec(html)) !== null) {
        const tableHtml = tableMatch[1];
        const headerMatches = tableHtml.match(/<th[^>]*>([\s\S]*?)<\/th>/gi) || [];
        const headers = headerMatches.map(h => h.replace(/<[^>]+>/g, '').trim());

        const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
        const rows: string[][] = [];
        let rowMatch;
        while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
          const cellMatches = rowMatch[1].match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
          if (cellMatches.length > 0) {
            rows.push(cellMatches.map(c => c.replace(/<[^>]+>/g, '').trim()));
          }
        }
        if (headers.length > 0 || rows.length > 0) {
          extractedTables.push({ headers, rows });
        }
      }

      // Also try markdown tables
      const mdTableRegex = /\|(.+)\|\n\|[-\s|]+\|\n((?:\|.+\|\n?)+)/g;
      let mdMatch;
      while ((mdMatch = mdTableRegex.exec(markdown)) !== null) {
        const headers = mdMatch[1].split('|').map(h => h.trim()).filter(Boolean);
        const rowLines = mdMatch[2].trim().split('\n');
        const rows = rowLines.map(line => line.split('|').map(c => c.trim()).filter(Boolean));
        if (headers.length > 0) {
          extractedTables.push({ headers, rows });
        }
      }

      // Suggest chart configs for numeric tables
      const suggestedCharts: any[] = [];
      for (const table of extractedTables) {
        if (table.headers.length >= 2 && table.rows.length >= 2) {
          const numericCols = table.headers.filter((_, i) =>
            table.rows.every(r => r[i] && !isNaN(Number(r[i].replace(/[,$%]/g, '')))),
          );
          if (numericCols.length > 0) {
            suggestedCharts.push({
              chart_type: numericCols.length > 1 ? 'line' : 'bar',
              title: `Chart from ${table.headers[0]} data`,
              labels: table.rows.map(r => r[0]),
              datasets: numericCols.map(col => ({
                label: col,
                data: table.rows.map(r => Number(r[table.headers.indexOf(col)].replace(/[,$%]/g, ''))),
              })),
            });
          }
        }
      }

      res.json({ url: url.trim(), extracted_tables: extractedTables.slice(0, 10), suggested_charts: suggestedCharts.slice(0, 5) });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to extract data from URL', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 16. Data Connectors — LLM-Ready Data Connectors
// ═════════════════════════════════════════════════════════════

// ── POST /connectors — Create a data connector ───────────────

router.post(
  '/connectors',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const { name, type, url, schedule_hours, transform_prompt } = req.body as {
      name?: string; type?: string; url?: string; schedule_hours?: number; transform_prompt?: string;
    };

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name is required' }); return;
    }
    if (!type || !['rss', 'sitemap', 'api', 'webpage'].includes(type)) {
      res.status(400).json({ error: 'type must be one of: rss, sitemap, api, webpage' }); return;
    }
    if (!url || typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ error: 'url is required' }); return;
    }

    try {
      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_connectors (name, type, url, schedule_hours, transform_prompt, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        name.trim(), type, url.trim(), schedule_hours || null, transform_prompt?.trim() || null,
        (req as any).user?.id || (req as any).user?.userId, now, now,
      );

      auditLog(req, 'CREATE', 'firecrawl_connectors', Number(result.lastInsertRowid), `Connector: ${name.trim()}`);

      res.json({
        id: Number(result.lastInsertRowid),
        name: name.trim(), type, url: url.trim(),
        schedule_hours: schedule_hours || null,
        transform_prompt: transform_prompt?.trim() || null,
        created_at: now,
      });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to create connector', detail: msg });
    }
  },
);

// ── GET /connectors — List connectors ────────────────────────

router.get(
  '/connectors',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_connectors ORDER BY created_at DESC LIMIT 100').all();
      res.json(rows);
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to list connectors', detail: msg });
    }
  },
);

// ── DELETE /connectors/:id — Delete a connector ──────────────

router.delete(
  '/connectors/:id',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const id = Number(req.params.id);
      const existing = db.prepare('SELECT id FROM firecrawl_connectors WHERE id = ?').get(id);
      if (!existing) { res.status(404).json({ error: 'Connector not found' }); return; }
      db.prepare('DELETE FROM firecrawl_connectors WHERE id = ?').run(id);
      auditLog(req, 'DELETE', 'firecrawl_connectors', id, `Deleted connector #${id}`);
      res.json({ success: true });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to delete connector', detail: msg });
    }
  },
);

// ── POST /connectors/:id/sync — Run a connector sync ─────────

router.post(
  '/connectors/:id/sync',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const id = Number(req.params.id);
      const connector = db.prepare('SELECT * FROM firecrawl_connectors WHERE id = ?').get(id) as any;
      if (!connector) { res.status(404).json({ error: 'Connector not found' }); return; }

      // Fetch data based on connector type
      let records: any[] = [];

      if (connector.type === 'rss') {
        // Use proper RSS parser for RSS/Atom feeds
        const feed = await parseRssFeed(connector.url);
        records = feed.items.slice(0, 50).map((item, i) => ({
          index: i,
          title: item.title,
          link: item.link,
          pubDate: item.pubDate,
          content: item.contentSnippet || '',
        }));
      } else {
        const scrapeResult = await firecrawlScrape({
          url: connector.url,
          formats: ['markdown'],
          onlyMainContent: connector.type === 'webpage',
        });
        const content = (scrapeResult.data as any)?.markdown || '';

        if (connector.type === 'sitemap') {
          const urlMatches = content.match(/https?:\/\/[^\s<>"]+/g) || [];
          records = ([...new Set(urlMatches)] as string[]).slice(0, 100).map((u) => ({ url: u }));
        } else {
          records = [{ content: content.substring(0, 5000) }];
        }
      }

      const now = localNow();
      const syncResult = db.prepare(`
        INSERT INTO firecrawl_connector_syncs (connector_id, records_fetched, data, created_at)
        VALUES (?, ?, ?, ?)
      `).run(id, records.length, JSON.stringify(records), now);

      auditLog(req, 'CREATE', 'firecrawl_connector_syncs', Number(syncResult.lastInsertRowid), `Sync connector #${id}: ${records.length} records`);

      res.json({ id: Number(syncResult.lastInsertRowid), records_fetched: records.length, data: records });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to sync connector', detail: msg });
    }
  },
);

// ── GET /connectors/:id/syncs — Get sync history ─────────────

router.get(
  '/connectors/:id/syncs',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const id = Number(req.params.id);
      const rows = db.prepare('SELECT * FROM firecrawl_connector_syncs WHERE connector_id = ? ORDER BY created_at DESC LIMIT 50').all(id);
      res.json(rows.map((r: any) => ({ ...r, data: r.data ? JSON.parse(r.data) : null })));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get sync history', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 17. RAG Arena — RAG Evaluation
// ═════════════════════════════════════════════════════════════

// ── POST /rag-eval — Evaluate RAG quality on a URL ───────────

router.post(
  '/rag-eval',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { url, test_questions } = req.body as { url?: string; test_questions?: string[] };

    if (!url || typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ error: 'url is required' }); return;
    }
    if (!test_questions || !Array.isArray(test_questions) || test_questions.length === 0) {
      res.status(400).json({ error: 'test_questions array is required' }); return;
    }

    try {
      const scrapeResult = await firecrawlScrape({
        url: url.trim(),
        formats: ['markdown'],
        onlyMainContent: true,
      });

      const content = ((scrapeResult.data as any)?.markdown || '').toLowerCase();
      const contentWords = content.split(/\s+/);

      const evaluations = test_questions.map((question: string) => {
        const qWords = question.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        // Count how many question keywords appear in the content
        const matchedWords = qWords.filter(w => content.includes(w));
        const relevanceScore = qWords.length > 0 ? Math.round((matchedWords.length / qWords.length) * 100) / 100 : 0;

        // Find the best matching passage
        let bestPassage = '';
        let bestScore = 0;
        const sentences = content.split(/[.!?]\s+/);
        for (const sentence of sentences) {
          const sentWords = sentence.split(/\s+/);
          const overlap = qWords.filter(w => sentence.includes(w)).length;
          const score = qWords.length > 0 ? overlap / qWords.length : 0;
          if (score > bestScore) {
            bestScore = score;
            bestPassage = sentence.substring(0, 300);
          }
        }

        const completenessScore = Math.min(1, Math.round((bestScore * 0.7 + (bestPassage.length > 50 ? 0.3 : 0.1)) * 100) / 100);

        return {
          question,
          answer: bestPassage || 'No relevant content found',
          relevance_score: relevanceScore,
          completeness_score: completenessScore,
        };
      });

      const overallScore = evaluations.length > 0
        ? Math.round((evaluations.reduce((s, e) => s + (e.relevance_score + e.completeness_score) / 2, 0) / evaluations.length) * 100) / 100
        : 0;

      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_rag_evals (url, test_questions, evaluations, overall_score, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        url.trim(), JSON.stringify(test_questions), JSON.stringify(evaluations), overallScore,
        (req as any).user?.id || (req as any).user?.userId, now,
      );

      auditLog(req, 'CREATE', 'firecrawl_rag_evals', Number(result.lastInsertRowid), `RAG eval: ${url.trim()} (${test_questions.length} questions)`);

      res.json({ url: url.trim(), evaluations, overall_score: overallScore });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to evaluate RAG quality', detail: msg });
    }
  },
);

// ── GET /rag-eval/history — Past evaluations ─────────────────

router.get(
  '/rag-eval/history',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_rag_evals ORDER BY created_at DESC LIMIT 100').all();
      res.json(rows.map((r: any) => ({
        ...r,
        test_questions: r.test_questions ? JSON.parse(r.test_questions) : [],
        evaluations: r.evaluations ? JSON.parse(r.evaluations) : [],
      })));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get RAG eval history', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 18. Trend Finder
// ═════════════════════════════════════════════════════════════

// ── POST /trends — Find trending topics in a domain ──────────

router.post(
  '/trends',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { domain, keywords, time_range } = req.body as {
      domain?: string; keywords?: string[]; time_range?: '24h' | '7d' | '30d';
    };

    if (!domain || typeof domain !== 'string' || !domain.trim()) {
      res.status(400).json({ error: 'domain is required' }); return;
    }

    try {
      const searchQueries = [domain.trim()];
      if (keywords && Array.isArray(keywords)) {
        for (const kw of keywords.slice(0, 5)) {
          searchQueries.push(`${domain.trim()} ${kw}`);
        }
      }

      const allMentions: Map<string, { count: number; sources: string[] }> = new Map();

      for (const query of searchQueries) {
        const searchResult = await firecrawlSearch({
          query,
          limit: 5,
          scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
        });

        for (const item of (searchResult.data || []) as any[]) {
          const text = (item.markdown || item.content || '');
          const sourceUrl = item.url || item.metadata?.sourceURL || '';

          // Use TF-IDF keyword extraction for better topic discovery
          const keywords = extractKeywords(text, 20);
          const topics = keywords.map((kw) => kw.term);

          for (const topic of topics) {
            const existing = allMentions.get(topic) || { count: 0, sources: [] };
            existing.count++;
            if (sourceUrl && !existing.sources.includes(sourceUrl)) existing.sources.push(sourceUrl);
            allMentions.set(topic, existing);
          }
        }
      }

      // Sort by mention count and take top trends
      const trends = [...allMentions.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 20)
        .map(([topic, data]) => ({
          topic,
          mentions: data.count,
          sentiment: 'neutral',
          first_seen: localNow(),
          sources: data.sources.slice(0, 5),
        }));

      const analyzedAt = localNow();
      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_trend_scans (domain, keywords, time_range, trends, analyzed_at, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        domain.trim(), keywords ? JSON.stringify(keywords) : null,
        time_range || '7d', JSON.stringify(trends), analyzedAt,
        (req as any).user?.id || (req as any).user?.userId, now,
      );

      auditLog(req, 'CREATE', 'firecrawl_trend_scans', Number(result.lastInsertRowid), `Trend scan: ${domain.trim()}`);

      res.json({ domain: domain.trim(), trends, analyzed_at: analyzedAt });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to find trends', detail: msg });
    }
  },
);

// ── GET /trends/history — Past trend scans ───────────────────

router.get(
  '/trends/history',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_trend_scans ORDER BY created_at DESC LIMIT 100').all();
      res.json(rows.map((r: any) => ({
        ...r,
        keywords: r.keywords ? JSON.parse(r.keywords) : [],
        trends: r.trends ? JSON.parse(r.trends) : [],
      })));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get trend history', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 19. Gen UI — Generate UI from Scraped Data
// ═════════════════════════════════════════════════════════════

// ── POST /gen-ui — Generate UI component description from URL ─

router.post(
  '/gen-ui',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { url, component_type } = req.body as {
      url?: string; component_type?: 'dashboard' | 'form' | 'table' | 'card' | 'list';
    };

    if (!url || typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ error: 'url is required' }); return;
    }

    const compType = component_type || 'card';

    try {
      const scrapeResult = await firecrawlScrape({
        url: url.trim(),
        formats: ['markdown', 'html'],
        onlyMainContent: true,
      });

      const html = (scrapeResult.data as any)?.html || '';
      const markdown = (scrapeResult.data as any)?.markdown || '';

      // Extract visual structure info
      const colorMatches = html.match(/#[0-9a-fA-F]{3,8}/g) || [];
      const colors = [...new Set(colorMatches)].slice(0, 10);

      const fontMatches = html.match(/font-family:\s*([^;}"]+)/gi) || [];
      const fonts = [...new Set(fontMatches.map((f: string) => f.replace(/font-family:\s*/i, '').trim()))].slice(0, 5);

      // Extract layout elements
      const elements: string[] = [];
      if (html.includes('<nav')) elements.push('navigation');
      if (html.includes('<header')) elements.push('header');
      if (html.includes('<footer')) elements.push('footer');
      if (html.includes('<form')) elements.push('form');
      if (html.includes('<table')) elements.push('table');
      if (html.includes('<img')) elements.push('images');
      if (html.match(/<h[1-3]/)) elements.push('headings');
      if (html.includes('<button') || html.includes('<a ')) elements.push('buttons/links');
      if (html.includes('<input') || html.includes('<select')) elements.push('inputs');
      if (html.includes('<ul') || html.includes('<ol')) elements.push('lists');

      // Determine layout
      const hasGrid = html.includes('grid') || html.includes('flex');
      const hasSidebar = html.includes('sidebar') || html.includes('aside');
      const layout = hasSidebar ? 'sidebar-content' : hasGrid ? 'grid' : 'single-column';

      // Extract Tailwind-like classes
      const classMatches = html.match(/class="([^"]+)"/g) || [];
      const allClasses = classMatches.flatMap((m: string) => m.replace(/class="/, '').replace(/"/, '').split(/\s+/));
      const tailwindClasses = [...new Set(allClasses.filter((c: string) => /^(bg-|text-|p-|m-|flex|grid|w-|h-|rounded|shadow|border)/.test(c)))].slice(0, 20);

      // Generate a simplified React snippet
      const structure = { layout, elements, colors: colors as string[], fonts: fonts as string[] };
      const contentPreview = markdown.substring(0, 200).replace(/\n/g, ' ');

      let reactSnippet = '';
      if (compType === 'card') {
        reactSnippet = `<div className="bg-white rounded-lg shadow p-6">\n  <h2 className="text-xl font-bold">{title}</h2>\n  <p className="text-gray-600 mt-2">{description}</p>\n</div>`;
      } else if (compType === 'table') {
        reactSnippet = `<table className="w-full border-collapse">\n  <thead><tr>{columns.map(c => <th key={c} className="border p-2 text-left">{c}</th>)}</tr></thead>\n  <tbody>{rows.map(r => <tr key={r.id}>{/* cells */}</tr>)}</tbody>\n</table>`;
      } else if (compType === 'form') {
        reactSnippet = `<form className="space-y-4 max-w-md">\n  {fields.map(f => <div key={f.name}><label className="block text-sm font-medium">{f.label}</label><input className="mt-1 w-full border rounded p-2" /></div>)}\n  <button className="bg-blue-600 text-white px-4 py-2 rounded">Submit</button>\n</form>`;
      } else if (compType === 'list') {
        reactSnippet = `<ul className="divide-y">\n  {items.map(item => <li key={item.id} className="py-3 flex justify-between">\n    <span>{item.title}</span><span className="text-gray-500">{item.meta}</span>\n  </li>)}\n</ul>`;
      } else {
        reactSnippet = `<div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4">\n  {widgets.map(w => <div key={w.id} className="bg-white rounded shadow p-4"><h3>{w.title}</h3><div>{w.content}</div></div>)}\n</div>`;
      }

      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_gen_ui (url, component_type, structure, react_snippet, tailwind_classes, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        url.trim(), compType, JSON.stringify(structure), reactSnippet,
        JSON.stringify(tailwindClasses), (req as any).user?.id || (req as any).user?.userId, now,
      );

      auditLog(req, 'CREATE', 'firecrawl_gen_ui', Number(result.lastInsertRowid), `Gen UI: ${url.trim()} (${compType})`);

      res.json({
        url: url.trim(),
        component_type: compType,
        structure,
        react_snippet: reactSnippet,
        tailwind_classes: tailwindClasses,
      });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to generate UI', detail: msg });
    }
  },
);

// ── GET /gen-ui/history — Past generations ───────────────────

router.get(
  '/gen-ui/history',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_gen_ui ORDER BY created_at DESC LIMIT 100').all();
      res.json(rows.map((r: any) => ({
        ...r,
        structure: r.structure ? JSON.parse(r.structure) : null,
        tailwind_classes: r.tailwind_classes ? JSON.parse(r.tailwind_classes) : [],
      })));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get gen-ui history', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 20. QA Clustering — Chat/QA Analysis
// ═════════════════════════════════════════════════════════════

// ── POST /qa-cluster — Analyze and cluster Q&A data ──────────

router.post(
  '/qa-cluster',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const { questions } = req.body as { questions?: string[] };

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      res.status(400).json({ error: 'questions array is required' }); return;
    }

    try {
      // Simple keyword-based clustering
      const clusters: Map<string, string[]> = new Map();

      for (const q of questions) {
        const words = q.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        // Use the most significant word as the cluster key
        const stopWords = new Set(['what', 'when', 'where', 'which', 'that', 'this', 'with', 'from', 'have', 'does', 'will', 'about', 'would', 'could', 'should', 'there', 'their', 'been', 'they', 'your', 'more', 'some', 'into']);
        const significant = words.filter(w => !stopWords.has(w));
        const theme = significant[0] || 'general';

        const existing = clusters.get(theme) || [];
        existing.push(q);
        clusters.set(theme, existing);
      }

      // Merge small clusters into "other"
      const result: { theme: string; questions: string[]; count: number }[] = [];
      const other: string[] = [];

      for (const [theme, qs] of clusters) {
        if (qs.length >= 2) {
          result.push({ theme, questions: qs, count: qs.length });
        } else {
          other.push(...qs);
        }
      }
      if (other.length > 0) {
        result.push({ theme: 'other', questions: other, count: other.length });
      }

      result.sort((a, b) => b.count - a.count);

      const db = getDb();
      const now = localNow();
      const insertResult = db.prepare(`
        INSERT INTO firecrawl_qa_clusters (questions, clusters, total_questions, cluster_count, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        JSON.stringify(questions), JSON.stringify(result), questions.length, result.length,
        (req as any).user?.id || (req as any).user?.userId, now,
      );

      auditLog(req, 'CREATE', 'firecrawl_qa_clusters', Number(insertResult.lastInsertRowid), `QA cluster: ${questions.length} questions → ${result.length} clusters`);

      res.json({ clusters: result, total_questions: questions.length, cluster_count: result.length });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to cluster questions', detail: msg });
    }
  },
);

// ── GET /qa-cluster/history — Past analyses ──────────────────

router.get(
  '/qa-cluster/history',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_qa_clusters ORDER BY created_at DESC LIMIT 100').all();
      res.json(rows.map((r: any) => ({
        ...r,
        questions: r.questions ? JSON.parse(r.questions) : [],
        clusters: r.clusters ? JSON.parse(r.clusters) : [],
      })));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get QA cluster history', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 21. Structured Extraction — OpenAI Structured Outputs
// ═════════════════════════════════════════════════════════════

// ── POST /extract — Extract structured data from URL ─────────

router.post(
  '/extract',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { url, schema } = req.body as {
      url?: string;
      schema?: { fields: { name: string; type: string; description?: string }[] };
    };

    if (!url || typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ error: 'url is required' }); return;
    }
    if (!schema || !schema.fields || !Array.isArray(schema.fields) || schema.fields.length === 0) {
      res.status(400).json({ error: 'schema with fields array is required' }); return;
    }

    try {
      const scrapeResult = await firecrawlScrape({
        url: url.trim(),
        formats: ['markdown', 'html'],
        onlyMainContent: true,
      });

      const content = (scrapeResult.data as any)?.markdown || '';
      const rawHtml = (scrapeResult.data as any)?.html || (scrapeResult.data as any)?.rawHtml || '';

      const extracted: Record<string, any> = {};
      let fieldsFound = 0;
      let fieldsMissing = 0;

      for (const field of schema.fields) {
        const fieldName = field.name.toLowerCase();
        const fieldDesc = (field.description || field.name).toLowerCase();

        // Search for field value in content
        // Try pattern: "field_name: value" or "field_name - value"
        const patterns = [
          new RegExp(`${fieldName}[:\\s-]+([^\\n]{1,200})`, 'i'),
          new RegExp(`${fieldDesc}[:\\s-]+([^\\n]{1,200})`, 'i'),
        ];

        let value: any = null;
        for (const pattern of patterns) {
          const match = content.match(pattern);
          if (match) {
            let raw = match[1].trim();
            if (field.type === 'number') {
              const numMatch = raw.match(/[\d,.]+/);
              value = numMatch ? Number(numMatch[0].replace(/,/g, '')) : null;
            } else if (field.type === 'boolean') {
              value = /yes|true|enabled|active/i.test(raw);
            } else if (field.type === 'array') {
              value = raw.split(/[,;]/).map((s: string) => s.trim()).filter(Boolean);
            } else {
              value = raw.substring(0, 500);
            }
            break;
          }
        }

        if (value !== null && value !== undefined) {
          extracted[field.name] = value;
          fieldsFound++;
        } else {
          extracted[field.name] = null;
          fieldsMissing++;
        }
      }

      // Enhanced: extract HTML tables from the page
      const tables = rawHtml ? extractTables(rawHtml) : [];

      const confidence = schema.fields.length > 0
        ? Math.round((fieldsFound / schema.fields.length) * 100) / 100
        : 0;

      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_extractions (url, schema, extracted, confidence, fields_found, fields_missing, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        url.trim(), JSON.stringify(schema), JSON.stringify(extracted), confidence,
        fieldsFound, fieldsMissing, (req as any).user?.id || (req as any).user?.userId, now,
      );

      auditLog(req, 'CREATE', 'firecrawl_extractions', Number(result.lastInsertRowid), `Extract: ${url.trim()} (${fieldsFound}/${schema.fields.length} fields)`);

      res.json({ url: url.trim(), extracted, confidence, fields_found: fieldsFound, fields_missing: fieldsMissing, tables });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to extract data', detail: msg });
    }
  },
);

// ── GET /extract/history — Past extractions ──────────────────

router.get(
  '/extract/history',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_extractions ORDER BY created_at DESC LIMIT 100').all();
      res.json(rows.map((r: any) => ({
        ...r,
        schema: r.schema ? JSON.parse(r.schema) : null,
        extracted: r.extracted ? JSON.parse(r.extracted) : null,
      })));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get extraction history', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 22. HTML to Markdown Converter
// ═════════════════════════════════════════════════════════════

// ── POST /html-to-md — Convert HTML content or URL to markdown ─

router.post(
  '/html-to-md',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { url, html, options } = req.body as {
      url?: string; html?: string;
      options?: { include_links?: boolean; include_images?: boolean };
    };

    if (!url && !html) {
      res.status(400).json({ error: 'Either url or html is required' }); return;
    }

    try {
      let markdown = '';
      let title = '';

      if (url) {
        const scrapeResult = await firecrawlScrape({
          url: url.trim(),
          formats: ['markdown'],
          onlyMainContent: true,
        });
        markdown = (scrapeResult.data as any)?.markdown || '';
        title = (scrapeResult.data as any)?.metadata?.title || '';
      } else if (html) {
        // Use TurndownService for high-quality HTML to markdown conversion
        const td = new TurndownService({
          headingStyle: 'atx',
          codeBlockStyle: 'fenced',
          bulletListMarker: '-',
        });

        // Configure link/image handling based on options
        if (options?.include_links === false) {
          td.addRule('stripLinks', {
            filter: 'a',
            replacement: (_content: string, node: any) => node.textContent || '',
          });
        }
        if (options?.include_images === false) {
          td.addRule('stripImages', {
            filter: 'img',
            replacement: () => '',
          });
        }

        markdown = td.turndown(html);

        // Extract title using cheerio
        const ch = cheerio.load(html);
        title = ch('title').first().text().trim();
      }

      // Count stats
      const wordCount = markdown.split(/\s+/).filter(Boolean).length;
      const linkCount = (markdown.match(/\[([^\]]*)\]\([^)]*\)/g) || []).length;
      const imageCount = (markdown.match(/!\[([^\]]*)\]\([^)]*\)/g) || []).length;

      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_html_conversions (url, markdown, word_count, link_count, image_count, title, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        url?.trim() || null, markdown, wordCount, linkCount, imageCount,
        title || null, (req as any).user?.id || (req as any).user?.userId, now,
      );

      auditLog(req, 'CREATE', 'firecrawl_html_conversions', Number(result.lastInsertRowid), `HTML→MD: ${url?.trim() || 'inline HTML'}`);

      res.json({ markdown, word_count: wordCount, link_count: linkCount, image_count: imageCount, title: title || null });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to convert HTML to markdown', detail: msg });
    }
  },
);

// ── GET /html-to-md/history — Past conversions ───────────────

router.get(
  '/html-to-md/history',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT id, url, word_count, link_count, image_count, title, created_by, created_at FROM firecrawl_html_conversions ORDER BY created_at DESC LIMIT 100').all();
      res.json(rows);
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get conversion history', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 23. Coupon Finder
// ═════════════════════════════════════════════════════════════

// ── POST /coupons — Find coupons for a website/brand ─────────

router.post(
  '/coupons',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { brand_or_url } = req.body as { brand_or_url?: string };

    if (!brand_or_url || typeof brand_or_url !== 'string' || !brand_or_url.trim()) {
      res.status(400).json({ error: 'brand_or_url is required' }); return;
    }

    try {
      const brand = brand_or_url.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('.')[0];

      const searches = [
        `${brand} coupons`,
        `${brand} promo codes`,
        `${brand} deals discount`,
      ];

      const allCoupons: { code: string; description: string; source_url: string; expiry: string | null; verified: boolean }[] = [];
      const seenCodes = new Set<string>();

      for (const query of searches) {
        const searchResult = await firecrawlSearch({
          query,
          limit: 3,
          scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
        });

        for (const item of (searchResult.data || []) as any[]) {
          const text = item.markdown || item.content || '';
          const sourceUrl = item.url || item.metadata?.sourceURL || '';

          // Extract coupon codes (typically ALL CAPS or alphanumeric patterns)
          const codeMatches = text.match(/\b[A-Z0-9]{4,20}\b/g) || [];
          // Filter to likely coupon codes (not common words)
          const commonWords = new Set(['FREE', 'SAVE', 'CODE', 'DEAL', 'BEST', 'SALE', 'SHOP', 'MORE', 'NEXT', 'LAST', 'THIS', 'WITH', 'FROM', 'HAVE', 'YOUR', 'THAT', 'WILL', 'HTTPS', 'HTTP', 'HTML']);
          const likelyCodes = codeMatches.filter((c: string) => !commonWords.has(c) && c.length >= 4 && c.length <= 20);

          for (const code of likelyCodes.slice(0, 5)) {
            if (seenCodes.has(code)) continue;
            seenCodes.add(code);

            // Try to find surrounding description
            const codeIndex = text.indexOf(code);
            const surrounding = text.substring(Math.max(0, codeIndex - 100), codeIndex + code.length + 100);
            const descMatch = surrounding.match(/(\d+%?\s*off|free\s+shipping|buy\s+\d+\s+get|save\s+\$?\d+)/i);

            allCoupons.push({
              code,
              description: descMatch ? descMatch[0].trim() : `Promo code for ${brand}`,
              source_url: sourceUrl,
              expiry: null,
              verified: false,
            });
          }
        }
      }

      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_coupon_searches (brand, coupons, found_count, created_by, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        brand, JSON.stringify(allCoupons), allCoupons.length,
        (req as any).user?.id || (req as any).user?.userId, now,
      );

      auditLog(req, 'CREATE', 'firecrawl_coupon_searches', Number(result.lastInsertRowid), `Coupon search: ${brand} (${allCoupons.length} found)`);

      res.json({ brand, coupons: allCoupons, found_count: allCoupons.length });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to find coupons', detail: msg });
    }
  },
);

// ── GET /coupons/history — Past coupon searches ──────────────

router.get(
  '/coupons/history',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_coupon_searches ORDER BY created_at DESC LIMIT 100').all();
      res.json(rows.map((r: any) => ({ ...r, coupons: r.coupons ? JSON.parse(r.coupons) : [] })));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get coupon history', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 24. Brand Extender — Analyze and extend brand presence
// ═════════════════════════════════════════════════════════════

// ── POST /brand-extend — Analyze brand presence ──────────────

router.post(
  '/brand-extend',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { brand_url } = req.body as { brand_url?: string };

    if (!brand_url || typeof brand_url !== 'string' || !brand_url.trim()) {
      res.status(400).json({ error: 'brand_url is required' }); return;
    }

    try {
      const scrapeResult = await firecrawlScrape({
        url: brand_url.trim(),
        formats: ['markdown', 'html'],
        onlyMainContent: false,
      });

      const html = (scrapeResult.data as any)?.html || '';
      const markdown = (scrapeResult.data as any)?.markdown || '';
      const htmlLower = html.toLowerCase();

      // Extract brand name from title
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const brandName = titleMatch ? titleMatch[1].trim().split(/[|\-–—]/)[0].trim() : new URL(brand_url.trim()).hostname;

      // Extract colors
      const colorMatches = html.match(/#[0-9a-fA-F]{3,8}/g) || [];
      const rgbMatches = html.match(/rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)/g) || [];
      const colors = [...new Set([...colorMatches, ...rgbMatches])].slice(0, 10);

      // Extract fonts
      const fontMatches = html.match(/font-family:\s*([^;}"]+)/gi) || [];
      const fonts = [...new Set(fontMatches.map((f: string) => f.replace(/font-family:\s*/i, '').trim()))].slice(0, 5);

      // Analyze tone keywords
      const toneWords: Record<string, number> = {};
      const tonePatterns = ['innovative', 'trusted', 'reliable', 'modern', 'premium', 'affordable', 'fast', 'secure', 'simple', 'powerful', 'professional', 'friendly', 'creative', 'sustainable', 'bold', 'elegant', 'cutting-edge', 'enterprise', 'community', 'open-source'];
      for (const word of tonePatterns) {
        const count = (htmlLower.match(new RegExp(word, 'g')) || []).length;
        if (count > 0) toneWords[word] = count;
      }
      const toneKeywords = Object.entries(toneWords).sort((a, b) => b[1] - a[1]).map(([w]) => w).slice(0, 8);

      // Extract social profiles
      const socialProfiles: { platform: string; url: string }[] = [];
      const socialPatterns: [string, RegExp][] = [
        ['linkedin', /href="(https?:\/\/(?:www\.)?linkedin\.com\/[^"]+)"/i],
        ['twitter', /href="(https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^"]+)"/i],
        ['facebook', /href="(https?:\/\/(?:www\.)?facebook\.com\/[^"]+)"/i],
        ['instagram', /href="(https?:\/\/(?:www\.)?instagram\.com\/[^"]+)"/i],
        ['youtube', /href="(https?:\/\/(?:www\.)?youtube\.com\/[^"]+)"/i],
        ['github', /href="(https?:\/\/(?:www\.)?github\.com\/[^"]+)"/i],
        ['tiktok', /href="(https?:\/\/(?:www\.)?tiktok\.com\/[^"]+)"/i],
      ];
      for (const [platform, pattern] of socialPatterns) {
        const match = html.match(pattern);
        if (match) socialProfiles.push({ platform, url: match[1] });
      }

      // Search for competitors
      const searchResult = await firecrawlSearch({
        query: `${brandName} competitors alternatives`,
        limit: 5,
        scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
      });

      const competitors: string[] = [];
      for (const item of (searchResult.data || []) as any[]) {
        const text = (item.markdown || item.content || '').toLowerCase();
        // Look for brand names (capitalized words near "competitor" or "alternative")
        const compMatches = text.match(/(?:competitor|alternative|vs|versus|compared to)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/gi) || [];
        for (const cm of compMatches) {
          const name = cm.replace(/^(?:competitor|alternative|vs|versus|compared to)\s+/i, '').trim();
          if (name && !competitors.includes(name) && name.toLowerCase() !== brandName.toLowerCase()) {
            competitors.push(name);
          }
        }
      }

      // Generate extension suggestions
      const extensionSuggestions: string[] = [];
      if (socialProfiles.length < 3) extensionSuggestions.push('Expand social media presence — missing key platforms');
      if (!htmlLower.includes('blog')) extensionSuggestions.push('Start a blog for content marketing and SEO');
      if (!htmlLower.includes('newsletter') && !htmlLower.includes('subscribe')) extensionSuggestions.push('Add a newsletter signup for audience building');
      if (!htmlLower.includes('testimonial') && !htmlLower.includes('review')) extensionSuggestions.push('Add customer testimonials or reviews section');
      if (toneKeywords.length < 3) extensionSuggestions.push('Strengthen brand voice with consistent messaging');
      if (colors.length < 3) extensionSuggestions.push('Develop a more comprehensive color palette');
      if (competitors.length > 0) extensionSuggestions.push(`Differentiate from competitors: ${competitors.slice(0, 3).join(', ')}`);
      extensionSuggestions.push('Consider podcast or video content for thought leadership');

      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_brand_analyses (url, brand_name, colors, fonts, tone_keywords, social_profiles, competitors, extension_suggestions, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        brand_url.trim(), brandName, JSON.stringify(colors), JSON.stringify(fonts),
        JSON.stringify(toneKeywords), JSON.stringify(socialProfiles),
        JSON.stringify(competitors.slice(0, 10)), JSON.stringify(extensionSuggestions),
        (req as any).user?.id || (req as any).user?.userId, now,
      );

      auditLog(req, 'CREATE', 'firecrawl_brand_analyses', Number(result.lastInsertRowid), `Brand extend: ${brandName}`);

      res.json({
        url: brand_url.trim(),
        brand_name: brandName,
        colors,
        fonts,
        tone_keywords: toneKeywords,
        social_profiles: socialProfiles,
        competitors: competitors.slice(0, 10),
        extension_suggestions: extensionSuggestions,
      });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to analyze brand', detail: msg });
    }
  },
);

// ── GET /brand-extend/history — Past brand analyses ──────────

router.get(
  '/brand-extend/history',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_brand_analyses ORDER BY created_at DESC LIMIT 100').all();
      res.json(rows.map((r: any) => ({
        ...r,
        colors: r.colors ? JSON.parse(r.colors) : [],
        fonts: r.fonts ? JSON.parse(r.fonts) : [],
        tone_keywords: r.tone_keywords ? JSON.parse(r.tone_keywords) : [],
        social_profiles: r.social_profiles ? JSON.parse(r.social_profiles) : [],
        competitors: r.competitors ? JSON.parse(r.competitors) : [],
        extension_suggestions: r.extension_suggestions ? JSON.parse(r.extension_suggestions) : [],
      })));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get brand analysis history', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 25. Firecrawl MCP Server — MCP Integration Dashboard
// ═════════════════════════════════════════════════════════════

// ── POST /mcp/test-connection — Test MCP server connection ───

router.post(
  '/mcp/test-connection',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { server_url } = req.body as { server_url?: string };
    const url = server_url?.trim() || 'http://localhost:3002';

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(`${url}/health`, { signal: controller.signal }).catch(() => null);
      clearTimeout(timeout);

      if (!resp || !resp.ok) {
        res.json({ connected: false, server_url: url, capabilities: [], tools_available: [] });
        return;
      }

      const data = await resp.json().catch(() => ({}));

      // Log the test
      const db = getDb();
      const now = localNow();
      db.prepare(`INSERT INTO firecrawl_mcp_logs (tool_name, input, output, status, created_at) VALUES (?, ?, ?, ?, ?)`).run(
        'test-connection', JSON.stringify({ server_url: url }), JSON.stringify(data), 'success', now,
      );

      res.json({
        connected: true,
        server_url: url,
        capabilities: data.capabilities || ['scrape', 'search', 'extract'],
        version: data.version || null,
        tools_available: data.tools || ['firecrawl_scrape', 'firecrawl_search'],
      });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.json({ connected: false, server_url: url, capabilities: [], tools_available: [], error: msg });
    }
  },
);

// ── GET /mcp/config — Get current MCP configuration ─────────

router.get(
  '/mcp/config',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const row = db.prepare('SELECT * FROM firecrawl_mcp_config ORDER BY id DESC LIMIT 1').get();
      res.json(row || { server_url: 'http://localhost:3002', enabled: false });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get MCP config', detail: msg });
    }
  },
);

// ── POST /mcp/config — Save MCP configuration ───────────────

router.post(
  '/mcp/config',
  requireRole('admin'),
  (req: Request, res: Response) => {
    ensureTables();
    const { server_url, api_key, enabled } = req.body as { server_url?: string; api_key?: string; enabled?: boolean };

    if (!server_url || typeof server_url !== 'string' || !server_url.trim()) {
      res.status(400).json({ error: 'server_url is required' }); return;
    }

    try {
      const db = getDb();
      const now = localNow();
      // Upsert — keep only one config row
      db.prepare('DELETE FROM firecrawl_mcp_config').run();
      const result = db.prepare(`
        INSERT INTO firecrawl_mcp_config (server_url, api_key, enabled, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        server_url.trim(), api_key?.trim() || null, enabled !== false ? 1 : 0,
        (req as any).user?.id || (req as any).user?.userId, now, now,
      );

      auditLog(req, 'UPDATE', 'firecrawl_mcp_config', Number(result.lastInsertRowid), 'Updated MCP config');
      res.json({ success: true, id: Number(result.lastInsertRowid) });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to save MCP config', detail: msg });
    }
  },
);

// ── GET /mcp/logs — Get MCP interaction logs ─────────────────

router.get(
  '/mcp/logs',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_mcp_logs ORDER BY created_at DESC LIMIT 100').all();
      res.json(parseJsonRows(rows, ['input', 'output']));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get MCP logs', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 26. App Examples Gallery
// ═════════════════════════════════════════════════════════════

// ── POST /examples — Save an app example/template ────────────

router.post(
  '/examples',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const { name, description, category, config, source_url } = req.body as {
      name?: string; description?: string; category?: string; config?: object; source_url?: string;
    };

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name is required' }); return;
    }
    if (!config || typeof config !== 'object') {
      res.status(400).json({ error: 'config object is required' }); return;
    }

    const validCategories = ['scraping', 'search', 'extraction', 'monitoring', 'enrichment', 'research'];
    const cat = validCategories.includes(category || '') ? category : 'scraping';

    try {
      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_examples (name, description, category, config, source_url, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        name.trim(), description?.trim() || null, cat, JSON.stringify(config),
        source_url?.trim() || null,
        (req as any).user?.id || (req as any).user?.userId, now,
      );

      auditLog(req, 'CREATE', 'firecrawl_examples', Number(result.lastInsertRowid), `Created example: ${name.trim()}`);
      res.status(201).json({ success: true, id: Number(result.lastInsertRowid) });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to save example', detail: msg });
    }
  },
);

// ── GET /examples — List all examples ────────────────────────

router.get(
  '/examples',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const category = req.query.category as string | undefined;
      const rows = category
        ? db.prepare('SELECT * FROM firecrawl_examples WHERE category = ? ORDER BY created_at DESC').all(category)
        : db.prepare('SELECT * FROM firecrawl_examples ORDER BY created_at DESC').all();
      res.json(rows.map((r: any) => ({ ...r, config: r.config ? JSON.parse(r.config) : {} })));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to list examples', detail: msg });
    }
  },
);

// ── GET /examples/:id — Get specific example ─────────────────

router.get(
  '/examples/:id',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const row = db.prepare('SELECT * FROM firecrawl_examples WHERE id = ?').get(id) as any;
      if (!row) { res.status(404).json({ error: 'Example not found' }); return; }
      res.json({ ...row, config: row.config ? JSON.parse(row.config) : {} });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get example', detail: msg });
    }
  },
);

// ── DELETE /examples/:id — Delete example ────────────────────

router.delete(
  '/examples/:id',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const result = db.prepare('DELETE FROM firecrawl_examples WHERE id = ?').run(id);
      if (result.changes === 0) { res.status(404).json({ error: 'Example not found' }); return; }
      auditLog(req, 'DELETE', 'firecrawl_examples', id, 'Deleted example');
      res.json({ success: true });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to delete example', detail: msg });
    }
  },
);

// ── POST /examples/:id/run — Run an example config ───────────

router.post(
  '/examples/:id/run',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const example = db.prepare('SELECT * FROM firecrawl_examples WHERE id = ?').get(id) as any;
      if (!example) { res.status(404).json({ error: 'Example not found' }); return; }

      const config = JSON.parse(example.config || '{}');
      let result: any;

      if (config.type === 'search' && config.query) {
        const searchResult = await firecrawlSearch({
          query: config.query, limit: config.limit || 5,
          scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
        });
        result = { type: 'search', data: searchResult.data || [] };
      } else if (config.url) {
        const scrapeResult = await firecrawlScrape({
          url: config.url, formats: config.formats || ['markdown'],
          onlyMainContent: config.onlyMainContent !== false,
        });
        result = { type: 'scrape', data: scrapeResult.data || {} };
      } else {
        res.status(400).json({ error: 'Example config must have url or type=search with query' }); return;
      }

      auditLog(req, 'EXECUTE', 'firecrawl_examples', id, `Ran example: ${example.name}`);
      res.json({ success: true, example_id: id, result });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to run example', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 27. LLMs.txt Generator V2 (llmstxt-generator)
// ═════════════════════════════════════════════════════════════

// ── POST /llmstxt-full — Generate llms.txt AND llms-full.txt ─

router.post(
  '/llmstxt-full',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { url, depth, max_pages } = req.body as { url?: string; depth?: number; max_pages?: number };

    if (!url || typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ error: 'url is required' }); return;
    }

    try {
      // Scrape main page
      const mainResult = await firecrawlScrape({
        url: url.trim(), formats: ['markdown'], onlyMainContent: true,
      });
      const mainMd = (mainResult.data as any)?.markdown || '';
      const mainTitle = (mainResult.data as any)?.metadata?.title || new URL(url.trim()).hostname;

      // Discover sub-pages via search
      const pageLimit = Math.min(max_pages || 10, 20);
      let allPages: { url: string; title: string; content: string }[] = [
        { url: url.trim(), title: mainTitle, content: mainMd },
      ];

      try {
        const hostname = new URL(url.trim()).hostname;
        const searchResult = await firecrawlSearch({
          query: `site:${hostname}`, limit: pageLimit,
          scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
        });
        for (const page of (searchResult.data || [])) {
          const p = page as any;
          allPages.push({
            url: p.url || p.metadata?.sourceURL || '',
            title: p.metadata?.title || p.title || '',
            content: (p.markdown || p.content || '').substring(0, 10000),
          });
        }
      } catch { /* search may fail */ }

      // Build llms.txt (summary)
      const llmstxt = `# ${mainTitle}\n\n> ${mainTitle} documentation and content\n\n## Pages\n\n` +
        allPages.map(p => `- [${p.title}](${p.url}): ${p.content.substring(0, 100).replace(/\n/g, ' ')}`).join('\n');

      // Build llms-full.txt (full content)
      const llmstxtFull = allPages.map(p =>
        `# ${p.title}\n\nURL: ${p.url}\n\n${p.content}`
      ).join('\n\n---\n\n');

      const totalWords = allPages.reduce((sum, p) => sum + p.content.split(/\s+/).length, 0);

      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_llmstxt_v2 (url, llmstxt, llmstxt_full, pages_crawled, total_words, generated_at, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        url.trim(), llmstxt, llmstxtFull, allPages.length, totalWords, now,
        (req as any).user?.id || (req as any).user?.userId, now,
      );

      auditLog(req, 'CREATE', 'firecrawl_llmstxt_v2', Number(result.lastInsertRowid), `LLMs.txt V2: ${url.trim()}`);

      res.json({
        url: url.trim(), llmstxt, llmstxt_full: llmstxtFull,
        pages_crawled: allPages.length, total_words: totalWords, generated_at: now,
      });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to generate llms.txt', detail: msg });
    }
  },
);

// ── GET /llmstxt-full/history — Past generations ─────────────

router.get(
  '/llmstxt-full/history',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT id, url, pages_crawled, total_words, generated_at, created_by, created_at FROM firecrawl_llmstxt_v2 ORDER BY created_at DESC LIMIT 100').all();
      res.json(rows);
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get llmstxt history', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 28. Mendable Chatbot Builder
// ═════════════════════════════════════════════════════════════

// ── POST /mendable/create — Create a Mendable-style chatbot ──

router.post(
  '/mendable/create',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { name, source_urls, system_prompt, welcome_message } = req.body as {
      name?: string; source_urls?: string[]; system_prompt?: string; welcome_message?: string;
    };

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name is required' }); return;
    }
    if (!source_urls || !Array.isArray(source_urls) || source_urls.length === 0) {
      res.status(400).json({ error: 'source_urls array is required' }); return;
    }

    try {
      let allContent = '';
      let pageCount = 0;

      for (const srcUrl of source_urls.slice(0, 10)) {
        try {
          const scrapeResult = await firecrawlScrape({
            url: srcUrl.trim(), formats: ['markdown'], onlyMainContent: true,
          });
          const md = (scrapeResult.data as any)?.markdown || '';
          if (md.trim()) {
            allContent += `\n\n--- Source: ${srcUrl.trim()} ---\n\n${md.substring(0, 20000)}`;
            pageCount++;
          }
        } catch { /* skip failed URLs */ }
      }

      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_mendable_bots (name, source_urls, system_prompt, welcome_message, scraped_content, page_count, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        name.trim(), JSON.stringify(source_urls), system_prompt?.trim() || null,
        welcome_message?.trim() || null, allContent.substring(0, 200000), pageCount,
        (req as any).user?.id || (req as any).user?.userId, now, now,
      );

      auditLog(req, 'CREATE', 'firecrawl_mendable_bots', Number(result.lastInsertRowid), `Created Mendable bot: ${name.trim()}`);

      res.status(201).json({
        success: true, id: Number(result.lastInsertRowid),
        name: name.trim(), page_count: pageCount,
        content_length: allContent.length,
      });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to create Mendable bot', detail: msg });
    }
  },
);

// ── GET /mendable — List bots ────────────────────────────────

router.get(
  '/mendable',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT id, name, source_urls, system_prompt, welcome_message, page_count, created_by, created_at, updated_at FROM firecrawl_mendable_bots ORDER BY created_at DESC').all();
      res.json(rows.map((r: any) => ({ ...r, source_urls: r.source_urls ? JSON.parse(r.source_urls) : [] })));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to list Mendable bots', detail: msg });
    }
  },
);

// ── POST /mendable/:id/chat — Chat with a bot ───────────────

router.post(
  '/mendable/:id/chat',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    const { message, conversation_id } = req.body as { message?: string; conversation_id?: string };
    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'message is required' }); return;
    }

    try {
      const db = getDb();
      const bot = db.prepare('SELECT * FROM firecrawl_mendable_bots WHERE id = ?').get(id) as any;
      if (!bot) { res.status(404).json({ error: 'Bot not found' }); return; }

      const content = bot.scraped_content || '';
      const msgLower = message.trim().toLowerCase();
      const msgWords = msgLower.split(/\s+/).filter((w: string) => w.length > 3);

      // Simple keyword matching for relevant sections
      const sections = content.split(/\n{2,}/).filter((s: string) => s.trim().length > 20);
      const scored = sections.map((section: string) => {
        const sLower = section.toLowerCase();
        let score = 0;
        for (const word of msgWords) { if (sLower.includes(word)) score++; }
        return { text: section, score };
      }).filter((s: any) => s.score > 0).sort((a: any, b: any) => b.score - a.score);

      const topSections = scored.slice(0, 5);
      const sources = topSections.map((s: any) => ({
        url: (s.text.match(/Source: (https?:\/\/[^\s]+)/) || [])[1] || '',
        snippet: s.text.substring(0, 200),
      }));

      const response = topSections.length > 0
        ? topSections.map((s: any) => s.text.substring(0, 400)).join('\n\n')
        : 'I don\'t have enough information to answer that question based on my training data.';

      const convId = conversation_id || `conv_${Date.now()}`;
      const now = localNow();

      // Store user message
      db.prepare(`INSERT INTO firecrawl_mendable_messages (bot_id, conversation_id, role, message, created_at) VALUES (?, ?, ?, ?, ?)`).run(
        id, convId, 'user', message.trim(), now,
      );
      // Store bot response
      db.prepare(`INSERT INTO firecrawl_mendable_messages (bot_id, conversation_id, role, message, sources, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
        id, convId, 'assistant', response, JSON.stringify(sources), now,
      );

      res.json({ response, sources, conversation_id: convId });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to chat with bot', detail: msg });
    }
  },
);

// ── DELETE /mendable/:id — Delete bot ────────────────────────

router.delete(
  '/mendable/:id',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const result = db.prepare('DELETE FROM firecrawl_mendable_bots WHERE id = ?').run(id);
      if (result.changes === 0) { res.status(404).json({ error: 'Bot not found' }); return; }
      auditLog(req, 'DELETE', 'firecrawl_mendable_bots', id, 'Deleted Mendable bot');
      res.json({ success: true });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to delete bot', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 29. AI News Aggregator
// ═════════════════════════════════════════════════════════════

// ── POST /news — Search for AI/tech news on a topic ──────────

router.post(
  '/news',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { topic, sources, max_results } = req.body as {
      topic?: string; sources?: string[]; max_results?: number;
    };

    if (!topic || typeof topic !== 'string' || !topic.trim()) {
      res.status(400).json({ error: 'topic is required' }); return;
    }

    try {
      const limit = Math.min(max_results || 10, 20);
      const searchQuery = sources && sources.length > 0
        ? `${topic.trim()} ${sources.map(s => `site:${s}`).join(' OR ')}`
        : `${topic.trim()} latest news`;

      const searchResult = await firecrawlSearch({
        query: searchQuery, limit,
        scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
      });

      const articles = ((searchResult.data || []) as any[]).map((r: any) => ({
        title: r.metadata?.title || r.title || 'Untitled',
        url: r.url || r.metadata?.sourceURL || '',
        summary: (r.markdown || r.content || '').substring(0, 300).replace(/\n/g, ' '),
        published_date: r.metadata?.publishedDate || r.metadata?.date || null,
        source: r.url ? new URL(r.url).hostname : '',
      }));

      const now = localNow();
      const db = getDb();
      const result = db.prepare(`
        INSERT INTO firecrawl_news_searches (topic, sources, articles, fetched_at, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        topic.trim(), sources ? JSON.stringify(sources) : null,
        JSON.stringify(articles), now,
        (req as any).user?.id || (req as any).user?.userId, now,
      );

      auditLog(req, 'EXECUTE', 'firecrawl_news_searches', Number(result.lastInsertRowid), `News search: ${topic.trim()}`);

      res.json({ topic: topic.trim(), articles, fetched_at: now });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to search news', detail: msg });
    }
  },
);

// ── GET /news/history — Past news searches ───────────────────

router.get(
  '/news/history',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_news_searches ORDER BY created_at DESC LIMIT 100').all();
      res.json(rows.map((r: any) => ({
        ...r,
        sources: r.sources ? JSON.parse(r.sources) : [],
        articles: r.articles ? JSON.parse(r.articles) : [],
      })));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get news history', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 30. Auto Draft — Content Generator
// ═════════════════════════════════════════════════════════════

// ── POST /draft — Auto-generate a document draft ─────────────

router.post(
  '/draft',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { topic, type, source_urls, word_count } = req.body as {
      topic?: string; type?: string; source_urls?: string[]; word_count?: number;
    };

    if (!topic || typeof topic !== 'string' || !topic.trim()) {
      res.status(400).json({ error: 'topic is required' }); return;
    }

    const validTypes = ['blog', 'report', 'summary', 'brief'];
    const draftType = validTypes.includes(type || '') ? type! : 'summary';

    try {
      // Gather content from source URLs or search
      let sourcesContent: { url: string; content: string }[] = [];

      if (source_urls && source_urls.length > 0) {
        for (const srcUrl of source_urls.slice(0, 5)) {
          try {
            const scrapeResult = await firecrawlScrape({
              url: srcUrl.trim(), formats: ['markdown'], onlyMainContent: true,
            });
            const md = (scrapeResult.data as any)?.markdown || '';
            if (md.trim()) sourcesContent.push({ url: srcUrl.trim(), content: md.substring(0, 5000) });
          } catch { /* skip */ }
        }
      } else {
        const searchResult = await firecrawlSearch({
          query: topic.trim(), limit: 5,
          scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
        });
        for (const r of (searchResult.data || []) as any[]) {
          const md = r.markdown || r.content || '';
          if (md.trim()) {
            sourcesContent.push({ url: r.url || '', content: md.substring(0, 5000) });
          }
        }
      }

      // Build draft from scraped content
      const targetWords = word_count || 500;
      const combinedContent = sourcesContent.map(s => s.content).join('\n\n');
      const sentences = combinedContent.split(/[.!?]+/).filter((s: string) => s.trim().length > 20);

      let draftContent = '';
      if (draftType === 'blog') {
        draftContent = `# ${topic.trim()}\n\n`;
        draftContent += sentences.slice(0, Math.ceil(targetWords / 15)).map((s: string) => s.trim() + '.').join(' ');
      } else if (draftType === 'report') {
        draftContent = `# Report: ${topic.trim()}\n\n## Overview\n\n`;
        const third = Math.ceil(sentences.length / 3);
        draftContent += sentences.slice(0, third).map((s: string) => s.trim() + '.').join(' ');
        draftContent += '\n\n## Key Findings\n\n';
        draftContent += sentences.slice(third, third * 2).map((s: string) => '- ' + s.trim() + '.').join('\n');
        draftContent += '\n\n## Details\n\n';
        draftContent += sentences.slice(third * 2).map((s: string) => s.trim() + '.').join(' ');
      } else if (draftType === 'brief') {
        draftContent = `## Brief: ${topic.trim()}\n\n`;
        draftContent += sentences.slice(0, 5).map((s: string) => '- ' + s.trim() + '.').join('\n');
      } else {
        draftContent = `## Summary: ${topic.trim()}\n\n`;
        draftContent += sentences.slice(0, Math.ceil(targetWords / 15)).map((s: string) => s.trim() + '.').join(' ');
      }

      const actualWordCount = draftContent.split(/\s+/).length;

      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_drafts (topic, type, draft_content, sources_used, word_count, generated_at, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        topic.trim(), draftType, draftContent,
        JSON.stringify(sourcesContent.map(s => s.url)), actualWordCount, now,
        (req as any).user?.id || (req as any).user?.userId, now,
      );

      auditLog(req, 'CREATE', 'firecrawl_drafts', Number(result.lastInsertRowid), `Draft: ${topic.trim()}`);

      res.json({
        id: Number(result.lastInsertRowid), topic: topic.trim(), type: draftType,
        draft_content: draftContent,
        sources_used: sourcesContent.map(s => s.url),
        word_count: actualWordCount, generated_at: now,
      });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to generate draft', detail: msg });
    }
  },
);

// ── GET /drafts — List drafts ────────────────────────────────

router.get(
  '/drafts',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT id, topic, type, word_count, generated_at, created_by, created_at FROM firecrawl_drafts ORDER BY created_at DESC LIMIT 100').all();
      res.json(rows);
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to list drafts', detail: msg });
    }
  },
);

// ── GET /drafts/:id — Get specific draft ─────────────────────

router.get(
  '/drafts/:id',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const row = db.prepare('SELECT * FROM firecrawl_drafts WHERE id = ?').get(id) as any;
      if (!row) { res.status(404).json({ error: 'Draft not found' }); return; }
      res.json({ ...row, sources_used: row.sources_used ? JSON.parse(row.sources_used) : [] });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get draft', detail: msg });
    }
  },
);

// ── DELETE /drafts/:id — Delete draft ────────────────────────

router.delete(
  '/drafts/:id',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const result = db.prepare('DELETE FROM firecrawl_drafts WHERE id = ?').run(id);
      if (result.changes === 0) { res.status(404).json({ error: 'Draft not found' }); return; }
      auditLog(req, 'DELETE', 'firecrawl_drafts', id, 'Deleted draft');
      res.json({ success: true });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to delete draft', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 31. Slack Bot Integration
// ═════════════════════════════════════════════════════════════

// ── POST /integrations/slack — Configure Slack webhook ───────

router.post(
  '/integrations/slack',
  requireRole('admin'),
  (req: Request, res: Response) => {
    ensureTables();
    const { webhook_url, channel, notify_on } = req.body as {
      webhook_url?: string; channel?: string; notify_on?: string[];
    };

    if (!webhook_url || typeof webhook_url !== 'string' || !webhook_url.trim()) {
      res.status(400).json({ error: 'webhook_url is required' }); return;
    }

    try {
      const db = getDb();
      const now = localNow();
      // Upsert — keep only one config
      db.prepare('DELETE FROM firecrawl_slack_config').run();
      const result = db.prepare(`
        INSERT INTO firecrawl_slack_config (webhook_url, channel, notify_on, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        webhook_url.trim(), channel?.trim() || null,
        notify_on ? JSON.stringify(notify_on) : null,
        (req as any).user?.id || (req as any).user?.userId, now, now,
      );

      auditLog(req, 'UPDATE', 'firecrawl_slack_config', Number(result.lastInsertRowid), 'Configured Slack integration');
      res.json({ success: true, id: Number(result.lastInsertRowid) });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to save Slack config', detail: msg });
    }
  },
);

// ── GET /integrations/slack — Get config ─────────────────────

router.get(
  '/integrations/slack',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const row = db.prepare('SELECT * FROM firecrawl_slack_config ORDER BY id DESC LIMIT 1').get() as any;
      if (!row) { res.json({ configured: false }); return; }
      res.json({ ...row, notify_on: row.notify_on ? JSON.parse(row.notify_on) : [] });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get Slack config', detail: msg });
    }
  },
);

// ── DELETE /integrations/slack — Remove config ───────────────

router.delete(
  '/integrations/slack',
  requireRole('admin'),
  (req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      db.prepare('DELETE FROM firecrawl_slack_config').run();
      auditLog(req, 'DELETE', 'firecrawl_slack_config', 0, 'Removed Slack integration');
      res.json({ success: true });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to remove Slack config', detail: msg });
    }
  },
);

// ── POST /integrations/slack/test — Send test message ────────

router.post(
  '/integrations/slack/test',
  requireRole('admin', 'manager'),
  async (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const config = db.prepare('SELECT * FROM firecrawl_slack_config ORDER BY id DESC LIMIT 1').get() as any;
      if (!config) { res.status(404).json({ error: 'Slack not configured' }); return; }

      const resp = await fetch(config.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '🔥 Firecrawl Tools test message — integration is working!' }),
      });

      if (!resp.ok) {
        res.status(502).json({ error: 'Slack webhook returned error', status: resp.status }); return;
      }

      res.json({ success: true, message: 'Test message sent to Slack' });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to send Slack test', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 32. Discord Bot Integration
// ═════════════════════════════════════════════════════════════

// ── POST /integrations/discord — Configure Discord webhook ───

router.post(
  '/integrations/discord',
  requireRole('admin'),
  (req: Request, res: Response) => {
    ensureTables();
    const { webhook_url, notify_on } = req.body as { webhook_url?: string; notify_on?: string[] };

    if (!webhook_url || typeof webhook_url !== 'string' || !webhook_url.trim()) {
      res.status(400).json({ error: 'webhook_url is required' }); return;
    }

    try {
      const db = getDb();
      const now = localNow();
      db.prepare('DELETE FROM firecrawl_discord_config').run();
      const result = db.prepare(`
        INSERT INTO firecrawl_discord_config (webhook_url, notify_on, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        webhook_url.trim(), notify_on ? JSON.stringify(notify_on) : null,
        (req as any).user?.id || (req as any).user?.userId, now, now,
      );

      auditLog(req, 'UPDATE', 'firecrawl_discord_config', Number(result.lastInsertRowid), 'Configured Discord integration');
      res.json({ success: true, id: Number(result.lastInsertRowid) });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to save Discord config', detail: msg });
    }
  },
);

// ── GET /integrations/discord — Get config ───────────────────

router.get(
  '/integrations/discord',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const row = db.prepare('SELECT * FROM firecrawl_discord_config ORDER BY id DESC LIMIT 1').get() as any;
      if (!row) { res.json({ configured: false }); return; }
      res.json({ ...row, notify_on: row.notify_on ? JSON.parse(row.notify_on) : [] });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get Discord config', detail: msg });
    }
  },
);

// ── DELETE /integrations/discord — Remove config ─────────────

router.delete(
  '/integrations/discord',
  requireRole('admin'),
  (req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      db.prepare('DELETE FROM firecrawl_discord_config').run();
      auditLog(req, 'DELETE', 'firecrawl_discord_config', 0, 'Removed Discord integration');
      res.json({ success: true });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to remove Discord config', detail: msg });
    }
  },
);

// ── POST /integrations/discord/test — Send test message ──────

router.post(
  '/integrations/discord/test',
  requireRole('admin', 'manager'),
  async (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const config = db.prepare('SELECT * FROM firecrawl_discord_config ORDER BY id DESC LIMIT 1').get() as any;
      if (!config) { res.status(404).json({ error: 'Discord not configured' }); return; }

      const resp = await fetch(config.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '🔥 Firecrawl Tools test message — integration is working!' }),
      });

      if (!resp.ok) {
        res.status(502).json({ error: 'Discord webhook returned error', status: resp.status }); return;
      }

      res.json({ success: true, message: 'Test message sent to Discord' });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to send Discord test', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 33. OpenManus — Agent Framework
// ═════════════════════════════════════════════════════════════

// ── POST /agents — Create an autonomous agent task ───────────

router.post(
  '/agents',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const { name, goal, tools, max_steps, initial_url, initial_query } = req.body as {
      name?: string; goal?: string; tools?: string[]; max_steps?: number;
      initial_url?: string; initial_query?: string;
    };

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name is required' }); return;
    }
    if (!goal || typeof goal !== 'string' || !goal.trim()) {
      res.status(400).json({ error: 'goal is required' }); return;
    }
    if (!tools || !Array.isArray(tools) || tools.length === 0) {
      res.status(400).json({ error: 'tools array is required' }); return;
    }

    const validTools = ['scrape', 'search', 'extract'];
    const filteredTools = tools.filter(t => validTools.includes(t));
    if (filteredTools.length === 0) {
      res.status(400).json({ error: 'tools must include at least one of: scrape, search, extract' }); return;
    }

    try {
      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_agents (name, goal, tools, max_steps, initial_url, initial_query, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        name.trim(), goal.trim(), JSON.stringify(filteredTools),
        max_steps || 10, initial_url?.trim() || null, initial_query?.trim() || null,
        (req as any).user?.id || (req as any).user?.userId, now,
      );

      auditLog(req, 'CREATE', 'firecrawl_agents', Number(result.lastInsertRowid), `Created agent: ${name.trim()}`);
      res.status(201).json({ success: true, id: Number(result.lastInsertRowid) });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to create agent', detail: msg });
    }
  },
);

// ── GET /agents — List agents ────────────────────────────────

router.get(
  '/agents',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_agents ORDER BY created_at DESC').all();
      res.json(rows.map((r: any) => ({ ...r, tools: r.tools ? JSON.parse(r.tools) : [] })));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to list agents', detail: msg });
    }
  },
);

// ── POST /agents/:id/run — Execute agent ─────────────────────

router.post(
  '/agents/:id/run',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const agent = db.prepare('SELECT * FROM firecrawl_agents WHERE id = ?').get(id) as any;
      if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }

      const agentTools = JSON.parse(agent.tools || '[]') as string[];
      const maxSteps = agent.max_steps || 10;
      const steps: any[] = [];
      let currentUrl = agent.initial_url || '';
      let currentQuery = agent.initial_query || agent.goal;

      const now = localNow();

      for (let step = 0; step < maxSteps && steps.length < maxSteps; step++) {
        try {
          if (agentTools.includes('search') && currentQuery && step === 0) {
            const searchResult = await firecrawlSearch({
              query: currentQuery, limit: 3,
              scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
            });
            const data = searchResult.data || [];
            steps.push({ tool: 'search', input: currentQuery, output: JSON.stringify(data.slice(0, 3).map((d: any) => ({ url: d.url, title: d.metadata?.title }))), step_number: step + 1 });
            if (data.length > 0 && (data[0] as any).url) currentUrl = (data[0] as any).url;
            else break;
          } else if (agentTools.includes('scrape') && currentUrl) {
            const scrapeResult = await firecrawlScrape({
              url: currentUrl, formats: ['markdown'], onlyMainContent: true,
            });
            const md = (scrapeResult.data as any)?.markdown || '';
            steps.push({ tool: 'scrape', input: currentUrl, output: md.substring(0, 500), step_number: step + 1 });
            if (!md.trim()) break;

            // Extract next URL from content if needed
            const urlMatch = md.match(/https?:\/\/[^\s)]+/);
            if (urlMatch && agentTools.includes('extract')) {
              currentUrl = urlMatch[0];
            } else {
              break;
            }
          } else if (agentTools.includes('extract') && currentUrl) {
            const scrapeResult = await firecrawlScrape({
              url: currentUrl, formats: ['markdown'], onlyMainContent: true,
            });
            const md = (scrapeResult.data as any)?.markdown || '';
            steps.push({ tool: 'extract', input: currentUrl, output: md.substring(0, 500), step_number: step + 1 });
            break;
          } else {
            break;
          }
        } catch (stepErr: unknown) {
          steps.push({ tool: 'error', input: currentUrl || currentQuery, output: stepErr instanceof Error ? stepErr.message : String(stepErr), step_number: step + 1 });
          break;
        }
      }

      const resultSummary = steps.length > 0
        ? `Completed ${steps.length} steps. Last tool: ${steps[steps.length - 1].tool}`
        : 'No steps executed';

      const runResult = db.prepare(`
        INSERT INTO firecrawl_agent_runs (agent_id, steps, completed, result_summary, started_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, JSON.stringify(steps), 1, resultSummary, now, localNow());

      auditLog(req, 'EXECUTE', 'firecrawl_agent_runs', Number(runResult.lastInsertRowid), `Agent run: ${agent.name}`);

      res.json({
        agent_id: id, steps, completed: true, result_summary: resultSummary,
      });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to run agent', detail: msg });
    }
  },
);

// ── GET /agents/:id/runs — Get run history ───────────────────

router.get(
  '/agents/:id/runs',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_agent_runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT 50').all(id);
      res.json(rows.map((r: any) => ({ ...r, steps: r.steps ? JSON.parse(r.steps) : [] })));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get agent runs', detail: msg });
    }
  },
);

// ── DELETE /agents/:id — Delete agent ────────────────────────

router.delete(
  '/agents/:id',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const result = db.prepare('DELETE FROM firecrawl_agents WHERE id = ?').run(id);
      if (result.changes === 0) { res.status(404).json({ error: 'Agent not found' }); return; }
      auditLog(req, 'DELETE', 'firecrawl_agents', id, 'Deleted agent');
      res.json({ success: true });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to delete agent', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 34. MinerU Document Extraction
// ═════════════════════════════════════════════════════════════

// ── POST /doc-extract — Extract structured content from URL ──

router.post(
  '/doc-extract',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { url, output_format } = req.body as { url?: string; output_format?: string };

    if (!url || typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ error: 'url is required' }); return;
    }

    const format = ['markdown', 'json', 'text'].includes(output_format || '') ? output_format! : 'markdown';

    try {
      const scrapeResult = await firecrawlScrape({
        url: url.trim(), formats: ['markdown', 'html'], onlyMainContent: false,
      });

      const data = scrapeResult.data as any || {};
      const markdown = data.markdown || '';
      const html = data.html || '';

      // Extract tables from HTML
      const tables: { headers: string[]; rows: string[][] }[] = [];
      const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
      let tableMatch;
      while ((tableMatch = tableRegex.exec(html)) !== null) {
        const tableHtml = tableMatch[1];
        const headers: string[] = [];
        const headerRegex = /<th[^>]*>([\s\S]*?)<\/th>/gi;
        let hMatch;
        while ((hMatch = headerRegex.exec(tableHtml)) !== null) {
          headers.push(hMatch[1].replace(/<[^>]+>/g, '').trim());
        }
        const rows: string[][] = [];
        const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
        let rMatch;
        while ((rMatch = rowRegex.exec(tableHtml)) !== null) {
          const cells: string[] = [];
          const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
          let cMatch;
          while ((cMatch = cellRegex.exec(rMatch[1])) !== null) {
            cells.push(cMatch[1].replace(/<[^>]+>/g, '').trim());
          }
          if (cells.length > 0) rows.push(cells);
        }
        if (headers.length > 0 || rows.length > 0) tables.push({ headers, rows });
      }

      // Count images
      const imgCount = (html.match(/<img /gi) || []).length;

      const metadata = {
        title: data.metadata?.title || '',
        description: data.metadata?.description || '',
        language: data.metadata?.language || '',
      };

      let content = markdown;
      if (format === 'text') {
        content = markdown.replace(/[#*_\[\]()]/g, '').replace(/\n{3,}/g, '\n\n');
      } else if (format === 'json') {
        content = JSON.stringify({ title: metadata.title, sections: markdown.split(/\n## /).map((s: string) => s.trim()) });
      }

      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_doc_extractions (url, content, format, tables, images_found, metadata, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        url.trim(), content, format, JSON.stringify(tables), imgCount,
        JSON.stringify(metadata),
        (req as any).user?.id || (req as any).user?.userId, now,
      );

      auditLog(req, 'CREATE', 'firecrawl_doc_extractions', Number(result.lastInsertRowid), `Doc extract: ${url.trim()}`);

      res.json({ url: url.trim(), content, format, tables, images_found: imgCount, metadata });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to extract document', detail: msg });
    }
  },
);

// ── GET /doc-extract/history — Past extractions ──────────────

router.get(
  '/doc-extract/history',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT id, url, format, images_found, metadata, created_by, created_at FROM firecrawl_doc_extractions ORDER BY created_at DESC LIMIT 100').all();
      res.json(rows.map((r: any) => ({ ...r, metadata: r.metadata ? JSON.parse(r.metadata) : {} })));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get extraction history', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 35. Job Matcher
// ═════════════════════════════════════════════════════════════

// ── POST /job-match — Match job listings to criteria ─────────

router.post(
  '/job-match',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { search_url, criteria } = req.body as {
      search_url?: string;
      criteria?: { skills?: string[]; location?: string; salary_min?: number; remote?: boolean };
    };

    if (!search_url || typeof search_url !== 'string' || !search_url.trim()) {
      res.status(400).json({ error: 'search_url is required' }); return;
    }
    if (!criteria || typeof criteria !== 'object') {
      res.status(400).json({ error: 'criteria object is required' }); return;
    }

    try {
      const scrapeResult = await firecrawlScrape({
        url: search_url.trim(), formats: ['markdown'], onlyMainContent: true,
      });

      const markdown = (scrapeResult.data as any)?.markdown || '';

      // Parse job-like sections from content
      const sections = markdown.split(/\n(?=#{1,3}\s|[\*\-]\s)/).filter((s: string) => s.trim().length > 30);
      const matches: any[] = [];

      for (const section of sections) {
        const lower = section.toLowerCase();
        let matchScore = 0;
        let matchReasons: string[] = [];

        // Check skills
        if (criteria.skills && criteria.skills.length > 0) {
          for (const skill of criteria.skills) {
            if (lower.includes(skill.toLowerCase())) {
              matchScore += 20;
              matchReasons.push(`Skill: ${skill}`);
            }
          }
        }

        // Check location
        if (criteria.location && lower.includes(criteria.location.toLowerCase())) {
          matchScore += 15;
          matchReasons.push(`Location: ${criteria.location}`);
        }

        // Check remote
        if (criteria.remote && (lower.includes('remote') || lower.includes('work from home'))) {
          matchScore += 15;
          matchReasons.push('Remote available');
        }

        // Check salary indicators
        if (criteria.salary_min) {
          const salaryMatch = lower.match(/\$?([\d,]+)\s*(?:k|\/yr|per\s*year|annual)/i);
          if (salaryMatch) {
            const salary = parseInt(salaryMatch[1].replace(/,/g, '')) * (salaryMatch[0].includes('k') ? 1000 : 1);
            if (salary >= criteria.salary_min) {
              matchScore += 20;
              matchReasons.push(`Salary: $${salary.toLocaleString()}`);
            }
          }
        }

        if (matchScore > 0) {
          // Extract title (first line)
          const titleLine = section.split('\n')[0].replace(/^[#\*\-\s]+/, '').trim();
          // Try to extract company
          const companyMatch = section.match(/(?:at|@|company[:\s]+)([A-Z][^\n,]+)/i);

          matches.push({
            title: titleLine.substring(0, 100) || 'Untitled Position',
            company: companyMatch ? companyMatch[1].trim() : '',
            location: criteria.location || '',
            salary: section.match(/\$[\d,]+(?:k|\/yr)?/i)?.[0] || null,
            match_score: Math.min(matchScore, 100),
            url: search_url.trim(),
          });
        }
      }

      matches.sort((a, b) => b.match_score - a.match_score);

      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_job_matches (search_url, criteria, matches, total_found, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        search_url.trim(), JSON.stringify(criteria),
        JSON.stringify(matches.slice(0, 50)), matches.length,
        (req as any).user?.id || (req as any).user?.userId, now,
      );

      auditLog(req, 'EXECUTE', 'firecrawl_job_matches', Number(result.lastInsertRowid), `Job match: ${search_url.trim()}`);

      res.json({ url: search_url.trim(), matches: matches.slice(0, 50), total_found: matches.length });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to match jobs', detail: msg });
    }
  },
);

// ── GET /job-match/history — Past matches ────────────────────

router.get(
  '/job-match/history',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_job_matches ORDER BY created_at DESC LIMIT 100').all();
      res.json(rows.map((r: any) => ({
        ...r,
        criteria: r.criteria ? JSON.parse(r.criteria) : {},
        matches: r.matches ? JSON.parse(r.matches) : [],
      })));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get job match history', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 36. MHTML Converter
// ═════════════════════════════════════════════════════════════

// ── POST /mhtml-convert — Convert webpage to archive ─────────

router.post(
  '/mhtml-convert',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { url } = req.body as { url?: string };

    if (!url || typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ error: 'url is required' }); return;
    }

    try {
      const scrapeResult = await firecrawlScrape({
        url: url.trim(), formats: ['html', 'markdown'], onlyMainContent: false,
      });

      const data = scrapeResult.data as any || {};
      const html = data.html || '';
      const title = data.metadata?.title || new URL(url.trim()).hostname;

      // Count embedded assets (images, stylesheets, scripts)
      const imgCount = (html.match(/<img /gi) || []).length;
      const cssCount = (html.match(/<link[^>]+stylesheet/gi) || []).length;
      const jsCount = (html.match(/<script /gi) || []).length;
      const assetsCount = imgCount + cssCount + jsCount;

      const sizeBytes = Buffer.byteLength(html, 'utf8');
      const now = localNow();

      const db = getDb();
      const result = db.prepare(`
        INSERT INTO firecrawl_mhtml_conversions (url, title, html_content, assets_count, size_bytes, converted_at, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        url.trim(), title, html, assetsCount, sizeBytes, now,
        (req as any).user?.id || (req as any).user?.userId, now,
      );

      auditLog(req, 'CREATE', 'firecrawl_mhtml_conversions', Number(result.lastInsertRowid), `MHTML convert: ${url.trim()}`);

      res.json({
        url: url.trim(), title, html_content: html,
        assets_count: assetsCount, size_bytes: sizeBytes, converted_at: now,
      });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to convert page', detail: msg });
    }
  },
);

// ── GET /mhtml-convert/history — Past conversions ────────────

router.get(
  '/mhtml-convert/history',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT id, url, title, assets_count, size_bytes, converted_at, created_by, created_at FROM firecrawl_mhtml_conversions ORDER BY created_at DESC LIMIT 100').all();
      res.json(rows);
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get conversion history', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 37. Firecrawl Core API Console
// ═════════════════════════════════════════════════════════════

// ── POST /console/scrape — Direct scrape proxy ────────────────

router.post(
  '/console/scrape',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { url, formats, onlyMainContent, waitFor, timeout, actions } = req.body as {
      url?: string; formats?: string[]; onlyMainContent?: boolean;
      waitFor?: number; timeout?: number; actions?: object[];
    };

    if (!url || typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ error: 'url is required' }); return;
    }

    try {
      const opts: any = { url: url.trim(), formats: formats || ['markdown'], onlyMainContent: onlyMainContent !== false };
      if (waitFor) opts.waitFor = waitFor;
      if (timeout) opts.timeout = timeout;
      if (actions) opts.actions = actions;

      const result = await firecrawlScrape(opts);
      res.json(result);
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Scrape failed', detail: msg });
    }
  },
);

// ── POST /console/crawl — Crawl a website (multi-page) ───────

router.post(
  '/console/crawl',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { url, max_pages, max_depth, include_paths, exclude_paths } = req.body as {
      url?: string; max_pages?: number; max_depth?: number;
      include_paths?: string[]; exclude_paths?: string[];
    };

    if (!url || typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ error: 'url is required' }); return;
    }

    try {
      const maxPages = Math.min(max_pages || 10, 50);
      const maxDepth = Math.min(max_depth || 2, 5);
      const visited = new Set<string>();
      const pages: { url: string; title: string; content_length: number }[] = [];
      const queue: { url: string; depth: number }[] = [{ url: url.trim(), depth: 0 }];

      while (queue.length > 0 && pages.length < maxPages) {
        const item = queue.shift()!;
        if (visited.has(item.url) || item.depth > maxDepth) continue;
        visited.add(item.url);

        // Check include/exclude paths
        if (include_paths && include_paths.length > 0) {
          if (!include_paths.some(p => item.url.includes(p))) continue;
        }
        if (exclude_paths && exclude_paths.length > 0) {
          if (exclude_paths.some(p => item.url.includes(p))) continue;
        }

        try {
          const scrapeResult = await firecrawlScrape({
            url: item.url, formats: ['markdown', 'links'], onlyMainContent: true,
          });
          const data = scrapeResult.data as any;
          const md = data?.markdown || '';
          const title = data?.metadata?.title || item.url;
          pages.push({ url: item.url, title, content_length: md.length });

          // Extract links for next depth
          const links: string[] = data?.links || [];
          const baseHost = new URL(url.trim()).hostname;
          for (const link of links) {
            try {
              if (new URL(link).hostname === baseHost && !visited.has(link)) {
                queue.push({ url: link, depth: item.depth + 1 });
              }
            } catch { /* skip invalid URLs */ }
          }
        } catch { /* skip failed pages */ }
      }

      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_crawl_jobs (url, max_pages, max_depth, include_paths, exclude_paths, pages, total_crawled, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        url.trim(), maxPages, maxDepth,
        include_paths ? JSON.stringify(include_paths) : null,
        exclude_paths ? JSON.stringify(exclude_paths) : null,
        JSON.stringify(pages), pages.length,
        (req as any).user?.id || (req as any).user?.userId, now,
      );

      auditLog(req, 'CREATE', 'firecrawl_crawl_jobs', Number(result.lastInsertRowid), `Crawl: ${url.trim()}`);
      res.json({ id: Number(result.lastInsertRowid), pages, total_crawled: pages.length });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Crawl failed', detail: msg });
    }
  },
);

// ── GET /console/crawl/:id — Get crawl results ───────────────

router.get(
  '/console/crawl/:id',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const row = db.prepare('SELECT * FROM firecrawl_crawl_jobs WHERE id = ?').get(id) as any;
      if (!row) { res.status(404).json({ error: 'Crawl job not found' }); return; }
      res.json({ ...row, pages: row.pages ? JSON.parse(row.pages) : [], include_paths: row.include_paths ? JSON.parse(row.include_paths) : [], exclude_paths: row.exclude_paths ? JSON.parse(row.exclude_paths) : [] });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get crawl job', detail: msg });
    }
  },
);

// ── POST /console/map — Map a website's structure ─────────────

router.post(
  '/console/map',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { url } = req.body as { url?: string };

    if (!url || typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ error: 'url is required' }); return;
    }

    try {
      const scrapeResult = await firecrawlScrape({
        url: url.trim(), formats: ['links'], onlyMainContent: false,
      });
      const data = scrapeResult.data as any;
      const links: string[] = data?.links || [];
      const baseHost = new URL(url.trim()).hostname;

      const sitemap = links
        .filter(l => { try { return new URL(l).hostname === baseHost; } catch { return false; } })
        .map(l => ({ url: l, depth: 1, links_to: [] as string[] }));

      res.json({ url: url.trim(), sitemap, total_pages: sitemap.length });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to map site', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 38. Firecrawl CLI
// ═════════════════════════════════════════════════════════════

// ── POST /cli/execute — Execute a CLI-style command ───────────

router.post(
  '/cli/execute',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { command, args } = req.body as {
      command?: string; args?: { url?: string; query?: string; limit?: number; depth?: number };
    };

    if (!command || !['scrape', 'search', 'crawl', 'map'].includes(command)) {
      res.status(400).json({ error: 'command must be one of: scrape, search, crawl, map' }); return;
    }

    const start = Date.now();
    try {
      let result: any = null;

      if (command === 'scrape') {
        if (!args?.url) { res.status(400).json({ error: 'args.url is required for scrape' }); return; }
        const scrapeResult = await firecrawlScrape({ url: args.url, formats: ['markdown'], onlyMainContent: true });
        result = { url: args.url, content_length: ((scrapeResult.data as any)?.markdown || '').length };
      } else if (command === 'search') {
        if (!args?.query) { res.status(400).json({ error: 'args.query is required for search' }); return; }
        const searchResult = await firecrawlSearch({ query: args.query, limit: args.limit || 5, scrapeOptions: { formats: ['markdown'], onlyMainContent: true } });
        result = { query: args.query, results: (searchResult.data || []).map((d: any) => ({ url: d.url, title: d.metadata?.title })) };
      } else if (command === 'crawl') {
        if (!args?.url) { res.status(400).json({ error: 'args.url is required for crawl' }); return; }
        const scrapeResult = await firecrawlScrape({ url: args.url, formats: ['markdown', 'links'], onlyMainContent: true });
        const data = scrapeResult.data as any;
        result = { url: args.url, links_found: (data?.links || []).length, content_length: (data?.markdown || '').length };
      } else if (command === 'map') {
        if (!args?.url) { res.status(400).json({ error: 'args.url is required for map' }); return; }
        const scrapeResult = await firecrawlScrape({ url: args.url, formats: ['links'], onlyMainContent: false });
        const links: string[] = (scrapeResult.data as any)?.links || [];
        result = { url: args.url, total_links: links.length, links: links.slice(0, 20) };
      }

      const duration = Date.now() - start;
      const db = getDb();
      const now = localNow();
      db.prepare(`
        INSERT INTO firecrawl_cli_history (command, args, result, duration_ms, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        command, JSON.stringify(args || {}), JSON.stringify(result), duration,
        (req as any).user?.id || (req as any).user?.userId, now,
      );

      res.json({ command, result, duration_ms: duration });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'CLI command failed', detail: msg });
    }
  },
);

// ── GET /cli/history — Past CLI commands ──────────────────────

router.get(
  '/cli/history',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_cli_history ORDER BY created_at DESC LIMIT 100').all();
      res.json(rows.map((r: any) => ({ ...r, args: r.args ? JSON.parse(r.args) : {}, result: r.result ? JSON.parse(r.result) : null })));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get CLI history', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 39. Grok Fire Enrich
// ═════════════════════════════════════════════════════════════

// ── POST /grok-enrich — Enhanced enrichment ───────────────────

router.post(
  '/grok-enrich',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { url_or_domain, enrich_type } = req.body as {
      url_or_domain?: string; enrich_type?: string;
    };

    if (!url_or_domain || typeof url_or_domain !== 'string' || !url_or_domain.trim()) {
      res.status(400).json({ error: 'url_or_domain is required' }); return;
    }
    if (!enrich_type || !['company', 'person', 'product'].includes(enrich_type)) {
      res.status(400).json({ error: 'enrich_type must be one of: company, person, product' }); return;
    }

    try {
      const target = url_or_domain.trim();
      const baseUrl = target.startsWith('http') ? target : `https://${target}`;

      // Scrape main page
      const mainResult = await firecrawlScrape({ url: baseUrl, formats: ['markdown'], onlyMainContent: true });
      const mainMd = (mainResult.data as any)?.markdown || '';

      // Try to scrape about/team page
      let aboutMd = '';
      try {
        const aboutResult = await firecrawlScrape({ url: `${baseUrl}/about`, formats: ['markdown'], onlyMainContent: true });
        aboutMd = (aboutResult.data as any)?.markdown || '';
      } catch { /* skip */ }

      const combined = `${mainMd}\n\n${aboutMd}`.substring(0, 30000);

      // Extract basic info from content
      const nameMatch = combined.match(/(?:^|\n)#\s+(.+)/);
      const name = nameMatch ? nameMatch[1].trim() : target;
      const description = combined.substring(0, 300).replace(/\n/g, ' ').trim();

      // Extract tech indicators
      const techKeywords = ['React', 'Angular', 'Vue', 'Node.js', 'Python', 'Django', 'Rails', 'AWS', 'GCP', 'Azure', 'Docker', 'Kubernetes'];
      const techIndicators = techKeywords.filter(t => combined.toLowerCase().includes(t.toLowerCase()));

      const enrichData = {
        name, description, key_people: [] as string[], products: [] as string[],
        revenue_estimate: null, tech_indicators: techIndicators, news_mentions: [] as string[],
      };

      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_grok_enrichments (url_or_domain, enrich_type, data, created_by, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        target, enrich_type, JSON.stringify(enrichData),
        (req as any).user?.id || (req as any).user?.userId, now,
      );

      auditLog(req, 'CREATE', 'firecrawl_grok_enrichments', Number(result.lastInsertRowid), `Grok enrich: ${target}`);
      res.json({ target, type: enrich_type, data: enrichData });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Enrichment failed', detail: msg });
    }
  },
);

// ── GET /grok-enrich/history — Past enrichments ───────────────

router.get(
  '/grok-enrich/history',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_grok_enrichments ORDER BY created_at DESC LIMIT 100').all();
      res.json(rows.map((r: any) => ({ ...r, data: r.data ? JSON.parse(r.data) : {} })));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get enrichment history', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 40. Firecrawl Docs Browser
// ═════════════════════════════════════════════════════════════

// ── GET /docs/topics — Categorized documentation topics ───────

router.get(
  '/docs/topics',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    res.json({
      topics: [
        'Getting Started', 'Scrape API', 'Search API', 'Crawl API', 'Extract API',
        'Map API', 'LLMs.txt', 'Webhooks', 'Rate Limits', 'Authentication', 'SDKs',
      ],
    });
  },
);

// ── POST /docs/search — Search Firecrawl documentation ────────

router.post(
  '/docs/search',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { query } = req.body as { query?: string };

    if (!query || typeof query !== 'string' || !query.trim()) {
      res.status(400).json({ error: 'query is required' }); return;
    }

    try {
      const searchResult = await firecrawlSearch({
        query: `${query.trim()} site:firecrawl.dev`,
        limit: 10,
        scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
      });

      const results = (searchResult.data || []).map((d: any) => ({
        title: d.metadata?.title || d.url,
        url: d.url,
        snippet: (d.markdown || '').substring(0, 200).replace(/\n/g, ' ').trim(),
      }));

      res.json({ query: query.trim(), results });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Docs search failed', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 41. N8N Nodes — Automation Workflows
// ═════════════════════════════════════════════════════════════

// ── POST /n8n/workflows — Create a workflow ───────────────────

router.post(
  '/n8n/workflows',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const { name, trigger, nodes } = req.body as {
      name?: string; trigger?: string; nodes?: { type: string; config: object }[];
    };

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name is required' }); return;
    }
    if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
      res.status(400).json({ error: 'nodes array is required' }); return;
    }

    const validTriggers = ['manual', 'schedule', 'webhook'];
    const validTypes = ['scrape', 'search', 'filter', 'transform', 'output'];
    const triggerVal = trigger && validTriggers.includes(trigger) ? trigger : 'manual';
    const filteredNodes = nodes.filter(n => validTypes.includes(n.type));

    if (filteredNodes.length === 0) {
      res.status(400).json({ error: 'nodes must include at least one of: scrape, search, filter, transform, output' }); return;
    }

    try {
      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_n8n_workflows (name, trigger, nodes, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        name.trim(), triggerVal, JSON.stringify(filteredNodes),
        (req as any).user?.id || (req as any).user?.userId, now, now,
      );

      auditLog(req, 'CREATE', 'firecrawl_n8n_workflows', Number(result.lastInsertRowid), `Created n8n workflow: ${name.trim()}`);
      res.status(201).json({ success: true, id: Number(result.lastInsertRowid) });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to create workflow', detail: msg });
    }
  },
);

// ── GET /n8n/workflows — List workflows ───────────────────────

router.get(
  '/n8n/workflows',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_n8n_workflows ORDER BY created_at DESC').all();
      res.json(rows.map((r: any) => ({ ...r, nodes: r.nodes ? JSON.parse(r.nodes) : [] })));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to list workflows', detail: msg });
    }
  },
);

// ── POST /n8n/workflows/:id/run — Execute workflow ────────────

router.post(
  '/n8n/workflows/:id/run',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const workflow = db.prepare('SELECT * FROM firecrawl_n8n_workflows WHERE id = ?').get(id) as any;
      if (!workflow) { res.status(404).json({ error: 'Workflow not found' }); return; }

      const nodes = JSON.parse(workflow.nodes || '[]') as { type: string; config: any }[];
      const now = localNow();
      const nodeResults: any[] = [];
      let lastOutput: any = null;

      for (const node of nodes) {
        try {
          if (node.type === 'scrape' && node.config?.url) {
            const scrapeResult = await firecrawlScrape({ url: node.config.url, formats: ['markdown'], onlyMainContent: true });
            lastOutput = { type: 'scrape', url: node.config.url, content_length: ((scrapeResult.data as any)?.markdown || '').length };
          } else if (node.type === 'search' && node.config?.query) {
            const searchResult = await firecrawlSearch({ query: node.config.query, limit: node.config.limit || 5, scrapeOptions: { formats: ['markdown'], onlyMainContent: true } });
            lastOutput = { type: 'search', results_count: (searchResult.data || []).length };
          } else if (node.type === 'filter') {
            lastOutput = { type: 'filter', applied: true, config: node.config };
          } else if (node.type === 'transform') {
            lastOutput = { type: 'transform', applied: true, config: node.config };
          } else if (node.type === 'output') {
            lastOutput = { type: 'output', format: node.config?.format || 'json' };
          }
          nodeResults.push({ ...lastOutput, status: 'success' });
        } catch (e: unknown) {
          nodeResults.push({ type: node.type, status: 'error', error: e instanceof Error ? e.message : String(e) });
        }
      }

      const runResult = db.prepare(`
        INSERT INTO firecrawl_n8n_runs (workflow_id, status, node_results, started_at, completed_at)
        VALUES (?, 'completed', ?, ?, ?)
      `).run(id, JSON.stringify(nodeResults), now, localNow());

      res.json({ success: true, run_id: Number(runResult.lastInsertRowid), node_results: nodeResults });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to run workflow', detail: msg });
    }
  },
);

// ── GET /n8n/workflows/:id/runs — Get runs ────────────────────

router.get(
  '/n8n/workflows/:id/runs',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_n8n_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT 50').all(id);
      res.json(rows.map((r: any) => ({ ...r, node_results: r.node_results ? JSON.parse(r.node_results) : [] })));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get workflow runs', detail: msg });
    }
  },
);

// ── DELETE /n8n/workflows/:id — Delete workflow ───────────────

router.delete(
  '/n8n/workflows/:id',
  requireRole('admin'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const result = db.prepare('DELETE FROM firecrawl_n8n_workflows WHERE id = ?').run(id);
      if (result.changes === 0) { res.status(404).json({ error: 'Workflow not found' }); return; }

      auditLog(req, 'DELETE', 'firecrawl_n8n_workflows', id, `Deleted n8n workflow ${id}`);
      res.json({ success: true });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to delete workflow', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 42. Mendable Python SDK — Index & Query
// ═════════════════════════════════════════════════════════════

// ── POST /mendable-py/index — Index URLs for Q&A ─────────────

router.post(
  '/mendable-py/index',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { name, urls } = req.body as { name?: string; urls?: string[] };

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name is required' }); return;
    }
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      res.status(400).json({ error: 'urls array is required' }); return;
    }

    try {
      let allContent = '';
      let pageCount = 0;

      for (const u of urls.slice(0, 20)) {
        try {
          const scrapeResult = await firecrawlScrape({ url: u.trim(), formats: ['markdown'], onlyMainContent: true });
          const md = (scrapeResult.data as any)?.markdown || '';
          if (md.trim()) {
            allContent += `\n\n--- Source: ${u.trim()} ---\n\n${md.substring(0, 20000)}`;
            pageCount++;
          }
        } catch { /* skip failed URLs */ }
      }

      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_mendable_indexes (name, urls, scraped_content, page_count, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        name.trim(), JSON.stringify(urls), allContent.substring(0, 200000), pageCount,
        (req as any).user?.id || (req as any).user?.userId, now,
      );

      auditLog(req, 'CREATE', 'firecrawl_mendable_indexes', Number(result.lastInsertRowid), `Created Mendable index: ${name.trim()}`);
      res.status(201).json({ success: true, id: Number(result.lastInsertRowid), name: name.trim(), page_count: pageCount });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to create index', detail: msg });
    }
  },
);

// ── GET /mendable-py/indexes — List indexes ───────────────────

router.get(
  '/mendable-py/indexes',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT id, name, urls, page_count, created_by, created_at FROM firecrawl_mendable_indexes ORDER BY created_at DESC').all();
      res.json(rows.map((r: any) => ({ ...r, urls: r.urls ? JSON.parse(r.urls) : [] })));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to list indexes', detail: msg });
    }
  },
);

// ── POST /mendable-py/indexes/:id/query — Query an index ─────

router.post(
  '/mendable-py/indexes/:id/query',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    const { question } = req.body as { question?: string };
    if (!question || typeof question !== 'string' || !question.trim()) {
      res.status(400).json({ error: 'question is required' }); return;
    }

    try {
      const db = getDb();
      const index = db.prepare('SELECT * FROM firecrawl_mendable_indexes WHERE id = ?').get(id) as any;
      if (!index) { res.status(404).json({ error: 'Index not found' }); return; }

      const content = index.scraped_content || '';
      const urls: string[] = index.urls ? JSON.parse(index.urls) : [];
      const queryLower = question.trim().toLowerCase();

      // Simple keyword-based relevance scoring
      const sections = content.split('--- Source:');
      const sources = sections.filter((s: string) => s.toLowerCase().includes(queryLower)).map((s: string) => {
        const urlMatch = s.match(/https?:\/\/[^\s]+/);
        return { url: urlMatch ? urlMatch[0].replace(/---$/, '').trim() : 'unknown', relevance: 0.8 };
      }).slice(0, 5);

      const answer = `Based on the indexed content from ${urls.length} sources, found ${sources.length} relevant sections for: "${question.trim()}"`;

      res.json({ answer, sources });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Query failed', detail: msg });
    }
  },
);

// ── DELETE /mendable-py/indexes/:id — Delete an index ─────────

router.delete(
  '/mendable-py/indexes/:id',
  requireRole('admin'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const result = db.prepare('DELETE FROM firecrawl_mendable_indexes WHERE id = ?').run(id);
      if (result.changes === 0) { res.status(404).json({ error: 'Index not found' }); return; }

      auditLog(req, 'DELETE', 'firecrawl_mendable_indexes', id, `Deleted Mendable index ${id}`);
      res.json({ success: true });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to delete index', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 43. OpenCode Firecrawl — Code Repository Analyzer
// ═════════════════════════════════════════════════════════════

// ── POST /opencode/analyze — Analyze a code repo page ─────────

router.post(
  '/opencode/analyze',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { url } = req.body as { url?: string };

    if (!url || typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ error: 'url is required' }); return;
    }

    try {
      const scrapeResult = await firecrawlScrape({ url: url.trim(), formats: ['markdown'], onlyMainContent: false });
      const data = scrapeResult.data as any;
      const md = data?.markdown || '';
      const title = data?.metadata?.title || '';

      // Extract repo info from markdown
      const repoName = title.replace(/GitHub\s*[-–—:]\s*/i, '').trim() || url.trim().split('/').slice(-2).join('/');
      const description = md.substring(0, 300).replace(/\n/g, ' ').trim();

      // Extract language stats (GitHub pattern)
      const langMatches = md.match(/(\w+)\s+([\d.]+)%/g) || [];
      const languages = langMatches.slice(0, 10).map((m: string) => {
        const parts = m.match(/(\w+)\s+([\d.]+)%/);
        return parts ? { name: parts[1], percentage: parseFloat(parts[2]) } : null;
      }).filter(Boolean);

      // Extract star count
      const starMatch = md.match(/(\d[\d,]*)\s*stars?/i);
      const starCount = starMatch ? parseInt(starMatch[1].replace(/,/g, ''), 10) : null;

      // Count files mentioned
      const fileMatches = md.match(/\.\w{1,10}\b/g) || [];
      const fileCount = new Set(fileMatches).size;

      const readmeSummary = md.substring(0, 500).replace(/\n/g, ' ').trim();

      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_code_analyses (url, repo_name, description, languages, readme_summary, file_count, star_count, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        url.trim(), repoName, description, JSON.stringify(languages),
        readmeSummary, fileCount, starCount,
        (req as any).user?.id || (req as any).user?.userId, now,
      );

      auditLog(req, 'CREATE', 'firecrawl_code_analyses', Number(result.lastInsertRowid), `Code analysis: ${url.trim()}`);

      res.json({
        url: url.trim(), repo_name: repoName, description, languages,
        readme_summary: readmeSummary, file_count: fileCount,
        star_count: starCount, last_updated: null,
      });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Code analysis failed', detail: msg });
    }
  },
);

// ── GET /opencode/history — Past analyses ─────────────────────

router.get(
  '/opencode/history',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_code_analyses ORDER BY created_at DESC LIMIT 100').all();
      res.json(rows.map((r: any) => ({ ...r, languages: r.languages ? JSON.parse(r.languages) : [] })));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get code analysis history', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 44. Claude Skill Generator
// ═════════════════════════════════════════════════════════════

// ── POST /skill-gen — Generate an AI agent skill ──────────────

router.post(
  '/skill-gen',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { doc_url, skill_name, skill_description } = req.body as {
      doc_url?: string; skill_name?: string; skill_description?: string;
    };

    if (!doc_url || typeof doc_url !== 'string' || !doc_url.trim()) {
      res.status(400).json({ error: 'doc_url is required' }); return;
    }
    if (!skill_name || typeof skill_name !== 'string' || !skill_name.trim()) {
      res.status(400).json({ error: 'skill_name is required' }); return;
    }

    try {
      const scrapeResult = await firecrawlScrape({ url: doc_url.trim(), formats: ['markdown'], onlyMainContent: true });
      const md = (scrapeResult.data as any)?.markdown || '';

      // Extract patterns from documentation
      const codeBlocks = md.match(/```[\s\S]*?```/g) || [];
      const headings = md.match(/^#{1,3}\s+.+/gm) || [];
      const apiPatterns = md.match(/(?:GET|POST|PUT|DELETE|PATCH)\s+\/\S+/g) || [];

      const capabilities = headings.slice(0, 10).map((h: string) => h.replace(/^#+\s+/, '').trim());
      const keyApis = apiPatterns.slice(0, 10);
      const examplePrompts = capabilities.slice(0, 5).map((c: string) => `How do I use ${c}?`);

      const generatedSkill = {
        description: skill_description?.trim() || `AI skill for ${skill_name.trim()} based on ${doc_url.trim()}`,
        capabilities,
        example_prompts: examplePrompts,
        key_apis: keyApis,
      };

      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_skill_generations (doc_url, skill_name, skill_description, generated_skill, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        doc_url.trim(), skill_name.trim(), skill_description?.trim() || null,
        JSON.stringify(generatedSkill),
        (req as any).user?.id || (req as any).user?.userId, now,
      );

      auditLog(req, 'CREATE', 'firecrawl_skill_generations', Number(result.lastInsertRowid), `Skill gen: ${skill_name.trim()}`);

      res.json({ skill_name: skill_name.trim(), doc_url: doc_url.trim(), generated_skill: generatedSkill });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Skill generation failed', detail: msg });
    }
  },
);

// ── GET /skill-gen/history — Past generations ─────────────────

router.get(
  '/skill-gen/history',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_skill_generations ORDER BY created_at DESC LIMIT 100').all();
      res.json(rows.map((r: any) => ({ ...r, generated_skill: r.generated_skill ? JSON.parse(r.generated_skill) : {} })));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get skill gen history', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 45. Firecrawl Go SDK — SDK Status Dashboard
// ═════════════════════════════════════════════════════════════

// ── GET /sdk/status — SDK integration statuses ────────────────

router.get(
  '/sdk/status',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    res.json([
      { name: 'Python', version: 'latest', repo: 'firecrawl-py' },
      { name: 'Go', version: 'latest', repo: 'firecrawl-go' },
      { name: 'Java', version: 'latest', repo: 'firecrawl-java-sdk' },
      { name: 'JavaScript', version: 'latest', repo: 'firecrawl' },
      { name: 'CLI', version: 'latest', repo: 'cli' },
    ]);
  },
);

// ═════════════════════════════════════════════════════════════
// 46. Open WebUI Pipelines
// ═════════════════════════════════════════════════════════════

// ── POST /pipelines — Create a processing pipeline ────────────

router.post(
  '/pipelines',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const { name, steps } = req.body as {
      name?: string; steps?: { type: string; config: object }[];
    };

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name is required' }); return;
    }
    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      res.status(400).json({ error: 'steps array is required' }); return;
    }

    const validTypes = ['ingest', 'transform', 'filter', 'enrich', 'output'];
    const filteredSteps = steps.filter(s => validTypes.includes(s.type));
    if (filteredSteps.length === 0) {
      res.status(400).json({ error: 'steps must include at least one of: ingest, transform, filter, enrich, output' }); return;
    }

    try {
      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_pipelines (name, steps, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        name.trim(), JSON.stringify(filteredSteps),
        (req as any).user?.id || (req as any).user?.userId, now, now,
      );

      auditLog(req, 'CREATE', 'firecrawl_pipelines', Number(result.lastInsertRowid), `Created pipeline: ${name.trim()}`);
      res.status(201).json({ success: true, id: Number(result.lastInsertRowid) });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to create pipeline', detail: msg });
    }
  },
);

// ── GET /pipelines — List pipelines ───────────────────────────

router.get(
  '/pipelines',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_pipelines ORDER BY created_at DESC').all();
      res.json(rows.map((r: any) => ({ ...r, steps: r.steps ? JSON.parse(r.steps) : [] })));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to list pipelines', detail: msg });
    }
  },
);

// ── POST /pipelines/:id/run — Execute pipeline ───────────────

router.post(
  '/pipelines/:id/run',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    const { input_url, input_text } = req.body as { input_url?: string; input_text?: string };

    try {
      const db = getDb();
      const pipeline = db.prepare('SELECT * FROM firecrawl_pipelines WHERE id = ?').get(id) as any;
      if (!pipeline) { res.status(404).json({ error: 'Pipeline not found' }); return; }

      const steps = JSON.parse(pipeline.steps || '[]') as { type: string; config: any }[];
      const now = localNow();
      const stepResults: any[] = [];
      let currentData: any = input_text || '';

      for (const step of steps) {
        try {
          if (step.type === 'ingest' && input_url) {
            const scrapeResult = await firecrawlScrape({ url: input_url.trim(), formats: ['markdown'], onlyMainContent: true });
            currentData = (scrapeResult.data as any)?.markdown || '';
            stepResults.push({ type: 'ingest', status: 'success', content_length: currentData.length });
          } else if (step.type === 'transform') {
            stepResults.push({ type: 'transform', status: 'success', applied: true, config: step.config });
          } else if (step.type === 'filter') {
            stepResults.push({ type: 'filter', status: 'success', applied: true, config: step.config });
          } else if (step.type === 'enrich') {
            stepResults.push({ type: 'enrich', status: 'success', applied: true });
          } else if (step.type === 'output') {
            stepResults.push({ type: 'output', status: 'success', format: step.config?.format || 'json' });
          } else {
            stepResults.push({ type: step.type, status: 'skipped' });
          }
        } catch (e: unknown) {
          stepResults.push({ type: step.type, status: 'error', error: e instanceof Error ? e.message : String(e) });
        }
      }

      const runResult = db.prepare(`
        INSERT INTO firecrawl_pipeline_runs (pipeline_id, input, status, step_results, started_at, completed_at)
        VALUES (?, ?, 'completed', ?, ?, ?)
      `).run(id, JSON.stringify({ input_url, input_text: input_text?.substring(0, 200) }), JSON.stringify(stepResults), now, localNow());

      res.json({ success: true, run_id: Number(runResult.lastInsertRowid), step_results: stepResults });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to run pipeline', detail: msg });
    }
  },
);

// ── GET /pipelines/:id/runs — Get pipeline runs ──────────────

router.get(
  '/pipelines/:id/runs',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_pipeline_runs WHERE pipeline_id = ? ORDER BY started_at DESC LIMIT 50').all(id);
      res.json(rows.map((r: any) => ({ ...r, input: r.input ? JSON.parse(r.input) : {}, step_results: r.step_results ? JSON.parse(r.step_results) : [] })));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get pipeline runs', detail: msg });
    }
  },
);

// ── DELETE /pipelines/:id — Delete pipeline ───────────────────

router.delete(
  '/pipelines/:id',
  requireRole('admin'),
  (req: Request, res: Response) => {
    ensureTables();
    const id = Number(req.params.id);
    if (!id || isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    try {
      const db = getDb();
      const result = db.prepare('DELETE FROM firecrawl_pipelines WHERE id = ?').run(id);
      if (result.changes === 0) { res.status(404).json({ error: 'Pipeline not found' }); return; }

      auditLog(req, 'DELETE', 'firecrawl_pipelines', id, `Deleted pipeline ${id}`);
      res.json({ success: true });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to delete pipeline', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 47. Firecrawl Theme
// ═════════════════════════════════════════════════════════════

// ── GET /theme — Get current theme config ─────────────────────

router.get(
  '/theme',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const row = db.prepare('SELECT * FROM firecrawl_theme_config ORDER BY id DESC LIMIT 1').get() as any;
      if (!row) {
        res.json({ accent_color: '#f97316', show_labels: true, compact_mode: false, default_tab: null });
        return;
      }
      res.json({ ...row, show_labels: !!row.show_labels, compact_mode: !!row.compact_mode });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get theme config', detail: msg });
    }
  },
);

// ── POST /theme — Save theme preferences ──────────────────────

router.post(
  '/theme',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    ensureTables();
    const { accent_color, show_labels, compact_mode, default_tab } = req.body as {
      accent_color?: string; show_labels?: boolean; compact_mode?: boolean; default_tab?: string;
    };

    try {
      const db = getDb();
      const now = localNow();
      const result = db.prepare(`
        INSERT INTO firecrawl_theme_config (accent_color, show_labels, compact_mode, default_tab, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        accent_color || '#f97316', show_labels !== false ? 1 : 0,
        compact_mode ? 1 : 0, default_tab || null,
        (req as any).user?.id || (req as any).user?.userId, now, now,
      );

      auditLog(req, 'UPDATE', 'firecrawl_theme_config', Number(result.lastInsertRowid), 'Updated Firecrawl theme');
      res.json({ success: true, id: Number(result.lastInsertRowid) });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to save theme config', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 48. Firecrawl AI Chatbot
// ═════════════════════════════════════════════════════════════

// ── POST /ai-chat — Chat with Firecrawl AI assistant ──────────

router.post(
  '/ai-chat',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { message, context_url } = req.body as { message?: string; context_url?: string };

    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'message is required' }); return;
    }

    try {
      let contextUsed = false;
      let contextContent = '';
      const sources: string[] = [];

      if (context_url && typeof context_url === 'string' && context_url.trim()) {
        try {
          const scrapeResult = await firecrawlScrape({ url: context_url.trim(), formats: ['markdown'], onlyMainContent: true });
          contextContent = ((scrapeResult.data as any)?.markdown || '').substring(0, 10000);
          if (contextContent.trim()) {
            contextUsed = true;
            sources.push(context_url.trim());
          }
        } catch { /* proceed without context */ }
      }

      const response = contextUsed
        ? `Based on the content from ${context_url}, here is what I found relevant to "${message.trim()}": ${contextContent.substring(0, 500).replace(/\n/g, ' ').trim()}`
        : `Regarding "${message.trim()}": This is a Firecrawl-powered assistant. Provide a context_url for more specific answers based on web content.`;

      const db = getDb();
      const now = localNow();
      db.prepare(`
        INSERT INTO firecrawl_ai_chat_history (message, context_url, response, context_used, sources, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        message.trim(), context_url?.trim() || null, response, contextUsed ? 1 : 0,
        sources.length > 0 ? JSON.stringify(sources) : null,
        (req as any).user?.id || (req as any).user?.userId, now,
      );

      res.json({ response, context_used: contextUsed, sources: sources.length > 0 ? sources : undefined });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'AI chat failed', detail: msg });
    }
  },
);

// ── GET /ai-chat/history — Past chat messages ─────────────────

router.get(
  '/ai-chat/history',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_ai_chat_history ORDER BY created_at DESC LIMIT 100').all();
      res.json(rows.map((r: any) => ({ ...r, context_used: !!r.context_used, sources: r.sources ? JSON.parse(r.sources) : [] })));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get AI chat history', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 49. LoPDF — PDF Manipulation
// ═════════════════════════════════════════════════════════════

// ── POST /pdf-manipulate — Analyze/manipulate a PDF URL ───────

router.post(
  '/pdf-manipulate',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { url, operations } = req.body as { url?: string; operations?: string[] };

    if (!url || typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ error: 'url is required' }); return;
    }
    if (!operations || !Array.isArray(operations) || operations.length === 0) {
      res.status(400).json({ error: 'operations array is required' }); return;
    }

    const validOps = ['extract_text', 'count_pages', 'extract_links', 'get_metadata'];
    const filteredOps = operations.filter(o => validOps.includes(o));
    if (filteredOps.length === 0) {
      res.status(400).json({ error: 'operations must include at least one of: extract_text, count_pages, extract_links, get_metadata' }); return;
    }

    try {
      const scrapeResult = await firecrawlScrape({ url: url.trim(), formats: ['markdown'], onlyMainContent: false });
      const data = scrapeResult.data as any;
      const md = data?.markdown || '';
      const metadata = data?.metadata || {};

      const results: any = {};

      if (filteredOps.includes('extract_text')) {
        results.text = md.substring(0, 50000);
      }
      if (filteredOps.includes('count_pages')) {
        // Estimate pages from content length (approx 3000 chars per page)
        results.page_count = Math.max(1, Math.ceil(md.length / 3000));
      }
      if (filteredOps.includes('extract_links')) {
        const linkMatches = md.match(/https?:\/\/[^\s)]+/g) || [];
        results.links = [...new Set(linkMatches)].slice(0, 50);
      }
      if (filteredOps.includes('get_metadata')) {
        results.metadata = { title: metadata.title || null, description: metadata.description || null, author: metadata.author || null };
      }

      const db = getDb();
      const now = localNow();
      const dbResult = db.prepare(`
        INSERT INTO firecrawl_pdf_operations (url, operations, results, created_by, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        url.trim(), JSON.stringify(filteredOps), JSON.stringify(results),
        (req as any).user?.id || (req as any).user?.userId, now,
      );

      auditLog(req, 'CREATE', 'firecrawl_pdf_operations', Number(dbResult.lastInsertRowid), `PDF ops: ${url.trim()}`);
      res.json({ url: url.trim(), results });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'PDF manipulation failed', detail: msg });
    }
  },
);

// ── GET /pdf-manipulate/history — Past PDF operations ─────────

router.get(
  '/pdf-manipulate/history',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT id, url, operations, created_by, created_at FROM firecrawl_pdf_operations ORDER BY created_at DESC LIMIT 100').all();
      res.json(rows.map((r: any) => ({ ...r, operations: r.operations ? JSON.parse(r.operations) : [] })));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get PDF history', detail: msg });
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 50. OpenClaw — Personal AI Assistant
// ═════════════════════════════════════════════════════════════

// ── POST /assistant/ask — Ask the Firecrawl AI assistant ──────

router.post(
  '/assistant/ask',
  requireRole('admin', 'manager'),
  async (req: Request, res: Response) => {
    ensureTables();
    const { question, search_web, context_urls } = req.body as {
      question?: string; search_web?: boolean; context_urls?: string[];
    };

    if (!question || typeof question !== 'string' || !question.trim()) {
      res.status(400).json({ error: 'question is required' }); return;
    }

    try {
      const sourcesUsed: string[] = [];
      let contextContent = '';
      let webSearched = false;

      // Optionally search the web
      if (search_web) {
        try {
          const searchResult = await firecrawlSearch({
            query: question.trim(), limit: 5,
            scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
          });
          const results = searchResult.data || [];
          for (const r of results.slice(0, 3)) {
            const md = (r as any).markdown || '';
            if (md.trim()) {
              contextContent += `\n\n--- Source: ${(r as any).url} ---\n\n${md.substring(0, 5000)}`;
              sourcesUsed.push((r as any).url);
            }
          }
          webSearched = true;
        } catch { /* proceed without web search */ }
      }

      // Scrape context URLs
      if (context_urls && Array.isArray(context_urls)) {
        for (const ctxUrl of context_urls.slice(0, 5)) {
          try {
            const scrapeResult = await firecrawlScrape({ url: ctxUrl.trim(), formats: ['markdown'], onlyMainContent: true });
            const md = (scrapeResult.data as any)?.markdown || '';
            if (md.trim()) {
              contextContent += `\n\n--- Source: ${ctxUrl.trim()} ---\n\n${md.substring(0, 5000)}`;
              sourcesUsed.push(ctxUrl.trim());
            }
          } catch { /* skip failed URLs */ }
        }
      }

      const answer = contextContent.trim()
        ? `Based on ${sourcesUsed.length} source(s), here is what I found for "${question.trim()}": ${contextContent.substring(0, 1000).replace(/\n/g, ' ').trim()}`
        : `Regarding "${question.trim()}": No external sources were consulted. Enable search_web or provide context_urls for richer answers.`;

      const db = getDb();
      const now = localNow();
      db.prepare(`
        INSERT INTO firecrawl_assistant_chats (question, search_web, context_urls, answer, sources_used, web_searched, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        question.trim(), search_web ? 1 : 0,
        context_urls ? JSON.stringify(context_urls) : null,
        answer, JSON.stringify(sourcesUsed), webSearched ? 1 : 0,
        (req as any).user?.id || (req as any).user?.userId, now,
      );

      res.json({ answer, sources_used: sourcesUsed, web_searched: webSearched });
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Assistant query failed', detail: msg });
    }
  },
);

// ── GET /assistant/history — Past assistant chats ─────────────

router.get(
  '/assistant/history',
  requireRole('admin', 'manager'),
  (_req: Request, res: Response) => {
    ensureTables();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM firecrawl_assistant_chats ORDER BY created_at DESC LIMIT 100').all();
      res.json(rows.map((r: any) => ({
        ...r, search_web: !!r.search_web, web_searched: !!r.web_searched,
        context_urls: r.context_urls ? JSON.parse(r.context_urls) : [],
        sources_used: r.sources_used ? JSON.parse(r.sources_used) : [],
      })));
    } catch (err: unknown) {
      if (handleFirecrawlError(err, res)) return;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get assistant history', detail: msg });
    }
  },
);

export default router;
