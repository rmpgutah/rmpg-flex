/**
 * AI Manager — Provider Selection, Fallback & Usage Tracking
 *
 * Reads configuration from server/data/ai-config.json (if it exists)
 * and from environment variables (env vars take priority).
 *
 * Exposes a unified chat() interface plus the domain-specific helpers
 * (analyzeCall, generateNarrative, suggestUnits) that delegate to chat().
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
  AIProvider,
  ChatOptions,
  GroqProvider,
  GeminiProvider,
  OpenAIProvider,
  OllamaProvider,
} from './aiProvider';

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export type TaskType = 'callAnalysis' | 'narrativeAssist' | 'unitSuggestions' | 'safetyBriefings' | 'dataCleanup' | 'general';
export type ProviderName = 'groq' | 'gemini' | 'openai' | 'ollama' | 'auto';

export interface RoutingRule {
  provider: ProviderName;
}

export interface AIActivityEntry {
  id: string;
  timestamp: string;
  taskType: string;
  provider: string;
  latencyMs: number;
  success: boolean;
  error?: string;
  promptPreview: string;
}

export interface AIFeatures {
  callAnalysis: boolean;
  narrativeAssist: boolean;
  unitSuggestions: boolean;
  safetyBriefings: boolean;
  dataCleanup: boolean;
  systemMonitoring: boolean;
}

export interface ProviderConfig {
  groq: { apiKey: string; model: string };
  gemini: { apiKey: string; model: string };
  openai: { apiKey: string; model: string; baseUrl: string };
  ollama: { url: string; model: string };
}

export interface AIConfig {
  provider: 'groq' | 'gemini' | 'openai' | 'ollama' | 'auto';
  autoFallback: boolean;
  features: AIFeatures;
  providers: ProviderConfig;
  masterPrompt: string;
  chainMode: boolean;
  routingRules: Record<TaskType, RoutingRule>;
  providerPriority: ProviderName[];
}

// ---------------------------------------------------------------------------
// Usage stats tracking
// ---------------------------------------------------------------------------

interface UsageStats {
  requestsToday: number;
  requestsThisWeek: number;
  requestsThisMonth: number;
  todayDate: string;
  weekStart: string;
  monthStart: string;
  totalResponseTimeMs: number;
  totalRequests: number;
  cacheHits: number;
  cacheAttempts: number;
}

function getDateStr() { return new Date().toISOString().slice(0, 10); }
function getWeekStr() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d.setDate(diff));
  return mon.toISOString().slice(0, 10);
}
function getMonthStr() { return new Date().toISOString().slice(0, 7); }

let stats: UsageStats = {
  requestsToday: 0,
  requestsThisWeek: 0,
  requestsThisMonth: 0,
  todayDate: getDateStr(),
  weekStart: getWeekStr(),
  monthStart: getMonthStr(),
  totalResponseTimeMs: 0,
  totalRequests: 0,
  cacheHits: 0,
  cacheAttempts: 0,
};

function rollStats() {
  const today = getDateStr();
  const week = getWeekStr();
  const month = getMonthStr();
  if (stats.todayDate !== today) { stats.requestsToday = 0; stats.todayDate = today; }
  if (stats.weekStart !== week) { stats.requestsThisWeek = 0; stats.weekStart = week; }
  if (stats.monthStart !== month) { stats.requestsThisMonth = 0; stats.monthStart = month; }
}

function recordRequest(durationMs: number) {
  rollStats();
  stats.requestsToday++;
  stats.requestsThisWeek++;
  stats.requestsThisMonth++;
  stats.totalRequests++;
  stats.totalResponseTimeMs += durationMs;
}

export function getUsageStats() {
  rollStats();
  return {
    requestsToday: stats.requestsToday,
    requestsThisWeek: stats.requestsThisWeek,
    requestsThisMonth: stats.requestsThisMonth,
    avgResponseMs: stats.totalRequests > 0 ? Math.round(stats.totalResponseTimeMs / stats.totalRequests) : 0,
    cacheHitRate: stats.cacheAttempts > 0 ? Math.round((stats.cacheHits / stats.cacheAttempts) * 100) : 0,
    totalRequests: stats.totalRequests,
  };
}

// ---------------------------------------------------------------------------
// Rate limiter — shared across all providers
// ---------------------------------------------------------------------------

const RATE_LIMIT = 25;
const RATE_WINDOW_MS = 60_000;
const timestamps: number[] = [];

function rateLimitOk(): boolean {
  const now = Date.now();
  while (timestamps.length > 0 && timestamps[0] <= now - RATE_WINDOW_MS) {
    timestamps.shift();
  }
  if (timestamps.length >= RATE_LIMIT) return false;
  timestamps.push(now);
  return true;
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

const CONFIG_PATH = path.join(__dirname, '../../data/ai-config.json');

const DEFAULT_CONFIG: AIConfig = {
  provider: 'ollama',
  autoFallback: false,
  features: {
    callAnalysis: true,
    narrativeAssist: true,
    unitSuggestions: true,
    safetyBriefings: true,
    dataCleanup: false,
    systemMonitoring: false,
  },
  providers: {
    groq: { apiKey: '', model: 'llama-3.3-70b-versatile' },
    gemini: { apiKey: '', model: 'gemini-2.0-flash' },
    openai: { apiKey: '', model: 'gpt-4o-mini', baseUrl: '' },
    ollama: { url: 'http://localhost:11434', model: 'qwen3.5-uncensored' },
  },
  masterPrompt: 'You are the RMPG Flex AI assistant, supporting law enforcement dispatch operations for Rocky Mountain Protective Group in Salt Lake City, Utah. Provide concise, accurate, and actionable intelligence.',
  chainMode: false,
  routingRules: {
    callAnalysis: { provider: 'auto' },
    narrativeAssist: { provider: 'auto' },
    unitSuggestions: { provider: 'auto' },
    safetyBriefings: { provider: 'auto' },
    dataCleanup: { provider: 'auto' },
    general: { provider: 'auto' },
  },
  providerPriority: ['ollama'],
};

let _config: AIConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

// ---------------------------------------------------------------------------
// Activity log ring buffer
// ---------------------------------------------------------------------------

const activityLog: AIActivityEntry[] = [];
const MAX_ACTIVITY = 200;

function logActivity(entry: Omit<AIActivityEntry, 'id' | 'timestamp'>): void {
  activityLog.unshift({
    ...entry,
    id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
  });
  if (activityLog.length > MAX_ACTIVITY) activityLog.pop();
}

function getActivityLog(limit = 50): AIActivityEntry[] {
  return activityLog.slice(0, limit);
}

export function loadConfig(): AIConfig {
  // Start with defaults
  const cfg: AIConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

  // Read from JSON file if it exists
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const file = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      if (file.provider) cfg.provider = file.provider;
      if (typeof file.autoFallback === 'boolean') cfg.autoFallback = file.autoFallback;
      if (file.features) Object.assign(cfg.features, file.features);
      if (file.providers?.groq) Object.assign(cfg.providers.groq, file.providers.groq);
      if (file.providers?.gemini) Object.assign(cfg.providers.gemini, file.providers.gemini);
      if (file.providers?.openai) Object.assign(cfg.providers.openai, file.providers.openai);
      if (file.providers?.ollama) Object.assign(cfg.providers.ollama, file.providers.ollama);

      // New orchestrator fields (backward-compatible — old configs won't have these)
      if (typeof file.masterPrompt === 'string') cfg.masterPrompt = file.masterPrompt;
      if (typeof file.chainMode === 'boolean') cfg.chainMode = file.chainMode;
      if (file.routingRules) cfg.routingRules = { ...cfg.routingRules, ...file.routingRules };
      if (Array.isArray(file.providerPriority)) cfg.providerPriority = file.providerPriority;
    }
  } catch (err) {
    console.warn('[aiManager] Failed to read ai-config.json:', err);
  }

  // Env vars override (higher priority)
  if (process.env.AI_PROVIDER) cfg.provider = process.env.AI_PROVIDER as any;
  if (process.env.GROQ_API_KEY) cfg.providers.groq.apiKey = process.env.GROQ_API_KEY;
  if (process.env.GEMINI_API_KEY) cfg.providers.gemini.apiKey = process.env.GEMINI_API_KEY;
  if (process.env.OPENAI_API_KEY) cfg.providers.openai.apiKey = process.env.OPENAI_API_KEY;
  if (process.env.OPENAI_BASE_URL) cfg.providers.openai.baseUrl = process.env.OPENAI_BASE_URL;
  if (process.env.OLLAMA_URL) cfg.providers.ollama.url = process.env.OLLAMA_URL;

  _config = cfg;
  return cfg;
}

export function getConfig(): AIConfig {
  return _config;
}

export function saveConfig(updates: Partial<AIConfig>): AIConfig {
  // Merge updates into current config
  if (updates.provider) _config.provider = updates.provider;
  if (typeof updates.autoFallback === 'boolean') _config.autoFallback = updates.autoFallback;
  if (updates.features) Object.assign(_config.features, updates.features);
  if (updates.providers) {
    if (updates.providers.groq) Object.assign(_config.providers.groq, updates.providers.groq);
    if (updates.providers.gemini) Object.assign(_config.providers.gemini, updates.providers.gemini);
    if (updates.providers.openai) Object.assign(_config.providers.openai, updates.providers.openai);
    if (updates.providers.ollama) Object.assign(_config.providers.ollama, updates.providers.ollama);
  }
  if (typeof updates.masterPrompt === 'string') _config.masterPrompt = updates.masterPrompt;
  if (typeof updates.chainMode === 'boolean') _config.chainMode = updates.chainMode;
  if (updates.routingRules) _config.routingRules = { ..._config.routingRules, ...updates.routingRules };
  if (Array.isArray(updates.providerPriority)) _config.providerPriority = updates.providerPriority;

  // Write to JSON file
  try {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(_config, null, 2), 'utf-8');
  } catch (err) {
    console.error('[aiManager] Failed to write ai-config.json:', err);
  }

  // Rebuild providers
  buildProviders();
  return _config;
}

// ---------------------------------------------------------------------------
// Provider instances
// ---------------------------------------------------------------------------

let providers: AIProvider[] = [];

function buildProviders() {
  const cfg = _config;
  providers = [
    new GroqProvider(cfg.providers.groq.apiKey, cfg.providers.groq.model),
    new GeminiProvider(cfg.providers.gemini.apiKey, cfg.providers.gemini.model),
    new OpenAIProvider(cfg.providers.openai.apiKey, cfg.providers.openai.model, cfg.providers.openai.baseUrl),
    new OllamaProvider(cfg.providers.ollama.url, cfg.providers.ollama.model),
  ];
}

function getProviderByName(name: string): AIProvider | undefined {
  return providers.find(p => p.name === name);
}

// ---------------------------------------------------------------------------
// Core chat — selects provider, tries fallback
// ---------------------------------------------------------------------------

async function chat(
  systemPrompt: string,
  userMessage: string,
  options?: ChatOptions & { taskType?: TaskType },
): Promise<string | null> {
  if (!rateLimitOk()) {
    console.warn('[aiManager] Rate limit reached');
    return null;
  }

  const cfg = _config;
  const start = Date.now();
  const taskType = options?.taskType || 'general';
  const promptPreview = userMessage.slice(0, 120);

  // Prepend masterPrompt to system prompt if set and not already included
  let finalSystemPrompt = systemPrompt;
  if (cfg.masterPrompt && !systemPrompt.includes(cfg.masterPrompt)) {
    finalSystemPrompt = cfg.masterPrompt + '\n\n' + systemPrompt;
  }

  // Build ordered list of providers to try
  let ordered: AIProvider[] = [];

  // Check if routing rule specifies a non-auto provider for this task type
  const routingRule = cfg.routingRules?.[taskType];
  const routedProvider = routingRule && routingRule.provider !== 'auto'
    ? routingRule.provider
    : null;

  if (routedProvider) {
    // Use the routed provider first
    const primary = getProviderByName(routedProvider);
    if (primary && primary.isAvailable()) ordered.push(primary);

    // Fallback using providerPriority order
    if (cfg.autoFallback) {
      for (const name of cfg.providerPriority) {
        if (name === routedProvider || name === 'auto') continue;
        const p = getProviderByName(name);
        if (p && p.isAvailable() && !ordered.includes(p)) ordered.push(p);
      }
    }
  } else if (cfg.provider === 'auto') {
    // Auto: use providerPriority order
    for (const name of cfg.providerPriority) {
      if (name === 'auto') continue;
      const p = getProviderByName(name);
      if (p && p.isAvailable()) ordered.push(p);
    }
  } else {
    const primary = getProviderByName(cfg.provider);
    if (primary) ordered.push(primary);

    // If autoFallback is enabled, add the rest in providerPriority order
    if (cfg.autoFallback) {
      for (const name of cfg.providerPriority) {
        if (name === cfg.provider || name === 'auto') continue;
        const p = getProviderByName(name);
        if (p && p.isAvailable() && !ordered.includes(p)) ordered.push(p);
      }
    }
  }

  if (ordered.length === 0) return null;

  for (const provider of ordered) {
    try {
      const result = await provider.chat(finalSystemPrompt, userMessage, options);
      if (result !== null) {
        const latencyMs = Date.now() - start;
        recordRequest(latencyMs);
        logActivity({ taskType, provider: provider.name, latencyMs, success: true, promptPreview });
        return result;
      }
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      logActivity({ taskType, provider: provider.name, latencyMs, success: false, error: err?.message, promptPreview });
      console.warn(`[aiManager] Provider ${provider.name} failed, trying next...`, err?.message);
      continue;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Chained chat — optional two-step classification + analysis
// ---------------------------------------------------------------------------

async function chainedChat(
  taskType: TaskType,
  userMessage: string,
  options?: ChatOptions,
): Promise<string | null> {
  const masterSys = _config.masterPrompt || '';

  if (!_config.chainMode) {
    return chat(masterSys, userMessage, { ...options, taskType });
  }

  // Step 1: Quick classification with fast model
  const classifyResult = await chat(
    'Classify this dispatch request. Respond in JSON: {"complexity":"low"|"medium"|"high","summary":"one line summary"}',
    userMessage,
    { taskType: 'general', maxTokens: 100, jsonMode: true },
  );

  // Step 2: Full analysis with context from classification
  const context = classifyResult ? `\nInitial analysis: ${classifyResult}` : '';
  return chat(masterSys + context, userMessage, { ...options, taskType });
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export function getStatus() {
  const cfg = _config;
  const primary = cfg.provider === 'auto'
    ? providers.find(p => p.isAvailable())
    : getProviderByName(cfg.provider);

  return {
    provider: primary?.name || cfg.provider,
    available: providers.some(p => p.isAvailable()),
    model: primary?.model || 'none',
    providers: providers.map(p => ({
      name: p.name,
      available: p.isAvailable(),
      model: p.model,
    })),
  };
}

// ---------------------------------------------------------------------------
// Test a specific provider
// ---------------------------------------------------------------------------

export async function testProvider(providerName: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const provider = getProviderByName(providerName);
  if (!provider) return { ok: false, latencyMs: 0, error: 'Unknown provider' };
  if (!provider.isAvailable()) return { ok: false, latencyMs: 0, error: 'Provider not configured (missing API key)' };

  const start = Date.now();
  try {
    const result = await provider.chat(
      'You are a test assistant. Respond with exactly: OK',
      'Test connection. Reply with just "OK".',
      { temperature: 0, maxTokens: 10 },
    );
    const latencyMs = Date.now() - start;
    if (result && result.toLowerCase().includes('ok')) {
      return { ok: true, latencyMs };
    }
    return { ok: true, latencyMs }; // Got a response, even if unexpected
  } catch (err: any) {
    return { ok: false, latencyMs: Date.now() - start, error: err?.message || 'Connection failed' };
  }
}

// ---------------------------------------------------------------------------
// Initialize on import
// ---------------------------------------------------------------------------

loadConfig();
buildProviders();

// ---------------------------------------------------------------------------
// Export the manager
// ---------------------------------------------------------------------------

export const aiManager = {
  chat,
  chainedChat,
  getStatus,
  testProvider,
  getConfig,
  loadConfig,
  saveConfig,
  getUsageStats,
  getActivityLog,
};

export default aiManager;
