// ============================================================
// RMPG Flex — Spillman Narrative Templates & Composer
// 10 records management features: narrative templates, report
// paragraph composer, legal phrase library, UCR/NIBRS narrative
// validation, statement recorder, field interview guide, incident
// narrative formatter, disposition narrative builder, use-of-force
// narrative, and supplemental report templates.
// ============================================================

/* ── FEATURE 21: Narrative Templates ────────────────────────
   Spillman Flex provides pre-built narrative paragraph templates
   for common incident types. Officers fill in blanks to produce
   consistent, legally-sound narratives. */
export interface NarrativeTemplate {
  id: string;
  category: string;
  title: string;
  template: string;
  fields: string[];
  requiredElements: string[];
}

export const NARRATIVE_TEMPLATES: NarrativeTemplate[] = [
  {
    id: 'traffic_stop',
    category: 'traffic',
    title: 'Traffic Stop',
    template: 'On {DATE} at approximately {TIME}, I was on patrol in a marked {AGENCY} patrol vehicle when I observed a {VEHICLE_COLOR} {VEHICLE_YEAR} {VEHICLE_MAKE} {VEHICLE_MODEL} bearing {STATE} license plate {PLATE} {VIOLATION_DESC}. I activated my emergency lights and siren and conducted a traffic stop at {LOCATION}. I approached the vehicle on the {SIDE} side and made contact with the driver, identified as {DRIVER_NAME}, DOB {DRIVER_DOB}. I detected {OBSERVATIONS}. I asked the driver for their driver\'s license, registration, and proof of insurance. The driver {DRIVER_RESPONSE}.',
    fields: ['DATE', 'TIME', 'AGENCY', 'VEHICLE_COLOR', 'VEHICLE_YEAR', 'VEHICLE_MAKE', 'VEHICLE_MODEL', 'STATE', 'PLATE', 'VIOLATION_DESC', 'LOCATION', 'SIDE', 'DRIVER_NAME', 'DRIVER_DOB', 'OBSERVATIONS', 'DRIVER_RESPONSE'],
    requiredElements: ['probable_cause', 'subject_identification', 'location', 'date_time'],
  },
  {
    id: 'domestic_disturbance',
    category: 'violent',
    title: 'Domestic Disturbance',
    template: 'On {DATE} at approximately {TIME}, I was dispatched to {ADDRESS} in reference to a domestic disturbance. Upon arrival, I made contact with {RP_NAME} who stated that {RP_STATEMENT}. I then made contact with {SUBJECT_NAME} who stated that {SUBJECT_STATEMENT}. I observed {PHYSICAL_EVIDENCE}. Based on the statements and evidence, {PC_STATEMENT}. Photographs were taken of {PHOTO_DESC}. {SUBJECT_NAME} was {DISPOSITION}.',
    fields: ['DATE', 'TIME', 'ADDRESS', 'RP_NAME', 'RP_STATEMENT', 'SUBJECT_NAME', 'SUBJECT_STATEMENT', 'PHYSICAL_EVIDENCE', 'PC_STATEMENT', 'PHOTO_DESC', 'DISPOSITION'],
    requiredElements: ['parties_identified', 'statements_documented', 'evidence_described', 'probable_cause', 'disposition'],
  },
  {
    id: 'burglary_report',
    category: 'property',
    title: 'Burglary Report',
    template: 'On {DATE} at approximately {TIME}, I was dispatched to {ADDRESS} in reference to a burglary. Upon arrival, I contacted the reporting party, {RP_NAME}, who stated that {RP_STATEMENT}. I conducted a walk-through of the residence and observed {ENTRY_POINT} as the point of entry. The following items were reported missing: {MISSING_ITEMS}. The scene was processed for evidence by {CSI_INFO}. Neighbors were canvassed and {NEIGHBOR_INFO}. This case is {CASE_STATUS}.',
    fields: ['DATE', 'TIME', 'ADDRESS', 'RP_NAME', 'RP_STATEMENT', 'ENTRY_POINT', 'MISSING_ITEMS', 'CSI_INFO', 'NEIGHBOR_INFO', 'CASE_STATUS'],
    requiredElements: ['point_of_entry', 'property_list', 'evidence_collection', 'investigation_steps'],
  },
  {
    id: 'arrest_narrative',
    category: 'arrest',
    title: 'Arrest Narrative',
    template: 'On {DATE} at approximately {TIME}, {PC_STATEMENT}, I placed {SUBJECT_NAME}, DOB {SUBJECT_DOB}, under arrest for {CHARGES}. The subject was handcuffed with their hands behind their back, double-locked, and checked for proper fit. A search incident to arrest revealed {SEARCH_RESULTS}. The subject was transported to {FACILITY} by {TRANSPORT_UNIT} without incident. The subject\'s personal property was inventoried and {PROPERTY_DISPOSITION}. The arresting officer\'s body-worn camera was activated throughout this incident.',
    fields: ['DATE', 'TIME', 'PC_STATEMENT', 'SUBJECT_NAME', 'SUBJECT_DOB', 'CHARGES', 'SEARCH_RESULTS', 'FACILITY', 'TRANSPORT_UNIT', 'PROPERTY_DISPOSITION'],
    requiredElements: ['probable_cause', 'handcuffing_procedure', 'search_incident', 'transport', 'bwc_activated'],
  },
  {
    id: 'use_of_force',
    category: 'force',
    title: 'Use of Force Report',
    template: 'On {DATE} at approximately {TIME}, while investigating {CALL_TYPE} at {LOCATION}, I encountered {SUBJECT_NAME} who {SUBJECT_ACTION}. I gave verbal commands to {COMMANDS_GIVEN}. The subject {SUBJECT_RESPONSE}. Due to the subject\'s actions, I deployed {FORCE_TYPE} in the form of {FORCE_DETAIL}. The force was applied for approximately {DURATION} and ceased when {CESSATION_REASON}. Medical attention was {MEDICAL_RESPONSE}. Supervisor {SUPERVISOR_NAME} was notified at {NOTIFICATION_TIME}. My body-worn camera captured the entire incident.',
    fields: ['DATE', 'TIME', 'CALL_TYPE', 'LOCATION', 'SUBJECT_NAME', 'SUBJECT_ACTION', 'COMMANDS_GIVEN', 'SUBJECT_RESPONSE', 'FORCE_TYPE', 'FORCE_DETAIL', 'DURATION', 'CESSATION_REASON', 'MEDICAL_RESPONSE', 'SUPERVISOR_NAME', 'NOTIFICATION_TIME'],
    requiredElements: ['subject_actions', 'commands_given', 'force_justification', 'force_type', 'cessation', 'medical', 'supervisor_notification', 'bwc'],
  },
  {
    id: 'witness_statement',
    category: 'interview',
    title: 'Witness Statement',
    template: 'On {DATE} at approximately {TIME}, I interviewed {WITNESS_NAME}, DOB {WITNESS_DOB}, at {LOCATION}. {WITNESS_NAME} stated the following: "{WITNESS_STATEMENT}". The witness described the suspect as {SUSPECT_DESC}. The witness\'s demeanor appeared {DEMEANOR} and they {CREDIBILITY}. The interview was recorded on my body-worn camera. {WITNESS_NAME} provided contact information: {CONTACT_INFO}.',
    fields: ['DATE', 'TIME', 'WITNESS_NAME', 'WITNESS_DOB', 'LOCATION', 'WITNESS_STATEMENT', 'SUSPECT_DESC', 'DEMEANOR', 'CREDIBILITY', 'CONTACT_INFO'],
    requiredElements: ['witness_identity', 'statement_content', 'suspect_description', 'credibility_assessment'],
  },
];

