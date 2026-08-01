// ============================================================
// RMPG Flex — Worker-side display labels
// ============================================================
// Acronym-aware snake_case → "Standard English" label formatting for text the
// Worker itself emits to users: notification bodies, TTS phrases, and `label`
// fields returned to the SPA for charts and tables.
//
// ⚠️ This MIRRORS client/src/utils/formatters.ts on purpose. The Worker and the
// React client share no build, no tsconfig and no package.json, so a Worker
// module cannot import from client/src without dragging a client module into
// the Worker bundle. The duplication is guarded against drift by the parity
// test in tests/displayLabelParity.test.ts, which imports BOTH copies and
// asserts identical output — if you add an acronym here, add it there too (or
// vice versa) and that test will tell you if you forgot.
//
// Before this existed, src/routes/voice.ts carried a local
//   toTitleCase = s.replace(/\b\w/g, c => c.toUpperCase())
// which is NOT acronym-aware, so dispatch TTS and notifications rendered the
// weak lowercase "Pso Client Request" instead of "PSO Client Request".
// ============================================================

/**
 * Acronyms that must render ALL-CAPS in a display label, never "Pso".
 * Keep in sync with ACRONYMS in client/src/utils/formatters.ts.
 */
export const ACRONYMS = new Set([
  // Communications / systems
  'pso', 'cfs', 'cad', 'rms', 'mdt', 'mds', 'gps', 'rmpg',
  // Domestic / personal categories
  'dv', 'dl', 'dob', 'ssn', 'dlv',
  // Emergency response
  'ems', 'leo', 'swat', 'k9', 'sro', 'qrf', 'eta',
  // Records / intel
  'ncic', 'bolo', 'atl', 'fbi', 'doc', 'udc', 'sor', 'nsopw',
  // Driving-related
  'dui', 'dwi', 'cdl', 'dmv', 'vin', 'mva', 'dlc',
  // Service / process
  'sla', 'sop', 'opr', 'le', 'id', 'loc',
  // Property / corporate
  'hoa', 'llc', 'hud',
  // Tech / network
  'ip', 'pdf', 'api', 'url', 'vpn', 'alpr', 'json', 'html', 'csv', 'ui', 'ux', 'sdk',
  // Legal / enforcement
  'ua', 'uof', 'oat', 'oatc', 'ia', 'ippa',
  // Court / legal
  'dc', 'pd', 'da',
  // Medical
  'md', 'rn',
  // Military
  'idf', 'mp', 'mos',
  // Geography / time
  'ut', 'slc', 'mt', 'utc', 'mtn',
  // Other law enforcement specific
  'cpr', 'atv', 'utv',
  // Financial
  'atm', 'pos',
  // Investigation
  'mis', 'ped', 'vcl', 'unsub',
  // Common multi-word compound labels (specific to this app)
  'microbilt',
  'forecaws',
  'utahlex',
  'openpyxl',
]);

/**
 * Title-case ONE word, keeping a known acronym ALL-CAPS.
 */
export function titleCaseWord(word: string): string {
  if (!word) return word;
  return ACRONYMS.has(word.toLowerCase())
    ? word.toUpperCase()
    : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Convert snake_case, kebab-case, or camelCase to a display label:
 *   "pso_client_request" → "PSO Client Request"
 *   "in_progress"        → "In Progress"
 *   "underReview"        → "Under Review"
 *
 * ⚠️ '-' is treated as a word separator, so a hyphen-only placeholder collapses
 * to ''. Write such fallbacks OUTSIDE the call — `toDisplayLabel(x) || '-'`,
 * never `toDisplayLabel(x || '-')`.
 */
export function toDisplayLabel(str: string | null | undefined): string {
  if (!str) return '';
  const s = String(str).trim();
  if (!s) return '';
  // Insert space before uppercase letters in camelCase (except first char)
  const withSpaces = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return withSpaces
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b[A-Za-z0-9]+/g, titleCaseWord)
    .trim();
}
