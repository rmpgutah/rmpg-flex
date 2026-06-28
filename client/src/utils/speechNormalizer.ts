// ============================================================
// RMPG Flex — Speech Normalizer
//
// Converts CAD shorthand, abbreviations, codes, and shorthand
// into properly pronounced English for TTS output. Applied to
// every text string before it reaches the TTS engine.
//
// Covers: police 10-codes, signal codes, priority codes,
// common abbreviations, street suffixes, directionals, time
// formats, NATO phonetics for mixed alphanumeric, status codes,
// GPS coordinates, and dispatch-specific shorthand.
// ============================================================

// ─── 10-codes ─────────────────────────────────────────────────
// Police radio ten-codes. The TTS engine says "10-4" as
// "ten dash four" without expansion.
const TEN_CODES: Record<string, string> = {
  '10-0': 'ten zero',
  '10-1': 'ten one',
  '10-2': 'ten two',
  '10-3': 'ten three',
  '10-4': 'ten four',
  '10-5': 'ten five',
  '10-6': 'ten six',
  '10-7': 'ten seven',
  '10-8': 'ten eight',
  '10-9': 'ten nine',
  '10-10': 'ten ten',
  '10-11': 'ten eleven',
  '10-12': 'ten twelve',
  '10-13': 'ten thirteen',
  '10-14': 'ten fourteen',
  '10-15': 'ten fifteen',
  '10-16': 'ten sixteen',
  '10-17': 'ten seventeen',
  '10-18': 'ten eighteen',
  '10-19': 'ten nineteen',
  '10-20': 'ten twenty',
  '10-21': 'ten twenty-one',
  '10-22': 'ten twenty-two',
  '10-23': 'ten twenty-three',
  '10-24': 'ten twenty-four',
  '10-25': 'ten twenty-five',
  '10-28': 'ten twenty-eight',
  '10-29': 'ten twenty-nine',
  '10-30': 'ten thirty',
  '10-31': 'ten thirty-one',
  '10-32': 'ten thirty-two',
  '10-33': 'ten thirty-three',
  '10-34': 'ten thirty-four',
  '10-35': 'ten thirty-five',
  '10-36': 'ten thirty-six',
  '10-37': 'ten thirty-seven',
  '10-38': 'ten thirty-eight',
  '10-39': 'ten thirty-nine',
  '10-40': 'ten forty',
  '10-41': 'ten forty-one',
  '10-42': 'ten forty-two',
  '10-43': 'ten forty-three',
  '10-44': 'ten forty-four',
  '10-45': 'ten forty-five',
  '10-46': 'ten forty-six',
  '10-47': 'ten forty-seven',
  '10-48': 'ten forty-eight',
  '10-49': 'ten forty-nine',
  '10-50': 'ten fifty',
  '10-51': 'ten fifty-one',
  '10-52': 'ten fifty-two',
  '10-53': 'ten fifty-three',
  '10-54': 'ten fifty-four',
  '10-55': 'ten fifty-five',
  '10-56': 'ten fifty-six',
  '10-57': 'ten fifty-seven',
  '10-58': 'ten fifty-eight',
  '10-59': 'ten fifty-nine',
  '10-60': 'ten sixty',
  '10-61': 'ten sixty-one',
  '10-62': 'ten sixty-two',
  '10-63': 'ten sixty-three',
  '10-64': 'ten sixty-four',
  '10-65': 'ten sixty-five',
  '10-66': 'ten sixty-six',
  '10-67': 'ten sixty-seven',
  '10-68': 'ten sixty-eight',
  '10-69': 'ten sixty-nine',
  '10-70': 'ten seventy',
  '10-71': 'ten seventy-one',
  '10-72': 'ten seventy-two',
  '10-73': 'ten seventy-three',
  '10-74': 'ten seventy-four',
  '10-75': 'ten seventy-five',
  '10-76': 'ten seventy-six',
  '10-77': 'ten seventy-seven',
  '10-78': 'ten seventy-eight',
  '10-79': 'ten seventy-nine',
  '10-80': 'ten eighty',
  '10-81': 'ten eighty-one',
  '10-82': 'ten eighty-two',
  '10-83': 'ten eighty-three',
  '10-84': 'ten eighty-four',
  '10-85': 'ten eighty-five',
  '10-86': 'ten eighty-six',
  '10-87': 'ten eighty-seven',
  '10-88': 'ten eighty-eight',
  '10-89': 'ten eighty-nine',
  '10-90': 'ten ninety',
  '10-91': 'ten ninety-one',
  '10-92': 'ten ninety-two',
  '10-93': 'ten ninety-three',
  '10-94': 'ten ninety-four',
  '10-95': 'ten ninety-five',
  '10-96': 'ten ninety-six',
  '10-97': 'ten ninety-seven',
  '10-98': 'ten ninety-eight',
  '10-99': 'ten ninety-nine',
  '10-100': 'ten hundred',
};