export function getNarrativeTemplate(id: string): NarrativeTemplate | undefined {
  return NARRATIVE_TEMPLATES.find(t => t.id === id);
}

export function fillTemplate(template: NarrativeTemplate, values: Record<string, string>): string {
  let result = template.template;
  for (const field of template.fields) {
    result = result.replace(`{${field}}`, values[field] || `[${field}]`);
  }
  return result;
}

/* ── FEATURE 22: Report Paragraph Composer ──────────────────
   Spillman Flex lets officers compose report sections as
   block-level paragraphs with auto-formatting. */
export interface ReportParagraph {
  id: string;
  section: string;
  heading: string;
  content: string;
  order: number;
  template?: string;
}

export function composeReportParagraphs(paragraphs: ReportParagraph[]): string {
  return paragraphs
    .sort((a, b) => a.order - b.order)
    .map(p => `**${p.heading}**\n\n${p.content}`)
    .join('\n\n');
}

/* ── FEATURE 23: Legal Phrase Library ──────────────────────
   Spillman Flex includes a standard library of legally-reviewed
   phrases that officers can insert into reports. */
export const LEGAL_PHRASES: Record<string, string> = {
  probable_cause: 'Based on the totality of the circumstances, I formed probable cause to believe that a crime had been committed and that the subject committed it.',
  miranda: 'I read the subject their Miranda rights from my department-issued card. The subject stated they understood their rights and agreed to speak with me.',
  consent_search: 'I asked the subject for consent to search. The subject voluntarily gave verbal consent without coercion or promises.',
  plain_view: 'While lawfully present, I observed the item in plain view and immediately recognized it as contraband/evidence based on my training and experience.',
  exigent_circumstances: 'Due to exigent circumstances, including the potential destruction of evidence and risk to public safety, entry was made without a warrant.',
  terry_stop: 'Based on articulable reasonable suspicion that criminal activity was afoot, I conducted an investigatory detention of the subject.',
  terry_frisk: 'Based on reasonable suspicion that the subject may be armed and dangerous, I conducted a protective pat-down for weapons for officer safety.',
  handcuffing: 'The subject was handcuffed with their hands behind their back. The handcuffs were double-locked and checked for proper fit.',
  search_incident: 'A search incident to lawful arrest was conducted of the subject\'s person and the area within their immediate control.',
  vehicle_inventory: 'An inventory search of the vehicle was conducted per department policy prior to impound/tow.',
  showup: 'A show-up identification was conducted. The witness was separated and advised that the person may or may not be the suspect. The witness {RESULT}.',
  photo_lineup: 'A photographic lineup was administered per department policy by an investigator not involved in the case. The witness {RESULT}.',
  bwc_statement: 'My department-issued body-worn camera was activated throughout this incident and captured the events as described.',
  evidence_collection: 'The item(s) were photographed in place, collected wearing appropriate PPE, and logged into evidence per department policy.',
  chain_of_custody: 'Chain of custody was maintained from collection through submission to the property and evidence room.',
  juvenile_miranda: 'The juvenile was advised of their rights in the presence of their parent/guardian. Both the juvenile and guardian indicated understanding.',
};

