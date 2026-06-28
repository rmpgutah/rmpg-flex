import Foundation

// Pure logic for the Fleet Readiness dashboard — rolls the fleet vehicle list
// (GET /api/fleet) into a readiness view: which vehicles are out of service (the
// payoff of the DVIR OOS gating), in maintenance, inspection-overdue, or ready.
// Foundation-only → unit-tested.

enum VehicleReadiness: String {
    case oos, maintenance, overdue, defects, ready, unknown

    /// Lower sorts first (most urgent on top).
    var priority: Int {
        switch self {
        case .oos: return 0
        case .maintenance: return 1
        case .overdue: return 2
        case .defects: return 3
        case .ready: return 4
        case .unknown: return 5
        }
    }
    var label: String {
        switch self {
        case .oos: return "Out of Service"
        case .maintenance: return "In Maintenance"
        case .overdue: return "Inspection Overdue"
        case .defects: return "Open Defects"
        case .ready: return "Ready"
        case .unknown: return "—"
        }
    }
    /// Color-token name the view maps to a Theme color.
    var tone: String {
        switch self {
        case .oos: return "red"
        case .maintenance, .overdue: return "orange"
        case .defects: return "gold"
        case .ready: return "green"
        case .unknown: return "neutral"
        }
    }
    var icon: String {
        switch self {
        case .oos: return "exclamationmark.octagon.fill"
        case .maintenance: return "wrench.and.screwdriver.fill"
        case .overdue: return "clock.badge.exclamationmark.fill"
        case .defects: return "wrench.adjustable.fill"
        case .ready: return "checkmark.seal.fill"
        case .unknown: return "questionmark.circle"
        }
    }
}

struct FleetVehicle: Identifiable, Equatable {
    let id: Int
    let number: String
    let name: String
    let status: String
    let mileage: Int?
    let lastInspectionEpoch: Double?   // 0/nil = unknown
    let lastResult: String?
}

enum FleetReadiness {
    static let overdueDays = 30

    static func parse(_ rows: [[String: Any]]) -> [FleetVehicle] {
        rows.compactMap { row in
            guard let id = intVal(row["id"]) else { return nil }
            let number = str(row, ["vehicle_number", "number", "unit", "plate_number"]) ?? "#\(id)"
            let mk = str(row, ["make"]) ?? ""
            let md = str(row, ["model"]) ?? ""
            let name = str(row, ["vehicle_name"]) ?? [mk, md].filter { !$0.isEmpty }.joined(separator: " ")
            return FleetVehicle(
                id: id, number: number, name: name,
                status: (str(row, ["status"]) ?? "").lowercased(),
                mileage: intVal(row["current_mileage"] ?? row["mileage"]),
                lastInspectionEpoch: epoch(row["last_inspection_date"] ?? row["last_inspection"] ?? row["last_inspected_at"]),
                lastResult: str(row, ["last_inspection_result", "last_result"]))
        }
    }

    static func readiness(_ v: FleetVehicle, now: Double) -> VehicleReadiness {
        switch v.status {
        case "out_of_service": return .oos
        case "maintenance": return .maintenance
        case "retired", "archived": return .unknown
        case "in_service":
            if let e = v.lastInspectionEpoch, e > 0, (now - e) > Double(overdueDays) * 86_400 { return .overdue }
            if (v.lastResult ?? "").lowercased() == "fail" { return .defects }
            return .ready
        default:
            return v.status.isEmpty ? .unknown : .ready
        }
    }

    /// Count by readiness (excludes retired/unknown from the headline if you wish;
    /// here it includes every parsed vehicle).
    static func summary(_ vehicles: [FleetVehicle], now: Double) -> [VehicleReadiness: Int] {
        var out: [VehicleReadiness: Int] = [:]
        for v in vehicles { out[readiness(v, now: now), default: 0] += 1 }
        return out
    }

    /// Not-ready vehicles first, then by number.
    static func sorted(_ vehicles: [FleetVehicle], now: Double) -> [FleetVehicle] {
        vehicles.sorted { a, b in
            let ra = readiness(a, now: now).priority, rb = readiness(b, now: now).priority
            if ra != rb { return ra < rb }
            return a.number.localizedCaseInsensitiveCompare(b.number) == .orderedAscending
        }
    }

    static func notReadyCount(_ vehicles: [FleetVehicle], now: Double) -> Int {
        vehicles.filter { readiness($0, now: now).priority <= VehicleReadiness.overdue.priority }.count
    }

    // ── helpers ──
    static func intVal(_ any: Any?) -> Int? {
        if let n = any as? Int { return n }
        if let d = any as? Double { return Int(d) }
        if let s = any as? String { return Int(s) }
        return nil
    }
    static func str(_ row: [String: Any], _ keys: [String]) -> String? {
        for k in keys { if let s = row[k] as? String, !s.isEmpty { return s } }
        return nil
    }
    private static let sqlFmt: DateFormatter = {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC"); f.dateFormat = "yyyy-MM-dd HH:mm:ss"; return f
    }()
    private static let dayFmt: DateFormatter = {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC"); f.dateFormat = "yyyy-MM-dd"; return f
    }()
    static func epoch(_ any: Any?) -> Double? {
        guard let s = any as? String, !s.isEmpty else { return nil }
        if let d = ISO8601DateFormatter().date(from: s) { return d.timeIntervalSince1970 }
        if let d = sqlFmt.date(from: s) { return d.timeIntervalSince1970 }
        if let d = dayFmt.date(from: s) { return d.timeIntervalSince1970 }
        return nil
    }
}
