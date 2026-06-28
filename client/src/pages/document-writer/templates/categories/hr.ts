import type { DocumentTemplate } from '../../types';
import { AGENCY_HEADER, CONFIDENTIAL, title, section, tbl, row2, row1, SIG_BLOCK, DUAL_SIG_BLOCK , field,
} from '../_shared';

// 20 HR / administrative templates.
export const HR_TEMPLATES: DocumentTemplate[] = [
  {
    id: 'hr-offer', name: 'Offer of Employment', category: 'hr-employee',
    description: 'Formal written offer with at-will language',
    tags: ['offer', 'hire', 'at-will'],
    fields: [
      { key: 'employee', label: 'Employee', source: 'manual' },
      { key: 'position', label: 'Position', source: 'manual' },
      { key: 'start_date', label: 'Start Date', source: 'manual' },
      { key: 'wage', label: 'Wage / Salary', source: 'manual' },
    ],
    content: `${AGENCY_HEADER}${title('OFFER OF EMPLOYMENT')}
<p>Dear {{employee}},</p>
<p>On behalf of Rocky Mountain Protective Group, we are pleased to extend an offer of employment for the position of <strong>{{position}}</strong> with a start date of <strong>{{start_date}}</strong>.</p>
<p>Your compensation will be <strong>{{wage}}</strong>, paid on RMPG&rsquo;s regular pay schedule. Benefits eligibility is described in the employee handbook.</p>
<p>Your employment is &ldquo;at will,&rdquo; meaning either you or RMPG may end the relationship at any time, with or without cause or notice. Continued employment is contingent on (a) successful background check, (b) drug screen, and (c) any required state licensure under Utah Code Title 58 Ch. 63.</p>
<p>Please countersign below to accept.</p>${DUAL_SIG_BLOCK}`,
  },
  {
    id: 'hr-onboarding', name: 'New Hire Onboarding Checklist', category: 'hr-employee',
    description: 'Day-one checklist (I-9, W-4, uniform, badge, training)',
    tags: ['onboarding', 'new-hire', 'checklist'],
    fields: [{ key: 'employee', label: 'Employee', source: 'manual' }, { key: 'start_date', label: 'Start Date', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('NEW HIRE ONBOARDING')}<p><strong>Employee:</strong> {{employee}} &nbsp; <strong>Start Date:</strong> {{start_date}}</p>
${section('PAPERWORK')}<p>☐ I-9 (with originals seen) ☐ W-4 ☐ Direct deposit ☐ Employee handbook acknowledgment ☐ Confidentiality agreement</p>
${section('EQUIPMENT')}<p>☐ Uniform issue ☐ Badge ID# ____ ☐ Vehicle assigned ☐ Radio ☐ Phone ☐ MDT</p>
${section('TRAINING')}<p>☐ De-escalation ☐ Report writing ☐ UoF policy ☐ DV protocol ☐ CPR/AED ☐ Site-specific orientation</p>
${section('SYSTEM ACCESS')}<p>☐ Email ☐ Flex CAD ☐ Records ☐ MDT credentials ☐ Time clock</p>${DUAL_SIG_BLOCK}`,
  },
  {
    id: 'hr-verbal-warning', name: 'Verbal Warning Documentation', category: 'hr-discipline',
    description: 'Documents an oral counseling',
    tags: ['verbal', 'warning', 'discipline'],
    fields: [{ key: 'employee', label: 'Employee', source: 'manual' }, { key: 'date', label: 'Date', source: 'manual' }, { key: 'issue', label: 'Issue', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('VERBAL WARNING — DOCUMENTATION')}<p><strong>Employee:</strong> {{employee}} &nbsp; <strong>Date:</strong> {{date}}</p>
${section('ISSUE')}<p>{{issue}}</p>${section('POLICY REFERENCED')}<p>&nbsp;</p>${section('EXPECTED CORRECTION')}<p>&nbsp;</p>${section('EMPLOYEE RESPONSE')}<p>&nbsp;</p>${DUAL_SIG_BLOCK}`,
  },
  {
    id: 'hr-written-warning', name: 'Written Warning', category: 'hr-discipline',
    description: 'Formal written corrective action',
    tags: ['written', 'warning', 'discipline', 'corrective'],
    fields: [{ key: 'employee', label: 'Employee', source: 'manual' }, { key: 'issue', label: 'Issue', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('WRITTEN WARNING')}<p><strong>Employee:</strong> {{employee}}</p>
${section('NATURE OF ISSUE')}<p>{{issue}}</p>${section('PRIOR DISCUSSIONS / DOCUMENTATION')}<p>&nbsp;</p>${section('CORRECTIVE EXPECTATIONS')}<p>&nbsp;</p>${section('CONSEQUENCES OF NON-CORRECTION')}<p>Further infractions may result in suspension or termination.</p>${section('EMPLOYEE COMMENTS')}<p>&nbsp;</p>${DUAL_SIG_BLOCK}`,
  },
  {
    id: 'hr-pip', name: 'Performance Improvement Plan (PIP)', category: 'hr-discipline',
    description: '30/60/90 day improvement plan with measurable goals',
    tags: ['pip', 'performance', 'improvement'],
    fields: [{ key: 'employee', label: 'Employee', source: 'manual' }, { key: 'supervisor', label: 'Supervisor', source: 'manual' }, { key: 'duration', label: 'Duration', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('PERFORMANCE IMPROVEMENT PLAN')}${tbl(row2(field('Employee', '{{employee}}'), field('Supervisor', '{{supervisor}}')) + row1(field('Duration', '{{duration}}')))}
${section('AREAS REQUIRING IMPROVEMENT')}<p>&nbsp;</p>
${section('MEASURABLE GOALS')}<table><tr><th>Goal</th><th>Measurement</th><th>Deadline</th></tr><tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr></table>
${section('SUPPORT &amp; RESOURCES')}<p>&nbsp;</p>${section('CHECK-IN SCHEDULE')}<p>Day 30 / 60 / 90</p>${section('CONSEQUENCES IF NOT MET')}<p>Failure to meet PIP goals may result in termination of employment.</p>${DUAL_SIG_BLOCK}`,
  },
  {
    id: 'hr-suspension', name: 'Suspension Notice', category: 'hr-discipline',
    description: 'Paid or unpaid administrative leave notice',
    tags: ['suspension', 'administrative-leave'],
    fields: [{ key: 'employee', label: 'Employee', source: 'manual' }, { key: 'effective', label: 'Effective Date', source: 'manual' }, { key: 'duration', label: 'Duration', source: 'manual' }, { key: 'pay_status', label: 'Paid/Unpaid', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('NOTICE OF SUSPENSION')}<p>Dear {{employee}},</p>
<p>Effective <strong>{{effective}}</strong>, you are placed on <strong>{{pay_status}}</strong> administrative leave for a period of <strong>{{duration}}</strong> pending investigation.</p>
${section('OBLIGATIONS WHILE ON LEAVE')}<ul><li>Remain reachable during business hours</li><li>Do not enter RMPG premises or client sites without escort</li><li>Return uniform, badge, and equipment as directed</li><li>Do not contact involved witnesses or employees about the matter</li></ul>${DUAL_SIG_BLOCK}`,
  },
  {
    id: 'hr-termination', name: 'Termination of Employment', category: 'hr-discipline',
    description: 'For-cause or no-cause termination letter',
    tags: ['termination', 'separation', 'fire'],
    fields: [{ key: 'employee', label: 'Employee', source: 'manual' }, { key: 'last_day', label: 'Last Day', source: 'manual' }, { key: 'reason', label: 'Reason (optional)', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('NOTICE OF TERMINATION')}<p>Dear {{employee}},</p>
<p>Your employment with Rocky Mountain Protective Group is terminated effective <strong>{{last_day}}</strong>.</p>
<p>{{reason}}</p>
${section('FINAL PAY')}<p>Your final paycheck, including any accrued and unused PTO as required by Utah Code §34-28-5, will be issued on the next regular payday or within 24 hours per Utah involuntary-termination rules.</p>
${section('PROPERTY RETURN')}<p>Please return uniform, badge, keys, radio, weapons, and any other RMPG property by your last day.</p>
${section('BENEFITS')}<p>Information regarding COBRA continuation of health benefits will be mailed separately.</p>${DUAL_SIG_BLOCK}`,
  },
  {
    id: 'hr-resignation', name: 'Resignation Acknowledgment', category: 'hr-employee',
    description: 'Acceptance of voluntary resignation',
    tags: ['resignation', 'voluntary'],
    fields: [{ key: 'employee', label: 'Employee', source: 'manual' }, { key: 'last_day', label: 'Last Day', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('RESIGNATION ACKNOWLEDGMENT')}<p>Dear {{employee}},</p>
<p>We have received and accepted your resignation, effective <strong>{{last_day}}</strong>. We thank you for your service and wish you well.</p>
${section('OFFBOARDING ITEMS')}<p>☐ Final pay computed ☐ Exit interview scheduled ☐ Property return ☐ Access revoked ☐ Final report submitted</p>${DUAL_SIG_BLOCK}`,
  },
  {
    id: 'hr-exit', name: 'Exit Interview', category: 'hr-employee',
    description: 'Structured exit interview form',
    tags: ['exit', 'interview', 'offboarding'],
    fields: [{ key: 'employee', label: 'Employee', source: 'manual' }, { key: 'interviewer', label: 'Interviewer', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('EXIT INTERVIEW')}<p><strong>Employee:</strong> {{employee}} &nbsp; <strong>Interviewer:</strong> {{interviewer}}</p>
${section('REASON FOR LEAVING')}<p>&nbsp;</p>${section('WHAT WORKED WELL')}<p>&nbsp;</p>${section('OPPORTUNITIES FOR IMPROVEMENT')}<p>&nbsp;</p>${section('TRAINING / SUPPORT GAPS')}<p>&nbsp;</p>${section('WOULD YOU RECOMMEND RMPG?')}<p>Y / N — Why?</p>${SIG_BLOCK}`,
  },
  {
    id: 'hr-review', name: 'Performance Review', category: 'hr-employee',
    description: 'Annual / probationary performance review',
    tags: ['review', 'performance', 'evaluation'],
    fields: [{ key: 'employee', label: 'Employee', source: 'manual' }, { key: 'period', label: 'Review Period', source: 'manual' }, { key: 'reviewer', label: 'Reviewer', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('PERFORMANCE REVIEW')}${tbl(row2(field('Employee', '{{employee}}'), field('Period', '{{period}}')) + row1(field('Reviewer', '{{reviewer}}')))}
<table><tr><th>Competency</th><th>Rating (1-5)</th><th>Comments</th></tr>
${['Job knowledge','Quality of work','Productivity','Reliability','Communication','Teamwork','Customer service','Safety / policy','Initiative','Leadership'].map(c=>`<tr><td>${c}</td><td>&nbsp;</td><td>&nbsp;</td></tr>`).join('')}</table>
${section('STRENGTHS')}<p>&nbsp;</p>${section('GOALS FOR NEXT PERIOD')}<p>&nbsp;</p>${section('EMPLOYEE RESPONSE')}<p>&nbsp;</p>${DUAL_SIG_BLOCK}`,
  },
  {
    id: 'hr-training-acknowledgment', name: 'Training Acknowledgment', category: 'hr-training',
    description: 'Acknowledgment of completing required training',
    tags: ['training', 'acknowledgment'],
    fields: [{ key: 'employee', label: 'Employee', source: 'manual' }, { key: 'course', label: 'Course', source: 'manual' }, { key: 'date', label: 'Completion Date', source: 'manual' }, { key: 'hours', label: 'Hours', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('TRAINING ACKNOWLEDGMENT')}${tbl(row2(field('Employee', '{{employee}}'), field('Course', '{{course}}')) + row2(field('Date', '{{date}}'), field('Hours', '{{hours}}')))}
<p>I certify that I attended the above training, understand the content, and agree to apply the material in my duties at RMPG.</p>${DUAL_SIG_BLOCK}`,
  },
  {
    id: 'hr-training-roster', name: 'Training Roster', category: 'hr-training',
    description: 'Attendance roster for a training session',
    tags: ['roster', 'training', 'attendance'],
    fields: [{ key: 'course', label: 'Course', source: 'manual' }, { key: 'date', label: 'Date', source: 'manual' }, { key: 'instructor', label: 'Instructor', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('TRAINING ROSTER')}${tbl(row2(field('Course', '{{course}}'), field('Date', '{{date}}')) + row1(field('Instructor', '{{instructor}}')))}
<table><tr><th>Name</th><th>Badge#</th><th>Signature</th></tr>${Array(15).fill(0).map(()=>`<tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>`).join('')}</table>${SIG_BLOCK}`,
  },
  {
    id: 'hr-firearm-cert', name: 'Firearms Qualification Record', category: 'hr-training',
    description: 'Quarterly firearm qualification scoring sheet',
    tags: ['firearm', 'qualification', 'training'],
    fields: [{ key: 'employee', label: 'Employee', source: 'manual' }, { key: 'weapon', label: 'Weapon / Serial', source: 'manual' }, { key: 'date', label: 'Date', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('FIREARMS QUALIFICATION RECORD')}${tbl(row2(field('Employee', '{{employee}}'), field('Weapon', '{{weapon}}')) + row1(field('Date', '{{date}}')))}
${section('SCORING')}<p>Score: ____ / 250 &nbsp; Required: 175 &nbsp; ☐ PASS ☐ FAIL</p>
${section('NOTES')}<p>&nbsp;</p>${DUAL_SIG_BLOCK}`,
  },
  {
    id: 'hr-leave-request', name: 'Leave Request', category: 'hr-leave',
    description: 'PTO / sick / unpaid leave request',
    tags: ['leave', 'pto', 'request'],
    fields: [{ key: 'employee', label: 'Employee', source: 'manual' }, { key: 'type', label: 'Leave Type', source: 'manual' }, { key: 'start', label: 'Start', source: 'manual' }, { key: 'end', label: 'End', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('LEAVE REQUEST')}${tbl(row2(field('Employee', '{{employee}}'), field('Type', '{{type}}')) + row2(field('Start', '{{start}}'), field('End', '{{end}}')))}
${section('REASON')}<p>&nbsp;</p>${section('COVERAGE ARRANGED')}<p>&nbsp;</p>${section('SUPERVISOR DECISION')}<p>☐ Approved ☐ Denied — Reason:</p>${DUAL_SIG_BLOCK}`,
  },
  {
    id: 'hr-fmla', name: 'FMLA Notice', category: 'hr-leave',
    description: 'Family &amp; Medical Leave Act notification + eligibility',
    tags: ['fmla', 'medical-leave'],
    fields: [{ key: 'employee', label: 'Employee', source: 'manual' }, { key: 'requested_start', label: 'Requested Start', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('FMLA NOTICE OF ELIGIBILITY')}<p><strong>Employee:</strong> {{employee}} &nbsp; <strong>Requested Start:</strong> {{requested_start}}</p>
${section('ELIGIBILITY DETERMINATION')}<p>☐ Eligible ☐ Not eligible — reason:</p>
${section('CERTIFICATION REQUIRED')}<p>Medical certification must be returned within 15 calendar days (WH-380-E/F).</p>
${section('JOB RESTORATION')}<p>Employee will be restored to the same or equivalent position upon return.</p>${DUAL_SIG_BLOCK}`,
  },
  {
    id: 'hr-injury', name: 'Workplace Injury Report (Workers&rsquo; Comp)', category: 'hr-employee',
    description: 'On-the-job injury intake for workers&rsquo; comp filing',
    tags: ['injury', 'workers-comp', 'osha'],
    fields: [{ key: 'employee', label: 'Employee', source: 'manual' }, { key: 'date', label: 'Date/Time', source: 'manual' }, { key: 'location', label: 'Location', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('WORKPLACE INJURY REPORT', '#7a2418')}${tbl(row2(field('Employee', '{{employee}}'), field('Date/Time', '{{date}}')) + row1(field('Location', '{{location}}')))}
${section('NATURE OF INJURY')}<p>&nbsp;</p>${section('HOW IT OCCURRED')}<p>&nbsp;</p>${section('BODY PART(S)')}<p>&nbsp;</p>${section('MEDICAL CARE SOUGHT')}<p>☐ First aid ☐ Clinic ☐ ER ☐ None</p>${section('WITNESSES')}<p>&nbsp;</p>${section('SUPERVISOR NOTIFIED')}<p>Name / Time: ____</p>${DUAL_SIG_BLOCK}`,
  },
  {
    id: 'hr-equipment-issue', name: 'Equipment Issue Receipt', category: 'hr-employee',
    description: 'Acknowledgment of company-issued equipment',
    tags: ['equipment', 'issue', 'receipt'],
    fields: [{ key: 'employee', label: 'Employee', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('EQUIPMENT ISSUE')}<p><strong>Employee:</strong> {{employee}}</p>
<table><tr><th>Item</th><th>Serial / ID</th><th>Condition</th></tr>${['Uniform','Badge','Radio','OC spray','Body camera','Vehicle key','Phone'].map(i=>`<tr><td>${i}</td><td>&nbsp;</td><td>&nbsp;</td></tr>`).join('')}</table>
<p>I acknowledge receipt of the above items and agree to return them in working condition upon separation. The cost of unreturned or damaged equipment may be deducted from my final pay to the extent permitted by Utah Code §34-28-3.</p>${DUAL_SIG_BLOCK}`,
  },
  {
    id: 'hr-handbook-ack', name: 'Employee Handbook Acknowledgment', category: 'hr-employee',
    description: 'Receipt + acknowledgment of handbook + at-will status',
    tags: ['handbook', 'acknowledgment', 'at-will'],
    fields: [{ key: 'employee', label: 'Employee', source: 'manual' }, { key: 'version', label: 'Handbook Version', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('HANDBOOK ACKNOWLEDGMENT')}<p>I, <strong>{{employee}}</strong>, acknowledge that I have received the RMPG Employee Handbook (version {{version}}). I understand that I am responsible for reading and following all policies.</p>
<p>I further acknowledge that my employment is &ldquo;at will&rdquo; and that nothing in the handbook creates a contract of employment.</p>${DUAL_SIG_BLOCK}`,
  },
  {
    id: 'hr-confidentiality', name: 'Confidentiality &amp; NDA', category: 'hr-employee',
    description: 'Employee confidentiality and non-disclosure agreement',
    tags: ['nda', 'confidentiality'],
    fields: [{ key: 'employee', label: 'Employee', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('CONFIDENTIALITY &amp; NON-DISCLOSURE AGREEMENT')}<p>I, <strong>{{employee}}</strong>, agree that during and after my employment with Rocky Mountain Protective Group I will not disclose any confidential information, including but not limited to:</p>
<ul><li>Client information, post orders, and site security details</li><li>Personnel records, payroll, or disciplinary matters</li><li>Investigative information, case records, and CAD data</li><li>RMPG proprietary methods, software, and training materials</li></ul>
<p>Breach of this agreement may result in termination and civil or criminal liability under Utah Code §13-24 (Uniform Trade Secrets Act).</p>${DUAL_SIG_BLOCK}`,
  },
  {
    id: 'hr-incident-investigation', name: 'Internal Affairs / IA Investigation', category: 'hr-discipline',
    description: 'Internal investigation report on employee conduct',
    tags: ['ia', 'internal-affairs', 'investigation'],
    fields: [{ key: 'subject', label: 'Subject Employee', source: 'manual' }, { key: 'investigator', label: 'Investigator', source: 'manual' }, { key: 'complaint_no', label: 'Complaint #', source: 'manual' }],
    content: `${AGENCY_HEADER}${title('INTERNAL AFFAIRS INVESTIGATION', '#7a2418')}${CONFIDENTIAL}${tbl(row2(field('Subject', '{{subject}}'), field('Investigator', '{{investigator}}')) + row1(field('Complaint #', '{{complaint_no}}')))}
${section('ALLEGATION')}<p>&nbsp;</p>${section('GARRITY/WEINGARTEN NOTICE GIVEN')}<p>☐ Yes — date/time: ____</p>${section('EVIDENCE EXAMINED')}<p>&nbsp;</p>${section('WITNESS INTERVIEWS')}<p>&nbsp;</p>${section('FINDINGS')}<p>☐ Sustained ☐ Not sustained ☐ Unfounded ☐ Exonerated</p>${section('RECOMMENDED ACTION')}<p>&nbsp;</p>${DUAL_SIG_BLOCK}`,
  },
];
