import Foundation

// ============================================================
// Field Toolkit registry — every entry is one executable field
// function (MDT function-key style). Categories:
//   • Self-initiated CAD calls  → POST /dispatch/calls at my GPS, P-coded
//   • Live lookups              → authenticated GETs against the Worker
//   • Unit status               → PUT /dispatch/units/:id/status
//   • Clear w/ disposition      → PUT /dispatch/calls/:id/status
//   • Field references          → offline cards (codes, law, checklists)
//   • Utilities                 → torch, timers, coordinates, notes
// ============================================================

enum ToolAction {
    case createCall(type: String, priority: String, desc: String)
    /// GET `path` (+ optional user input appended as `queryKey=input`).
    case lookup(path: String, queryKey: String?, prompt: String?)
    case unitStatus(String)
    case clearCall(disposition: String)
    case addCallNote
    case reference(String)
    case torch(Bool)
    case torchStrobe
    case coordinates
    case timer(label: String, seconds: Int)   // 0 = count-up
    case shiftTimer
    case pingLocation
    case fieldInterview
    case syncQueue
}

struct FieldTool: Identifiable {
    let id: String
    let title: String
    let category: String
    let action: ToolAction
}

enum FieldToolRegistry {
    static let categories = [
        "SELF-INITIATED", "LOOKUPS", "UNIT STATUS", "CLEAR CALL",
        "TIMERS & UTILITIES", "LEGAL REFERENCE", "CODES & REFERENCE",
    ]

    static let tools: [FieldTool] = selfInitiated + lookups + unitStatus
        + clearCall + utilities + legalReference + codesReference

    // ── 1. Self-initiated calls (created at my GPS, me assigned) ──
    private static let callTypes: [(String, String, String, String)] = [
        ("traffic_stop", "P2", "Traffic Stop", "Self-initiated traffic stop"),
        ("pedestrian_stop", "P3", "Pedestrian Stop", "Consensual/Terry pedestrian contact"),
        ("suspicious_person", "P2", "Suspicious Person", "Suspicious person contact"),
        ("suspicious_vehicle", "P2", "Suspicious Vehicle", "Suspicious vehicle check"),
        ("premise_check", "P4", "Premise Check", "Contract premise security check"),
        ("business_check", "P4", "Business Check", "Business walk-through"),
        ("foot_patrol", "P4", "Foot Patrol", "Foot patrol of area"),
        ("area_check", "P4", "Area Check", "Directed area check"),
        ("welfare_check", "P2", "Welfare Check", "Check welfare"),
        ("citizen_contact", "P4", "Citizen Contact", "Citizen assist/contact"),
        ("citizen_assist", "P3", "Citizen Assist", "Motorist/citizen assist"),
        ("parking_enforcement", "P4", "Parking Enforcement", "Parking violation enforcement"),
        ("alarm_response", "P2", "Alarm Response", "Audible/silent alarm response"),
        ("escort", "P3", "Security Escort", "Employee/cash escort"),
        ("follow_up", "P4", "Follow-Up", "Case/incident follow-up"),
        ("community_contact", "P4", "Community Contact", "Community engagement contact"),
        ("trespass_contact", "P2", "Trespass Contact", "Trespasser contact/warning"),
        ("vandalism_found", "P3", "Vandalism Found", "Vandalism discovered on patrol"),
        ("open_door", "P2", "Open Door/Window", "Insecure premise found"),
        ("hazard_found", "P3", "Hazard Found", "Road/site hazard discovered"),
    ]
    private static var selfInitiated: [FieldTool] {
        callTypes.map { t in
            FieldTool(id: "call_\(t.0)", title: t.2, category: "SELF-INITIATED",
                      action: .createCall(type: t.0, priority: t.1, desc: t.3))
        }
    }

