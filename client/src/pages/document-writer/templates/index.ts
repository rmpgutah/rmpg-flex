import type { DocumentTemplate } from '../types';
import { LE_TEMPLATES } from './categories/law-enforcement';
import { SEC_TEMPLATES } from './categories/security';
import { HR_TEMPLATES } from './categories/hr';
import { LEGAL_TEMPLATES } from './categories/legal';
import { AGENCY_HEADER, LETTER_BODY, buildAgencyHeader, DEFAULT_HEADER, title, section, field, type HeaderConfig } from './_shared';


export const TEMPLATES: DocumentTemplate[] = [
  {
    id: 'incident-report',
    name: 'Incident Report',
    category: 'incident',
    description: 'Standard incident/offense report with narrative and disposition',
    fields: [
      { key: 'case_number', label: 'Case Number', source: 'cad', cadPath: 'call.call_number' },
      { key: 'date_of_report', label: 'Date of Report', source: 'manual' },
      { key: 'incident_date', label: 'Incident Date/Time', source: 'cad', cadPath: 'call.received_at' },
      { key: 'location', label: 'Location', source: 'cad', cadPath: 'call.address' },
      { key: 'reporting_officer', label: 'Reporting Officer', source: 'user' },
      { key: 'badge_number', label: 'Badge Number', source: 'user' },
      { key: 'offense', label: 'Offense/Incident Type', source: 'cad', cadPath: 'call.call_type' },
      { key: 'disposition', label: 'Disposition', source: 'manual' },
    ],
    content: `${AGENCY_HEADER}
${title('INCIDENT REPORT')}

<table>
  <tr>
    <td>${field('Case #', '{{case_number}}')}</td>
    <td>${field('Date of Report', '{{date_of_report}}')}</td>
  </tr>
  <tr>
    <td>${field('Incident Date/Time', '{{incident_date}}')}</td>
    <td>${field('Location', '{{location}}')}</td>
  </tr>
  <tr>
    <td>${field('Reporting Officer', '{{reporting_officer}}')}</td>
    <td>${field('Badge #', '{{badge_number}}')}</td>
  </tr>
  <tr>
    <td>${field('Offense', '{{offense}}')}</td>
    <td>${field('Disposition', '{{disposition}}')}</td>
  </tr>
</table>

${section('INVOLVED PERSONS')}
<p><em>List all victims, suspects, witnesses, and other involved parties below.</em></p>
<table>
  <tr>
    <th>Name</th>
    <th>Role</th>
    <th>DOB</th>
    <th>Contact</th>
  </tr>
  <tr>
    <td>&nbsp;</td>
    <td>&nbsp;</td>
    <td>&nbsp;</td>
    <td>&nbsp;</td>
  </tr>
</table>

${section('NARRATIVE')}
<p>On {{incident_date}}, I, {{reporting_officer}} (Badge #{{badge_number}}), responded to {{location}} regarding a report of {{offense}}.</p>
<p>&nbsp;</p>
<p>&nbsp;</p>

${section('EVIDENCE / PROPERTY')}
<p><em>Describe any evidence collected, property seized, or items of evidentiary value.</em></p>
<p>&nbsp;</p>

${section('DISPOSITION &amp; RECOMMENDATIONS')}
<p>Case disposition: {{disposition}}</p>
<p>&nbsp;</p>

<div style="margin-top:48px;">
  <table>
    <tr>
      <td>&nbsp;</td>
      <td>&nbsp;</td>
      <td>&nbsp;</td>
    </tr>
    <tr>
      <td>Officer Signature</td>
      <td>&nbsp;</td>
      <td>Date</td>
    </tr>
  </table>
</div>`,
  },
  {
    id: 'arrest-report',
    name: 'Arrest Report',
    category: 'arrest',
    description: 'Arrest/booking report with charges, Miranda, and probable cause',
    fields: [
      { key: 'case_number', label: 'Case Number', source: 'cad', cadPath: 'call.call_number' },
      { key: 'arrest_date', label: 'Arrest Date/Time', source: 'manual' },
      { key: 'location', label: 'Arrest Location', source: 'cad', cadPath: 'call.address' },
      { key: 'arrestee_name', label: 'Arrestee Name', source: 'manual' },
      { key: 'arrestee_dob', label: 'Arrestee DOB', source: 'manual' },
      { key: 'charges', label: 'Charges', source: 'manual' },
      { key: 'arresting_officer', label: 'Arresting Officer', source: 'user' },
      { key: 'badge_number', label: 'Badge Number', source: 'user' },
    ],
    content: `${AGENCY_HEADER}
${title('ARREST REPORT')}

<table>
  <tr>
    <td>${field('Case #', '{{case_number}}')}</td>
    <td>${field('Arrest Date/Time', '{{arrest_date}}')}</td>
  </tr>
  <tr>
    <td>${field('Arrestee', '{{arrestee_name}}')}</td>
    <td>${field('DOB', '{{arrestee_dob}}')}</td>
  </tr>
  <tr>
    <td>${field('Location', '{{location}}')}</td>
    <td>${field('Charges', '{{charges}}')}</td>
  </tr>
  <tr>
    <td>${field('Arresting Officer', '{{arresting_officer}}')}</td>
    <td>${field('Badge #', '{{badge_number}}')}</td>
  </tr>
</table>

${section('MIRANDA WARNING')}
<p>Miranda rights were read to the arrestee at __________ hours.</p>
<p>☐ Arrestee invoked right to silence &nbsp;&nbsp; ☐ Arrestee waived rights &nbsp;&nbsp; ☐ Written waiver obtained</p>

${section('PROBABLE CAUSE STATEMENT')}
<p>&nbsp;</p>
<p>&nbsp;</p>

${section('SEARCH INCIDENT TO ARREST')}
<p><em>Describe items found during search.</em></p>
<p>&nbsp;</p>

${section('BOOKING INFORMATION')}
<table>
  <tr>
    <td>${field('Booked at', '')}</td>
    <td>${field('Booking #', '')}</td>
  </tr>
  <tr>
    <td>${field('Bail Amount', '')}</td>
    <td>${field('Court Date', '')}</td>
  </tr>
</table>

<div style="margin-top:48px;">
  <table>
    <tr>
      <td>&nbsp;</td>
      <td>&nbsp;</td>
      <td>&nbsp;</td>
    </tr>
    <tr>
      <td>Arresting Officer Signature</td>
      <td>&nbsp;</td>
      <td>Date</td>
    </tr>
  </table>
</div>`,
  },
  {
    id: 'use-of-force',
    name: 'Use of Force Report',
    category: 'use-of-force',
    description: 'Required documentation of any force used during an incident',
    fields: [
      { key: 'case_number', label: 'Case Number', source: 'cad', cadPath: 'call.call_number' },
      { key: 'incident_date', label: 'Incident Date/Time', source: 'cad', cadPath: 'call.received_at' },
      { key: 'location', label: 'Location', source: 'cad', cadPath: 'call.address' },
      { key: 'reporting_officer', label: 'Reporting Officer', source: 'user' },
      { key: 'badge_number', label: 'Badge Number', source: 'user' },
      { key: 'subject_name', label: 'Subject Name', source: 'manual' },
    ],
    content: `${AGENCY_HEADER}
${title('USE OF FORCE REPORT', '#c0392b')}
<p style="text-align:center;font-size:10px;color:#888;">CONFIDENTIAL — This report is subject to internal review and may be discoverable in litigation.</p>

<table>
  <tr>
    <td>${field('Case #', '{{case_number}}')}</td>
    <td>${field('Date/Time', '{{incident_date}}')}</td>
  </tr>
  <tr>
    <td>${field('Officer', '{{reporting_officer}} (Badge #{{badge_number}})')}</td>
    <td>${field('Subject', '{{subject_name}}')}</td>
  </tr>
  <tr>
    <td colspan="2">${field('Location', '{{location}}')}</td>
  </tr>
</table>

${section('TYPE OF FORCE USED')}
<p>☐ Physical control/takedown &nbsp; ☐ OC spray &nbsp; ☐ Taser/CEW &nbsp; ☐ Baton &nbsp; ☐ K-9 &nbsp; ☐ Firearm (discharge) &nbsp; ☐ Other</p>

${section('SUBJECT RESISTANCE LEVEL')}
<p>☐ Passive resistance &nbsp; ☐ Active resistance &nbsp; ☐ Aggressive resistance &nbsp; ☐ Deadly force threat</p>

${section('DE-ESCALATION ATTEMPTS')}
<p><em>Describe all de-escalation techniques attempted prior to use of force.</em></p>
<p>&nbsp;</p>

${section('DETAILED NARRATIVE')}
<p><em>Provide a detailed, chronological account of the events leading to, during, and after the use of force.</em></p>
<p>&nbsp;</p>
<p>&nbsp;</p>

${section('INJURIES')}
<table>
  <tr>
    <td>${field('Officer injuries', '')}</td>
    <td>${field('Subject injuries', '')}</td>
  </tr>
  <tr>
    <td>${field('Medical treatment provided', '☐ Yes ☐ No')}</td>
    <td>${field('EMS responded', '☐ Yes ☐ No')}</td>
  </tr>
</table>

${section('WITNESSES')}
<p>&nbsp;</p>

${section('BODY CAMERA / DASHCAM')}
<p>☐ Body camera activated &nbsp; ☐ Dashcam recording &nbsp; ☐ No recording available</p>
<p>Camera ID / File reference: ________________</p>

<div style="margin-top:48px;">
  <table>
    <tr>
      <td>&nbsp;</td>
      <td>&nbsp;</td>
      <td>&nbsp;</td>
    </tr>
    <tr>
      <td>Officer Signature</td>
      <td>&nbsp;</td>
      <td>Date</td>
    </tr>
    <tr>
      <td>&nbsp;</td>
      <td>&nbsp;</td>
      <td>&nbsp;</td>
    </tr>
    <tr>
      <td>Supervisor Signature</td>
      <td>&nbsp;</td>
      <td>Date</td>
    </tr>
  </table>
</div>`,
  },
  {
    id: 'supplemental',
    name: 'Supplemental Report',
    category: 'supplemental',
    description: 'Additional information or follow-up to an existing case',
    fields: [
      { key: 'case_number', label: 'Original Case Number', source: 'manual' },
      { key: 'supplement_number', label: 'Supplement Number', source: 'manual' },
      { key: 'reporting_officer', label: 'Reporting Officer', source: 'user' },
      { key: 'badge_number', label: 'Badge Number', source: 'user' },
      { key: 'date_of_report', label: 'Date of Report', source: 'manual' },
    ],
    content: `${AGENCY_HEADER}
${title('SUPPLEMENTAL REPORT')}

<table>
  <tr>
    <td>${field('Original Case #', '{{case_number}}')}</td>
    <td>${field('Supplement #', '{{supplement_number}}')}</td>
    <td>${field('Date', '{{date_of_report}}')}</td>
  </tr>
  <tr>
    <td colspan="2">${field('Officer', '{{reporting_officer}}')}</td>
    <td>${field('Badge #', '{{badge_number}}')}</td>
  </tr>
</table>

${section('PURPOSE OF SUPPLEMENT')}
<p>☐ Follow-up investigation &nbsp; ☐ Additional witness statement &nbsp; ☐ Evidence update &nbsp; ☐ Status change &nbsp; ☐ Other</p>

${section('NARRATIVE')}
<p>&nbsp;</p>
<p>&nbsp;</p>

<div style="margin-top:48px;">
  <table>
    <tr>
      <td>&nbsp;</td>
      <td>&nbsp;</td>
      <td>&nbsp;</td>
    </tr>
    <tr>
      <td>Officer Signature</td>
      <td>&nbsp;</td>
      <td>Date</td>
    </tr>
  </table>
</div>`,
  },
  {
    id: 'evidence-log',
    name: 'Evidence/Property Log',
    category: 'evidence',
    description: 'Chain of custody and evidence documentation',
    fields: [
      { key: 'case_number', label: 'Case Number', source: 'manual' },
      { key: 'reporting_officer', label: 'Collecting Officer', source: 'user' },
      { key: 'badge_number', label: 'Badge Number', source: 'user' },
      { key: 'date_collected', label: 'Date Collected', source: 'manual' },
      { key: 'location', label: 'Collection Location', source: 'cad', cadPath: 'call.address' },
    ],
    content: `${AGENCY_HEADER}
${title('EVIDENCE / PROPERTY LOG')}

<table>
  <tr>
    <td>${field('Case #', '{{case_number}}')}</td>
    <td>${field('Date Collected', '{{date_collected}}')}</td>
  </tr>
  <tr>
    <td>${field('Collecting Officer', '{{reporting_officer}} (#{{badge_number}})')}</td>
    <td>${field('Location', '{{location}}')}</td>
  </tr>
</table>

${section('ITEMS')}
<table>
  <tr>
    <th>Item #</th>
    <th>Description</th>
    <th>Where Found</th>
    <th>Category</th>
  </tr>
  <tr>
    <td>1</td>
    <td>&nbsp;</td>
    <td>&nbsp;</td>
    <td>&nbsp;</td>
  </tr>
</table>

${section('CHAIN OF CUSTODY')}
<table>
  <tr>
    <th>Date/Time</th>
    <th>Released By</th>
    <th>Received By</th>
    <th>Purpose</th>
  </tr>
  <tr>
    <td>&nbsp;</td>
    <td>&nbsp;</td>
    <td>&nbsp;</td>
    <td>&nbsp;</td>
  </tr>
</table>

<div style="margin-top:48px;">
  <table>
    <tr>
      <td>&nbsp;</td>
      <td>&nbsp;</td>
      <td>&nbsp;</td>
    </tr>
    <tr>
      <td>Collecting Officer Signature</td>
      <td>&nbsp;</td>
      <td>Date</td>
    </tr>
  </table>
</div>`,
  },
  {
    id: 'memo',
    name: 'Internal Memo',
    category: 'memo',
    description: 'Inter-office memorandum for internal communications',
    fields: [
      { key: 'to', label: 'To', source: 'manual' },
      { key: 'from', label: 'From', source: 'user' },
      { key: 'date', label: 'Date', source: 'manual' },
      { key: 'subject', label: 'Subject', source: 'manual' },
    ],
    content: `${AGENCY_HEADER}
${title('MEMORANDUM')}

<table>
  <tr><td>${field('TO', '')}</td><td>{{to}}</td></tr>
  <tr><td>${field('FROM', '')}</td><td>{{from}}</td></tr>
  <tr><td>${field('DATE', '')}</td><td>{{date}}</td></tr>
  <tr><td>${field('RE', '')}</td><td>{{subject}}</td></tr>
</table>
<hr style="border:none;border-top:2px solid #333;margin:16px 0;" />

<p>&nbsp;</p>
<p>&nbsp;</p>`,
  },
  {
    id: 'patrol-report',
    name: 'Patrol Report',
    category: 'supplemental',
    description: 'Shift patrol summary — areas covered, activity, and observations',
    fields: [
      { key: 'officer', label: 'Officer', source: 'user' },
      { key: 'shift_date', label: 'Shift Date', source: 'manual' },
      { key: 'shift_hours', label: 'Shift Hours', source: 'manual' },
      { key: 'vehicle', label: 'Vehicle / Unit', source: 'manual' },
      { key: 'beat', label: 'Beat / Sector', source: 'manual' },
    ],
    content: `${AGENCY_HEADER}
${title('PATROL REPORT')}
<table>
  <tr><td>${field('Officer', '{{officer}}')}</td><td>${field('Date', '{{shift_date}}')}</td></tr>
  <tr><td>${field('Hours', '{{shift_hours}}')}</td><td>${field('Unit', '{{vehicle}}')}</td></tr>
  <tr><td colspan="2">${field('Beat / Sector', '{{beat}}')}</td></tr>
</table>
${section('AREAS PATROLLED')}<p>&nbsp;</p>
${section('ACTIVITY &amp; OBSERVATIONS')}<p>&nbsp;</p>
${section('CALLS RESPONDED')}<p>&nbsp;</p>`,
  },
  {
    id: 'investigation-report',
    name: 'Investigation Report',
    category: 'incident',
    description: 'Follow-up investigation with findings, evidence, and conclusions',
    fields: [
      { key: 'case_number', label: 'Case Number', source: 'cad', cadPath: 'call.call_number' },
      { key: 'investigator', label: 'Investigator', source: 'user' },
      { key: 'date', label: 'Date', source: 'manual' },
      { key: 'subject', label: 'Subject of Investigation', source: 'manual' },
    ],
    content: `${AGENCY_HEADER}
${title('INVESTIGATION REPORT')}
<table>
  <tr><td>${field('Case #', '{{case_number}}')}</td><td>${field('Investigator', '{{investigator}}')}</td></tr>
  <tr><td>${field('Date', '{{date}}')}</td><td>${field('Subject', '{{subject}}')}</td></tr>
</table>
${section('SUMMARY')}<p>&nbsp;</p>
${section('EVIDENCE')}<p>&nbsp;</p>
${section('FINDINGS')}<p>&nbsp;</p>
${section('CONCLUSION')}<p>&nbsp;</p>`,
  },
  {
    id: 'training-record',
    name: 'Training Record',
    category: 'general',
    description: 'Officer training/certification record',
    fields: [
      { key: 'officer', label: 'Officer', source: 'user' },
      { key: 'course', label: 'Course / Topic', source: 'manual' },
      { key: 'date', label: 'Date Completed', source: 'manual' },
      { key: 'hours', label: 'Training Hours', source: 'manual' },
      { key: 'instructor', label: 'Instructor', source: 'manual' },
    ],
    content: `${AGENCY_HEADER}
${title('TRAINING RECORD')}
<table>
  <tr><td>${field('Officer', '{{officer}}')}</td><td>${field('Course', '{{course}}')}</td></tr>
  <tr><td>${field('Date', '{{date}}')}</td><td>${field('Hours', '{{hours}}')}</td></tr>
  <tr><td colspan="2">${field('Instructor', '{{instructor}}')}</td></tr>
</table>
${section('OBJECTIVES COVERED')}<p>&nbsp;</p>
<p style="margin-top:40px;">_______________________________<br>Officer Signature</p>`,
  },
  {
    id: 'letter-formal',
    name: 'Formal Letter',
    category: 'letter',
    description: 'Formal business/official letter on agency letterhead',
    fields: [
      { key: 'recipient', label: 'Recipient', source: 'manual' },
      { key: 'address', label: 'Recipient Address', source: 'manual' },
      { key: 'date', label: 'Date', source: 'manual' },
      { key: 're', label: 'RE / Subject', source: 'manual' },
      { key: 'sender', label: 'Sender', source: 'user' },
    ],
    content: `${AGENCY_HEADER}
<p style="margin-top:18px;"><span style="${LETTER_BODY}">{{date}}</span></p>
<p style="margin-top:18px;margin-bottom:0;"><span style="${LETTER_BODY}">{{recipient}}<br>{{address}}</span></p>
<p style="margin-top:18px;"><span style="${LETTER_BODY}"><strong>RE:&nbsp;&nbsp;{{re}}</strong></span></p>
<p style="margin-top:18px;"><span style="${LETTER_BODY}">Dear {{recipient}}:</span></p>
<p style="margin-top:14px;line-height:1.6;"><span style="${LETTER_BODY}">&nbsp;</span></p>
<p style="line-height:1.6;"><span style="${LETTER_BODY}">&nbsp;</span></p>
<p style="line-height:1.6;"><span style="${LETTER_BODY}">&nbsp;</span></p>
<p style="margin-top:22px;margin-bottom:0;"><span style="${LETTER_BODY}">Sincerely,</span></p>
<p style="margin-top:0;margin-bottom:0;"><span style="${LETTER_BODY}">&nbsp;</span></p>
<p style="margin-top:0;margin-bottom:0;"><span style="${LETTER_BODY}">&nbsp;</span></p>
<p style="margin-top:0;margin-bottom:0;"><span style="${LETTER_BODY}">_______________________________</span></p>
<p style="margin-top:2px;"><span style="${LETTER_BODY}">{{sender}}<br>Rocky Mountain Protective Group<br>Salt Lake City, Utah</span></p>`,
  },
  {
    id: 'meeting-minutes',
    name: 'Meeting Minutes',
    category: 'memo',
    description: 'Structured meeting minutes with attendees and action items',
    fields: [
      { key: 'meeting', label: 'Meeting', source: 'manual' },
      { key: 'date', label: 'Date', source: 'manual' },
      { key: 'recorder', label: 'Recorded By', source: 'user' },
    ],
    content: `${AGENCY_HEADER}
${title('MEETING MINUTES')}
<p><strong>Meeting:</strong> {{meeting}} &nbsp;&nbsp; <strong>Date:</strong> {{date}} &nbsp;&nbsp; <strong>Recorded by:</strong> {{recorder}}</p>
${section('ATTENDEES')}<ul><li>&nbsp;</li></ul>
${section('DISCUSSION')}<p>&nbsp;</p>
${section('ACTION ITEMS')}<ul data-type="taskList"><li>&nbsp;</li></ul>`,
  },
  {
    id: 'project-proposal',
    name: 'Project Proposal',
    category: 'general',
    description: 'Proposal with objectives, scope, budget, and timeline',
    fields: [
      { key: 'title', label: 'Project Title', source: 'manual' },
      { key: 'author', label: 'Prepared By', source: 'user' },
      { key: 'date', label: 'Date', source: 'manual' },
    ],
    content: `${AGENCY_HEADER}
${title('{{title}}')}
<p style="text-align:center;">Prepared by {{author}} — {{date}}</p>
${section('OBJECTIVE')}<p>&nbsp;</p>
${section('SCOPE')}<p>&nbsp;</p>
${section('BUDGET')}<p>&nbsp;</p>
${section('TIMELINE')}<p>&nbsp;</p>`,
  },
  {
    id: 'invoice',
    name: 'Invoice',
    category: 'general',
    description: 'Service invoice with line items and totals',
    fields: [
      { key: 'invoice_no', label: 'Invoice #', source: 'manual' },
      { key: 'bill_to', label: 'Bill To', source: 'manual' },
      { key: 'date', label: 'Date', source: 'manual' },
    ],
    content: `${AGENCY_HEADER}
${title('INVOICE')}
<p><strong>Invoice #:</strong> {{invoice_no}} &nbsp;&nbsp; <strong>Date:</strong> {{date}}</p>
<p><strong>Bill To:</strong> {{bill_to}}</p>
<table>
  <tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td colspan="3"><strong>TOTAL</strong></td><td>&nbsp;</td></tr>
</table>`,
  },
  {
    id: 'contract',
    name: 'Service Contract',
    category: 'general',
    description: 'Service agreement with parties, terms, and signatures',
    fields: [
      { key: 'party_a', label: 'Party A', source: 'manual' },
      { key: 'party_b', label: 'Party B', source: 'manual' },
      { key: 'date', label: 'Effective Date', source: 'manual' },
    ],
    content: `${AGENCY_HEADER}
${title('SERVICE AGREEMENT')}
<p>This agreement is entered into on {{date}} between <strong>{{party_a}}</strong> ("Provider") and <strong>{{party_b}}</strong> ("Client").</p>
${section('1. SCOPE OF SERVICES')}<p>&nbsp;</p>
${section('2. TERM')}<p>&nbsp;</p>
${section('3. COMPENSATION')}<p>&nbsp;</p>
<table><tr>
  <td>_______________________<br>{{party_a}}</td>
  <td>_______________________<br>{{party_b}}</td>
</tr></table>`,
  },
  {
    id: 'incident-narrative',
    name: 'Incident Narrative',
    category: 'incident',
    description: 'Free-form chronological narrative (first-person) for an incident',
    fields: [
      { key: 'case_number', label: 'Case Number', source: 'cad', cadPath: 'call.call_number' },
      { key: 'incident_date', label: 'Incident Date/Time', source: 'cad', cadPath: 'call.received_at' },
      { key: 'location', label: 'Location', source: 'cad', cadPath: 'call.address' },
      { key: 'reporting_officer', label: 'Reporting Officer', source: 'user' },
      { key: 'badge_number', label: 'Badge Number', source: 'user' },
      { key: 'offense', label: 'Nature of Incident', source: 'cad', cadPath: 'call.call_type' },
    ],
    content: `${AGENCY_HEADER}
${title('INCIDENT NARRATIVE')}
<table>
  <tr>
    <td>${field('Case #', '{{case_number}}')}</td>
    <td>${field('Date/Time', '{{incident_date}}')}</td>
  </tr>
  <tr>
    <td>${field('Location', '{{location}}')}</td>
    <td>${field('Nature', '{{offense}}')}</td>
  </tr>
  <tr>
    <td colspan="2">${field('Reporting Officer', '{{reporting_officer}} (Badge #{{badge_number}})')}</td>
  </tr>
</table>
${section('SYNOPSIS')}
<p><em>One-sentence summary of what occurred.</em></p>
<p>&nbsp;</p>
${section('NARRATIVE')}
<p>On {{incident_date}}, I, {{reporting_officer}} (Badge #{{badge_number}}), was dispatched to {{location}} in reference to {{offense}}.</p>
<p>Upon arrival, I observed&hellip;</p>
<p>&nbsp;</p>
<p>&nbsp;</p>
${section('ACTIONS TAKEN')}
<p>&nbsp;</p>
${section('DISPOSITION')}
<p>&nbsp;</p>
<div style="margin-top:48px;">
  <table>
    <tr>
      <td>&nbsp;</td>
      <td>&nbsp;</td>
      <td>&nbsp;</td>
    </tr>
    <tr>
      <td>Officer Signature</td>
      <td>&nbsp;</td>
      <td>Date</td>
    </tr>
  </table>
</div>`,
  },
  {
    id: 'witness-statement',
    name: 'Witness Statement',
    category: 'incident',
    description: 'Voluntary witness statement with affirmation and signature',
    fields: [
      { key: 'case_number', label: 'Case Number', source: 'cad', cadPath: 'call.call_number' },
      { key: 'witness_name', label: 'Witness Name', source: 'manual' },
      { key: 'witness_dob', label: 'Witness DOB', source: 'manual' },
      { key: 'witness_contact', label: 'Phone / Address', source: 'manual' },
      { key: 'statement_date', label: 'Date of Statement', source: 'manual' },
      { key: 'taking_officer', label: 'Statement Taken By', source: 'user' },
    ],
    content: `${AGENCY_HEADER}
${title('VOLUNTARY WITNESS STATEMENT')}
<table>
  <tr>
    <td>${field('Case #', '{{case_number}}')}</td>
    <td>${field('Date', '{{statement_date}}')}</td>
  </tr>
  <tr>
    <td>${field('Witness', '{{witness_name}}')}</td>
    <td>${field('DOB', '{{witness_dob}}')}</td>
  </tr>
  <tr>
    <td colspan="2">${field('Contact', '{{witness_contact}}')}</td>
  </tr>
  <tr>
    <td colspan="2">${field('Statement taken by', '{{taking_officer}}')}</td>
  </tr>
</table>
${section('STATEMENT')}
<p><em>In your own words, describe what you saw, heard, or experienced. Include dates, times, and locations where possible.</em></p>
<p>&nbsp;</p>
<p>&nbsp;</p>
<p>&nbsp;</p>
<p>&nbsp;</p>
${section('AFFIRMATION')}
<p>I, {{witness_name}}, affirm that the above statement is true and correct to the best of my knowledge. I understand that providing false information in an official investigation may be a criminal offense.</p>
<div style="margin-top:40px;">
  <table>
    <tr>
      <td>&nbsp;</td>
      <td>&nbsp;</td>
      <td>&nbsp;</td>
    </tr>
    <tr>
      <td>Witness Signature</td>
      <td>&nbsp;</td>
      <td>Date / Time</td>
    </tr>
    <tr>
      <td>&nbsp;</td>
      <td>&nbsp;</td>
      <td>&nbsp;</td>
    </tr>
    <tr>
      <td>Officer / Witness to Signature</td>
      <td>&nbsp;</td>
      <td>Date</td>
    </tr>
  </table>
</div>`,
  },
  {
    id: 'field-interview',
    name: 'Field Interview',
    category: 'incident',
    description: 'Field interview / contact card (FI) with subject and basis for contact',
    fields: [
      { key: 'fi_number', label: 'FI Number', source: 'manual' },
      { key: 'contact_date', label: 'Contact Date/Time', source: 'manual' },
      { key: 'location', label: 'Location', source: 'cad', cadPath: 'call.address' },
      { key: 'subject_name', label: 'Subject Name', source: 'manual' },
      { key: 'subject_dob', label: 'Subject DOB', source: 'manual' },
      { key: 'officer', label: 'Officer', source: 'user' },
      { key: 'badge_number', label: 'Badge Number', source: 'user' },
    ],
    content: `${AGENCY_HEADER}
${title('FIELD INTERVIEW CARD')}
<table>
  <tr>
    <td>${field('FI #', '{{fi_number}}')}</td>
    <td>${field('Date/Time', '{{contact_date}}')}</td>
  </tr>
  <tr>
    <td colspan="2">${field('Location', '{{location}}')}</td>
  </tr>
  <tr>
    <td>${field('Officer', '{{officer}}')}</td>
    <td>${field('Badge #', '{{badge_number}}')}</td>
  </tr>
</table>
${section('SUBJECT')}
<table>
  <tr>
    <td>${field('Name', '{{subject_name}}')}</td>
    <td>${field('DOB', '{{subject_dob}}')}</td>
  </tr>
  <tr>
    <td>${field('Race/Sex', '')}</td>
    <td>${field('Height/Weight', '')}</td>
  </tr>
  <tr>
    <td>${field('Clothing', '')}</td>
    <td>${field('SMT (scars/marks/tattoos)', '')}</td>
  </tr>
  <tr>
    <td>${field('Vehicle (if any)', '')}</td>
    <td>${field('Plate', '')}</td>
  </tr>
</table>
${section('BASIS FOR CONTACT')}
<p>☐ Consensual encounter &nbsp; ☐ Reasonable suspicion &nbsp; ☐ Suspicious activity &nbsp; ☐ Other</p>
<p>&nbsp;</p>
${section('NOTES')}
<p>&nbsp;</p>
<p>&nbsp;</p>`,
  },
  {
    id: 'daily-activity-log',
    name: 'Daily Activity Log',
    category: 'supplemental',
    description: 'Shift activity log — chronological entries, calls, and mileage',
    fields: [
      { key: 'officer', label: 'Officer', source: 'user' },
      { key: 'badge_number', label: 'Badge Number', source: 'user' },
      { key: 'log_date', label: 'Date', source: 'manual' },
      { key: 'shift', label: 'Shift', source: 'manual' },
      { key: 'unit', label: 'Unit / Vehicle', source: 'manual' },
    ],
    content: `${AGENCY_HEADER}
${title('DAILY ACTIVITY LOG')}
<table>
  <tr>
    <td>${field('Officer', '{{officer}} (#{{badge_number}})')}</td>
    <td>${field('Date', '{{log_date}}')}</td>
  </tr>
  <tr>
    <td>${field('Shift', '{{shift}}')}</td>
    <td>${field('Unit', '{{unit}}')}</td>
  </tr>
</table>
<table>
  <tr>
    <th>Time</th>
    <th>Call / Type</th>
    <th>Activity / Location</th>
    <th>Disp.</th>
  </tr>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
</table>
<table>
  <tr>
    <td>${field('Beginning Mileage', '')}</td>
    <td>${field('Ending Mileage', '')}</td>
  </tr>
  <tr>
    <td>${field('Total Miles', '')}</td>
    <td>${field('Total Calls', '')}</td>
  </tr>
</table>
${section('END-OF-SHIFT NOTES')}
<p>&nbsp;</p>`,
  },
  {
    id: 'trespass-warning',
    name: 'Trespass Warning',
    category: 'incident',
    description: 'Formal trespass / no-trespass warning notice with subject acknowledgment',
    fields: [
      { key: 'case_number', label: 'Case Number', source: 'cad', cadPath: 'call.call_number' },
      { key: 'warn_date', label: 'Date/Time Issued', source: 'manual' },
      { key: 'property', label: 'Property / Address', source: 'cad', cadPath: 'call.address' },
      { key: 'subject_name', label: 'Subject Name', source: 'manual' },
      { key: 'subject_dob', label: 'Subject DOB', source: 'manual' },
      { key: 'officer', label: 'Issuing Officer', source: 'user' },
      { key: 'badge_number', label: 'Badge Number', source: 'user' },
    ],
    content: `${AGENCY_HEADER}
${title('TRESPASS WARNING NOTICE')}
<table>
  <tr>
    <td>${field('Case #', '{{case_number}}')}</td>
    <td>${field('Date/Time', '{{warn_date}}')}</td>
  </tr>
  <tr>
    <td colspan="2">${field('Property', '{{property}}')}</td>
  </tr>
  <tr>
    <td>${field('Subject', '{{subject_name}}')}</td>
    <td>${field('DOB', '{{subject_dob}}')}</td>
  </tr>
  <tr>
    <td>${field('Issuing Officer', '{{officer}}')}</td>
    <td>${field('Badge #', '{{badge_number}}')}</td>
  </tr>
</table>
${section('NOTICE')}
<p>You, {{subject_name}}, are hereby formally warned that you are no longer permitted on the property described above. This warning is issued on behalf of the property owner or authorized agent. Returning to this property may result in your arrest for criminal trespass pursuant to applicable Utah Code.</p>
<p><strong>This warning remains in effect until rescinded by the property owner/agent or by court order.</strong></p>
${section('ACKNOWLEDGMENT')}
<p>☐ Subject acknowledged and signed &nbsp;&nbsp; ☐ Subject refused to sign &nbsp;&nbsp; ☐ Subject not present (served by other means)</p>
<div style="margin-top:40px;">
  <table>
    <tr>
      <td>&nbsp;</td>
      <td>&nbsp;</td>
      <td>&nbsp;</td>
    </tr>
    <tr>
      <td>Subject Signature</td>
      <td>&nbsp;</td>
      <td>Date / Time</td>
    </tr>
    <tr>
      <td>&nbsp;</td>
      <td>&nbsp;</td>
      <td>&nbsp;</td>
    </tr>
    <tr>
      <td>Issuing Officer Signature</td>
      <td>&nbsp;</td>
      <td>Date</td>
    </tr>
  </table>
</div>`,
  },
  {
    id: 'vehicle-tow-impound',
    name: 'Vehicle Tow/Impound Report',
    category: 'traffic',
    description: 'Vehicle tow / impound documentation with inventory and release info',
    fields: [
      { key: 'case_number', label: 'Case Number', source: 'cad', cadPath: 'call.call_number' },
      { key: 'tow_date', label: 'Date/Time of Tow', source: 'manual' },
      { key: 'location', label: 'Tow Location', source: 'cad', cadPath: 'call.address' },
      { key: 'plate', label: 'License Plate', source: 'manual' },
      { key: 'vin', label: 'VIN', source: 'manual' },
      { key: 'make_model', label: 'Year/Make/Model', source: 'manual' },
      { key: 'officer', label: 'Officer', source: 'user' },
      { key: 'badge_number', label: 'Badge Number', source: 'user' },
    ],
    content: `${AGENCY_HEADER}
${title('VEHICLE TOW / IMPOUND REPORT')}
<table>
  <tr><td>${field('Case #', '{{case_number}}')}</td><td>${field('Date/Time', '{{tow_date}}')}</td></tr>
  <tr><td colspan="2">${field('Location', '{{location}}')}</td></tr>
  <tr><td>${field('Plate', '{{plate}}')}</td><td>${field('VIN', '{{vin}}')}</td></tr>
  <tr><td colspan="2">${field('Year/Make/Model', '{{make_model}}')}</td></tr>
  <tr><td>${field('Officer', '{{officer}}')}</td><td>${field('Badge #', '{{badge_number}}')}</td></tr>
</table>
${section('REASON FOR TOW')}
<p>☐ Abandoned &nbsp; ☐ Arrest of operator &nbsp; ☐ Recovered stolen &nbsp; ☐ Traffic hazard &nbsp; ☐ Evidence hold &nbsp; ☐ Other</p>
${section('TOW COMPANY')}
<table>
  <tr><td>${field('Company', '')}</td><td>${field('Driver', '')}</td></tr>
  <tr><td>${field('Stored At', '')}</td><td>${field('Hold Type', '☐ Owner release ☐ Police hold')}</td></tr>
</table>
${section('VEHICLE CONDITION &amp; INVENTORY')}
<p><em>Document pre-existing damage and any property/contents inventoried.</em></p>
<table>
  <tr><th>Item</th><th>Description / Location in Vehicle</th></tr>
  <tr><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>&nbsp;</td><td>&nbsp;</td></tr>
</table>
<div style="margin-top:40px;"><table>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>Officer Signature</td><td>&nbsp;</td><td>Date</td></tr>
</table></div>`,
  },
  {
    id: 'evidence-property-receipt',
    name: 'Evidence/Property Receipt',
    category: 'evidence',
    description: 'Receipt issued to a person for property taken or returned',
    fields: [
      { key: 'case_number', label: 'Case Number', source: 'manual' },
      { key: 'receipt_date', label: 'Date', source: 'manual' },
      { key: 'person_name', label: 'Person Name', source: 'manual' },
      { key: 'officer', label: 'Officer', source: 'user' },
      { key: 'badge_number', label: 'Badge Number', source: 'user' },
    ],
    content: `${AGENCY_HEADER}
${title('PROPERTY RECEIPT')}
<table>
  <tr><td>${field('Case #', '{{case_number}}')}</td><td>${field('Date', '{{receipt_date}}')}</td></tr>
  <tr><td colspan="2">${field('Issued To / Taken From', '{{person_name}}')}</td></tr>
  <tr><td>${field('Officer', '{{officer}}')}</td><td>${field('Badge #', '{{badge_number}}')}</td></tr>
</table>
<p>☐ Property <strong>seized / taken into custody</strong> &nbsp;&nbsp; ☐ Property <strong>returned / released</strong></p>
${section('ITEMS')}
<table>
  <tr><th>#</th><th>Description</th><th>Qty</th><th>Serial / Identifier</th></tr>
  <tr><td>1</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>2</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
</table>
<p>I acknowledge receipt of the items listed above.</p>
<div style="margin-top:40px;"><table>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>Recipient Signature</td><td>&nbsp;</td><td>Date</td></tr>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>Officer Signature</td><td>&nbsp;</td><td>Date</td></tr>
</table></div>`,
  },
  {
    id: 'citation-traffic-narrative',
    name: 'Citation/Traffic Narrative',
    category: 'traffic',
    description: 'Narrative supporting a traffic citation — stop, observations, and violations',
    fields: [
      { key: 'citation_number', label: 'Citation Number', source: 'manual' },
      { key: 'stop_date', label: 'Date/Time of Stop', source: 'manual' },
      { key: 'location', label: 'Location of Stop', source: 'cad', cadPath: 'call.address' },
      { key: 'driver_name', label: 'Driver Name', source: 'manual' },
      { key: 'plate', label: 'Plate', source: 'manual' },
      { key: 'violation', label: 'Primary Violation', source: 'manual' },
      { key: 'officer', label: 'Officer', source: 'user' },
      { key: 'badge_number', label: 'Badge Number', source: 'user' },
    ],
    content: `${AGENCY_HEADER}
${title('TRAFFIC CITATION NARRATIVE')}
<table>
  <tr><td>${field('Citation #', '{{citation_number}}')}</td><td>${field('Date/Time', '{{stop_date}}')}</td></tr>
  <tr><td colspan="2">${field('Location', '{{location}}')}</td></tr>
  <tr><td>${field('Driver', '{{driver_name}}')}</td><td>${field('Plate', '{{plate}}')}</td></tr>
  <tr><td>${field('Violation', '{{violation}}')}</td><td>${field('Officer', '{{officer}} (#{{badge_number}})')}</td></tr>
</table>
${section('REASONABLE SUSPICION FOR STOP')}
<p>On {{stop_date}}, I, {{officer}} (Badge #{{badge_number}}), observed a vehicle bearing plate {{plate}} at {{location}}.</p>
<p>&nbsp;</p>
${section('OBSERVATIONS / VIOLATIONS')}
<p>&nbsp;</p>
${section('DISPOSITION')}
<p>☐ Citation issued &nbsp; ☐ Written warning &nbsp; ☐ Verbal warning &nbsp; ☐ Arrest &nbsp; ☐ Vehicle towed</p>
<div style="margin-top:40px;"><table>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>Officer Signature</td><td>&nbsp;</td><td>Date</td></tr>
</table></div>`,
  },
  {
    id: 'bolo',
    name: 'BOLO (Be On Lookout)',
    category: 'bolo',
    description: 'Be-on-the-lookout bulletin for a person or vehicle',
    fields: [
      { key: 'bolo_number', label: 'BOLO Number', source: 'manual' },
      { key: 'issue_date', label: 'Date/Time Issued', source: 'manual' },
      { key: 'subject', label: 'Subject / Vehicle', source: 'manual' },
      { key: 'related_case', label: 'Related Case #', source: 'manual' },
      { key: 'officer', label: 'Issuing Officer', source: 'user' },
      { key: 'badge_number', label: 'Badge Number', source: 'user' },
    ],
    content: `${AGENCY_HEADER}
${title('⚠ BE ON THE LOOKOUT (BOLO)', '#c0392b')}
<table>
  <tr><td>${field('BOLO #', '{{bolo_number}}')}</td><td>${field('Issued', '{{issue_date}}')}</td></tr>
  <tr><td>${field('Related Case #', '{{related_case}}')}</td><td>${field('Issued By', '{{officer}} (#{{badge_number}})')}</td></tr>
</table>
<p style="font-size:14px;"><strong>SUBJECT:</strong> {{subject}}</p>
${section('DESCRIPTION')}
<table>
  <tr><td>${field('Name / Aliases', '')}</td><td>${field('DOB / Age', '')}</td></tr>
  <tr><td>${field('Race / Sex', '')}</td><td>${field('Height / Weight', '')}</td></tr>
  <tr><td>${field('Clothing', '')}</td><td>${field('SMT', '')}</td></tr>
  <tr><td>${field('Vehicle / Plate', '')}</td><td>${field('Direction of Travel', '')}</td></tr>
</table>
${section('REASON / CAUTION')}
<p>☐ Wanted &nbsp; ☐ Suspect &nbsp; ☐ Missing &nbsp; ☐ Witness &nbsp; ☐ Armed &amp; dangerous &nbsp; ☐ Approach with caution</p>
<p>&nbsp;</p>
${section('IF LOCATED')}
<p>Contact {{officer}} (#{{badge_number}}) or Dispatch. Reference BOLO #{{bolo_number}}.</p>`,
  },
  {
    id: 'search-warrant-affidavit',
    name: 'Search Warrant Affidavit',
    category: 'warrant',
    description: 'Affidavit in support of an application for a search warrant',
    fields: [
      { key: 'affiant', label: 'Affiant (Officer)', source: 'user' },
      { key: 'badge_number', label: 'Badge Number', source: 'user' },
      { key: 'affidavit_date', label: 'Date', source: 'manual' },
      { key: 'premises', label: 'Place to be Searched', source: 'manual' },
      { key: 'items', label: 'Items to be Seized', source: 'manual' },
      { key: 'county', label: 'County', source: 'manual' },
    ],
    content: `${AGENCY_HEADER}
${title('AFFIDAVIT FOR SEARCH WARRANT')}
<p style="text-align:center;">STATE OF UTAH, COUNTY OF {{county}}</p>
<p>I, {{affiant}} (Badge #{{badge_number}}), being first duly sworn, depose and state the following in support of an application for a search warrant:</p>
${section('1. AFFIANT QUALIFICATIONS')}
<p>Your affiant is a sworn officer with Rocky Mountain Protective Group and has been so employed for ______ years. Your affiant has training and experience in&hellip;</p>
${section('2. PLACE / PERSON TO BE SEARCHED')}
<p>{{premises}}</p>
${section('3. ITEMS TO BE SEIZED')}
<p>{{items}}</p>
${section('4. STATEMENT OF PROBABLE CAUSE')}
<p><em>Set forth the facts establishing probable cause, in chronological detail.</em></p>
<p>&nbsp;</p>
<p>&nbsp;</p>
${section('5. CONCLUSION')}
<p>Based on the foregoing, your affiant has probable cause to believe, and does believe, that the items described above will be found at the place described, and respectfully requests that a search warrant be issued.</p>
<div style="margin-top:40px;"><table>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>Affiant Signature</td><td>&nbsp;</td><td>Date</td></tr>
</table></div>
<p style="margin-top:24px;">Subscribed and sworn to before me this ______ day of ____________, 20____.</p>
<p style="margin-top:32px;">_______________________________<br>Judge / Magistrate</p>`,
  },
  {
    id: 'consent-to-search',
    name: 'Consent-to-Search Form',
    category: 'consent',
    description: 'Voluntary consent-to-search authorization with acknowledgment',
    fields: [
      { key: 'consent_date', label: 'Date/Time', source: 'manual' },
      { key: 'person_name', label: 'Person Granting Consent', source: 'manual' },
      { key: 'location', label: 'Place / Vehicle to be Searched', source: 'cad', cadPath: 'call.address' },
      { key: 'officer', label: 'Officer', source: 'user' },
      { key: 'badge_number', label: 'Badge Number', source: 'user' },
    ],
    content: `${AGENCY_HEADER}
${title('CONSENT TO SEARCH')}
<p><strong>Date/Time:</strong> {{consent_date}}</p>
<p>I, <strong>{{person_name}}</strong>, having been informed of my constitutional right <u>not</u> to have a search made of the premises, vehicle, or property described below without a search warrant, and of my right to refuse to consent to such a search, hereby authorize {{officer}} (Badge #{{badge_number}}) and any assisting officers of Rocky Mountain Protective Group to conduct a complete search of:</p>
<p style="border:1px solid #333;padding:8px;margin:12px 0;"><strong>{{location}}</strong></p>
<p>These officers are authorized by me to take any items they may determine to be related to their investigation. This written permission is being given by me voluntarily and without threats or promises of any kind.</p>
<p>☐ I have read this form &nbsp;&nbsp; ☐ This form was read to me &nbsp;&nbsp; ☐ I understand my rights</p>
<div style="margin-top:40px;"><table>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>Signature of Person Consenting</td><td>&nbsp;</td><td>Date / Time</td></tr>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>Witnessing Officer</td><td>&nbsp;</td><td>Date</td></tr>
</table></div>`,
  },
  {
    id: 'miranda-waiver',
    name: 'Miranda Waiver',
    category: 'consent',
    description: 'Miranda rights advisement and waiver form',
    fields: [
      { key: 'waiver_date', label: 'Date/Time', source: 'manual' },
      { key: 'subject_name', label: 'Subject Name', source: 'manual' },
      { key: 'case_number', label: 'Case Number', source: 'manual' },
      { key: 'officer', label: 'Advising Officer', source: 'user' },
      { key: 'badge_number', label: 'Badge Number', source: 'user' },
    ],
    content: `${AGENCY_HEADER}
${title('MIRANDA WARNING &amp; WAIVER')}
<table>
  <tr><td>${field('Case #', '{{case_number}}')}</td><td>${field('Date/Time', '{{waiver_date}}')}</td></tr>
  <tr><td>${field('Subject', '{{subject_name}}')}</td><td>${field('Officer', '{{officer}} (#{{badge_number}})')}</td></tr>
</table>
${section('YOUR RIGHTS')}
<ol>
  <li>You have the right to remain silent.</li>
  <li>Anything you say can and will be used against you in a court of law.</li>
  <li>You have the right to talk to a lawyer and have him/her present with you while you are being questioned.</li>
  <li>If you cannot afford to hire a lawyer, one will be appointed to represent you before any questioning if you wish.</li>
  <li>You can decide at any time to exercise these rights and not answer any questions or make any statements.</li>
</ol>
${section('WAIVER')}
<p>I have read this statement of my rights, or it has been read to me, and I understand what my rights are. I am willing to make a statement and answer questions. I do not want a lawyer at this time. I understand and know what I am doing. No promises or threats have been made to me and no pressure or coercion of any kind has been used against me.</p>
<p>☐ Rights read &nbsp;&nbsp; ☐ Subject understands &nbsp;&nbsp; ☐ Subject waives &nbsp;&nbsp; ☐ Subject invokes</p>
<div style="margin-top:40px;"><table>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>Subject Signature</td><td>&nbsp;</td><td>Time</td></tr>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>Witnessing Officer</td><td>&nbsp;</td><td>Date</td></tr>
</table></div>`,
  },
  {
    id: 'medical-release',
    name: 'Medical Release / Refusal',
    category: 'medical',
    description: 'Medical treatment refusal / authorization with acknowledgment of risk',
    fields: [
      { key: 'case_number', label: 'Case Number', source: 'cad', cadPath: 'call.call_number' },
      { key: 'release_date', label: 'Date/Time', source: 'manual' },
      { key: 'patient_name', label: 'Patient Name', source: 'manual' },
      { key: 'location', label: 'Location', source: 'cad', cadPath: 'call.address' },
      { key: 'officer', label: 'Officer', source: 'user' },
      { key: 'badge_number', label: 'Badge Number', source: 'user' },
    ],
    content: `${AGENCY_HEADER}
${title('MEDICAL TREATMENT RELEASE / REFUSAL')}
<table>
  <tr><td>${field('Case #', '{{case_number}}')}</td><td>${field('Date/Time', '{{release_date}}')}</td></tr>
  <tr><td>${field('Patient', '{{patient_name}}')}</td><td>${field('Location', '{{location}}')}</td></tr>
  <tr><td colspan="2">${field('Officer', '{{officer}} (#{{badge_number}})')}</td></tr>
</table>
${section('ACTION')}
<p>☐ EMS summoned and patient transported &nbsp;&nbsp; ☐ Patient <strong>REFUSED</strong> medical treatment / transport</p>
${section('REFUSAL ACKNOWLEDGMENT')}
<p>I, {{patient_name}}, have been advised that I may have a medical condition requiring evaluation and that refusing care may result in worsening of my condition, including permanent injury or death. I am refusing medical treatment and/or transport against the advice of emergency personnel and officers. I assume all responsibility and release Rocky Mountain Protective Group, its officers, and EMS from any liability arising from this refusal.</p>
<p>☐ Patient is alert and oriented (A&amp;Ox4) &nbsp;&nbsp; ☐ Patient appears competent to refuse</p>
<div style="margin-top:40px;"><table>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>Patient Signature</td><td>&nbsp;</td><td>Time</td></tr>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>Witnessing Officer</td><td>&nbsp;</td><td>Date</td></tr>
</table></div>`,
  },
  {
    id: 'crash-collision',
    name: 'Crash/Collision Report',
    category: 'crash',
    description: 'Motor-vehicle crash report with units, diagram, and contributing factors',
    fields: [
      { key: 'case_number', label: 'Case Number', source: 'cad', cadPath: 'call.call_number' },
      { key: 'crash_date', label: 'Date/Time of Crash', source: 'cad', cadPath: 'call.received_at' },
      { key: 'location', label: 'Location', source: 'cad', cadPath: 'call.address' },
      { key: 'officer', label: 'Investigating Officer', source: 'user' },
      { key: 'badge_number', label: 'Badge Number', source: 'user' },
    ],
    content: `${AGENCY_HEADER}
${title('MOTOR VEHICLE CRASH REPORT')}
<table>
  <tr><td>${field('Case #', '{{case_number}}')}</td><td>${field('Date/Time', '{{crash_date}}')}</td></tr>
  <tr><td colspan="2">${field('Location', '{{location}}')}</td></tr>
  <tr><td colspan="2">${field('Officer', '{{officer}} (#{{badge_number}})')}</td></tr>
  <tr><td>${field('Weather', '')}</td><td>${field('Road / Light Conditions', '')}</td></tr>
</table>
${section('UNIT 1')}
<table>
  <tr><td>${field('Driver', '')}</td><td>${field('DL #', '')}</td></tr>
  <tr><td>${field('Year/Make/Model', '')}</td><td>${field('Plate', '')}</td></tr>
  <tr><td>${field('Insurance', '')}</td><td>${field('Damage', '')}</td></tr>
</table>
${section('UNIT 2')}
<table>
  <tr><td>${field('Driver', '')}</td><td>${field('DL #', '')}</td></tr>
  <tr><td>${field('Year/Make/Model', '')}</td><td>${field('Plate', '')}</td></tr>
  <tr><td>${field('Insurance', '')}</td><td>${field('Damage', '')}</td></tr>
</table>
${section('INJURIES')}
<p>☐ None &nbsp; ☐ Possible &nbsp; ☐ Non-incapacitating &nbsp; ☐ Incapacitating &nbsp; ☐ Fatal &nbsp;&nbsp;|&nbsp;&nbsp; EMS: ☐ Yes ☐ No</p>
${section('CONTRIBUTING FACTORS')}
<p>☐ Speed &nbsp; ☐ Failure to yield &nbsp; ☐ Following too close &nbsp; ☐ DUI suspected &nbsp; ☐ Distracted &nbsp; ☐ Weather &nbsp; ☐ Other</p>
${section('DIAGRAM')}
<p style="border:1px dashed #555;height:160px;text-align:center;color:#888;padding-top:70px;">Crash diagram area — draw or insert image</p>
${section('NARRATIVE')}
<p>&nbsp;</p><p>&nbsp;</p>
<div style="margin-top:40px;"><table>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>Investigating Officer Signature</td><td>&nbsp;</td><td>Date</td></tr>
</table></div>`,
  },
  {
    id: 'dv-supplement',
    name: 'Domestic Violence Supplement',
    category: 'supplemental',
    description: 'Domestic violence incident supplement — relationship, lethality, and EPO',
    fields: [
      { key: 'case_number', label: 'Case Number', source: 'cad', cadPath: 'call.call_number' },
      { key: 'incident_date', label: 'Incident Date/Time', source: 'cad', cadPath: 'call.received_at' },
      { key: 'location', label: 'Location', source: 'cad', cadPath: 'call.address' },
      { key: 'victim_name', label: 'Victim Name', source: 'manual' },
      { key: 'suspect_name', label: 'Suspect Name', source: 'manual' },
      { key: 'officer', label: 'Officer', source: 'user' },
      { key: 'badge_number', label: 'Badge Number', source: 'user' },
    ],
    content: `${AGENCY_HEADER}
${title('DOMESTIC VIOLENCE SUPPLEMENT', '#c0392b')}
<p style="text-align:center;font-size:10px;color:#888;">CONFIDENTIAL — Victim information is protected. Handle per agency DV policy.</p>
<table>
  <tr><td>${field('Case #', '{{case_number}}')}</td><td>${field('Date/Time', '{{incident_date}}')}</td></tr>
  <tr><td colspan="2">${field('Location', '{{location}}')}</td></tr>
  <tr><td>${field('Victim', '{{victim_name}}')}</td><td>${field('Suspect', '{{suspect_name}}')}</td></tr>
  <tr><td colspan="2">${field('Officer', '{{officer}} (#{{badge_number}})')}</td></tr>
</table>
${section('RELATIONSHIP')}
<p>☐ Spouse &nbsp; ☐ Ex-spouse &nbsp; ☐ Cohabitant &nbsp; ☐ Dating &nbsp; ☐ Parent/Child &nbsp; ☐ Shared child &nbsp; ☐ Other family</p>
${section('PRIMARY AGGRESSOR DETERMINATION')}
<p><em>Document injuries, history, fear, and relative size/strength used to determine the primary aggressor.</em></p>
<p>&nbsp;</p>
${section('LETHALITY / RISK FACTORS')}
<p>☐ Strangulation &nbsp; ☐ Weapon involved &nbsp; ☐ Threats to kill &nbsp; ☐ Prior DV &nbsp; ☐ Pregnancy &nbsp; ☐ Escalating frequency &nbsp; ☐ Children present</p>
${section('ACTIONS TAKEN')}
<p>☐ Arrest made &nbsp; ☐ EPO requested &nbsp; ☐ Victim advised of rights &nbsp; ☐ Resources provided &nbsp; ☐ Photos taken &nbsp; ☐ Medical/EMS</p>
${section('NARRATIVE')}
<p>&nbsp;</p><p>&nbsp;</p>
<div style="margin-top:40px;"><table>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>Officer Signature</td><td>&nbsp;</td><td>Date</td></tr>
</table></div>`,
  },
  {
    id: 'missing-person',
    name: 'Missing Person Report',
    category: 'missing',
    description: 'Missing / endangered person report with physical description and risk',
    fields: [
      { key: 'case_number', label: 'Case Number', source: 'cad', cadPath: 'call.call_number' },
      { key: 'report_date', label: 'Date/Time Reported', source: 'manual' },
      { key: 'missing_name', label: 'Missing Person Name', source: 'manual' },
      { key: 'missing_dob', label: 'DOB / Age', source: 'manual' },
      { key: 'last_seen', label: 'Last Seen Location', source: 'cad', cadPath: 'call.address' },
      { key: 'reporter', label: 'Reporting Party', source: 'manual' },
      { key: 'officer', label: 'Officer', source: 'user' },
      { key: 'badge_number', label: 'Badge Number', source: 'user' },
    ],
    content: `${AGENCY_HEADER}
${title('MISSING PERSON REPORT')}
<table>
  <tr><td>${field('Case #', '{{case_number}}')}</td><td>${field('Reported', '{{report_date}}')}</td></tr>
  <tr><td>${field('Missing Person', '{{missing_name}}')}</td><td>${field('DOB/Age', '{{missing_dob}}')}</td></tr>
  <tr><td colspan="2">${field('Last Seen', '{{last_seen}}')}</td></tr>
  <tr><td>${field('Reporting Party', '{{reporter}}')}</td><td>${field('Officer', '{{officer}} (#{{badge_number}})')}</td></tr>
</table>
${section('CLASSIFICATION')}
<p>☐ Juvenile runaway &nbsp; ☐ Endangered &nbsp; ☐ Involuntary/abduction &nbsp; ☐ Disability &nbsp; ☐ Catastrophe &nbsp; ☐ Adult</p>
${section('PHYSICAL DESCRIPTION')}
<table>
  <tr><td>${field('Race/Sex', '')}</td><td>${field('Height/Weight', '')}</td></tr>
  <tr><td>${field('Hair/Eyes', '')}</td><td>${field('SMT', '')}</td></tr>
  <tr><td>${field('Clothing last worn', '')}</td><td>${field('Glasses/Medical needs', '')}</td></tr>
  <tr><td colspan="2">${field('Vehicle (if any) / Plate', '')}</td></tr>
</table>
${section('RISK / MEDICAL')}
<p>☐ Requires medication &nbsp; ☐ Suicidal &nbsp; ☐ Cognitive impairment &nbsp; ☐ Foul play suspected &nbsp; ☐ Cold/exposure risk</p>
${section('ENTERED INTO NCIC')}
<p>☐ Yes — NCIC #: ____________ &nbsp;&nbsp; ☐ No &nbsp;&nbsp;|&nbsp;&nbsp; ☐ Endangered/Missing alert requested</p>
${section('NARRATIVE / CIRCUMSTANCES')}
<p>&nbsp;</p><p>&nbsp;</p>
<div style="margin-top:40px;"><table>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>Officer Signature</td><td>&nbsp;</td><td>Date</td></tr>
</table></div>`,
  },
  // ── Wave-3 templates ──────────────────────────────────────────────────────
  {
    id: 'booking-sheet',
    name: 'Booking Sheet',
    category: 'booking',
    description: 'Arrestee booking/intake sheet with property, medical, and charges',
    fields: [
      { key: 'booking_no', label: 'Booking #', source: 'manual' },
      { key: 'case_number', label: 'Case Number', source: 'cad', cadPath: 'call.call_number' },
      { key: 'arrestee_name', label: 'Arrestee Name', source: 'manual' },
      { key: 'arrestee_dob', label: 'DOB', source: 'manual' },
      { key: 'booking_officer', label: 'Booking Officer', source: 'user' },
      { key: 'booking_date', label: 'Booking Date/Time', source: 'manual' },
    ],
    content: `${AGENCY_HEADER}
${title('BOOKING SHEET')}
<table>
  <tr><td>${field('Booking #', '{{booking_no}}')}</td><td>${field('Case #', '{{case_number}}')}</td></tr>
  <tr><td>${field('Arrestee', '{{arrestee_name}}')}</td><td>${field('DOB', '{{arrestee_dob}}')}</td></tr>
  <tr><td>${field('Booking Officer', '{{booking_officer}}')}</td><td>${field('Date/Time', '{{booking_date}}')}</td></tr>
</table>
${section('PHYSICAL DESCRIPTION')}
<table>
  <tr><td>${field('Sex', '')}</td><td>${field('Race', '')}</td><td>${field('Height', '')}</td><td>${field('Weight', '')}</td></tr>
  <tr><td>${field('Hair', '')}</td><td>${field('Eyes', '')}</td><td colspan="2">${field('SMT', '')}</td></tr>
</table>
${section('CHARGES')}
<table>
  <tr><th>Statute</th><th>Charge</th><th>Class</th><th>Bail</th></tr>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
</table>
${section('MEDICAL SCREENING')}
<p>☐ Medical conditions reported &nbsp; ☐ Current medications &nbsp; ☐ Suicide risk screen completed &nbsp; ☐ Under influence</p>
<p>Notes: &nbsp;</p>
${section('PERSONAL PROPERTY INVENTORY')}
<table>
  <tr><th>Item</th><th>Description</th><th>Disposition</th></tr>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
</table>
<div style="margin-top:40px;"><table>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>Booking Officer Signature</td><td>&nbsp;</td><td>Date</td></tr>
</table></div>`,
  },
  {
    id: 'property-inventory',
    name: 'Property Inventory',
    category: 'property',
    description: 'Inventory of property taken into custody or safekeeping',
    fields: [
      { key: 'case_number', label: 'Case Number', source: 'cad', cadPath: 'call.call_number' },
      { key: 'owner_name', label: 'Owner / Subject', source: 'manual' },
      { key: 'officer', label: 'Inventorying Officer', source: 'user' },
      { key: 'date', label: 'Date', source: 'manual' },
      { key: 'location', label: 'Location', source: 'cad', cadPath: 'call.address' },
    ],
    content: `${AGENCY_HEADER}
${title('PROPERTY INVENTORY')}
<table>
  <tr><td>${field('Case #', '{{case_number}}')}</td><td>${field('Date', '{{date}}')}</td></tr>
  <tr><td>${field('Owner / Subject', '{{owner_name}}')}</td><td>${field('Officer', '{{officer}}')}</td></tr>
  <tr><td colspan="2">${field('Location', '{{location}}')}</td></tr>
</table>
<p>Reason for inventory: ☐ Safekeeping &nbsp; ☐ Found property &nbsp; ☐ Evidence &nbsp; ☐ Vehicle inventory &nbsp; ☐ Other</p>
<table>
  <tr><th>Item #</th><th>Description</th><th>Qty</th><th>Est. Value</th><th>Condition</th></tr>
  <tr><td>1</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>2</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
</table>
<div style="margin-top:40px;"><table>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>Officer Signature</td><td>&nbsp;</td><td>Date</td></tr>
</table></div>`,
  },
  {
    id: 'k9-deployment',
    name: 'K9 Deployment Report',
    category: 'k9',
    description: 'Canine deployment documentation — search, track, apprehension',
    fields: [
      { key: 'case_number', label: 'Case Number', source: 'cad', cadPath: 'call.call_number' },
      { key: 'handler', label: 'K9 Handler', source: 'user' },
      { key: 'k9_name', label: 'K9 Name', source: 'manual' },
      { key: 'date', label: 'Deployment Date/Time', source: 'manual' },
      { key: 'location', label: 'Location', source: 'cad', cadPath: 'call.address' },
    ],
    content: `${AGENCY_HEADER}
${title('K9 DEPLOYMENT REPORT')}
<table>
  <tr><td>${field('Case #', '{{case_number}}')}</td><td>${field('Date/Time', '{{date}}')}</td></tr>
  <tr><td>${field('Handler', '{{handler}}')}</td><td>${field('K9', '{{k9_name}}')}</td></tr>
  <tr><td colspan="2">${field('Location', '{{location}}')}</td></tr>
</table>
${section('DEPLOYMENT TYPE')}
<p>☐ Article/evidence search &nbsp; ☐ Narcotics detection &nbsp; ☐ Explosives detection &nbsp; ☐ Tracking/trailing &nbsp; ☐ Building search &nbsp; ☐ Apprehension</p>
${section('WARNING / ANNOUNCEMENT')}
<p>☐ K9 warning announcement given prior to deployment &nbsp; Time: ________</p>
<p>Announcement wording / number of times given: &nbsp;</p>
${section('NARRATIVE')}
<p>&nbsp;</p><p>&nbsp;</p>
${section('RESULT')}
<p>☐ Apprehension &nbsp; ☐ Find/alert &nbsp; ☐ Negative &nbsp; ☐ Bite (document injuries below)</p>
<p>Injuries / medical treatment: &nbsp;</p>
<div style="margin-top:40px;"><table>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>Handler Signature</td><td>&nbsp;</td><td>Date</td></tr>
</table></div>`,
  },
  {
    id: 'pursuit-report',
    name: 'Pursuit Report',
    category: 'pursuit',
    description: 'Vehicle pursuit documentation with justification and outcome',
    fields: [
      { key: 'case_number', label: 'Case Number', source: 'cad', cadPath: 'call.call_number' },
      { key: 'officer', label: 'Primary Officer', source: 'user' },
      { key: 'date', label: 'Date/Time', source: 'manual' },
      { key: 'start_location', label: 'Start Location', source: 'manual' },
    ],
    content: `${AGENCY_HEADER}
${title('VEHICLE PURSUIT REPORT', '#c0392b')}
<table>
  <tr><td>${field('Case #', '{{case_number}}')}</td><td>${field('Date/Time', '{{date}}')}</td></tr>
  <tr><td>${field('Primary Officer', '{{officer}}')}</td><td>${field('Start Location', '{{start_location}}')}</td></tr>
</table>
${section('JUSTIFICATION FOR PURSUIT')}
<p>Originating offense: &nbsp;</p>
<p>☐ Felony &nbsp; ☐ Violent crime &nbsp; ☐ DUI &nbsp; ☐ Traffic offense &nbsp; ☐ Other</p>
${section('PURSUIT DETAILS')}
<table>
  <tr><td>${field('Start time', '')}</td><td>${field('End time', '')}</td><td>${field('Duration', '')}</td></tr>
  <tr><td>${field('Max speed', '')}</td><td>${field('Distance', '')}</td><td>${field('Road/weather', '')}</td></tr>
  <tr><td colspan="3"><strong>Suspect vehicle (make/model/color/plate):</strong></td></tr>
</table>
${section('SUPERVISOR NOTIFICATION')}
<p>☐ Supervisor notified &nbsp; Time: ________ &nbsp; ☐ Pursuit authorized &nbsp; ☐ Pursuit terminated by supervisor</p>
${section('NARRATIVE')}
<p>&nbsp;</p><p>&nbsp;</p>
${section('OUTCOME')}
<p>☐ Suspect in custody &nbsp; ☐ Pursuit terminated &nbsp; ☐ Collision &nbsp; ☐ Suspect eluded</p>
<p>Injuries / property damage: &nbsp;</p>
<div style="margin-top:40px;"><table>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>Officer Signature</td><td>&nbsp;</td><td>Date</td></tr>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>Supervisor Signature</td><td>&nbsp;</td><td>Date</td></tr>
</table></div>`,
  },
  {
    id: 'crime-scene-log',
    name: 'Crime Scene Log',
    category: 'scene',
    description: 'Entry/exit log and scene security record for a crime scene',
    fields: [
      { key: 'case_number', label: 'Case Number', source: 'cad', cadPath: 'call.call_number' },
      { key: 'location', label: 'Scene Location', source: 'cad', cadPath: 'call.address' },
      { key: 'officer', label: 'Log Officer', source: 'user' },
      { key: 'date', label: 'Date', source: 'manual' },
    ],
    content: `${AGENCY_HEADER}
${title('CRIME SCENE ENTRY LOG')}
<table>
  <tr><td>${field('Case #', '{{case_number}}')}</td><td>${field('Date', '{{date}}')}</td></tr>
  <tr><td>${field('Scene Location', '{{location}}')}</td><td>${field('Log Officer', '{{officer}}')}</td></tr>
  <tr><td>${field('Scene secured at', '')}</td><td>${field('Released at', '')}</td></tr>
</table>
${section('PERSONNEL ENTRY/EXIT LOG')}
<table>
  <tr><th>Name / Agency</th><th>Purpose</th><th>Time In</th><th>Time Out</th></tr>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
</table>
<p style="font-size:10px;color:#888;"><em>Every person who enters the inner perimeter must be logged. The integrity of this log may be challenged in court.</em></p>`,
  },
  {
    id: 'chain-of-custody',
    name: 'Chain of Custody',
    category: 'custody',
    description: 'Standalone chain-of-custody transfer record for a single item',
    fields: [
      { key: 'case_number', label: 'Case Number', source: 'cad', cadPath: 'call.call_number' },
      { key: 'item_no', label: 'Item / Evidence #', source: 'manual' },
      { key: 'description', label: 'Item Description', source: 'manual' },
      { key: 'officer', label: 'Collecting Officer', source: 'user' },
    ],
    content: `${AGENCY_HEADER}
${title('CHAIN OF CUSTODY')}
<table>
  <tr><td>${field('Case #', '{{case_number}}')}</td><td>${field('Item #', '{{item_no}}')}</td></tr>
  <tr><td colspan="2">${field('Description', '{{description}}')}</td></tr>
  <tr><td colspan="2">${field('Collected by', '{{officer}}')}</td></tr>
</table>
${section('CUSTODY TRANSFERS')}
<table>
  <tr><th>Date/Time</th><th>Released By</th><th>Received By</th><th>Reason</th></tr>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
</table>
<p style="font-size:10px;color:#888;"><em>An unbroken chain of custody must be maintained from collection through final disposition.</em></p>`,
  },
  {
    id: 'interview-transcript',
    name: 'Interview Transcript',
    category: 'interview',
    description: 'Recorded-interview transcript with speaker labels and timestamps',
    fields: [
      { key: 'case_number', label: 'Case Number', source: 'cad', cadPath: 'call.call_number' },
      { key: 'interviewee', label: 'Interviewee', source: 'manual' },
      { key: 'interviewer', label: 'Interviewer', source: 'user' },
      { key: 'date', label: 'Date/Time', source: 'manual' },
      { key: 'location', label: 'Location', source: 'manual' },
    ],
    content: `${AGENCY_HEADER}
${title('INTERVIEW TRANSCRIPT')}
<table>
  <tr><td>${field('Case #', '{{case_number}}')}</td><td>${field('Date/Time', '{{date}}')}</td></tr>
  <tr><td>${field('Interviewee', '{{interviewee}}')}</td><td>${field('Interviewer', '{{interviewer}}')}</td></tr>
  <tr><td colspan="2">${field('Location', '{{location}}')}</td></tr>
</table>
<p>☐ Recorded (audio) &nbsp; ☐ Recorded (video) &nbsp; ☐ Miranda advised prior &nbsp; Recording reference: ________</p>
${section('TRANSCRIPT')}
<p>[00:00] <strong>{{interviewer}}:</strong> &nbsp;</p>
<p>[00:00] <strong>{{interviewee}}:</strong> &nbsp;</p>
<p>&nbsp;</p>
<p style="font-size:10px;color:#888;"><em>Transcript prepared from recording; certified accurate to the best of the transcriber's ability.</em></p>
<div style="margin-top:40px;"><table>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>Transcribed By</td><td>&nbsp;</td><td>Date</td></tr>
</table></div>`,
  },
  {
    id: 'civil-standby',
    name: 'Civil Standby Report',
    category: 'civil',
    description: 'Keep-the-peace civil standby (property/child exchange) documentation',
    fields: [
      { key: 'case_number', label: 'Case Number', source: 'cad', cadPath: 'call.call_number' },
      { key: 'requestor', label: 'Requesting Party', source: 'manual' },
      { key: 'other_party', label: 'Other Party', source: 'manual' },
      { key: 'officer', label: 'Officer', source: 'user' },
      { key: 'date', label: 'Date/Time', source: 'manual' },
      { key: 'location', label: 'Location', source: 'cad', cadPath: 'call.address' },
    ],
    content: `${AGENCY_HEADER}
${title('CIVIL STANDBY REPORT')}
<table>
  <tr><td>${field('Case #', '{{case_number}}')}</td><td>${field('Date/Time', '{{date}}')}</td></tr>
  <tr><td>${field('Requesting Party', '{{requestor}}')}</td><td>${field('Other Party', '{{other_party}}')}</td></tr>
  <tr><td colspan="2">${field('Location', '{{location}}')}</td></tr>
  <tr><td colspan="2">${field('Officer', '{{officer}}')}</td></tr>
</table>
${section('PURPOSE')}
<p>☐ Retrieval of personal property &nbsp; ☐ Child custody exchange &nbsp; ☐ Eviction/lockout &nbsp; ☐ Other</p>
<p>Court order present: ☐ Yes ☐ No &nbsp; Order #: ________</p>
${section('NARRATIVE')}
<p>Officers stood by to keep the peace only and took no position on the underlying civil dispute.</p>
<p>&nbsp;</p>
${section('OUTCOME')}
<p>☐ Completed peacefully &nbsp; ☐ Property exchanged &nbsp; ☐ Parties advised of civil remedies &nbsp; ☐ Enforcement action taken</p>
<div style="margin-top:40px;"><table>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>Officer Signature</td><td>&nbsp;</td><td>Date</td></tr>
</table></div>`,
  },
  {
    id: 'repossession-standby',
    name: 'Repossession Standby',
    category: 'repo',
    description: 'Standby for a lawful vehicle/property repossession',
    fields: [
      { key: 'case_number', label: 'Case Number', source: 'cad', cadPath: 'call.call_number' },
      { key: 'agent', label: 'Repossession Agent', source: 'manual' },
      { key: 'debtor', label: 'Debtor / Owner', source: 'manual' },
      { key: 'officer', label: 'Officer', source: 'user' },
      { key: 'date', label: 'Date/Time', source: 'manual' },
      { key: 'location', label: 'Location', source: 'cad', cadPath: 'call.address' },
    ],
    content: `${AGENCY_HEADER}
${title('REPOSSESSION STANDBY REPORT')}
<table>
  <tr><td>${field('Case #', '{{case_number}}')}</td><td>${field('Date/Time', '{{date}}')}</td></tr>
  <tr><td>${field('Repo Agent', '{{agent}}')}</td><td>${field('Debtor / Owner', '{{debtor}}')}</td></tr>
  <tr><td colspan="2">${field('Location', '{{location}}')}</td></tr>
  <tr><td colspan="2">${field('Officer', '{{officer}}')}</td></tr>
</table>
${section('PROPERTY REPOSSESSED')}
<p>Description (make/model/VIN/plate): &nbsp;</p>
<p>Repo agent license / company: &nbsp;</p>
${section('NARRATIVE')}
<p>Officers were present solely to preserve the peace during a lawful self-help repossession and did not assist in the seizure of property.</p>
<p>&nbsp;</p>
${section('OUTCOME')}
<p>☐ Repossession completed &nbsp; ☐ Breach of peace — repossession ceased &nbsp; ☐ Parties separated &nbsp; ☐ No action</p>
<div style="margin-top:40px;"><table>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>Officer Signature</td><td>&nbsp;</td><td>Date</td></tr>
</table></div>`,
  },
  {
    id: 'welfare-check',
    name: 'Welfare Check Report',
    category: 'welfare',
    description: 'Welfare/wellness check disposition and findings',
    fields: [
      { key: 'case_number', label: 'Case Number', source: 'cad', cadPath: 'call.call_number' },
      { key: 'subject_name', label: 'Subject', source: 'manual' },
      { key: 'requestor', label: 'Requested By', source: 'manual' },
      { key: 'officer', label: 'Officer', source: 'user' },
      { key: 'date', label: 'Date/Time', source: 'manual' },
      { key: 'location', label: 'Location', source: 'cad', cadPath: 'call.address' },
    ],
    content: `${AGENCY_HEADER}
${title('WELFARE CHECK REPORT')}
<table>
  <tr><td>${field('Case #', '{{case_number}}')}</td><td>${field('Date/Time', '{{date}}')}</td></tr>
  <tr><td>${field('Subject', '{{subject_name}}')}</td><td>${field('Requested by', '{{requestor}}')}</td></tr>
  <tr><td colspan="2">${field('Location', '{{location}}')}</td></tr>
  <tr><td colspan="2">${field('Officer', '{{officer}}')}</td></tr>
</table>
${section('REASON FOR CHECK')}
<p>&nbsp;</p>
${section('FINDINGS')}
<p>☐ Subject contacted, appears well &nbsp; ☐ Medical aid rendered (EMS) &nbsp; ☐ Mental-health crisis &nbsp; ☐ Subject not located &nbsp; ☐ Deceased (notify investigations)</p>
<p>&nbsp;</p>
${section('DISPOSITION')}
<p>☐ No further action &nbsp; ☐ Referred to services &nbsp; ☐ Transported &nbsp; ☐ Protective custody</p>
<div style="margin-top:40px;"><table>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>Officer Signature</td><td>&nbsp;</td><td>Date</td></tr>
</table></div>`,
  },
  {
    id: 'use-of-force-supplement',
    name: 'Use-of-Force Supplement',
    category: 'use-of-force',
    description: 'Witness-officer / secondary supplement to a use-of-force incident',
    fields: [
      { key: 'case_number', label: 'Primary Case Number', source: 'manual' },
      { key: 'officer', label: 'Supplementing Officer', source: 'user' },
      { key: 'badge_number', label: 'Badge Number', source: 'user' },
      { key: 'date', label: 'Date', source: 'manual' },
    ],
    content: `${AGENCY_HEADER}
${title('USE-OF-FORCE SUPPLEMENT', '#c0392b')}
<p style="text-align:center;font-size:10px;color:#888;">Attach to the primary Use of Force Report.</p>
<table>
  <tr><td>${field('Primary Case #', '{{case_number}}')}</td><td>${field('Date', '{{date}}')}</td></tr>
  <tr><td colspan="2">${field('Supplementing Officer', '{{officer}} (Badge #{{badge_number}})')}</td></tr>
</table>
${section('ROLE IN INCIDENT')}
<p>☐ Used force &nbsp; ☐ Witnessed force &nbsp; ☐ Arrived after &nbsp; ☐ Supervisor</p>
${section('FORCE USED BY THIS OFFICER (if any)')}
<p>☐ Physical control &nbsp; ☐ OC &nbsp; ☐ CEW &nbsp; ☐ Baton &nbsp; ☐ Firearm &nbsp; ☐ None</p>
${section('OBSERVATIONS / NARRATIVE')}
<p>&nbsp;</p><p>&nbsp;</p>
<div style="margin-top:40px;"><table>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>Officer Signature</td><td>&nbsp;</td><td>Date</td></tr>
</table></div>`,
  },
  {
    id: 'impound-inventory',
    name: 'Impound Inventory',
    category: 'property',
    description: 'Vehicle impound inventory (contents + condition) per agency policy',
    fields: [
      { key: 'case_number', label: 'Case Number', source: 'cad', cadPath: 'call.call_number' },
      { key: 'plate', label: 'Plate / VIN', source: 'manual' },
      { key: 'vehicle', label: 'Vehicle (Year/Make/Model)', source: 'manual' },
      { key: 'officer', label: 'Officer', source: 'user' },
      { key: 'date', label: 'Date/Time', source: 'manual' },
      { key: 'tow_company', label: 'Tow Company', source: 'manual' },
    ],
    content: `${AGENCY_HEADER}
${title('IMPOUND INVENTORY')}
<table>
  <tr><td>${field('Case #', '{{case_number}}')}</td><td>${field('Date/Time', '{{date}}')}</td></tr>
  <tr><td>${field('Vehicle', '{{vehicle}}')}</td><td>${field('Plate / VIN', '{{plate}}')}</td></tr>
  <tr><td>${field('Officer', '{{officer}}')}</td><td>${field('Tow Company', '{{tow_company}}')}</td></tr>
</table>
${section('VEHICLE CONDITION')}
<p>Damage noted (diagram/describe): &nbsp;</p>
<p>Odometer: ________ &nbsp; Fuel: ________ &nbsp; Keys: ☐ Yes ☐ No</p>
${section('CONTENTS INVENTORY')}
<table>
  <tr><th>Location</th><th>Item</th><th>Notes</th></tr>
  <tr><td>Passenger compartment</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>Trunk</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>Glove box / console</td><td>&nbsp;</td><td>&nbsp;</td></tr>
</table>
<p style="font-size:10px;color:#888;"><em>Inventory conducted pursuant to standardized agency impound policy, not for investigative purposes.</em></p>
<div style="margin-top:40px;"><table>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>Officer Signature</td><td>&nbsp;</td><td>Date</td></tr>
</table></div>`,
  },
  {
    id: 'alcohol-tobacco-compliance',
    name: 'Tobacco/Alcohol Compliance',
    category: 'compliance',
    description: 'Compliance-check report for tobacco/alcohol sales to minors',
    fields: [
      { key: 'case_number', label: 'Case / Op Number', source: 'manual' },
      { key: 'business', label: 'Business Name', source: 'manual' },
      { key: 'business_address', label: 'Business Address', source: 'manual' },
      { key: 'officer', label: 'Officer', source: 'user' },
      { key: 'date', label: 'Date/Time', source: 'manual' },
    ],
    content: `${AGENCY_HEADER}
${title('COMPLIANCE CHECK REPORT')}
<table>
  <tr><td>${field('Case / Op #', '{{case_number}}')}</td><td>${field('Date/Time', '{{date}}')}</td></tr>
  <tr><td>${field('Business', '{{business}}')}</td><td>${field('Officer', '{{officer}}')}</td></tr>
  <tr><td colspan="2">${field('Address', '{{business_address}}')}</td></tr>
</table>
${section('CHECK TYPE')}
<p>☐ Tobacco / vapor &nbsp; ☐ Alcohol &nbsp; ☐ Both</p>
${section('DECOY / OPERATIVE')}
<p>Decoy age: ________ &nbsp; ID shown: ☐ Yes ☐ No &nbsp; Clerk asked for ID: ☐ Yes ☐ No</p>
${section('RESULT')}
<p>☐ PASS — sale refused &nbsp; ☐ FAIL — sale completed to minor</p>
<p>Clerk name / DOB (if cited): &nbsp;</p>
<p>Citation #: ________ &nbsp; Statute: ________</p>
${section('NARRATIVE')}
<p>&nbsp;</p>
<div style="margin-top:40px;"><table>
  <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>Officer Signature</td><td>&nbsp;</td><td>Date</td></tr>
</table></div>`,
  },
  {
    id: 'parking-enforcement',
    name: 'Parking Enforcement',
    category: 'parking',
    description: 'Parking citation / enforcement action record',
    fields: [
      { key: 'citation_no', label: 'Citation #', source: 'manual' },
      { key: 'plate', label: 'Plate', source: 'manual' },
      { key: 'vehicle', label: 'Vehicle', source: 'manual' },
      { key: 'officer', label: 'Officer', source: 'user' },
      { key: 'date', label: 'Date/Time', source: 'manual' },
      { key: 'location', label: 'Location', source: 'cad', cadPath: 'call.address' },
    ],
    content: `${AGENCY_HEADER}
${title('PARKING ENFORCEMENT')}
<table>
  <tr><td>${field('Citation #', '{{citation_no}}')}</td><td>${field('Date/Time', '{{date}}')}</td></tr>
  <tr><td>${field('Vehicle', '{{vehicle}}')}</td><td>${field('Plate', '{{plate}}')}</td></tr>
  <tr><td colspan="2">${field('Location', '{{location}}')}</td></tr>
  <tr><td colspan="2">${field('Officer', '{{officer}}')}</td></tr>
</table>
${section('VIOLATION')}
<p>☐ Fire lane &nbsp; ☐ Handicap &nbsp; ☐ No parking zone &nbsp; ☐ Expired meter &nbsp; ☐ Blocking driveway &nbsp; ☐ Time limit &nbsp; ☐ Other</p>
<p>Ordinance / statute: ________ &nbsp; Fine: $________</p>
${section('ACTION TAKEN')}
<p>☐ Citation issued &nbsp; ☐ Warning &nbsp; ☐ Towed (see impound) &nbsp; ☐ Booted</p>
<p>Notes: &nbsp;</p>`,
  },
  {
    id: 'blank',
    name: 'Blank Document',
    category: 'general',
    description: 'Start with a blank page — full formatting tools available',
    fields: [],
    content: `${AGENCY_HEADER}<p>&nbsp;</p>`,
  },
];

