/**
 * AI Provider Interface & Implementations
 *
 * Supports multiple AI backends: Groq, Google Gemini, OpenAI, Ollama.
 * Each provider implements the same interface so they can be swapped
 * transparently by the aiManager.
 */

import Groq from 'groq-sdk';

// ---------------------------------------------------------------------------
// Provider Interface
// ---------------------------------------------------------------------------

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export interface AIProvider {
  name: string;
  model: string;
  isAvailable(): boolean;
  chat(systemPrompt: string, userMessage: string, options?: ChatOptions): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Groq Provider (uses groq-sdk)
// ---------------------------------------------------------------------------

export class GroqProvider implements AIProvider {
  name = 'groq';
  model: string;
  private client: Groq | null;

  constructor(apiKey?: string, model?: string) {
    const key = apiKey || process.env.GROQ_API_KEY || '';
    this.model = model || 'llama-3.3-70b-versatile';
    this.client = key ? new Groq({ apiKey: key }) : null;
  }

  isAvailable(): boolean {
    return !!this.client;
  }

  async chat(systemPrompt: string, userMessage: string, options?: ChatOptions): Promise<string | null> {
    if (!this.client) return null;
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        temperature: options?.temperature ?? 0.3,
        max_tokens: options?.maxTokens ?? 300,
        ...(options?.jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      });
      return response.choices?.[0]?.message?.content?.trim() || null;
    } catch (err: any) {
      console.error(`[AI:groq] chat error:`, err?.message || err);
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Gemini Provider (Google Generative Language REST API)
// ---------------------------------------------------------------------------

export class GeminiProvider implements AIProvider {
  name = 'gemini';
  model: string;
  private apiKey: string;

  constructor(apiKey?: string, model?: string) {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || '';
    this.model = model || 'gemini-2.0-flash';
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async chat(systemPrompt: string, userMessage: string, options?: ChatOptions): Promise<string | null> {
    if (!this.apiKey) return null;
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
      const body: any = {
        contents: [
          { role: 'user', parts: [{ text: userMessage }] },
        ],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          temperature: options?.temperature ?? 0.3,
          maxOutputTokens: options?.maxTokens ?? 300,
          ...(options?.jsonMode ? { responseMimeType: 'application/json' } : {}),
        },
      };

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`Gemini API ${resp.status}: ${errText.slice(0, 200)}`);
      }

      const data = await resp.json();
      return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
    } catch (err: any) {
      console.error(`[AI:gemini] chat error:`, err?.message || err);
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// OpenAI Provider (OpenAI-compatible REST API — works with OpenAI, Azure, etc.)
// ---------------------------------------------------------------------------

export class OpenAIProvider implements AIProvider {
  name = 'openai';
  model: string;
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string, model?: string, baseUrl?: string) {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || '';
    this.model = model || 'gpt-4o-mini';
    this.baseUrl = (baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async chat(systemPrompt: string, userMessage: string, options?: ChatOptions): Promise<string | null> {
    if (!this.apiKey) return null;
    try {
      const body: any = {
        model: this.model,
        temperature: options?.temperature ?? 0.3,
        max_tokens: options?.maxTokens ?? 300,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      };
      if (options?.jsonMode) {
        body.response_format = { type: 'json_object' };
      }

      const resp = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`OpenAI API ${resp.status}: ${errText.slice(0, 200)}`);
      }

      const data = await resp.json();
      return data?.choices?.[0]?.message?.content?.trim() || null;
    } catch (err: any) {
      console.error(`[AI:openai] chat error:`, err?.message || err);
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Ollama Provider (local Ollama REST API)
// ---------------------------------------------------------------------------

export class OllamaProvider implements AIProvider {
  name = 'ollama';
  model: string;
  private baseUrl: string;

  constructor(url?: string, model?: string) {
    this.baseUrl = (url || process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '');
    this.model = model || 'llama3.1';
  }

  isAvailable(): boolean {
    // Ollama is always "potentially" available — we test connectivity at runtime
    return true;
  }

  async chat(systemPrompt: string, userMessage: string, options?: ChatOptions): Promise<string | null> {
    try {
      const body: any = {
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        stream: false,
        options: {
          temperature: options?.temperature ?? 0.3,
          num_predict: options?.maxTokens ?? 300,
        },
      };
      if (options?.jsonMode) {
        body.format = 'json';
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);

      const resp = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`Ollama API ${resp.status}: ${errText.slice(0, 200)}`);
      }

      const data = await resp.json();
      return data?.message?.content?.trim() || null;
    } catch (err: any) {
      console.error(`[AI:ollama] chat error:`, err?.message || err);
      throw err;
    }
  }
}
