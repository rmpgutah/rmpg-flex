// PII redactor for outbound email bodies forwarded to external recipients.
// Replaces SSN, DOB, phone, and Utah driver-license patterns with [REDACTED:TYPE]
// and returns a diff so the UI can preview what was changed before sending.

import { PII_PATTERNS } from './piiPatterns';

export interface RedactionDiff {
  original: string;
  replacement: string;
  type: string;
  index: number;
}

export function redactPII(html: string): { redacted: string; diff: RedactionDiff[] } {
  if (!html) return { redacted: html, diff: [] };
  const diff: RedactionDiff[] = [];
  let out = html;
  for (const { type, regex } of PII_PATTERNS) {
    const rx = new RegExp(regex.source, regex.flags);
    const matches = Array.from(out.matchAll(rx));
    // Apply in reverse so earlier indices remain valid as we shrink `out`.
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      const start = m.index ?? 0;
      const end = start + m[0].length;
      out = out.slice(0, start) + `[REDACTED:${type}]` + out.slice(end);
      diff.push({ original: m[0], replacement: `[REDACTED:${type}]`, type, index: start });
    }
  }
  diff.sort((a, b) => a.index - b.index);
  return { redacted: out, diff };
}
