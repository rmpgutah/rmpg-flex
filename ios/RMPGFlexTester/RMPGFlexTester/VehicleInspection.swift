import Foundation

// Pure DVIR (Driver-Vehicle Inspection Report) model for the full-scale shift
// pre/post-trip inspection. A comprehensive categorized catalog with 3-state
// items + defect severity, plus the out-of-service determination that gates
// going in service. Foundation-only → unit-tested. The SwiftUI form
// (VehicleInspectionForm) binds [InspectionLine]; the result/payload helpers
// here feed POST /api/fleet/:id/inspections.

enum InspItemStatus: String, CaseIterable {
    case pass, defect, na
    var label: String { switch self { case .pass: return "Pass"; case .defect: return "Defect"; case .na: return "N/A" } }
}

enum DefectSeverity: String, CaseIterable {
    case minor, major, critical
    var label: String { switch self { case .minor: return "Minor"; case .major: return "Major"; case .critical: return "OUT OF SERVICE" } }
    var oos: Bool { self == .critical }
}

struct InspectionLine: Identifiable, Equatable {
    let id: String
    let label: String
    let category: String
    let critical: Bool                 // safety-critical: a defect defaults to OOS severity
    var status: InspItemStatus = .pass
    var severity: DefectSeverity = .minor
    var note: String = ""
}

enum VehicleInspection {
    private static func L(_ id: String, _ label: String, _ cat: String, critical: Bool = false) -> InspectionLine {
        InspectionLine(id: id, label: label, category: cat, critical: critical)
    }

    static let catalog: [InspectionLine] = [
        // Exterior & Body
        L("ext_body", "Body / panels / damage", "Exterior & Body"),
        L("ext_glass", "Windshield & glass", "Exterior & Body", critical: true),
        L("ext_mirrors", "Mirrors", "Exterior & Body"),
        L("ext_wipers", "Wipers & washers", "Exterior & Body"),
        L("ext_plates", "License plates & tabs", "Exterior & Body"),
        // Tires & Wheels
        L("tire_tread", "Tire tread depth", "Tires & Wheels", critical: true),
        L("tire_pressure", "Tire pressure", "Tires & Wheels"),
        L("tire_damage", "Sidewall / tire damage", "Tires & Wheels", critical: true),
        L("tire_lugs", "Lug nuts / wheels", "Tires & Wheels"),
        L("tire_spare", "Spare / jack / tools", "Tires & Wheels"),
        // Lights & Signals
        L("lt_head", "Headlights (hi/lo)", "Lights & Signals", critical: true),
        L("lt_tail", "Tail / brake lights", "Lights & Signals", critical: true),
        L("lt_turn", "Turn signals", "Lights & Signals"),
        L("lt_hazard", "Hazard flashers", "Lights & Signals"),
        L("lt_reverse", "Reverse lights", "Lights & Signals"),
        // Emergency Equipment
        L("em_lightbar", "Lightbar / strobes", "Emergency Equipment", critical: true),
        L("em_siren", "Siren / PA", "Emergency Equipment", critical: true),
        L("em_radio", "Radio", "Emergency Equipment", critical: true),
        L("em_mdt", "MDT / laptop", "Emergency Equipment"),
        L("em_spotlight", "Spotlight / takedown", "Emergency Equipment"),
        // Fluids & Engine
        L("fl_oil", "Engine oil", "Fluids & Engine"),
        L("fl_coolant", "Coolant", "Fluids & Engine"),
        L("fl_brakefluid", "Brake fluid", "Fluids & Engine", critical: true),
        L("fl_leaks", "Leaks under vehicle", "Fluids & Engine"),
        L("fl_belts", "Belts & hoses", "Fluids & Engine"),
        // Brakes & Steering
        L("br_pedal", "Brake pedal / feel", "Brakes & Steering", critical: true),
        L("br_park", "Parking brake", "Brakes & Steering"),
        L("br_steer", "Steering", "Brakes & Steering", critical: true),
        L("br_abs", "ABS / dash warnings", "Brakes & Steering"),
        // Safety Equipment
        L("sf_seatbelt", "Seatbelts", "Safety Equipment", critical: true),
        L("sf_extinguisher", "Fire extinguisher", "Safety Equipment"),
        L("sf_firstaid", "First aid kit", "Safety Equipment"),
        L("sf_flares", "Flares / cones / triangles", "Safety Equipment"),
        L("sf_aed", "AED (if equipped)", "Safety Equipment"),
        L("sf_ppe", "PPE / gloves / masks", "Safety Equipment"),
        // Interior & Security
        L("in_clean", "Interior clean / no contraband", "Interior & Security"),
        L("in_cage", "Prisoner cage / partition", "Interior & Security"),
        L("in_doors", "Rear door locks (inoperable)", "Interior & Security"),
        L("in_horn", "Horn", "Interior & Security"),
        L("in_gauges", "Gauges / dash lights", "Interior & Security"),
        // Documents
        L("doc_reg", "Registration", "Documents"),
        L("doc_ins", "Insurance card", "Documents"),
    ]

    /// A fresh editable copy of the catalog (all items default to Pass).
    static func freshLines() -> [InspectionLine] { catalog }

    static let categories: [String] = {
        var seen = Set<String>(); var out: [String] = []
        for l in catalog where !seen.contains(l.category) { seen.insert(l.category); out.append(l.category) }
        return out
    }()

    static func linesIn(_ category: String, _ lines: [InspectionLine]) -> [InspectionLine] {
        lines.filter { $0.category == category }
    }

    static func defects(_ lines: [InspectionLine]) -> [InspectionLine] { lines.filter { $0.status == .defect } }

    /// Any critical-severity defect takes the vehicle out of service.
    static func isOutOfService(_ lines: [InspectionLine]) -> Bool {
        lines.contains { $0.status == .defect && $0.severity == .critical }
    }

    /// Back-compatible overall_result for fleet_inspections (pass / fail).
    static func overallResult(_ lines: [InspectionLine]) -> String {
        defects(lines).isEmpty ? "pass" : "fail"
    }

    /// Checklist payload for POST /api/fleet/:id/inspections.
    static func payload(_ lines: [InspectionLine]) -> [[String: String]] {
        lines.map { l in
            [
                "category": l.category,
                "item": l.label,
                "status": l.status.rawValue,
                "severity": l.status == .defect ? l.severity.rawValue : "",
                "notes": l.note,
            ]
        }
    }
}