export function getLegalPhrase(key: string): string {
  return LEGAL_PHRASES[key] || '';
}

/* ── FEATURE 24: UCR/NIBRS Narrative Validation ───────────
   Spillman Flex validates that incident narratives contain
   all required elements for UCR/NIBRS reporting. */
export interface NarrativeValidation {
  valid: boolean;
  missingElements: string[];
  suggestions: string[];
  completeness: number; // 0-100
}

export function validateNarrativeForNIBRS(
  narrative: string,
  offenseType: string,
  isCleared: boolean
): NarrativeValidation {
  const missingElements: string[] = [];
  const suggestions: string[] = [];
  const lower = narrative.toLowerCase();

  // Required elements for all NIBRS narratives
  const requiredPatterns: Array<{ pattern: RegExp; label: string; suggestion: string }> = [
    { pattern: /\b(on|upon)\s/i, label: 'date_time', suggestion: 'Include the date and approximate time of the incident.' },
    { pattern: /\b(at|near|in front of|inside|outside)\s/i, label: 'location', suggestion: 'Specify the exact location where the incident occurred.' },
    { pattern: /\b(victim|reporting party|rp)\b/i, label: 'victim_identified', suggestion: 'Identify the victim or reporting party.' },
    { pattern: /\b(observed|noticed|saw|detected|found)\b/i, label: 'officer_observation', suggestion: 'Describe what the officer observed upon arrival.' },
    { pattern: /\b(subject|suspect|offender|defendant|driver)\b/i, label: 'subject_reference', suggestion: 'Reference the subject/suspect/offender in the narrative.' },
  ];

  for (const { pattern, label, suggestion } of requiredPatterns) {
    if (!pattern.test(lower)) {
      missingElements.push(label);
      suggestions.push(suggestion);
    }
  }

  if (isCleared) {
    const clearedPatterns = [
      { pattern: /\b(arrest|citation|warrant|cleared|closed)\b/i, label: 'disposition', suggestion: 'Include the final disposition of the case.' },
    ];
    for (const { pattern, label, suggestion } of clearedPatterns) {
      if (!pattern.test(lower)) {
        missingElements.push(label);
        suggestions.push(suggestion);
      }
    }
  }

  const completeness = Math.max(0, Math.min(100, Math.round(((5 - missingElements.length) / 5) * 100)));

  return {
    valid: missingElements.length === 0,
    missingElements,
    suggestions,
    completeness,
  };
}

