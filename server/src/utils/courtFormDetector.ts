// ============================================================
// Court Form Detector
//
// Determines whether a piece of extracted PDF text is a court-issued
// document, what type of form it is, what state/court system it came
// from, and the official form number if one is present. Replaces the
// single-line keyword regex that was used to classify "court_docket"
// during serve-intake doc routing.
//
// Designed to recognise forms from all 50 states plus US federal /
// tribal / military courts. Pattern-based — runs in <1ms per document.
// Returns a confidence score so callers can decide how aggressively
// to trust the classification (the intake router uses >= 30 to count
// as a court doc).
// ============================================================

export type CourtFormCategory =
  | 'summons'
  | 'complaint'
  | 'petition'
  | 'subpoena'
  | 'citation'                  // Texas-style "Citation" issued in lieu of summons
  | 'eviction_notice'           // 3-day pay-or-quit, unlawful detainer summons
  | 'protective_order'
  | 'restraining_order_temporary'
  | 'order_to_show_cause'
  | 'order'                     // generic court order
  | 'motion'
  | 'notice_of_hearing'
  | 'notice'                    // generic notice
  | 'writ'                      // writ of execution / restitution / habeas / mandamus / garnishment
  | 'judgment'
  | 'decree'                    // divorce / probate decree
  | 'affidavit'
  | 'declaration'               // CA-style declaration in lieu of affidavit
  | 'verified_complaint'
  | 'small_claims_claim'
  | 'family_law_petition'
  | 'unknown_court_form';

export type CourtSystem =
  | 'us_district'               // United States District Court
  | 'us_bankruptcy'
  | 'us_tax_court'
  | 'state_supreme'
  | 'state_appellate'
  | 'state_superior'            // CA, NJ, GA — "Superior Court"
  | 'state_circuit'             // FL, MD, MO, OR, VA, WV, AR, IL — "Circuit Court"
  | 'state_district'            // KS, MN, MT, NE, ND, SD, TX, UT — "District Court"
  | 'state_chancery'            // DE, MS, TN — "Chancery Court"
  | 'court_of_common_pleas'     // OH, PA, SC
  | 'state_county'              // many: "County Court" / "County Court at Law"
  | 'state_justice'             // UT, NV, AZ, TX — "Justice Court"
  | 'state_municipal'
  | 'state_magistrate'
  | 'state_probate'
  | 'state_family'
  | 'state_juvenile'
  | 'small_claims'
  | 'tribal'
  | 'military'                  // courts-martial / NJP
  | 'unknown';

export interface CourtFormDetection {
  isCourtDocument: boolean;
  category: CourtFormCategory;
  /** Two-letter USPS state code if a state could be identified, else null. */
  state: string | null;
  /** Full state name for display, e.g. "California". */
  stateName: string | null;
  /** Court system classification (best effort). */
  courtSystem: CourtSystem;
  /** Court name as it appears, trimmed. e.g. "Third Judicial District Court of Salt Lake County". */
  courtName: string | null;
  /** Official form number if recognised (e.g. "SUM-100", "AO 440", "FL-110"). */
  formNumber: string | null;
  /** 0–100. Higher = more signal. >= 30 → treat as court_docket. */
  confidence: number;
  /** Human-readable list of the signals that fired (for debugging / audit). */
  signals: string[];
}

