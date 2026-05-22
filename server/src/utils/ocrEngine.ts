import type { D1Database } from '@cloudflare/workers-types';

export interface OcrField {
  value: string;
  confidence: number;
  raw: string;
}

export type DocumentType = 'drivers_license' | 'passport' | 'military_id' | 'state_id' | 'court_docket' | 'field_sheet' | 'info_page' | 'unknown';

export interface OcrResult {
  documentType: DocumentType;
  confidence: number;
  fields: Record<string, OcrField>;
  rawText: string;
  allDates: string[];
}

const FIVE_STATES = 'ALABAMA|ALASKA|ARIZONA|ARKANSAS|CALIFORNIA|COLORADO|CONNECTICUT|DELAWARE|FLORIDA|GEORGIA|HAWAII|IDAHO|ILLINOIS|INDIANA|IOWA|KANSAS|KENTUCKY|LOUISIANA|MAINE|MARYLAND|MASSACHUSETTS|MICHIGAN|MINNESOTA|MISSISSIPPI|MISSOURI|MONTANA|NEBRASKA|NEVADA|NEW HAMPSHIRE|NEW JERSEY|NEW MEXICO|NEW YORK|NORTH CAROLINA|NORTH DAKOTA|OHIO|OKLAHOMA|OREGON|PENNSYLVANIA|RHODE ISLAND|SOUTH CAROLINA|SOUTH DAKOTA|TENNESSEE|TEXAS|UTAH|VERMONT|VIRGINIA|WASHINGTON|WEST VIRGINIA|WISCONSIN|WYOMING|DISTRICT OF COLUMBIA';

export function afterLabel(text: string, patterns: RegExp[], fallback = ''): string {
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return fallback;
}

export function ocrField(value: string, confidence: number, raw: string): OcrField {
  return { value, confidence, raw };
}

function labelPatterns(labels: string[], capture: string): RegExp[] {
  return labels.map(l => new RegExp(`(?:${l})[:\s]*(${capture})`, 'i'));
}