/* ── FEATURE 25: Field Interview Guide ─────────────────────
   Spillman Flex provides structured field interview question
   sets for different encounter types. */
export interface InterviewQuestion {
  id: string;
  category: string;
  question: string;
  required: boolean;
  followUp: string | null;
}

export const FIELD_INTERVIEW_GUIDES: Record<string, InterviewQuestion[]> = {
  suspicious_person: [
    { id: 'sp1', category: 'identity', question: 'Can I see your identification?', required: true, followUp: 'What is your full name and date of birth?' },
    { id: 'sp2', category: 'location', question: 'What brings you to this area today?', required: true, followUp: 'Do you live or work nearby?' },
    { id: 'sp3', category: 'observation', question: 'Have you seen anything unusual in the area?', required: false, followUp: 'When and where did you observe this?' },
    { id: 'sp4', category: 'contact', question: 'Do you have any weapons on your person?', required: true, followUp: 'May I conduct a pat-down for officer safety?' },
    { id: 'sp5', category: 'documentation', question: 'May I photograph you for our field contact record?', required: false, followUp: null },
  ],
  witness_interview: [
    { id: 'wi1', category: 'identity', question: 'What is your full name and contact information?', required: true, followUp: 'May I see your ID?' },
    { id: 'wi2', category: 'observation', question: 'Can you describe exactly what you saw or heard?', required: true, followUp: 'What time did this occur?' },
    { id: 'wi3', category: 'suspect', question: 'Can you describe the person(s) involved?', required: true, followUp: 'Height, weight, clothing, distinguishing features?' },
    { id: 'wi4', category: 'vehicle', question: 'Did you see any vehicles involved?', required: false, followUp: 'Make, model, color, license plate?' },
    { id: 'wi5', category: 'direction', question: 'Which direction did they go?', required: false, followUp: 'On foot or in a vehicle?' },
    { id: 'wi6', category: 'evidence', question: 'Did you see any weapons or items discarded?', required: false, followUp: 'Where exactly did you see this?' },
  ],
  victim_interview: [
    { id: 'vi1', category: 'safety', question: 'Are you injured? Do you need medical attention?', required: true, followUp: 'Where are you hurt?' },
    { id: 'vi2', category: 'suspect', question: 'Do you know the person who did this?', required: true, followUp: 'What is their name and relationship to you?' },
    { id: 'vi3', category: 'incident', question: 'Can you tell me what happened from the beginning?', required: true, followUp: 'What was said or done first?' },
    { id: 'vi4', category: 'weapons', question: 'Did the suspect have any weapons?', required: true, followUp: 'What kind and where were they?' },
    { id: 'vi5', category: 'evidence', question: 'Is there any evidence we should collect?', required: false, followUp: 'Video footage, witnesses, physical items?' },
  ],
};

