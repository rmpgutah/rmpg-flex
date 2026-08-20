// ============================================================
// RMPG Flex — Legal Document Types & Matter Categories
//
// Canonical data structure for process service legal documents,
// organized by Matter Type (Small Claims, Divorce & Family Law,
// Eviction / UD, Civil Litigation, Garnishment & Collections,
// Restraining / Protective Orders, Probate & Guardianship, etc.)
// ============================================================

export interface MatterCategory {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  color: string; // Tailwind color classes for badges
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  iconName: string;
}

export interface DocumentTypeOption {
  value: string;
  label: string;
  matterCategoryId: string;
  statementTitle: string; // Official statement layout title
  isCombined?: boolean;  // True if bundle (e.g. Summons & Complaint)
  aliases?: string[];    // Keywords for fast search matching
  defaultPriority?: 'routine' | 'normal' | 'rush' | 'urgent';
  badgeColor?: string;
}

export const MATTER_CATEGORIES: MatterCategory[] = [
  {
    id: 'small_claims',
    label: 'Small Claims',
    shortLabel: 'Small Claims',
    description: 'Small claims actions, affidavits, hearings & counterclaims',
    color: 'emerald',
    badgeBg: 'bg-emerald-900/40',
    badgeText: 'text-emerald-400',
    badgeBorder: 'border-emerald-700/40',
    iconName: 'Scale',
  },
  {
    id: 'divorce_family',
    label: 'Divorce & Family Law',
    shortLabel: 'Divorce/Family',
    description: 'Divorce petitions, custody, child support & temporary orders',
    color: 'sky',
    badgeBg: 'bg-sky-900/40',
    badgeText: 'text-sky-400',
    badgeBorder: 'border-sky-700/40',
    iconName: 'Users',
  },
  {
    id: 'eviction_ud',
    label: 'Eviction / Unlawful Detainer',
    shortLabel: 'Eviction/UD',
    description: 'Notices to vacate, eviction summons, writs of restitution',
    color: 'amber',
    badgeBg: 'bg-amber-900/40',
    badgeText: 'text-amber-400',
    badgeBorder: 'border-amber-700/40',
    iconName: 'Home',
  },
  {
    id: 'civil_litigation',
    label: 'Civil Litigation',
    shortLabel: 'General Civil',
    description: 'General civil summons, complaints, motions, orders & subpoenas',
    color: 'purple',
    badgeBg: 'bg-purple-900/40',
    badgeText: 'text-purple-400',
    badgeBorder: 'border-purple-700/40',
    iconName: 'FileText',
  },
  {
    id: 'garnishment_collections',
    label: 'Garnishment & Collections',
    shortLabel: 'Garnishment',
    description: 'Writs of garnishment, interrogatories, supplemental orders',
    color: 'indigo',
    badgeBg: 'bg-indigo-900/40',
    badgeText: 'text-indigo-400',
    badgeBorder: 'border-indigo-700/40',
    iconName: 'Coins',
  },
  {
    id: 'protective_orders',
    label: 'Restraining & Protective Orders',
    shortLabel: 'Protective Orders',
    description: 'Petitions for protective orders, TROs, stalking injunctions',
    color: 'rose',
    badgeBg: 'bg-rose-900/40',
    badgeText: 'text-rose-400',
    badgeBorder: 'border-rose-700/40',
    iconName: 'ShieldAlert',
  },
  {
    id: 'probate_guardianship',
    label: 'Probate & Guardianship',
    shortLabel: 'Probate/Guardianship',
    description: 'Petitions for probate, guardianship, conservatorship, citations',
    color: 'teal',
    badgeBg: 'bg-teal-900/40',
    badgeText: 'text-teal-400',
    badgeBorder: 'border-teal-700/40',
    iconName: 'BookOpen',
  },
  {
    id: 'criminal_traffic',
    label: 'Criminal & Traffic Infractions',
    shortLabel: 'Criminal/Traffic',
    description: 'Citations, summons to appear, criminal subpoenas, court warrants',
    color: 'orange',
    badgeBg: 'bg-orange-900/40',
    badgeText: 'text-orange-400',
    badgeBorder: 'border-orange-700/40',
    iconName: 'AlertTriangle',
  },
  {
    id: 'other',
    label: 'General / Other Legal Documents',
    shortLabel: 'Other Legal',
    description: 'Notices, demand letters, affidavits, and custom filings',
    color: 'neutral',
    badgeBg: 'bg-surface-overlay/40',
    badgeText: 'text-rmpg-400',
    badgeBorder: 'border-rmpg-700/40',
    iconName: 'File',
  },
];

