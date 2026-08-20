// ============================================================
// Dispatch Page — Shared Label Maps & Option Constants
// ============================================================

// --------------- Call Status Groupings ---------------

export const TERMINAL_STATUSES = new Set(['cleared', 'closed', 'cancelled', 'archived']);
export const COMPLETED_STATUSES = new Set(['cleared', 'closed', 'cancelled']);
export const INACTIVE_STATUSES = new Set(['cleared', 'closed', 'cancelled', 'on_hold', 'archived']);
export const ACTIVE_FIELD_STATUSES = new Set(['dispatched', 'enroute', 'onscene']);
export const POST_DISPATCH_STATUSES = new Set(['dispatched', 'enroute', 'onscene', 'cleared', 'closed']);
export const RESOLVED_STATUSES = new Set(['cleared', 'closed']);
export const FINISHED_STATUSES = new Set(['cleared', 'closed', 'archived']);
export const ACTIONABLE_STATUSES = new Set(['pending', 'dispatched', 'enroute', 'onscene']);
export const OPEN_STATUSES = new Set(['pending', 'dispatched', 'enroute', 'onscene', 'on_hold']);
export const REMOVED_STATUSES = new Set(['archived', 'cancelled']);

export const SERVICE_TYPE_LABELS: Record<string, string> = {
  // Process Service
  process_service: 'Process Service (General)',
  subpoena_service: 'Subpoena Service',
  summons_service: 'Summons & Complaint',
  eviction_service: 'Eviction / Unlawful Detainer',
  restraining_order_service: 'Protective Order Service',
  writ_service: 'Writ Service',
  court_filing: 'Court Filing / Delivery',
  court_order_service: 'Court Order Service',
  notice_service: 'Notice / Demand Service',
  posting_service: 'Posting Service (Nail & Mail)',
  // Investigative
  skip_trace: 'Skip Trace & Locate',
  stake_out: 'Stake Out / Surveillance',
  rush_service: 'Rush / Same-Day Service',
  asset_search: 'Asset Search',
  background_check: 'Background Check / Due Diligence',
  witness_interview: 'Witness Interview / Statement',
  witness_locate: 'Witness Locate',
  record_retrieval: 'Record Retrieval',
  document_retrieval: 'Document Retrieval',
  field_investigation: 'Field Investigation',
  insurance_investigation: 'Insurance Investigation',
  // Security Services
  patrol: 'Patrol',
  static_guard: 'Static Guard',
  escort: 'Escort',
  event_security: 'Event Security',
  surveillance: 'Surveillance',
  access_control: 'Access Control',
  alarm_response: 'Alarm Response',
  fire_watch: 'Fire Watch',
  construction_security: 'Construction Site Security',
  executive_protection: 'Executive Protection',
  loss_prevention: 'Loss Prevention',
  // Administrative
  notary_service: 'Notary Service',
  certified_copy: 'Certified Copy Service',
  courier: 'Courier / Messenger',
  document_preparation: 'Document Preparation',
  affidavit_preparation: 'Affidavit Preparation',
  other: 'Other',
};