// ─────────────────────────────────────────────────────────────────────
// State-name → USPS-code map (all 50 states + DC + territories)
// ─────────────────────────────────────────────────────────────────────
const STATE_MAP: Record<string, { code: string; name: string }> = {
  ALABAMA: { code: 'AL', name: 'Alabama' },         ALASKA: { code: 'AK', name: 'Alaska' },
  ARIZONA: { code: 'AZ', name: 'Arizona' },         ARKANSAS: { code: 'AR', name: 'Arkansas' },
  CALIFORNIA: { code: 'CA', name: 'California' },   COLORADO: { code: 'CO', name: 'Colorado' },
  CONNECTICUT: { code: 'CT', name: 'Connecticut' }, DELAWARE: { code: 'DE', name: 'Delaware' },
  FLORIDA: { code: 'FL', name: 'Florida' },         GEORGIA: { code: 'GA', name: 'Georgia' },
  HAWAII: { code: 'HI', name: 'Hawaii' },           IDAHO: { code: 'ID', name: 'Idaho' },
  ILLINOIS: { code: 'IL', name: 'Illinois' },       INDIANA: { code: 'IN', name: 'Indiana' },
  IOWA: { code: 'IA', name: 'Iowa' },               KANSAS: { code: 'KS', name: 'Kansas' },
  KENTUCKY: { code: 'KY', name: 'Kentucky' },       LOUISIANA: { code: 'LA', name: 'Louisiana' },
  MAINE: { code: 'ME', name: 'Maine' },             MARYLAND: { code: 'MD', name: 'Maryland' },
  MASSACHUSETTS: { code: 'MA', name: 'Massachusetts' }, MICHIGAN: { code: 'MI', name: 'Michigan' },
  MINNESOTA: { code: 'MN', name: 'Minnesota' },     MISSISSIPPI: { code: 'MS', name: 'Mississippi' },
  MISSOURI: { code: 'MO', name: 'Missouri' },       MONTANA: { code: 'MT', name: 'Montana' },
  NEBRASKA: { code: 'NE', name: 'Nebraska' },       NEVADA: { code: 'NV', name: 'Nevada' },
  'NEW HAMPSHIRE': { code: 'NH', name: 'New Hampshire' }, 'NEW JERSEY': { code: 'NJ', name: 'New Jersey' },
  'NEW MEXICO': { code: 'NM', name: 'New Mexico' }, 'NEW YORK': { code: 'NY', name: 'New York' },
  'NORTH CAROLINA': { code: 'NC', name: 'North Carolina' }, 'NORTH DAKOTA': { code: 'ND', name: 'North Dakota' },
  OHIO: { code: 'OH', name: 'Ohio' },               OKLAHOMA: { code: 'OK', name: 'Oklahoma' },
  OREGON: { code: 'OR', name: 'Oregon' },           PENNSYLVANIA: { code: 'PA', name: 'Pennsylvania' },
  'RHODE ISLAND': { code: 'RI', name: 'Rhode Island' }, 'SOUTH CAROLINA': { code: 'SC', name: 'South Carolina' },
  'SOUTH DAKOTA': { code: 'SD', name: 'South Dakota' }, TENNESSEE: { code: 'TN', name: 'Tennessee' },
  TEXAS: { code: 'TX', name: 'Texas' },             UTAH: { code: 'UT', name: 'Utah' },
  VERMONT: { code: 'VT', name: 'Vermont' },         VIRGINIA: { code: 'VA', name: 'Virginia' },
  WASHINGTON: { code: 'WA', name: 'Washington' },   'WEST VIRGINIA': { code: 'WV', name: 'West Virginia' },
  WISCONSIN: { code: 'WI', name: 'Wisconsin' },     WYOMING: { code: 'WY', name: 'Wyoming' },
  'DISTRICT OF COLUMBIA': { code: 'DC', name: 'District of Columbia' },
  'PUERTO RICO': { code: 'PR', name: 'Puerto Rico' },
  'GUAM': { code: 'GU', name: 'Guam' },
};