    // ── 2. Live lookups ──
    private static let lookups: [FieldTool] = [
        FieldTool(id: "lk_person", title: "Person by Name", category: "LOOKUPS",
                  action: .lookup(path: "api/records/persons", queryKey: "search", prompt: "Last name or full name")),
        FieldTool(id: "lk_dl", title: "DL Record Search", category: "LOOKUPS",
                  action: .lookup(path: "api/dl-records", queryKey: "search", prompt: "Name or DL number")),
        FieldTool(id: "lk_warrant_name", title: "Warrant Check (Name)", category: "LOOKUPS",
                  action: .lookup(path: "api/warrants", queryKey: "search", prompt: "Subject name")),
        FieldTool(id: "lk_vehicle_plate", title: "Plate Check", category: "LOOKUPS",
                  action: .lookup(path: "api/records/vehicles", queryKey: "search", prompt: "License plate")),
        FieldTool(id: "lk_vehicle_vin", title: "VIN Check", category: "LOOKUPS",
                  action: .lookup(path: "api/records/vehicles", queryKey: "search", prompt: "VIN (full or partial)")),
        FieldTool(id: "lk_statute", title: "Utah Code Search", category: "LOOKUPS",
                  action: .lookup(path: "api/statutes", queryKey: "search", prompt: "Keyword or section (e.g. 76-6-206)")),
        FieldTool(id: "lk_active_calls", title: "Active Calls Board", category: "LOOKUPS",
                  action: .lookup(path: "api/dispatch/calls?status=active", queryKey: nil, prompt: nil)),
        FieldTool(id: "lk_units", title: "All Units Status", category: "LOOKUPS",
                  action: .lookup(path: "api/dispatch/units", queryKey: nil, prompt: nil)),
        FieldTool(id: "lk_bolos", title: "Active BOLOs", category: "LOOKUPS",
                  action: .lookup(path: "api/dispatch/bolos", queryKey: nil, prompt: nil)),
        FieldTool(id: "lk_handoff", title: "Shift Handoff Notes", category: "LOOKUPS",
                  action: .lookup(path: "api/dispatch/shift-handoff", queryKey: nil, prompt: nil)),
        FieldTool(id: "lk_fi", title: "FI Card Search", category: "LOOKUPS",
                  action: .lookup(path: "api/field-interviews", queryKey: "search", prompt: "Subject name")),
        FieldTool(id: "lk_premise_alerts", title: "Premise Alerts", category: "LOOKUPS",
                  action: .lookup(path: "api/dispatch/premise-alerts", queryKey: nil, prompt: nil)),
        FieldTool(id: "lk_premise", title: "Premise History", category: "LOOKUPS",
                  action: .lookup(path: "api/dispatch/premise-history", queryKey: "address", prompt: "Street address")),
        FieldTool(id: "lk_incidents", title: "Incident Search", category: "LOOKUPS",
                  action: .lookup(path: "api/incidents", queryKey: "search", prompt: "Keyword / case #")),
        FieldTool(id: "lk_arrests", title: "Arrest History", category: "LOOKUPS",
                  action: .lookup(path: "api/arrests", queryKey: "search", prompt: "Subject name")),
        FieldTool(id: "lk_citations", title: "Citation History", category: "LOOKUPS",
                  action: .lookup(path: "api/citations", queryKey: "search", prompt: "Name or citation #")),
        FieldTool(id: "lk_evidence", title: "Evidence Search", category: "LOOKUPS",
                  action: .lookup(path: "api/records/evidence", queryKey: "search", prompt: "Case # or description")),
        FieldTool(id: "lk_cases", title: "Case Search", category: "LOOKUPS",
                  action: .lookup(path: "api/cases", queryKey: "search", prompt: "Case # or subject")),
        FieldTool(id: "lk_my_unit", title: "My Unit Detail", category: "LOOKUPS",
                  action: .lookup(path: "api/dispatch/duty/me", queryKey: nil, prompt: nil)),
        FieldTool(id: "lk_fleet", title: "Fleet Vehicles", category: "LOOKUPS",
                  action: .lookup(path: "api/fleet/vehicles", queryKey: nil, prompt: nil)),
        FieldTool(id: "lk_announcements", title: "Announcements", category: "LOOKUPS",
                  action: .lookup(path: "api/announcements", queryKey: nil, prompt: nil)),
        FieldTool(id: "lk_recent_calls", title: "Recent Calls (Today)", category: "LOOKUPS",
                  action: .lookup(path: "api/dispatch/calls?limit=25", queryKey: nil, prompt: nil)),
        FieldTool(id: "lk_warrant_dl", title: "Warrant Check (DL #)", category: "LOOKUPS",
                  action: .lookup(path: "api/warrants", queryKey: "search", prompt: "DL number")),
    ]

