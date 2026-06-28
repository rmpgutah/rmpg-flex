// Standard investigative task templates per case type (v3 Phase 2). Typed
// code config (admin-configurable templates are deliberately out of scope).
// Applied via POST /cases/:id/tasks/apply-template, skipping titles already
// present so re-applying is safe.

export interface TaskTemplateItem { title: string; priority: string }

export const CASE_TASK_TEMPLATES: Record<string, TaskTemplateItem[]> = {
  default: [
    { title: 'Review and document initial findings', priority: 'normal' },
    { title: 'Identify and contact involved parties', priority: 'normal' },
    { title: 'Collect and log available evidence', priority: 'high' },
    { title: 'Prepare case summary', priority: 'normal' },
  ],
  criminal: [
    { title: 'Canvass area for witnesses', priority: 'high' },
    { title: 'Collect and log physical evidence', priority: 'high' },
    { title: 'Identify suspect(s)', priority: 'high' },
    { title: 'Request / review surveillance footage', priority: 'normal' },
    { title: 'Interview victim(s) and witnesses', priority: 'normal' },
    { title: 'Prepare case for prosecutorial review', priority: 'normal' },
  ],
  burglary: [
    { title: 'Process scene for prints / DNA', priority: 'high' },
    { title: 'Canvass for witnesses and cameras', priority: 'high' },
    { title: 'Document point of entry and loss', priority: 'normal' },
    { title: 'Enter stolen property into NCIC', priority: 'normal' },
  ],
  theft: [
    { title: 'Document stolen property and value', priority: 'normal' },
    { title: 'Enter serialized property into NCIC', priority: 'normal' },
    { title: 'Review surveillance footage', priority: 'normal' },
    { title: 'Identify suspect(s)', priority: 'high' },
  ],
  narcotics: [
    { title: 'Field-test and log seized substances', priority: 'high' },
    { title: 'Document chain of custody', priority: 'high' },
    { title: 'Identify source / distribution', priority: 'normal' },
    { title: 'Coordinate lab analysis request', priority: 'normal' },
  ],
  missing_person: [
    { title: 'Enter into NCIC missing-person file', priority: 'urgent' },
    { title: 'Obtain recent photo and description', priority: 'high' },
    { title: 'Contact known associates / family', priority: 'high' },
    { title: 'Check hospitals / shelters / known locations', priority: 'high' },
    { title: 'Issue BOLO', priority: 'high' },
  ],
};

/** Standard tasks for a case type, falling back to the default set. */
export function pickTemplate(caseType?: string | null): TaskTemplateItem[] {
  const t = String(caseType || '').toLowerCase();
  return CASE_TASK_TEMPLATES[t] || CASE_TASK_TEMPLATES.default;
}
