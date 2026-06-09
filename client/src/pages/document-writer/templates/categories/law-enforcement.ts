import type { DocumentTemplate } from '../../types';
import {
  AGENCY_HEADER, CONFIDENTIAL, title, section, tbl, row2, row1,
  SIG_BLOCK, DUAL_SIG_BLOCK, statutes, commonFields, caseHeader, narrative,
  F_CASE, F_INC_DT, F_LOC, F_OFFICER, F_BADGE,
} from '../_shared';

// 35 Utah law-enforcement specialty templates.
// Statutes pulled from Utah Code Title 76 (criminal), 41 (motor vehicle),
// 53 (public safety), 62A (juveniles).
export const LE_TEMPLATES: DocumentTemplate[] = [
  // ──────────────── TRAFFIC ────────────────
  {
    id: 'le-traffic-stop', name: 'Traffic Stop Report', category: 'le-traffic',
    description: 'Documents a traffic stop — basis, contact, outcome',
    tags: ['traffic', 'stop', 'vehicle', 'citation'],
    statutes: ['76-8-301', '41-6a-401'],
    fields: commonFields([
      { key: 'driver_name', label: 'Driver Name', source: 'manual' },
      { key: 'driver_dl', label: "Driver's License #", source: 'manual' },
      { key: 'vehicle_plate', label: 'License Plate', source: 'manual' },
      { key: 'vehicle_desc', label: 'Vehicle (Y/M/M)', source: 'manual' },
      { key: 'violation', label: 'Violation Observed', source: 'manual' },
      { key: 'outcome', label: 'Outcome', source: 'manual' },
    ]),
    content: `${AGENCY_HEADER}${title('TRAFFIC STOP REPORT')}${statutes(['76-8-301', '41-6a-401'])}
${caseHeader()}
${tbl(row2('<strong>Driver:</strong> {{driver_name}}', '<strong>DL #:</strong> {{driver_dl}}') +
      row2('<strong>Plate:</strong> {{vehicle_plate}}', '<strong>Vehicle:</strong> {{vehicle_desc}}') +
      row2('<strong>Violation:</strong> {{violation}}', '<strong>Outcome:</strong> {{outcome}}'))}
${section('BASIS FOR STOP')}<p>Probable cause / reasonable suspicion observed:</p><p>&nbsp;</p>
${section('DRIVER INTERACTION')}<p>Identification verified ☐ &nbsp; Insurance verified ☐ &nbsp; Registration valid ☐</p><p>&nbsp;</p>
${section('PASSENGERS')}<p>&nbsp;</p>
${section('OUTCOME')}<p>☐ Verbal warning &nbsp; ☐ Written warning &nbsp; ☐ Citation (#____________) &nbsp; ☐ Arrest &nbsp; ☐ Tow</p>
${narrative()}${SIG_BLOCK}`,
  },
  {
    id: 'le-dui', name: 'DUI Investigation Report', category: 'le-traffic',
    description: 'Suspected DUI — SFSTs, PBT, chemical test',
    tags: ['dui', 'dwi', 'impaired', 'alcohol', 'drugs', 'sft'],
    statutes: ['41-6a-502', '41-6a-517', '41-6a-520'],
    fields: commonFields([
      { key: 'driver_name', label: 'Driver Name', source: 'manual' },
      { key: 'driver_dob', label: 'Driver DOB', source: 'manual' },
      { key: 'bac', label: 'BAC Result', source: 'manual' },
    ]),
    content: `${AGENCY_HEADER}${title('DUI INVESTIGATION', '#7a2418')}${statutes(['41-6a-502', '41-6a-517'])}
${caseHeader()}
${tbl(row2('<strong>Driver:</strong> {{driver_name}}', '<strong>DOB:</strong> {{driver_dob}}') + row2('<strong>BAC:</strong> {{bac}}', '<strong>Method:</strong>'))}
${section('OBSERVATIONS — DRIVING')}<p>Weaving ☐ Speed ☐ Wide turn ☐ Failure to maintain lane ☐ Other: ____________</p>
${section('OBSERVATIONS — PERSON')}<p>Odor of alcohol ☐ &nbsp; Slurred speech ☐ &nbsp; Bloodshot eyes ☐ &nbsp; Unsteady ☐</p>
${section('STANDARDIZED FIELD SOBRIETY TESTS')}
<table style="width:100%;border-collapse:collapse;font-size:11px;">
<tr style="background:#f0f0f0;"><th style="border:1px solid #333;padding:4px;">Test</th><th style="border:1px solid #333;padding:4px;">Clues</th><th style="border:1px solid #333;padding:4px;">Result</th></tr>
<tr><td style="border:1px solid #333;padding:4px;">HGN</td><td style="border:1px solid #333;padding:4px;">/6</td><td style="border:1px solid #333;padding:4px;">&nbsp;</td></tr>
<tr><td style="border:1px solid #333;padding:4px;">Walk &amp; Turn</td><td style="border:1px solid #333;padding:4px;">/8</td><td style="border:1px solid #333;padding:4px;">&nbsp;</td></tr>
<tr><td style="border:1px solid #333;padding:4px;">One Leg Stand</td><td style="border:1px solid #333;padding:4px;">/4</td><td style="border:1px solid #333;padding:4px;">&nbsp;</td></tr>
</table>
${section('CHEMICAL TEST')}<p>Implied consent read ☐ &nbsp;&nbsp; Test: ☐ Breath ☐ Blood ☐ Refused</p>
${narrative('Upon contact I observed...')}${SIG_BLOCK}`,
  },
  {
    id: 'le-citation', name: 'Citation / Notice to Appear', category: 'le-traffic',
    description: 'Misdemeanor citation in lieu of arrest',
    tags: ['citation', 'ticket'],
    statutes: ['77-7-18', '77-7-19'],
    fields: commonFields([
      { key: 'defendant', label: 'Defendant', source: 'manual' },
      { key: 'charges', label: 'Charges', source: 'manual' },
      { key: 'court', label: 'Court', source: 'manual' },
      { key: 'court_date', label: 'Court Date', source: 'manual' },
    ]),
    content: `${AGENCY_HEADER}${title('NOTICE TO APPEAR')}${caseHeader()}
${tbl(row2('<strong>Defendant:</strong> {{defendant}}', '<strong>Charges:</strong> {{charges}}') +
      row2('<strong>Court:</strong> {{court}}', '<strong>Appear by:</strong> {{court_date}}'))}
${section('ACKNOWLEDGEMENT')}<p>I promise to appear at the time and place stated above. Failure to appear may result in a warrant for my arrest.</p>${DUAL_SIG_BLOCK}`,
  },
  {
    id: 'le-accident', name: 'Traffic Accident Report', category: 'le-traffic',
    description: 'Crash investigation with vehicles, injuries, diagram',
    tags: ['crash', 'accident', 'collision', 'mvc'],
    statutes: ['41-6a-401', '41-12a-101'],
    fields: commonFields([
      { key: 'v1_driver', label: 'Vehicle 1 Driver', source: 'manual' },
      { key: 'v2_driver', label: 'Vehicle 2 Driver', source: 'manual' },
      { key: 'weather', label: 'Weather/Roadway', source: 'manual' },
    ]),
    content: `${AGENCY_HEADER}${title('TRAFFIC ACCIDENT REPORT')}${caseHeader()}
${tbl(row2('<strong>V1 Driver:</strong> {{v1_driver}}', '<strong>V2 Driver:</strong> {{v2_driver}}') + row1('<strong>Weather / Roadway:</strong> {{weather}}'))}
${section('VEHICLE 1')}<p>Plate / Y/M/M / Damage:</p><p>&nbsp;</p>
${section('VEHICLE 2')}<p>&nbsp;</p>
${section('INJURIES')}<p>&nbsp;</p>
${section('DIAGRAM')}<p style="border:1px dashed #999;height:160px;text-align:center;color:#aaa;line-height:160px;">[Insert scene diagram or photo]</p>
${narrative()}${SIG_BLOCK}`,
  },
  {
    id: 'le-tow', name: 'Vehicle Tow / Impound', category: 'le-traffic',
    description: 'Tow authorization, inventory, release',
    tags: ['tow', 'impound', 'inventory'],
    statutes: ['41-6a-1406', '72-9-603'],
    fields: commonFields([
      { key: 'plate', label: 'Plate', source: 'manual' },
      { key: 'tow_company', label: 'Tow Company', source: 'manual' },
      { key: 'tow_reason', label: 'Reason', source: 'manual' },
    ]),
    content: `${AGENCY_HEADER}${title('VEHICLE TOW / IMPOUND')}${caseHeader()}
${tbl(row2('<strong>Plate:</strong> {{plate}}', '<strong>Tow Co.:</strong> {{tow_company}}') + row1('<strong>Reason:</strong> {{tow_reason}}'))}
${section('INVENTORY')}<table style="width:100%;border-collapse:collapse;font-size:11px;"><tr style="background:#f0f0f0;"><th style="border:1px solid #333;padding:4px;">Location</th><th style="border:1px solid #333;padding:4px;">Item</th></tr><tr><td style="border:1px solid #333;padding:4px;">&nbsp;</td><td style="border:1px solid #333;padding:4px;">&nbsp;</td></tr></table>
${section('CONDITION ON RELEASE')}<p>&nbsp;</p>${SIG_BLOCK}`,
  },

  // ──────────────── DV ────────────────
  {
    id: 'le-dv', name: 'Domestic Violence Report', category: 'le-dv',
    description: 'DV-specific reporting — required elements per Utah Code',
    tags: ['dv', 'domestic', 'cohabitant', 'victim'],
    statutes: ['77-36-2.1', '77-36-2.5', '77-36-1'],
    fields: commonFields([
      { key: 'victim', label: 'Victim', source: 'manual' },
      { key: 'suspect', label: 'Suspect', source: 'manual' },
      { key: 'relationship', label: 'Relationship', source: 'manual' },
    ]),
    content: `${AGENCY_HEADER}${title('DOMESTIC VIOLENCE REPORT', '#7a2418')}${statutes(['77-36-2.1 (mandatory arrest)', '77-36-1 (cohabitant)'])}
${caseHeader()}
${tbl(row2('<strong>Victim:</strong> {{victim}}', '<strong>Suspect:</strong> {{suspect}}') + row1('<strong>Cohabitant Relationship:</strong> {{relationship}}'))}
${section('PREDOMINANT AGGRESSOR DETERMINATION')}<p>Comparative injury, defensive wounds, history, prior threats, fear:</p><p>&nbsp;</p>
${section('VICTIM STATEMENT')}<p>Victim was Mirandized of right to refuse statement: ☐</p><p>&nbsp;</p>
${section('CHILDREN PRESENT')}<p>Names / DOB / observed: ____________________________________________</p>
${section('LETHALITY ASSESSMENT (LAP)')}<p>Score: ____ &nbsp; High danger ☐ &nbsp; Hotline contacted ☐</p>
${section('VICTIM RIGHTS NOTICE PROVIDED')}<p>☐ Spanish ☐ English &nbsp; ☐ Victim shelter info given &nbsp; ☐ Pro-arrest policy explained</p>
${section('EVIDENCE')}<p>Photos taken ☐ &nbsp;Body cam ☐ &nbsp;911 audio ☐ &nbsp;Medical release ☐</p>
${narrative()}${SIG_BLOCK}`,
  },
  {
    id: 'le-dv-lap', name: 'DV Lethality Assessment (LAP)', category: 'le-dv',
    description: 'Standalone Lethality Assessment Protocol screener',
    tags: ['dv', 'lap', 'lethality'],
    fields: commonFields([{ key: 'victim', label: 'Victim', source: 'manual' }]),
    content: `${AGENCY_HEADER}${title('LETHALITY ASSESSMENT — LAP')}
<p><strong>Victim:</strong> {{victim}} &nbsp;&nbsp; <strong>Case:</strong> {{case_number}}</p>
<ol style="font-size:11px;line-height:1.7;">
<li>Has he/she ever used a weapon against you or threatened you with a weapon? ☐ Y ☐ N</li>
<li>Has he/she threatened to kill you or your children? ☐ Y ☐ N</li>
<li>Do you think he/she might try to kill you? ☐ Y ☐ N</li>
<li>Does he/she have a gun or can he/she easily get one? ☐ Y ☐ N</li>
<li>Has he/she ever tried to choke you? ☐ Y ☐ N</li>
<li>Is he/she violently or constantly jealous, or does he/she control most of your daily activities? ☐ Y ☐ N</li>
<li>Have you left him/her or separated after living together or being married? ☐ Y ☐ N</li>
<li>Is he/she unemployed? ☐ Y ☐ N</li>
<li>Has he/she ever tried to kill himself/herself? ☐ Y ☐ N</li>
<li>Do you have a child that he/she knows is not his/hers? ☐ Y ☐ N</li>
<li>Does he/she follow or spy on you or leave threatening messages? ☐ Y ☐ N</li>
</ol>
<p><strong>Outcome:</strong> ☐ High Danger — hotline call placed &nbsp; ☐ Below screen &nbsp; ☐ Refused</p>${SIG_BLOCK}`,
  },
  {
    id: 'le-dv-no-contact', name: 'DV No-Contact Order Service', category: 'le-dv',
    description: 'Service / acknowledgment of pre-trial no-contact order',
    tags: ['dv', 'no-contact', 'protective'],
    statutes: ['77-36-2.5', '77-36-2.6'],
    fields: commonFields([{ key: 'subject', label: 'Subject Served', source: 'manual' }]),
    content: `${AGENCY_HEADER}${title('NO-CONTACT ORDER SERVICE')}${caseHeader()}
<p>I served the above pre-trial no-contact order on <strong>{{subject}}</strong> at the date/time above. Subject was advised that violation is a class A misdemeanor and may result in arrest without warrant.</p>
${DUAL_SIG_BLOCK}`,
  },

  // ──────────────── JUVENILE ────────────────
  {
    id: 'le-juvenile', name: 'Juvenile Contact Report', category: 'le-juvenile',
    description: 'Contact with minor — parent notification, custody',
    tags: ['juvenile', 'minor', 'youth'],
    statutes: ['80-6-201', '78A-6-103'],
    fields: commonFields([
      { key: 'juvenile_name', label: 'Juvenile Name', source: 'manual' },
      { key: 'juvenile_dob', label: 'Juvenile DOB', source: 'manual' },
      { key: 'parent', label: 'Parent / Guardian', source: 'manual' },
    ]),
    content: `${AGENCY_HEADER}${title('JUVENILE CONTACT REPORT')}${statutes(['80-6-201', '78A-6-113'])}
${caseHeader()}
${tbl(row2('<strong>Juvenile:</strong> {{juvenile_name}}', '<strong>DOB:</strong> {{juvenile_dob}}') + row1('<strong>Parent/Guardian:</strong> {{parent}}'))}
${section('CIRCUMSTANCES OF CONTACT')}<p>&nbsp;</p>
${section('PARENT/GUARDIAN NOTIFICATION')}<p>Notified at: ____________ via ☐ phone ☐ in-person ☐ unable</p>
${section('DISPOSITION')}<p>☐ Released to parent ☐ Released to DCFS ☐ Detention ☐ Citation/Referral ☐ Other</p>
${section('REFERRALS')}<p>☐ JJYS ☐ DCFS ☐ Mobile crisis ☐ School Resource Officer</p>
${narrative()}${SIG_BLOCK}`,
  },
  {
    id: 'le-runaway', name: 'Runaway / Missing Juvenile', category: 'le-juvenile',
    description: 'Missing juvenile entry, BOLO, AMBER criteria check',
    tags: ['runaway', 'missing', 'amber', 'bola'],
    statutes: ['62A-15-1101', '53-10-203'],
    fields: commonFields([
      { key: 'juvenile_name', label: 'Juvenile Name', source: 'manual' },
      { key: 'last_seen', label: 'Last Seen Date/Time/Place', source: 'manual' },
      { key: 'clothing', label: 'Clothing', source: 'manual' },
    ]),
    content: `${AGENCY_HEADER}${title('MISSING JUVENILE REPORT', '#7a2418')}${caseHeader()}
${tbl(row2('<strong>Juvenile:</strong> {{juvenile_name}}', '<strong>Last seen:</strong> {{last_seen}}') + row1('<strong>Clothing:</strong> {{clothing}}'))}
${section('AMBER ALERT CRITERIA')}<p>☐ Confirmed abduction ☐ Imminent danger ☐ Sufficient descriptive info ☐ Under 18 — All four required to activate.</p>
${section('NCIC ENTRY')}<p>NCIC# ____________ &nbsp; Entered by: ____________ &nbsp; Time: ____________</p>
${section('SEARCH AREAS / KNOWN ASSOCIATES')}<p>&nbsp;</p>${narrative()}${SIG_BLOCK}`,
  },
  {
    id: 'le-srO-incident', name: 'School Resource Officer Incident', category: 'le-juvenile',
    description: 'SRO incident on campus — student, staff, parent notification',
    tags: ['sro', 'school', 'student'],
    fields: commonFields([
      { key: 'school', label: 'School', source: 'manual' },
      { key: 'student', label: 'Student', source: 'manual' },
    ]),
    content: `${AGENCY_HEADER}${title('SRO INCIDENT REPORT')}${caseHeader()}
${tbl(row2('<strong>School:</strong> {{school}}', '<strong>Student:</strong> {{student}}'))}
${section('CIRCUMSTANCES')}<p>&nbsp;</p>${section('ADMINISTRATION NOTIFIED')}<p>Name / Time: ____________</p>${section('PARENT NOTIFICATION')}<p>&nbsp;</p>${section('OUTCOME')}<p>☐ Discipline only ☐ Citation ☐ Arrest ☐ Welfare check</p>${SIG_BLOCK}`,
  },

  // ──────────────── INVESTIGATION ────────────────
  {
    id: 'le-suspect-interview', name: 'Suspect Interview', category: 'le-investigation',
    description: 'Custodial / non-custodial interview, Miranda, recordings',
    tags: ['interview', 'miranda', 'suspect'],
    statutes: ['77-7-22'],
    fields: commonFields([{ key: 'subject', label: 'Subject', source: 'manual' }]),
    content: `${AGENCY_HEADER}${title('SUSPECT INTERVIEW')}${caseHeader()}
<p><strong>Subject:</strong> {{subject}}</p>
${section('STATUS')}<p>☐ Custodial &nbsp; ☐ Non-custodial &nbsp; Recording: ☐ Audio ☐ Video ☐ Both</p>
${section('MIRANDA')}<p>Read at ____________ &nbsp; ☐ Waived ☐ Invoked &nbsp; Written waiver ☐</p>
${section('SUMMARY')}<p>&nbsp;</p>${section('VERBATIM EXCERPTS')}<blockquote>&nbsp;</blockquote>${SIG_BLOCK}`,
  },
  {
    id: 'le-witness', name: 'Witness Statement', category: 'le-investigation',
    description: 'Voluntary witness statement form',
    tags: ['witness', 'statement'],
    fields: commonFields([{ key: 'witness', label: 'Witness', source: 'manual' }]),
    content: `${AGENCY_HEADER}${title('WITNESS STATEMENT')}${caseHeader()}
<p><strong>Witness:</strong> {{witness}} &nbsp;&nbsp; <strong>Contact:</strong> ____________</p>
<p style="font-size:10px;color:#666;">I make this statement freely and voluntarily, knowing that I may be called to testify under oath as to its contents.</p>
<div style="border:1px solid #333;min-height:280px;padding:8px;">&nbsp;</div>${DUAL_SIG_BLOCK}`,
  },
  {
    id: 'le-photo-lineup', name: 'Photo Line-Up Admonition', category: 'le-investigation',
    description: 'Pre-lineup admonition + results sheet (double-blind preferred)',
    tags: ['lineup', 'identification', 'photo'],
    fields: commonFields([{ key: 'witness', label: 'Witness', source: 'manual' }]),
    content: `${AGENCY_HEADER}${title('PHOTO LINE-UP ADMONITION')}${caseHeader()}
<p><strong>Witness:</strong> {{witness}}</p>
<ul style="font-size:11px;">
<li>The perpetrator may or may not appear in this set of photos.</li>
<li>You should not assume the officer knows who the suspect is.</li>
<li>If you cannot make an identification, that is also useful.</li>
<li>Please describe in your own words how certain you are.</li>
</ul>
${section('RESULT')}<p>Photo # selected: ____ &nbsp; Confidence statement (verbatim): ____________</p>${DUAL_SIG_BLOCK}`,
  },
  {
    id: 'le-knock-talk', name: 'Knock & Talk', category: 'le-investigation',
    description: 'Documents consensual encounter at residence',
    tags: ['knock-talk', 'consent', 'encounter'],
    fields: commonFields([{ key: 'address', label: 'Address', source: 'manual' }]),
    content: `${AGENCY_HEADER}${title('KNOCK &amp; TALK')}${caseHeader()}
<p><strong>Address:</strong> {{address}}</p>
${section('APPROACH')}<p>Officers walked normal route to front door; no curtilage breach.</p>
${section('CONTACT')}<p>Resident: ____________ &nbsp; Consent to enter: ☐ Y ☐ N (verbal/written)</p>
${narrative()}${SIG_BLOCK}`,
  },
  {
    id: 'le-consent-search', name: 'Consent to Search', category: 'le-investigation',
    description: 'Written consent for vehicle, residence, or person search',
    tags: ['consent', 'search'],
    statutes: ['77-23-30'],
    fields: commonFields([{ key: 'subject', label: 'Subject', source: 'manual' }, { key: 'item', label: 'Place / Item to Search', source: 'manual' }]),
    content: `${AGENCY_HEADER}${title('CONSENT TO SEARCH')}${caseHeader()}
<p>I, <strong>{{subject}}</strong>, give knowing and voluntary consent for officers of the Rocky Mountain Protective Group to search the following: <strong>{{item}}</strong>.</p>
<p>I understand that I have the right to refuse this search and to withdraw consent at any time. No threats, promises, or coercion have been made.</p>
${DUAL_SIG_BLOCK}`,
  },
  {
    id: 'le-confidential-informant', name: 'Confidential Informant Activity', category: 'le-investigation',
    description: 'CI tasking, controlled buy, reliability documentation',
    tags: ['ci', 'informant', 'controlled-buy'], statutes: [],
    fields: commonFields([{ key: 'ci_id', label: 'CI ID', source: 'manual' }]),
    content: `${AGENCY_HEADER}${title('CI ACTIVITY REPORT')}${CONFIDENTIAL}${caseHeader()}
<p><strong>CI ID:</strong> {{ci_id}} &nbsp;&nbsp; <strong>Handler:</strong> {{reporting_officer}}</p>
${section('TASKING')}<p>&nbsp;</p>${section('SEARCH (PRE/POST)')}<p>&nbsp;</p>${section('FUNDS')}<p>Issued: $______ Returned: $______ Recovered evidence: ______</p>${section('AUDIO/VIDEO')}<p>&nbsp;</p>${SIG_BLOCK}`,
  },
  {
    id: 'le-controlled-buy', name: 'Controlled Buy Report', category: 'le-investigation',
    description: 'Narcotics controlled-buy with serialized funds, surveillance',
    tags: ['buy', 'narcotics', 'controlled'],
    fields: commonFields([{ key: 'target', label: 'Target', source: 'manual' }, { key: 'substance', label: 'Substance / Weight', source: 'manual' }]),
    content: `${AGENCY_HEADER}${title('CONTROLLED BUY REPORT')}${CONFIDENTIAL}${caseHeader()}
<p><strong>Target:</strong> {{target}} &nbsp;&nbsp; <strong>Substance:</strong> {{substance}}</p>
${section('PRE-OPERATIONS')}<p>Briefing time ____ &nbsp; Surveillance positions ____</p>
${section('BUY')}<p>Time in ____ Time out ____ &nbsp; Funds: $______ (serials attached) &nbsp; Visual ☐ Audio ☐</p>
${section('POST-OPS')}<p>Evidence inventory below.</p>${narrative()}${SIG_BLOCK}`,
  },

  // ──────────────── PURSUIT / K9 ────────────────
  {
    id: 'le-pursuit', name: 'Vehicle Pursuit Report', category: 'le-pursuit',
    description: 'Emergency vehicle operations pursuit form',
    tags: ['pursuit', 'chase', 'eod'],
    statutes: ['41-6a-212', '53-13-103'],
    fields: commonFields([{ key: 'suspect_vehicle', label: 'Suspect Vehicle', source: 'manual' }, { key: 'duration', label: 'Duration', source: 'manual' }, { key: 'distance', label: 'Distance', source: 'manual' }]),
    content: `${AGENCY_HEADER}${title('VEHICLE PURSUIT REPORT', '#7a2418')}${caseHeader()}
${tbl(row2('<strong>Suspect Vehicle:</strong> {{suspect_vehicle}}', '<strong>Duration:</strong> {{duration}}') + row2('<strong>Distance:</strong> {{distance}}', '<strong>Top Speed:</strong>'))}
${section('JUSTIFICATION')}<p>Reasonable suspicion / probable cause for pursuit:</p><p>&nbsp;</p>
${section('CONDITIONS')}<p>Weather: ____ Traffic: ____ Road: ____ Pedestrians: ____</p>
${section('SUPERVISOR NOTIFICATION')}<p>Notified at ____ &nbsp; Authorized continuation ☐ Terminated ☐</p>
${section('TACTICS USED')}<p>☐ Box-in ☐ TVI / PIT ☐ Spike strips ☐ Channelization ☐ Air support</p>
${section('OUTCOME')}<p>☐ Suspect apprehended ☐ Crash ☐ Pursuit terminated ☐ Lost visual</p>${narrative()}${SIG_BLOCK}`,
  },
  {
    id: 'le-foot-pursuit', name: 'Foot Pursuit Report', category: 'le-pursuit',
    description: 'Foot pursuit — solo vs paired, terrain, outcome',
    tags: ['foot', 'pursuit', 'chase'],
    fields: commonFields([{ key: 'suspect', label: 'Suspect', source: 'manual' }]),
    content: `${AGENCY_HEADER}${title('FOOT PURSUIT REPORT')}${caseHeader()}
<p><strong>Suspect:</strong> {{suspect}}</p>
${section('CIRCUMSTANCES')}<p>Reasonable suspicion / probable cause:</p>
${section('TACTICS')}<p>Solo ☐ Paired ☐ Containment requested ☐ Air ☐ K9 ☐</p>
${section('OUTCOME')}<p>&nbsp;</p>${narrative()}${SIG_BLOCK}`,
  },
  {
    id: 'le-k9', name: 'K-9 Deployment Report', category: 'le-pursuit',
    description: 'K-9 deployment — track, apprehension, sniff, training records',
    tags: ['k9', 'canine', 'sniff', 'track'],
    statutes: ['53-13-103'],
    fields: commonFields([{ key: 'k9_name', label: 'K-9 Name / ID', source: 'manual' }, { key: 'handler', label: 'Handler', source: 'manual' }]),
    content: `${AGENCY_HEADER}${title('K-9 DEPLOYMENT REPORT')}${caseHeader()}
<p><strong>K-9:</strong> {{k9_name}} &nbsp;&nbsp; <strong>Handler:</strong> {{handler}}</p>
${section('TYPE OF DEPLOYMENT')}<p>☐ Article search ☐ Building search ☐ Tracking ☐ Apprehension ☐ Narcotics sniff ☐ Explosives</p>
${section('WARNINGS GIVEN')}<p>Number of warnings: ____ &nbsp; Method: ____ Surrender opportunity: ____</p>
${section('CONTACT / BITE')}<p>Bite ☐ Y ☐ N &nbsp; Duration ____ sec &nbsp; Medical rendered ☐</p>
${section('CERTIFICATION ON FILE')}<p>Last certification date: ____ &nbsp; Discipline: ____</p>${narrative()}${SIG_BLOCK}`,
  },

  // ──────────────── PROPERTY / EVIDENCE ────────────────
  {
    id: 'le-found-property', name: 'Found Property Report', category: 'le-property',
    description: 'Found property intake — owner search, holding period',
    tags: ['found', 'property', 'lost'],
    fields: commonFields([{ key: 'finder', label: 'Finder', source: 'manual' }, { key: 'item', label: 'Item', source: 'manual' }]),
    content: `${AGENCY_HEADER}${title('FOUND PROPERTY')}${caseHeader()}
${tbl(row2('<strong>Finder:</strong> {{finder}}', '<strong>Item:</strong> {{item}}'))}
${section('LOCATION FOUND')}<p>&nbsp;</p>${section('OWNER NOTIFICATION ATTEMPTS')}<p>&nbsp;</p>${section('STORAGE LOCATION')}<p>&nbsp;</p>${SIG_BLOCK}`,
  },
  {
    id: 'le-stolen-property', name: 'Stolen Property Report', category: 'le-property',
    description: 'Theft report with serial numbers for NCIC entry',
    tags: ['theft', 'stolen', 'ncic'],
    statutes: ['76-6-404', '76-6-412'],
    fields: commonFields([{ key: 'victim', label: 'Victim', source: 'manual' }]),
    content: `${AGENCY_HEADER}${title('STOLEN PROPERTY REPORT')}${caseHeader()}
<p><strong>Victim:</strong> {{victim}}</p>
${section('ITEM(S) STOLEN')}<table style="width:100%;border-collapse:collapse;font-size:11px;"><tr style="background:#f0f0f0;"><th style="border:1px solid #333;padding:4px;">Description</th><th style="border:1px solid #333;padding:4px;">Make/Model</th><th style="border:1px solid #333;padding:4px;">Serial #</th><th style="border:1px solid #333;padding:4px;">Value</th></tr><tr><td style="border:1px solid #333;padding:4px;">&nbsp;</td><td style="border:1px solid #333;padding:4px;">&nbsp;</td><td style="border:1px solid #333;padding:4px;">&nbsp;</td><td style="border:1px solid #333;padding:4px;">&nbsp;</td></tr></table>
${section('NCIC ENTRY')}<p>Entered by: ____ &nbsp; NCIC# ____ &nbsp; Time: ____</p>${narrative()}${SIG_BLOCK}`,
  },
  {
    id: 'le-vandalism', name: 'Vandalism / Criminal Mischief', category: 'le-property',
    description: 'Property damage reporting',
    tags: ['vandalism', 'mischief', 'graffiti'],
    statutes: ['76-6-106'],
    fields: commonFields([{ key: 'victim', label: 'Victim', source: 'manual' }, { key: 'damage_value', label: 'Damage Value $', source: 'manual' }]),
    content: `${AGENCY_HEADER}${title('CRIMINAL MISCHIEF')}${caseHeader()}
${tbl(row2('<strong>Victim:</strong> {{victim}}', '<strong>Damage Value:</strong> ${{damage_value}}'))}
${section('DESCRIPTION OF DAMAGE')}<p>&nbsp;</p>${section('PHOTOS')}<p>&nbsp;</p>${narrative()}${SIG_BLOCK}`,
  },
  {
    id: 'le-burglary', name: 'Burglary Report', category: 'le-property',
    description: 'Burglary — point of entry, items taken, prints',
    tags: ['burglary', 'b&e'], statutes: ['76-6-202'],
    fields: commonFields([{ key: 'victim', label: 'Victim', source: 'manual' }, { key: 'address', label: 'Address', source: 'manual' }]),
    content: `${AGENCY_HEADER}${title('BURGLARY REPORT')}${caseHeader()}
${tbl(row2('<strong>Victim:</strong> {{victim}}', '<strong>Address:</strong> {{address}}'))}
${section('POINT OF ENTRY')}<p>&nbsp;</p>${section('METHOD')}<p>Pry / Glass / Open / Key / Other:</p>
${section('ITEMS TAKEN')}<p>&nbsp;</p>${section('EVIDENCE PROCESSING')}<p>Prints ☐ DNA ☐ Toolmarks ☐ Surveillance ☐</p>${narrative()}${SIG_BLOCK}`,
  },
  {
    id: 'le-robbery', name: 'Robbery Report', category: 'le-property',
    description: 'Robbery — armed/strong-arm, weapon, BOLO',
    tags: ['robbery', 'armed'], statutes: ['76-6-301', '76-6-302'],
    fields: commonFields([{ key: 'victim', label: 'Victim', source: 'manual' }]),
    content: `${AGENCY_HEADER}${title('ROBBERY REPORT', '#7a2418')}${caseHeader()}
<p><strong>Victim:</strong> {{victim}}</p>
${section('SUSPECT DESCRIPTION (HxWxBxCxAxCxCxA)')}<p>Height / Weight / Build / Complexion / Age / Clothing / Color / Accent:</p><p>&nbsp;</p>
${section('WEAPON')}<p>☐ Firearm ☐ Knife ☐ Implied ☐ Other</p>${section('DEMAND / ACTIONS')}<p>&nbsp;</p>${section('BOLO ISSUED')}<p>Channel / Time: ____</p>${narrative()}${SIG_BLOCK}`,
  },

  // ──────────────── MISSING ────────────────
  {
    id: 'le-missing-adult', name: 'Missing Adult', category: 'le-missing',
    description: 'Adult missing person — endangered/at-risk evaluation',
    tags: ['missing', 'adult', 'endangered'],
    statutes: ['53-10-203'],
    fields: commonFields([{ key: 'name', label: 'Name', source: 'manual' }, { key: 'dob', label: 'DOB', source: 'manual' }, { key: 'last_seen', label: 'Last Seen', source: 'manual' }]),
    content: `${AGENCY_HEADER}${title('MISSING ADULT REPORT')}${caseHeader()}
${tbl(row2('<strong>Name:</strong> {{name}}', '<strong>DOB:</strong> {{dob}}') + row1('<strong>Last Seen:</strong> {{last_seen}}'))}
${section('AT-RISK FACTORS')}<p>☐ Medical ☐ Mental health ☐ Suicidal ☐ Dementia ☐ Foul play suspected ☐ Disabled</p>
${section('PHYSICAL DESCRIPTION')}<p>Height/Weight/Hair/Eyes/Marks: ____</p>
${section('CIRCUMSTANCES')}<p>&nbsp;</p>${section('NCIC ENTRY')}<p>NCIC# ____ Time: ____</p>${narrative()}${SIG_BLOCK}`,
  },
  {
    id: 'le-silver-alert', name: 'Silver Alert Activation', category: 'le-missing',
    description: 'Silver Alert criteria (≥60 / cognitive impairment / endangered)',
    tags: ['silver-alert', 'elder', 'dementia'],
    fields: commonFields([{ key: 'subject', label: 'Subject', source: 'manual' }]),
    content: `${AGENCY_HEADER}${title('SILVER ALERT REQUEST', '#7a2418')}${caseHeader()}
<p><strong>Subject:</strong> {{subject}}</p>
<p>Criteria: <strong>All three required</strong> — (1) age 60+; (2) verified cognitive impairment; (3) believed endangered.</p>
${section('LAST SEEN')}<p>&nbsp;</p>${section('VEHICLE')}<p>&nbsp;</p>${section('MEDICATION / MEDICAL')}<p>&nbsp;</p>${section('NOTIFICATION')}<p>UHP DPS notified at: ____</p>${SIG_BLOCK}`,
  },
  {
    id: 'le-welfare-check', name: 'Welfare Check', category: 'le-missing',
    description: 'Welfare check — entry, observations, contact',
    tags: ['welfare', 'check'],
    fields: commonFields([{ key: 'subject', label: 'Subject', source: 'manual' }, { key: 'requestor', label: 'Requestor', source: 'manual' }]),
    content: `${AGENCY_HEADER}${title('WELFARE CHECK')}${caseHeader()}
${tbl(row2('<strong>Subject:</strong> {{subject}}', '<strong>Requestor:</strong> {{requestor}}'))}
${section('REASON FOR CHECK')}<p>&nbsp;</p>${section('OBSERVATIONS ON ARRIVAL')}<p>&nbsp;</p>${section('CONTACT / ENTRY')}<p>☐ Contact made ☐ Forced entry (exigency) ☐ No answer ☐ Refused contact</p>${section('OUTCOME')}<p>☐ Subject OK ☐ Mental crisis ☐ Medical transport ☐ Deceased</p>${narrative()}${SIG_BLOCK}`,
  },
  {
    id: 'le-suicide-attempt', name: 'Mental Health / Suicide Attempt', category: 'le-missing',
    description: 'Mental health crisis — 1013/civil commitment criteria',
    tags: ['mental-health', 'suicide', 'commitment'],
    statutes: ['62A-15-629'],
    fields: commonFields([{ key: 'subject', label: 'Subject', source: 'manual' }]),
    content: `${AGENCY_HEADER}${title('MENTAL HEALTH ENCOUNTER', '#7a2418')}${caseHeader()}
<p><strong>Subject:</strong> {{subject}}</p>
${section('CRITERIA — INVOLUNTARY HOLD')}<p>☐ Danger to self ☐ Danger to others ☐ Gravely disabled</p>
${section('STATEMENTS / OBSERVATIONS')}<p>&nbsp;</p>${section('DISPOSITION')}<p>☐ Voluntary transport ☐ Involuntary 24-hr commitment ☐ Released — safety plan ☐ Refused</p>${section('FACILITY')}<p>&nbsp;</p>${SIG_BLOCK}`,
  },

  // Extra catch-alls
  {
    id: 'le-fir', name: 'Field Interview Report (FIR)', category: 'le-investigation',
    description: 'Field interview / contact card — non-arrest documentation',
    tags: ['fir', 'field-interview', 'sci'],
    fields: commonFields([{ key: 'subject', label: 'Subject', source: 'manual' }]),
    content: `${AGENCY_HEADER}${title('FIELD INTERVIEW REPORT')}${caseHeader()}
<p><strong>Subject:</strong> {{subject}}</p>
${section('REASON FOR CONTACT')}<p>&nbsp;</p>
${section('ASSOCIATES / VEHICLE')}<p>&nbsp;</p>
${section('OBSERVATIONS / INTEL')}<p>&nbsp;</p>${SIG_BLOCK}`,
  },
  {
    id: 'le-supplement', name: 'Investigation Supplement', category: 'le-investigation',
    description: 'Follow-up supplement attached to prior case',
    tags: ['supplement', 'follow-up'],
    fields: commonFields([{ key: 'parent_case', label: 'Parent Case #', source: 'manual' }]),
    content: `${AGENCY_HEADER}${title('SUPPLEMENT')}${caseHeader()}
<p><strong>Parent Case:</strong> {{parent_case}}</p>
${section('PURPOSE OF SUPPLEMENT')}<p>&nbsp;</p>${narrative()}${SIG_BLOCK}`,
  },
  {
    id: 'le-officer-statement', name: 'Officer Statement', category: 'le-investigation',
    description: 'First-person officer narrative for prosecution package',
    tags: ['statement', 'officer'],
    fields: commonFields(),
    content: `${AGENCY_HEADER}${title('OFFICER STATEMENT')}${caseHeader()}
<p>I, {{reporting_officer}} (#{{badge_number}}), being duly assigned to the Rocky Mountain Protective Group, state as follows:</p>
<p>&nbsp;</p><p>&nbsp;</p>
<p>I declare under penalty of perjury under the laws of the State of Utah that the foregoing is true and correct.</p>${SIG_BLOCK}`,
  },
  {
    id: 'le-bolo', name: 'BOLO Bulletin', category: 'le-investigation',
    description: 'Be-On-The-Lookout bulletin for shift dissemination',
    tags: ['bolo', 'attempt-to-locate'],
    fields: [
      { key: 'subject', label: 'Subject / Vehicle', source: 'manual' },
      { key: 'wanted_for', label: 'Wanted For', source: 'manual' },
      { key: 'caution', label: 'Caution Notes', source: 'manual' },
    ],
    content: `${AGENCY_HEADER}${title('BOLO — ATTEMPT TO LOCATE', '#7a2418')}
${tbl(row2('<strong>Subject:</strong> {{subject}}', '<strong>Wanted For:</strong> {{wanted_for}}') + row1('<strong>Caution:</strong> {{caution}}'))}
${section('DESCRIPTION')}<p>&nbsp;</p>${section('LAST KNOWN AREAS')}<p>&nbsp;</p>${section('CONTACT')}<p>If located, contact: ____________</p>${SIG_BLOCK}`,
  },
  {
    id: 'le-property-receipt', name: 'Property Release Receipt', category: 'le-property',
    description: 'Acknowledgment of property returned to owner',
    tags: ['property', 'release', 'receipt'],
    fields: commonFields([{ key: 'owner', label: 'Owner', source: 'manual' }, { key: 'items', label: 'Items', source: 'manual' }]),
    content: `${AGENCY_HEADER}${title('PROPERTY RELEASE RECEIPT')}${caseHeader()}
${tbl(row2('<strong>Owner:</strong> {{owner}}', '<strong>Items:</strong> {{items}}'))}
<p>I acknowledge receipt of the above-described property in good condition.</p>${DUAL_SIG_BLOCK}`,
  },
  {
    id: 'le-gang-contact', name: 'Gang Contact Documentation', category: 'le-investigation',
    description: 'STG / gang intelligence documentation',
    tags: ['gang', 'stg', 'intel'],
    fields: commonFields([{ key: 'subject', label: 'Subject', source: 'manual' }, { key: 'affiliation', label: 'Suspected Affiliation', source: 'manual' }]),
    content: `${AGENCY_HEADER}${title('GANG CONTACT')}${CONFIDENTIAL}${caseHeader()}
${tbl(row2('<strong>Subject:</strong> {{subject}}', '<strong>Suspected Affiliation:</strong> {{affiliation}}'))}
${section('VALIDATION CRITERIA')}<p>☐ Self-admission ☐ Tattoos ☐ Colors ☐ Associates ☐ Documents ☐ Photos ☐ FI by other LE</p>
${section('OBSERVATIONS')}<p>&nbsp;</p>${SIG_BLOCK}`,
  },
  {
    id: 'le-uof-supplement', name: 'Use-of-Force Witness Officer', category: 'le-investigation',
    description: 'Witness-officer supplement to a UoF report',
    tags: ['uof', 'witness', 'force'],
    fields: commonFields([{ key: 'primary', label: 'Primary Officer', source: 'manual' }]),
    content: `${AGENCY_HEADER}${title('UOF WITNESS-OFFICER SUPPLEMENT')}${caseHeader()}
<p><strong>Primary Officer:</strong> {{primary}}</p>
<p>I observed the events from the perspective of a witness officer. The following is my independent recollection:</p>${narrative()}${SIG_BLOCK}`,
  },
  {
    id: 'le-arrest-warrant-service', name: 'Arrest Warrant Service', category: 'le-investigation',
    description: 'Execution of arrest warrant — service, manner, location',
    tags: ['warrant', 'service', 'arrest'],
    statutes: ['77-7-3'],
    fields: commonFields([{ key: 'warrant_no', label: 'Warrant #', source: 'manual' }, { key: 'subject', label: 'Subject', source: 'manual' }]),
    content: `${AGENCY_HEADER}${title('ARREST WARRANT SERVICE')}${caseHeader()}
${tbl(row2('<strong>Warrant #:</strong> {{warrant_no}}', '<strong>Subject:</strong> {{subject}}'))}
${section('MANNER OF SERVICE')}<p>☐ Knock &amp; announce ☐ Surrounded &amp; called out ☐ Tactical entry ☐ Public contact</p>
${section('OUTCOME')}<p>&nbsp;</p>${narrative()}${SIG_BLOCK}`,
  },
  {
    id: 'le-search-warrant-service', name: 'Search Warrant Execution', category: 'le-investigation',
    description: 'SWO execution — entry, search, inventory return',
    tags: ['warrant', 'search', 'execution'],
    statutes: ['77-23-1', '77-23-210'],
    fields: commonFields([{ key: 'warrant_no', label: 'Warrant #', source: 'manual' }, { key: 'address', label: 'Premises', source: 'manual' }]),
    content: `${AGENCY_HEADER}${title('SEARCH WARRANT EXECUTION')}${caseHeader()}
${tbl(row2('<strong>Warrant #:</strong> {{warrant_no}}', '<strong>Premises:</strong> {{address}}'))}
${section('ENTRY')}<p>☐ Knock &amp; announce (delay ____ sec) ☐ No-knock authorized ☐ Forced entry</p>
${section('PERSONS PRESENT')}<p>&nbsp;</p>${section('AREAS SEARCHED')}<p>&nbsp;</p>${section('PROPERTY SEIZED — RETURN ATTACHED')}<p>&nbsp;</p>${SIG_BLOCK}`,
  },
  {
    id: 'le-firearm-discharge', name: 'Firearm Discharge Report', category: 'use-of-force',
    description: 'Discharge of duty firearm — accidental or intentional',
    tags: ['firearm', 'discharge', 'shot'],
    fields: commonFields([{ key: 'weapon', label: 'Weapon / Serial', source: 'manual' }]),
    content: `${AGENCY_HEADER}${title('FIREARM DISCHARGE REPORT', '#7a2418')}${CONFIDENTIAL}${caseHeader()}
<p><strong>Weapon / Serial:</strong> {{weapon}}</p>
${section('TYPE')}<p>☐ Intentional — deadly force ☐ Warning shot (prohibited) ☐ Accidental ☐ Animal ☐ Training</p>
${section('ROUNDS FIRED')}<p>____ &nbsp; Hits ____ &nbsp; Distance ____</p>${section('IMMEDIATE ACTIONS')}<p>&nbsp;</p>${section('CHIEF NOTIFICATION')}<p>Time ____ &nbsp; Internal Affairs notified ☐</p>${SIG_BLOCK}`,
  },
];
