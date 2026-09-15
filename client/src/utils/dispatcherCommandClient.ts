// ============================================================
// RMPG Flex — Dispatcher Command Engine client
// ============================================================
// Sends free-form text (typed CAD line or voice transcript) to
// POST /api/dispatcher/command, executes the returned HTTP steps with the
// user's own JWT (so RBAC / validation / audit / WS broadcast all happen in
// the normal routes), reports the outcome, and hands console actions back
// to the page. Also owns the one-turn confirmation state for destructive
// plans. Design: docs/superpowers/specs/2026-09-14-dispatcher-command-engine-design.md

import { apiFetch } from '../hooks/useApi';
import { appendCallNote } from './callNotes';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
export interface HttpStep { kind: 'http'; method: HttpMethod; path: string; body?: Record<string, unknown>; summary: string; destructive: boolean }
export interface ClientAction { kind: 'client'; action: 'select_call' | 'open_new_call' | 'open_ncic' | 'navigate' | 'append_note' | 'show_help' | 'refresh'; payload: Record<string, unknown>; summary: string }
export type PlanStep = HttpStep | ClientAction;

export interface CommandResponse {
  ok: boolean;
  log_id: number | null;
  intent: string;
  reply: string;
  steps: PlanStep[];
  needs_confirmation: boolean;
  confirm_token?: string;
  confirmed?: boolean;
  clarify?: string;
  planner: 'rules' | 'ai' | 'none';
  latency_ms: number;
}

export interface StepResult { index: number; ok: boolean; status?: number; summary?: string; error?: string }

export interface DispatcherCommandOutcome {
  /** True when the engine treated the text as a command (executed, asked to confirm, or asked to clarify). */
  handled: boolean;
  ok: boolean;
  intent: string;
  reply: string;
  needsConfirmation: boolean;
  clarify?: string;
  logId: number | null;
  /** Console actions the page should apply (append_note is executed here, not returned). */
  clientActions: ClientAction[];
  results: StepResult[];
  planner: CommandResponse['planner'];
}

export interface RunOptions {
  source: 'typed' | 'speech';
  selectedCallNumber?: string | null;
  unit?: string | null;
  author?: string;
}

let pendingConfirm: { token: string; logId: number | null; reply: string } | null = null;

export function hasPendingConfirmation(): boolean { return pendingConfirm !== null; }
export function clearPendingConfirmation(): void { pendingConfirm = null; }

const YES = /^(y|yes|yeah|yep|yup|confirm|confirmed|affirm|affirmative|correct|go|go ahead|do it|proceed|ok|okay|10-?4|ten four|roger)\.?$/i;
const NO = /^(n|no|nope|cancel|negative|stop|abort|disregard|never ?mind|belay that)\.?$/i;

export function isAffirmative(text: string): boolean { return YES.test(text.trim()); }
export function isNegative(text: string): boolean { return NO.test(text.trim()); }

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function statusFromError(err: unknown): number | undefined {
  const m = /\b(4\d\d|5\d\d)\b/.exec(errMessage(err));
  return m ? Number(m[1]) : undefined;
}

async function executeSteps(steps: PlanStep[], author: string): Promise<{ results: StepResult[]; clientActions: ClientAction[] }> {
  const results: StepResult[] = [];
  const clientActions: ClientAction[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.kind === 'client') {
      if (s.action === 'append_note') {
        try {
          await appendCallNote(String(s.payload.call_id), String(s.payload.text), String(s.payload.author || author));
          results.push({ index: i, ok: true, summary: s.summary });
        } catch (err) {
          results.push({ index: i, ok: false, summary: s.summary, error: errMessage(err) });
          break;
        }
      } else {
        clientActions.push(s);
      }
      continue;
    }
    try {
      await apiFetch(s.path, {
        method: s.method,
        ...(s.body !== undefined ? { body: JSON.stringify(s.body) } : {}),
      });
      results.push({ index: i, ok: true, summary: s.summary });
    } catch (err) {
      results.push({ index: i, ok: false, status: statusFromError(err), summary: s.summary, error: errMessage(err) });
      // Stop at the first failed write — later steps may depend on it.
      break;
    }
  }
  return { results, clientActions };
}

async function reportResults(logId: number | null, results: StepResult[]): Promise<void> {
  if (logId == null) return;
  try {
    await apiFetch(`/dispatcher/command/${logId}/result`, { method: 'POST', body: JSON.stringify({ steps: results }) });
  } catch { /* best-effort audit */ }
}

function summarize(results: StepResult[]): string {
  const failed = results.filter(r => !r.ok);
  if (!failed.length) return '';
  return ' FAILED: ' + failed.map(f => `${f.summary ?? 'step'} — ${f.error ?? 'error'}`).join('; ');
}

/**
 * Run one free-form instruction end to end. Never throws — network / server
 * failures surface as `{ handled: true, ok: false, reply }`.
 */
export async function runDispatcherCommand(text: string, opts: RunOptions): Promise<DispatcherCommandOutcome> {
  const trimmed = text.trim();
  const author = opts.author || 'Dispatch';
  const base = (r: Partial<DispatcherCommandOutcome>): DispatcherCommandOutcome => ({
    handled: true, ok: false, intent: 'unclear', reply: '', needsConfirmation: false, logId: null,
    clientActions: [], results: [], planner: 'none', ...r,
  });
  if (!trimmed) return base({ handled: false });

  let body: Record<string, unknown>;
  if (pendingConfirm && (isAffirmative(trimmed) || isNegative(trimmed))) {
    body = { confirm_token: pendingConfirm.token, confirmed: isAffirmative(trimmed), source: opts.source };
    pendingConfirm = null;
  } else {
    if (pendingConfirm) pendingConfirm = null; // any other utterance abandons the pending plan
    body = {
      text: trimmed,
      source: opts.source,
      context: {
        ...(opts.selectedCallNumber ? { selected_call_number: opts.selectedCallNumber } : {}),
        ...(opts.unit ? { unit: opts.unit } : {}),
      },
    };
  }

  let res: CommandResponse;
  try {
    res = await apiFetch<CommandResponse>('/dispatcher/command', { method: 'POST', body: JSON.stringify(body) });
  } catch (err) {
    return base({ ok: false, intent: 'error', reply: `Command engine unreachable: ${errMessage(err)}` });
  }

  if (res.needs_confirmation && res.confirm_token) {
    pendingConfirm = { token: res.confirm_token, logId: res.log_id, reply: res.reply };
    return base({ ok: true, intent: res.intent, reply: res.reply, needsConfirmation: true, logId: res.log_id, planner: res.planner });
  }

  if (res.clarify && res.steps.length === 0) {
    return base({ ok: false, intent: res.intent, reply: res.clarify, clarify: res.clarify, logId: res.log_id, planner: res.planner });
  }

  // Chatter / nothing to do → not handled (caller may fall through to the dialogue persona).
  if (!res.ok && res.steps.length === 0 && !res.reply) {
    return base({ handled: false, intent: res.intent, logId: res.log_id, planner: res.planner });
  }
  if (res.confirmed === false) {
    return base({ ok: true, intent: res.intent, reply: res.reply || 'Cancelled.', logId: res.log_id, planner: res.planner });
  }

  const { results, clientActions } = await executeSteps(res.steps, author);
  await reportResults(res.log_id, results);
  const allOk = results.every(r => r.ok);
  return base({
    ok: res.ok && allOk,
    intent: res.intent,
    reply: (res.reply || '') + summarize(results),
    logId: res.log_id,
    clientActions,
    results,
    planner: res.planner,
  });
}