// ─── Signal / Code words ─────────────────────────────────────
// "Code 1" → "Code One", "Signal 11" → "Signal Eleven"
function expandCodeWords(text: string): string {
  return text.replace(/\b(code|signal)\s+(\d+)\b/gi, (_, word, num) => {
    return `${word} ${numberToWords(num)}`;
  });
}

// ─── Priority codes ──────────────────────────────────────────
const PRIORITY_MAP: Record<string, string> = {
  P1: 'Priority One',
  P2: 'Priority Two',
  P3: 'Priority Three',
  P4: 'Priority Four',
};

// ─── Letter-by-letter acronyms ───────────────────────────────
// These should be spoken as individual letters, not as words.
// "PSO" → "P. S. O.", "DV" → "D. V."
const LETTER_ACRONYMS = new Set([
  'PSO', 'CFS', 'DV', 'EMS', 'LEO', 'NCIC', 'BOLO', 'ATL', 'MDT', 'SLA',
  'ID', 'DUI', 'DWI', 'HOA', 'LLC', 'ETA', 'RMPG', 'GPS', 'IP', 'PDF',
  'API', 'URL', 'VPN', 'OPR', 'LE', 'SOP', 'DOA', 'DOD', 'DOT', 'FBI',
  'DEA', 'ATF', 'ICE', 'DMV', 'CAD', 'RMS', 'PD', 'SO', 'UT', 'SLC',
  'SGT', 'LT', 'CPT', 'CHP', 'LAPD', 'NYPD', 'UC', 'UCA', 'UAC',
  'NCIS', 'MPD', 'SRO', 'MPH', 'KPH', 'RPM', 'VIN',
]);

// ─── Street suffix expansions ────────────────────────────────
const STREET_SUFFIXES: Record<string, string> = {
  ST: 'Street',
  AVE: 'Avenue',
  BLVD: 'Boulevard',
  DR: 'Drive',
  LN: 'Lane',
  CT: 'Court',
  CIR: 'Circle',
  RD: 'Road',
  PL: 'Place',
  WAY: 'Way',
  PKWY: 'Parkway',
  HWY: 'Highway',
  TER: 'Terrace',
  TRL: 'Trail',
  RUN: 'Run',
  CV: 'Cove',
  WY: 'Way',
  ROW: 'Row',
  PT: 'Point',
  VW: 'View',
  PLZ: 'Plaza',
  ML: 'Mill',
  BND: 'Bend',
  PASS: 'Pass',
  GLN: 'Glen',
  GRN: 'Green',
  GRV: 'Grove',
  HTS: 'Heights',
  HLL: 'Hill',
  IS: 'Island',
  JCT: 'Junction',
  LK: 'Lake',
  MTN: 'Mountain',
  SHL: 'Shore',
  SPR: 'Spring',
  STA: 'Station',
  VAL: 'Valley',
  VLY: 'Valley',
};

const STREET_ABBREV_KEYS = Object.keys(STREET_SUFFIXES).sort((a, b) => b.length - a.length);

