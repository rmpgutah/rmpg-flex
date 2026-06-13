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
    case warrantSearch(byNumber: Bool)
    case fieldInterview
    case syncQueue
    case fieldPhoto
    case newBolo
    case fuelPurchase
    // FIELD CALC — pure on-device computation (FieldCalc.swift)
    case phonetic
    case skidSpeed
    case sunTimes
    case distanceTo
    case markPoint
    case unitConvert
    case scratchpad
    // Advanced FIELD CALC (single compact text input, parsed in-app)
    case bac            // "drinks weight sex hours" → BAC
    case stopDistance   // "mph [drag]" → reaction+braking+total
    case criticalSpeed  // "radiusFt [drag]" → min speed
    case gps2Speed      // "feet seconds" → mph
    case eta            // "miles mph" → time + arrival
    case gcs            // "eye verbal motor" → GCS total
    case ageCalc        // "YYYY-MM-DD" → age + days
    case dms            // "lat lon" → degrees-minutes-seconds
    case fineEst        // "mphOver" → fine
    case sumMoney       // "120 45.50 1200" → total
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
        "TIMERS & UTILITIES", "FIELD CALC", "MEDICAL & RESCUE",
        "LEGAL REFERENCE", "CODES & REFERENCE",
    ]

    static let tools: [FieldTool] = selfInitiated + lookups + unitStatus
        + clearCall + utilities + fieldCalc + medicalReference
        + legalReference + codesReference

    // ── Field calculators (pure, on-device — work with zero coverage) ──
    private static let fieldCalc: [FieldTool] = [
        FieldTool(id: "fc_phonetic", title: "Phonetic Speller", category: "FIELD CALC", action: .phonetic),
        FieldTool(id: "fc_skid", title: "Skid Marks → Speed", category: "FIELD CALC", action: .skidSpeed),
        FieldTool(id: "fc_stop", title: "Stopping Distance", category: "FIELD CALC", action: .stopDistance),
        FieldTool(id: "fc_critical", title: "Yaw → Critical Speed", category: "FIELD CALC", action: .criticalSpeed),
        FieldTool(id: "fc_gps2speed", title: "Speed from Distance/Time", category: "FIELD CALC", action: .gps2Speed),
        FieldTool(id: "fc_eta", title: "ETA (miles @ mph)", category: "FIELD CALC", action: .eta),
        FieldTool(id: "fc_bac", title: "BAC Estimate (Widmark)", category: "FIELD CALC", action: .bac),
        FieldTool(id: "fc_fine", title: "Speeding Fine Estimate", category: "FIELD CALC", action: .fineEst),
        FieldTool(id: "fc_gcs", title: "Glasgow Coma Scale", category: "FIELD CALC", action: .gcs),
        FieldTool(id: "fc_age", title: "Age / Date Math", category: "FIELD CALC", action: .ageCalc),
        FieldTool(id: "fc_dms", title: "Coords → Deg/Min/Sec", category: "FIELD CALC", action: .dms),
        FieldTool(id: "fc_sum", title: "Restitution / Property Total", category: "FIELD CALC", action: .sumMoney),
        FieldTool(id: "fc_sun", title: "Sunrise / Sunset (here)", category: "FIELD CALC", action: .sunTimes),
        FieldTool(id: "fc_dist", title: "Distance to Coordinates", category: "FIELD CALC", action: .distanceTo),
        FieldTool(id: "fc_mark", title: "Mark Point / Measure", category: "FIELD CALC", action: .markPoint),
        FieldTool(id: "fc_convert", title: "Unit Converter (cm/kg/°/$)", category: "FIELD CALC", action: .unitConvert),
    ]

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
        ("dui_investigation", "P1", "DUI Investigation", "Impaired driver investigation"),
        ("disturbance", "P2", "Disturbance", "Disturbance / noise complaint"),
        ("fight", "P1", "Fight in Progress", "Physical altercation in progress"),
        ("shots_fired", "P1", "Shots Fired", "Reported gunfire — proceed with caution"),
        ("medical_assist", "P1", "Medical Assist", "Medical emergency — EMS requested"),
        ("traffic_control", "P3", "Traffic Control", "Directing traffic / road closure"),
        ("found_property", "P4", "Found Property", "Property found / turned in"),
        ("animal_complaint", "P3", "Animal Complaint", "Animal at large / bite / nuisance"),
        ("abandoned_vehicle", "P4", "Abandoned Vehicle", "Abandoned/derelict vehicle tag"),
        ("civil_standby", "P3", "Civil Standby", "Keep-the-peace civil standby"),
        ("vin_verification", "P4", "VIN Verification", "VIN inspection / verification"),
        ("prisoner_transport", "P2", "Prisoner Transport", "Custody transport in progress"),
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
                  action: .warrantSearch(byNumber: false)),
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
                  action: .lookup(path: "api/arrests/search", queryKey: "q", prompt: "Subject name")),
        FieldTool(id: "lk_citations", title: "Citation History", category: "LOOKUPS",
                  action: .lookup(path: "api/citations", queryKey: "search", prompt: "Name or citation #")),
        FieldTool(id: "lk_evidence", title: "Evidence Search", category: "LOOKUPS",
                  action: .lookup(path: "api/records/evidence", queryKey: "search", prompt: "Case # or description")),
        FieldTool(id: "lk_cases", title: "Case Search", category: "LOOKUPS",
                  action: .lookup(path: "api/cases", queryKey: "search", prompt: "Case # or subject")),
        FieldTool(id: "lk_my_unit", title: "My Unit Detail", category: "LOOKUPS",
                  action: .lookup(path: "api/dispatch/duty/me", queryKey: nil, prompt: nil)),
        FieldTool(id: "lk_fleet", title: "Fleet Vehicles", category: "LOOKUPS",
                  action: .lookup(path: "api/fleet", queryKey: nil, prompt: nil)),
        FieldTool(id: "lk_announcements", title: "Announcements", category: "LOOKUPS",
                  action: .lookup(path: "api/announcements", queryKey: nil, prompt: nil)),
        FieldTool(id: "lk_recent_calls", title: "Recent Calls (Today)", category: "LOOKUPS",
                  action: .lookup(path: "api/dispatch/calls?limit=25", queryKey: nil, prompt: nil)),
        FieldTool(id: "lk_warrant_num", title: "Warrant Check (Warrant #)", category: "LOOKUPS",
                  action: .warrantSearch(byNumber: true)),
        FieldTool(id: "lk_reg_owner", title: "Registered Owner (Plate)", category: "LOOKUPS",
                  action: .lookup(path: "api/records/vehicles/plate-lookup", queryKey: "plate", prompt: "License plate")),
        FieldTool(id: "lk_veh_bolo", title: "Vehicle BOLO Check", category: "LOOKUPS",
                  action: .lookup(path: "api/records/vehicles/bolo-check", queryKey: "plate", prompt: "License plate")),
        FieldTool(id: "lk_person_q", title: "Person Quick Search", category: "LOOKUPS",
                  action: .lookup(path: "api/records/persons/search", queryKey: "q", prompt: "Name or phone")),
        FieldTool(id: "lk_veh_q", title: "Vehicle VIN/Plate Search", category: "LOOKUPS",
                  action: .lookup(path: "api/records/vehicles/search", queryKey: "q", prompt: "Plate or VIN")),
        FieldTool(id: "lk_expired_reg", title: "Expired Registrations", category: "LOOKUPS",
                  action: .lookup(path: "api/records/vehicles/alerts/expired-registration", queryKey: nil, prompt: nil)),
        FieldTool(id: "lk_jail", title: "Jail Bookings", category: "LOOKUPS",
                  action: .lookup(path: "api/intel/jail/bookings", queryKey: nil, prompt: nil)),
        FieldTool(id: "lk_intel", title: "Intel Federated Search", category: "LOOKUPS",
                  action: .lookup(path: "api/intel/search", queryKey: "q", prompt: "Name / plate / phone / keyword")),
        FieldTool(id: "lk_watchlist", title: "Active Watchlist", category: "LOOKUPS",
                  action: .lookup(path: "api/intel/watchlist", queryKey: nil, prompt: nil)),
        FieldTool(id: "lk_recordings", title: "My Recordings", category: "LOOKUPS",
                  action: .lookup(path: "api/intel/recordings", queryKey: nil, prompt: nil)),
        FieldTool(id: "lk_my_photos", title: "Field Photos", category: "LOOKUPS",
                  action: .lookup(path: "api/field-photos", queryKey: nil, prompt: nil)),
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
        FieldTool(id: "ut_scratch", title: "Call Scratchpad", category: "TIMERS & UTILITIES",
                  action: .scratchpad),
        FieldTool(id: "ut_fi", title: "New FI Card", category: "TIMERS & UTILITIES",
                  action: .fieldInterview),
        FieldTool(id: "ut_sync", title: "Sync Offline Queue", category: "TIMERS & UTILITIES",
                  action: .syncQueue),
        FieldTool(id: "ut_photo", title: "Evidence Photo", category: "TIMERS & UTILITIES",
                  action: .fieldPhoto),
        FieldTool(id: "ut_bolo", title: "Issue BOLO", category: "TIMERS & UTILITIES",
                  action: .newBolo),
        FieldTool(id: "ut_fuel", title: "Log Fuel Purchase", category: "TIMERS & UTILITIES",
                  action: .fuelPurchase),
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
        (legalCards + legalCardsExtra).map { FieldTool(id: $0.0, title: $0.1, category: "LEGAL REFERENCE",
                                   action: .reference($0.2)) }
    }

    // ── 6b. Additional legal reference cards ──
    private static let legalCardsExtra: [(String, String, String)] = [
        ("ref_implied_consent", "Implied Consent — UT 41-6a-520", """
        Operating on UT roads = consent to chemical test on lawful DUI arrest.
        Officer chooses test (blood/breath/urine). Read the admonition:
        refusal → 18-mo license revocation (first), admissible at trial,
        and may be an enhancement. A warrant is still required to compel a
        blood draw over refusal (Birchfield/McNeely). Document the warning,
        the refusal words verbatim, and the time.
        """),
        ("ref_exigent", "Exigent Circumstances", """
        Warrantless entry justified by a true emergency:
        • Hot pursuit of a fleeing felon
        • Imminent destruction of evidence
        • Emergency aid (life/safety — render assistance)
        • Risk of escape / danger to others
        Scope is limited to the exigency; secure + get a warrant for more.
        Articulate the SPECIFIC facts known at entry, not hindsight.
        """),
        ("ref_consent_search", "Consent Search Limits", """
        Must be VOLUNTARY (totality of circumstances — no coercion/claim of
        authority). May be limited in scope and WITHDRAWN at any time.
        Third party may consent only over areas of common authority.
        Document: who consented, exact words, scope stated, withdrawal if any.
        A consent search of a phone needs consent to the DATA, not just the device.
        """),
        ("ref_inventory", "Vehicle Inventory / Impound", """
        Lawful impound + standardized agency policy = inventory search OK
        (not investigatory). Must follow the policy uniformly; a pretext
        inventory is invalid. List contents, note valuables, secure them.
        Closed containers per policy. Document policy basis + tow company.
        """),
        ("ref_knock", "Knock & Announce", """
        Announce authority + purpose, wait a reasonable time before forcing
        entry (≈15-20s absent exigency). No-knock requires specific judicial
        authorization or true exigency (destruction/danger). Note the time
        knocked, words used, and the wait before entry.
        """),
        ("ref_curtilage", "Curtilage vs Open Fields", """
        Curtilage (area of intimate home activity) = 4th Amendment protected:
        proximity to home, enclosure, use, steps to shield from view (Dunn).
        Open fields beyond curtilage = NOT protected. A driveway/porch in the
        normal approach path is an implied-license knock-and-talk zone.
        Drones/thermal over curtilage need a warrant (Kyllo).
        """),
        ("ref_brady", "Brady / Giglio", """
        Disclose EXCULPATORY + impeachment evidence to the prosecutor.
        Includes inconsistent statements, deals with witnesses, prior officer
        misconduct findings (Giglio material). When in doubt, turn it over —
        suppression voids convictions. Preserve ALL notes; don't destroy.
        """),
        ("ref_eyewitness", "Eyewitness ID Procedure", """
        Avoid suggestion. Lineups/photo arrays: fillers must match the
        description; tell witness the suspect may NOT be present; use a
        blind/blinded administrator; record confidence statement at ID in the
        witness's own words BEFORE feedback. Show-ups only when prompt + near
        scene, with a non-suggestive admonition. Document everything.
        """),
        ("ref_excited_delirium", "Agitated/Excited Delirium", """
        Medical EMERGENCY, not just resistance. Signs: extreme agitation,
        sweating, superhuman strength, incoherence, hyperthermia, pain
        immunity. After control: NO prone restraint — position on side,
        monitor breathing, EMS immediately. Restraint asphyxia risk is high.
        Treat as a person in crisis; document medical request + monitoring.
        """),
        ("ref_community_caretaking", "Community Caretaking", """
        Limited non-investigatory function: welfare checks, disabled vehicles,
        public safety hazards. Cannot be a pretext for an evidence search
        (Caniglia limits home entries). Actions must be reasonable and
        narrowly tied to the caretaking need. Document the safety basis.
        """),
        ("ref_stop_id", "Stop & Identify — UT 77-7-15", """
        A peace officer may stop a person in public on reasonable suspicion of
        a crime and demand NAME, address, and an explanation of actions.
        Utah has no statute compelling ID production beyond name in a Terry
        stop; refusal alone isn't a crime absent another offense. Security
        officers are NOT peace officers — no compelled-ID authority.
        """),
    ]

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
        (codeCards + codeCardsExtra).map { FieldTool(id: $0.0, title: $0.1, category: "CODES & REFERENCE",
                                  action: .reference($0.2)) }
    }

    // ── 7b. Additional code/reference cards ──
    private static let codeCardsExtra: [(String, String, String)] = [
        ("ref_color_codes", "NCIC Vehicle Color Codes", """
        BLK Black  BLU Blue  BRO Brown  GLD Gold  GRY Gray  GRN Green
        MAR Maroon ONG Orange PLE Purple RED Red  SIL Silver TAN Tan
        WHI White  YEL Yellow  TRQ Turquoise  CRM Cream/Ivory
        Two-tone: primary/secondary (e.g. WHI/BLU).
        """),
        ("ref_make_codes", "Common Vehicle Make Codes", """
        CHEV Chevrolet  FORD Ford  TOYT Toyota  HOND Honda  NISS Nissan
        DODG Dodge  JEEP Jeep  GMC GMC  RAM Ram  SUBA Subaru  HYUN Hyundai
        KIA Kia  VOLK VW  BMW BMW  MERZ Mercedes  TESL Tesla  CADI Cadillac
        CHRY Chrysler  BUIC Buick  LEXS Lexus  MAZD Mazda  ACUR Acura
        """),
        ("ref_weapon_codes", "Weapon Type Codes", """
        Handgun: PI pistol (semi-auto) · RE revolver
        Long gun: RI rifle · SG shotgun · AR assault-style rifle
        Other: KN knife/edged · BB blunt · CW chemical (OC) · TZ taser
        Document: make, model, caliber/gauge, serial, condition, round count.
        Render safe before packaging; never package loaded (76-10 weapon laws).
        """),
        ("ref_dre_categories", "DRE Drug Categories", """
        1 CNS Depressants (alcohol, benzos) — sluggish, low pulse
        2 CNS Stimulants (meth, cocaine) — restless, high pulse/BP
        3 Hallucinogens (LSD, psilocybin) — hallucinations, dilated
        4 Dissociative (PCP, ketamine) — nystagmus, blank stare
        5 Narcotic Analgesics (opioids) — pinpoint pupils, on the nod
        6 Inhalants — disorientation, residue/odor
        7 Cannabis — eyelid/body tremors, elevated pulse.
        """),
        ("ref_scars_marks", "Scars / Marks / Tattoos (SMT)", """
        Code: SC scar · TAT tattoo · PIERC piercing · AMP amputation
        · MARK birthmark · NEEDLE track marks
        Location codes: L/R + body part (e.g. TAT L ARM, SC R CHK).
        Document gang-significant ink (numbers, area codes, dots, teardrops),
        military/extremist symbols. Photograph in good light with scale.
        """),
        ("ref_disposition_codes", "Common Disposition Codes", """
        RTF Report taken     CIT Citation issued   WARN Warning
        ARR Arrest made      GOA Gone on arrival    UTL Unable to locate
        UNF Unfounded        CIV Civil matter       REF Referred agency
        AST Assistance rendered  CHK Checks OK       CBD Cancelled by disp.
        Match the call's clear code to the actual outcome — it drives stats.
        """),
        ("ref_priority_codes", "CAD Priority Levels", """
        P1 — Life threat / crime in progress / officer needs help (immediate)
        P2 — Urgent: just-occurred crime, in-progress no injury
        P3 — Routine: cold report, minor, schedule when free
        P4 — Self-initiated / administrative / non-urgent
        Roll lights-and-siren only as policy + priority authorize.
        """),
        ("ref_aircraft_lz", "Medevac LZ Setup", """
        100'×100' clear, firm, level (<8° slope). Clear wires/poles/debris.
        Mark corners (cones/lights — no loose items that can fly up).
        Approach/depart into wind; brief on obstacles + wind direction.
        Stay 50m back, NEVER approach until crew signals; approach from the
        FRONT in the pilot's view, never the tail rotor. Eye protection on.
        """),
    ]

    // ── 8. Medical & rescue quick-reference (tactical-casualty + crisis) ──
    private static let medicalCards: [(String, String, String)] = [
        ("med_march", "TCCC — MARCH", """
        M Massive hemorrhage — tourniquet HIGH & TIGHT, wound pack + pressure
        A Airway — position (recovery), chin-lift/jaw-thrust, NPA if trained
        R Respiration — seal sucking chest wounds (vented), watch for tension
        C Circulation — control remaining bleeds, check for shock
        H Hypothermia/Head — keep warm, protect spine, reassess.
        Treat the biggest killer first: BLOOD, then airway.
        """),
        ("med_tourniquet", "Tourniquet Application", """
        Place 2-3\" above the wound (NOT on a joint); high & tight if unsure.
        Tighten until bright-red bleeding STOPS + distal pulse gone.
        Note the TIME applied on the TQ (or skin). Do NOT loosen once set.
        A second TQ above the first if one doesn't control it. Pain is normal.
        Convert only by trained EMS. Mark 'T' + time on the patient's forehead.
        """),
        ("med_narcan", "Naloxone (Narcan) — Opioid OD", """
        Signs: pinpoint pupils, slow/absent breathing, blue lips, unresponsive.
        Give 4mg intranasal (half each nostril). Rescue breaths between doses.
        Repeat every 2-3 min if no response (up to available doses).
        It wears off in 30-90 min — OD can RETURN; EMS transport always.
        Recovery position once breathing. Document doses + times given.
        """),
        ("med_cpr", "CPR / AED (Adult)", """
        Unresponsive + no normal breathing → call it, start compressions.
        Rate 100-120/min, depth 2-2.4\", full recoil, center of chest.
        30:2 if trained on breaths; otherwise hands-only continuous.
        AED: power on, bare/dry chest, pads, clear, shock if advised,
        resume compressions immediately. Minimize interruptions (<10s).
        """),
        ("med_hemorrhage", "Bleeding Control (no TQ site)", """
        Junctional/torso bleed (can't tourniquet): WOUND PACK with gauze
        directly onto the bleeding vessel, pack tight, hold firm pressure
        3+ minutes, then pressure dressing. Don't peek early.
        Shock signs: pale, cold, clammy, fast weak pulse, anxiety, thirst.
        Lay flat, keep warm, rapid EMS — bleeding kills fastest.
        """),
        ("med_strangulation", "Strangulation Assessment (DV)", """
        HIGH lethality predictor in DV. Even without marks, internal injury
        is possible. Ask: loss of consciousness? incontinence? voice change,
        trouble swallowing, neck pain, vision changes, breathing difficulty?
        Photograph neck/eyes (petechiae). MANDATE EMS eval. UT: aggravated
        assault by strangulation is a felony (76-5-103). Document statements.
        """),
        ("med_heat_cold", "Heat / Cold Emergencies", """
        HEAT STROKE: hot/altered mental status — cooling NOW (shade, water,
        fan, ice to neck/armpits/groin), EMS. Heat exhaustion: rest, hydrate.
        HYPOTHERMIA: remove wet clothing, insulate, warm core, handle gently
        (rough handling → cardiac). 'Not dead until warm & dead.'
        """),
        ("med_seizure", "Seizure / Diabetic / Stroke", """
        SEIZURE: clear hazards, cushion head, time it, NOTHING in mouth,
        recovery position after, EMS if >5 min / repeated / first-time.
        DIABETIC low: confusion/sweating/combative — oral glucose if awake.
        STROKE (BE-FAST): Balance, Eyes, Face droop, Arm drift, Speech, Time —
        note LAST-KNOWN-WELL time, rapid transport.
        """),
        ("med_mh_hold", "Mental Health Hold — UT 26B-5", """
        Officer may take to a designated facility if reason to believe the
        person, due to mental illness, poses substantial danger to self/others
        or is gravely disabled. Document SPECIFIC behaviors + statements (not
        diagnosis). De-escalate: time, distance, cover, one voice. Request
        MCOT co-response. Secure weapons. Transport is custody — not arrest.
        """),
    ]
    private static var medicalReference: [FieldTool] {
        medicalCards.map { FieldTool(id: $0.0, title: $0.1, category: "MEDICAL & RESCUE",
                                     action: .reference($0.2)) }
    }
}
