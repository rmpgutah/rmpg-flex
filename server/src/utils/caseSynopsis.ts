// ============================================================
// Case Synopsis — auto-generated plain-English brief of the legal
// document(s) being served, derived from court docket text.
//
// Goal: a PSO opens the dispatch detail and immediately understands
//   • what kind of case this is
//   • what the defendant is being asked to do
//   • how much money / what stakes are in play
//   • how urgent the response window is
// without having to read the underlying summons / complaint PDF.
//
// Pattern-based (regex). No external API calls. Runs at intake.
// ============================================================

export type CaseCategory =
  | 'debt_collection'
  | 'eviction'
  | 'divorce_family'
  | 'custody_visitation'
  | 'protective_order'
  | 'small_claims'
  | 'subpoena'
  | 'order_to_show_cause'
  | 'judgment_renewal'
  | 'civil_suit_general'
  | 'unknown';

export interface CaseSynopsisInput {
  courtDocket: string;
  plaintiff: string;
  defendantFirst: string;
  defendantLast: string;
  primaryDoc: string;
  documents: string;
  responseDeadlineDays: number;
  court: string;
}

export interface CaseSynopsisResult {
  category: CaseCategory;
  oneLineSummary: string;
  defendantAction: string;       // what the defendant must do
  moneyAtStake: string | null;   // formatted amount, e.g. "$14,500.00"
  urgencyLine: string;
  fullText: string;              // composed multi-line synopsis ready for notes
}

// ─────────────────────────────────────────────────────────────────────
// Category detection — first matching pattern wins, in priority order.
// ─────────────────────────────────────────────────────────────────────
const CATEGORY_PATTERNS: Array<{ category: CaseCategory; patterns: RegExp[] }> = [
  { category: 'eviction',         patterns: [/unlawful\s+detainer/i, /\beviction\b/i, /forcible\s+entry\s+and\s+detainer/i, /possession\s+of\s+(?:premises|property)/i] },
  { category: 'protective_order', patterns: [/protective\s+order/i, /restraining\s+order/i, /\bDV\s+protective\b/i, /stalking\s+injunction/i] },
  { category: 'divorce_family',   patterns: [/petition\s+for\s+(?:divorce|dissolution)/i, /dissolution\s+of\s+marriage/i, /\bin\s+re\s+the\s+marriage\b/i] },
  { category: 'custody_visitation', patterns: [/custody/i, /parent.time/i, /visitation/i, /child\s+support/i] },
  { category: 'subpoena',         patterns: [/^\s*subpoena/im, /subpoena\s+(?:duces|ad\s+testificandum)/i, /command\s+(?:you|the\s+person)\s+to\s+(?:appear|produce)/i] },
  { category: 'order_to_show_cause', patterns: [/order\s+to\s+show\s+cause/i, /\bOSC\b/, /show\s+cause\s+why/i] },
  { category: 'small_claims',     patterns: [/small\s+claims/i] },
  { category: 'judgment_renewal', patterns: [/renewal\s+of\s+judgment/i, /writ\s+of\s+execution/i, /writ\s+of\s+garnishment/i] },
  { category: 'debt_collection',  patterns: [/credit\s+card/i, /breach\s+of\s+contract/i, /\baccount\s+stated\b/i, /open\s+account/i, /promissory\s+note/i, /capital\s+one/i, /discover\s+bank/i, /debt\s+(?:collector|owed)/i] },
  { category: 'civil_suit_general', patterns: [/complaint\s+for\s+damages/i, /civil\s+(?:action|complaint)/i, /\btort\b/i, /negligence/i, /personal\s+injury/i] },
];

function detectCategory(courtDocket: string, documents: string, primaryDoc: string): CaseCategory {
  const haystack = `${courtDocket}\n${documents}\n${primaryDoc}`;
  for (const { category, patterns } of CATEGORY_PATTERNS) {
    if (patterns.some((re) => re.test(haystack))) return category;
  }
  return 'unknown';
}