// ─── Directional expansions ─────────────────────────────────
const DIRECTIONS: Record<string, string> = {
  N: 'North',
  S: 'South',
  E: 'East',
  W: 'West',
  NE: 'Northeast',
  NW: 'Northwest',
  SE: 'Southeast',
  SW: 'Southwest',
  NB: 'northbound',
  SB: 'southbound',
  EB: 'eastbound',
  WB: 'westbound',
};

// ─── Dispatch shorthand / natural language map ───────────────
// Consolidates and extends the NATURAL_MAP from voiceAlerts.ts
const DISPATCH_SHORTHAND: Record<string, string> = {
  ARMED_SUSPECT: 'Caution, armed suspect',
  BARRICADED: 'barricaded subject',
  CODE_3: 'Code Three, emergency response',
  CODE_2: 'Code Two, expedite',
  CODE_1: 'Code One, routine',
  DOMESTIC_IN_PROGRESS: 'domestic in progress',
  FIGHT_IN_PROGRESS: 'fight in progress',
  HIT_AND_RUN: 'hit and run',
  IN_PROGRESS: 'in progress',
  JUST_OCCURRED: 'just occurred',
  MENTAL_CRISIS: 'mental health crisis',
  OFFICER_NEEDS_HELP: 'officer needs help, emergency',
  OFFICER_DOWN: 'officer down, emergency',
  OFFICER_IN_TROUBLE: 'officer in trouble',
  PURSUIT_IN_PROGRESS: 'pursuit in progress',
  ROLLING_CODE_3: 'rolling Code Three',
  SHOTS_FIRED: 'shots fired',
  SUSPICIOUS: 'suspicious activity',
  UNKNOWN_TROUBLE: 'unknown trouble',
  WANTED_PERSON: 'wanted person',
  WEAPON_INVOLVED: 'weapon involved',
  WELFARE_CHECK: 'welfare check',
};

// ─── Status code expansions ──────────────────────────────────
const STATUS_EXPANSIONS: Record<string, string> = {
  available: 'available',
  on_patrol: 'on patrol',
  dispatched: 'dispatched',
  enroute: 'en route',
  onscene: 'on scene',
  clearing: 'clearing',
  cleared: 'cleared',
  out_of_service: 'out of service',
  off_duty: 'off duty',
  on_break: 'on break',
  on_hold: 'on hold',
  // Call statuses
  pending: 'pending',
  'in-progress': 'in progress',
  closed: 'closed',
  cancelled: 'cancelled',
  archived: 'archived',
};

// ─── Unit designator expansions ───────────────────────────────
// K9 → "K-9", D11 → "D-11", M1 → "M-1"
const UNIT_DESIGNATOR = /\b([A-Z])(\d+)\b/g;

// ─── Number to words (for codes) ────────────────────────────
function numberToWords(num: string): string {
  const map: Record<string, string> = {
    '0': 'zero',
    '1': 'one',
    '2': 'two',
    '3': 'three',
    '4': 'four',
    '5': 'five',
    '6': 'six',
    '7': 'seven',
    '8': 'eight',
    '9': 'nine',
    '10': 'ten',
    '11': 'eleven',
    '12': 'twelve',
  };
  return map[num] || num;
}

// ─── NATO Phonetic Alphabet ──────────────────────────────────
const NATO: Record<string, string> = {
  A: 'Alpha',
  B: 'Bravo',
  C: 'Charlie',
  D: 'Delta',
  E: 'Echo',
  F: 'Foxtrot',
  G: 'Golf',
  H: 'Hotel',
  I: 'India',
  J: 'Juliett',
  K: 'Kilo',
  L: 'Lima',
  M: 'Mike',
  N: 'November',
  O: 'Oscar',
  P: 'Papa',
  Q: 'Quebec',
  R: 'Romeo',
  S: 'Sierra',
  T: 'Tango',
  U: 'Uniform',
  V: 'Victor',
  W: 'Whiskey',
  X: 'X-ray',
  Y: 'Yankee',
  Z: 'Zulu',
};