export const SERVICE_TYPE_GROUPS: { label: string; keys: string[] }[] = [
  {
    label: 'Process Service',
    keys: [
      'process_service', 'subpoena_service', 'summons_service', 'eviction_service',
      'restraining_order_service', 'writ_service', 'court_filing', 'court_order_service',
      'notice_service', 'posting_service', 'rush_service',
    ],
  },
  {
    label: 'Investigative',
    keys: [
      'skip_trace', 'stake_out', 'asset_search', 'background_check',
      'witness_interview', 'witness_locate', 'record_retrieval', 'document_retrieval',
      'field_investigation', 'insurance_investigation',
    ],
  },
  {
    label: 'Security Services',
    keys: [
      'patrol', 'static_guard', 'escort', 'event_security', 'surveillance',
      'access_control', 'alarm_response', 'fire_watch', 'construction_security',
      'executive_protection', 'loss_prevention',
    ],
  },
  {
    label: 'Administrative',
    keys: ['notary_service', 'certified_copy', 'courier', 'document_preparation', 'affidavit_preparation', 'other'],
  },
];

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  // Civil Process — General
  subpoena: 'Subpoena',
  subpoena_duces_tecum: 'Subpoena Duces Tecum',
  subpoena_deposition: 'Subpoena (Deposition)',
  federal_subpoena: 'Federal Subpoena',
  summons: 'Summons & Complaint',
  complaint: 'Complaint',
  civil_summons: 'Civil Summons',
  third_party_complaint: 'Third-Party Complaint',
  cross_complaint: 'Cross-Complaint',
  counterclaim: 'Counterclaim',
  amended_complaint: 'Amended Complaint',
  small_claims: 'Small Claims',
  // Writs & Garnishments
  garnishment: 'Garnishment',
  writ_of_execution: 'Writ of Execution',
  writ_of_restitution: 'Writ of Restitution',
  writ_of_garnishment: 'Writ of Garnishment',
  writ_of_attachment: 'Writ of Attachment',
  writ_of_possession: 'Writ of Possession',
  writ_of_assistance: 'Writ of Assistance',
  writ_of_mandate: 'Writ of Mandate / Mandamus',
  wage_garnishment: 'Wage Garnishment',
  bank_levy: 'Bank Levy / Account Garnishment',
  // Family / Domestic
  restraining_order: 'Protective / Restraining Order',
  temporary_protective_order: 'Temporary Protective Order',
  cohabitant_abuse_order: 'Cohabitant Abuse Protective Order',
  divorce_papers: 'Divorce Papers',
  divorce_petition: 'Divorce Petition',
  divorce_summons: 'Divorce Summons',
  custody_order: 'Custody Order',
  custody_modification: 'Custody Modification',
  child_support: 'Child Support Order',
  child_support_modification: 'Child Support Modification',
  paternity_action: 'Paternity Action',
  adoption_papers: 'Adoption Papers',
  guardianship: 'Guardianship Petition',
  termination_of_parental_rights: 'Termination of Parental Rights',
  stalking_injunction: 'Stalking Injunction',
  // Real Property
  eviction: 'Eviction Notice',
  unlawful_detainer: 'Unlawful Detainer',
  notice_to_quit: 'Notice to Quit',
  three_day_notice: '3-Day Notice to Pay or Quit',
  five_day_notice: '5-Day Notice (Commercial)',
  fifteen_day_notice: '15-Day Notice (Month-to-Month)',
  foreclosure: 'Foreclosure Notice',
  notice_of_default: 'Notice of Default',
  lis_pendens: 'Lis Pendens',
  quiet_title: 'Quiet Title Action',
  // Court Orders & Motions
  court_order: 'Court Order',
  temporary_order: 'Temporary Order',
  temporary_restraining_order: 'Temporary Restraining Order',
  preliminary_injunction: 'Preliminary Injunction',
  permanent_injunction: 'Permanent Injunction',
  motion: 'Motion / Petition',
  motion_for_contempt: 'Motion for Contempt',
  motion_to_compel: 'Motion to Compel',
  motion_for_summary_judgment: 'Motion for Summary Judgment',
  notice_of_hearing: 'Notice of Hearing',
  order_to_show_cause: 'Order to Show Cause',
  judgment: 'Judgment',
  default_judgment: 'Default Judgment',
  // Probate & Estate
  probate_petition: 'Probate Petition',
  letters_testamentary: 'Letters Testamentary',
  creditor_claim: 'Creditor Claim (Probate)',
  // Bankruptcy
  bankruptcy_notice: 'Bankruptcy Notice',
  adversary_proceeding: 'Adversary Proceeding',
  // Administrative
  demand_letter: 'Demand Letter',
  cease_and_desist: 'Cease & Desist',
  notice_of_deposition: 'Notice of Deposition',
  interrogatories: 'Interrogatories',
  request_for_production: 'Request for Production',
  request_for_admission: 'Request for Admission',
  // General
  civil: 'Civil Papers',
  writ: 'Writ',
  order: 'Court Order',
  notice: 'Notice',
  petition: 'Petition',
  levy: 'Levy',
  affidavit: 'Affidavit',
  declaration: 'Declaration',
  stipulation: 'Stipulation',
  other: 'Other',
};

export const DOCUMENT_TYPE_OPTIONS = Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => ({ value, label }));
