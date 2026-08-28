// Pure deterministic splitter for the LLM-extracted `defendant` field.
// SHARED between Worker (src/) and React (client/src/) — both trees import
// from this single copy via re-export shims at:
//   src/utils/serveIntakeDefendants.ts
//   client/src/utils/serveIntakeDefendants.ts
// Do NOT duplicate this logic. The CI guard scripts/check-serve-intake-dupes.sh
// fails if the shims carry anything beyond a re-export.

export interface DetectedDefendant {
  name: string;
  raw_source: string;
  split_confidence: number;   // 1.0 ';' | 0.8 ' and '/`&` | 0.6 comma-of-3+ | 0.5 newline
  is_business: boolean;
}

// LLC/Inc/Corp/Co/LLP/Trust/Estate-of and bare suffix tokens. Case-insensitive.
const BUSINESS_RE = /\b(LLC|L\.L\.C\.|Inc\.?|Corporation|Corp\.?|Company|Co\.?|LLP|L\.L\.P\.|Trust|Estate of|PLLC|P\.C\.)\b/i;

// Labels we trim off entries: "Defendant 1: ", "D2) ", "Respondent: ", etc.
const LABEL_RE = /^(?:Defendants?|Respondents?|D)\s*\d*\s*[:.)\-–]\s*/i;

// "et al." trailing marker.
const ET_AL_RE = /\s+et\s+al\.?\s*$/i;

// A name-shaped token: at least two whitespace-separated words, first char of
// any word is uppercase, NOT a business entity.
function isNameShaped(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (BUSINESS_RE.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length < 2) return false;
  return /^[A-Z]/.test(words[0]);
}

function clean(piece: string): string {
  return piece.replace(LABEL_RE, '').replace(ET_AL_RE, '').trim();
}

function commaSplitIfNameShaped(input: string): string[] | null {
  const pieces = input.split(',').map(p => p.trim()).filter(Boolean);
  if (pieces.length < 3) return null;
  if (pieces.every(isNameShaped)) return pieces;
  return null;
}

export interface ParsedDefendants {
  individuals: DetectedDefendant[];
  businesses: DetectedDefendant[];
}

export function parseDefendants(defendantField: string | undefined | null): ParsedDefendants {
  const empty = { individuals: [], businesses: [] };
  if (!defendantField) return empty;
  const input = defendantField.trim();
  if (!input) return empty;

  let pieces: string[];
  let confidence: number;

  if (input.includes(';')) {
    pieces = input.split(';').map(p => p.trim()).filter(Boolean);
    confidence = 1.0;
  } else if (/\s+and\s+|\s*&\s*/i.test(input)) {
    pieces = input.split(/\s+and\s+|\s*&\s*/i).map(p => p.trim()).filter(Boolean);
    confidence = 0.8;
  } else if (commaSplitIfNameShaped(input)) {
    pieces = commaSplitIfNameShaped(input)!;
    confidence = 0.6;
  } else if (input.includes('\n')) {
    pieces = input.split('\n').map(p => p.trim()).filter(Boolean);
    confidence = 0.5;
  } else {
    pieces = [input];
    confidence = 1.0;
  }

  const individuals: DetectedDefendant[] = [];
  const businesses: DetectedDefendant[] = [];
  for (const raw of pieces) {
    const name = clean(raw);
    if (!name) continue;
    const is_business = BUSINESS_RE.test(name);
    const entry = { name, raw_source: raw, split_confidence: confidence, is_business };
    if (is_business) {
      businesses.push(entry);
    } else {
      individuals.push(entry);
    }
  }
  return { individuals, businesses };
}