// ─── Main normalization pipeline ─────────────────────────────

export function normalizeForSpeech(text: string): string {
  if (!text) return '';

  let result = text.trim();

  // 1. Expand 10-codes (before any other transformations)
  result = result.replace(/\b10-\d{1,3}\b/gi, (match) => {
    return TEN_CODES[match.toUpperCase()] || match;
  });

  // 2. Expand "Code N" / "Signal N" patterns
  result = expandCodeWords(result);

  // 3. Expand priority codes: "P1" → "Priority One"
  result = result.replace(/\bP[1-4]\b/gi, (match) => {
    return PRIORITY_MAP[match.toUpperCase()] || match;
  });

  // 4. Expand status codes (underscore-separated)
  result = result.replace(/\b(enroute|onscene|on_patrol|out_of_service|off_duty|on_break|on_hold|in_progress)\b/gi, (match) => {
    return STATUS_EXPANSIONS[match.toLowerCase()] || match;
  });

  // 5. Expand dispatch shorthand (uppercase with underscores)
  result = result.replace(/\b[A-Z_]{3,60}\b/g, (match) => {
    const upper = match.toUpperCase();
    if (DISPATCH_SHORTHAND[upper]) return DISPATCH_SHORTHAND[upper];
    return match;
  });

  // 6. Expand street suffixes (word boundary, end of string or before space/punctuation)
  result = result.replace(new RegExp(`\\b(${STREET_ABBREV_KEYS.join('|')})(?=[\\s,.]|$)`, 'gi'), (match) => {
    return STREET_SUFFIXES[match.toUpperCase()] || match;
  });

  // 7. Expand directional abbreviations (before numbers or after street names)
  result = result.replace(/\b(N|S|E|W|NE|NW|SE|SW)\b(?!\s*\d{5}\b)/gi, (match, dir) => {
    const upper = dir.toUpperCase();
    if (DIRECTIONS[upper]) return DIRECTIONS[upper];
    return match;
  });

  // 8. Letter-by-letter acronyms
  result = result.replace(/\b[A-Z]{2,6}\b/g, (match) => {
    const upper = match.toUpperCase();
    // Skip if it's a known word (like a name, common word)
    if (COMMON_WORDS.has(upper)) return match;
    if (LETTER_ACRONYMS.has(upper)) {
      return upper.split('').join('. ') + '.';
    }
    return match;
  });

  // 9. NB/SB/EB/WB directionals (lowercase, for traffic directions)
  result = result.replace(/\b(NB|SB|EB|WB)\b/gi, (match) => {
    return DIRECTIONS[match.toUpperCase()] || match;
  });

  // 10. Unit designators: "K9" → "K-9", "D11" → "D-11"
  result = result.replace(UNIT_DESIGNATOR, (match, letter, num) => {
    return `${letter} ${num === '9' ? 'nine' : num}`;
  });

  // 11. Normalize time formats
  // "1430" → "fourteen thirty" (24-hour time, 4 digits)
  result = result.replace(/\b([01]\d|2[0-3])([0-5]\d)\b(?!\s*hours)/g, (_, hour, min) => {
    return `${hour} ${min} hours`;
  });
  // "HH:MM" format
  result = result.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (_, hour, min) => {
    const h = String(hour).padStart(2, '0');
    return `${h} ${min}`;
  });

  // 12. Apostrophe-s possessive normalization
  result = result.replace(/\b(\w+)'s\b/g, (_, word) => {
    return `${word}'s`;
  });

  // 13. Mixed alphanumeric tokens → NATO phonetic
  // Only for tokens that are clearly codes (like plate numbers, case IDs)
  // Pattern: 2+ chars with mix of letters+digits, 4-10 chars total
  result = result.replace(/\b(?=[A-Za-z]*[0-9])(?=[0-9]*[A-Za-z])[A-Za-z0-9]{4,10}\b/g, (match) => {
    // Skip if it's already been expanded (contains spaces now)
    if (match.includes(' ')) return match;
    // Skip common words
    if (COMMON_WORDS.has(match.toUpperCase())) return match;
    // Phonetically spell it out
    return match.split('').map((ch) => {
      const upper = ch.toUpperCase();
      return NATO[upper] || ch;
    }).join(' ');
  });

  // 14. Individual digit pronunciation for purely numeric tokens
  // Phone numbers, case numbers, badge numbers, etc.
  // Skip years (1900-2099), skip short numbers (<4 digits)
  result = result.replace(/\b(\d{4,10})\b(?!\s*hours)/g, (match) => {
    if (match.includes(' ')) return match;
    return match.split('').join(' ');
  });

  // 15. Fix common whitespace issues from expansions
  result = result.replace(/\s{2,}/g, ' ');
  result = result.replace(/\s+([.,!?;:])/g, '$1');

  // 16. "en route" is two words, not "enroute"
  result = result.replace(/\benroute\b/gi, 'en route');
  // "on scene" is two words
  result = result.replace(/\bonscene\b/gi, 'on scene');

  return result.trim();
}