// ─────────────────────────────────────────────────────────────────────
// Form-number patterns for the most-cited state and federal forms.
// Caller order matters — first match wins inside detectFormNumber().
// ─────────────────────────────────────────────────────────────────────
const FORM_NUMBER_PATTERNS: Array<{ regex: RegExp; state: string | null; label: string }> = [
  // ── US federal (Administrative Office) ──
  { regex: /\bAO\s*88(?:[A-C])?\b/i,   state: null, label: 'AO 88 (federal subpoena)' },
  { regex: /\bAO\s*440\b/i,            state: null, label: 'AO 440 (federal civil summons)' },
  { regex: /\bAO\s*441\b/i,            state: null, label: 'AO 441 (federal third-party summons)' },
  { regex: /\bAO\s*120\b/i,            state: null, label: 'AO 120 (patent/trademark notice)' },
  { regex: /\bAO\s*399\b/i,            state: null, label: 'AO 399 (waiver of service)' },
  // ── California Judicial Council ──
  { regex: /\bSUM-(?:100|110|120|130|150|170|200)\b/i, state: 'CA', label: 'CA Summons' },
  { regex: /\bUD-(?:100|105|110|115|120|125|150)\b/i,  state: 'CA', label: 'CA Unlawful Detainer' },
  { regex: /\bFL-(?:100|105|110|115|120|130|150|160|170|180|200)\b/i, state: 'CA', label: 'CA Family Law' },
  { regex: /\bSC-(?:100|103|104|105|130|135|150|200)\b/i, state: 'CA', label: 'CA Small Claims' },
  { regex: /\bCH-(?:100|110|120|130|160|200)\b/i, state: 'CA', label: 'CA Civil Harassment' },
  { regex: /\bDV-(?:100|105|109|110|120|130|140|150|180|200)\b/i, state: 'CA', label: 'CA Domestic Violence' },
  { regex: /\bEJ-(?:001|100|125|130|150|160|165|190|195)\b/i, state: 'CA', label: 'CA Enforcement of Judgment' },
  { regex: /\bGC-(?:020|110|120|130|140|150)\b/i, state: 'CA', label: 'CA Guardianship/Conservatorship' },
  { regex: /\bWG-(?:001|002|003|004|005|006|007|008|009|012|030|035)\b/i, state: 'CA', label: 'CA Wage Garnishment' },
  // ── New York ──
  { regex: /\b(?:RJI|UCS-840)\b/i, state: 'NY', label: 'NY Request for Judicial Intervention' },
  { regex: /\bIndex\s+No\.?\s*[\d-]+/i, state: 'NY', label: 'NY Index Number' },
  // ── Florida ──
  { regex: /\bFla\.\s*Fam\.?\s*L\.?\s*R\.?\s*P\.?\s*Form\s*12\.\d+\b/i, state: 'FL', label: 'FL Family Law' },
  { regex: /\bForm\s*12\.\d{3}\b/i, state: 'FL', label: 'FL Family Law Form' },
  { regex: /\bCIVR\.\s*6\.\d{3}\b/i, state: 'FL', label: 'FL Civil Procedure Form' },
  // ── Texas ──
  { regex: /\bTex\.\s*R\.\s*Civ\.\s*P\.\s*\d+/i, state: 'TX', label: 'TX Rule of Civil Procedure' },
  // ── Utah ──
  { regex: /\b1080GE\b/i, state: 'UT', label: 'UT General Civil Form' },
  { regex: /\bURCP\s*\d+/i, state: 'UT', label: 'UT Rule of Civil Procedure' },
  // ── Illinois ──
  { regex: /\bCCG\s*\d{4}\b/i, state: 'IL', label: 'IL Cook County Form' },
  // ── Massachusetts ──
  { regex: /\bCJD\s*\d+\b/i, state: 'MA', label: 'MA Trial Court Form' },

  // ─────────────────────────────────────────────────────────────────
  // 50-state expansion — most-served forms per state.
  // Patterns intentionally narrow to the form-number conventions a
  // process server actually encounters (summons, eviction, family
  // law, small claims). State context is also detected via court-name
  // and "STATE OF X" matches as a fallback.
  // ─────────────────────────────────────────────────────────────────

  // Alabama — Unified Judicial System (UJS)
  { regex: /\bForm\s*C-13\b/i, state: 'AL', label: 'AL Small Claims (Form C-13)' },
  { regex: /\bAOC[- ]CIV\s*\d+/i, state: 'AL', label: 'AL AOC Civil Form' },
  { regex: /\bForm\s*JU-\d+/i, state: 'AL', label: 'AL Juvenile Form' },
  { regex: /\bForm\s*DR-\d+/i, state: 'AL', label: 'AL Domestic Relations Form' },

  // Alaska — Court System forms (CIV / TF / P / DR / FED)
  { regex: /\bCIV-\d{3,}\b/i, state: 'AK', label: 'AK Civil Form' },
  { regex: /\bTF-\d{3,}\b/i, state: 'AK', label: 'AK Trial Form' },
  { regex: /\bDR-\d{3,}\s+\(\d{1,2}\/\d{2}\)/i, state: 'AK', label: 'AK Domestic Relations Form' },
  { regex: /\bF-\d{3,}\b.*Alaska/i, state: 'AK', label: 'AK Family Form' },

  // Arizona — Justice Court / Superior Court
  { regex: /\bJC-\d{3,}\b/i, state: 'AZ', label: 'AZ Justice Court Form' },
  { regex: /\bALSC[- ]\d+/i, state: 'AZ', label: 'AZ Landlord-Tenant Form' },

  // Arkansas — Administrative Office of the Courts
  { regex: /\bACR\s*\d+/i, state: 'AR', label: 'AR Court Rule Form' },

  // Colorado — Judicial Department Forms (JDF)
  { regex: /\bJDF\s*\d{1,4}\b/i, state: 'CO', label: 'CO Judicial Department Form' },

  // Connecticut — Judicial Branch (JD-)
  { regex: /\bJD-CV-\d+/i, state: 'CT', label: 'CT Civil Form' },
  { regex: /\bJD-FM-\d+/i, state: 'CT', label: 'CT Family Form' },
  { regex: /\bJD-PR-\d+/i, state: 'CT', label: 'CT Probate Form' },
  { regex: /\bJD-SC-\d+/i, state: 'CT', label: 'CT Small Claims Form' },
  { regex: /\bJD-HM-\d+/i, state: 'CT', label: 'CT Housing Matter Form' },

  // Delaware — Court of Chancery / Superior Court
  { regex: /\bC\.A\.\s*No\.\s*\d{4}-[A-Z0-9-]+/i, state: 'DE', label: 'DE Chancery C.A. Number' },

  // Georgia — Superior / State / Magistrate court forms
  { regex: /\bGCRP\s+\d+/i, state: 'GA', label: 'GA Civil Rule Form' },
  { regex: /\bUSCR\s+\d+\.\d+/i, state: 'GA', label: 'GA Uniform Superior Court Rule' },

  // Hawaii — District Court (1F, 2D, 3DC, 5DC) and Family Court (1FC etc.)
  { regex: /\b[12345](?:DC|FC|D|F)[-\s]?P[-\s]?\d+/i, state: 'HI', label: 'HI Court Form' },

  // Idaho — Court Administrative Order (CAO) forms
  { regex: /\bCAO\s+(?:CV|FL|SC)\s*\d+-\d+/i, state: 'ID', label: 'ID Court Administrative Order Form' },

  // Indiana — Trial Rule (TR) / Indiana Family Trial Rules
  { regex: /\bIndiana\s+Trial\s+Rule\s+\d+/i, state: 'IN', label: 'IN Trial Rule Reference' },
  { regex: /\bIFTR\s*\d+/i, state: 'IN', label: 'IN Family Trial Rule Form' },

  // Iowa — Iowa Court Rules forms
  { regex: /\bIowa\s+R\.\s*Civ\.\s*P\.\s*\d+\.\d+/i, state: 'IA', label: 'IA Rule of Civil Procedure' },
  { regex: /\bForm\s+\d+\.\d{3,4}\b.*?Iowa/i, state: 'IA', label: 'IA Court Form' },

  // Kansas — KSA / KS Supreme Court Rule
  { regex: /\bK\.S\.A\.\s*\d+-\d+/i, state: 'KS', label: 'KS Statutes Annotated Reference' },

  // Kentucky — Administrative Office of the Courts (AOC-)
  { regex: /\bAOC-\d{3}\.?\d*/i, state: 'KY', label: 'KY AOC Form' },

  // Louisiana — Code of Civil Procedure
  { regex: /\bLa\.\s*C\.C\.P\.\s*art\.?\s*\d+/i, state: 'LA', label: 'LA Code of Civil Procedure' },

  // Maine — Court Forms (CV, FM, PC)
  { regex: /\b(?:CV|FM|PC)-\d{3}\b.*Maine/i, state: 'ME', label: 'ME Court Form' },

  // Maryland — District Court Civil (DC-CV) / Circuit Court (CC-DR / CC-DC)
  { regex: /\bDC[/-]CV[/-]\d+/i, state: 'MD', label: 'MD District Court Civil' },
  { regex: /\bCC[/-]DR[/-]\d+/i, state: 'MD', label: 'MD Circuit Court Domestic Relations' },
  { regex: /\bCC[/-]DC[/-]\d+/i, state: 'MD', label: 'MD Circuit Court Civil' },

  // Michigan — MC / DC / SCAO forms
  { regex: /\bMC\s+\d{2}\b/i, state: 'MI', label: 'MI MC Court Form' },
  { regex: /\bDC\s+\d{2}\b/i, state: 'MI', label: 'MI DC Court Form' },
  { regex: /\bSCAO[- ]\d+/i, state: 'MI', label: 'MI SCAO Form' },

  // Minnesota — MNCIS / Court Rule (Minn. R. Civ. P.)
  { regex: /\bMNCIS[- ]\d+/i, state: 'MN', label: 'MN MNCIS Form' },
  { regex: /\bMinn\.\s*R\.\s*Civ\.\s*P\.\s*\d+/i, state: 'MN', label: 'MN Rule of Civil Procedure' },

  // Mississippi — MRCP forms / Chancery
  { regex: /\bM\.R\.C\.P\.\s*\d+/i, state: 'MS', label: 'MS Rule of Civil Procedure' },

  // Missouri — Court Operating Rule (CCADM) / CR-
  { regex: /\bCCADM\s*\d+/i, state: 'MO', label: 'MO Court Administrative Form' },
  { regex: /\bCR-\d{3,}\b.*Missouri/i, state: 'MO', label: 'MO Civil Rule Form' },

  // Montana — Mont. R. Civ. P.
  { regex: /\bMont\.\s*R\.\s*Civ\.\s*P\.\s*\d+/i, state: 'MT', label: 'MT Rule of Civil Procedure' },

  // Nebraska — DC Form 6:1.x / Neb. Ct. R.
  { regex: /\bDC\s*Form\s*6:\d+/i, state: 'NE', label: 'NE District Court Form' },
  { regex: /\bNeb\.\s*Ct\.\s*R\.\s*§?\s*\d+-\d+/i, state: 'NE', label: 'NE Court Rule' },

  // Nevada — JCRCP / NRCP / Justice Court forms
  { regex: /\b(?:NRCP|JCRCP)\s*\d+/i, state: 'NV', label: 'NV Civil Procedure Rule' },
  { regex: /\bN\.R\.S\.\s*\d+\.\d+/i, state: 'NV', label: 'NV Revised Statutes' },

  // New Hampshire — NHJB- prefix
  { regex: /\bNHJB-\d{4}-?[A-Z]*/i, state: 'NH', label: 'NH Judicial Branch Form' },

  // New Jersey — Court Notice (CN) / Promulgated Forms
  { regex: /\bCN\s*\d{4,5}\b/i, state: 'NJ', label: 'NJ Court Notice Form' },
  { regex: /\bN\.J\.\s*Ct\.\s*R\.\s*\d+:\d+-\d+/i, state: 'NJ', label: 'NJ Court Rule' },

  // New Mexico — Rule 1- / 2- / 4-
  { regex: /\bRule\s+(?:1|2|4|5|10)-\d{3}\s+NMRA/i, state: 'NM', label: 'NM Rules Annotated' },
  { regex: /\b4-\d{3}\s+NMRA/i, state: 'NM', label: 'NM Rule 4 (Service)' },

  // North Carolina — Administrative Office of the Courts (AOC)
  { regex: /\bAOC-CV-\d+/i, state: 'NC', label: 'NC AOC Civil Form' },
  { regex: /\bAOC-G-\d+/i, state: 'NC', label: 'NC AOC General Form' },
  { regex: /\bAOC-CR-\d+/i, state: 'NC', label: 'NC AOC Criminal Form' },
  { regex: /\bAOC-E-\d+/i, state: 'NC', label: 'NC AOC Estate Form' },
  { regex: /\bAOC-J-\d+/i, state: 'NC', label: 'NC AOC Juvenile Form' },

  // North Dakota — State Form Number (SFN)
  { regex: /\bSFN\s*\d{4,5}\b/i, state: 'ND', label: 'ND State Form Number' },

  // Ohio — Standard Probate Form / Ohio R. Civ. P.
  { regex: /\bStandard\s+Probate\s+Form\s+\d+\.\d+/i, state: 'OH', label: 'OH Standard Probate Form' },
  { regex: /\bOhio\s+R\.\s*Civ\.\s*P\.\s*\d+/i, state: 'OH', label: 'OH Rule of Civil Procedure' },

  // Oklahoma — OUJI-CIV (jury instructions) and District Court Forms
  { regex: /\bOUJI-CIV\s*\d+/i, state: 'OK', label: 'OK Uniform Jury Instructions' },

  // Oregon — Oregon Rules of Civil Procedure (ORCP)
  { regex: /\bORCP\s*\d+/i, state: 'OR', label: 'OR Rule of Civil Procedure' },
  { regex: /\bUTCR\s*\d+\.\d+/i, state: 'OR', label: 'OR Uniform Trial Court Rule' },

  // Pennsylvania — Pa. R. Civ. P. / Magisterial District Court (MDJ-)
  { regex: /\bPa\.\s*R\.\s*Civ\.\s*P\.\s*\d+/i, state: 'PA', label: 'PA Rule of Civil Procedure' },
  { regex: /\bMDJ-\d+/i, state: 'PA', label: 'PA Magisterial District Court Form' },

  // Rhode Island — RI Superior Court Civil Cover Sheet / SU-CV
  { regex: /\bSU-CV-\d+/i, state: 'RI', label: 'RI Superior Court Civil Form' },

  // South Carolina — SCRCP / SCCA forms
  { regex: /\bSCRCP\s*\d+/i, state: 'SC', label: 'SC Rule of Civil Procedure' },
  { regex: /\bSCCA[/]?\d+/i, state: 'SC', label: 'SC Court Administration Form' },

  // South Dakota — Unified Judicial System (UJS)
  { regex: /\bUJS-\d{3,}\b/i, state: 'SD', label: 'SD UJS Form' },

  // Tennessee — Tenn. R. Civ. P.
  { regex: /\bTenn\.\s*R\.\s*Civ\.\s*P\.\s*\d+/i, state: 'TN', label: 'TN Rule of Civil Procedure' },

  // Vermont — Vermont Judiciary Form 100 series
  { regex: /\bV\.R\.C\.P\.\s*\d+/i, state: 'VT', label: 'VT Rule of Civil Procedure' },
  { regex: /\b(?:JD|FAM|PROB|SC|EVIC)-\d{3,}\b.*Vermont/i, state: 'VT', label: 'VT Court Form' },

  // Virginia — District Court forms (DC-) — DC-401 (warrant in debt), DC-419 (UD summons)
  { regex: /\bDC-\d{3}\b/i, state: 'VA', label: 'VA District Court Form' },
  { regex: /\bCC-\d{4}\b/i, state: 'VA', label: 'VA Circuit Court Form' },

  // Washington — WPF (Washington Pattern Forms) / GR / CR
  { regex: /\bWPF\s+(?:CV|FL|DR|DRPSCU|SC|UD)\s*\d+\.\d+/i, state: 'WA', label: 'WA Pattern Form' },
  { regex: /\bWashington\s+Civil\s+Rule\s+\d+/i, state: 'WA', label: 'WA Civil Rule Reference' },

  // West Virginia — WVRCP / SCA forms
  { regex: /\bW\.\s*Va\.\s*R\.\s*Civ\.\s*P\.\s*\d+/i, state: 'WV', label: 'WV Rule of Civil Procedure' },
  { regex: /\bSCA[- ]?[FCM]\d+/i, state: 'WV', label: 'WV Supreme Court of Appeals Form' },

  // Wisconsin — General Forms (GF) / CV / FA
  { regex: /\bGF-\d{3}\b/i, state: 'WI', label: 'WI General Form' },
  { regex: /\bWis\.\s*Stat\.\s*§?\s*\d+\.\d+/i, state: 'WI', label: 'WI Statute Reference' },
  { regex: /\bSC-\d{3,}\b.*Wisconsin/i, state: 'WI', label: 'WI Small Claims Form' },

  // Wyoming — Wyo. R. Civ. P. / OJS forms
  { regex: /\bWyo\.\s*R\.\s*Civ\.\s*P\.\s*\d+/i, state: 'WY', label: 'WY Rule of Civil Procedure' },

  // District of Columbia — Sup. Ct. Civ. R. / Sup. Ct. Dom. Rel. R.
  { regex: /\bSup\.\s*Ct\.\s*(?:Civ|Dom\.\s*Rel)\.\s*R\.\s*\d+/i, state: 'DC', label: 'DC Superior Court Rule' },
];