export function detectDocType(text: string): DocumentType {
  if (/PASSPORT/i.test(text)) return 'passport';
  if (/MILITARY|ARMED\s*FORCES|DOD\s*(?:#|ID|NO)|EDIPI/i.test(text)) return 'military_id';
  if (/(?:DRIVERS?\s*(?:LIC|LICENSE)|DL\s*#|LN[:\s]|DOB[:\s])/i.test(text)) return 'drivers_license';
  if (/STATE\s*(?:ID|IDENTIFICATION)|IDENTIFICATION\s*CARD/i.test(text)) return 'state_id';
  if (/SUMMONS|COMPLAINT|Attorney for Plaintiff|JUDICIAL DISTRICT COURT/i.test(text)) return 'court_docket';
  if (/Party to Serve|Instructions\s*\n.*Sub-serve|Date & Time.*Description of Service/i.test(text)) return 'field_sheet';
  if (/^JOB\b/im.test(text) || /Service Attempts|Recipient:|Job Activity|Af\s*fi\s*davits/i.test(text)) return 'info_page';
  return 'unknown';
}

export function parseIdDocument(fullText: string): OcrResult {
  const lines = fullText.split('\n').map(l => l.trim()).filter(Boolean);
  const text = fullText.toUpperCase();
  const fields: Record<string, OcrField> = {};
  let documentType: DocumentType = detectDocType(fullText);
  if (documentType === 'unknown' && /^\d/.test(lines[0] || '')) documentType = 'drivers_license';

  const set = (key: string, value: string, confidence: number) => {
    if (value) fields[key] = ocrField(value, confidence, value);
  };

  const mrzLines = lines.filter(l => /^[A-Z0-9<]{30,}$/.test(l.replace(/\s/g, '')));
  let mrzFirst = '', mrzLast = '', mrzPassport = '', mrzDob = '', mrzNationality = '';
  if (mrzLines.length >= 2) {
    const mrz1 = mrzLines[0].replace(/\s/g, '');
    const mrz2 = mrzLines[1].replace(/\s/g, '');
    const nameField = mrz1.substring(5).replace(/</g, ' ').trim();
    const mrzNameParts = nameField.split(/\s{2,}/);
    mrzLast = mrzNameParts[0]?.trim() || '';
    mrzFirst = mrzNameParts[1]?.split(/\s+/)?.[0]?.trim() || '';
    mrzPassport = mrz2.substring(0, 9).replace(/</g, '').trim();
    mrzNationality = mrz2.substring(10, 13).replace(/</g, '').trim();
    const mrzDobRaw = mrz2.substring(13, 19);
    if (/^\d{6}$/.test(mrzDobRaw)) {
      const yr = parseInt(mrzDobRaw.substring(0, 2));
      const century = yr > 30 ? '19' : '20';
      mrzDob = `${mrzDobRaw.substring(2, 4)}/${mrzDobRaw.substring(4, 6)}/${century}${mrzDobRaw.substring(0, 2)}`;
    }
    set('mrz_line_1', mrz1, 0.95);
    set('mrz_line_2', mrz2, 0.95);
  }

  const lastName = afterLabel(text, [
    /(?:LN|LAST\s*NAME|SURNAME|FAMILY\s*NAME)[:\s]+([A-Z][A-Z'-]+)/,
    /(?:^|\n)\s*1\s+([A-Z][A-Z'-]{2,})\s*(?:\n|$)/m,
  ]) || mrzLast;
  set('last_name', lastName, lastName === mrzLast ? 0.95 : 0.7);

  const firstName = afterLabel(text, [
    /(?:FN|FIRST\s*NAME|GIVEN\s*NAME)[:\s]+([A-Z][A-Z'-]+)/,
    /(?:^|\n)\s*2\s+([A-Z][A-Z'-]{2,})\s*(?:\n|$)/m,
  ]) || mrzFirst;
  set('first_name', firstName, firstName === mrzFirst ? 0.95 : 0.7);

  const middleName = afterLabel(text, [
    /(?:MN|MIDDLE\s*NAME|MIDDLE)[:\s]+([A-Z][A-Z'-]+)/,
  ]);
  set('middle_name', middleName, 0.6);

  let finalFirst = firstName;
  let finalLast = lastName;
  let finalMiddle = middleName;
  if (!finalFirst && !finalLast) {
    const nameCandidate = lines.find(l =>
      /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}$/.test(l) && !/\d/.test(l) && l.length < 40
    );
    if (nameCandidate) {
      const parts = nameCandidate.split(/\s+/);
      finalFirst = parts[0] || '';
      finalLast = parts.length > 2 ? parts[parts.length - 1] : parts[1] || '';
      finalMiddle = parts.length > 2 ? parts.slice(1, -1).join(' ') : '';
      set('first_name', finalFirst, 0.5);
      set('last_name', finalLast, 0.5);
      set('middle_name', finalMiddle, 0.5);
    }
    const commaName = lines.find(l => /^[A-Z][A-Z'-]+,\s*[A-Z]/.test(l.toUpperCase()));
    if (commaName && !finalFirst) {
      const [last, rest] = commaName.split(',').map(s => s.trim());
      finalLast = last;
      const restParts = (rest || '').split(/\s+/);
      finalFirst = restParts[0] || '';
      finalMiddle = restParts.slice(1).join(' ') || '';
      set('first_name', finalFirst, 0.5);
      set('last_name', finalLast, 0.5);
      set('middle_name', finalMiddle, 0.5);
    }
  }

  const dlNum = afterLabel(text, [
    /(?:DL|LIC(?:ENSE)?|ID)\s*(?:#|NO\.?|NUM(?:BER)?)?[:\s]+([A-Z0-9]{4,15})/,
    /(?:DOCUMENT\s*(?:#|NO|NUM))[:\s]+([A-Z0-9]{5,15})/,
    /(?:^|\s)(\d{4,10})(?:\s|$)/,
  ]);
  set('dl_number', dlNum || mrzPassport, dlNum ? 0.7 : (mrzPassport ? 0.95 : 0));

  const passportNum = afterLabel(text, [
    /(?:PASSPORT\s*(?:#|NO|NUM))[:\s]+([A-Z0-9]{6,12})/,
  ]);
  set('passport_number', passportNum || mrzPassport, passportNum ? 0.7 : (mrzPassport ? 0.95 : 0));

  const dob = afterLabel(text, [
    /(?:DOB|D\.O\.B|BIRTH|BORN|BD|DATE\s*OF\s*BIRTH)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/,
    /(?:DOB|BIRTH)[:\s]*(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/,
  ]) || mrzDob;
  let dobConfidence = 0.7;
  if (dob === mrzDob) dobConfidence = 0.95;
  else if (dob && /^\d{2}\/\d{2}\/\d{4}$/.test(dob)) dobConfidence = 0.8;
  set('dob', dob, dobConfidence);

  const dobAlt = !dob ? afterLabel(text, [/(\d{2}[\/\-]\d{2}[\/\-]\d{4})/]) : '';
  set('dob_alt', dobAlt, 0.3);

  const issueDate = afterLabel(text, [
    /(?:ISS(?:UED?)?|ISSUE\s*DATE|ISS\s*DATE)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/,
  ]);
  set('issue_date', issueDate, 0.6);

  const expiryDate = afterLabel(text, [
    /(?:EXP(?:IRES?|IRY)?|EXPIRATION)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/,
  ]);
  set('expiration_date', expiryDate, 0.7);

  const addrLines = lines.filter(l => /\d+\s+\w+\s+(st|ave|blvd|dr|rd|ln|way|ct|pl|cir|pkwy|hwy|run|trl|lane|drive|street|avenue|road|circle|place|parkway|court)/i.test(l));
  const address = addrLines[0] || afterLabel(text, [/(?:ADDR(?:ESS)?|RESIDENCE)[:\s]+(.{10,60})/]) || '';
  set('address', address, address ? 0.6 : 0);

  const zipMatch = text.match(/\b(\d{5}(?:-\d{4})?)\b/);
  const zip = zipMatch?.[1] || '';
  set('zip_code', zip, zip ? 0.7 : 0);

  const stateMatch = text.match(new RegExp(`\\b(${FIVE_STATES})\\b`));
  const state = stateMatch?.[1] || afterLabel(text, [/(?:STATE|ST)[:\s]+([A-Z]{2})/]) || '';
  set('state', state, state ? 0.6 : 0);

  const sex = afterLabel(text, [
    /(?:SEX|GENDER)[:\s]*(M(?:ALE)?|F(?:EMALE)?)/,
  ]);
  set('gender', sex, sex ? 0.7 : 0);

  const height = afterLabel(text, [
    /(?:HT|HEIGHT)[:\s]*(\d['\-]\d{1,2}["']?)/,
    /(?:HT|HEIGHT)[:\s]*(\d{3})\b/,
  ]);
  set('height', height, height ? 0.6 : 0);

  const weight = afterLabel(text, [
    /(?:WT|WEIGHT|WGT)[:\s]*(\d{2,3})\s*(?:LBS?|KG)?/,
  ]);
  set('weight', weight, weight ? 0.6 : 0);

  const eyeColor = afterLabel(text, [
    /(?:EYES?|EYE\s*COLOR)[:\s]*(BLU|BRN|GRN|HAZ|BLK|GRY|BLUE|BROWN|GREEN|HAZEL|BLACK|GRAY|GREY)/,
  ]);
  set('eye_color', eyeColor, eyeColor ? 0.6 : 0);

  const hairColor = afterLabel(text, [
    /(?:HAIR|HAIR\s*COLOR)[:\s]*(BLK|BRN|BLN|RED|GRY|WHI|BLACK|BROWN|BLONDE|BLOND|RED|GRAY|GREY|WHITE|SANDY|AUBURN)/,
  ]);
  set('hair_color', hairColor, hairColor ? 0.6 : 0);

  const race = afterLabel(text, [
    /(?:RACE|ETHNICITY)[:\s]*(W|B|H|A|I|WHITE|BLACK|HISPANIC|ASIAN|INDIAN|NATIVE|PACIFIC)/,
  ]);
  set('race', race, race ? 0.5 : 0);

  const dlClass = afterLabel(text, [
    /(?:CLASS|CL|DL\s*CLASS)[:\s]*([A-D])\b/,
  ]);
  set('dl_class', dlClass, dlClass ? 0.6 : 0);

  const restrictions = afterLabel(text, [
    /(?:REST(?:RICTIONS?)?|RSTR)[:\s]+([A-Z0-9,\s]+)/,
  ]);
  set('restrictions', restrictions, restrictions ? 0.6 : 0);

  const endorsements = afterLabel(text, [
    /(?:END(?:ORSEMENTS?)?|ENDR)[:\s]+([A-Z0-9,\s]+)/,
  ]);
  set('endorsements', endorsements, endorsements ? 0.6 : 0);

  const organDonor = /DONOR|ORGAN\s*DONOR/i.test(text);
  set('organ_donor', organDonor ? 'yes' : 'no', 0.5);

  const veteran = /VETERAN/i.test(text);
  set('veteran', veteran ? 'yes' : 'no', 0.5);

  const isCDL = /COMMERCIAL|CDL|CMV/i.test(text);
  set('is_cdl', isCDL ? 'yes' : 'no', 0.5);

  const realId = /REAL\s*ID/i.test(text);
  const realIdNotCompliant = /NOT\s*FOR\s*FEDERAL|FEDERAL\s*LIMITS\s*APPLY/i.test(text);
  set('real_id_compliant', realId && !realIdNotCompliant ? 'yes' : 'no', 0.4);

  const correctiveLenses = /CORR(?:ECTIVE)?\s*LENS|GLASSES\s*REQ|LENSES\s*REQ/i.test(text);
  set('corrective_lenses', correctiveLenses ? 'yes' : 'no', 0.5);

  const concealedCarry = /CONCEALED|CCW|CWP|CARRY\s*PERMIT|FIREARMS?\s*PERMIT/i.test(text);
  set('concealed_carry', concealedCarry ? 'yes' : 'no', 0.5);

  const nationality = afterLabel(text, [
    /(?:NATIONALITY|CITIZEN(?:SHIP)?)[:\s]+([A-Z\s]+)/,
  ]) || mrzNationality || '';
  set('nationality', nationality, nationality === mrzNationality ? 0.95 : 0.5);

  const placeOfBirth = afterLabel(text, [
    /(?:PLACE\s*OF\s*BIRTH|POB|BIRTHPLACE)[:\s]+([A-Z\s,]+)/,
  ]);
  set('place_of_birth', placeOfBirth, 0.5);

  const suffix = afterLabel(text, [
    /(?:SUFFIX|SFX)[:\s]+([A-Z]{1,4})/,
  ]) || (text.match(/\b(JR|SR|II|III|IV|V)\b/)?.[1] || '');
  set('suffix', suffix, 0.5);

  const age = afterLabel(text, [/(?:AGE)[:\s]*(\d{1,3})/]);
  set('age', age, 0.4);

  const ssnLast4 = afterLabel(text, [
    /(?:SSN|SS#|SOC(?:IAL)?)[:\s]*(?:\*{3,5}[- ]?)(\d{4})/,
    /(?:LAST\s*4)[:\s]*(\d{4})/,
  ]);
  set('ssn_last_4', ssnLast4, 0.3);

  const build = afterLabel(text, [
    /(?:BUILD|BLD)[:\s]*(SLIM|THIN|MEDIUM|MED|HEAVY|HVY|LARGE|LRG|ATHLETIC|STOCKY|MUSCULAR)/,
  ]);
  set('build', build, 0.4);

  const complexion = afterLabel(text, [
    /(?:COMP(?:LEXION)?|CMPLX)[:\s]*(LIGHT|LGT|MEDIUM|MED|DARK|DRK|FAIR|OLIVE|RUDDY|SALLOW|ALBINO)/,
  ]);
  set('complexion', complexion, 0.4);

  const militaryBranch = afterLabel(text, [
    /(?:BRANCH|SERVICE)[:\s]*(ARMY|NAVY|AIR\s*FORCE|MARINES?|COAST\s*GUARD|SPACE\s*FORCE|NATIONAL\s*GUARD)/,
  ]);
  set('military_branch', militaryBranch, 0.6);

  const militaryRank = afterLabel(text, [
    /(?:RANK|GRADE)[:\s]+([A-Z][A-Z0-9\s]+)/,
  ]);
  set('military_rank', militaryRank, 0.5);

  const payGrade = afterLabel(text, [
    /(?:PAY\s*GRADE|GRADE)[:\s]*(E-?\d|O-?\d|W-?\d|GS-?\d+)/,
  ]);
  set('pay_grade', payGrade, 0.5);

  const dodId = afterLabel(text, [
    /(?:DOD\s*(?:#|ID|NO)|EDIPI)[:\s]*(\d{8,12})/,
  ]);
  set('dod_id', dodId, 0.6);

  const bloodType = afterLabel(text, [
    /(?:BLOOD\s*(?:TYPE|GROUP)|BT)[:\s]*(A\+?|A-|B\+?|B-|AB\+?|AB-|O\+?|O-)/,
  ]);
  set('blood_type', bloodType, 0.5);

  const issuingAuthority = afterLabel(text, [
    /(?:AUTHORITY|ISSUING\s*(?:AGENCY|AUTH)|ISSUED\s*BY)[:\s]+([A-Z\s]+)/,
  ]);
  set('issuing_authority', issuingAuthority, 0.5);

  const tribalAffiliation = afterLabel(text, [
    /(?:TRIBE|TRIBAL|NATION|BAND)[:\s]+([A-Z\s]+)/,
  ]);
  set('tribal_affiliation', tribalAffiliation, 0.5);

  const alienNumber = afterLabel(text, [
    /(?:ALIEN\s*(?:#|NO|REG)|USCIS\s*(?:#|NO)|A#)[:\s]*([A-Z0-9]{7,13})/,
  ]);
  set('alien_number', alienNumber, 0.6);

  const employer = afterLabel(text, [
    /(?:EMPLOYER|COMPANY|ORGANIZATION|ORG)[:\s]+([A-Z][A-Z\s,\.]+)/,
  ]);
  set('employer', employer, 0.5);

  const allDates = (text.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/g) || []).slice(0, 6);

  const populatedFields = Object.entries(fields).filter(([, f]) => f.value && f.confidence > 0).length;
  const totalConfidence = Math.min(1, populatedFields / 25 + 0.2);

  return {
    documentType,
    confidence: totalConfidence,
    fields,
    rawText: fullText,
    allDates,
  };
}

export function parseCourtDocument(fullText: string): OcrResult {
  const fields: Record<string, OcrField> = {};
  const text = fullText;
  const textUpper = fullText.toUpperCase();

  const set = (key: string, value: string, confidence: number) => {
    if (value) fields[key] = ocrField(value, confidence, value);
  };

  const caseNum = afterLabel(textUpper, [
    /(?:CASE\s*(?:NUMBER|NO|#)|DOCKET\s*(?:NO|#)|CIVIL\s*(?:NO|#))[:\s]+([A-Z0-9\-]+)/,
    /(?:^|\n)\s*\((\d{5,})\)/m,
  ]);
  set('case_number', caseNum, 0.8);

  let plaintiff = afterLabel(textUpper, [
    /(?:PLAINTIFF|PLAINTIFF\(S\)|PETITIONER)[:\s]+([A-Z][A-Z\s.]+)/,
  ]);
  set('plaintiff', plaintiff, 0.7);

  let defendant = afterLabel(textUpper, [
    /(?:DEFENDANT|DEFENDANT\(S\)|RESPONDENT)[:\s]+([A-Z][A-Z\s.]+)/,
  ]);
  set('defendant', defendant, 0.7);

  if (!plaintiff && !defendant) {
    const lines = fullText.split('\n');
    const caseLineIdx = lines.findIndex(l => /plaintiff|defendant/i.test(l));
    if (caseLineIdx >= 0) {
      const line = lines[caseLineIdx];
      if (line.toLowerCase().includes('plaintiff')) {
        plaintiff = line.replace(/Plaintiff:?\s*/i, '').trim();
        defendant = lines[caseLineIdx + 1]?.replace(/Defendant:?\s*/i, '').trim() || '';
        set('plaintiff', plaintiff, 0.6);
        set('defendant', defendant, 0.6);
      } else if (line.toLowerCase().includes('defendant')) {
        defendant = line.replace(/Defendant:?\s*/i, '').trim();
        plaintiff = lines[caseLineIdx + 1]?.replace(/Plaintiff:?\s*/i, '').trim() || '';
        set('plaintiff', plaintiff, 0.6);
        set('defendant', defendant, 0.6);
      }
    }
  }

  const plaintiffAtty = afterLabel(textUpper, [
    /(?:ATTORNEY\s*FOR\s*PLAINTIFF|ATTORNEY\s*FOR\s*PETITIONER|COUNSEL\s*FOR\s*PLAINTIFF)[:\s]+([A-Z][A-Z\s.]+)/,
  ]);
  set('attorney_for_plaintiff', plaintiffAtty, 0.6);

  const court = afterLabel(textUpper, [
    /((?:FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH)\s+JUDICIAL\s+DISTRICT\s+COURT[^,\n]*)/i,
  ]);
  set('court', court, 0.8);

  const filingDate = afterLabel(textUpper, [
    /(?:FILING\s*DATE|FILED|DATE\s*FILED)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
  ]);
  set('filing_date', filingDate, 0.6);

  const hearingDate = afterLabel(textUpper, [
    /(?:HEARING\s*DATE|TRIAL\s*DATE|RETURN\s*DATE|COURT\s*DATE)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
  ]);
  set('hearing_date', hearingDate, 0.6);

  const dueDate = afterLabel(textUpper, [
    /(?:DUE|DUE\s*DATE|DEADLINE|SERVE\s*BY)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /(?:DUE|SERVE\s*BY)[:\s]*([A-Z][a-z]+ \d{1,2}, \d{4})/i,
  ]);
  set('due_date', dueDate, 0.6);

  const docType = [
    /SUMMONS/i.test(text) ? 'SUMMONS' : '',
    /COMPLAINT/i.test(text) ? 'COMPLAINT' : '',
    /SUBPOENA/i.test(text) ? 'SUBPOENA' : '',
    /EVICTION|UNLAWFUL\s*DETAINER/i.test(text) ? 'EVICTION' : '',
    /RESTRAINING|PROTECTIVE\s*ORDER/i.test(text) ? 'RESTRAINING_ORDER' : '',
    /WRIT/i.test(text) ? 'WRIT' : '',
    /ORDER\s*TO\s*APPEAR|ORDER\s*TO\s*SHOW\s*CAUSE/i.test(text) ? 'ORDER' : '',
    /NOTICE/i.test(text) ? 'NOTICE' : '',
    /PETITION/i.test(text) ? 'PETITION' : '',
  ].filter(Boolean);
  set('document_type_court', docType[0] || 'UNKNOWN', 0.7);

  const fee = afterLabel(textUpper, [/(?:FEE|FILING\s*FEE)[:\s]*\$?(\d+\.?\d*)/i]);
  set('fee', fee, 0.5);

  const jobNum = afterLabel(textUpper, [
    /(?:JOB|JOB\s*#|JOB\s*NO)[:\s]*(\d+)/i,
    /(?:SM\s*JOB|SERVEMANAGER)[:\s]*(\d+)/i,
  ]);
  set('job_number', jobNum, 0.6);

  const instructions = (() => {
    const m = text.match(/Instructions\s*\n([\s\S]*?)(?:\n\n|\nMuhammad|\nAddress|\n[A-Z][a-z]+ [A-Z])/i);
    return m ? m[1].replace(/\n/g, ' ').trim() : '';
  })();
  set('instructions', instructions, 0.5);

  const attorneyPhone = (text.match(/Tel[:\s]*([\(\d\)\-\s]+)/i) || [])[1]?.trim() || '';
  set('attorney_phone', attorneyPhone, 0.5);

  const attorneyEmail = (text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i) || [])[1] || '';
  set('attorney_email', attorneyEmail, 0.6);

  const bar = (text.match(/Bar#?\s*(\d+)/i) || [])[1] || '';
  set('attorney_bar_number', bar, 0.5);

  const isUtah = /UTAH|THIRD DISTRICT|SALT LAKE|^\d{5}-\d{6}$/m.test(text);
  set('jurisdiction', isUtah ? 'Utah State Courts' : '', 0.8);

  return {
    documentType: 'court_docket',
    confidence: (caseNum ? 0.3 : 0) + (plaintiff || defendant ? 0.3 : 0) + (court ? 0.2 : 0) + 0.1,
    fields,
    rawText: fullText,
    allDates: [],
  };
}

export function parseServeDocument(fullText: string): OcrResult {
  const docType = detectDocType(fullText);
  if (docType === 'court_docket') return parseCourtDocument(fullText);
  if (docType === 'drivers_license' || docType === 'passport' || docType === 'military_id' || docType === 'state_id') {
    return parseIdDocument(fullText);
  }

  const fields: Record<string, OcrField> = {};
  const text = fullText;

  const set = (key: string, value: string, confidence: number) => {
    if (value) fields[key] = ocrField(value, confidence, value);
  };

  const partyToServe = (() => {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes('party to serve')) {
        const results: string[] = [];
        for (let j = 0; j < 3 && i + j < lines.length; j++) {
          const trimmed = lines[i + j].trim();
          if (trimmed) results.push(trimmed);
        }
        return results.join('; ');
      }
    }
    return '';
  })();
  set('party_to_serve', partyToServe, 0.6);

  const nameMatch = text.match(/Party to Serve[:\s]*([^\n]+)/i);
  const recipientMatch = text.match(/Recipient[:\s]*([^\n]+)/i);
  const name = nameMatch?.[1]?.trim() || recipientMatch?.[1]?.trim() || '';
  set('recipient_name', name, 0.7);

  const nameParts = name.replace(/,.*$/, '').replace(/an individual/i, '').trim().split(/\s+/);
  if (nameParts.length >= 2) {
    set('first_name', nameParts[0], 0.6);
    set('last_name', nameParts[nameParts.length - 1], 0.6);
    if (nameParts.length > 2) {
      set('middle_name', nameParts.slice(1, -1).join(' '), 0.5);
    }
  }

  const address = (() => {
    const m = text.match(/^Address\s*\n\s*(.+(?:,\s*[A-Z]{2}\s*\d{5}).*)$/im);
    if (m) return m[1].trim();
    const addrLine = text.match(/(\d+\s+[A-Za-z].*?,\s*[A-Za-z ]+,\s*[A-Z]{2}\s*\d{5}[^)\n]*)/);
    if (addrLine) return addrLine[1].trim();
    const match = text.match(/Address[:\s]*([^\n]+)/i);
    return match?.[1]?.trim() || '';
  })();
  set('address', address, 0.6);

  const cityStateMatch = address.match(/([A-Za-z\s.]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/);
  if (cityStateMatch) {
    set('city', cityStateMatch[1].trim(), 0.7);
    set('state', cityStateMatch[2], 0.7);
    set('zip_code', cityStateMatch[3], 0.7);
  }

  const instructions =
    (text.match(/Instructions\s*\n([\s\S]*?)(?:\n\s*\n\s*Address|\n\s*\n\s*\n)/i)?.[1] || '')
      .replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  set('instructions', instructions, 0.5);

  const caseNum = text.match(/Case\s*[#:]\s*(\S+)/i) || text.match(/\((\d{5,})\)/);
  set('case_number', caseNum?.[1] || '', 0.6);

  const jobNum = text.match(/JOB[:\s]*(\d+)/i);
  set('job_number', jobNum?.[1] || '', 0.6);

  const dueDate = text.match(/Due[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i) || text.match(/Due[:\s]*([A-Z][a-z]+ \d{1,2}, \d{4})/i);
  set('due_date', dueDate?.[1] || '', 0.6);

  const dob = text.match(/DOB[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  set('dob', dob?.[1] || '', 0.6);

  return {
    documentType: docType !== 'unknown' ? docType : 'field_sheet',
    confidence: name ? 0.6 : 0.3,
    fields,
    rawText: fullText,
    allDates: [],
  };
}

export function normalizeDate(value: string): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const m = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  const m2 = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if (m2) {
    const yr = parseInt(m2[3]) > 30 ? `19${m2[3]}` : `20${m2[3]}`;
    return `${yr}-${m2[1].padStart(2, '0')}-${m2[2].padStart(2, '0')}`;
  }
  return value;
}

export async function callGoogleVision(
  base64Image: string,
  apiKey: string,
): Promise<string> {
  const resp = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        image: { content: base64Image },
        features: [{ type: 'TEXT_DETECTION', maxResults: 1 }, { type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
      }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await resp.json() as any;
  const annotations = data?.responses?.[0];
  return annotations?.fullTextAnnotation?.text || annotations?.textAnnotations?.[0]?.description || '';
}

export async function getVisionKey(db: D1DbProxy): Promise<string | null> {
  const row = await db.prepare(
    "SELECT config_value FROM system_config WHERE config_key = 'dl_ocr_rapidapi_key' AND is_active = 1 LIMIT 1"
  ).get() as any;
  if (row?.config_value) return row.config_value;
  const skipRow = await db.prepare(
    "SELECT config_value FROM system_config WHERE config_key = 'skiptracer_api_key' AND is_active = 1 LIMIT 1"
  ).get() as any;
  if (skipRow?.config_value) return skipRow.config_value;
  return null;
}

// ── Vehicle Information Extraction ────────────────────────────

export function extractVehicle(text: string): { plate: string; state: string; make: string; model: string; year: string; color: string; vin: string } | null {
  const uText = text.toUpperCase();
  let plate = '', state = '', make = '', model = '', year = '', color = '', vin = '';

  // VIN: 17-char alphanumeric (no I,O,Q)
  const vinMatch = uText.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
  if (vinMatch) vin = vinMatch[1];

  // License plate: after LABEL patterns
  const plateMatch = afterLabel(uText, [
    /(?:PLATE|LICENSE\s*PLATE|TAG|LIC\s*PLATE|LP)[:\s]*([A-Z0-9]{1,10})\b/,
    /(?:VEHICLE\s*PLATE|VEH\s*TAG|VLT)[:\s]*([A-Z0-9]{1,10})\b/,
  ]);
  if (plateMatch) plate = plateMatch;

  // Plate state
  const stateMatch = uText.match(new RegExp(`PLATE\\s*(?:STATE|ST|--?)\\s*(${FIVE_STATES.replace(/\\b/g, '')}|[A-Z]{2})(?:\\s|$)`));
  if (stateMatch) state = stateMatch[1];

  // Make/Model
  const makes = ['ACURA','ALFA ROMEO','ASTON MARTIN','AUDI','BMW','BUICK','CADILLAC','CHEVROLET','CHEVY','CHRYSLER','DODGE','FERRARI','FIAT','FORD','GMC','HONDA','HYUNDAI','INFINITI','JAGUAR','JEEP','KIA','LAMBORGHINI','LAND ROVER','LEXUS','LINCOLN','MASERATI','MAZDA','MERCEDES','MERCURY','MINI','MITSUBISHI','NISSAN','OLDSMOBILE','PLYMOUTH','PONTIAC','PORSCHE','RAM','RANGE ROVER','SATURN','SCION','SUBARU','SUZUKI','TESLA','TOYOTA','VOLKSWAGEN','VOLVO'];
  const makeMatch = text.match(new RegExp(`\\b(${makes.join('|')})\\b`, 'i'));
  if (makeMatch) make = makeMatch[1];

  // Model: line after make
  if (make) {
    const afterMake = text.substring(text.toUpperCase().indexOf(make.toUpperCase()) + make.length, text.toUpperCase().indexOf(make.toUpperCase()) + make.length + 60);
    const modelMatch = afterMake.match(/([A-Z][A-Z0-9]{2,12})/);
    if (modelMatch) model = modelMatch[1];
  }

  // Year: 1990-2028
  const yearMatch = text.match(/\b(19[9]\d|20[0-2]\d)\b/);
  if (yearMatch) year = yearMatch[1];

  // Color
  const colors = ['BLACK','WHITE','SILVER','GRAY','GREY','RED','BLUE','GREEN','YELLOW','BROWN','BEIGE','MAROON','PURPLE','ORANGE','GOLD','TAN','TEAL','NAVY','AQUA','LIME','CRIMSON','BURGUNDY','CHARCOAL','BRONZE','COPPER'];
  const colorMatch = uText.match(new RegExp(`\\b(${colors.join('|')})\\b`));
  if (colorMatch) color = colorMatch[1];

  if (!plate && !vin && !make) return null;
  return { plate, state, make, model, year, color, vin };
}

// ── Phone Number Extraction ──────────────────────────────────

export function extractPhoneNumbers(text: string): string[] {
  const phones: string[] = [];
  const patterns = [
    /\((\d{3})\)\s*(\d{3})[-.]?(\d{4})/g,
    /(\d{3})[-.](\d{3})[-.](\d{4})/g,
    /\b(\d{3})(\d{3})(\d{4})\b/g,
  ];
  for (const p of patterns) {
    let m;
    while ((m = p.exec(text)) !== null) {
      const formatted = `(${m[1]}) ${m[2]}-${m[3]}`;
      if (!phones.includes(formatted)) phones.push(formatted);
    }
  }
  return phones.slice(0, 5);
}

// ── SSN / DL Number Extraction ───────────────────────────────

export function extractSSN(text: string): string {
  const m = text.match(/\b(\d{3})-(\d{2})-(\d{4})\b/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

export function extractDLNumber(text: string): string {
  const uText = text.toUpperCase();
  return afterLabel(uText, [
    /(?:DL|LICENSE|DRIVERS?\s*LIC|IDENTIFICATION)[:\s#]*(?:NO|NUM|NUMBER|#)?[:\s]*([A-Z0-9]{4,18})\b/,
    /(?:STATE\s*ID|ID\s*CARD)[:\s#]*(?:NO|NUM|NUMBER|#)?[:\s]*([A-Z0-9]{4,18})\b/,
  ]) || '';
}

// ── Multi-Document Correlation ───────────────────────────────
// Merges fields from multiple document sources, keeping the
// highest-confidence value per field, and tracks which document
// each field came from.

export interface CorrelatedField {
  value: string;
  confidence: number;
  source: string;         // document type this came from
  sourceIndex: number;    // index in the original documents array
}

export function correlateFields(documents: Array<{ type: string; text: string; index: number }>): Record<string, CorrelatedField> {
  const result: Record<string, CorrelatedField> = {};

  const extractors: Array<{ key: string; extract: (text: string) => { value: string; confidence: number } }> = [
    // Person name fields — multiple label attempts
    { key: 'first_name', extract: (t) => {
      const n = t.match(/Party to Serve[:\s]*([A-Za-z]+)/i) || t.match(/Recipient[:\s]*([A-Za-z]+)/i);
      return { value: n?.[1] || '', confidence: n ? 0.7 : 0 };
    }},
    { key: 'last_name', extract: (t) => {
      const nameLine = t.match(/Party to Serve[:\s]*([^\n]+)/i) || t.match(/Recipient[:\s]*([^\n]+)/i);
      if (!nameLine) return { value: '', confidence: 0 };
      const parts = nameLine[1].replace(/,.*$/, '').trim().split(/\s+/);
      return { value: parts[parts.length - 1] || '', confidence: 0.7 };
    }},
    { key: 'middle_name', extract: (t) => {
      const nameLine = t.match(/Party to Serve[:\s]*([^\n]+)/i) || t.match(/Recipient[:\s]*([^\n]+)/i);
      if (!nameLine) return { value: '', confidence: 0 };
      const parts = nameLine[1].replace(/,.*$/, '').trim().split(/\s+/);
      if (parts.length > 2) return { value: parts.slice(1, -1).join(' '), confidence: 0.5 };
      return { value: '', confidence: 0 };
    }},
    { key: 'defendant', extract: (t) => {
      const d = t.match(/Defendant[:\s]+([^\n]+)/i);
      return { value: d?.[1]?.trim() || '', confidence: d ? 0.7 : 0 };
    }},
    { key: 'plaintiff', extract: (t) => {
      const p = t.match(/Plaintiff[:\s]+([^\n]+)/i) || (t.match(/Plaintiff[\s\S]*?\n([A-Z][A-Za-z .]+)/i));
      return { value: p?.[1]?.trim() || '', confidence: p ? 0.6 : 0 };
    }},
    { key: 'full_name', extract: (t) => {
      const n = t.match(/Party to Serve[:\s]*([^\n]+)/i) || t.match(/Recipient[:\s]*([^\n]+)/i) || t.match(/Defendant[:\s]+([^\n]+)/i);
      return { value: n?.[1]?.trim() || '', confidence: n ? 0.7 : 0 };
    }},
    // Address
    { key: 'address', extract: (t) => {
      const a = t.match(/^Address\s*\n\s*(.+)$/im) || t.match(/(\d+\s+[A-Za-z].*?,\s*[A-Za-z ]+,\s*[A-Z]{2}\s*\d{5}[^)\n]*)/);
      return { value: a?.[1]?.trim() || '', confidence: a ? 0.6 : 0 };
    }},
    { key: 'city', extract: (t) => {
      const addr = t.match(/^Address\s*\n\s*(.+)$/im) || t.match(/(\d+\s+[A-Za-z].*?,\s*[A-Za-z ]+,\s*[A-Z]{2}\s*\d{5}[^)\n]*)/);
      if (!addr) return { value: '', confidence: 0 };
      const parts = addr[1].split(',').map(s => s.trim());
      return { value: parts[1] || '', confidence: 0.5 };
    }},
    { key: 'state', extract: (t) => {
      const st = t.match(/([A-Z]{2})\s*\d{5}/);
      return { value: st?.[1] || 'UT', confidence: st ? 0.7 : 0.2 };
    }},
    { key: 'zip_code', extract: (t) => {
      const z = t.match(/\b(\d{5}(?:-\d{4})?)\b/);
      return { value: z?.[1] || '', confidence: z ? 0.7 : 0 };
    }},
    // DOB
    { key: 'dob', extract: (t) => {
      const d = t.match(/DOB[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i);
      return { value: d?.[1] || '', confidence: d ? 0.7 : 0 };
    }},
    // Case Info
    { key: 'case_number', extract: (t) => {
      const c = t.match(/Case\s*[#:]\s*(\S+)/i) || t.match(/\((\d{5,})\)/);
      return { value: c?.[1] || '', confidence: c ? 0.8 : 0 };
    }},
    { key: 'court', extract: (t) => {
      const c = t.match(/((?:FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH)\s+JUDICIAL\s+DISTRICT\s+COURT[^,\n]*)/i);
      return { value: c?.[1]?.trim() || '', confidence: c ? 0.8 : 0 };
    }},
    { key: 'job_number', extract: (t) => {
      const j = t.match(/(?:Job|JOB)[:\s#]*(\d+)/);
      return { value: j?.[1] || '', confidence: j ? 0.7 : 0 };
    }},
    // Attorney
    { key: 'attorney_name', extract: (t) => {
      const a = t.match(/Attorney for Plaintiff[:\s]+([^\n]+)/i) || t.match(/Attorney[:\s]+([^\n]+)/i);
      return { value: a?.[1]?.trim() || '', confidence: a ? 0.6 : 0 };
    }},
    { key: 'attorney_phone', extract: (t) => {
      const phones = extractPhoneNumbers(t);
      if (phones.length > 0) {
        const attorneySection = t.split(/Attorney|Counsel|Bar/i).slice(1).join(' ');
        if (attorneySection && phones.some(p => attorneySection.includes(p.replace(/[()-\s]/g, '')))) {
          return { value: phones[0], confidence: 0.5 };
        }
      }
      return { value: '', confidence: 0 };
    }},
    { key: 'attorney_email', extract: (t) => {
      const e = t.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      return { value: e?.[1] || '', confidence: e ? 0.6 : 0 };
    }},
    // Court Documents
    { key: 'document_type_court', extract: (t) => {
      if (/SUBPOENA/i.test(t)) return { value: 'subpoena', confidence: 0.8 };
      if (/SUMMONS/i.test(t)) return { value: 'summons', confidence: 0.8 };
      if (/COMPLAINT/i.test(t)) return { value: 'complaint', confidence: 0.7 };
      if (/EVICTION|UNLAWFUL\s*DETAINER/i.test(t)) return { value: 'eviction', confidence: 0.7 };
      if (/RESTRAINING|PROTECTIVE\s*ORDER/i.test(t)) return { value: 'restraining_order', confidence: 0.7 };
      if (/WRIT/i.test(t)) return { value: 'writ', confidence: 0.6 };
      if (/NOTICE/i.test(t)) return { value: 'notice', confidence: 0.5 };
      if (/PETITION/i.test(t)) return { value: 'petition', confidence: 0.6 };
      return { value: '', confidence: 0 };
    }},
    // Fee / Financial
    { key: 'fee', extract: (t) => {
      const f = t.match(/Fee[:\s]*\$?(\d+\.?\d*)/i);
      return { value: f?.[1] || '', confidence: f ? 0.5 : 0 };
    }},
    // Instructions
    { key: 'instructions', extract: (t) => {
      const m = t.match(/Instructions\s*\n([\s\S]*?)(?:\n\n|\nAddress|\n\$|\n[A-Z][a-z]+ [A-Z]|\nPlaintiff)/i);
      return { value: m?.[1]?.replace(/\n/g, ' ')?.trim() || '', confidence: m ? 0.5 : 0 };
    }},
    // Due Date
    { key: 'due_date', extract: (t) => {
      const d = t.match(/Due[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i);
      return { value: d?.[1] || '', confidence: d ? 0.6 : 0 };
    }},
    // Vehicles (extract from text, max one)
    { key: 'vehicle_plate', extract: (t) => {
      const v = extractVehicle(t);
      return { value: v?.plate || '', confidence: v?.plate ? 0.5 : 0 };
    }},
    { key: 'vehicle_vin', extract: (t) => {
      const v = extractVehicle(t);
      return { value: v?.vin || '', confidence: v?.vin ? 0.6 : 0 };
    }},
    { key: 'vehicle_make', extract: (t) => {
      const v = extractVehicle(t);
      return { value: v?.make || '', confidence: v?.make ? 0.4 : 0 };
    }},
    { key: 'vehicle_model', extract: (t) => {
      const v = extractVehicle(t);
      return { value: v?.model || '', confidence: v?.model ? 0.3 : 0 };
    }},
    { key: 'vehicle_year', extract: (t) => {
      const v = extractVehicle(t);
      return { value: v?.year || '', confidence: v?.year ? 0.3 : 0 };
    }},
    { key: 'vehicle_color', extract: (t) => {
      const v = extractVehicle(t);
      return { value: v?.color || '', confidence: v?.color ? 0.3 : 0 };
    }},
    // Phone / SSN
    { key: 'phone_numbers', extract: (t) => {
      const phones = extractPhoneNumbers(t);
      return { value: phones.join('; '), confidence: phones.length > 0 ? 0.5 : 0 };
    }},
    { key: 'ssn', extract: (t) => {
      const s = extractSSN(t);
      return { value: s, confidence: s ? 0.3 : 0 };
    }},
    { key: 'dl_number', extract: (t) => {
      const d = extractDLNumber(t);
      return { value: d, confidence: d ? 0.4 : 0 };
    }},
    // Attorney bar number
    { key: 'attorney_bar_number', extract: (t) => {
      const b = t.match(/Bar#?\s*(\d+)/i);
      return { value: b?.[1] || '', confidence: b ? 0.5 : 0 };
    }},
  ];

  for (const doc of documents) {
    const text = doc.text;
    for (const ext of extractors) {
      const extracted = ext.extract(text);
      if (!extracted.value) continue;

      const existing = result[ext.key];
      if (!existing || extracted.confidence > existing.confidence) {
        result[ext.key] = {
          value: extracted.value,
          confidence: extracted.confidence,
          source: doc.type,
          sourceIndex: doc.index,
        };
      }
    }
  }

  return result;
}

// ── Overall document confidence score ────────────────────────

export function calculateDocumentConfidence(fields: Record<string, CorrelatedField>): number {
  const vals = Object.values(fields);
  if (vals.length === 0) return 0;
  const avg = vals.reduce((sum, f) => sum + f.confidence, 0) / vals.length;
  // Boost by field count (more extracted fields = higher confidence)
  const countBonus = Math.min(0.2, vals.length * 0.01);
  return Math.min(1, avg + countBonus);
}


interface D1DbProxy {
  prepare(sql: string): {
    get(...params: any[]): Promise<any>;
    all(...params: any[]): Promise<any[]>;
    run(...params: any[]): Promise<any>;
  };
}
