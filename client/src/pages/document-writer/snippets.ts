// Quick-insert snippet library for the Document Writer. Common, reusable
// boilerplate phrases an officer drops into a narrative at the cursor — Miranda
// text, consent-to-search language, standard disclaimers, and report closers.
// Each snippet inserts HTML at the current selection via editor.insertContent.

export interface Snippet {
  id: string;
  label: string;
  category: string;
  /** HTML inserted at the cursor. Kept inline-friendly so it flows into prose. */
  html: string;
}

export const SNIPPETS: Snippet[] = [
  // ── Advisements ──
  {
    id: 'miranda',
    label: 'Miranda warning (full)',
    category: 'Advisements',
    html:
      '<p>"You have the right to remain silent. Anything you say can and will be used against you in a court of law. You have the right to an attorney. If you cannot afford an attorney, one will be appointed for you. Do you understand each of these rights I have explained to you, and having these rights in mind, do you wish to talk to me?"</p>',
  },
  {
    id: 'miranda-invoked',
    label: 'Miranda invoked',
    category: 'Advisements',
    html:
      '<p>After being advised of the above rights, the subject invoked the right to remain silent and/or requested an attorney. All questioning ceased at that time.</p>',
  },
  {
    id: 'miranda-waived',
    label: 'Miranda waived',
    category: 'Advisements',
    html:
      '<p>After being advised of the above rights, the subject acknowledged understanding and agreed to speak with me without an attorney present.</p>',
  },
  {
    id: 'consent-search',
    label: 'Consent to search (verbal)',
    category: 'Advisements',
    html:
      '<p>I advised the subject of their right to refuse a search. The subject voluntarily consented to a search of the above-described person, vehicle, or property, without threat or promise. Consent was given freely and could be withdrawn at any time.</p>',
  },
  {
    id: 'trespass-advised',
    label: 'Trespass admonishment',
    category: 'Advisements',
    html:
      '<p>The subject was advised that they are no longer permitted on the property and that returning may result in arrest for criminal trespass pursuant to applicable Utah Code.</p>',
  },

  // ── Stop / contact ──
  {
    id: 'reasonable-suspicion',
    label: 'Reasonable suspicion preface',
    category: 'Stop / Contact',
    html:
      '<p>Based on the totality of the circumstances and my training and experience, I developed reasonable suspicion that criminal activity was afoot, and I detained the subject to investigate further.</p>',
  },
  {
    id: 'probable-cause',
    label: 'Probable cause preface',
    category: 'Stop / Contact',
    html:
      '<p>Based on the facts and circumstances within my knowledge, I had probable cause to believe that the subject had committed the offense(s) described herein.</p>',
  },
  {
    id: 'consensual-encounter',
    label: 'Consensual encounter',
    category: 'Stop / Contact',
    html:
      '<p>I made consensual contact with the subject, who was free to leave at any time and was not detained.</p>',
  },

  // ── Narrative scaffolding ──
  {
    id: 'dispatch-preface',
    label: 'Dispatched-to preface',
    category: 'Narrative',
    html:
      '<p>On the above date and time, I was dispatched to the above location in reference to a report of [nature of call]. Upon arrival, I made contact with [person] who stated the following:</p>',
  },
  {
    id: 'observed',
    label: 'Upon arrival I observed',
    category: 'Narrative',
    html: '<p>Upon arrival, I observed [describe scene/persons/vehicles]. </p>',
  },
  {
    id: 'no-further-action',
    label: 'No further action',
    category: 'Narrative',
    html: '<p>No further police action was necessary at this time. This case is closed by [disposition].</p>',
  },
  {
    id: 'refer-detective',
    label: 'Referred for follow-up',
    category: 'Narrative',
    html: '<p>This case is being forwarded to the appropriate unit for follow-up investigation.</p>',
  },

  // ── Disclaimers / closings ──
  {
    id: 'oath-of-truth',
    label: 'Declaration of truth',
    category: 'Disclaimers',
    html:
      '<p>I declare under criminal penalty under the law of the State of Utah that the foregoing is true and correct to the best of my knowledge and belief.</p>',
  },
  {
    id: 'bwc-active',
    label: 'Body-worn camera active',
    category: 'Disclaimers',
    html: '<p>This contact was recorded on my body-worn camera. The recording is available under the above case number.</p>',
  },
  {
    id: 'confidential-notice',
    label: 'Confidential record notice',
    category: 'Disclaimers',
    html:
      '<p style="font-size:10px;color:#888;"><em>CONFIDENTIAL — This document is part of a law-enforcement record and may be exempt from public disclosure. Unauthorized dissemination is prohibited.</em></p>',
  },
  {
    id: 'end-of-report',
    label: 'End of report',
    category: 'Disclaimers',
    html: '<p style="text-align:center;color:#888;">— END OF REPORT —</p>',
  },
];

/** Snippets grouped by category, preserving the array order. */
export function snippetsByCategory(): Record<string, Snippet[]> {
  return SNIPPETS.reduce<Record<string, Snippet[]>>((acc, s) => {
    (acc[s.category] ||= []).push(s);
    return acc;
  }, {});
}
