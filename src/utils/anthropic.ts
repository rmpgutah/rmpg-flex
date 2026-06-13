// anthropic — thin client for the Anthropic Messages API (Claude), powering the
// advanced OCR engine + AI functions. The key lives in system_config
// (anthropic_api_key, set via Admin → API Integrations), NOT a Worker secret, so
// admins manage it from the UI. Everything degrades gracefully when the key is
// absent (callers fall back to Workers AI).

import { queryFirst } from './db';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
// Default model for OCR/extraction — strong vision, reasonable cost. Overridable
// via system_config 'anthropic_model'.
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6';

interface AnthropicEnv { DB: D1Database; }

/** Read the Claude API key from system_config (null when unset). */
export async function getAnthropicKey(env: AnthropicEnv): Promise<string | null> {
  try {
    const r = await queryFirst<{ config_value: string }>(
      env.DB,
      `SELECT config_value FROM system_config WHERE config_key = 'anthropic_api_key' ORDER BY id DESC LIMIT 1`,
    );
    const v = (r?.config_value || '').trim();
    return v.length > 0 ? v : null;
  } catch { return null; }
}

export async function getClaudeModel(env: AnthropicEnv): Promise<string> {
  try {
    const r = await queryFirst<{ config_value: string }>(
      env.DB,
      `SELECT config_value FROM system_config WHERE config_key = 'anthropic_model' ORDER BY id DESC LIMIT 1`,
    );
    const v = (r?.config_value || '').trim();
    return v.length > 0 ? v : DEFAULT_CLAUDE_MODEL;
  } catch { return DEFAULT_CLAUDE_MODEL; }
}

/** Pure: pull the concatenated text out of a Claude messages response. */
export function claudeResponseText(json: any): string {
  if (!json || !Array.isArray(json.content)) return '';
  return json.content
    .filter((b: any) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text)
    .join('\n');
}

export interface ClaudeImage { base64: string; mediaType: string; }

export interface ClaudeCallOpts {
  system?: string;
  text: string;
  image?: ClaudeImage;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Call the Claude Messages API and return the assistant's text. Throws on a
 * non-2xx (callers catch + fall back). Supports a single image block for vision.
 */
export async function callClaude(apiKey: string, opts: ClaudeCallOpts): Promise<string> {
  const content: any[] = [];
  if (opts.image) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: opts.image.mediaType, data: opts.image.base64 },
    });
  }
  content.push({ type: 'text', text: opts.text });

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': API_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model || DEFAULT_CLAUDE_MODEL,
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0,
      ...(opts.system ? { system: opts.system } : {}),
      messages: [{ role: 'user', content }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 200)}`);
  }
  return claudeResponseText(await res.json());
}

/** Bytes → base64 (Workers/Node-safe, chunked to avoid call-stack limits). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
