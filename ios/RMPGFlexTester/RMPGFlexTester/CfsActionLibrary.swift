import Foundation

// The CFS Action Bus library — 100+ named Calls-For-Service actions an officer
// can run on a call from the phone. Each action carries a `verb` + `params` that
// the unified backend endpoint (POST /api/dispatch/calls/:id/action) executes as
// a real mutation (status / priority / disposition / units / hazards / narrative
// / timers / notifications / queries / links). Same vocabulary works phone ↔ MDT
// ↔ desktop ↔ D1 — that's the integration win. Foundation-only → unit-tested.

struct CfsAction: Identifiable, Equatable {
    let id: String
    let label: String
    let category: String
    let verb: String
    let params: [String: String]
    var confirm: Bool = false
    var needsInput: Bool = false   // prompt for free text (→ params["text"])
    var mdt: Bool = false          // also push to the in-car MDT
}

enum CfsActionLibrary {
    /// All known verbs (must match the backend planner's CFS_VERBS).
    static let verbs: Set<String> = [
        "status", "priority", "disposition", "unit", "resource",
        "link", "flag", "narrative", "timer", "notify", "query",
    ]

    private static func mk(_ category: String, _ verb: String,
                           _ items: [(String, String, [String: String])],
                           confirm: Bool = false, mdt: Bool = false) -> [CfsAction] {
        items.map { CfsAction(id: $0.0, label: $0.1, category: category, verb: verb,
                              params: $0.2, confirm: confirm, mdt: mdt) }
    }

