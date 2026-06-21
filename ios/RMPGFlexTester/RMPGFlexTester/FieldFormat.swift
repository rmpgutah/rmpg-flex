import Foundation

// Plain-English / professional law-enforcement formatting for record output.
// Backend rows come back as snake_case keys with coded values (status
// 'on_scene', priority 'P1', dob '1980-01-01T00:00:00Z'). This turns them
// into the kind of labels and phrasing an officer expects on an MDT —
// "Date of Birth", "On Scene (10-23)", "01/01/1980". Pure + testable.
enum FieldFormat {

    // ── Field labels — professional names for common record keys ──
    private static let labels: [String: String] = [
        "dob": "Date of Birth", "date_of_birth": "Date of Birth",
        "dl_number": "Driver License #", "dl_state": "License State",
        "dl_class": "License Class", "dl_expiry": "License Expires",
        "ssn": "SSN", "fbi_number": "FBI #", "sid_number": "State ID #",
        "first_name": "First Name", "middle_name": "Middle Name", "last_name": "Last Name",
        "person_name": "Name", "full_name": "Name", "aka": "Also Known As", "aliases": "Aliases",
        "incident_type": "Call Type", "call_type": "Call Type", "call_number": "Call #",
        "location_address": "Location", "location": "Location", "address": "Address",
        "cross_street": "Cross Street", "created_at": "Created", "updated_at": "Updated",
        "warrant_number": "Warrant #", "charge_description": "Charge",
        "bail_amount": "Bail", "bond_amount": "Bond", "issuing_court": "Issuing Court",
        "issuing_agency": "Issuing Agency", "issued_date": "Issued", "expires_at": "Expires",
        "plate_number": "License Plate", "plate_state": "Plate State", "vin": "VIN",
        // `registered_owner` is the human label; the `owner_person_id` FK is intentionally
        // omitted from this map so it never renders as "Owner (Person #)" in the UI.
        // FieldToolkitView already filters `_id`-suffix keys as FK noise; this stays
        // consistent with that rule. If the field-toolkit needs to surface the owner,
        // resolve owner_person_id → registered_owner_name server-side.
        "registered_owner": "Registered Owner",
        "make": "Make", "model": "Model", "year": "Year", "color": "Color",
        "stolen_status": "Stolen Status", "ncic_entry_number": "NCIC Entry #",
        "citation_number": "Citation #", "violation_description": "Violation",
        "fine_amount": "Fine", "court_date": "Court Date",
        "incident_number": "Incident #", "case_number": "Case #",
        "is_sex_offender": "Sex Offender", "gang_affiliation": "Gang Affiliation",
        "caution_flags": "Caution Flags", "officer_safety_caution": "Officer Safety",
        "weapons_involved": "Weapons", "felony_in_progress": "Felony in Progress",
        "domestic_violence": "Domestic Violence", "phone": "Phone", "email": "Email",
        "height": "Height", "weight": "Weight", "eye_color": "Eyes", "hair_color": "Hair",
        "sex": "Sex", "gender": "Sex", "race": "Race", "status": "Status", "priority": "Priority",
        "disposition": "Disposition", "narrative": "Narrative", "notes": "Notes",
        "officer_name": "Officer", "officer_id": "Officer #", "unit_call_sign": "Unit",
        "registration_status": "Registration Status", "compliance_status": "Compliance",
        "risk_level": "Risk Level", "offense": "Offense", "fi_number": "FI #",
    ]

    /// snake_case / unknown key → professional label. Falls back to Title Case.
    static func label(_ key: String) -> String {
        if let l = labels[key.lowercased()] { return l }
        return key.split(whereSeparator: { $0 == "_" || $0 == "-" })
            .map { word -> String in
                let w = String(word)
                // Keep common initialisms upper.
                if ["id", "vin", "dl", "dob", "ssn", "fbi", "ncic", "sid", "ori", "le"].contains(w.lowercased()) {
                    return w.uppercased()
                }
                return w.prefix(1).uppercased() + w.dropFirst().lowercased()
            }
            .joined(separator: " ")
    }