// ─────────────────────────────────────────────────────────────────────
// Money extraction — finds the largest dollar figure in the docket
// (filters out trivial filing fees / postage by ignoring < $50).
// ─────────────────────────────────────────────────────────────────────
function extractMoneyAmount(courtDocket: string): string | null {
  if (!courtDocket) return null;
  const matches = courtDocket.match(/\$\s*[\d,]+(?:\.\d{2})?/g) || [];
  if (matches.length === 0) return null;
  const numbers = matches
    .map((m) => parseFloat(m.replace(/[$,\s]/g, '')))
    .filter((n) => Number.isFinite(n) && n >= 50);
  if (numbers.length === 0) return null;
  const max = Math.max(...numbers);
  return `$${max.toLocaleString('en-US', { minimumFractionDigits: max % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}

// ─────────────────────────────────────────────────────────────────────
// One-line summary by category
// ─────────────────────────────────────────────────────────────────────
function buildOneLineSummary(cat: CaseCategory, plaintiff: string, defendantName: string, money: string | null): string {
  const p = (plaintiff || 'The plaintiff').split(',')[0].trim() || 'The plaintiff';
  const d = defendantName || 'the defendant';
  switch (cat) {
    case 'debt_collection':
      return money
        ? `${p} is suing ${d} to collect ${money} (debt-collection lawsuit).`
        : `${p} is suing ${d} to collect a debt (debt-collection lawsuit).`;
    case 'eviction':
      return `${p} (landlord/property owner) is suing ${d} for possession of the premises — eviction action.`;
    case 'divorce_family':
      return `${p} has filed a divorce / dissolution-of-marriage petition naming ${d}.`;
    case 'custody_visitation':
      return `${p} has filed a custody / parent-time / child-support action involving ${d}.`;
    case 'protective_order':
      return `${p} has obtained a protective / restraining order against ${d}. Service of this document activates the order's restrictions on ${d}.`;
    case 'subpoena':
      return `${d} is being commanded by subpoena to appear in court (or produce documents) in connection with a case filed by ${p}.`;
    case 'order_to_show_cause':
      return `${d} has been ordered to appear in court and show cause — typically follows a missed obligation in an existing case filed by ${p}.`;
    case 'small_claims':
      return money
        ? `${p} has filed a small-claims action against ${d} for ${money}.`
        : `${p} has filed a small-claims action against ${d}.`;
    case 'judgment_renewal':
      return `${p} is enforcing or renewing a prior money judgment against ${d}${money ? ` (${money})` : ''}.`;
    case 'civil_suit_general':
      return money
        ? `${p} has filed a civil lawsuit against ${d} seeking ${money} in damages.`
        : `${p} has filed a civil lawsuit against ${d} seeking damages.`;
    case 'unknown':
    default:
      return `${p} has filed a legal action against ${d}. Document type was not auto-classified — refer to court docket for details.`;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Action required by category
// ─────────────────────────────────────────────────────────────────────
function buildDefendantAction(cat: CaseCategory, responseDeadlineDays: number, court: string): string {
  const days = responseDeadlineDays || 21; // 21 is the most common default
  const courtRef = court ? ` in ${court}` : '';
  switch (cat) {
    case 'debt_collection':
    case 'civil_suit_general':
      return `Defendant must file a written response (Answer)${courtRef} within ${days} days of being served. Failure to respond results in a default judgment for the plaintiff — the court can then garnish wages or seize bank accounts.`;
    case 'eviction':
      return `Defendant must respond within the window stated on the summons (typically 3–10 days for eviction, much shorter than a civil suit). Failure to respond can result in immediate writ of restitution and physical removal by the constable.`;
    case 'divorce_family':
    case 'custody_visitation':
      return `Defendant must file a written response (Answer)${courtRef} within ${days} days. Failure to respond means the petitioner's requested relief (custody, support, property division) may be granted by default.`;
    case 'protective_order':
      return `Defendant is now bound by the order's restrictions immediately upon being served. Violation is a criminal offense. A hearing date is typically set within 14–21 days where defendant may contest the order.`;
    case 'subpoena':
      return `Defendant must appear at the date/time/location specified, OR produce the requested documents by the deadline. Failure to comply can result in contempt of court (fines, arrest warrant).`;
    case 'order_to_show_cause':
      return `Defendant must appear in court at the date/time on the order to explain why they should not be held in contempt or have sanctions imposed. Failure to appear can result in a bench warrant.`;
    case 'small_claims':
      return `Defendant must appear at the small-claims hearing on the date stated. Filing a written answer is generally not required, but failure to appear results in default judgment.`;
    case 'judgment_renewal':
      return `Defendant has limited grounds to contest. Service of these documents activates the plaintiff's collection remedies — wage garnishment, bank levy, or seizure of personal property.`;
    case 'unknown':
    default:
      return `Defendant should review the documents carefully and respond within the deadline stated on the summons or first page of the petition.`;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Main entry
// ─────────────────────────────────────────────────────────────────────
export function synthesizeCaseSynopsis(input: CaseSynopsisInput): CaseSynopsisResult {
  const defendantName = `${input.defendantFirst} ${input.defendantLast}`.trim() || 'the defendant';
  const category = detectCategory(input.courtDocket || '', input.documents || '', input.primaryDoc || '');
  const moneyAtStake = extractMoneyAmount(input.courtDocket || '');
  const oneLineSummary = buildOneLineSummary(category, input.plaintiff, defendantName, moneyAtStake);
  const defendantAction = buildDefendantAction(category, input.responseDeadlineDays || 0, input.court || '');

  let urgencyLine: string;
  if (category === 'eviction' || category === 'protective_order' || category === 'order_to_show_cause') {
    urgencyLine = '⏱️ HIGH URGENCY — short response window or hearing date already set.';
  } else if (category === 'subpoena') {
    urgencyLine = '⏱️ TIME-BOUND — appearance/production deadline is on the document itself.';
  } else if ((input.responseDeadlineDays || 0) <= 14) {
    urgencyLine = `⏱️ SHORT WINDOW — defendant has only ${input.responseDeadlineDays} days to respond.`;
  } else {
    urgencyLine = `⏱️ STANDARD WINDOW — defendant has ${input.responseDeadlineDays || 21} days to file a response.`;
  }

  const lines: string[] = [];
  lines.push('📖 WHAT YOU ARE SERVING (auto-synopsis)');
  lines.push(oneLineSummary);
  lines.push('');
  lines.push('📌 WHAT THIS MEANS FOR THE DEFENDANT:');
  lines.push(defendantAction);
  if (moneyAtStake) {
    lines.push('');
    lines.push(`💰 AMOUNT IN CONTROVERSY: ${moneyAtStake}`);
  }
  lines.push('');
  lines.push(urgencyLine);

  return {
    category,
    oneLineSummary,
    defendantAction,
    moneyAtStake,
    urgencyLine,
    fullText: lines.join('\n'),
  };
}