    // ── 3. Unit status (full status set) ──
    private static let statusSet: [(String, String)] = [
        ("available", "10-8 Available"), ("enroute", "En Route"),
        ("on_scene", "10-23 On Scene"), ("busy", "10-6 Busy"),
        ("dispatched", "Dispatched"), ("out_of_service", "10-7 Out of Service"),
        ("off_duty", "Off Duty"),
    ]
    private static var unitStatus: [FieldTool] {
        statusSet.map { FieldTool(id: "st_\($0.0)", title: $0.1, category: "UNIT STATUS",
                                  action: .unitStatus($0.0)) }
    }

    // ── 4. Clear current call with disposition ──
    private static let dispositions = [
        "Report Taken", "Citation Issued", "Warning Issued", "Arrest Made",
        "Gone on Arrival", "Unable to Locate", "Unfounded", "Civil Matter",
        "Referred to Other Agency", "Assistance Rendered", "Checks OK",
        "Cancelled by Dispatch",
    ]
    private static var clearCall: [FieldTool] {
        dispositions.map { FieldTool(id: "cl_\($0)", title: "Clear: \($0)",
                                     category: "CLEAR CALL", action: .clearCall(disposition: $0)) }
        + [FieldTool(id: "cl_note", title: "Add Note to My Call", category: "CLEAR CALL",
                     action: .addCallNote)]
    }

    // ── 5. Timers & utilities ──
    private static let utilities: [FieldTool] = [
        FieldTool(id: "ut_torch_on", title: "Flashlight ON", category: "TIMERS & UTILITIES", action: .torch(true)),
        FieldTool(id: "ut_torch_off", title: "Flashlight OFF", category: "TIMERS & UTILITIES", action: .torch(false)),
        FieldTool(id: "ut_strobe", title: "Strobe (Signal)", category: "TIMERS & UTILITIES", action: .torchStrobe),
        FieldTool(id: "ut_coords", title: "My Coordinates", category: "TIMERS & UTILITIES", action: .coordinates),
        FieldTool(id: "ut_ping", title: "Ping Location to Dispatch", category: "TIMERS & UTILITIES", action: .pingLocation),
        FieldTool(id: "ut_shift", title: "Shift Elapsed Timer", category: "TIMERS & UTILITIES", action: .shiftTimer),
        FieldTool(id: "ut_dui15", title: "DUI 15-min Observation", category: "TIMERS & UTILITIES",
                  action: .timer(label: "DUI OBSERVATION", seconds: 900)),
        FieldTool(id: "ut_dui20", title: "Breath Test 20-min Wait", category: "TIMERS & UTILITIES",
                  action: .timer(label: "BREATH TEST DEPRIVATION", seconds: 1200)),
        FieldTool(id: "ut_custody", title: "Custody Elapsed Timer", category: "TIMERS & UTILITIES",
                  action: .timer(label: "TIME IN CUSTODY", seconds: 0)),
        FieldTool(id: "ut_pursuit", title: "Foot Pursuit Timer", category: "TIMERS & UTILITIES",
                  action: .timer(label: "FOOT PURSUIT", seconds: 0)),
        FieldTool(id: "ut_break", title: "Meal Break Timer (30m)", category: "TIMERS & UTILITIES",
                  action: .timer(label: "MEAL BREAK", seconds: 1800)),
        FieldTool(id: "ut_tow", title: "Tow ETA Timer (45m)", category: "TIMERS & UTILITIES",
                  action: .timer(label: "TOW ETA", seconds: 2700)),
        FieldTool(id: "ut_fi", title: "New FI Card", category: "TIMERS & UTILITIES",
                  action: .fieldInterview),
        FieldTool(id: "ut_sync", title: "Sync Offline Queue", category: "TIMERS & UTILITIES",
                  action: .syncQueue),
    ]

