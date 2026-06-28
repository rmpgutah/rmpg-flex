// openai — thin client for the OpenAI Chat Completions API, used as the
// middle tier of the callAi() fallback chain (above Workers AI, below Claude).
// Key lives in system_config (openai_api_key, set via Admin → API Integrations),
// NOT a Worker secret, so admins rotate it from the UI without a redeploy.
// Mirrors src/utils/anthropic.ts in shape and error-classification approach.

import { queryFirst } from './db';

const API_URL = 'https://api.openai.com/v1/chat/completions';
// Default model: gpt-4o-mini is the cheapest 4-class option (~$0.15/1M input
// tokens) and is plenty good for fallback work. Override via system_config
// 'openai_model' (e.g. 'gpt-4o' for max quality, or 'gpt-4-turbo').
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

interface OpenAiEnv { DB: D1Database; }

/** Read the OpenAI API key from system_config (null when unset). */
export async function getOpenAiKey(env: OpenAiEnv): Promise<string | null> {
  try {
    const r = await queryFirst<{ config_value: string }>(
      env.DB,
      `SELECT config_value FROM system_config WHERE config_key = 'openai_api_key' ORDER BY id DESC LIMIT 1`,
    );
    const v = (r?.config_value || '').trim();
    return v.length > 0 ? v : null;
  } catch { return null; }
}

export async function getOpenAiModel(env: OpenAiEnv): Promise<string> {
  try {
    const r = await queryFirst<{ config_value: string }>(
      env.DB,
      `SELECT config_value FROM system_config WHERE config_key = 'openai_model' ORDER BY id DESC LIMIT 1`,
    );
    const v = (r?.config_value || '').trim();
    return v.length > 0 ? v : DEFAULT_OPENAI_MODEL;
  } catch { return DEFAULT_OPENAI_MODEL; }
}

/** Pure: pull the assistant text out of an OpenAI Chat Completions response. */
export function openAiResponseText(json: any): string {
  const choice = json?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p: any) => p && p.type === 'text' && typeof p.text === 'string')
      .map((p: any) => p.text)
      .join('\n');
  }
  return '';
}

export interface OpenAiImage { base64: string; mediaType: string; }

export interface OpenAiCallOpts {
  system?: string;
  text: string;
  image?: OpenAiImage;
  model?: string;
  maxTokens?: number;
}

/**
 * Call the OpenAI Chat Completions API and return the assistant's text.
 * Throws on non-2xx (callers catch + fall back via callAi router).
 */
export async function callOpenAi(apiKey: string, opts: OpenAiCallOpts): Promise<string> {
  const userContent: any[] = [];
  if (opts.image) {
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:${opts.image.mediaType};base64,${opts.image.base64}` },
    });
  }
  userContent.push({ type: 'text', text: opts.text });

  const messages: any[] = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  messages.push({
    role: 'user',
    content: opts.image ? userContent : opts.text,
  });

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model || DEFAULT_OPENAI_MODEL,
      max_tokens: opts.maxTokens ?? 2048,
      messages,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 200)}`);
  }
  return openAiResponseText(await res.json());
}

/**
 * Pure: turn a callOpenAi() error message into an HTTP status + admin hint,
 * so the test button can tell bad-key from no-credit from rate-limit.
 * Mirrors diagnoseAnthropicError().
 */
export function diagnoseOpenAiError(message: string): { status: number | null; hint: string } {
  const m = /OpenAI (\d{3}):/.exec(message);
  const status = m ? Number(m[1]) : null;
  const lower = message.toLowerCase();
  const quotaLike = /(quota|insufficient|billing|credit|balance|exceeded)/.test(lower);
  const modelMissing = /(model.*not.*(found|exist|access)|does not have access|deprecated)/.test(lower);
  let hint: string;
  if (status === 401) hint = 'Invalid API key';
  else if (status === 403 && modelMissing) hint = 'Key lacks permission for this model (sk-proj scope?)';
  else if (status === 403) hint = 'Key lacks permission';
  else if (status === 429 && quotaLike) hint = 'Out of credit / quota — fund the OpenAI account';
  else if (status === 429) hint = 'Rate limited — try again shortly';
  else if (status === 400) hint = 'Bad request — check the configured model id';
  else if (status === 404 && modelMissing) hint = 'Model not found — check openai_model in system_config';
  else if (status !== null && status >= 500) hint = 'OpenAI server error — retry later';
  else hint = message.slice(0, 200);
  return { status, hint };
}
