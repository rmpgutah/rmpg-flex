// src/utils/researchPrompts.ts
// Pure prompt builders for each pipeline stage. Kept separate so prompts can be
// tuned without touching orchestration. ANGLE_GUIDE is the operator-tunable knob.

export interface Prompt { system?: string; user: string; }

export const ANGLE_GUIDE: Record<string, string> = {
  person: 'identity & aliases; criminal/legal history; business & employment; social & online presence; news mentions; known associates',
  business: 'ownership & registration; licensing & violations; litigation; reputation & reviews; key people; news & filings',
  address: 'ownership & property records; occupants; incident history; nearby risks; permits & violations',
  vehicle: 'registration & title; sightings; associated persons; theft/lien status',
  lead: 'company profile; decision-makers; budget & buying signals; incumbent vendors; recent news',
  competitor: 'services & pricing; clients & contracts; staffing; reputation; recent news',
  topic: 'overview; key facts; risks & criticism; primary sources',
};

export function anglePrompt(subject: string, subjectType: string, context?: string): Prompt {
  const system = 'You are an investigative research planner for a law-enforcement records system. '
    + 'Given a subject, produce 3-6 DISTINCT research angles that together give broad coverage. '
    + 'Return JSON only: {"angles":["...","..."]}. No prose.';
  const hint = ANGLE_GUIDE[subjectType] || ANGLE_GUIDE.topic;
  const user = `Subject: ${subject}\nType: ${subjectType}\n`
    + (context ? `Context: ${context}\n` : '')
    + `Dimensions to consider: ${hint}.`;
  return { system, user };
}

export function extractPrompt(subject: string, sources: { url: string; markdown: string }[]): Prompt {
  const system = 'You extract structured findings from web sources for an investigative dossier. '
    + 'Return JSON only: {"findings":[{"finding_type":"entity|risk_flag|fact|relationship|contact|asset|timeline",'
    + '"title":"short","detail":"one or two sentences","confidence":0.0-1.0,"source_urls":["urls that support this"]}]}. '
    + 'Only include findings grounded in the provided sources. No prose.';
  const body = sources
    .map((s, i) => `--- SOURCE ${i + 1}: ${s.url} ---\n${(s.markdown || '').slice(0, 4000)}`)
    .join('\n\n');
  const user = `Subject of research: ${subject}\n\nSources:\n${body}`;
  return { system, user };
}

export function verifyPrompt(finding: { title: string; detail: string }, sources: { url: string; markdown: string }[]): Prompt {
  const system = 'You are a skeptical fact-checker. Decide whether the claim is supported by the evidence. '
    + 'Default to "uncertain" when evidence is thin and "refuted" when it contradicts. '
    + 'Return JSON only: {"verdict":"supported|uncertain|refuted","reason":"..."}.';
  const body = sources
    .map((s, i) => `--- SOURCE ${i + 1}: ${s.url} ---\n${(s.markdown || '').slice(0, 3000)}`)
    .join('\n\n');
  const user = `Claim: ${finding.title} — ${finding.detail}\n\nEvidence:\n${body}`;
  return { system, user };
}

export function synthesisPrompt(
  subject: string,
  findings: { title: string; detail: string; trust: number; citations: number[] }[],
  sources: { n: number; url: string; title: string }[],
): Prompt {
  const system = 'You write a concise investigative research report in Markdown using ONLY the verified '
    + 'findings provided. Cite sources inline as [n]. Note where trust is low. End with a "## Sources" '
    + 'list mapping each [n] to its URL. Do not invent facts.';
  const fb = findings
    .map((f) => `- (${Math.round(f.trust * 100)}% trust) ${f.title}: ${f.detail} ${f.citations.map((c) => `[${c}]`).join('')}`)
    .join('\n');
  const sb = sources.map((s) => `[${s.n}] ${s.title} — ${s.url}`).join('\n');
  const user = `Subject: ${subject}\n\nVerified findings:\n${fb}\n\nSources:\n${sb}`;
  return { system, user };
}