    static let all: [CfsAction] =
        mk("Status", "status", [
            ("st_pending", "Pending", ["to": "pending"]),
            ("st_dispatched", "Dispatched", ["to": "dispatched"]),
            ("st_enroute", "En Route", ["to": "enroute"]),
            ("st_onscene", "On Scene", ["to": "onscene"]),
            ("st_cleared", "Clear", ["to": "cleared"]),
            ("st_closed", "Close", ["to": "closed"]),
            ("st_cancelled", "Cancel", ["to": "cancelled"], ),
            ("st_archived", "Archive", ["to": "archived"]),
        ])
        + mk("Priority", "priority", [
            ("pr_p1", "Set P1", ["to": "1"]),
            ("pr_p2", "Set P2", ["to": "2"]),
            ("pr_p3", "Set P3", ["to": "3"]),
            ("pr_p4", "Set P4", ["to": "4"]),
            ("pr_up", "Escalate", ["delta": "-1"]),
            ("pr_down", "De-escalate", ["delta": "1"]),
        ])
        + mk("Units", "unit", [
            ("un_add", "Add Unit", ["op": "add"]),
            ("un_remove", "Remove Unit", ["op": "remove"]),
            ("un_primary", "Set Primary Unit", ["op": "set"]),
            ("un_cover", "Add Cover Unit", ["op": "add", "note": "Cover unit added"]),
            ("un_stage", "Stage Units", ["op": "add", "note": "Units staged on perimeter"]),
        ])
        + mk("Resources", "resource", [
            ("rs_backup", "Request Backup", ["resource": "Backup"]),
            ("rs_2units", "Request 2 Units", ["resource": "Two units"]),
            ("rs_supervisor", "Request Supervisor", ["resource": "Supervisor"]),
            ("rs_k9", "Request K9", ["resource": "K9"]),
            ("rs_ems", "Request EMS", ["resource": "EMS"]),
            ("rs_fire", "Request Fire", ["resource": "Fire"]),
            ("rs_tow", "Request Tow", ["resource": "Tow"]),
            ("rs_swat", "Request SWAT", ["resource": "SWAT"]),
            ("rs_air", "Request Air Unit", ["resource": "Air unit"]),
            ("rs_detective", "Request Detective", ["resource": "Detective"]),
            ("rs_csi", "Request CSI", ["resource": "CSI"]),
            ("rs_translator", "Request Translator", ["resource": "Translator"]),
            ("rs_chaplain", "Request Chaplain", ["resource": "Chaplain"]),
            ("rs_animal", "Request Animal Control", ["resource": "Animal Control"]),
            ("rs_utility", "Request Utility Co", ["resource": "Utility company"]),
            ("rs_coroner", "Request Coroner", ["resource": "Coroner"]),
        ], mdt: true)
        + mk("Disposition", "disposition", [
            ("ds_report", "Report Taken", ["code": "RPT", "label": "Report taken"]),
            ("ds_arrest", "Arrest Made", ["code": "ARR", "label": "Arrest made"]),
            ("ds_citation", "Citation Issued", ["code": "CIT", "label": "Citation issued"]),
            ("ds_warning", "Warning Given", ["code": "WARN", "label": "Warning given"]),
            ("ds_goa", "Gone on Arrival", ["code": "GOA", "label": "Gone on arrival"]),
            ("ds_utl", "Unable to Locate", ["code": "UTL", "label": "Unable to locate"]),
            ("ds_unfounded", "Unfounded", ["code": "UNF", "label": "Unfounded"]),
            ("ds_civil", "Civil Matter", ["code": "CIV", "label": "Civil matter"]),
            ("ds_referred", "Referred", ["code": "REF", "label": "Referred to other agency"]),
            ("ds_transport", "Transported", ["code": "TRN", "label": "Transported"]),
            ("ds_noaction", "No Action", ["code": "NA", "label": "No action required"]),
            ("ds_assist", "Assist Rendered", ["code": "AST", "label": "Assist rendered"]),
            ("ds_fi", "FI Completed", ["code": "FI", "label": "Field interview completed"]),
            ("ds_property", "Property Recovered", ["code": "PROP", "label": "Property recovered"]),
            ("ds_juvenile", "Juvenile Custody", ["code": "JUV", "label": "Juvenile taken into custody"]),
            ("ds_mental", "Mental Health Hold", ["code": "MH", "label": "Mental health hold"]),
            ("ds_handled", "Handled by Officer", ["code": "HBO", "label": "Handled by officer"]),
            ("ds_dup", "Duplicate Call", ["code": "DUP", "label": "Duplicate call"]),
        ])
        + mk("Hazards", "flag", [
            ("hz_weapons", "Weapons", ["flag": "Weapons present"]),
            ("hz_mental", "Mental / EDP", ["flag": "Mental health / EDP"]),
            ("hz_violent", "Violent Subject", ["flag": "Violent subject"]),
            ("hz_officer", "Officer Safety", ["flag": "Officer safety caution"]),
            ("hz_dog", "Aggressive Dog", ["flag": "Aggressive dog"]),
            ("hz_drugs", "Narcotics", ["flag": "Narcotics involved"]),
            ("hz_gang", "Gang Activity", ["flag": "Gang activity"]),
            ("hz_bio", "Biohazard", ["flag": "Biohazard"]),
            ("hz_fire", "Fire / Explosive", ["flag": "Fire / explosive risk"]),
            ("hz_environ", "Environmental", ["flag": "Environmental hazard"]),
            ("hz_barricade", "Barricaded", ["flag": "Barricaded subject"]),
            ("hz_clear", "Clear Hazard", ["flag": "All hazards", "clear": "1"]),
        ], mdt: true)
        + mk("Notes", "narrative", [
            ("nt_sizeup", "Size-Up Complete", ["text": "Size-up complete, scene assessed"]),
            ("nt_secure", "Scene Secure", ["text": "Scene secured"]),
            ("nt_notsecure", "Scene NOT Secure", ["text": "⚠ Scene NOT secure"]),
            ("nt_contact", "Contact Made", ["text": "Contact made with parties"]),
            ("nt_nocontact", "No Contact", ["text": "No contact / no answer"]),
            ("nt_rp_advised", "RP Advised", ["text": "Reporting party advised"]),
            ("nt_area_check", "Area Check", ["text": "Area check conducted"]),
            ("nt_premise_clear", "Premises Checked", ["text": "Premises checked and clear"]),
            ("nt_followup", "Follow-Up Needed", ["text": "Follow-up required"]),
        ])
        + [CfsAction(id: "nt_custom", label: "Add Note…", category: "Notes", verb: "narrative",
                     params: [:], needsInput: true)]
        + mk("Timers", "timer", [
            ("tm_welfare", "Welfare Check Timer", ["kind": "welfare", "label": "Welfare check timer started"]),
            ("tm_traffic", "Traffic Stop Timer", ["kind": "traffic", "label": "Traffic stop timer started"]),
            ("tm_foot", "Foot Pursuit", ["kind": "foot", "label": "Foot pursuit"]),
            ("tm_vehicle", "Vehicle Pursuit", ["kind": "vehicle", "label": "Vehicle pursuit"]),
            ("tm_signal", "Signal Check", ["kind": "signal", "label": "Signal check requested"]),
            ("tm_perimeter", "Perimeter Set", ["kind": "perimeter", "label": "Perimeter established"]),
            ("tm_extend", "Extend Timer", ["kind": "extend", "label": "Timer extended"]),
            ("tm_cancel", "Cancel Timer", ["kind": "cancel", "label": "Timer cancelled"]),
        ], mdt: true)
        + mk("Notify", "notify", [
            ("nf_supervisor", "Notify Supervisor", ["target": "Supervisor"]),
            ("nf_all", "Notify All Units", ["target": "All units"]),
            ("nf_bolo", "Broadcast BOLO", ["target": "BOLO broadcast"]),
            ("nf_oncall", "Page On-Call", ["target": "On-call command"]),
            ("nf_adjacent", "Alert Adjacent Agency", ["target": "Adjacent agency"]),
            ("nf_dispatch", "Notify Dispatch", ["target": "Dispatch"]),
            ("nf_command", "Notify Command", ["target": "Command staff"]),
            ("nf_mutualaid", "Request Mutual Aid", ["target": "Mutual aid"]),
            ("nf_pio", "Notify PIO", ["target": "Public information officer"]),
            ("nf_records", "Notify Records", ["target": "Records"]),
        ], mdt: true)
        + mk("Queries", "query", [
            ("qy_plate", "Run Plate", ["kind": "plate", "label": "Plate query requested"]),
            ("qy_person", "Run Person", ["kind": "person", "label": "Person query requested"]),
            ("qy_dl", "Run DL", ["kind": "dl", "label": "Driver-license query"]),
            ("qy_vin", "Run VIN", ["kind": "vin", "label": "VIN query"]),
            ("qy_premise", "Premise History", ["kind": "premise", "label": "Premise history pulled"]),
            ("qy_nearby_units", "Nearby Units", ["kind": "nearby_units", "label": "Nearby units checked"]),
            ("qy_nearby_calls", "Nearby Calls", ["kind": "nearby_calls", "label": "Nearby calls checked"]),
            ("qy_hazard", "Hazard Check", ["kind": "hazard", "label": "Hazard check"]),
            ("qy_bolo", "BOLO Check", ["kind": "bolo", "label": "BOLO check"]),
            ("qy_warrant", "Warrant Check", ["kind": "warrant", "label": "Warrant check"]),
        ])
        + mk("Links", "link", [
            ("lk_person", "Link Person", ["entity_type": "person"]),
            ("lk_vehicle", "Link Vehicle", ["entity_type": "vehicle"]),
            ("lk_business", "Link Business", ["entity_type": "business"]),
            ("lk_property", "Link Property", ["entity_type": "property"]),
            ("lk_warrant", "Link Warrant", ["entity_type": "warrant"]),
            ("lk_related", "Link Related Call", ["entity_type": "call"]),
        ])

    /// Categories in display order.
    static let categories: [String] = {
        var seen = Set<String>(); var out: [String] = []
        for a in all where !seen.contains(a.category) { seen.insert(a.category); out.append(a.category) }
        return out
    }()

    static func inCategory(_ c: String) -> [CfsAction] { all.filter { $0.category == c } }

    static func search(_ q: String) -> [CfsAction] {
        let t = q.trimmingCharacters(in: .whitespaces).lowercased()
        guard !t.isEmpty else { return all }
        return all.filter { $0.label.lowercased().contains(t) || $0.category.lowercased().contains(t) }
    }
}