export const DOCUMENT_TYPE_OPTIONS: DocumentTypeOption[] = [
  // ── Small Claims ──
  {
    value: 'Summons & Complaint (Small Claims)',
    label: 'Summons & Complaint (Small Claims)',
    matterCategoryId: 'small_claims',
    statementTitle: 'Summons & Complaint for Small Claims',
    isCombined: true,
    aliases: ['small claims summons', 'small claims complaint', 'affidavit and claim'],
  },
  {
    value: 'Small Claims Affidavit & Claim',
    label: 'Small Claims Affidavit & Claim',
    matterCategoryId: 'small_claims',
    statementTitle: 'Affidavit & Claim for Small Claims',
    aliases: ['affidavit of claim', 'small claims filing'],
  },
  {
    value: 'Order to Appear / Counterclaim',
    label: 'Order to Appear / Counterclaim',
    matterCategoryId: 'small_claims',
    statementTitle: 'Order to Appear & Counterclaim (Small Claims)',
    aliases: ['order to appear', 'counterclaim'],
  },
  {
    value: 'Notice of Small Claims Hearing',
    label: 'Notice of Small Claims Hearing',
    matterCategoryId: 'small_claims',
    statementTitle: 'Notice of Hearing (Small Claims)',
    aliases: ['small claims hearing', 'notice to appear'],
  },
  {
    value: 'Subpoena (Small Claims)',
    label: 'Subpoena (Small Claims)',
    matterCategoryId: 'small_claims',
    statementTitle: 'Subpoena for Small Claims Witness',
    aliases: ['witness subpoena'],
  },
  {
    value: 'Writ of Execution (Small Claims)',
    label: 'Writ of Execution (Small Claims)',
    matterCategoryId: 'small_claims',
    statementTitle: 'Writ of Execution (Small Claims Judgment)',
    aliases: ['execution writ', 'collection writ'],
  },
  {
    value: 'Motion to Vacate Judgment (Small Claims)',
    label: 'Motion to Vacate (Small Claims)',
    matterCategoryId: 'small_claims',
    statementTitle: 'Motion to Vacate Small Claims Judgment',
    aliases: ['vacate judgment', 'motion to set aside'],
  },

  // ── Divorce & Family Law ──
  {
    value: 'Petition for Divorce',
    label: 'Petition for Divorce / Dissolution',
    matterCategoryId: 'divorce_family',
    statementTitle: 'Petition for Divorce / Dissolution of Marriage',
    aliases: ['divorce petition', 'dissolution of marriage', 'divorce complaint'],
  },
  {
    value: 'Summons & Petition for Divorce',
    label: 'Summons & Petition for Divorce',
    matterCategoryId: 'divorce_family',
    statementTitle: 'Summons & Petition for Divorce',
    isCombined: true,
    aliases: ['divorce summons', 'summons divorce', 'family summons'],
  },
  {
    value: 'Petition for Custody / Support / Modification',
    label: 'Petition for Custody / Support / Modification',
    matterCategoryId: 'divorce_family',
    statementTitle: 'Petition for Child Custody, Support, or Modification',
    aliases: ['custody petition', 'child support petition', 'paternity petition', 'parentage'],
  },
  {
    value: 'Motion for Temporary Orders',
    label: 'Motion for Temporary Orders',
    matterCategoryId: 'divorce_family',
    statementTitle: 'Motion for Temporary Orders (Pendente Lite)',
    aliases: ['temporary orders', 'pendente lite', 'interim custody'],
  },
  {
    value: 'Financial Declaration',
    label: 'Financial Declaration / Disclosure',
    matterCategoryId: 'divorce_family',
    statementTitle: 'Financial Declaration & Asset Statement',
    aliases: ['financial affidavit', 'rule 26.1', 'disclosure statement'],
  },
  {
    value: 'Subpoena duces tecum (Financial / Records)',
    label: 'Subpoena duces tecum (Financial Records)',
    matterCategoryId: 'divorce_family',
    statementTitle: 'Subpoena Duces Tecum for Financial & Employment Records',
    aliases: ['bank subpoena', 'records subpoena'],
  },
  {
    value: 'Order to Show Cause (Family)',
    label: 'Order to Show Cause (Family)',
    matterCategoryId: 'divorce_family',
    statementTitle: 'Order to Show Cause (Family Law)',
    aliases: ['osc family', 'contempt order'],
  },
  {
    value: 'Decree of Divorce (Draft / Proposed)',
    label: 'Decree of Divorce (Draft / Proposed)',
    matterCategoryId: 'divorce_family',
    statementTitle: 'Proposed Decree of Divorce & Findings of Fact',
    aliases: ['divorce decree', 'findings of fact'],
  },

  // ── Eviction & Unlawful Detainer ──
  {
    value: 'Notice to Vacate (3-Day / 30-Day Notice)',
    label: 'Notice to Vacate (3-Day / 30-Day Notice)',
    matterCategoryId: 'eviction_ud',
    statementTitle: 'Notice to Vacate / Notice to Quit (Unlawful Detainer)',
    defaultPriority: 'rush',
    aliases: ['3 day notice', '30 day notice', 'notice to quit', 'pay or quit', 'eviction notice'],
  },
  {
    value: 'Summons & Complaint for Eviction',
    label: 'Summons & Complaint for Eviction',
    matterCategoryId: 'eviction_ud',
    statementTitle: 'Summons & Complaint for Eviction (Unlawful Detainer)',
    isCombined: true,
    defaultPriority: 'rush',
    aliases: ['eviction summons', 'unlawful detainer summons', 'eviction complaint'],
  },
  {
    value: 'Eviction Summons',
    label: 'Eviction Summons',
    matterCategoryId: 'eviction_ud',
    statementTitle: 'Summons for Unlawful Detainer',
    defaultPriority: 'rush',
    aliases: ['ud summons', 'eviction summons'],
  },
  {
    value: 'Motion for Order of Restitution',
    label: 'Motion for Order of Restitution',
    matterCategoryId: 'eviction_ud',
    statementTitle: 'Motion for Order of Restitution (Eviction)',
    defaultPriority: 'rush',
    aliases: ['restitution motion', 'immediate occupancy'],
  },
  {
    value: 'Writ of Restitution (Eviction Lockout)',
    label: 'Writ of Restitution (Eviction Lockout)',
    matterCategoryId: 'eviction_ud',
    statementTitle: 'Writ of Restitution (Physical Eviction / Lockout)',
    defaultPriority: 'urgent',
    aliases: ['writ of restitution', 'lockout writ', 'sheriff lockout'],
  },
  {
    value: 'Order of Eviction / Judgment of Possession',
    label: 'Order of Eviction / Judgment of Possession',
    matterCategoryId: 'eviction_ud',
    statementTitle: 'Order of Eviction & Judgment for Possession',
    aliases: ['eviction order', 'possession judgment'],
  },

  // ── Civil Litigation ──
  {
    value: 'Summons & Complaint (Civil Action)',
    label: 'Summons & Complaint (Civil Action)',
    matterCategoryId: 'civil_litigation',
    statementTitle: 'Summons & Complaint in a Civil Action',
    isCombined: true,
    aliases: ['civil summons and complaint', 'summons complaint', 'civil action'],
  },
  {
    value: 'Summons',
    label: 'Summons (General Civil)',
    matterCategoryId: 'civil_litigation',
    statementTitle: 'Summons in a Civil Action',
    aliases: ['civil summons', 'summons'],
  },
  {
    value: 'Complaint',
    label: 'Complaint / Cross-Complaint',
    matterCategoryId: 'civil_litigation',
    statementTitle: 'Civil Complaint / Cross-Complaint',
    aliases: ['civil complaint', 'cross complaint', 'counterclaim'],
  },
  {
    value: 'Subpoena',
    label: 'Subpoena (Trial / Hearing)',
    matterCategoryId: 'civil_litigation',
    statementTitle: 'Subpoena to Appear & Testify',
    aliases: ['witness subpoena', 'trial subpoena'],
  },
  {
    value: 'Subpoena Duces Tecum',
    label: 'Subpoena Duces Tecum (Production)',
    matterCategoryId: 'civil_litigation',
    statementTitle: 'Subpoena Duces Tecum for Production of Documents',
    aliases: ['duces tecum', 'production subpoena', 'records subpoena'],
  },
  {
    value: 'Motion',
    label: 'Motion (Summary Judgment / Dismissal)',
    matterCategoryId: 'civil_litigation',
    statementTitle: 'Motion & Notice of Motion',
    aliases: ['motion for summary judgment', 'motion to dismiss', 'discovery motion'],
  },
  {
    value: 'Order',
    label: 'Court Order / Injunction',
    matterCategoryId: 'civil_litigation',
    statementTitle: 'Court Order / Judicial Injunction',
    aliases: ['court order', 'injunction', 'stay order'],
  },
  {
    value: 'Notice of Deposition',
    label: 'Notice of Deposition',
    matterCategoryId: 'civil_litigation',
    statementTitle: 'Notice of Taking Deposition',
    aliases: ['deposition notice', 'depo notice'],
  },
  {
    value: 'Notice of Entry of Order / Judgment',
    label: 'Notice of Entry of Order / Judgment',
    matterCategoryId: 'civil_litigation',
    statementTitle: 'Notice of Entry of Order / Judgment',
    aliases: ['notice of entry', 'judgment notice'],
  },
  {
    value: 'Civil Cover Sheet & Summons Notice',
    label: 'Civil Cover Sheet & Summons Notice',
    matterCategoryId: 'civil_litigation',
    statementTitle: 'Civil Cover Sheet & Mandatory Summons Notice',
    aliases: ['cover sheet', 'civil cover sheet'],
  },

  // ── Garnishment & Collections ──
  {
    value: 'Writ of Garnishment (Earnings / Wages)',
    label: 'Writ of Garnishment (Earnings / Wages)',
    matterCategoryId: 'garnishment_collections',
    statementTitle: 'Writ of Continuing Garnishment for Earnings',
    aliases: ['wage garnishment', 'earnings garnishment', 'payroll garnishment'],
  },
  {
    value: 'Writ of Garnishment (Bank Account / Property)',
    label: 'Writ of Garnishment (Bank Account / Property)',
    matterCategoryId: 'garnishment_collections',
    statementTitle: 'Writ of Garnishment for Non-Earnings / Bank Accounts',
    aliases: ['bank garnishment', 'property garnishment', 'bank levy'],
  },
  {
    value: 'Interrogatories to Garnishee',
    label: 'Interrogatories to Garnishee',
    matterCategoryId: 'garnishment_collections',
    statementTitle: 'Garnishee Interrogatories & Answer Form',
    aliases: ['garnishee answers', 'employer interrogatories'],
  },
  {
    value: 'Notice of Garnishment to Judgment Debtor',
    label: 'Notice of Garnishment to Debtor',
    matterCategoryId: 'garnishment_collections',
    statementTitle: 'Notice of Garnishment & Exemption Claim Form',
    aliases: ['debtor notice', 'exemption notice'],
  },
  {
    value: 'Supplemental Proceedings Order',
    label: 'Order for Supplemental Proceedings',
    matterCategoryId: 'garnishment_collections',
    statementTitle: 'Order & Subpoena for Supplemental Proceedings',
    aliases: ['supp pro', 'debtor exam', 'supplemental exam'],
  },
  {
    value: 'Satisfaction of Judgment',
    label: 'Satisfaction of Judgment',
    matterCategoryId: 'garnishment_collections',
    statementTitle: 'Full / Partial Satisfaction of Judgment',
    aliases: ['judgment paid', 'satisfaction notice'],
  },

  // ── Restraining & Protective Orders ──
  {
    value: 'Petition for Protective Order / Stalking Injunction',
    label: 'Petition for Protective Order / Stalking',
    matterCategoryId: 'protective_orders',
    statementTitle: 'Petition for Protective Order / Stalking Injunction',
    defaultPriority: 'urgent',
    aliases: ['protective order petition', 'stalking injunction', 'restraining order petition'],
  },
  {
    value: 'Temporary Protective Order (TRO)',
    label: 'Temporary Protective Order (TRO)',
    matterCategoryId: 'protective_orders',
    statementTitle: 'Temporary Protective Order & Ex Parte Injunction',
    defaultPriority: 'urgent',
    aliases: ['tro', 'ex parte protective order', 'temporary restraining order'],
  },
  {
    value: 'Summons & Notice of Hearing (Protective Order)',
    label: 'Summons & Notice of Hearing (Protective Order)',
    matterCategoryId: 'protective_orders',
    statementTitle: 'Summons & Notice of Hearing for Protective Order',
    isCombined: true,
    defaultPriority: 'urgent',
    aliases: ['protective order summons', 'tro hearing summons'],
  },
  {
    value: 'Final Protective Order / Injunction',
    label: 'Final Protective Order / Injunction',
    matterCategoryId: 'protective_orders',
    statementTitle: 'Final Injunction Against Harassment & Protective Order',
    defaultPriority: 'urgent',
    aliases: ['final tro', 'injunction order', 'permanent protective order'],
  },

  // ── Probate & Guardianship ──
  {
    value: 'Petition for Probate / Administration',
    label: 'Petition for Probate / Administration',
    matterCategoryId: 'probate_guardianship',
    statementTitle: 'Petition for Probate of Will & Letters Testamentary',
    aliases: ['probate petition', 'will petition', 'estate petition'],
  },
  {
    value: 'Petition for Guardianship / Conservatorship',
    label: 'Petition for Guardianship / Conservatorship',
    matterCategoryId: 'probate_guardianship',
    statementTitle: 'Petition for Appointment of Guardian & Conservator',
    aliases: ['guardianship petition', 'conservatorship petition', 'incapacitated person'],
  },
  {
    value: 'Citation & Notice of Hearing (Probate)',
    label: 'Citation & Notice of Hearing (Probate)',
    matterCategoryId: 'probate_guardianship',
    statementTitle: 'Probate Citation & Notice of Hearing',
    isCombined: true,
    aliases: ['probate citation', 'guardianship citation'],
  },
  {
    value: 'Letters of Guardianship / Administration',
    label: 'Letters of Guardianship / Administration',
    matterCategoryId: 'probate_guardianship',
    statementTitle: 'Letters of Guardianship / Letters Testamentary',
    aliases: ['letters testamentary', 'letters of administration'],
  },

  // ── Criminal & Traffic ──
  {
    value: 'Citation & Summons',
    label: 'Citation & Summons',
    matterCategoryId: 'criminal_traffic',
    statementTitle: 'Criminal / Traffic Citation & Summons to Appear',
    isCombined: true,
    aliases: ['traffic citation', 'criminal summons', 'ticket'],
  },
  {
    value: 'Notice to Appear',
    label: 'Notice to Appear',
    matterCategoryId: 'criminal_traffic',
    statementTitle: 'Notice to Appear in Court',
    aliases: ['court appearance notice', 'notice to appear'],
  },
  {
    value: 'Subpoena (Criminal Proceeding)',
    label: 'Subpoena (Criminal Proceeding)',
    matterCategoryId: 'criminal_traffic',
    statementTitle: 'Subpoena for Criminal Hearing / Trial',
    aliases: ['criminal subpoena', 'prosecutor subpoena'],
  },
  {
    value: 'Court Warrant / Arrest Order',
    label: 'Court Warrant / Arrest Order',
    matterCategoryId: 'criminal_traffic',
    statementTitle: 'Court Bench Warrant / Order of Commitment',
    defaultPriority: 'urgent',
    aliases: ['bench warrant', 'arrest warrant', 'order of commitment'],
  },

  // ── Other ──
  {
    value: 'Notice',
    label: 'Notice (General)',
    matterCategoryId: 'other',
    statementTitle: 'Legal Notice',
    aliases: ['general notice', 'written notice'],
  },
  {
    value: 'Demand Letter / Pre-Suit Notice',
    label: 'Demand Letter / Pre-Suit Notice',
    matterCategoryId: 'other',
    statementTitle: 'Notice of Intent to Sue / Formal Demand Letter',
    aliases: ['demand letter', 'pre-suit notice', 'intent to sue'],
  },
  {
    value: 'Affidavit',
    label: 'Affidavit (General)',
    matterCategoryId: 'other',
    statementTitle: 'Sworn Affidavit',
    aliases: ['affidavit of service', 'sworn statement'],
  },
  {
    value: 'Other',
    label: 'Other Document (Custom Title)',
    matterCategoryId: 'other',
    statementTitle: 'Legal Document',
    aliases: ['custom', 'other document', 'miscellaneous'],
  },
];

