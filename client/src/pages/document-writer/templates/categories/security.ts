import type { DocumentTemplate } from '../../types';
import {
  AGENCY_HEADER, CONFIDENTIAL, title, section, tbl, row2, row1,
  SIG_BLOCK, DUAL_SIG_BLOCK, narrative, F_OFFICER, F_BADGE, field,
} from '../_shared';

// 25 private security / contract client templates.
export const SEC_TEMPLATES: DocumentTemplate[] = [
  {
    id: 'sec-dar', name: 'Daily Activity Report (DAR)', category: 'sec-dar',
    description: 'End-of-shift activity log for contract client',
    tags: ['dar', 'daily', 'activity', 'shift'],
    fields: [
      { key: 'site', label: 'Site / Client', source: 'manual' },
      { key: 'shift', label: 'Shift', source: 'manual' },
      { key: 'officer', label: 'Officer', source: 'user' },
      { key: 'date', label: 'Date', source: 'manual' },
    ],
    content: `${AGENCY_HEADER}${title('DAILY ACTIVITY REPORT')}
${tbl(row2(field('Site', '{{site}}'), field('Shift', '{{shift}}')) + row2(field('Officer', '{{officer}}'), field('Date', '{{date}}')))}
${section('SHIFT LOG')}<table><tr><th>Time</th><th>Activity</th></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr></table>
${section('PATROLS')}<p>Patrols completed: ____ &nbsp;&nbsp; Tour markers hit: ____</p>
${section('OBSERVATIONS')}<p>&nbsp;</p>${section('MAINTENANCE / SAFETY ISSUES')}<p>&nbsp;</p>${SIG_BLOCK}`,
  },
  {
    id: 'sec-incident-client', name: 'Client Incident Report', category: 'sec-client',
    description: 'Client-facing incident report (formatted for delivery)',
    tags: ['client', 'incident', 'report'],
    fields: [
      { key: 'client', label: 'Client', source: 'manual' },
      { key: 'site', label: 'Site', source: 'manual' },
      { key: 'date', label: 'Date/Time', source: 'manual' },
      { key: 'officer', label: 'Officer', source: 'user' },
    ],
    content: `${AGENCY_HEADER}${title('INCIDENT REPORT — CLIENT NOTIFICATION')}
${tbl(row2(field('Client', '{{client}}'), field('Site', '{{site}}')) + row2(field('Date/Time', '{{date}}'), field('Officer', '{{officer}}')))}
${section('SUMMARY')}<p>&nbsp;</p>
${section('DETAILS')}<p>&nbsp;</p>
${section('ACTIONS TAKEN')}<p>&nbsp;</p>
${section('RECOMMENDATIONS')}<p>&nbsp;</p>
<p style="font-size:10px;color:#666;margin-top:24px;">This document contains information confidential to {{client}} and Rocky Mountain Protective Group.</p>${SIG_BLOCK}`,
  },
  {
    id: 'sec-post-orders', name: 'Post Orders', category: 'sec-post',
    description: 'Standing post orders for a specific site',
    tags: ['post', 'orders', 'sop'],
    fields: [
      { key: 'site', label: 'Site', source: 'manual' },
      { key: 'effective_date', label: 'Effective Date', source: 'manual' },
      { key: 'version', label: 'Version', source: 'manual' },
    ],
    content: `${AGENCY_HEADER}${title('POST ORDERS')}
${tbl(row2(field('Site', '{{site}}'), field('Effective', '{{effective_date}}')) + row1(field('Version', '{{version}}')))}
${section('1. MISSION')}<p>&nbsp;</p>
${section('2. POST HOURS &amp; COVERAGE')}<p>&nbsp;</p>
${section('3. UNIFORM &amp; EQUIPMENT')}<p>&nbsp;</p>
${section('4. PATROL ROUTE &amp; TOUR MARKERS')}<p>&nbsp;</p>
${section('5. ACCESS CONTROL')}<p>&nbsp;</p>
${section('6. EMERGENCY CONTACTS')}<table><tr><th>Role</th><th>Name</th><th>Phone</th></tr><tr><td>Site Mgr</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>RMPG Dispatch</td><td>&nbsp;</td><td>&nbsp;</td></tr></table>
${section('7. USE OF FORCE POLICY')}<p>Refer to RMPG UoF policy. Force may only be used in self-defense or defense of others, proportional to the threat.</p>
${section('8. REPORTING REQUIREMENTS')}<p>DAR every shift; immediate notification of any incident.</p>${DUAL_SIG_BLOCK}`,
  },
  {
    id: 'sec-tour', name: 'Patrol Tour / Round Sheet', category: 'sec-patrol',
    description: 'Tour-marker round sheet with hit times',
    tags: ['tour', 'round', 'patrol', 'check'],
    fields: [{ key: 'site', label: 'Site', source: 'manual' }, { key: 'officer', label: 'Officer', source: 'user' }],
    content: `${AGENCY_HEADER}${title('TOUR ROUND SHEET')}
<p><strong>Site:</strong> {{site}} &nbsp; <strong>Officer:</strong> {{officer}}</p>
<table><tr><th>Tour Marker</th><th>Pass 1</th><th>Pass 2</th><th>Pass 3</th><th>Pass 4</th></tr>
${[1,2,3,4,5,6,7,8].map(i => `<tr><td>Marker ${i}</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>`).join('')}</table>${SIG_BLOCK}`,
  },
  {
    id: 'sec-access-log', name: 'Access Control Log', category: 'sec-access',
    description: 'Visitor / contractor sign-in log',
    tags: ['access', 'visitor', 'log'],
    fields: [{ key: 'site', label: 'Site', source: 'manual' }, { key: 'date', label: 'Date', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('ACCESS CONTROL LOG')}
<p><strong>Site:</strong> {{site}} &nbsp; <strong>Date:</strong> {{date}}</p>
<table><tr><th>In</th><th>Out</th><th>Name</th><th>Company</th><th>Host</th><th>Badge#</th><th>Notes</th></tr>${Array(10).fill(0).map(()=>`<tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>`).join('')}</table>`,
  },
  {
    id: 'sec-keylog', name: 'Key / Badge Issue Log', category: 'sec-access',
    description: 'Temporary key or badge issue tracking',
    tags: ['key', 'badge', 'issue'],
    fields: [{ key: 'site', label: 'Site', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('KEY / BADGE ISSUE LOG')}<p><strong>Site:</strong> {{site}}</p>
<table><tr><th>Issued</th><th>To</th><th>Item</th><th>Returned</th><th>By</th></tr>${Array(8).fill(0).map(()=>`<tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>`).join('')}</table>`,
  },
  {
    id: 'sec-trespass', name: 'Trespass Notice', category: 'sec-access',
    description: 'Written criminal trespass warning per Utah Code 76-6-206',
    tags: ['trespass', 'banned', 'no-trespass'],
    fields: [
      { key: 'subject', label: 'Subject', source: 'manual' },
      { key: 'property', label: 'Property / Address', source: 'manual' },
      { key: 'duration', label: 'Duration (e.g. 1 year)', source: 'manual' },
      { key: 'officer', label: 'Issuing Officer', source: 'user' },
    ],
    content: `${AGENCY_HEADER}${title('CRIMINAL TRESPASS NOTICE')}
<p>To: <strong>{{subject}}</strong></p>
<p>Pursuant to Utah Code §76-6-206, you are hereby <strong>notified</strong> that you are not permitted on the following property:</p>
<p style="font-size:13px;margin-left:20px;"><strong>{{property}}</strong></p>
<p>This notice is effective immediately and remains in force for <strong>{{duration}}</strong>. Any return to the above property may result in arrest and criminal prosecution for trespass, a class B misdemeanor.</p>
<p style="font-size:10px;color:#666;">Notice issued by: {{officer}}, Rocky Mountain Protective Group.</p>${DUAL_SIG_BLOCK}`,
  },
  {
    id: 'sec-ejection', name: 'Subject Ejection Log', category: 'sec-access',
    description: 'Documentation of removing a subject from premises',
    tags: ['ejection', 'remove', 'kick-out'],
    fields: [{ key: 'subject', label: 'Subject', source: 'manual' }, { key: 'site', label: 'Site', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('SUBJECT EJECTION')}<p><strong>Subject:</strong> {{subject}} &nbsp; <strong>Site:</strong> {{site}}</p>
${section('REASON')}<p>&nbsp;</p>${section('METHOD')}<p>☐ Verbal request ☐ Escorted ☐ Trespass notice issued ☐ Police summoned</p>${section('RESISTANCE')}<p>&nbsp;</p>${SIG_BLOCK}`,
  },
  {
    id: 'sec-breach', name: 'Security Breach Notification', category: 'sec-client',
    description: 'Formal breach notification for client',
    tags: ['breach', 'notification', 'incident'],
    fields: [{ key: 'client', label: 'Client', source: 'manual' }, { key: 'site', label: 'Site', source: 'manual' }, { key: 'date', label: 'Date/Time', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('SECURITY BREACH NOTIFICATION', '#7a2418')}
${tbl(row2(field('Client', '{{client}}'), field('Site', '{{site}}')) + row1(field('Discovered', '{{date}}')))}
${section('NATURE OF BREACH')}<p>&nbsp;</p>${section('SCOPE')}<p>&nbsp;</p>${section('IMMEDIATE RESPONSE')}<p>&nbsp;</p>${section('RECOMMENDED REMEDIATION')}<p>&nbsp;</p>${SIG_BLOCK}`,
  },
  {
    id: 'sec-equipment-failure', name: 'Equipment Failure Report', category: 'sec-post',
    description: 'CCTV, alarm, gate, lighting failure report',
    tags: ['equipment', 'failure', 'cctv', 'alarm'],
    fields: [{ key: 'site', label: 'Site', source: 'manual' }, { key: 'equipment', label: 'Equipment', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('EQUIPMENT FAILURE')}<p><strong>Site:</strong> {{site}} &nbsp;&nbsp; <strong>Equipment:</strong> {{equipment}}</p>
${section('NATURE OF FAILURE')}<p>&nbsp;</p>${section('IMPACT TO SECURITY POSTURE')}<p>&nbsp;</p>${section('NOTIFICATIONS')}<p>Client ____ at ____ &nbsp; Vendor ____ at ____</p>${section('INTERIM COVERAGE')}<p>&nbsp;</p>${SIG_BLOCK}`,
  },
  {
    id: 'sec-shift-pass', name: 'Shift Pass-Down', category: 'sec-dar',
    description: 'Hand-off log between outgoing and incoming officer',
    tags: ['pass-down', 'handoff', 'relief'],
    fields: [{ key: 'site', label: 'Site', source: 'manual' }, { key: 'out', label: 'Outgoing', source: 'manual' }, { key: 'in', label: 'Incoming', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('SHIFT PASS-DOWN')}${tbl(row2(field('Outgoing', '{{out}}'), field('Incoming', '{{in}}')) + row1(field('Site', '{{site}}')))}
${section('OPEN ITEMS')}<p>&nbsp;</p>${section('OUTSTANDING ISSUES')}<p>&nbsp;</p>${section('EQUIPMENT STATUS')}<p>&nbsp;</p>${section('SITE CONDITIONS')}<p>&nbsp;</p>${DUAL_SIG_BLOCK}`,
  },
  {
    id: 'sec-vehicle-check', name: 'Vehicle Inspection (Pre-Shift)', category: 'sec-patrol',
    description: 'Pre-shift patrol vehicle check',
    tags: ['vehicle', 'inspection', 'pre-shift'],
    fields: [{ key: 'vehicle', label: 'Vehicle / Unit #', source: 'manual' }, { key: 'mileage', label: 'Starting Mileage', source: 'manual' }, { key: 'officer', label: 'Officer', source: 'user' }],
    content: `${AGENCY_HEADER}${title('VEHICLE PRE-SHIFT INSPECTION')}
${tbl(row2(field('Vehicle', '{{vehicle}}'), field('Mileage', '{{mileage}}')) + row1(field('Officer', '{{officer}}')))}
${section('EXTERIOR')}<p>☐ Tires ☐ Lights ☐ Body damage ☐ Plates ☐ Fluids</p>
${section('INTERIOR')}<p>☐ Radio ☐ Light bar ☐ Siren ☐ MDT ☐ First aid ☐ Fire ext.</p>
${section('NEW DAMAGE')}<p>&nbsp;</p>${SIG_BLOCK}`,
  },
  {
    id: 'sec-armed-bulletin', name: 'Armed Threat Bulletin', category: 'sec-client',
    description: 'Armed-threat alert pushed to client + officers',
    tags: ['armed', 'threat', 'bulletin'],
    fields: [{ key: 'subject', label: 'Subject', source: 'manual' }, { key: 'site', label: 'Site', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('ARMED THREAT BULLETIN', '#7a2418')}${CONFIDENTIAL}
<p><strong>Subject:</strong> {{subject}} &nbsp;&nbsp; <strong>Site Affected:</strong> {{site}}</p>
${section('THREAT DETAILS')}<p>&nbsp;</p>${section('LAST KNOWN LOCATION')}<p>&nbsp;</p>${section('OFFICER GUIDANCE')}<p>If observed, do not engage. Notify dispatch and SLCPD immediately. Move bystanders to safety.</p>${SIG_BLOCK}`,
  },
  {
    id: 'sec-medical', name: 'Medical Aid Rendered', category: 'sec-dar',
    description: 'Medical assistance log — first aid, EMS handoff',
    tags: ['medical', 'first-aid', 'ems'],
    fields: [{ key: 'patient', label: 'Patient', source: 'manual' }, { key: 'officer', label: 'Officer', source: 'user' }],
    content: `${AGENCY_HEADER}${title('MEDICAL AID RENDERED')}<p><strong>Patient:</strong> {{patient}} &nbsp; <strong>Officer:</strong> {{officer}}</p>
${section('COMPLAINT / CONDITION')}<p>&nbsp;</p>${section('AID PROVIDED')}<p>☐ CPR ☐ AED ☐ Tourniquet ☐ Bandage ☐ Naloxone ☐ Other</p>
${section('EMS')}<p>Notified at ____ Arrived at ____ &nbsp; Transport: ☐ Y ☐ N &nbsp; Hospital: ____</p>${SIG_BLOCK}`,
  },
  {
    id: 'sec-uof-private', name: 'Private Security UoF Report', category: 'sec-client',
    description: 'Use-of-force report when acting as private security',
    tags: ['uof', 'force', 'private'],
    fields: [{ key: 'subject', label: 'Subject', source: 'manual' }, { key: 'officer', label: 'Officer', source: 'user' }, { key: 'site', label: 'Site', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('USE-OF-FORCE — PRIVATE SECURITY', '#7a2418')}${CONFIDENTIAL}
${tbl(row2(field('Subject', '{{subject}}'), field('Officer', '{{officer}}')) + row1(field('Site', '{{site}}')))}
${section('JUSTIFICATION (self-defense / defense of others / citizen&rsquo;s arrest 77-7-3)')}<p>&nbsp;</p>
${section('FORCE LEVEL USED')}<p>☐ Presence ☐ Verbal ☐ Soft hands ☐ Hard hands ☐ Intermediate (OC/baton/CEW) ☐ Lethal</p>
${section('INJURIES')}<p>Subject: ____ &nbsp; Officer: ____</p>
${section('LAW ENFORCEMENT RESPONSE')}<p>SLCPD notified ☐ &nbsp; Case # ____</p>${narrative()}${SIG_BLOCK}`,
  },
  {
    id: 'sec-fire-alarm', name: 'Fire Alarm Activation', category: 'sec-patrol',
    description: 'Fire alarm response — verification, evacuation, fire dept hand-off',
    tags: ['fire', 'alarm', 'evacuation'],
    fields: [{ key: 'site', label: 'Site', source: 'manual' }, { key: 'zone', label: 'Zone / Sensor', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('FIRE ALARM ACTIVATION', '#7a2418')}<p><strong>Site:</strong> {{site}} &nbsp; <strong>Zone:</strong> {{zone}}</p>
${section('VERIFICATION')}<p>☐ Smoke observed ☐ Heat observed ☐ Pull station ☐ False alarm cause: ____</p>
${section('EVACUATION')}<p>Sounded at ____ &nbsp; All-clear at ____</p>${section('FIRE DEPARTMENT')}<p>SLCFD on-scene at ____ &nbsp; Incident # ____</p>${SIG_BLOCK}`,
  },
  {
    id: 'sec-burglar-alarm', name: 'Burglar Alarm Response', category: 'sec-patrol',
    description: 'Intrusion alarm response and clearance',
    tags: ['burglar', 'alarm', 'intrusion'],
    fields: [{ key: 'site', label: 'Site', source: 'manual' }, { key: 'zone', label: 'Zone', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('BURGLAR ALARM RESPONSE')}<p><strong>Site:</strong> {{site}} &nbsp; <strong>Zone:</strong> {{zone}}</p>
${section('ARRIVAL')}<p>Time: ____ &nbsp; Exterior check: ____ &nbsp; Interior check: ____</p>${section('FINDINGS')}<p>☐ All secure ☐ Door/window forced ☐ Subject contacted ☐ Glass breakage</p>${section('PD NOTIFICATION')}<p>SLCPD case # ____</p>${SIG_BLOCK}`,
  },
  {
    id: 'sec-slip-fall', name: 'Slip / Trip / Fall Report', category: 'sec-client',
    description: 'Customer or visitor fall on premises — premises-liability exposure',
    tags: ['slip', 'fall', 'liability'],
    fields: [{ key: 'subject', label: 'Subject', source: 'manual' }, { key: 'site', label: 'Site', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('SLIP / TRIP / FALL')}<p><strong>Subject:</strong> {{subject}} &nbsp; <strong>Site:</strong> {{site}}</p>
${section('LOCATION ON PREMISES')}<p>&nbsp;</p>${section('CONDITIONS')}<p>Wet ☐ Ice ☐ Debris ☐ Defective surface ☐ Lighting ☐</p>${section('INJURY')}<p>&nbsp;</p>${section('PHOTOS / WITNESSES')}<p>&nbsp;</p>${section('EMS')}<p>☐ Declined ☐ Treated on scene ☐ Transported</p>${SIG_BLOCK}`,
  },
  {
    id: 'sec-event-staffing', name: 'Special Event Staffing Plan', category: 'sec-post',
    description: 'Event security plan — posts, equipment, contingency',
    tags: ['event', 'staffing', 'plan'],
    fields: [{ key: 'event', label: 'Event', source: 'manual' }, { key: 'date', label: 'Date', source: 'manual' }, { key: 'venue', label: 'Venue', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('SPECIAL EVENT STAFFING PLAN')}${tbl(row2(field('Event', '{{event}}'), field('Date', '{{date}}')) + row1(field('Venue', '{{venue}}')))}
${section('THREAT ASSESSMENT')}<p>&nbsp;</p>${section('POSTS')}<p>&nbsp;</p>${section('UNIFORM / EQUIPMENT')}<p>&nbsp;</p>${section('COMMS PLAN')}<p>&nbsp;</p>${section('MEDICAL / EVAC')}<p>&nbsp;</p>${section('CONTINGENCIES')}<p>&nbsp;</p>${SIG_BLOCK}`,
  },
  {
    id: 'sec-property-damage-client', name: 'Property Damage — Client Premises', category: 'sec-client',
    description: 'Damage to client property — RMPG or third-party caused',
    tags: ['damage', 'client', 'property'],
    fields: [{ key: 'site', label: 'Site', source: 'manual' }, { key: 'description', label: 'Item Damaged', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('PROPERTY DAMAGE — CLIENT')}${tbl(row2(field('Site', '{{site}}'), field('Item', '{{description}}')))}
${section('CAUSE')}<p>&nbsp;</p>${section('RESPONSIBLE PARTY')}<p>&nbsp;</p>${section('ESTIMATED COST')}<p>$ ____</p>${section('PHOTOS TAKEN')}<p>☐ Y ☐ N</p>${SIG_BLOCK}`,
  },
  {
    id: 'sec-confiscation', name: 'Contraband Confiscation Log', category: 'sec-access',
    description: 'Weapons/alcohol/drugs confiscated at access point',
    tags: ['contraband', 'confiscation', 'weapons'],
    fields: [{ key: 'subject', label: 'Subject', source: 'manual' }, { key: 'item', label: 'Item', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('CONTRABAND CONFISCATION')}<p><strong>Subject:</strong> {{subject}} &nbsp; <strong>Item:</strong> {{item}}</p>
${section('LOCATION OF DISCOVERY')}<p>&nbsp;</p>${section('SUBJECT RESPONSE')}<p>&nbsp;</p>${section('DISPOSITION')}<p>☐ Returned at exit ☐ Destroyed ☐ Turned to PD ☐ Held in safe</p>${SIG_BLOCK}`,
  },
  {
    id: 'sec-snow-ice', name: 'Snow / Ice Inspection Log', category: 'sec-patrol',
    description: 'Premises winter-condition inspection (liability)',
    tags: ['snow', 'ice', 'winter', 'inspection'],
    fields: [{ key: 'site', label: 'Site', source: 'manual' }, { key: 'officer', label: 'Officer', source: 'user' }],
    content: `${AGENCY_HEADER}${title('WINTER CONDITIONS INSPECTION')}<p><strong>Site:</strong> {{site}} &nbsp; <strong>Officer:</strong> {{officer}}</p>
<table><tr><th>Time</th><th>Area</th><th>Condition</th><th>Action Taken</th></tr>${Array(8).fill(0).map(()=>`<tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>`).join('')}</table>`,
  },
  {
    id: 'sec-customer-complaint', name: 'Customer Complaint', category: 'sec-client',
    description: 'Customer/visitor complaint intake',
    tags: ['complaint', 'customer'],
    fields: [{ key: 'complainant', label: 'Complainant', source: 'manual' }, { key: 'site', label: 'Site', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('CUSTOMER COMPLAINT')}<p><strong>Complainant:</strong> {{complainant}} &nbsp; <strong>Site:</strong> {{site}}</p>
${section('SUMMARY')}<p>&nbsp;</p>${section('OFFICER RESPONSE')}<p>&nbsp;</p>${section('RESOLUTION')}<p>&nbsp;</p>${section('FOLLOW-UP NEEDED')}<p>&nbsp;</p>${SIG_BLOCK}`,
  },
  {
    id: 'sec-tenant-notice', name: 'Tenant / Resident Notice', category: 'sec-access',
    description: 'Apartment/condo client — notice to resident',
    tags: ['tenant', 'notice', 'resident'],
    fields: [{ key: 'unit', label: 'Unit', source: 'manual' }, { key: 'subject', label: 'Subject', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('NOTICE TO RESIDENT')}<p><strong>Unit:</strong> {{unit}}</p>
<p>This notice concerns: <strong>{{subject}}</strong></p>
${section('DETAILS')}<p>&nbsp;</p>${section('ACTION REQUIRED')}<p>&nbsp;</p>${SIG_BLOCK}`,
  },
  {
    id: 'sec-weekly-summary', name: 'Weekly Site Summary', category: 'sec-client',
    description: 'Roll-up of week\'s activity for client',
    tags: ['weekly', 'summary', 'client'],
    fields: [{ key: 'client', label: 'Client', source: 'manual' }, { key: 'site', label: 'Site', source: 'manual' }, { key: 'week', label: 'Week Of', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('WEEKLY SITE SUMMARY')}${tbl(row2(field('Client', '{{client}}'), field('Site', '{{site}}')) + row1(field('Week of', '{{week}}')))}
${section('HOURS COVERED')}<p>&nbsp;</p>${section('INCIDENTS')}<p>&nbsp;</p>${section('TOUR COMPLIANCE')}<p>&nbsp;</p>${section('NOTABLE OBSERVATIONS')}<p>&nbsp;</p>${section('RECOMMENDATIONS')}<p>&nbsp;</p>${SIG_BLOCK}`,
  },
];
