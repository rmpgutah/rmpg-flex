-- ============================================================
-- 0199: AI Settings dashboard — model presets + prompt templates
-- ============================================================
-- Backs AdminAISettingsTab.tsx's Model Tuning (presets) and Prompt
-- Workshop (templates) sub-panels — both previously called endpoints
-- with no backend at all. Everything else the AI Settings dashboard
-- needs (behavior config, master config, per-provider config, model
-- params defaults) is stored as JSON blobs in the existing
-- system_config table (category 'ai') — no schema needed for those.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_model_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  temperature REAL NOT NULL DEFAULT 0.7,
  max_tokens INTEGER NOT NULL DEFAULT 1024,
  top_p REAL NOT NULL DEFAULT 0.9,
  repeat_penalty REAL NOT NULL DEFAULT 1.0,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_prompt_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  system_prompt TEXT,
  user_message TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_prompt_templates_category ON ai_prompt_templates(category);