function detectFormNumber(text: string): { number: string | null; state: string | null; label: string | null } {
  for (const { regex, state, label } of FORM_NUMBER_PATTERNS) {
    const m = text.match(regex);
    if (m) return { number: m[0].toUpperCase().trim(), state, label };
  }
  return { number: null, state: null, label: null };
}

// ─────────────────────────────────────────────────────────────────────
// Court system & court-name detection
// ─────────────────────────────────────────────────────────────────────
const COURT_SYSTEM_PATTERNS: Array<{ regex: RegExp; system: CourtSystem }> = [
  { regex: /UNITED\s+STATES\s+DISTRICT\s+COURT/i, system: 'us_district' },
  { regex: /UNITED\s+STATES\s+BANKRUPTCY\s+COURT/i, system: 'us_bankruptcy' },
  { regex: /UNITED\s+STATES\s+TAX\s+COURT/i, system: 'us_tax_court' },
  { regex: /SUPREME\s+COURT\s+OF\s+(?:THE\s+STATE\s+OF\s+)?[A-Z]/i, system: 'state_supreme' },
  { regex: /COURT\s+OF\s+APPEALS?/i, system: 'state_appellate' },
  { regex: /SUPERIOR\s+COURT/i, system: 'state_superior' },
  { regex: /CIRCUIT\s+COURT/i, system: 'state_circuit' },
  { regex: /CHANCERY\s+COURT|COURT\s+OF\s+CHANCERY/i, system: 'state_chancery' },
  { regex: /COURT\s+OF\s+COMMON\s+PLEAS/i, system: 'court_of_common_pleas' },
  { regex: /JUSTICE\s+COURT/i, system: 'state_justice' },
  { regex: /MUNICIPAL\s+COURT/i, system: 'state_municipal' },
  { regex: /MAGISTRATE\s+(?:COURT|JUDGE)/i, system: 'state_magistrate' },
  // Combined "Probate AND Family Court" (MA, etc.) classifies as probate by convention.
  { regex: /PROBATE\s+(?:AND\s+FAMILY\s+)?COURT/i, system: 'state_probate' },
  { regex: /FAMILY\s+COURT|FAMILY\s+DIVISION/i, system: 'state_family' },
  { regex: /JUVENILE\s+COURT/i, system: 'state_juvenile' },
  { regex: /SMALL\s+CLAIMS\s+(?:COURT|DIVISION)/i, system: 'small_claims' },
  { regex: /TRIBAL\s+COURT|COURT\s+OF\s+(?:THE\s+)?(?:NAVAJO|CHEROKEE|SIOUX|NATION)/i, system: 'tribal' },
  { regex: /COURT[- ]MARTIAL|MILITARY\s+COURT/i, system: 'military' },
  { regex: /COUNTY\s+COURT(?:\s+AT\s+LAW)?/i, system: 'state_county' },
  // District court — last among state systems because federal "United States District Court" must win first.
  { regex: /\bDISTRICT\s+COURT\b/i, system: 'state_district' },
];