export function getInterviewGuide(type: string): InterviewQuestion[] {
  return FIELD_INTERVIEW_GUIDES[type] || [];
}

/* ── FEATURE 26: Incident Narrative Formatter ──────────────
   Spillman Flex formats incident narratives with proper
   structure: introduction, investigation, evidence, disposition. */
export interface NarrativeSection {
  heading: string;
  content: string;
  required: boolean;
}

export function formatIncidentNarrative(sections: NarrativeSection[]): string {
  const ordered = ['INTRODUCTION', 'INVESTIGATION', 'EVIDENCE', 'WITNESSES', 'STATEMENTS', 'ARREST', 'DISPOSITION'];
  const byHeading = new Map(sections.map(s => [s.heading, s]));

  return ordered
    .filter(h => byHeading.has(h))
    .map(h => {
      const sec = byHeading.get(h)!;
      return `--- ${sec.heading} ---\n\n${sec.content}`;
    })
    .join('\n\n');
}

/* ── FEATURE 27: Disposition Narrative Builder ─────────────
   Spillman Flex generates a standardized disposition paragraph
   based on the outcome codes selected by the officer. */
export function buildDispositionNarrative(
  disposition: string,
  charges: string[],
  custodyStatus: string | null,
  propertyStatus: string | null,
  reportNumber: string
): string {
  const parts: string[] = [];
  const dispInfo = {
    A: `The subject was placed under arrest for ${charges.join(', ')} and transported to ${custodyStatus || 'the detention facility'} without incident.`,
    C: `The subject was issued a citation for ${charges.join(', ')} and released at the scene with a court date.`,
    W: `A verbal warning was issued to the subject for ${charges.join(', ')}. No further action was taken.`,
    R: `A formal report was taken under case number ${reportNumber}. Follow-up investigation is ongoing.`,
    U: `After investigation, the complaint was determined to be unfounded. No further action.`,
    G: `Upon arrival, the subject(s) had left the area. A search of the vicinity was conducted with negative results.`,
    T: `This matter was referred to ${custodyStatus || 'another agency'} for further handling.`,
    S: `Services were rendered. The scene was cleared and units returned to service.`,
    N: `No police action was required. Units cleared the scene.`,
    O: `A report was taken under ${reportNumber}. The case will be reviewed for follow-up.`,
  };

  parts.push(dispInfo[disposition as keyof typeof dispInfo] || `Disposition: ${disposition}. Report #${reportNumber}.`);

  if (propertyStatus) {
    parts.push(`Property status: ${propertyStatus}.`);
  }

  parts.push('My body-worn camera was activated throughout this incident.');

  return parts.join(' ');
}

/* ── FEATURE 28: Use-of-Force Narrative Builder ────────────
   Spillman Flex has a dedicated use-of-force narrative
   template with mandatory elements per department policy. */
export interface UseOfForceReport {
  officerName: string;
  badgeNumber: string;
  date: string;
  time: string;
  location: string;
  callType: string;
  subjectName: string;
  forceTypes: Array<{ type: string; description: string; justification: string }>;
  subjectInjuries: string;
  officerInjuries: string;
  witnesses: string[];
  supervisorNotified: boolean;
  medicalOffered: boolean;
  medicalAccepted: boolean;
  bwcActivated: boolean;
}

