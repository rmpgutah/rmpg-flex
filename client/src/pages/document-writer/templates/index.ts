import type { DocumentTemplate } from '../types';

const AGENCY_HEADER = `
<div style="text-align:center;margin-bottom:24px;">
  <p style="font-size:16px;font-weight:bold;margin:0;">ROCKY MOUNTAIN PROTECTIVE GROUP</p>
  <p style="font-size:11px;margin:2px 0;color:#666;">Law Enforcement &amp; Private Security Services</p>
  <p style="font-size:10px;margin:2px 0;color:#888;">Salt Lake City, Utah</p>
  <hr style="border:none;border-top:2px solid #d4a017;margin:8px 0;" />
</div>
`;

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
<h1 style="text-align:center;font-size:18px;">INCIDENT REPORT</h1>

<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr>
    <td style="border:1px solid #333;padding:6px;width:50%;"><strong>Case #:</strong> {{case_number}}</td>
    <td style="border:1px solid #333;padding:6px;width:50%;"><strong>Date of Report:</strong> {{date_of_report}}</td>
  </tr>
  <tr>
    <td style="border:1px solid #333;padding:6px;"><strong>Incident Date/Time:</strong> {{incident_date}}</td>
    <td style="border:1px solid #333;padding:6px;"><strong>Location:</strong> {{location}}</td>
  </tr>
  <tr>
    <td style="border:1px solid #333;padding:6px;"><strong>Reporting Officer:</strong> {{reporting_officer}}</td>
    <td style="border:1px solid #333;padding:6px;"><strong>Badge #:</strong> {{badge_number}}</td>
  </tr>
  <tr>
    <td style="border:1px solid #333;padding:6px;"><strong>Offense:</strong> {{offense}}</td>
    <td style="border:1px solid #333;padding:6px;"><strong>Disposition:</strong> {{disposition}}</td>
  </tr>
</table>

<h2 style="font-size:14px;border-bottom:1px solid #333;">INVOLVED PERSONS</h2>
<p><em>List all victims, suspects, witnesses, and other involved parties below.</em></p>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr style="background:#1a1a1a;">
    <th style="border:1px solid #333;padding:6px;text-align:left;">Name</th>
    <th style="border:1px solid #333;padding:6px;text-align:left;">Role</th>
    <th style="border:1px solid #333;padding:6px;text-align:left;">DOB</th>
    <th style="border:1px solid #333;padding:6px;text-align:left;">Contact</th>
  </tr>
  <tr>
    <td style="border:1px solid #333;padding:6px;">&nbsp;</td>
    <td style="border:1px solid #333;padding:6px;">&nbsp;</td>
    <td style="border:1px solid #333;padding:6px;">&nbsp;</td>
    <td style="border:1px solid #333;padding:6px;">&nbsp;</td>
  </tr>
</table>