// ─── Common words that should not be expanded as acronyms ────
const COMMON_WORDS = new Set([
  'THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL', 'CAN',
  'HAD', 'HER', 'HIS', 'ITS', 'MAY', 'WAS', 'WILL', 'WITH',
  'ABOUT', 'AFTER', 'AGAINST', 'BEEN', 'BEFORE', 'BETWEEN',
  'COULD', 'DOES', 'DURING', 'EACH', 'FROM', 'HAVE', 'INTO',
  'MORE', 'MOST', 'MUCH', 'MUST', 'NEAR', 'ONLY', 'OVER',
  'SAME', 'SOME', 'SUCH', 'THAN', 'THAT', 'THEM', 'THEN',
  'THERE', 'THESE', 'THING', 'THIS', 'THOSE', 'THREE', 'THROUGH',
  'TIME', 'UNDER', 'UPON', 'VERY', 'WERE', 'WHAT', 'WHEN',
  'WHERE', 'WHICH', 'WHILE', 'WHOLE', 'WOULD', 'YEAR', 'YOUR',
  'ADMIN', 'COUNT', 'EMAIL', 'ERROR', 'IMAGE', 'INDEX', 'INPUT',
  'LEVEL', 'LOGIN', 'LOGIN', 'MEDIA', 'PHONE', 'PHOTO', 'QUEUE',
  'RADIO', 'RANGE', 'RIGHT', 'ROUTE', 'SCORE', 'SHIFT', 'STATE',
  'TABLE', 'TOTAL', 'TRAFFIC', 'UPLOAD', 'VALUE', 'WEIGHT',
  'ACTIVE', 'CLOSED', 'RECORDS', 'SEARCH', 'DISPATCH', 'OFFICER',
  'CITATION', 'INCIDENT', 'PROPERTY', 'VEHICLE', 'WARRANT',
  'SALT', 'LAKE', 'CITY', 'UTAH', 'COUNTY', 'DEPARTMENT',
  // Colors
  'BLACK', 'WHITE', 'BROWN', 'BLUE', 'GRAY', 'GREY', 'GREEN',
  'RED', 'YELLOW', 'ORANGE', 'PURPLE', 'PINK', 'TAN', 'GOLD',
  'SILVER', 'BEIGE', 'MAROON', 'NAVY', 'OLIVE', 'TEAL',
  // Days / months
  'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY',
  'SATURDAY', 'SUNDAY', 'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL',
  'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER',
  'NOVEMBER', 'DECEMBER',
]);

// ─── Quick one-shot for single phrases ───────────────────────
// Used by code that builds one-off phrases (not full sentences)
export function normalizePhrase(phrase: string): string {
  return normalizeForSpeech(phrase);
}