/** Utility to lookup a matter category by document value */
export function getMatterCategoryByDocType(docTypeValue: string): MatterCategory {
  if (!docTypeValue) return MATTER_CATEGORIES.find(c => c.id === 'other')!;
  
  const normalized = docTypeValue.toLowerCase().trim();

  // Find explicit match
  const option = DOCUMENT_TYPE_OPTIONS.find(
    opt => opt.value.toLowerCase() === normalized || opt.label.toLowerCase() === normalized
  );
  if (option) {
    const category = MATTER_CATEGORIES.find(c => c.id === option.matterCategoryId);
    if (category) return category;
  }

  // Heuristic string matching for unlisted / dynamic document strings
  if (normalized.includes('divorce') || normalized.includes('custody') || normalized.includes('paternity') || normalized.includes('parenting')) {
    return MATTER_CATEGORIES.find(c => c.id === 'divorce_family')!;
  }
  if (normalized.includes('evict') || normalized.includes('unlawful detainer') || normalized.includes('restitution') || normalized.includes('3-day') || normalized.includes('30-day') || normalized.includes('vacate')) {
    return MATTER_CATEGORIES.find(c => c.id === 'eviction_ud')!;
  }
  if (normalized.includes('small claims') || normalized.includes('small claim')) {
    return MATTER_CATEGORIES.find(c => c.id === 'small_claims')!;
  }
  if (normalized.includes('garnish') || normalized.includes('bank levy') || normalized.includes('supp pro')) {
    return MATTER_CATEGORIES.find(c => c.id === 'garnishment_collections')!;
  }
  if (normalized.includes('protective order') || normalized.includes('tro') || normalized.includes('stalking') || normalized.includes('harassment')) {
    return MATTER_CATEGORIES.find(c => c.id === 'protective_orders')!;
  }
  if (normalized.includes('probate') || normalized.includes('guardianship') || normalized.includes('conservator')) {
    return MATTER_CATEGORIES.find(c => c.id === 'probate_guardianship')!;
  }
  if (normalized.includes('citation') || normalized.includes('ticket') || normalized.includes('warrant')) {
    return MATTER_CATEGORIES.find(c => c.id === 'criminal_traffic')!;
  }

  return MATTER_CATEGORIES.find(c => c.id === 'civil_litigation') || MATTER_CATEGORIES.find(c => c.id === 'other')!;
}

/** Get formal statement title for a document type string */
export function getStatementTitle(docTypeValue: string): string {
  if (!docTypeValue) return 'Legal Document';
  const opt = DOCUMENT_TYPE_OPTIONS.find(o => o.value.toLowerCase() === docTypeValue.toLowerCase().trim());
  return opt ? opt.statementTitle : docTypeValue;
}
