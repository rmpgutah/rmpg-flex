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