<h2 style="font-size:14px;border-bottom:1px solid #333;">NARRATIVE</h2>
<p>On {{incident_date}}, I, {{reporting_officer}} (Badge #{{badge_number}}), responded to {{location}} regarding a report of {{offense}}.</p>
<p>&nbsp;</p>
<p>&nbsp;</p>

<h2 style="font-size:14px;border-bottom:1px solid #333;">EVIDENCE / PROPERTY</h2>
<p><em>Describe any evidence collected, property seized, or items of evidentiary value.</em></p>
<p>&nbsp;</p>

<h2 style="font-size:14px;border-bottom:1px solid #333;">DISPOSITION &amp; RECOMMENDATIONS</h2>
<p>Case disposition: {{disposition}}</p>
<p>&nbsp;</p>

<div style="margin-top:48px;">
  <table style="width:100%;border:none;">
    <tr>
      <td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td>
      <td style="width:10%;">&nbsp;</td>
      <td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td>
    </tr>
    <tr>
      <td style="font-size:10px;color:#666;">Officer Signature</td>
      <td>&nbsp;</td>
      <td style="font-size:10px;color:#666;">Date</td>
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
<h1 style="text-align:center;font-size:18px;">ARREST REPORT</h1>

<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr>
    <td style="border:1px solid #333;padding:6px;width:50%;"><strong>Case #:</strong> {{case_number}}</td>
    <td style="border:1px solid #333;padding:6px;"><strong>Arrest Date/Time:</strong> {{arrest_date}}</td>
  </tr>
  <tr>
    <td style="border:1px solid #333;padding:6px;"><strong>Arrestee:</strong> {{arrestee_name}}</td>
    <td style="border:1px solid #333;padding:6px;"><strong>DOB:</strong> {{arrestee_dob}}</td>
  </tr>
  <tr>
    <td style="border:1px solid #333;padding:6px;"><strong>Location:</strong> {{location}}</td>
    <td style="border:1px solid #333;padding:6px;"><strong>Charges:</strong> {{charges}}</td>
  </tr>
  <tr>
    <td style="border:1px solid #333;padding:6px;"><strong>Arresting Officer:</strong> {{arresting_officer}}</td>
    <td style="border:1px solid #333;padding:6px;"><strong>Badge #:</strong> {{badge_number}}</td>
  </tr>
</table>

<h2 style="font-size:14px;border-bottom:1px solid #333;">MIRANDA WARNING</h2>
<p>Miranda rights were read to the arrestee at __________ hours.</p>
<p>☐ Arrestee invoked right to silence &nbsp;&nbsp; ☐ Arrestee waived rights &nbsp;&nbsp; ☐ Written waiver obtained</p>

<h2 style="font-size:14px;border-bottom:1px solid #333;">PROBABLE CAUSE STATEMENT</h2>
<p>&nbsp;</p>
<p>&nbsp;</p>

<h2 style="font-size:14px;border-bottom:1px solid #333;">SEARCH INCIDENT TO ARREST</h2>
<p><em>Describe items found during search.</em></p>
<p>&nbsp;</p>

<h2 style="font-size:14px;border-bottom:1px solid #333;">BOOKING INFORMATION</h2>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr>
    <td style="border:1px solid #333;padding:6px;width:50%;"><strong>Booked at:</strong></td>
    <td style="border:1px solid #333;padding:6px;"><strong>Booking #:</strong></td>
  </tr>
  <tr>
    <td style="border:1px solid #333;padding:6px;"><strong>Bail Amount:</strong></td>
    <td style="border:1px solid #333;padding:6px;"><strong>Court Date:</strong></td>
  </tr>
</table>

<div style="margin-top:48px;">
  <table style="width:100%;border:none;">
    <tr>
      <td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td>
      <td style="width:10%;">&nbsp;</td>
      <td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td>
    </tr>
    <tr>
      <td style="font-size:10px;color:#666;">Arresting Officer Signature</td>
      <td>&nbsp;</td>
      <td style="font-size:10px;color:#666;">Date</td>
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
<h1 style="text-align:center;font-size:18px;color:#c0392b;">USE OF FORCE REPORT</h1>
<p style="text-align:center;font-size:10px;color:#888;">CONFIDENTIAL — This report is subject to internal review and may be discoverable in litigation.</p>

<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr>
    <td style="border:1px solid #333;padding:6px;width:50%;"><strong>Case #:</strong> {{case_number}}</td>
    <td style="border:1px solid #333;padding:6px;"><strong>Date/Time:</strong> {{incident_date}}</td>
  </tr>
  <tr>
    <td style="border:1px solid #333;padding:6px;"><strong>Officer:</strong> {{reporting_officer}} (Badge #{{badge_number}})</td>
    <td style="border:1px solid #333;padding:6px;"><strong>Subject:</strong> {{subject_name}}</td>
  </tr>
  <tr>
    <td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Location:</strong> {{location}}</td>
  </tr>
</table>

<h2 style="font-size:14px;border-bottom:1px solid #333;">TYPE OF FORCE USED</h2>
<p>☐ Physical control/takedown &nbsp; ☐ OC spray &nbsp; ☐ Taser/CEW &nbsp; ☐ Baton &nbsp; ☐ K-9 &nbsp; ☐ Firearm (discharge) &nbsp; ☐ Other</p>

<h2 style="font-size:14px;border-bottom:1px solid #333;">SUBJECT RESISTANCE LEVEL</h2>
<p>☐ Passive resistance &nbsp; ☐ Active resistance &nbsp; ☐ Aggressive resistance &nbsp; ☐ Deadly force threat</p>

<h2 style="font-size:14px;border-bottom:1px solid #333;">DE-ESCALATION ATTEMPTS</h2>
<p><em>Describe all de-escalation techniques attempted prior to use of force.</em></p>
<p>&nbsp;</p>

<h2 style="font-size:14px;border-bottom:1px solid #333;">DETAILED NARRATIVE</h2>
<p><em>Provide a detailed, chronological account of the events leading to, during, and after the use of force.</em></p>
<p>&nbsp;</p>
<p>&nbsp;</p>

<h2 style="font-size:14px;border-bottom:1px solid #333;">INJURIES</h2>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr>
    <td style="border:1px solid #333;padding:6px;width:50%;"><strong>Officer injuries:</strong></td>
    <td style="border:1px solid #333;padding:6px;"><strong>Subject injuries:</strong></td>
  </tr>
  <tr>
    <td style="border:1px solid #333;padding:6px;"><strong>Medical treatment provided:</strong> ☐ Yes ☐ No</td>
    <td style="border:1px solid #333;padding:6px;"><strong>EMS responded:</strong> ☐ Yes ☐ No</td>
  </tr>
</table>

<h2 style="font-size:14px;border-bottom:1px solid #333;">WITNESSES</h2>
<p>&nbsp;</p>

<h2 style="font-size:14px;border-bottom:1px solid #333;">BODY CAMERA / DASHCAM</h2>
<p>☐ Body camera activated &nbsp; ☐ Dashcam recording &nbsp; ☐ No recording available</p>
<p>Camera ID / File reference: ________________</p>

<div style="margin-top:48px;">
  <table style="width:100%;border:none;">
    <tr>
      <td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td>
      <td style="width:10%;">&nbsp;</td>
      <td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td>
    </tr>
    <tr>
      <td style="font-size:10px;color:#666;">Officer Signature</td>
      <td>&nbsp;</td>
      <td style="font-size:10px;color:#666;">Date</td>
    </tr>
    <tr>
      <td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td>
      <td style="width:10%;">&nbsp;</td>
      <td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td>
    </tr>
    <tr>
      <td style="font-size:10px;color:#666;">Supervisor Signature</td>
      <td>&nbsp;</td>
      <td style="font-size:10px;color:#666;">Date</td>
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
<h1 style="text-align:center;font-size:18px;">SUPPLEMENTAL REPORT</h1>

<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr>
    <td style="border:1px solid #333;padding:6px;width:33%;"><strong>Original Case #:</strong> {{case_number}}</td>
    <td style="border:1px solid #333;padding:6px;width:33%;"><strong>Supplement #:</strong> {{supplement_number}}</td>
    <td style="border:1px solid #333;padding:6px;width:34%;"><strong>Date:</strong> {{date_of_report}}</td>
  </tr>
  <tr>
    <td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Officer:</strong> {{reporting_officer}}</td>
    <td style="border:1px solid #333;padding:6px;"><strong>Badge #:</strong> {{badge_number}}</td>
  </tr>
</table>

<h2 style="font-size:14px;border-bottom:1px solid #333;">PURPOSE OF SUPPLEMENT</h2>
<p>☐ Follow-up investigation &nbsp; ☐ Additional witness statement &nbsp; ☐ Evidence update &nbsp; ☐ Status change &nbsp; ☐ Other</p>

<h2 style="font-size:14px;border-bottom:1px solid #333;">NARRATIVE</h2>
<p>&nbsp;</p>
<p>&nbsp;</p>

<div style="margin-top:48px;">
  <table style="width:100%;border:none;">
    <tr>
      <td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td>
      <td style="width:10%;">&nbsp;</td>
      <td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td>
    </tr>
    <tr>
      <td style="font-size:10px;color:#666;">Officer Signature</td>
      <td>&nbsp;</td>
      <td style="font-size:10px;color:#666;">Date</td>
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
<h1 style="text-align:center;font-size:18px;">EVIDENCE / PROPERTY LOG</h1>

<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr>
    <td style="border:1px solid #333;padding:6px;width:50%;"><strong>Case #:</strong> {{case_number}}</td>
    <td style="border:1px solid #333;padding:6px;"><strong>Date Collected:</strong> {{date_collected}}</td>
  </tr>
  <tr>
    <td style="border:1px solid #333;padding:6px;"><strong>Collecting Officer:</strong> {{reporting_officer}} (#{{badge_number}})</td>
    <td style="border:1px solid #333;padding:6px;"><strong>Location:</strong> {{location}}</td>
  </tr>
</table>

<h2 style="font-size:14px;border-bottom:1px solid #333;">ITEMS</h2>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr style="background:#1a1a1a;">
    <th style="border:1px solid #333;padding:6px;text-align:left;">Item #</th>
    <th style="border:1px solid #333;padding:6px;text-align:left;">Description</th>
    <th style="border:1px solid #333;padding:6px;text-align:left;">Where Found</th>
    <th style="border:1px solid #333;padding:6px;text-align:left;">Category</th>
  </tr>
  <tr>
    <td style="border:1px solid #333;padding:6px;">1</td>
    <td style="border:1px solid #333;padding:6px;">&nbsp;</td>
    <td style="border:1px solid #333;padding:6px;">&nbsp;</td>
    <td style="border:1px solid #333;padding:6px;">&nbsp;</td>
  </tr>
</table>

<h2 style="font-size:14px;border-bottom:1px solid #333;">CHAIN OF CUSTODY</h2>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr style="background:#1a1a1a;">
    <th style="border:1px solid #333;padding:6px;text-align:left;">Date/Time</th>
    <th style="border:1px solid #333;padding:6px;text-align:left;">Released By</th>
    <th style="border:1px solid #333;padding:6px;text-align:left;">Received By</th>
    <th style="border:1px solid #333;padding:6px;text-align:left;">Purpose</th>
  </tr>
  <tr>
    <td style="border:1px solid #333;padding:6px;">&nbsp;</td>
    <td style="border:1px solid #333;padding:6px;">&nbsp;</td>
    <td style="border:1px solid #333;padding:6px;">&nbsp;</td>
    <td style="border:1px solid #333;padding:6px;">&nbsp;</td>
  </tr>
</table>

<div style="margin-top:48px;">
  <table style="width:100%;border:none;">
    <tr>
      <td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td>
      <td style="width:10%;">&nbsp;</td>
      <td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td>
    </tr>
    <tr>
      <td style="font-size:10px;color:#666;">Collecting Officer Signature</td>
      <td>&nbsp;</td>
      <td style="font-size:10px;color:#666;">Date</td>
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
<h1 style="text-align:center;font-size:18px;">MEMORANDUM</h1>

<table style="width:100%;border:none;margin-bottom:16px;">
  <tr><td style="padding:4px 0;width:60px;"><strong>TO:</strong></td><td style="padding:4px 0;border-bottom:1px solid #333;">{{to}}</td></tr>
  <tr><td style="padding:4px 0;"><strong>FROM:</strong></td><td style="padding:4px 0;border-bottom:1px solid #333;">{{from}}</td></tr>
  <tr><td style="padding:4px 0;"><strong>DATE:</strong></td><td style="padding:4px 0;border-bottom:1px solid #333;">{{date}}</td></tr>
  <tr><td style="padding:4px 0;"><strong>RE:</strong></td><td style="padding:4px 0;border-bottom:1px solid #333;">{{subject}}</td></tr>
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
<h1 style="text-align:center;font-size:18px;">PATROL REPORT</h1>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Officer:</strong> {{officer}}</td><td style="border:1px solid #333;padding:6px;"><strong>Date:</strong> {{shift_date}}</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Hours:</strong> {{shift_hours}}</td><td style="border:1px solid #333;padding:6px;"><strong>Unit:</strong> {{vehicle}}</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;" colspan="2"><strong>Beat / Sector:</strong> {{beat}}</td></tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">AREAS PATROLLED</h2><p>&nbsp;</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">ACTIVITY &amp; OBSERVATIONS</h2><p>&nbsp;</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">CALLS RESPONDED</h2><p>&nbsp;</p>`,
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
<h1 style="text-align:center;font-size:18px;">INVESTIGATION REPORT</h1>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Case #:</strong> {{case_number}}</td><td style="border:1px solid #333;padding:6px;"><strong>Investigator:</strong> {{investigator}}</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Date:</strong> {{date}}</td><td style="border:1px solid #333;padding:6px;"><strong>Subject:</strong> {{subject}}</td></tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">SUMMARY</h2><p>&nbsp;</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">EVIDENCE</h2><p>&nbsp;</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">FINDINGS</h2><p>&nbsp;</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">CONCLUSION</h2><p>&nbsp;</p>`,
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
<h1 style="text-align:center;font-size:18px;">TRAINING RECORD</h1>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Officer:</strong> {{officer}}</td><td style="border:1px solid #333;padding:6px;"><strong>Course:</strong> {{course}}</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Date:</strong> {{date}}</td><td style="border:1px solid #333;padding:6px;"><strong>Hours:</strong> {{hours}}</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;" colspan="2"><strong>Instructor:</strong> {{instructor}}</td></tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">OBJECTIVES COVERED</h2><p>&nbsp;</p>
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
      { key: 'sender', label: 'Sender', source: 'user' },
    ],
    content: `${AGENCY_HEADER}
<p>{{date}}</p><p>&nbsp;</p>
<p>{{recipient}}<br>{{address}}</p><p>&nbsp;</p>
<p>Dear {{recipient}},</p>
<p>&nbsp;</p><p>&nbsp;</p>
<p>Sincerely,</p><p>&nbsp;</p>
<p>{{sender}}<br>Rocky Mountain Protective Group</p>`,
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
<h1 style="text-align:center;font-size:18px;">MEETING MINUTES</h1>
<p><strong>Meeting:</strong> {{meeting}} &nbsp;&nbsp; <strong>Date:</strong> {{date}} &nbsp;&nbsp; <strong>Recorded by:</strong> {{recorder}}</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">ATTENDEES</h2><ul><li>&nbsp;</li></ul>
<h2 style="font-size:14px;border-bottom:1px solid #333;">DISCUSSION</h2><p>&nbsp;</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">ACTION ITEMS</h2><ul data-type="taskList"><li>&nbsp;</li></ul>`,
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
<h1 style="text-align:center;font-size:20px;">{{title}}</h1>
<p style="text-align:center;">Prepared by {{author}} — {{date}}</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">OBJECTIVE</h2><p>&nbsp;</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">SCOPE</h2><p>&nbsp;</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">BUDGET</h2><p>&nbsp;</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">TIMELINE</h2><p>&nbsp;</p>`,
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
<h1 style="text-align:center;font-size:18px;">INVOICE</h1>
<p><strong>Invoice #:</strong> {{invoice_no}} &nbsp;&nbsp; <strong>Date:</strong> {{date}}</p>
<p><strong>Bill To:</strong> {{bill_to}}</p>
<table style="width:100%;border-collapse:collapse;margin:12px 0;">
  <tr style="background:#1a1a1a;"><th style="border:1px solid #333;padding:6px;text-align:left;">Description</th><th style="border:1px solid #333;padding:6px;">Qty</th><th style="border:1px solid #333;padding:6px;">Rate</th><th style="border:1px solid #333;padding:6px;">Amount</th></tr>
  <tr><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td></tr>
  <tr><td colspan="3" style="border:1px solid #333;padding:6px;text-align:right;"><strong>TOTAL</strong></td><td style="border:1px solid #333;padding:6px;">&nbsp;</td></tr>
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
<h1 style="text-align:center;font-size:18px;">SERVICE AGREEMENT</h1>
<p>This agreement is entered into on {{date}} between <strong>{{party_a}}</strong> ("Provider") and <strong>{{party_b}}</strong> ("Client").</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">1. SCOPE OF SERVICES</h2><p>&nbsp;</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">2. TERM</h2><p>&nbsp;</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">3. COMPENSATION</h2><p>&nbsp;</p>
<table style="width:100%;margin-top:40px;"><tr>
  <td style="width:50%;">_______________________<br>{{party_a}}</td>
  <td style="width:50%;">_______________________<br>{{party_b}}</td>
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
<h1 style="text-align:center;font-size:18px;">INCIDENT NARRATIVE</h1>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr>
    <td style="border:1px solid #333;padding:6px;width:50%;"><strong>Case #:</strong> {{case_number}}</td>
    <td style="border:1px solid #333;padding:6px;"><strong>Date/Time:</strong> {{incident_date}}</td>
  </tr>
  <tr>
    <td style="border:1px solid #333;padding:6px;"><strong>Location:</strong> {{location}}</td>
    <td style="border:1px solid #333;padding:6px;"><strong>Nature:</strong> {{offense}}</td>
  </tr>
  <tr>
    <td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Reporting Officer:</strong> {{reporting_officer}} (Badge #{{badge_number}})</td>
  </tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">SYNOPSIS</h2>
<p><em>One-sentence summary of what occurred.</em></p>
<p>&nbsp;</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">NARRATIVE</h2>
<p>On {{incident_date}}, I, {{reporting_officer}} (Badge #{{badge_number}}), was dispatched to {{location}} in reference to {{offense}}.</p>
<p>Upon arrival, I observed&hellip;</p>
<p>&nbsp;</p>
<p>&nbsp;</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">ACTIONS TAKEN</h2>
<p>&nbsp;</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">DISPOSITION</h2>
<p>&nbsp;</p>
<div style="margin-top:48px;">
  <table style="width:100%;border:none;">
    <tr>
      <td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td>
      <td style="width:10%;">&nbsp;</td>
      <td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td>
    </tr>
    <tr>
      <td style="font-size:10px;color:#666;">Officer Signature</td>
      <td>&nbsp;</td>
      <td style="font-size:10px;color:#666;">Date</td>
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
<h1 style="text-align:center;font-size:18px;">VOLUNTARY WITNESS STATEMENT</h1>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr>
    <td style="border:1px solid #333;padding:6px;width:50%;"><strong>Case #:</strong> {{case_number}}</td>
    <td style="border:1px solid #333;padding:6px;"><strong>Date:</strong> {{statement_date}}</td>
  </tr>
  <tr>
    <td style="border:1px solid #333;padding:6px;"><strong>Witness:</strong> {{witness_name}}</td>
    <td style="border:1px solid #333;padding:6px;"><strong>DOB:</strong> {{witness_dob}}</td>
  </tr>
  <tr>
    <td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Contact:</strong> {{witness_contact}}</td>
  </tr>
  <tr>
    <td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Statement taken by:</strong> {{taking_officer}}</td>
  </tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">STATEMENT</h2>
<p><em>In your own words, describe what you saw, heard, or experienced. Include dates, times, and locations where possible.</em></p>
<p>&nbsp;</p>
<p>&nbsp;</p>
<p>&nbsp;</p>
<p>&nbsp;</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">AFFIRMATION</h2>
<p>I, {{witness_name}}, affirm that the above statement is true and correct to the best of my knowledge. I understand that providing false information to law enforcement may be a criminal offense.</p>
<div style="margin-top:40px;">
  <table style="width:100%;border:none;">
    <tr>
      <td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td>
      <td style="width:10%;">&nbsp;</td>
      <td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td>
    </tr>
    <tr>
      <td style="font-size:10px;color:#666;">Witness Signature</td>
      <td>&nbsp;</td>
      <td style="font-size:10px;color:#666;">Date / Time</td>
    </tr>
    <tr>
      <td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td>
      <td style="width:10%;">&nbsp;</td>
      <td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td>
    </tr>
    <tr>
      <td style="font-size:10px;color:#666;">Officer / Witness to Signature</td>
      <td>&nbsp;</td>
      <td style="font-size:10px;color:#666;">Date</td>
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
<h1 style="text-align:center;font-size:18px;">FIELD INTERVIEW CARD</h1>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr>
    <td style="border:1px solid #333;padding:6px;width:50%;"><strong>FI #:</strong> {{fi_number}}</td>
    <td style="border:1px solid #333;padding:6px;"><strong>Date/Time:</strong> {{contact_date}}</td>
  </tr>
  <tr>
    <td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Location:</strong> {{location}}</td>
  </tr>
  <tr>
    <td style="border:1px solid #333;padding:6px;"><strong>Officer:</strong> {{officer}}</td>
    <td style="border:1px solid #333;padding:6px;"><strong>Badge #:</strong> {{badge_number}}</td>
  </tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">SUBJECT</h2>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr>
    <td style="border:1px solid #333;padding:6px;width:50%;"><strong>Name:</strong> {{subject_name}}</td>
    <td style="border:1px solid #333;padding:6px;"><strong>DOB:</strong> {{subject_dob}}</td>
  </tr>
  <tr>
    <td style="border:1px solid #333;padding:6px;"><strong>Race/Sex:</strong></td>
    <td style="border:1px solid #333;padding:6px;"><strong>Height/Weight:</strong></td>
  </tr>
  <tr>
    <td style="border:1px solid #333;padding:6px;"><strong>Clothing:</strong></td>
    <td style="border:1px solid #333;padding:6px;"><strong>SMT (scars/marks/tattoos):</strong></td>
  </tr>
  <tr>
    <td style="border:1px solid #333;padding:6px;"><strong>Vehicle (if any):</strong></td>
    <td style="border:1px solid #333;padding:6px;"><strong>Plate:</strong></td>
  </tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">BASIS FOR CONTACT</h2>
<p>☐ Consensual encounter &nbsp; ☐ Reasonable suspicion &nbsp; ☐ Suspicious activity &nbsp; ☐ Other</p>
<p>&nbsp;</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">NOTES</h2>
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
<h1 style="text-align:center;font-size:18px;">DAILY ACTIVITY LOG</h1>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr>
    <td style="border:1px solid #333;padding:6px;"><strong>Officer:</strong> {{officer}} (#{{badge_number}})</td>
    <td style="border:1px solid #333;padding:6px;"><strong>Date:</strong> {{log_date}}</td>
  </tr>
  <tr>
    <td style="border:1px solid #333;padding:6px;"><strong>Shift:</strong> {{shift}}</td>
    <td style="border:1px solid #333;padding:6px;"><strong>Unit:</strong> {{unit}}</td>
  </tr>
</table>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr style="background:#1a1a1a;">
    <th style="border:1px solid #333;padding:6px;text-align:left;width:90px;">Time</th>
    <th style="border:1px solid #333;padding:6px;text-align:left;width:90px;">Call / Type</th>
    <th style="border:1px solid #333;padding:6px;text-align:left;">Activity / Location</th>
    <th style="border:1px solid #333;padding:6px;text-align:left;width:70px;">Disp.</th>
  </tr>
  <tr><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td></tr>
</table>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr>
    <td style="border:1px solid #333;padding:6px;width:50%;"><strong>Beginning Mileage:</strong></td>
    <td style="border:1px solid #333;padding:6px;"><strong>Ending Mileage:</strong></td>
  </tr>
  <tr>
    <td style="border:1px solid #333;padding:6px;"><strong>Total Miles:</strong></td>
    <td style="border:1px solid #333;padding:6px;"><strong>Total Calls:</strong></td>
  </tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">END-OF-SHIFT NOTES</h2>
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
<h1 style="text-align:center;font-size:18px;">TRESPASS WARNING NOTICE</h1>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr>
    <td style="border:1px solid #333;padding:6px;width:50%;"><strong>Case #:</strong> {{case_number}}</td>
    <td style="border:1px solid #333;padding:6px;"><strong>Date/Time:</strong> {{warn_date}}</td>
  </tr>
  <tr>
    <td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Property:</strong> {{property}}</td>
  </tr>
  <tr>
    <td style="border:1px solid #333;padding:6px;"><strong>Subject:</strong> {{subject_name}}</td>
    <td style="border:1px solid #333;padding:6px;"><strong>DOB:</strong> {{subject_dob}}</td>
  </tr>
  <tr>
    <td style="border:1px solid #333;padding:6px;"><strong>Issuing Officer:</strong> {{officer}}</td>
    <td style="border:1px solid #333;padding:6px;"><strong>Badge #:</strong> {{badge_number}}</td>
  </tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">NOTICE</h2>
<p>You, {{subject_name}}, are hereby formally warned that you are no longer permitted on the property described above. This warning is issued on behalf of the property owner or authorized agent. Returning to this property may result in your arrest for criminal trespass pursuant to applicable Utah Code.</p>
<p><strong>This warning remains in effect until rescinded by the property owner/agent or by court order.</strong></p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">ACKNOWLEDGMENT</h2>
<p>☐ Subject acknowledged and signed &nbsp;&nbsp; ☐ Subject refused to sign &nbsp;&nbsp; ☐ Subject not present (served by other means)</p>
<div style="margin-top:40px;">
  <table style="width:100%;border:none;">
    <tr>
      <td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td>
      <td style="width:10%;">&nbsp;</td>
      <td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td>
    </tr>
    <tr>
      <td style="font-size:10px;color:#666;">Subject Signature</td>
      <td>&nbsp;</td>
      <td style="font-size:10px;color:#666;">Date / Time</td>
    </tr>
    <tr>
      <td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td>
      <td style="width:10%;">&nbsp;</td>
      <td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td>
    </tr>
    <tr>
      <td style="font-size:10px;color:#666;">Issuing Officer Signature</td>
      <td>&nbsp;</td>
      <td style="font-size:10px;color:#666;">Date</td>
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
<h1 style="text-align:center;font-size:18px;">VEHICLE TOW / IMPOUND REPORT</h1>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr><td style="border:1px solid #333;padding:6px;width:50%;"><strong>Case #:</strong> {{case_number}}</td><td style="border:1px solid #333;padding:6px;"><strong>Date/Time:</strong> {{tow_date}}</td></tr>
  <tr><td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Location:</strong> {{location}}</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Plate:</strong> {{plate}}</td><td style="border:1px solid #333;padding:6px;"><strong>VIN:</strong> {{vin}}</td></tr>
  <tr><td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Year/Make/Model:</strong> {{make_model}}</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Officer:</strong> {{officer}}</td><td style="border:1px solid #333;padding:6px;"><strong>Badge #:</strong> {{badge_number}}</td></tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">REASON FOR TOW</h2>
<p>☐ Abandoned &nbsp; ☐ Arrest of operator &nbsp; ☐ Recovered stolen &nbsp; ☐ Traffic hazard &nbsp; ☐ Evidence hold &nbsp; ☐ Other</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">TOW COMPANY</h2>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr><td style="border:1px solid #333;padding:6px;width:50%;"><strong>Company:</strong></td><td style="border:1px solid #333;padding:6px;"><strong>Driver:</strong></td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Stored At:</strong></td><td style="border:1px solid #333;padding:6px;"><strong>Hold Type:</strong> ☐ Owner release ☐ Police hold</td></tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">VEHICLE CONDITION &amp; INVENTORY</h2>
<p><em>Document pre-existing damage and any property/contents inventoried.</em></p>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr style="background:#1a1a1a;"><th style="border:1px solid #333;padding:6px;text-align:left;">Item</th><th style="border:1px solid #333;padding:6px;text-align:left;">Description / Location in Vehicle</th></tr>
  <tr><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td></tr>
</table>
<div style="margin-top:40px;"><table style="width:100%;border:none;">
  <tr><td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td><td style="width:10%;">&nbsp;</td><td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td></tr>
  <tr><td style="font-size:10px;color:#666;">Officer Signature</td><td>&nbsp;</td><td style="font-size:10px;color:#666;">Date</td></tr>
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
<h1 style="text-align:center;font-size:18px;">PROPERTY RECEIPT</h1>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr><td style="border:1px solid #333;padding:6px;width:50%;"><strong>Case #:</strong> {{case_number}}</td><td style="border:1px solid #333;padding:6px;"><strong>Date:</strong> {{receipt_date}}</td></tr>
  <tr><td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Issued To / Taken From:</strong> {{person_name}}</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Officer:</strong> {{officer}}</td><td style="border:1px solid #333;padding:6px;"><strong>Badge #:</strong> {{badge_number}}</td></tr>
</table>
<p>☐ Property <strong>seized / taken into custody</strong> &nbsp;&nbsp; ☐ Property <strong>returned / released</strong></p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">ITEMS</h2>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr style="background:#1a1a1a;"><th style="border:1px solid #333;padding:6px;text-align:left;">#</th><th style="border:1px solid #333;padding:6px;text-align:left;">Description</th><th style="border:1px solid #333;padding:6px;text-align:left;">Qty</th><th style="border:1px solid #333;padding:6px;text-align:left;">Serial / Identifier</th></tr>
  <tr><td style="border:1px solid #333;padding:6px;">1</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;">2</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td></tr>
</table>
<p>I acknowledge receipt of the items listed above.</p>
<div style="margin-top:40px;"><table style="width:100%;border:none;">
  <tr><td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td><td style="width:10%;">&nbsp;</td><td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td></tr>
  <tr><td style="font-size:10px;color:#666;">Recipient Signature</td><td>&nbsp;</td><td style="font-size:10px;color:#666;">Date</td></tr>
  <tr><td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td><td style="width:10%;">&nbsp;</td><td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td></tr>
  <tr><td style="font-size:10px;color:#666;">Officer Signature</td><td>&nbsp;</td><td style="font-size:10px;color:#666;">Date</td></tr>
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
<h1 style="text-align:center;font-size:18px;">TRAFFIC CITATION NARRATIVE</h1>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr><td style="border:1px solid #333;padding:6px;width:50%;"><strong>Citation #:</strong> {{citation_number}}</td><td style="border:1px solid #333;padding:6px;"><strong>Date/Time:</strong> {{stop_date}}</td></tr>
  <tr><td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Location:</strong> {{location}}</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Driver:</strong> {{driver_name}}</td><td style="border:1px solid #333;padding:6px;"><strong>Plate:</strong> {{plate}}</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Violation:</strong> {{violation}}</td><td style="border:1px solid #333;padding:6px;"><strong>Officer:</strong> {{officer}} (#{{badge_number}})</td></tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">REASONABLE SUSPICION FOR STOP</h2>
<p>On {{stop_date}}, I, {{officer}} (Badge #{{badge_number}}), observed a vehicle bearing plate {{plate}} at {{location}}.</p>
<p>&nbsp;</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">OBSERVATIONS / VIOLATIONS</h2>
<p>&nbsp;</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">DISPOSITION</h2>
<p>☐ Citation issued &nbsp; ☐ Written warning &nbsp; ☐ Verbal warning &nbsp; ☐ Arrest &nbsp; ☐ Vehicle towed</p>
<div style="margin-top:40px;"><table style="width:100%;border:none;">
  <tr><td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td><td style="width:10%;">&nbsp;</td><td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td></tr>
  <tr><td style="font-size:10px;color:#666;">Officer Signature</td><td>&nbsp;</td><td style="font-size:10px;color:#666;">Date</td></tr>
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
<h1 style="text-align:center;font-size:20px;color:#c0392b;">⚠ BE ON THE LOOKOUT (BOLO)</h1>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr><td style="border:1px solid #333;padding:6px;width:50%;"><strong>BOLO #:</strong> {{bolo_number}}</td><td style="border:1px solid #333;padding:6px;"><strong>Issued:</strong> {{issue_date}}</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Related Case #:</strong> {{related_case}}</td><td style="border:1px solid #333;padding:6px;"><strong>Issued By:</strong> {{officer}} (#{{badge_number}})</td></tr>
</table>
<p style="font-size:14px;"><strong>SUBJECT:</strong> {{subject}}</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">DESCRIPTION</h2>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr><td style="border:1px solid #333;padding:6px;width:50%;"><strong>Name / Aliases:</strong></td><td style="border:1px solid #333;padding:6px;"><strong>DOB / Age:</strong></td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Race / Sex:</strong></td><td style="border:1px solid #333;padding:6px;"><strong>Height / Weight:</strong></td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Clothing:</strong></td><td style="border:1px solid #333;padding:6px;"><strong>SMT:</strong></td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Vehicle / Plate:</strong></td><td style="border:1px solid #333;padding:6px;"><strong>Direction of Travel:</strong></td></tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">REASON / CAUTION</h2>
<p>☐ Wanted &nbsp; ☐ Suspect &nbsp; ☐ Missing &nbsp; ☐ Witness &nbsp; ☐ Armed &amp; dangerous &nbsp; ☐ Approach with caution</p>
<p>&nbsp;</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">IF LOCATED</h2>
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
<h1 style="text-align:center;font-size:18px;">AFFIDAVIT FOR SEARCH WARRANT</h1>
<p style="text-align:center;">STATE OF UTAH, COUNTY OF {{county}}</p>
<p>I, {{affiant}} (Badge #{{badge_number}}), being first duly sworn, depose and state the following in support of an application for a search warrant:</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">1. AFFIANT QUALIFICATIONS</h2>
<p>Your affiant is a sworn officer with Rocky Mountain Protective Group and has been so employed for ______ years. Your affiant has training and experience in&hellip;</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">2. PLACE / PERSON TO BE SEARCHED</h2>
<p>{{premises}}</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">3. ITEMS TO BE SEIZED</h2>
<p>{{items}}</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">4. STATEMENT OF PROBABLE CAUSE</h2>
<p><em>Set forth the facts establishing probable cause, in chronological detail.</em></p>
<p>&nbsp;</p>
<p>&nbsp;</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">5. CONCLUSION</h2>
<p>Based on the foregoing, your affiant has probable cause to believe, and does believe, that the items described above will be found at the place described, and respectfully requests that a search warrant be issued.</p>
<div style="margin-top:40px;"><table style="width:100%;border:none;">
  <tr><td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td><td style="width:10%;">&nbsp;</td><td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td></tr>
  <tr><td style="font-size:10px;color:#666;">Affiant Signature</td><td>&nbsp;</td><td style="font-size:10px;color:#666;">Date</td></tr>
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
<h1 style="text-align:center;font-size:18px;">CONSENT TO SEARCH</h1>
<p><strong>Date/Time:</strong> {{consent_date}}</p>
<p>I, <strong>{{person_name}}</strong>, having been informed of my constitutional right <u>not</u> to have a search made of the premises, vehicle, or property described below without a search warrant, and of my right to refuse to consent to such a search, hereby authorize {{officer}} (Badge #{{badge_number}}) and any assisting officers of Rocky Mountain Protective Group to conduct a complete search of:</p>
<p style="border:1px solid #333;padding:8px;margin:12px 0;"><strong>{{location}}</strong></p>
<p>These officers are authorized by me to take any items they may determine to be related to their investigation. This written permission is being given by me voluntarily and without threats or promises of any kind.</p>
<p>☐ I have read this form &nbsp;&nbsp; ☐ This form was read to me &nbsp;&nbsp; ☐ I understand my rights</p>
<div style="margin-top:40px;"><table style="width:100%;border:none;">
  <tr><td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td><td style="width:10%;">&nbsp;</td><td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td></tr>
  <tr><td style="font-size:10px;color:#666;">Signature of Person Consenting</td><td>&nbsp;</td><td style="font-size:10px;color:#666;">Date / Time</td></tr>
  <tr><td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td><td style="width:10%;">&nbsp;</td><td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td></tr>
  <tr><td style="font-size:10px;color:#666;">Witnessing Officer</td><td>&nbsp;</td><td style="font-size:10px;color:#666;">Date</td></tr>
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
<h1 style="text-align:center;font-size:18px;">MIRANDA WARNING &amp; WAIVER</h1>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr><td style="border:1px solid #333;padding:6px;width:50%;"><strong>Case #:</strong> {{case_number}}</td><td style="border:1px solid #333;padding:6px;"><strong>Date/Time:</strong> {{waiver_date}}</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Subject:</strong> {{subject_name}}</td><td style="border:1px solid #333;padding:6px;"><strong>Officer:</strong> {{officer}} (#{{badge_number}})</td></tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">YOUR RIGHTS</h2>
<ol>
  <li>You have the right to remain silent.</li>
  <li>Anything you say can and will be used against you in a court of law.</li>
  <li>You have the right to talk to a lawyer and have him/her present with you while you are being questioned.</li>
  <li>If you cannot afford to hire a lawyer, one will be appointed to represent you before any questioning if you wish.</li>
  <li>You can decide at any time to exercise these rights and not answer any questions or make any statements.</li>
</ol>
<h2 style="font-size:14px;border-bottom:1px solid #333;">WAIVER</h2>
<p>I have read this statement of my rights, or it has been read to me, and I understand what my rights are. I am willing to make a statement and answer questions. I do not want a lawyer at this time. I understand and know what I am doing. No promises or threats have been made to me and no pressure or coercion of any kind has been used against me.</p>
<p>☐ Rights read &nbsp;&nbsp; ☐ Subject understands &nbsp;&nbsp; ☐ Subject waives &nbsp;&nbsp; ☐ Subject invokes</p>
<div style="margin-top:40px;"><table style="width:100%;border:none;">
  <tr><td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td><td style="width:10%;">&nbsp;</td><td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td></tr>
  <tr><td style="font-size:10px;color:#666;">Subject Signature</td><td>&nbsp;</td><td style="font-size:10px;color:#666;">Time</td></tr>
  <tr><td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td><td style="width:10%;">&nbsp;</td><td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td></tr>
  <tr><td style="font-size:10px;color:#666;">Witnessing Officer</td><td>&nbsp;</td><td style="font-size:10px;color:#666;">Date</td></tr>
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
<h1 style="text-align:center;font-size:18px;">MEDICAL TREATMENT RELEASE / REFUSAL</h1>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr><td style="border:1px solid #333;padding:6px;width:50%;"><strong>Case #:</strong> {{case_number}}</td><td style="border:1px solid #333;padding:6px;"><strong>Date/Time:</strong> {{release_date}}</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Patient:</strong> {{patient_name}}</td><td style="border:1px solid #333;padding:6px;"><strong>Location:</strong> {{location}}</td></tr>
  <tr><td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Officer:</strong> {{officer}} (#{{badge_number}})</td></tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">ACTION</h2>
<p>☐ EMS summoned and patient transported &nbsp;&nbsp; ☐ Patient <strong>REFUSED</strong> medical treatment / transport</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">REFUSAL ACKNOWLEDGMENT</h2>
<p>I, {{patient_name}}, have been advised that I may have a medical condition requiring evaluation and that refusing care may result in worsening of my condition, including permanent injury or death. I am refusing medical treatment and/or transport against the advice of emergency personnel and officers. I assume all responsibility and release Rocky Mountain Protective Group, its officers, and EMS from any liability arising from this refusal.</p>
<p>☐ Patient is alert and oriented (A&amp;Ox4) &nbsp;&nbsp; ☐ Patient appears competent to refuse</p>
<div style="margin-top:40px;"><table style="width:100%;border:none;">
  <tr><td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td><td style="width:10%;">&nbsp;</td><td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td></tr>
  <tr><td style="font-size:10px;color:#666;">Patient Signature</td><td>&nbsp;</td><td style="font-size:10px;color:#666;">Time</td></tr>
  <tr><td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td><td style="width:10%;">&nbsp;</td><td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td></tr>
  <tr><td style="font-size:10px;color:#666;">Witnessing Officer</td><td>&nbsp;</td><td style="font-size:10px;color:#666;">Date</td></tr>
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
<h1 style="text-align:center;font-size:18px;">MOTOR VEHICLE CRASH REPORT</h1>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr><td style="border:1px solid #333;padding:6px;width:50%;"><strong>Case #:</strong> {{case_number}}</td><td style="border:1px solid #333;padding:6px;"><strong>Date/Time:</strong> {{crash_date}}</td></tr>
  <tr><td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Location:</strong> {{location}}</td></tr>
  <tr><td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Officer:</strong> {{officer}} (#{{badge_number}})</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Weather:</strong></td><td style="border:1px solid #333;padding:6px;"><strong>Road / Light Conditions:</strong></td></tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">UNIT 1</h2>
<table style="width:100%;border-collapse:collapse;margin-bottom:12px;">
  <tr><td style="border:1px solid #333;padding:6px;width:50%;"><strong>Driver:</strong></td><td style="border:1px solid #333;padding:6px;"><strong>DL #:</strong></td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Year/Make/Model:</strong></td><td style="border:1px solid #333;padding:6px;"><strong>Plate:</strong></td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Insurance:</strong></td><td style="border:1px solid #333;padding:6px;"><strong>Damage:</strong></td></tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">UNIT 2</h2>
<table style="width:100%;border-collapse:collapse;margin-bottom:12px;">
  <tr><td style="border:1px solid #333;padding:6px;width:50%;"><strong>Driver:</strong></td><td style="border:1px solid #333;padding:6px;"><strong>DL #:</strong></td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Year/Make/Model:</strong></td><td style="border:1px solid #333;padding:6px;"><strong>Plate:</strong></td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Insurance:</strong></td><td style="border:1px solid #333;padding:6px;"><strong>Damage:</strong></td></tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">INJURIES</h2>
<p>☐ None &nbsp; ☐ Possible &nbsp; ☐ Non-incapacitating &nbsp; ☐ Incapacitating &nbsp; ☐ Fatal &nbsp;&nbsp;|&nbsp;&nbsp; EMS: ☐ Yes ☐ No</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">CONTRIBUTING FACTORS</h2>
<p>☐ Speed &nbsp; ☐ Failure to yield &nbsp; ☐ Following too close &nbsp; ☐ DUI suspected &nbsp; ☐ Distracted &nbsp; ☐ Weather &nbsp; ☐ Other</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">DIAGRAM</h2>
<p style="border:1px dashed #555;height:160px;text-align:center;color:#888;padding-top:70px;">Crash diagram area — draw or insert image</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">NARRATIVE</h2>
<p>&nbsp;</p><p>&nbsp;</p>
<div style="margin-top:40px;"><table style="width:100%;border:none;">
  <tr><td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td><td style="width:10%;">&nbsp;</td><td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td></tr>
  <tr><td style="font-size:10px;color:#666;">Investigating Officer Signature</td><td>&nbsp;</td><td style="font-size:10px;color:#666;">Date</td></tr>
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
<h1 style="text-align:center;font-size:18px;color:#c0392b;">DOMESTIC VIOLENCE SUPPLEMENT</h1>
<p style="text-align:center;font-size:10px;color:#888;">CONFIDENTIAL — Victim information is protected. Handle per agency DV policy.</p>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr><td style="border:1px solid #333;padding:6px;width:50%;"><strong>Case #:</strong> {{case_number}}</td><td style="border:1px solid #333;padding:6px;"><strong>Date/Time:</strong> {{incident_date}}</td></tr>
  <tr><td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Location:</strong> {{location}}</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Victim:</strong> {{victim_name}}</td><td style="border:1px solid #333;padding:6px;"><strong>Suspect:</strong> {{suspect_name}}</td></tr>
  <tr><td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Officer:</strong> {{officer}} (#{{badge_number}})</td></tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">RELATIONSHIP</h2>
<p>☐ Spouse &nbsp; ☐ Ex-spouse &nbsp; ☐ Cohabitant &nbsp; ☐ Dating &nbsp; ☐ Parent/Child &nbsp; ☐ Shared child &nbsp; ☐ Other family</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">PRIMARY AGGRESSOR DETERMINATION</h2>
<p><em>Document injuries, history, fear, and relative size/strength used to determine the primary aggressor.</em></p>
<p>&nbsp;</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">LETHALITY / RISK FACTORS</h2>
<p>☐ Strangulation &nbsp; ☐ Weapon involved &nbsp; ☐ Threats to kill &nbsp; ☐ Prior DV &nbsp; ☐ Pregnancy &nbsp; ☐ Escalating frequency &nbsp; ☐ Children present</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">ACTIONS TAKEN</h2>
<p>☐ Arrest made &nbsp; ☐ EPO requested &nbsp; ☐ Victim advised of rights &nbsp; ☐ Resources provided &nbsp; ☐ Photos taken &nbsp; ☐ Medical/EMS</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">NARRATIVE</h2>
<p>&nbsp;</p><p>&nbsp;</p>
<div style="margin-top:40px;"><table style="width:100%;border:none;">
  <tr><td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td><td style="width:10%;">&nbsp;</td><td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td></tr>
  <tr><td style="font-size:10px;color:#666;">Officer Signature</td><td>&nbsp;</td><td style="font-size:10px;color:#666;">Date</td></tr>
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
<h1 style="text-align:center;font-size:18px;">MISSING PERSON REPORT</h1>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr><td style="border:1px solid #333;padding:6px;width:50%;"><strong>Case #:</strong> {{case_number}}</td><td style="border:1px solid #333;padding:6px;"><strong>Reported:</strong> {{report_date}}</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Missing Person:</strong> {{missing_name}}</td><td style="border:1px solid #333;padding:6px;"><strong>DOB/Age:</strong> {{missing_dob}}</td></tr>
  <tr><td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Last Seen:</strong> {{last_seen}}</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Reporting Party:</strong> {{reporter}}</td><td style="border:1px solid #333;padding:6px;"><strong>Officer:</strong> {{officer}} (#{{badge_number}})</td></tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">CLASSIFICATION</h2>
<p>☐ Juvenile runaway &nbsp; ☐ Endangered &nbsp; ☐ Involuntary/abduction &nbsp; ☐ Disability &nbsp; ☐ Catastrophe &nbsp; ☐ Adult</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">PHYSICAL DESCRIPTION</h2>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr><td style="border:1px solid #333;padding:6px;width:50%;"><strong>Race/Sex:</strong></td><td style="border:1px solid #333;padding:6px;"><strong>Height/Weight:</strong></td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Hair/Eyes:</strong></td><td style="border:1px solid #333;padding:6px;"><strong>SMT:</strong></td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Clothing last worn:</strong></td><td style="border:1px solid #333;padding:6px;"><strong>Glasses/Medical needs:</strong></td></tr>
  <tr><td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Vehicle (if any) / Plate:</strong></td></tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">RISK / MEDICAL</h2>
<p>☐ Requires medication &nbsp; ☐ Suicidal &nbsp; ☐ Cognitive impairment &nbsp; ☐ Foul play suspected &nbsp; ☐ Cold/exposure risk</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">ENTERED INTO NCIC</h2>
<p>☐ Yes — NCIC #: ____________ &nbsp;&nbsp; ☐ No &nbsp;&nbsp;|&nbsp;&nbsp; ☐ Endangered/Missing alert requested</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">NARRATIVE / CIRCUMSTANCES</h2>
<p>&nbsp;</p><p>&nbsp;</p>
<div style="margin-top:40px;"><table style="width:100%;border:none;">
  <tr><td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td><td style="width:10%;">&nbsp;</td><td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td></tr>
  <tr><td style="font-size:10px;color:#666;">Officer Signature</td><td>&nbsp;</td><td style="font-size:10px;color:#666;">Date</td></tr>
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
<h1 style="text-align:center;font-size:18px;">BOOKING SHEET</h1>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr><td style="border:1px solid #333;padding:6px;width:50%;"><strong>Booking #:</strong> {{booking_no}}</td><td style="border:1px solid #333;padding:6px;"><strong>Case #:</strong> {{case_number}}</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Arrestee:</strong> {{arrestee_name}}</td><td style="border:1px solid #333;padding:6px;"><strong>DOB:</strong> {{arrestee_dob}}</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Booking Officer:</strong> {{booking_officer}}</td><td style="border:1px solid #333;padding:6px;"><strong>Date/Time:</strong> {{booking_date}}</td></tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">PHYSICAL DESCRIPTION</h2>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Sex:</strong></td><td style="border:1px solid #333;padding:6px;"><strong>Race:</strong></td><td style="border:1px solid #333;padding:6px;"><strong>Height:</strong></td><td style="border:1px solid #333;padding:6px;"><strong>Weight:</strong></td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Hair:</strong></td><td style="border:1px solid #333;padding:6px;"><strong>Eyes:</strong></td><td style="border:1px solid #333;padding:6px;" colspan="2"><strong>SMT:</strong></td></tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">CHARGES</h2>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr style="background:#1a1a1a;"><th style="border:1px solid #333;padding:6px;text-align:left;">Statute</th><th style="border:1px solid #333;padding:6px;text-align:left;">Charge</th><th style="border:1px solid #333;padding:6px;text-align:left;">Class</th><th style="border:1px solid #333;padding:6px;text-align:left;">Bail</th></tr>
  <tr><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td></tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">MEDICAL SCREENING</h2>
<p>☐ Medical conditions reported &nbsp; ☐ Current medications &nbsp; ☐ Suicide risk screen completed &nbsp; ☐ Under influence</p>
<p>Notes: &nbsp;</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">PERSONAL PROPERTY INVENTORY</h2>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr style="background:#1a1a1a;"><th style="border:1px solid #333;padding:6px;text-align:left;">Item</th><th style="border:1px solid #333;padding:6px;text-align:left;">Description</th><th style="border:1px solid #333;padding:6px;text-align:left;">Disposition</th></tr>
  <tr><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td></tr>
</table>
<div style="margin-top:40px;"><table style="width:100%;border:none;">
  <tr><td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td><td style="width:10%;">&nbsp;</td><td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td></tr>
  <tr><td style="font-size:10px;color:#666;">Booking Officer Signature</td><td>&nbsp;</td><td style="font-size:10px;color:#666;">Date</td></tr>
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
<h1 style="text-align:center;font-size:18px;">PROPERTY INVENTORY</h1>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr><td style="border:1px solid #333;padding:6px;width:50%;"><strong>Case #:</strong> {{case_number}}</td><td style="border:1px solid #333;padding:6px;"><strong>Date:</strong> {{date}}</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Owner / Subject:</strong> {{owner_name}}</td><td style="border:1px solid #333;padding:6px;"><strong>Officer:</strong> {{officer}}</td></tr>
  <tr><td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Location:</strong> {{location}}</td></tr>
</table>
<p>Reason for inventory: ☐ Safekeeping &nbsp; ☐ Found property &nbsp; ☐ Evidence &nbsp; ☐ Vehicle inventory &nbsp; ☐ Other</p>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr style="background:#1a1a1a;"><th style="border:1px solid #333;padding:6px;text-align:left;">Item #</th><th style="border:1px solid #333;padding:6px;text-align:left;">Description</th><th style="border:1px solid #333;padding:6px;text-align:left;">Qty</th><th style="border:1px solid #333;padding:6px;text-align:left;">Est. Value</th><th style="border:1px solid #333;padding:6px;text-align:left;">Condition</th></tr>
  <tr><td style="border:1px solid #333;padding:6px;">1</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;">2</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td></tr>
</table>
<div style="margin-top:40px;"><table style="width:100%;border:none;">
  <tr><td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td><td style="width:10%;">&nbsp;</td><td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td></tr>
  <tr><td style="font-size:10px;color:#666;">Officer Signature</td><td>&nbsp;</td><td style="font-size:10px;color:#666;">Date</td></tr>
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
<h1 style="text-align:center;font-size:18px;">K9 DEPLOYMENT REPORT</h1>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr><td style="border:1px solid #333;padding:6px;width:50%;"><strong>Case #:</strong> {{case_number}}</td><td style="border:1px solid #333;padding:6px;"><strong>Date/Time:</strong> {{date}}</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Handler:</strong> {{handler}}</td><td style="border:1px solid #333;padding:6px;"><strong>K9:</strong> {{k9_name}}</td></tr>
  <tr><td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Location:</strong> {{location}}</td></tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">DEPLOYMENT TYPE</h2>
<p>☐ Article/evidence search &nbsp; ☐ Narcotics detection &nbsp; ☐ Explosives detection &nbsp; ☐ Tracking/trailing &nbsp; ☐ Building search &nbsp; ☐ Apprehension</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">WARNING / ANNOUNCEMENT</h2>
<p>☐ K9 warning announcement given prior to deployment &nbsp; Time: ________</p>
<p>Announcement wording / number of times given: &nbsp;</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">NARRATIVE</h2>
<p>&nbsp;</p><p>&nbsp;</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">RESULT</h2>
<p>☐ Apprehension &nbsp; ☐ Find/alert &nbsp; ☐ Negative &nbsp; ☐ Bite (document injuries below)</p>
<p>Injuries / medical treatment: &nbsp;</p>
<div style="margin-top:40px;"><table style="width:100%;border:none;">
  <tr><td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td><td style="width:10%;">&nbsp;</td><td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td></tr>
  <tr><td style="font-size:10px;color:#666;">Handler Signature</td><td>&nbsp;</td><td style="font-size:10px;color:#666;">Date</td></tr>
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
<h1 style="text-align:center;font-size:18px;color:#c0392b;">VEHICLE PURSUIT REPORT</h1>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr><td style="border:1px solid #333;padding:6px;width:50%;"><strong>Case #:</strong> {{case_number}}</td><td style="border:1px solid #333;padding:6px;"><strong>Date/Time:</strong> {{date}}</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Primary Officer:</strong> {{officer}}</td><td style="border:1px solid #333;padding:6px;"><strong>Start Location:</strong> {{start_location}}</td></tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">JUSTIFICATION FOR PURSUIT</h2>
<p>Originating offense: &nbsp;</p>
<p>☐ Felony &nbsp; ☐ Violent crime &nbsp; ☐ DUI &nbsp; ☐ Traffic offense &nbsp; ☐ Other</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">PURSUIT DETAILS</h2>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Start time:</strong></td><td style="border:1px solid #333;padding:6px;"><strong>End time:</strong></td><td style="border:1px solid #333;padding:6px;"><strong>Duration:</strong></td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Max speed:</strong></td><td style="border:1px solid #333;padding:6px;"><strong>Distance:</strong></td><td style="border:1px solid #333;padding:6px;"><strong>Road/weather:</strong></td></tr>
  <tr><td style="border:1px solid #333;padding:6px;" colspan="3"><strong>Suspect vehicle (make/model/color/plate):</strong></td></tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">SUPERVISOR NOTIFICATION</h2>
<p>☐ Supervisor notified &nbsp; Time: ________ &nbsp; ☐ Pursuit authorized &nbsp; ☐ Pursuit terminated by supervisor</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">NARRATIVE</h2>
<p>&nbsp;</p><p>&nbsp;</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">OUTCOME</h2>
<p>☐ Suspect in custody &nbsp; ☐ Pursuit terminated &nbsp; ☐ Collision &nbsp; ☐ Suspect eluded</p>
<p>Injuries / property damage: &nbsp;</p>
<div style="margin-top:40px;"><table style="width:100%;border:none;">
  <tr><td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td><td style="width:10%;">&nbsp;</td><td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td></tr>
  <tr><td style="font-size:10px;color:#666;">Officer Signature</td><td>&nbsp;</td><td style="font-size:10px;color:#666;">Date</td></tr>
  <tr><td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td><td style="width:10%;">&nbsp;</td><td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td></tr>
  <tr><td style="font-size:10px;color:#666;">Supervisor Signature</td><td>&nbsp;</td><td style="font-size:10px;color:#666;">Date</td></tr>
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
<h1 style="text-align:center;font-size:18px;">CRIME SCENE ENTRY LOG</h1>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr><td style="border:1px solid #333;padding:6px;width:50%;"><strong>Case #:</strong> {{case_number}}</td><td style="border:1px solid #333;padding:6px;"><strong>Date:</strong> {{date}}</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Scene Location:</strong> {{location}}</td><td style="border:1px solid #333;padding:6px;"><strong>Log Officer:</strong> {{officer}}</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Scene secured at:</strong></td><td style="border:1px solid #333;padding:6px;"><strong>Released at:</strong></td></tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">PERSONNEL ENTRY/EXIT LOG</h2>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr style="background:#1a1a1a;"><th style="border:1px solid #333;padding:6px;text-align:left;">Name / Agency</th><th style="border:1px solid #333;padding:6px;text-align:left;">Purpose</th><th style="border:1px solid #333;padding:6px;text-align:left;">Time In</th><th style="border:1px solid #333;padding:6px;text-align:left;">Time Out</th></tr>
  <tr><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td></tr>
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
<h1 style="text-align:center;font-size:18px;">CHAIN OF CUSTODY</h1>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr><td style="border:1px solid #333;padding:6px;width:50%;"><strong>Case #:</strong> {{case_number}}</td><td style="border:1px solid #333;padding:6px;"><strong>Item #:</strong> {{item_no}}</td></tr>
  <tr><td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Description:</strong> {{description}}</td></tr>
  <tr><td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Collected by:</strong> {{officer}}</td></tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">CUSTODY TRANSFERS</h2>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr style="background:#1a1a1a;"><th style="border:1px solid #333;padding:6px;text-align:left;">Date/Time</th><th style="border:1px solid #333;padding:6px;text-align:left;">Released By</th><th style="border:1px solid #333;padding:6px;text-align:left;">Received By</th><th style="border:1px solid #333;padding:6px;text-align:left;">Reason</th></tr>
  <tr><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td></tr>
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
<h1 style="text-align:center;font-size:18px;">INTERVIEW TRANSCRIPT</h1>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr><td style="border:1px solid #333;padding:6px;width:50%;"><strong>Case #:</strong> {{case_number}}</td><td style="border:1px solid #333;padding:6px;"><strong>Date/Time:</strong> {{date}}</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Interviewee:</strong> {{interviewee}}</td><td style="border:1px solid #333;padding:6px;"><strong>Interviewer:</strong> {{interviewer}}</td></tr>
  <tr><td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Location:</strong> {{location}}</td></tr>
</table>
<p>☐ Recorded (audio) &nbsp; ☐ Recorded (video) &nbsp; ☐ Miranda advised prior &nbsp; Recording reference: ________</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">TRANSCRIPT</h2>
<p>[00:00] <strong>{{interviewer}}:</strong> &nbsp;</p>
<p>[00:00] <strong>{{interviewee}}:</strong> &nbsp;</p>
<p>&nbsp;</p>
<p style="font-size:10px;color:#888;"><em>Transcript prepared from recording; certified accurate to the best of the transcriber's ability.</em></p>
<div style="margin-top:40px;"><table style="width:100%;border:none;">
  <tr><td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td><td style="width:10%;">&nbsp;</td><td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td></tr>
  <tr><td style="font-size:10px;color:#666;">Transcribed By</td><td>&nbsp;</td><td style="font-size:10px;color:#666;">Date</td></tr>
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
<h1 style="text-align:center;font-size:18px;">CIVIL STANDBY REPORT</h1>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr><td style="border:1px solid #333;padding:6px;width:50%;"><strong>Case #:</strong> {{case_number}}</td><td style="border:1px solid #333;padding:6px;"><strong>Date/Time:</strong> {{date}}</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Requesting Party:</strong> {{requestor}}</td><td style="border:1px solid #333;padding:6px;"><strong>Other Party:</strong> {{other_party}}</td></tr>
  <tr><td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Location:</strong> {{location}}</td></tr>
  <tr><td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Officer:</strong> {{officer}}</td></tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">PURPOSE</h2>
<p>☐ Retrieval of personal property &nbsp; ☐ Child custody exchange &nbsp; ☐ Eviction/lockout &nbsp; ☐ Other</p>
<p>Court order present: ☐ Yes ☐ No &nbsp; Order #: ________</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">NARRATIVE</h2>
<p>Officers stood by to keep the peace only and took no position on the underlying civil dispute.</p>
<p>&nbsp;</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">OUTCOME</h2>
<p>☐ Completed peacefully &nbsp; ☐ Property exchanged &nbsp; ☐ Parties advised of civil remedies &nbsp; ☐ Enforcement action taken</p>
<div style="margin-top:40px;"><table style="width:100%;border:none;">
  <tr><td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td><td style="width:10%;">&nbsp;</td><td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td></tr>
  <tr><td style="font-size:10px;color:#666;">Officer Signature</td><td>&nbsp;</td><td style="font-size:10px;color:#666;">Date</td></tr>
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
<h1 style="text-align:center;font-size:18px;">REPOSSESSION STANDBY REPORT</h1>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr><td style="border:1px solid #333;padding:6px;width:50%;"><strong>Case #:</strong> {{case_number}}</td><td style="border:1px solid #333;padding:6px;"><strong>Date/Time:</strong> {{date}}</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Repo Agent:</strong> {{agent}}</td><td style="border:1px solid #333;padding:6px;"><strong>Debtor / Owner:</strong> {{debtor}}</td></tr>
  <tr><td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Location:</strong> {{location}}</td></tr>
  <tr><td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Officer:</strong> {{officer}}</td></tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">PROPERTY REPOSSESSED</h2>
<p>Description (make/model/VIN/plate): &nbsp;</p>
<p>Repo agent license / company: &nbsp;</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">NARRATIVE</h2>
<p>Officers were present solely to preserve the peace during a lawful self-help repossession and did not assist in the seizure of property.</p>
<p>&nbsp;</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">OUTCOME</h2>
<p>☐ Repossession completed &nbsp; ☐ Breach of peace — repossession ceased &nbsp; ☐ Parties separated &nbsp; ☐ No action</p>
<div style="margin-top:40px;"><table style="width:100%;border:none;">
  <tr><td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td><td style="width:10%;">&nbsp;</td><td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td></tr>
  <tr><td style="font-size:10px;color:#666;">Officer Signature</td><td>&nbsp;</td><td style="font-size:10px;color:#666;">Date</td></tr>
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
<h1 style="text-align:center;font-size:18px;">WELFARE CHECK REPORT</h1>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr><td style="border:1px solid #333;padding:6px;width:50%;"><strong>Case #:</strong> {{case_number}}</td><td style="border:1px solid #333;padding:6px;"><strong>Date/Time:</strong> {{date}}</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Subject:</strong> {{subject_name}}</td><td style="border:1px solid #333;padding:6px;"><strong>Requested by:</strong> {{requestor}}</td></tr>
  <tr><td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Location:</strong> {{location}}</td></tr>
  <tr><td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Officer:</strong> {{officer}}</td></tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">REASON FOR CHECK</h2>
<p>&nbsp;</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">FINDINGS</h2>
<p>☐ Subject contacted, appears well &nbsp; ☐ Medical aid rendered (EMS) &nbsp; ☐ Mental-health crisis &nbsp; ☐ Subject not located &nbsp; ☐ Deceased (notify investigations)</p>
<p>&nbsp;</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">DISPOSITION</h2>
<p>☐ No further action &nbsp; ☐ Referred to services &nbsp; ☐ Transported &nbsp; ☐ Protective custody</p>
<div style="margin-top:40px;"><table style="width:100%;border:none;">
  <tr><td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td><td style="width:10%;">&nbsp;</td><td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td></tr>
  <tr><td style="font-size:10px;color:#666;">Officer Signature</td><td>&nbsp;</td><td style="font-size:10px;color:#666;">Date</td></tr>
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
<h1 style="text-align:center;font-size:18px;color:#c0392b;">USE-OF-FORCE SUPPLEMENT</h1>
<p style="text-align:center;font-size:10px;color:#888;">Attach to the primary Use of Force Report.</p>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr><td style="border:1px solid #333;padding:6px;width:50%;"><strong>Primary Case #:</strong> {{case_number}}</td><td style="border:1px solid #333;padding:6px;"><strong>Date:</strong> {{date}}</td></tr>
  <tr><td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Supplementing Officer:</strong> {{officer}} (Badge #{{badge_number}})</td></tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">ROLE IN INCIDENT</h2>
<p>☐ Used force &nbsp; ☐ Witnessed force &nbsp; ☐ Arrived after &nbsp; ☐ Supervisor</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">FORCE USED BY THIS OFFICER (if any)</h2>
<p>☐ Physical control &nbsp; ☐ OC &nbsp; ☐ CEW &nbsp; ☐ Baton &nbsp; ☐ Firearm &nbsp; ☐ None</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">OBSERVATIONS / NARRATIVE</h2>
<p>&nbsp;</p><p>&nbsp;</p>
<div style="margin-top:40px;"><table style="width:100%;border:none;">
  <tr><td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td><td style="width:10%;">&nbsp;</td><td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td></tr>
  <tr><td style="font-size:10px;color:#666;">Officer Signature</td><td>&nbsp;</td><td style="font-size:10px;color:#666;">Date</td></tr>
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
<h1 style="text-align:center;font-size:18px;">IMPOUND INVENTORY</h1>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr><td style="border:1px solid #333;padding:6px;width:50%;"><strong>Case #:</strong> {{case_number}}</td><td style="border:1px solid #333;padding:6px;"><strong>Date/Time:</strong> {{date}}</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Vehicle:</strong> {{vehicle}}</td><td style="border:1px solid #333;padding:6px;"><strong>Plate / VIN:</strong> {{plate}}</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Officer:</strong> {{officer}}</td><td style="border:1px solid #333;padding:6px;"><strong>Tow Company:</strong> {{tow_company}}</td></tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">VEHICLE CONDITION</h2>
<p>Damage noted (diagram/describe): &nbsp;</p>
<p>Odometer: ________ &nbsp; Fuel: ________ &nbsp; Keys: ☐ Yes ☐ No</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">CONTENTS INVENTORY</h2>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr style="background:#1a1a1a;"><th style="border:1px solid #333;padding:6px;text-align:left;">Location</th><th style="border:1px solid #333;padding:6px;text-align:left;">Item</th><th style="border:1px solid #333;padding:6px;text-align:left;">Notes</th></tr>
  <tr><td style="border:1px solid #333;padding:6px;">Passenger compartment</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;">Trunk</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;">Glove box / console</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td><td style="border:1px solid #333;padding:6px;">&nbsp;</td></tr>
</table>
<p style="font-size:10px;color:#888;"><em>Inventory conducted pursuant to standardized agency impound policy, not for investigative purposes.</em></p>
<div style="margin-top:40px;"><table style="width:100%;border:none;">
  <tr><td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td><td style="width:10%;">&nbsp;</td><td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td></tr>
  <tr><td style="font-size:10px;color:#666;">Officer Signature</td><td>&nbsp;</td><td style="font-size:10px;color:#666;">Date</td></tr>
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
<h1 style="text-align:center;font-size:18px;">COMPLIANCE CHECK REPORT</h1>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr><td style="border:1px solid #333;padding:6px;width:50%;"><strong>Case / Op #:</strong> {{case_number}}</td><td style="border:1px solid #333;padding:6px;"><strong>Date/Time:</strong> {{date}}</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Business:</strong> {{business}}</td><td style="border:1px solid #333;padding:6px;"><strong>Officer:</strong> {{officer}}</td></tr>
  <tr><td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Address:</strong> {{business_address}}</td></tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">CHECK TYPE</h2>
<p>☐ Tobacco / vapor &nbsp; ☐ Alcohol &nbsp; ☐ Both</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">DECOY / OPERATIVE</h2>
<p>Decoy age: ________ &nbsp; ID shown: ☐ Yes ☐ No &nbsp; Clerk asked for ID: ☐ Yes ☐ No</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">RESULT</h2>
<p>☐ PASS — sale refused &nbsp; ☐ FAIL — sale completed to minor</p>
<p>Clerk name / DOB (if cited): &nbsp;</p>
<p>Citation #: ________ &nbsp; Statute: ________</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">NARRATIVE</h2>
<p>&nbsp;</p>
<div style="margin-top:40px;"><table style="width:100%;border:none;">
  <tr><td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td><td style="width:10%;">&nbsp;</td><td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td></tr>
  <tr><td style="font-size:10px;color:#666;">Officer Signature</td><td>&nbsp;</td><td style="font-size:10px;color:#666;">Date</td></tr>
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
<h1 style="text-align:center;font-size:18px;">PARKING ENFORCEMENT</h1>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
  <tr><td style="border:1px solid #333;padding:6px;width:50%;"><strong>Citation #:</strong> {{citation_no}}</td><td style="border:1px solid #333;padding:6px;"><strong>Date/Time:</strong> {{date}}</td></tr>
  <tr><td style="border:1px solid #333;padding:6px;"><strong>Vehicle:</strong> {{vehicle}}</td><td style="border:1px solid #333;padding:6px;"><strong>Plate:</strong> {{plate}}</td></tr>
  <tr><td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Location:</strong> {{location}}</td></tr>
  <tr><td colspan="2" style="border:1px solid #333;padding:6px;"><strong>Officer:</strong> {{officer}}</td></tr>
</table>
<h2 style="font-size:14px;border-bottom:1px solid #333;">VIOLATION</h2>
<p>☐ Fire lane &nbsp; ☐ Handicap &nbsp; ☐ No parking zone &nbsp; ☐ Expired meter &nbsp; ☐ Blocking driveway &nbsp; ☐ Time limit &nbsp; ☐ Other</p>
<p>Ordinance / statute: ________ &nbsp; Fine: $________</p>
<h2 style="font-size:14px;border-bottom:1px solid #333;">ACTION TAKEN</h2>
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

export function getTemplate(id: string): DocumentTemplate | undefined {
  return TEMPLATES.find(t => t.id === id);
}

export function populateTemplate(template: DocumentTemplate, values: Record<string, string>): string {
  let html = template.content;
  for (const field of template.fields) {
    const val = values[field.key] || '';
    html = html.split(`{{${field.key}}}`).join(val);
  }
  return html;
}