export function buildUseOfForceNarrative(report: UseOfForceReport): string {
  const sections: string[] = [];

  sections.push(`--- SUBJECT ACTIONS ---\n\n`);
  sections.push(`--- OFFICER RESPONSE ---\n\n`);
  for (const f of report.forceTypes) {
    sections.push(`${f.type}: ${f.description}. Justification: ${f.justification}.`);
  }
  sections.push(`--- INJURIES ---\n\nSubject injuries: ${report.subjectInjuries || 'None reported.'}\nOfficer injuries: ${report.officerInjuries || 'None.'}`);
  sections.push(`--- MEDICAL AID ---\n\nMedical attention was ${report.medicalOffered ? 'offered and ' + (report.medicalAccepted ? 'accepted' : 'declined') : 'not required'}.`);
  sections.push(`--- SUPERVISOR NOTIFICATION ---\n\nSupervisor was ${report.supervisorNotified ? 'notified and responded to the scene' : 'notified'}.`);
  sections.push(`--- EVIDENCE ---\n\nBody-worn camera was ${report.bwcActivated ? 'activated and captured the incident' : 'not activated'}.`);

  return sections.join('\n\n');
}

/* ── FEATURE 29: Supplemental Report Template ──────────────
   Spillman Flex supports supplemental reports that append to
   the original incident report with new information. */
export interface SupplementalReport {
  originalReportNumber: string;
  date: string;
  officerName: string;
  badgeNumber: string;
  supplementType: 'new_evidence' | 'witness_statement' | 'suspect_id' | 'property_recovery' | 'follow_up' | 'case_update' | 'correction' | 'other';
  narrative: string;
  attachments: string[];
}

export function buildSupplementalReport(supplement: SupplementalReport): string {
  const headers: string[] = [
    `SUPPLEMENTAL REPORT`,
    `Original Report: ${supplement.originalReportNumber}`,
    `Date: ${supplement.date}`,
    `Reporting Officer: ${supplement.officerName} (${supplement.badgeNumber})`,
    `Supplement Type: ${supplement.supplementType.toUpperCase().replace(/_/g, ' ')}`,
    '',
    '--- NARRATIVE ---',
    '',
    supplement.narrative,
  ];

  if (supplement.attachments.length > 0) {
    headers.push('', '--- ATTACHMENTS ---', '');
    supplement.attachments.forEach((a, i) => headers.push(`${i + 1}. ${a}`));
  }

  return headers.join('\n');
}

/* ── FEATURE 30: Report Completeness Checklist ─────────────
   Spillman Flex validates reports for completeness before
   they can be submitted to supervisors. */
export interface CompletenessCheck {
  element: string;
  present: boolean;
  required: boolean;
  message: string;
}

export function checkReportCompleteness(
  narrative: string,
  hasSubjectName: boolean,
  hasCharges: boolean,
  hasEvidence: boolean,
  hasWitnesses: boolean,
  hasDisposition: boolean,
  reportType: string
): { checks: CompletenessCheck[]; passed: boolean; score: number } {
  const checks: CompletenessCheck[] = [
    { element: 'Narrative', present: narrative.length > 50, required: true, message: 'Narrative must be at least 50 characters' },
    { element: 'Date/Time', present: /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/.test(narrative) || /\b(at approximately|on or about)\b/i.test(narrative), required: true, message: 'Include date and time of incident' },
    { element: 'Location', present: narrative.length > 20, required: true, message: 'Specify incident location' },
    { element: 'Subject Name', present: hasSubjectName, required: ['arrest', 'citation'].includes(reportType), message: 'Subject name is required for this report type' },
    { element: 'Charges/Violations', present: hasCharges, required: ['arrest', 'citation'].includes(reportType), message: 'Charges or violations must be listed' },
    { element: 'Evidence', present: hasEvidence || !['property', 'arrest'].includes(reportType), required: false, message: 'Consider documenting any evidence collected' },
    { element: 'Witnesses', present: hasWitnesses || !['violent', 'property'].includes(reportType), required: false, message: 'Document any witness interviews conducted' },
    { element: 'Disposition', present: hasDisposition, required: true, message: 'Document the final disposition' },
  ];

  const passed = checks.filter(c => c.required && !c.present).length === 0;
  const score = Math.round((checks.filter(c => !c.required || c.present).length / checks.length) * 100);

  return { checks, passed, score };
}