    // ── Coded value decoders ────────────────────────────────────
    private static let unitStatus: [String: String] = [
        "available": "Available (10-8)", "enroute": "En Route", "en_route": "En Route",
        "on_scene": "On Scene (10-23)", "onscene": "On Scene (10-23)", "busy": "Busy (10-6)",
        "dispatched": "Dispatched", "out_of_service": "Out of Service (10-7)",
        "off_duty": "Off Duty", "on_patrol": "On Patrol", "in_service": "In Service",
    ]
    private static let callStatus: [String: String] = [
        "pending": "Pending", "active": "Active", "closed": "Closed", "cleared": "Cleared",
        "cancelled": "Cancelled", "canceled": "Cancelled", "open": "Open", "complete": "Complete",
    ]
    private static let sexCode: [String: String] = [
        "m": "Male", "f": "Female", "x": "Non-binary/Unspecified",
        "1": "Male", "2": "Female", "9": "Unspecified",
    ]

    /// Decode a coded value for a given key into plain English.
    static func value(_ key: String, _ raw: Any?) -> String {
        guard let raw = raw else { return "—" }
        let s = "\(raw)".trimmingCharacters(in: .whitespaces)
        if s.isEmpty || s.lowercased() == "null" || s == "<null>" { return "—" }
        let k = key.lowercased()

        // Booleans / flag columns (0/1, true/false, is_*).
        if k.hasPrefix("is_") || k.hasSuffix("_caution") || ["weapons_involved", "felony_in_progress",
            "domestic_violence", "injuries_reported", "alcohol_involved", "drugs_involved",
            "juvenile_involved", "mental_health_crisis", "k9_requested", "ems_requested"].contains(k) {
            if s == "1" || s.lowercased() == "true" { return "Yes" }
            if s == "0" || s.lowercased() == "false" { return "No" }
        }
        // Status (unit vs call) — try both maps.
        if k == "status" || k.hasSuffix("_status") {
            if let v = unitStatus[s.lowercased()] ?? callStatus[s.lowercased()] { return v }
        }
        // Priority P1..P4 or 1..4.
        if k == "priority" {
            let n = s.replacingOccurrences(of: "p", with: "", options: .caseInsensitive)
            if let i = Int(n), (1...5).contains(i) { return "Priority \(i)" }
        }
        if k == "sex" || k == "gender" { if let v = sexCode[s.lowercased()] { return v } }
        // Money.
        if k.contains("amount") || k.contains("fine") || k.contains("bail") || k.contains("bond") {
            if let n = Double(s) { return String(format: "$%.2f", n) }
        }
        // Dates / timestamps → MM/DD/YYYY (HH:MM if present).
        if k.contains("date") || k.hasSuffix("_at") || k == "dob" || k.contains("expir") || k.contains("issued") {
            if let pretty = prettyDate(s) { return pretty }
        }
        // Generic snake_case enum (traffic_stop → Traffic Stop), but leave
        // free text (names, narratives, addresses) untouched.
        if isLikelyCode(s) { return titleCase(s) }
        return s
    }

    // ── Helpers ─────────────────────────────────────────────────
    private static func isLikelyCode(_ s: String) -> Bool {
        s.contains("_") && !s.contains(" ") && s.count < 40
            && s.allSatisfy { $0.isLetter || $0 == "_" || $0.isNumber }
    }
    private static func titleCase(_ s: String) -> String {
        s.split(separator: "_").map { $0.prefix(1).uppercased() + $0.dropFirst().lowercased() }.joined(separator: " ")
    }

    static func prettyDate(_ s: String) -> String? {
        let datePart = String(s.prefix(10))
        let parts = datePart.split(separator: "-")
        guard parts.count == 3, let y = Int(parts[0]), let m = Int(parts[1]), let d = Int(parts[2]),
              (1...12).contains(m), (1...31).contains(d) else { return nil }
        let mmddyyyy = String(format: "%02d/%02d/%04d", m, d, y)
        // Append HH:MM if the string carries a real (non-midnight) time —
        // a midnight stamp is how a date-only value (DOB, issue date) is stored.
        if s.count >= 16, let tIdx = s.range(of: "T")?.upperBound ?? (s.count > 11 ? s.index(s.startIndex, offsetBy: 11) : nil) {
            let time = String(s[tIdx...]).prefix(5)
            if time.contains(":") && time != "00:00" { return "\(mmddyyyy) \(time)" }
        }
        return mmddyyyy
    }
}