// Append 105 new category templates (LE 40 + Security 25 + HR 20 + Legal 20).
TEMPLATES.push(...LE_TEMPLATES, ...SEC_TEMPLATES, ...HR_TEMPLATES, ...LEGAL_TEMPLATES);

export function getTemplate(id: string): DocumentTemplate | undefined {
  return TEMPLATES.find(t => t.id === id);
}

export function populateTemplate(
  template: DocumentTemplate,
  values: Record<string, string>,
  headerConfig?: Partial<HeaderConfig> | null,
): string {
  let html = template.content;
  // Admin-customized letterhead: every template embeds the same AGENCY_HEADER
  // string at module load, so a literal swap re-headers all ~150 templates
  // without touching them. Absent/blank config falls back to the default.
  if (headerConfig && (headerConfig.org_name || headerConfig.tagline != null || headerConfig.address != null)) {
    html = html.split(AGENCY_HEADER).join(buildAgencyHeader({
      org_name: headerConfig.org_name?.trim() || DEFAULT_HEADER.org_name,
      tagline: headerConfig.tagline ?? DEFAULT_HEADER.tagline,
      address: headerConfig.address ?? DEFAULT_HEADER.address,
    }));
  }
  for (const field of template.fields) {
    const val = values[field.key] || '';
    html = html.split(`{{${field.key}}}`).join(val);
  }
  return html;
}