    // ── 6. Legal reference cards (Utah-specific where cited) ──
    private static let legalCards: [(String, String, String)] = [
        ("ref_miranda_en", "Miranda (English)", """
        1. You have the right to remain silent.
        2. Anything you say can and will be used against you in a court of law.
        3. You have the right to talk to a lawyer and have them present while you are questioned.
        4. If you cannot afford a lawyer, one will be appointed for you before any questioning.
        5. Do you understand each of these rights as I have explained them to you?
        6. With these rights in mind, do you wish to talk to me?
        """),
        ("ref_miranda_es", "Miranda (Español)", """
        1. Tiene derecho a guardar silencio.
        2. Cualquier cosa que diga puede y será usada en su contra en un tribunal.
        3. Tiene derecho a hablar con un abogado y a que esté presente durante el interrogatorio.
        4. Si no puede pagar un abogado, se le asignará uno antes de cualquier interrogatorio.
        5. ¿Entiende cada uno de estos derechos que le he explicado?
        6. Teniendo en cuenta estos derechos, ¿desea hablar conmigo?
        """),
        ("ref_terry", "Terry Stop Checklist", """
        Reasonable suspicion required — articulable facts that crime is afoot.
        DOCUMENT: time/place • behavior observed • area context (recent crimes)
        • flight/evasion • matching BOLO • training & experience inference.
        Frisk ONLY with separate reasonable suspicion subject is armed.
        Scope: outer clothing pat for weapons. Plain-feel contraband OK.
        Duration: no longer than needed to confirm/dispel suspicion.
        UT stop & identify: 77-7-15 — may demand name/explain actions.
        """),
        ("ref_uof", "Use of Force Review", """
        Graham v. Connor — objective reasonableness from the perspective of a
        reasonable officer on scene. Factors:
        1) Severity of the crime  2) Immediate threat to officers/others
        3) Active resistance or flight.
        Continuum: presence → verbal → soft hands → hard hands /
        intermediate weapons → deadly force (imminent death/serious injury).
        DOCUMENT every level used, warnings given, and de-escalation attempts.
        """),
        ("ref_trespass", "Trespass — UT 76-6-206", """
        Criminal trespass: enter/remain unlawfully when —
        a) intends to cause annoyance/injury/damage, OR
        b) notice against entering given (verbal, posting, fencing), OR
        c) reckless as to whether presence causes fear.
        Private security: get the property agent authorization on file,
        issue documented warning, then enforcement on return.
        Class B misd. in a dwelling; otherwise infraction/Class C.
        """),
        ("ref_dui", "DUI — UT 41-6a-502", """
        Per se limit: .05 g/dL BAC (Utah) — lowest in the nation.
        Metabolite DUI: 41-6a-517. Actual physical control counts.
        FSTs: HGN (6 clues) • Walk & Turn (8) • One-Leg Stand (4).
        15-min observation before breath test (use toolkit timer).
        Implied consent admonition before chemical test refusal.
        Under 21: Not-a-Drop (41-6a-530).
        """),
        ("ref_dv", "DV Lethality Screen", """
        High-risk indicators (any YES → connect victim with advocate):
        1) Threats to kill victim/children  2) Access to firearms
        3) Strangulation history  4) Jealous/controlling escalation
        5) Recent separation  6) Unemployment  7) Threats of suicide
        8) Weapon used in prior incident.
        UT 77-36: mandatory arrest on probable cause of DV assault;
        cite-and-release prohibited for DV offenses.
        """),
        ("ref_search", "Warrantless Search Quick-Ref", """
        Exceptions: consent (voluntary, scope-limited) • search incident to
        arrest (person + reach area; vehicles per Gant: unsecured arrestee or
        evidence of offense of arrest) • plain view (lawful vantage, apparent)
        • automobile (PC + readily mobile) • exigency (hot pursuit, destruction
        of evidence, emergency aid) • inventory (standard policy, impound).
        When in doubt: secure the scene, get the warrant.
        """),
        ("ref_juvenile", "Juvenile Contacts", """
        UT 80-6: minors require parent/guardian notification on custody.
        Questioning: minor + friendly adult present advisory recommended.
        Status offenses (curfew, runaway, truancy) → referral, not booking.
        Detention only for public-safety risk or court order.
        Document Miranda comprehension carefully for under-18 subjects.
        """),
        ("ref_mental", "Mental Health Crisis", """
        UT 26B-5-331 civil commitment: substantial danger to self/others.
        De-escalation: time + distance + cover. One voice. Slow it down.
        Ask: medications? case worker? prior hospitalizations?
        MCOT (Mobile Crisis Outreach Team) co-response available SLC metro.
        Document: statements, behavior, danger indicators — not diagnosis.
        """),
        ("ref_pc_aff", "PC Statement Skeleton", """
        1) Your identity, assignment, training relevant to this arrest.
        2) Time/date/location of incident.
        3) Facts observed FIRST-HAND (senses, in chronological order).
        4) Witness statements (named, what each said).
        5) Physical evidence located and where.
        6) Element-by-element match: facts → each element of the offense.
        7) Post-arrest statements (after Miranda noted).
        """),
        ("ref_evidence", "Evidence Handling", """
        Photograph in place → glove → package (paper for bio, bags for dry).
        Seal + initial + date every seam. One item per package.
        Chain: every transfer documented person-to-person.
        Firearms: render safe, note condition, never package loaded.
        Drugs: field-test only with PPE; fentanyl = no field handling.
        Digital: airplane mode, no browsing, faraday if available.
        """),
        ("ref_security_lic", "Sec. Officer Authority — UT 58-63", """
        Licensed armed/unarmed private security (R156-63).
        Authority: citizen's arrest (77-7-3, public offense in presence),
        detain on client property per trespass/shopkeeper rules,
        use-of-force per 76-2-4 (defense of person/property).
        NOT peace officers: no traffic stops on public roads, no warrant
        service. Always identify as SECURITY on contact.
        """),
        ("ref_shopkeeper", "Merchant Detention — UT 77-7-12", """
        Merchant/employee may detain in reasonable manner, reasonable time,
        on probable cause of retail theft to: verify ID, investigate,
        recover merchandise, summon peace officer.
        Document: items, concealment observed, recovery, total value
        (76-6-602 retail theft; value tiers set the charge level).
        """),
    ]
    private static var legalReference: [FieldTool] {
        legalCards.map { FieldTool(id: $0.0, title: $0.1, category: "LEGAL REFERENCE",
                                   action: .reference($0.2)) }
    }

