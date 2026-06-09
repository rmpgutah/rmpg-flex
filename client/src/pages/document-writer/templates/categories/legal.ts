import type { DocumentTemplate } from '../../types';
import { AGENCY_HEADER, CONFIDENTIAL, title, section, tbl, row2, row1, SIG_BLOCK, DUAL_SIG_BLOCK, statutes, narrative } from '../_shared';

// 20 legal / court templates.
export const LEGAL_TEMPLATES: DocumentTemplate[] = [
  {
    id: 'legal-affidavit-pc', name: 'Affidavit of Probable Cause', category: 'legal-affidavit',
    description: 'Sworn statement of probable cause for charging or warrant',
    tags: ['affidavit', 'probable-cause', 'pc'],
    statutes: ['77-7-2', '77-23-204'],
    fields: [
      { key: 'affiant', label: 'Affiant Officer', source: 'user' },
      { key: 'badge', label: 'Badge #', source: 'user' },
      { key: 'case_number', label: 'Case Number', source: 'cad', cadPath: 'call.call_number' },
      { key: 'defendant', label: 'Defendant', source: 'manual' },
      { key: 'offense', label: 'Offense(s)', source: 'manual' },
    ],
    content: `${AGENCY_HEADER}${title('AFFIDAVIT OF PROBABLE CAUSE')}
<p style="text-align:center;font-size:11px;">STATE OF UTAH ) <br>COUNTY OF SALT LAKE ) ss.</p>
<p>I, {{affiant}}, Badge #{{badge}}, being first duly sworn, state:</p>
<ol style="line-height:1.7;">
<li>I am a peace officer / private special function officer commissioned in the State of Utah and assigned to Rocky Mountain Protective Group.</li>
<li>This affidavit is made in support of charges against <strong>{{defendant}}</strong> for the offense(s) of <strong>{{offense}}</strong>, RMPG Case #{{case_number}}.</li>
<li>The facts establishing probable cause are as follows:</li>
</ol>
<div style="border-left:3px solid #d4a017;padding-left:12px;min-height:160px;">&nbsp;</div>
<p>Based on the foregoing facts, I have probable cause to believe that <strong>{{defendant}}</strong> committed the offense(s) listed above.</p>
<p>I declare under criminal penalty of the State of Utah that the foregoing is true and correct.</p>${SIG_BLOCK}
<p style="font-size:10px;color:#666;margin-top:20px;">Subscribed and sworn before me this ____ day of ______________, ______.</p>
<p style="font-size:10px;color:#666;">_____________________________ &nbsp; Notary / Magistrate</p>`,
  },
  {
    id: 'legal-search-warrant-app', name: 'Search Warrant Application', category: 'legal-warrant',
    description: 'Application + affidavit for a search warrant',
    tags: ['search-warrant', 'application'],
    statutes: ['77-23-201', '77-23-203', '77-23-210'],
    fields: [
      { key: 'affiant', label: 'Affiant', source: 'user' },
      { key: 'premises', label: 'Premises / Item to Search', source: 'manual' },
      { key: 'items_sought', label: 'Items Sought', source: 'manual' },
      { key: 'offense', label: 'Offense', source: 'manual' },
    ],
    content: `${AGENCY_HEADER}${title('APPLICATION FOR SEARCH WARRANT')}
<p style="text-align:center;">IN THE THIRD JUDICIAL DISTRICT COURT — SALT LAKE COUNTY</p>
${tbl(row2('<strong>Affiant:</strong> {{affiant}}', '<strong>Offense:</strong> {{offense}}') + row1('<strong>Premises:</strong> {{premises}}') + row1('<strong>Items Sought:</strong> {{items_sought}}'))}
${statutes(['Utah R. Crim. P. 40', '77-23-203 — particularity'])}
${section('1. AFFIANT QUALIFICATIONS')}<p>&nbsp;</p>
${section('2. FACTS ESTABLISHING PROBABLE CAUSE')}<p>&nbsp;</p>
${section('3. NEXUS TO PREMISES')}<p>&nbsp;</p>
${section('4. STALENESS')}<p>&nbsp;</p>
${section('5. REQUEST FOR NIGHT-SERVICE / NO-KNOCK (if applicable)')}<p>&nbsp;</p>
<p>WHEREFORE, affiant requests issuance of a warrant authorizing search of the above-described premises and seizure of the items sought.</p>${SIG_BLOCK}`,
  },
  {
    id: 'legal-warrant-return', name: 'Warrant Return &amp; Inventory', category: 'legal-warrant',
    description: 'Return of executed warrant with seized-item inventory',
    tags: ['warrant', 'return', 'inventory'],
    statutes: ['77-23-205'],
    fields: [
      { key: 'warrant_no', label: 'Warrant #', source: 'manual' },
      { key: 'executed', label: 'Date/Time Executed', source: 'manual' },
      { key: 'premises', label: 'Premises', source: 'manual' },
    ],
    content: `${AGENCY_HEADER}${title('WARRANT RETURN &amp; INVENTORY')}${tbl(row2('<strong>Warrant #:</strong> {{warrant_no}}', '<strong>Executed:</strong> {{executed}}') + row1('<strong>Premises:</strong> {{premises}}'))}
${section('INVENTORY OF ITEMS SEIZED')}<table style="width:100%;border-collapse:collapse;font-size:11px;"><tr style="background:#f0f0f0;"><th style="border:1px solid #333;padding:4px;">#</th><th style="border:1px solid #333;padding:4px;">Description</th><th style="border:1px solid #333;padding:4px;">Location Found</th></tr>${Array(10).fill(0).map((_,i)=>`<tr><td style="border:1px solid #333;padding:4px;">${i+1}</td><td style="border:1px solid #333;padding:4px;height:18px;">&nbsp;</td><td style="border:1px solid #333;padding:4px;">&nbsp;</td></tr>`).join('')}</table>
<p>A copy of this inventory was left at the premises / served on ______________ on the date above.</p>${SIG_BLOCK}`,
  },
  {
    id: 'legal-arrest-warrant-app', name: 'Arrest Warrant Application', category: 'legal-warrant',
    description: 'Application + affidavit for an arrest warrant',
    tags: ['arrest', 'warrant'],
    statutes: ['77-7-5'],
    fields: [{ key: 'subject', label: 'Subject', source: 'manual' }, { key: 'offense', label: 'Offense', source: 'manual' }, { key: 'dob', label: 'DOB', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('APPLICATION FOR ARREST WARRANT')}${tbl(row2('<strong>Subject:</strong> {{subject}}', '<strong>DOB:</strong> {{dob}}') + row1('<strong>Offense:</strong> {{offense}}'))}
${section('PROBABLE CAUSE')}<p>&nbsp;</p>${section('PRIOR HISTORY / FLIGHT RISK')}<p>&nbsp;</p>${section('REQUESTED BAIL')}<p>$ ____</p>${SIG_BLOCK}`,
  },
  {
    id: 'legal-subpoena-response', name: 'Subpoena Response', category: 'legal-court',
    description: 'Cover letter + records production response',
    tags: ['subpoena', 'records', 'response'],
    fields: [{ key: 'court', label: 'Court', source: 'manual' }, { key: 'case', label: 'Court Case #', source: 'manual' }, { key: 'requestor', label: 'Requesting Party', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('SUBPOENA RESPONSE')}<p>To: {{requestor}}</p>
${tbl(row2('<strong>Court:</strong> {{court}}', '<strong>Case #:</strong> {{case}}'))}
<p>In response to your subpoena duces tecum, please find enclosed the following:</p>
<ul><li>☐ Incident report(s)</li><li>☐ Body-camera footage</li><li>☐ CAD audit log</li><li>☐ 911 audio</li><li>☐ Officer notes</li><li>☐ Other: ________</li></ul>
${section('REDACTIONS')}<p>Personally identifiable information of minors and confidential informants has been redacted per Utah Code §63G-2-302/305.</p>
${section('CUSTODIAN AFFIDAVIT')}<p>I certify that the enclosed records are true and correct copies maintained in the regular course of business by Rocky Mountain Protective Group.</p>${SIG_BLOCK}`,
  },
  {
    id: 'legal-discovery', name: 'Discovery Response Index', category: 'legal-discovery',
    description: 'Bates-numbered discovery production index',
    tags: ['discovery', 'bates', 'production'],
    fields: [{ key: 'case', label: 'Case #', source: 'manual' }, { key: 'defendant', label: 'Defendant', source: 'manual' }, { key: 'bates_range', label: 'Bates Range', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('DISCOVERY PRODUCTION INDEX')}${tbl(row2('<strong>Case #:</strong> {{case}}', '<strong>Defendant:</strong> {{defendant}}') + row1('<strong>Bates Range:</strong> {{bates_range}}'))}
<table style="width:100%;border-collapse:collapse;font-size:11px;"><tr style="background:#f0f0f0;"><th style="border:1px solid #333;padding:4px;">Bates#</th><th style="border:1px solid #333;padding:4px;">Description</th><th style="border:1px solid #333;padding:4px;">Source</th></tr>${Array(12).fill(0).map(()=>`<tr><td style="border:1px solid #333;padding:4px;">&nbsp;</td><td style="border:1px solid #333;padding:4px;">&nbsp;</td><td style="border:1px solid #333;padding:4px;">&nbsp;</td></tr>`).join('')}</table>${SIG_BLOCK}`,
  },
  {
    id: 'legal-brady-disclosure', name: 'Brady / Giglio Disclosure', category: 'legal-discovery',
    description: 'Disclosure of exculpatory / impeachment material to prosecution',
    tags: ['brady', 'giglio', 'exculpatory'],
    statutes: ['Brady v. Maryland, 373 U.S. 83'],
    fields: [{ key: 'case', label: 'Case #', source: 'manual' }, { key: 'da', label: 'DA Attorney', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('BRADY / GIGLIO DISCLOSURE')}${CONFIDENTIAL}${tbl(row2('<strong>Case #:</strong> {{case}}', '<strong>DA:</strong> {{da}}'))}
${section('MATERIAL DISCLOSED')}<p>&nbsp;</p>${section('RELEVANCE TO ELEMENTS OF OFFENSE / WITNESS CREDIBILITY')}<p>&nbsp;</p>${section('SOURCE / CUSTODY')}<p>&nbsp;</p>${SIG_BLOCK}`,
  },
  {
    id: 'legal-officer-court-prep', name: 'Officer Court Preparation Memo', category: 'legal-court',
    description: 'Pre-trial prep summary for testifying officer',
    tags: ['court', 'prep', 'trial'],
    fields: [{ key: 'case', label: 'Case #', source: 'manual' }, { key: 'court_date', label: 'Court Date', source: 'manual' }, { key: 'officer', label: 'Officer', source: 'user' }],
    content: `${AGENCY_HEADER}${title('COURT PREPARATION MEMO')}${tbl(row2('<strong>Case #:</strong> {{case}}', '<strong>Court Date:</strong> {{court_date}}') + row1('<strong>Officer:</strong> {{officer}}'))}
${section('KEY FACTS')}<p>&nbsp;</p>${section('ANTICIPATED CROSS')}<p>&nbsp;</p>${section('REPORTS / EVIDENCE TO REVIEW')}<p>&nbsp;</p>${section('CHAIN OF CUSTODY')}<p>&nbsp;</p>${SIG_BLOCK}`,
  },
  {
    id: 'legal-chain-of-custody', name: 'Chain of Custody Form', category: 'legal-discovery',
    description: 'Standalone chain-of-custody log for an item',
    tags: ['chain-of-custody', 'evidence'],
    fields: [{ key: 'case', label: 'Case #', source: 'manual' }, { key: 'item', label: 'Item', source: 'manual' }, { key: 'item_no', label: 'Item #', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('CHAIN OF CUSTODY')}${tbl(row2('<strong>Case #:</strong> {{case}}', '<strong>Item #:</strong> {{item_no}}') + row1('<strong>Description:</strong> {{item}}'))}
<table style="width:100%;border-collapse:collapse;font-size:11px;"><tr style="background:#f0f0f0;"><th style="border:1px solid #333;padding:4px;">Date/Time</th><th style="border:1px solid #333;padding:4px;">Released By</th><th style="border:1px solid #333;padding:4px;">Received By</th><th style="border:1px solid #333;padding:4px;">Purpose</th></tr>${Array(10).fill(0).map(()=>`<tr><td style="border:1px solid #333;padding:4px;height:18px;">&nbsp;</td><td style="border:1px solid #333;padding:4px;">&nbsp;</td><td style="border:1px solid #333;padding:4px;">&nbsp;</td><td style="border:1px solid #333;padding:4px;">&nbsp;</td></tr>`).join('')}</table>${SIG_BLOCK}`,
  },
  {
    id: 'legal-evidence-receipt', name: 'Evidence Receipt to Lab', category: 'legal-discovery',
    description: 'Transmittal of evidence to crime lab',
    tags: ['lab', 'evidence', 'transmittal'],
    fields: [{ key: 'case', label: 'Case #', source: 'manual' }, { key: 'lab', label: 'Lab', source: 'manual' }, { key: 'analyses', label: 'Requested Analyses', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('EVIDENCE TRANSMITTAL TO LAB')}${tbl(row2('<strong>Case #:</strong> {{case}}', '<strong>Lab:</strong> {{lab}}') + row1('<strong>Requested:</strong> {{analyses}}'))}
${section('ITEMS SUBMITTED')}<p>&nbsp;</p>${section('PACKAGING / SEAL')}<p>Tamper-evident seal #: ____</p>${SIG_BLOCK}`,
  },
  {
    id: 'legal-stalking-injunction-service', name: 'Civil Stalking Injunction Service', category: 'legal-court',
    description: 'Service of civil stalking injunction per Utah Code 78B-7-7',
    tags: ['stalking', 'injunction', 'civil', 'service'],
    statutes: ['78B-7-701'],
    fields: [{ key: 'subject', label: 'Respondent', source: 'manual' }, { key: 'order_no', label: 'Order #', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('CIVIL STALKING INJUNCTION SERVICE')}${tbl(row2('<strong>Respondent:</strong> {{subject}}', '<strong>Order #:</strong> {{order_no}}'))}
<p>I personally served a copy of the above-numbered civil stalking injunction on the respondent. Respondent was advised that violation is a class A misdemeanor under Utah Code §76-5-106.5 and may result in arrest.</p>${SIG_BLOCK}`,
  },
  {
    id: 'legal-protective-order-service', name: 'Protective Order Service', category: 'legal-court',
    description: 'Service of cohabitant or child protective order',
    tags: ['protective-order', 'cpo', 'service'],
    statutes: ['78B-7-301', '78B-7-201'],
    fields: [{ key: 'subject', label: 'Respondent', source: 'manual' }, { key: 'order_no', label: 'Order #', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('PROTECTIVE ORDER SERVICE')}${tbl(row2('<strong>Respondent:</strong> {{subject}}', '<strong>Order #:</strong> {{order_no}}'))}
<p>I personally served a copy of the above-numbered protective order on the respondent at the date/time above. The respondent was advised in summary form of the order&rsquo;s contents.</p>${SIG_BLOCK}`,
  },
  {
    id: 'legal-recordings-release', name: 'Audio/Video Release Authorization', category: 'legal-discovery',
    description: 'Body-cam / dispatch audio release per GRAMA',
    tags: ['grama', 'release', 'audio', 'video'],
    statutes: ['63G-2-202'],
    fields: [{ key: 'requestor', label: 'Requestor', source: 'manual' }, { key: 'case', label: 'Case #', source: 'manual' }, { key: 'description', label: 'Description', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('A/V RELEASE AUTHORIZATION')}${tbl(row2('<strong>Requestor:</strong> {{requestor}}', '<strong>Case #:</strong> {{case}}') + row1('<strong>Description:</strong> {{description}}'))}
${section('REDACTIONS PERFORMED')}<p>☐ Minors&rsquo; faces ☐ Bystanders ☐ Officer tactical positions ☐ Other</p>
${section('GRAMA CLASSIFICATION')}<p>☐ Public ☐ Private ☐ Controlled — Reason:</p>${SIG_BLOCK}`,
  },
  {
    id: 'legal-grama-response', name: 'GRAMA Request Response', category: 'legal-court',
    description: 'Utah GRAMA records request response letter',
    tags: ['grama', 'records', 'request'],
    statutes: ['63G-2-204'],
    fields: [{ key: 'requestor', label: 'Requestor', source: 'manual' }, { key: 'request_no', label: 'Request #', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('GRAMA REQUEST RESPONSE')}${tbl(row2('<strong>Requestor:</strong> {{requestor}}', '<strong>Request #:</strong> {{request_no}}'))}
<p>Pursuant to the Government Records Access and Management Act, your request has been processed as follows:</p>
<p>☐ <strong>Granted</strong> — records enclosed</p>
<p>☐ <strong>Partially granted</strong> — see redactions and classification log</p>
<p>☐ <strong>Denied</strong> — basis: §63G-2-305 (___) &nbsp; You may appeal within 30 days.</p>${SIG_BLOCK}`,
  },
  {
    id: 'legal-civil-cite', name: 'Civil Compromise / Mediation Memo', category: 'legal-court',
    description: 'Memo memorializing civil compromise of minor offense',
    tags: ['civil-compromise', 'mediation'],
    statutes: ['77-2a-1'],
    fields: [{ key: 'parties', label: 'Parties', source: 'manual' }, { key: 'case', label: 'Case #', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('CIVIL COMPROMISE MEMO')}${tbl(row2('<strong>Parties:</strong> {{parties}}', '<strong>Case #:</strong> {{case}}'))}
${section('TERMS OF COMPROMISE')}<p>&nbsp;</p>${section('CONSIDERATION')}<p>&nbsp;</p>${section('COURT NOTIFICATION')}<p>&nbsp;</p>${DUAL_SIG_BLOCK}`,
  },
  {
    id: 'legal-immunity-grant', name: 'Use Immunity Grant Notice', category: 'legal-court',
    description: 'Witness use-immunity notice for compelled statement',
    tags: ['immunity', 'compelled-statement', 'garrity'],
    fields: [{ key: 'witness', label: 'Witness', source: 'manual' }, { key: 'case', label: 'Case #', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('USE IMMUNITY NOTICE')}${tbl(row2('<strong>Witness:</strong> {{witness}}', '<strong>Case #:</strong> {{case}}'))}
<p>You are advised that any statement you give in this matter cannot be used directly against you in a criminal prosecution, except as it may form the basis for a charge of perjury or obstruction.</p>${SIG_BLOCK}`,
  },
  {
    id: 'legal-extradition', name: 'Extradition / Interstate Transport', category: 'legal-court',
    description: 'Extradition packet cover memo',
    tags: ['extradition', 'transport', 'interstate'],
    statutes: ['77-30-1'],
    fields: [{ key: 'subject', label: 'Subject', source: 'manual' }, { key: 'from_state', label: 'From State', source: 'manual' }, { key: 'to_state', label: 'To State', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('EXTRADITION / TRANSPORT')}${tbl(row2('<strong>Subject:</strong> {{subject}}', '<strong>From:</strong> {{from_state}}') + row1('<strong>To:</strong> {{to_state}}'))}
${section('CHARGES')}<p>&nbsp;</p>${section('WAIVER OF EXTRADITION')}<p>☐ Waived ☐ Contested (Governor&rsquo;s warrant required)</p>${section('TRANSPORT PLAN')}<p>&nbsp;</p>${SIG_BLOCK}`,
  },
  {
    id: 'legal-charging-decision', name: 'Charging Decision Memo (to DA)', category: 'legal-court',
    description: 'Officer memo to prosecutor recommending charges',
    tags: ['charging', 'da', 'prosecutor'],
    fields: [{ key: 'case', label: 'Case #', source: 'manual' }, { key: 'defendant', label: 'Defendant', source: 'manual' }, { key: 'recommended', label: 'Recommended Charges', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('CHARGING DECISION MEMO')}${tbl(row2('<strong>Case #:</strong> {{case}}', '<strong>Defendant:</strong> {{defendant}}') + row1('<strong>Recommended Charges:</strong> {{recommended}}'))}
${section('ELEMENTS OF EACH CHARGE')}<p>&nbsp;</p>${section('SUFFICIENT EVIDENCE PER ELEMENT')}<p>&nbsp;</p>${section('ANTICIPATED DEFENSES')}<p>&nbsp;</p>${section('VICTIM IMPACT')}<p>&nbsp;</p>${SIG_BLOCK}`,
  },
  {
    id: 'legal-declination', name: 'Case Declination / Inactivation', category: 'legal-court',
    description: 'Memo closing case with insufficient evidence',
    tags: ['declination', 'inactivation', 'closed'],
    fields: [{ key: 'case', label: 'Case #', source: 'manual' }, { key: 'reason', label: 'Reason for Declination', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('CASE DECLINATION')}${tbl(row2('<strong>Case #:</strong> {{case}}', '<strong>Reason:</strong> {{reason}}'))}
${section('INVESTIGATIVE STEPS TAKEN')}<p>&nbsp;</p>${section('EVIDENTIARY GAPS')}<p>&nbsp;</p>${section('REACTIVATION TRIGGERS')}<p>Case may be reactivated upon: ____________</p>${section('VICTIM NOTIFICATION')}<p>Notified ☐ Date: ____ Via: ____</p>${SIG_BLOCK}`,
  },
  {
    id: 'legal-court-order-service', name: 'Court Order Service Return', category: 'legal-court',
    description: 'Proof of service for any court order',
    tags: ['service', 'proof', 'court'],
    fields: [{ key: 'subject', label: 'Served Upon', source: 'manual' }, { key: 'order', label: 'Document Served', source: 'manual' }, { key: 'manner', label: 'Manner of Service', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('PROOF OF SERVICE')}${tbl(row2('<strong>Served Upon:</strong> {{subject}}', '<strong>Document:</strong> {{order}}') + row1('<strong>Manner:</strong> {{manner}}'))}
<p>I declare under penalty of perjury under the laws of the State of Utah that the foregoing is true and correct.</p>${SIG_BLOCK}`,
  },
];