function detectCourtSystem(text: string): CourtSystem {
  for (const { regex, system } of COURT_SYSTEM_PATTERNS) {
    if (regex.test(text)) return system;
  }
  return 'unknown';
}

function extractCourtName(text: string): string | null {
  // Try common multi-line patterns first.
  const patterns: RegExp[] = [
    /UNITED\s+STATES\s+DISTRICT\s+COURT[^\n]*\n[^\n]*?(?:DISTRICT|DIVISION)[^\n]*/i,
    /(?:IN\s+THE\s+)?(?:SUPERIOR|CIRCUIT|CHANCERY|DISTRICT|JUSTICE|MUNICIPAL|FAMILY|JUVENILE|PROBATE)\s+COURT[^\n,]*(?:\sOF\s[^\n,]+){0,2}/i,
    /COURT\s+OF\s+COMMON\s+PLEAS[^\n,]*/i,
    /(?:SUPREME|APPELLATE)\s+COURT\s+OF\s+(?:THE\s+STATE\s+OF\s+)?[A-Z][^\n,]*/i,
    /SMALL\s+CLAIMS\s+(?:COURT|DIVISION)[^\n,]*/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[0].replace(/\s+/g, ' ').trim();
  }
  return null;
}

function detectStateFromText(text: string, courtName: string | null): { code: string | null; name: string | null } {
  // 1. Check explicit "State of X" / "Commonwealth of X" / "STATE OF X".
  const explicit = text.match(/(?:STATE|COMMONWEALTH|TERRITORY)\s+OF\s+([A-Z][A-Z .]+?)(?:\s*[,\n)]|$)/i);
  if (explicit) {
    const key = explicit[1].toUpperCase().trim();
    if (STATE_MAP[key]) return { code: STATE_MAP[key].code, name: STATE_MAP[key].name };
  }
  // 2. Court name often contains "of X" (e.g. "District Court of Maryland for Baltimore City").
  if (courtName) {
    const courtState = courtName.match(/\bOF\s+([A-Z][A-Z .]+?)(?:\s+FOR|\s+AT|\s*[,\n]|$)/i);
    if (courtState) {
      const key = courtState[1].toUpperCase().trim();
      if (STATE_MAP[key]) return { code: STATE_MAP[key].code, name: STATE_MAP[key].name };
    }
  }
  // 3. State name appearing after a comma in the court caption — e.g.
  // "LAS VEGAS JUSTICE COURT, CLARK COUNTY, NEVADA" or "..., COLORADO".
  // Constrained to the first ~600 chars to stay in the header region and
  // avoid false hits on body text mentioning unrelated state names.
  const head = text.slice(0, 600).toUpperCase();
  for (const stateKey of Object.keys(STATE_MAP)) {
    // Word-boundary match preceded by comma, optional whitespace.
    const re = new RegExp(`,\\s*${stateKey.replace(/ /g, '\\s+')}\\b`);
    if (re.test(head)) return { code: STATE_MAP[stateKey].code, name: STATE_MAP[stateKey].name };
  }
  // 4. ZIP-based USPS-state suffix in court address (last-ditch fallback).
  const addrState = text.match(/\b([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/);
  if (addrState) {
    const code = addrState[1];
    const found = Object.values(STATE_MAP).find((s) => s.code === code);
    if (found) return { code: found.code, name: found.name };
  }
  return { code: null, name: null };
}

// ─────────────────────────────────────────────────────────────────────
// Form-category detection — broad first, more-specific patterns override.
// ─────────────────────────────────────────────────────────────────────
const CATEGORY_PATTERNS: Array<{ regex: RegExp; category: CourtFormCategory; weight: number }> = [
  // High-confidence specific forms
  { regex: /\bUNLAWFUL\s+DETAINER\b/i, category: 'eviction_notice', weight: 25 },
  { regex: /\b(?:3|FIVE|SEVEN|TEN|14|30)[- ]DAY\s+NOTICE\b.*?(?:QUIT|CURE|VACATE)/i, category: 'eviction_notice', weight: 25 },
  { regex: /\bORDER\s+TO\s+SHOW\s+CAUSE\b/i, category: 'order_to_show_cause', weight: 25 },
  { regex: /\bTEMPORARY\s+RESTRAINING\s+ORDER\b/i, category: 'restraining_order_temporary', weight: 25 },
  { regex: /\b(?:PROTECTIVE|RESTRAINING)\s+ORDER\b/i, category: 'protective_order', weight: 22 },
  { regex: /\bWRIT\s+OF\s+(?:EXECUTION|RESTITUTION|GARNISHMENT|MANDAMUS|HABEAS\s+CORPUS|POSSESSION)\b/i, category: 'writ', weight: 25 },
  { regex: /\bSMALL\s+CLAIMS\s+(?:COMPLAINT|CLAIM|CASE|AFFIDAVIT|SUMMONS|ACTION)\b/i, category: 'small_claims_claim', weight: 22 },
  { regex: /\bPETITION\s+FOR\s+(?:DIVORCE|DISSOLUTION|LEGAL\s+SEPARATION|CUSTODY)\b/i, category: 'family_law_petition', weight: 25 },
  { regex: /\bVERIFIED\s+COMPLAINT\b/i, category: 'verified_complaint', weight: 22 },
  // Standard forms
  { regex: /\bSUMMONS\b/i, category: 'summons', weight: 18 },
  { regex: /\bCITATION\b/i, category: 'citation', weight: 16 }, // Texas / Probate use "Citation"
  { regex: /\bCOMPLAINT\b/i, category: 'complaint', weight: 16 },
  { regex: /\bSUBPOENA\b/i, category: 'subpoena', weight: 20 },
  { regex: /\bPETITION\b/i, category: 'petition', weight: 14 },
  { regex: /\bMOTION\b/i, category: 'motion', weight: 12 },
  { regex: /\bNOTICE\s+OF\s+HEARING\b/i, category: 'notice_of_hearing', weight: 18 },
  { regex: /\bNOTICE\s+OF\s+\w+/i, category: 'notice', weight: 10 },
  { regex: /\bAFFIDAVIT\b/i, category: 'affidavit', weight: 12 },
  { regex: /\bDECLARATION\s+(?:OF|UNDER)/i, category: 'declaration', weight: 12 },
  { regex: /\bORDER\b/i, category: 'order', weight: 8 },
  { regex: /\bJUDGMENT\b/i, category: 'judgment', weight: 14 },
  { regex: /\bDECREE\b/i, category: 'decree', weight: 12 },
];

function detectCategory(text: string): { category: CourtFormCategory; categorySignals: string[] } {
  const signals: string[] = [];
  let best: { cat: CourtFormCategory; weight: number } = { cat: 'unknown_court_form', weight: 0 };
  for (const { regex, category, weight } of CATEGORY_PATTERNS) {
    if (regex.test(text)) {
      signals.push(`category:${category}(+${weight})`);
      if (weight > best.weight) best = { cat: category, weight };
    }
  }
  return { category: best.cat, categorySignals: signals };
}

// ─────────────────────────────────────────────────────────────────────
// Caption / case-number signals
// ─────────────────────────────────────────────────────────────────────
const CAPTION_PATTERNS: RegExp[] = [
  /\bv\.\s*\n/i,                    // "Plaintiff,\n  v.\n  Defendant"
  /\bvs\.\s*\n/i,
  /\bPLAINTIFF\b/i,
  /\bDEFENDANT\b/i,
  /\bPETITIONER\b/i,
  /\bRESPONDENT\b/i,
  /\bIN\s+RE\s+THE\s+(?:MARRIAGE|MATTER|ESTATE)/i,
  /\bIN\s+THE\s+MATTER\s+OF\b/i,
];

const CASE_NUMBER_PATTERNS: RegExp[] = [
  /\bCase\s+(?:No\.?|Number|#)[:\s]*[A-Z0-9]+-?\d+[-A-Z0-9]*/i,
  /\bDocket\s+(?:No\.?|Number)[:\s]*[A-Z0-9-]+/i,
  /\bIndex\s+No\.?\s*[\d-]+/i,
  /\bCivil\s+(?:No\.|Action\s+No\.)\s*[A-Z0-9-]+/i,
  /\bNo\.?\s*\d{2,}-(?:CV|CR|CIV|FA|PR|JV|SC|UD|FL|DV|CH)-?\d+/i,
];

// ─────────────────────────────────────────────────────────────────────
// Header / preamble signals — phrases that almost only appear on court-issued docs
// ─────────────────────────────────────────────────────────────────────
const PREAMBLE_PATTERNS: Array<{ regex: RegExp; weight: number; label: string }> = [
  { regex: /YOU\s+ARE\s+HEREBY\s+(?:SUMMONED|NOTIFIED|COMMANDED|ORDERED|DIRECTED)/i, weight: 18, label: 'preamble:hereby_summoned' },
  { regex: /TO\s+THE\s+(?:DEFENDANT|RESPONDENT|ABOVE-NAMED)\b/i, weight: 14, label: 'preamble:to_the_defendant' },
  { regex: /NOTICE\s+TO\s+THE\s+(?:DEFENDANT|RESPONDENT)/i, weight: 14, label: 'preamble:notice_to_defendant' },
  { regex: /BY\s+ORDER\s+OF\s+THE\s+COURT/i, weight: 12, label: 'preamble:by_order_of_court' },
  { regex: /CLERK\s+OF\s+(?:THE\s+)?COURT/i, weight: 8, label: 'preamble:clerk_of_court' },
  { regex: /JURY\s+TRIAL\s+DEMANDED/i, weight: 10, label: 'preamble:jury_demand' },
  { regex: /Attorney\s+for\s+(?:Plaintiff|Petitioner|Defendant|Respondent)/i, weight: 8, label: 'preamble:attorney_for' },
  { regex: /STATE\s+BAR\s+(?:NO\.|NUMBER|#)\s*\d+/i, weight: 8, label: 'preamble:bar_number' },
  { regex: /(?:Pro\s+Se|In\s+Propria\s+Persona)/i, weight: 6, label: 'preamble:pro_se' },
];

// ─────────────────────────────────────────────────────────────────────
// Main detector
// ─────────────────────────────────────────────────────────────────────
export function detectCourtForm(text: string): CourtFormDetection {
  const signals: string[] = [];
  let confidence = 0;

  if (!text || text.length < 50) {
    return {
      isCourtDocument: false,
      category: 'unknown_court_form',
      state: null,
      stateName: null,
      courtSystem: 'unknown',
      courtName: null,
      formNumber: null,
      confidence: 0,
      signals: ['empty:short_or_missing_text'],
    };
  }

  // 1. Form number detection contributes high confidence
  const fn = detectFormNumber(text);
  if (fn.number) {
    confidence += 30;
    signals.push(`form_number:${fn.number}(+30)`);
  }

  // 2. Court system detection
  const courtSystem = detectCourtSystem(text);
  const courtName = extractCourtName(text);
  if (courtSystem !== 'unknown') {
    confidence += 20;
    signals.push(`court_system:${courtSystem}(+20)`);
  }
  if (courtName) {
    confidence += 8;
    signals.push(`court_name_extracted(+8)`);
  }

  // 3. Form-category detection
  const { category, categorySignals } = detectCategory(text);
  signals.push(...categorySignals);
  // Add the highest single category weight to confidence (already capped per-pattern).
  const highestCatWeight = categorySignals
    .map((s) => Number((s.match(/\+(\d+)/) || [])[1] || 0))
    .reduce((max, w) => Math.max(max, w), 0);
  confidence += highestCatWeight;

  // 4. Caption signals
  let captionHits = 0;
  for (const re of CAPTION_PATTERNS) if (re.test(text)) captionHits++;
  if (captionHits > 0) {
    const w = Math.min(captionHits * 4, 16);
    confidence += w;
    signals.push(`caption_hits:${captionHits}(+${w})`);
  }

  // 5. Case-number signals
  let caseNumberHit = false;
  for (const re of CASE_NUMBER_PATTERNS) if (re.test(text)) { caseNumberHit = true; break; }
  if (caseNumberHit) { confidence += 10; signals.push(`case_number(+10)`); }

  // 6. Preamble phrases
  for (const { regex, weight, label } of PREAMBLE_PATTERNS) {
    if (regex.test(text)) { confidence += weight; signals.push(`${label}(+${weight})`); }
  }

  // 7. State detection (last — also uses court name + form-number hint)
  let state: string | null = null;
  let stateName: string | null = null;
  if (fn.state) {
    state = fn.state;
    const entry = Object.values(STATE_MAP).find((s) => s.code === fn.state);
    if (entry) stateName = entry.name;
  }
  if (!state) {
    const guess = detectStateFromText(text, courtName);
    state = guess.code;
    stateName = guess.name;
  }
  if (state) signals.push(`state:${state}`);

  // Cap confidence at 100
  confidence = Math.min(100, confidence);

  return {
    isCourtDocument: confidence >= 30,
    category,
    state,
    stateName,
    courtSystem,
    courtName,
    formNumber: fn.number,
    confidence,
    signals,
  };
}