    // ── 7. Codes & quick references ──
    private static let codeCards: [(String, String, String)] = [
        ("ref_10codes", "10-Codes", """
        10-4 Acknowledged      10-6 Busy            10-7 Out of service
        10-8 In service        10-9 Repeat          10-10 Fight in progress
        10-13 Officer needs help   10-15 Prisoner in custody
        10-19 Return to station    10-20 Location    10-23 On scene
        10-27 DL check         10-28 Registration   10-29 Wants/warrants
        10-31 Crime in progress    10-32 Person with gun
        10-50 Traffic crash    10-51 Tow needed     10-52 Ambulance needed
        10-55 DUI driver       10-56 Pedestrian DUI 10-57 Hit & run
        10-76 En route         10-78 Need assistance 10-97 Arrived
        10-99 Emergency — all units
        """),
        ("ref_phonetic", "Phonetic Alphabet", """
        A Adam     B Boy      C Charles  D David    E Edward
        F Frank    G George   H Henry    I Ida      J John
        K King     L Lincoln  M Mary     N Nora     O Ocean
        P Paul     Q Queen    R Robert   S Sam      T Tom
        U Union    V Victor   W William  X X-ray    Y Young
        Z Zebra
        NATO: Alfa Bravo Charlie Delta Echo Foxtrot Golf Hotel India
        Juliett Kilo Lima Mike November Oscar Papa Quebec Romeo
        Sierra Tango Uniform Victor Whiskey X-ray Yankee Zulu
        """),
        ("ref_signal_codes", "Signal / Code Levels", """
        Code 1 — Routine, no lights/siren
        Code 2 — Urgent, lights only where authorized
        Code 3 — Emergency, lights and siren
        Code 4 — No further assistance needed
        Code 5 — Stakeout, marked units stay clear
        Code 6 — Out for investigation
        Code 7 — Meal break
        """),
        ("ref_aamva_restrict", "DL Restriction Codes", """
        A Corrective lenses        B Outside mirror
        C Daytime driving only     D Automatic transmission
        E No manual transmission   F Hearing aid required
        G Limit to employment      I Limited—other
        J Other                    K CDL intrastate only
        L No air-brake vehicles    M No Class A passenger veh.
        N No Class A/B passenger   O No tractor-trailer
        V Medical variance         Z No full air brakes
        """),
        ("ref_aamva_endorse", "DL Endorsement Codes", """
        H Hazardous materials      L Air-brake vehicles
        N Tank vehicles            P Passenger vehicles
        S School bus               T Double/triple trailers
        X Tank + hazmat combined   M Motorcycle (where coded)
        """),
        ("ref_dl_class", "DL Class Codes", """
        A — Combination vehicles GCWR 26,001+ (towed 10k+)
        B — Single vehicle 26,001+ GVWR
        C — Regular operator (Utah standard)
        D — Regular operator (most states' standard class)
        M — Motorcycle
        CDL classes carry the same letters with commercial privileges.
        """),
        ("ref_body_codes", "Eye / Hair Codes (NCIC)", """
        EYES: BLK Black  BLU Blue  BRO Brown  GRN Green  GRY Gray
              HAZ Hazel  MAR Maroon  MUL Multicolor  PNK Pink  XXX Unk
        HAIR: BAL Bald  BLK Black  BLN Blond  BRO Brown  GRY Gray
              RED Red  SDY Sandy  WHI White  XXX Unknown
        Height in feet-inches (511 = 5'11"), weight in lbs.
        """),
        ("ref_plates_ut", "Utah Plate Formats", """
        Standard passenger: A12 3BC (letter-number mix, Delicate Arch)
        Older: 123 ABC • Ski Utah: 1ABC2 styles
        Apportioned (IRP): starts 1xxxxA series
        EX exempt government • LE livery • TC temp commercial
        Temp permit: paper, 45-day, large print date.
        Adjacent: ID 1A B1234 • NV ###-A## • AZ ABC1234 • CO ABC-123
        • WY county# + #### .
        """),
        ("ref_vin", "VIN Quick Decode", """
        17 chars. Position 1-3: world manufacturer (1/4/5 = USA, J = Japan,
        K = Korea, W = Germany, 3 = Mexico, 2 = Canada).
        Position 9: check digit. Position 10: model year —
        2020=L 2021=M 2022=N 2023=P 2024=R 2025=S 2026=T.
        Position 11: plant. 12-17: serial.
        No I, O, or Q ever appear in a VIN.
        """),
        ("ref_speed_fines", "UT Speed Fine Schedule (typ.)", """
        1-10 over: $120        11-15 over: $150
        16-20 over: $200       21-25 over: $270
        26-30 over: $370       31+ over: mandatory court
        School zone & construction: enhanced (roughly doubled).
        Reckless 41-6a-528: Class B misd.
        Street racing 41-6a-606: Class B + impound.
        """),
        ("ref_drug_sched", "Controlled Substance Tiers", """
        I — heroin, LSD, MDMA, psilocybin (no accepted medical use)
        II — fentanyl, meth, cocaine, oxycodone
        III — ketamine, anabolic steroids, buprenorphine
        IV — alprazolam, diazepam, tramadol
        V — low-codeine preparations
        UT 58-37-8: possession Class A misd (I/II) first offense;
        distribution = felony tiers. Marijuana: medical card or 26B rules.
        """),
        ("ref_radio_lingo", "Radio Brevity", """
        AFFIRM / NEGATIVE — yes / no
        COPY — understood            DIRECT — en route straight there
        STAND BY — wait              GO AHEAD — send your traffic
        BREAK BREAK — priority interrupt
        EMERGENCY TRAFFIC — clear the channel
        CODE 4 — scene secure        STATUS CHECK — are you OK?
        Plain speech beats codes when seconds matter.
        """),
        ("ref_hazmat", "HAZMAT Placard Basics", """
        1 Explosives  2 Gases  3 Flammable liquid  4 Flammable solid
        5 Oxidizer  6 Toxic  7 Radioactive  8 Corrosive  9 Misc.
        UN number on placard → ERG orange guide pages.
        Initial isolation: 50m small spill / 300m large / 800m fire+explosive.
        Approach upwind & uphill. Binoculars before boots.
        """),
        ("ref_nato_time", "Military Time / Date-Time", """
        0000 midnight … 1200 noon … 2300 = 11 PM.
        Convert PM: add 12. Zulu = UTC; Mountain = Z-7 (MDT) / Z-6? No —
        MST = Z-7, MDT = Z-6. Log local; note zone on interstate paper.
        Date-time group: DDHHMMZ MON YY (e.g. 111945Z JUN 26).
        """),
    ]
    private static var codesReference: [FieldTool] {
        codeCards.map { FieldTool(id: $0.0, title: $0.1, category: "CODES & REFERENCE",
                                  action: .reference($0.2)) }
    }
}
