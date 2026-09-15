// ============================================================
// Dispatcher Command Engine — shared types
// ============================================================
// One request in ({ text }) → one plan out. A plan is a list of steps the
// CLIENT executes (HTTP calls with the user's own JWT, so RBAC + validation
// + audit + WS broadcast all run in the existing routes) plus console
// actions (select a call, open a modal, navigate). Server-side reads
// (record checks, call status) are folded into `reply` before the plan is
// returned. See docs/superpowers/specs/2026-09-14-dispatcher-command-engine-design.md.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface HttpStep {
  kind: 'http';
  method: HttpMethod;
  /** API path WITHOUT the /api prefix (apiFetch adds it). */
  path: string;
  body?: Record<string, unknown>;
  /** One line for the command bar / audit log. */
  summary: string;
  /** Irreversible or high-impact — gated behind a confirmation turn. */
  destructive: boolean;
}

export type ClientActionName =
  | 'select_call'
  | 'open_new_call'
  | 'open_ncic'
  | 'navigate'
  | 'append_note'
  | 'show_help'
  | 'refresh';

export interface ClientAction {
  kind: 'client';
  action: ClientActionName;
  payload: Record<string, unknown>;
  summary: string;
}

export type PlanStep = HttpStep | ClientAction;

export interface ToolCall {
  tool: string;
  params: Record<string, unknown>;
}

/** What the planner (rules or LLM) hands back before resolution/compilation. */
export interface PlannerOutput {
  intent: string;
  reply: string;
  tool_calls: ToolCall[];
  /** Set when the planner needs one more piece of information. */
  clarify?: string;
}

export interface CommandContext {
  userId: number;
  role: string;
  userName?: string | null;
  /** Call the dispatcher currently has selected on the board, if any. */
  selectedCallNumber?: string | null;
  /** The speaker's unit call-sign (voice path), if known. */
  unitCallSign?: string | null;
  source: 'typed' | 'speech';
}

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
  /** Which engine produced the plan. */
  planner: 'rules' | 'ai' | 'none';
  provider?: string;
  model?: string;
  latency_ms: number;
}

export interface StepResult {
  index: number;
  ok: boolean;
  status?: number;
  summary?: string;
  error?: string;
}
