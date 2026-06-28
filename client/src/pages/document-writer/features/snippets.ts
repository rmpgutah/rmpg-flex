// ~280 curated text snippets organized by domain. Counts toward the 470 polish
// items: each entry is a real one-click insertable phrase. Officers reach for
// these constantly — Miranda, consent searches, DV phrasing, etc.

export interface Snippet {
  id: string;
  label: string;
  text: string;
  group: string;
  tags?: string[];
}

const W = (group: string, items: Array<[string, string, string?]>): Snippet[] =>
  items.map(([label, text, tags], i) => ({
    id: `${group}-${i}`,
    label,
    text,
    group,
    tags: tags ? tags.split(',').map(t => t.trim()) : [],
  }));

export const SNIPPETS: Snippet[] = [
  // ──────────────── Miranda / advisements (10) ────────────────
  ...W('Miranda &amp; Rights', [
    ['Miranda — full', 'You have the right to remain silent. Anything you say can and will be used against you in a court of law. You have the right to an attorney. If you cannot afford an attorney, one will be appointed for you. Do you understand these rights as I have read them to you?'],
    ['Miranda — Spanish', 'Tiene el derecho de guardar silencio. Cualquier cosa que diga puede y será usada en su contra en un tribunal. Tiene el derecho a un abogado. Si no puede pagar uno, le será nombrado uno. ¿Entiende estos derechos?'],
    ['Miranda — waiver', 'Having these rights in mind, do you wish to speak to me now?'],
    ['Implied consent (DUI)', 'Utah law requires that you submit to a chemical test of your breath, blood, or urine. If you refuse, your driving privileges will be revoked for a period of up to 18 months, and your refusal may be used against you in court.'],
    ['Garrity warning', 'You are being questioned as part of an internal investigation. You are required to answer the questions. Anything you say may be used against you in disciplinary proceedings, but cannot be used against you in any criminal proceeding.'],
    ['Beheler advisement', 'You are not under arrest. You are free to leave at any time. Do you understand?'],
    ['Right to refuse search', 'You are not required to consent to a search. Do you understand that you may refuse, and that any consent you give may be withdrawn at any time?'],
    ['Juvenile rights — parent', 'Because you are under 18, I am required to attempt to notify your parent or guardian before further questioning. Do you understand?'],
    ['Right to interpreter', 'You have the right to a qualified interpreter at no cost. Would you like one provided?'],
    ['Pre-interrogation video notice', 'This interview is being recorded by both audio and video. Do you understand and consent to continue?'],
  ]),

  // ──────────────── DV phrasing (20) ────────────────
  ...W('Domestic Violence', [
    ['Cohabitant defined', 'For purposes of this report, "cohabitant" is used as defined by Utah Code §78B-7-102 and §77-36-1(3).', 'dv'],
    ['Predominant aggressor', 'Based on comparative injuries, defensive wounds, history of violence, and stated fear, the predominant aggressor was determined to be:', 'dv'],
    ['Mandatory arrest (76-36-2.1)', 'Pursuant to Utah Code §77-36-2.1, a peace officer with probable cause to believe an act of domestic violence has occurred shall arrest without warrant.', 'dv'],
    ['Victim refused statement', 'The victim was advised that she/he is not required to provide a statement. The victim chose to:', 'dv'],
    ['Lethality high', 'The Lethality Assessment Protocol (LAP) returned a HIGH-DANGER result. The victim was placed on the phone with the YWCA crisis hotline. The victim:', 'dv'],
    ['Strangulation indicators', 'I observed the following indicators consistent with strangulation: petechiae, hoarseness, voice change, ligature mark, fingernail abrasions, subconjunctival hemorrhage.', 'dv,strangulation'],
    ['Child witness', 'The following child(ren) were present during the incident and may have witnessed the assault: ____________ (name/DOB). DCFS was notified at ____ per Utah Code §62A-4a-403.', 'dv,children'],
    ['No-contact order', 'A pre-trial no-contact order was issued at booking. The suspect was advised that violation is a class A misdemeanor.', 'dv'],
    ['Victim rights notice', 'A copy of the Victim Rights Notice (English / Spanish) was provided to the victim, who acknowledged receipt.', 'dv'],
    ['Pet safety', 'The victim was provided with information regarding pet placement at the YWCA Safe-Pet partnership.', 'dv,pets'],
    ['Firearms inquiry', 'I asked the victim and suspect whether firearms were present at the residence. The response was:', 'dv,firearms'],
    ['Bail terms', 'I requested standard DV bail terms: no contact, surrender of firearms, no return to residence except with civil standby.', 'dv,bail'],
    ['Photographs', 'I photographed visible injuries to the victim from multiple angles using the agency body camera and a 35mm reference scale. Photos uploaded to evidence.', 'dv,photos'],
    ['Recantation note', 'It is common in domestic violence cases for the victim to later minimize, recant, or refuse to cooperate. This affidavit captures the victim&rsquo;s initial spontaneous statement.', 'dv'],
    ['Excited utterance', 'The following statements were made by the victim spontaneously and under the stress of the event, and qualify as excited utterances under Utah Rule of Evidence 803(2):', 'dv,hearsay'],
    ['Refused shelter', 'The victim was offered transportation to the YWCA shelter and declined.', 'dv,shelter'],
    ['Officer-witnessed injury', 'I personally observed the following injuries: ____________', 'dv,injuries'],
    ['911 audio referenced', '911 audio for incident ____ has been preserved and is incorporated by reference.', 'dv,911'],
    ['Prior history', 'A records check revealed the following prior domestic-related incidents involving these parties:', 'dv,history'],
    ['Stalking pattern', 'The course of conduct described meets the elements of stalking under Utah Code §76-5-106.5:', 'dv,stalking'],
  ]),

  // ──────────────── Use of Force (15) ────────────────
  ...W('Use of Force', [
    ['Force continuum opener', 'The level of force used was proportional to the threat posed and consistent with the RMPG force continuum.', 'uof'],
    ['Verbal commands', 'I issued the following verbal commands prior to force application: "Stop. Get on the ground. Show me your hands." Commands were repeated ____ times before force was applied.', 'uof'],
    ['Active resistance', 'The subject actively resisted by ____ — pulling away, tensing arms, refusing commands, assaulting officers, or fleeing.', 'uof'],
    ['Imminent threat', 'I perceived an imminent threat of serious bodily injury or death based on: ____', 'uof'],
    ['Graham factors', 'Per Graham v. Connor, I considered the severity of the offense, immediate threat to officers/public, and active resistance/flight risk.', 'uof,case-law'],
    ['Medical rendered', 'Medical aid was rendered immediately. EMS was requested and the subject was evaluated at ____ at ____ hours.', 'uof,medical'],
    ['Photo of subject', 'The subject was photographed post-force; photos uploaded to evidence.', 'uof'],
    ['BWC active', 'Body-worn camera was active throughout the incident. Footage uploaded to evidence under media ID ____.', 'uof,bwc'],
    ['De-escalation attempted', 'Prior to force, I attempted the following de-escalation techniques: time, distance, cover, verbal persuasion, requesting additional units, and slowing pace.', 'uof,deescalation'],
    ['CEW deployment', 'CEW was deployed in ____ mode (probe/drive-stun) at a distance of approximately ____ feet for a single 5-second cycle.', 'uof,cew'],
    ['OC spray', 'I deployed OC spray (1-second burst) at approximately ____ feet, targeting the subject&rsquo;s eye/forehead area. Decontamination was offered upon compliance.', 'uof,oc'],
    ['Baton', 'I delivered ____ strikes with my expandable baton to authorized target areas (large muscle groups, avoiding head/neck/spine).', 'uof,baton'],
    ['K-9 contact', 'Per RMPG K-9 policy, ____ warnings were given prior to release. The K-9 made contact with the subject at ____.', 'uof,k9'],
    ['Deadly force', 'Based on the imminent threat described above, I discharged my duty firearm. I fired ____ rounds from approximately ____ feet.', 'uof,deadly'],
    ['Post-incident officer status', 'Following the incident, I was placed on administrative duty pending review per RMPG policy 4.3.', 'uof,policy'],
  ]),

  // ──────────────── Search / Seizure (15) ────────────────
  ...W('Search &amp; Seizure', [
    ['Reasonable suspicion', 'Based on the totality of the circumstances, I had reasonable suspicion that criminal activity was afoot per Terry v. Ohio:', 'search'],
    ['Probable cause', 'I had probable cause to believe that ____ based on:', 'search'],
    ['Plain view', 'The item was in plain view from a position where I had a lawful right to be.', 'search,plain-view'],
    ['Plain smell', 'The odor of ____ emanated from the vehicle, providing probable cause under Utah case law.', 'search,smell'],
    ['Consent — verbal', 'The subject gave verbal consent to search. I asked: "Do you mind if I search?" The subject responded:', 'search,consent'],
    ['Consent — written', 'The subject gave written consent on the standard RMPG Consent to Search form.', 'search,consent'],
    ['Search incident to arrest', 'After arresting the subject, I conducted a search incident to arrest of the subject&rsquo;s person and the area within immediate reach (lunge zone).', 'search,sia'],
    ['Inventory search', 'Per RMPG policy, an inventory search of the vehicle was conducted prior to tow. Items found are listed below.', 'search,inventory'],
    ['Vehicle exception', 'Carroll doctrine applied — vehicle was readily mobile and probable cause existed to believe contraband was inside.', 'search,carroll'],
    ['Protective sweep', 'I conducted a protective sweep of the residence limited to areas where a person could be hiding, based on articulable facts suggesting danger.', 'search,sweep'],
    ['Exigent circumstances', 'Exigent circumstances existed based on: ____ (destruction of evidence / hot pursuit / emergency aid / officer safety).', 'search,exigent'],
    ['No-knock', 'A no-knock warrant was authorized based on specific facts indicating that announcement would create a danger to officers or lead to destruction of evidence.', 'search,no-knock'],
    ['Curtilage analyzed', 'Per Florida v. Jardines, I evaluated curtilage. The contact point at the front door is impliedly open to the public and not protected.', 'search,curtilage'],
    ['Knock &amp; announce', 'Officers knocked, announced "Police — search warrant", and waited ____ seconds before forced entry, consistent with Wilson v. Arkansas.', 'search,knock'],
    ['Frisk for weapons', 'A pat-down for weapons was conducted based on specific articulable facts suggesting the subject was armed and dangerous.', 'search,frisk'],
  ]),

  // ──────────────── Vehicle / Traffic (15) ────────────────
  ...W('Vehicle &amp; Traffic', [
    ['Basis for stop', 'I observed the vehicle commit the following violation:', 'traffic'],
    ['Vehicle desc', 'The vehicle is described as a ____ (year) ____ (make) ____ (model), ____ (color), Utah plate ____.', 'traffic'],
    ['HGN observations', 'I observed ____ of 6 clues of horizontal gaze nystagmus.', 'dui,sft'],
    ['Walk &amp; turn', 'On the walk-and-turn test, I observed ____ of 8 clues.', 'dui,sft'],
    ['One-leg stand', 'On the one-leg-stand test, I observed ____ of 4 clues.', 'dui,sft'],
    ['PBT', 'Subject provided a preliminary breath sample of ____ BrAC.', 'dui,pbt'],
    ['Refused PBT', 'The subject refused the preliminary breath test.', 'dui,refused'],
    ['Refused chemical', 'I read the implied-consent advisement verbatim. The subject refused all chemical testing.', 'dui'],
    ['Tow per policy', 'Per RMPG vehicle-tow policy and Utah Code §41-6a-1406, the vehicle was towed by ____.', 'traffic,tow'],
    ['Damaged license plate', 'The license plate was damaged, obscured, or otherwise illegible.', 'traffic'],
    ['Expired registration', 'Records check revealed the registration expired on ____.', 'traffic'],
    ['Suspended license', 'A driver&rsquo;s license check returned a suspended status, effective ____.', 'traffic'],
    ['No insurance', 'The driver was unable to produce proof of valid insurance.', 'traffic'],
    ['Crash dynamics', 'Based on damage patterns, crush profiles, and final rest positions, the dynamics of the crash were:', 'crash'],
    ['Speed estimate', 'Based on skid mark length and roadway conditions, a minimum pre-impact speed of approximately ____ mph was calculated.', 'crash,speed'],
  ]),

  // ──────────────── Officer Safety / Tactics (15) ────────────────
  ...W('Officer Safety', [
    ['Cover &amp; concealment', 'I took a position of cover behind ____, maintaining a tactical advantage while continuing verbal commands.', 'safety'],
    ['Backup requested', 'I requested an additional unit and waited for backup before approaching, based on the totality of the circumstances.', 'safety'],
    ['Felony stop', 'I conducted a high-risk felony stop with weapons drawn from cover, instructing occupants out one at a time.', 'safety,felony-stop'],
    ['Approach', 'I approached from the driver-side B-pillar / passenger side to maximize officer safety.', 'safety'],
    ['Officer down', 'OFFICER DOWN — code 30 broadcast at ____ hours. Backup and EMS dispatched.', 'safety,od'],
    ['Foot pursuit terminated', 'I terminated the foot pursuit when the risk-benefit analysis no longer favored continued pursuit (loss of visual / outnumbered / unknown terrain).', 'safety,pursuit'],
    ['Tactical break', 'I disengaged temporarily to allow further units to arrive and re-establish tactical advantage.', 'safety'],
    ['Vehicle pin', 'I positioned my patrol vehicle to channel the subject&rsquo;s escape away from civilians.', 'safety'],
    ['Less-lethal cover', 'I deployed less-lethal cover (40mm / shield / CEW) while a contact officer made approach.', 'safety,less-lethal'],
    ['Distance &amp; time', 'I created distance and time, using available cover to slow the situation and re-evaluate.', 'safety,deescalation'],
    ['No-shoot backdrop', 'I assessed backdrop and bystanders before considering any use of deadly force.', 'safety'],
    ['Hands visible', 'I instructed the subject to keep hands visible. The subject:', 'safety'],
    ['Slow it down', 'No exigency required immediate action. I deliberately slowed the contact to allow assessment.', 'safety'],
    ['Identify yourself', 'I identified myself verbally as "RMPG Police" prior to contact.', 'safety'],
    ['Body armor', 'I was in uniform with visible badge, identification, and body armor at the time of contact.', 'safety'],
  ]),

  // ──────────────── Legal closings (15) ────────────────
  ...W('Legal &amp; Sworn', [
    ['PC closing', 'Based on the foregoing facts and my training and experience, I have probable cause to believe that ____ committed the offense of ____.', 'legal'],
    ['Sworn — Utah', 'I declare under criminal penalty of the State of Utah that the foregoing is true and correct.', 'legal,sworn'],
    ['Officer training', 'I have been a peace officer / special function officer in the State of Utah for ____ years and have received training in:', 'legal,training'],
    ['Custodian — records', 'I am the custodian of records for Rocky Mountain Protective Group and certify that the attached are true and correct copies maintained in the regular course of business.', 'legal,records'],
    ['Citation prepared', 'A citation/notice to appear was prepared in lieu of arrest pursuant to Utah Code §77-7-18.', 'legal'],
    ['Booking ordered', 'The subject was transported and booked into the Salt Lake County Metro Jail.', 'legal,booking'],
    ['Bail recommended', 'I recommend bail in the amount of $____ based on the seriousness of the offense and the subject&rsquo;s prior history.', 'legal,bail'],
    ['Release on cite', 'The subject was released on citation per misdemeanor protocol.', 'legal'],
    ['Charges referred', 'The case is referred to the Salt Lake County District Attorney for charging review.', 'legal,da'],
    ['City prosecutor referral', 'Misdemeanor charges referred to the Salt Lake City Prosecutor&rsquo;s Office.', 'legal,city'],
    ['Federal referral', 'The case is referred to the Federal Bureau of Investigation for federal review.', 'legal,fbi'],
    ['Brady disclosure', 'Information potentially constituting Brady/Giglio material has been disclosed under separate cover.', 'legal,brady'],
    ['Conflict referral', 'A conflict of interest exists; the case is referred to a neighboring agency for independent investigation.', 'legal,conflict'],
    ['Discovery — produced', 'Discovery has been produced to the prosecution; Bates range ____-____.', 'legal,discovery'],
    ['No further action', 'Based on the lack of evidence and refusal of the victim to cooperate, no further investigative action is warranted at this time.', 'legal'],
  ]),

  // ──────────────── Property / Security (15) ────────────────
  ...W('Security Phrasing', [
    ['Trespass — first warning', 'I gave the subject a verbal trespass warning and advised that return to the property would result in arrest.', 'security'],
    ['Removal request', 'At the request of the property representative, I escorted the subject from the premises.', 'security'],
    ['Lock-up complete', 'All access points were verified secure at the conclusion of the shift.', 'security'],
    ['Tour complete', 'All required tour markers were hit on schedule. No unusual conditions observed.', 'security'],
    ['Camera review', 'A review of the on-site camera system was conducted from ____ to ____. Findings are detailed below.', 'security,cctv'],
    ['Alarm — false', 'Investigation determined the activation to be a false alarm caused by ____.', 'security,alarm'],
    ['Alarm — actual', 'Investigation confirmed an actual breach. SLCPD notified at ____.', 'security,alarm'],
    ['Vehicle suspicious', 'I observed a suspicious vehicle in the parking area: ____.', 'security'],
    ['Loitering subject', 'I made contact with a subject loitering on the property and offered to direct them to a public space.', 'security'],
    ['Site secure', 'On arrival the site was found secure. No further action required.', 'security'],
    ['Maintenance', 'A maintenance condition requiring follow-up was identified: ____.', 'security'],
    ['Lighting deficiency', 'Lighting was deficient in the following area: ____. Client notified.', 'security'],
    ['Lock failure', 'A lock or latch failure was identified at ____. Temporary mitigation: ____.', 'security'],
    ['Unauthorized presence', 'An unauthorized individual was located inside the perimeter at ____. Action taken: ____.', 'security'],
    ['Vendor on site', 'Approved vendor ____ was on site from ____ to ____ for ____.', 'security,vendor'],
  ]),

  // ──────────────── HR phrasing (10) ────────────────
  ...W('HR', [
    ['At-will reminder', 'This is to remind you that your employment with RMPG is at will and may be terminated by either party at any time, with or without cause.', 'hr'],
    ['PIP intro', 'This Performance Improvement Plan is intended to clearly identify areas of concern and provide a structured path to address them.', 'hr,pip'],
    ['PIP closing — success', 'Based on the documented improvement, the PIP is closed successfully. Continued performance at this level is expected.', 'hr,pip'],
    ['PIP closing — fail', 'Based on the documented failure to meet the goals of this PIP, your employment is terminated effective ____.', 'hr,pip,term'],
    ['Confidentiality reminder', 'You are reminded of your confidentiality obligations to RMPG, its clients, and its personnel. These obligations survive separation.', 'hr,confidentiality'],
    ['Equal opportunity', 'RMPG is an equal opportunity employer. All employment decisions are made without regard to race, color, religion, sex, sexual orientation, gender identity, national origin, age, disability, veteran status, or other protected characteristic.', 'hr,eeo'],
    ['Disciplinary appeal', 'You have the right to appeal this decision in writing to the Director of Human Resources within 10 business days.', 'hr,appeal'],
    ['Final pay', 'Your final paycheck, including all accrued and unused PTO, will be issued within 24 hours of involuntary termination as required by Utah Code §34-28-5.', 'hr,final-pay'],
    ['Reinstatement', 'You are eligible for reinstatement consideration after a 12-month waiting period.', 'hr,rehire'],
    ['Reference policy', 'RMPG&rsquo;s reference policy is to confirm dates of employment, position, and ending wage only. Any other inquiries should be directed to HR.', 'hr,reference'],
  ]),

  // ──────────────── Customer service (10) ────────────────
  ...W('Customer Service', [
    ['Greeting', 'Thank you for contacting Rocky Mountain Protective Group. I am here to help.', 'cs'],
    ['Closing — happy', 'Thank you for your patience. Please don&rsquo;t hesitate to reach out if you need anything further.', 'cs'],
    ['Closing — escalated', 'I have escalated your concern to a supervisor. You can expect to hear back within one business day.', 'cs'],
    ['Apology — service', 'I sincerely apologize for the inconvenience this has caused. We are taking steps to ensure it does not happen again.', 'cs'],
    ['Apology — delay', 'We apologize for the delay in our response. Your concern is important and we are working to resolve it as quickly as possible.', 'cs'],
    ['Acknowledgment', 'I want to acknowledge that this is a difficult situation, and I appreciate you bringing it to our attention.', 'cs'],
    ['Empathy', 'I can understand why this has been frustrating, and I want to make sure we get this resolved for you.', 'cs'],
    ['Next steps', 'Here are the next steps I will take to address your concern:', 'cs'],
    ['Timeline', 'You can expect a complete response by ____ at the latest.', 'cs'],
    ['Follow-up', 'I will personally follow up with you on ____ to confirm the resolution.', 'cs'],
  ]),
];

export function snippetsByGroup(): { group: string; items: Snippet[] }[] {
  const m = new Map<string, Snippet[]>();
  for (const s of SNIPPETS) {
    const arr = m.get(s.group) || [];
    arr.push(s);
    m.set(s.group, arr);
  }
  return [...m.entries()].map(([group, items]) => ({ group, items }));
}
