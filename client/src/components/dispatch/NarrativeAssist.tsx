import { useState } from 'react';
import {
  Brain, Check, X, Loader2, ScanLine, Copy, ChevronDown,
  Wand2, AlignLeft, Minimize2, Scale, FileText,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

// ─── Types ──────────────────────────────────────────────────────────────────

type NarrativeMode = 'incident' | 'dispatch_narrative' | 'serve_attempt';

interface ServeContext {
  /** Full name of the person being served */
  recipientName?: string;
  /** Service address */
  address?: string;
  /** Attempt type: personal / substitute / posting / failed */
  attemptType?: string;
  /** Reason for failed attempt, when applicable */
  failedReason?: string;
  /** Optional subject-matter context (e.g. subpoena, summons, eviction) */
  documentType?: string;
}

interface NarrativeAssistProps {
  /** Raw notes / freeform text the officer has entered */
  notes: string;
  /** Additional context fed to the narrative generator */
  incidentType?: string;
  locationAddress?: string;
  /** Controls which system prompt / endpoint variant to use */
  mode?: NarrativeMode;
  /** Serve-specific context — required when mode === 'serve_attempt' */
  serveContext?: ServeContext;
  /** Called when the officer accepts an AI-generated draft */
  onAccept: (narrative: string) => void;
  /** Optional: called with extracted fields for auto-fill */
  onExtractFields?: (fields: Record<string, unknown>) => void;
  /**
   * When provided, an inline Refine toolbar is shown that lets the officer
   * polish existing text without re-generating from scratch.
   * Pass the current field value; the refined result is delivered via onAccept.
   */
  existingText?: string;
}

// ─── Refine actions ─────────────────────────────────────────────────────────

const REFINE_ACTIONS = [
  { key: 'first-person',     label: 'First Person',    icon: FileText,    title: 'Rewrite in first-person active voice (I observed, I contacted…)' },
  { key: 'improve-clarity',  label: 'Improve Clarity', icon: AlignLeft,   title: 'Make the text clearer and easier to understand' },
  { key: 'formal-legal-tone',label: 'Formal / Legal',  icon: Scale,       title: 'Rewrite in formal legal tone suitable for court filings' },
  { key: 'expand',           label: 'Expand',          icon: Wand2,       title: 'Add detail and professional narrative language' },
  { key: 'brevity',          label: 'Condense',        icon: Minimize2,   title: 'Make concise while keeping all legally significant facts' },
  { key: 'summarize',        label: 'Summarize',       icon: AlignLeft,   title: 'Write a 2-4 sentence synopsis of the key facts and outcome' },
] as const;

type RefineKey = typeof REFINE_ACTIONS[number]['key'];

// ─── Component ──────────────────────────────────────────────────────────────

export default function NarrativeAssist({
  notes,
  incidentType,
  locationAddress,
  mode = 'incident',
  serveContext,
  onAccept,
  onExtractFields,
  existingText,
}: NarrativeAssistProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewLabel, setPreviewLabel] = useState('AI Draft');
  const [error, setError] = useState<string | null>(null);
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);
  const [refiningKey, setRefiningKey] = useState<RefineKey | null>(null);
  const [copied, setCopied] = useState(false);

  // ── Generate narrative from notes ──────────────────────────────────────
  const handleGenerate = async () => {
    setIsLoading(true);
    setError(null);
    setPreview(null);
    try {
      const contextNotes = buildContextNotes(notes, mode, serveContext);
      const data = await apiFetch<{ narrative: string; text?: string }>('/ai/narrative', {
        method: 'POST',
        body: JSON.stringify({
          notes: contextNotes,
          incident_type: incidentType ?? labelForMode(mode, serveContext),
          location_address: locationAddress ?? serveContext?.address,
          context_type: mode,
        }),
      });
      setPreview(data.narrative || data.text || '');
      setPreviewLabel('AI Draft — Review Before Accepting');
    } catch (err) {
      const apiErr = err as { status?: number };
      if (apiErr.status === 503 || apiErr.status === 501) {
        setAiUnavailable(true);
        setError('AI service unavailable');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to generate narrative');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // ── Refine existing text ────────────────────────────────────────────────
  const handleRefine = async (actionKey: RefineKey) => {
    const textToRefine = existingText?.trim() || notes?.trim();
    if (!textToRefine || textToRefine.length < 5) return;
    setRefineOpen(false);
    setRefiningKey(actionKey);
    setError(null);
    setPreview(null);
    try {
      const data = await apiFetch<{ result: string }>('/ai/refine', {
        method: 'POST',
        body: JSON.stringify({ text: textToRefine, action: actionKey }),
      });
      setPreview(data.result || '');
      const actionDef = REFINE_ACTIONS.find(a => a.key === actionKey);
      setPreviewLabel(`AI ${actionDef?.label ?? 'Refined'} — Review Before Accepting`);
    } catch (err) {
      const apiErr = err as { status?: number };
      if (apiErr.status === 503 || apiErr.status === 501) {
        setAiUnavailable(true);
        setError('AI service unavailable');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to refine text');
      }
    } finally {
      setRefiningKey(null);
    }
  };

  // ── Accept / Discard ────────────────────────────────────────────────────
  const handleAccept = () => {
    if (preview) { onAccept(preview); setPreview(null); }
  };

  const handleDiscard = () => setPreview(null);

  // ── Copy preview to clipboard ────────────────────────────────────────────
  const handleCopy = async () => {
    if (!preview) return;
    try {
      await navigator.clipboard.writeText(preview);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  // ── Extract fields ───────────────────────────────────────────────────────
  const handleExtractFields = async () => {
    if (!onExtractFields || notes.length < 20) return;
    setExtracting(true);
    try {
      const data = await apiFetch<{ result: Record<string, unknown> }>('/ai/extract-fields', {
        method: 'POST',
        body: JSON.stringify({ text: notes }),
      });
      if (data?.result) onExtractFields(data.result);
    } catch { /* best-effort */ }
    finally { setExtracting(false); }
  };

  const canGenerate = !aiUnavailable && !!notes?.trim();
  const canRefine = !aiUnavailable && !!(existingText?.trim() || notes?.trim());
  const isRefining = refiningKey !== null;

  return (
    <div className="mt-1.5 space-y-1.5">
      {/* ── Toolbar row ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start gap-1.5">

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={isLoading || !canGenerate}
          className="flex items-center gap-1 px-2 py-1 text-[9px] font-semibold rounded-sm border transition-colors"
          style={
            aiUnavailable
              ? { background: 'var(--surface-raised)', borderColor: 'var(--border-default)', color: 'var(--text-muted)', cursor: 'not-allowed' }
              : { background: 'color-mix(in srgb, var(--sev-special) 8%, transparent)', borderColor: 'color-mix(in srgb, var(--sev-special) 25%, transparent)', color: 'var(--sev-special)', cursor: isLoading ? 'wait' : 'pointer' }
          }
          title={
            aiUnavailable ? 'AI service is unavailable'
              : !notes?.trim() ? 'Enter notes first'
              : mode === 'serve_attempt' ? 'Generate a professional service-attempt narrative from your notes'
              : 'Generate narrative from notes using AI'
          }
        >
          {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Brain className="w-3 h-3" />}
          {aiUnavailable ? 'AI Unavailable' : isLoading ? 'Generating…' : 'AI Assist'}
        </button>

        {/* Refine dropdown — only when there's text to refine */}
        {canRefine && (
          <div className="relative">
            <button
              onClick={() => setRefineOpen(o => !o)}
              disabled={isRefining}
              className="flex items-center gap-1 px-2 py-1 text-[9px] font-semibold rounded-sm border transition-colors"
              style={{ background: 'color-mix(in srgb, var(--accent-silver-500) 12%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-silver-500) 30%, transparent)', color: 'var(--accent-silver-300)' }}
              title="Refine existing text with AI"
            >
              {isRefining ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
              {isRefining ? 'Refining…' : 'Refine'}
              {!isRefining && <ChevronDown className="w-2.5 h-2.5 opacity-60" />}
            </button>

            {refineOpen && (
              <div
                className="absolute left-0 top-full mt-1 z-50 rounded-sm border shadow-lg py-0.5 min-w-[150px]"
                style={{ background: 'var(--surface-overlay)', borderColor: 'var(--border-default)' }}
              >
                {REFINE_ACTIONS.map(({ key, label, icon: Icon, title }) => (
                  <button
                    key={key}
                    onClick={() => handleRefine(key)}
                    className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[9px] font-medium text-left transition-colors hover:bg-[color-mix(in_srgb,var(--sev-special)_8%,transparent)]"
                    style={{ color: 'var(--text-secondary)' }}
                    title={title}
                  >
                    <Icon className="w-3 h-3 shrink-0 opacity-70" />
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Extract Fields button */}
        {onExtractFields && (
          <button
            onClick={handleExtractFields}
            disabled={extracting || !notes?.trim() || notes.length < 20}
            className="flex items-center gap-1 px-2 py-1 text-[9px] font-semibold rounded-sm border transition-colors"
            style={{ background: 'color-mix(in srgb, var(--sev-info) 8%, transparent)', borderColor: 'color-mix(in srgb, var(--sev-info) 25%, transparent)', color: 'var(--sev-info)' }}
            title={notes.length < 20 ? 'Enter at least 20 characters of text first' : 'Extract caller name, address, persons, and incident type from notes'}
          >
            {extracting ? <Loader2 className="w-3 h-3 animate-spin" /> : <ScanLine className="w-3 h-3" />}
            {extracting ? 'Extracting…' : 'Auto-Fill Fields'}
          </button>
        )}

        {/* Error */}
        {error && !preview && (
          <p className="text-[9px] text-red-400">{error}</p>
        )}
      </div>

      {/* ── Preview panel ─────────────────────────────────────────── */}
      {preview && (
        <div
          className="rounded-sm border p-2.5"
          style={{ background: 'var(--surface-overlay)', borderColor: 'color-mix(in srgb, var(--sev-special) 19%, transparent)' }}
        >
          {/* Header row */}
          <div className="flex items-center justify-between mb-1.5">
            <label className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-wider text-purple-400">
              <Brain className="w-2.5 h-2.5" /> {previewLabel}
            </label>
            <div className="flex items-center gap-1">
              <span className="text-[8px] text-fg-muted font-mono">
                {preview.trim().split(/\s+/).filter(Boolean).length} words · {preview.length} chars
              </span>
              <button
                onClick={handleCopy}
                className="flex items-center gap-0.5 px-1.5 py-0.5 text-[8px] font-medium rounded-sm border transition-colors"
                style={{ background: 'var(--surface-raised)', borderColor: 'var(--border-default)', color: copied ? 'var(--sev-ok-soft)' : 'var(--text-muted)' }}
                title="Copy to clipboard"
              >
                <Copy className="w-2 h-2" />
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Draft text */}
          <p className="text-[11px] text-rmpg-200 leading-relaxed whitespace-pre-wrap mb-2.5">
            {preview}
          </p>

          {/* Accept / Discard */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleAccept}
              className="flex items-center gap-1 px-2 py-0.5 text-[9px] font-semibold rounded-sm border transition-colors"
              style={{ background: 'color-mix(in srgb, var(--sev-ok) 8%, transparent)', borderColor: 'color-mix(in srgb, var(--sev-ok) 25%, transparent)', color: 'var(--sev-ok-soft)' }}
            >
              <Check className="w-2.5 h-2.5" /> Use This
            </button>
            <button
              onClick={handleDiscard}
              className="flex items-center gap-1 px-2 py-0.5 text-[9px] font-semibold rounded-sm border transition-colors"
              style={{ background: 'color-mix(in srgb, var(--sev-critical) 8%, transparent)', borderColor: 'color-mix(in srgb, var(--sev-critical) 25%, transparent)', color: 'var(--sev-critical-soft)' }}
            >
              <X className="w-2.5 h-2.5" /> Discard
            </button>
          </div>
        </div>
      )}

      {/* Close refine dropdown on outside click */}
      {refineOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setRefineOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function labelForMode(mode: NarrativeMode, ctx?: ServeContext): string {
  if (mode === 'serve_attempt') {
    const parts = ['Service Attempt'];
    if (ctx?.documentType) parts.push(ctx.documentType);
    if (ctx?.attemptType) parts.push(ctx.attemptType);
    return parts.join(' — ');
  }
  if (mode === 'dispatch_narrative') return 'Dispatch Call Narrative';
  return 'Incident';
}

/**
 * Prepend structured serve-attempt context to the officer's raw notes so the
 * LLM has full situational awareness without changing the `/ai/narrative` API.
 */
function buildContextNotes(
  rawNotes: string,
  mode: NarrativeMode,
  ctx?: ServeContext,
): string {
  if (mode !== 'serve_attempt' || !ctx) return rawNotes;
  const lines: string[] = [];
  if (ctx.recipientName) lines.push(`Subject to be served: ${ctx.recipientName}`);
  if (ctx.address)       lines.push(`Service address: ${ctx.address}`);
  if (ctx.documentType)  lines.push(`Document type: ${ctx.documentType}`);
  if (ctx.attemptType)   lines.push(`Attempt type: ${ctx.attemptType}`);
  if (ctx.failedReason)  lines.push(`Reason not served: ${ctx.failedReason}`);
  if (rawNotes?.trim())  lines.push(`Officer notes: ${rawNotes.trim()}`);
  return lines.join('\n');
}
