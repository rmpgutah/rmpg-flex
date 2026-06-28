import Foundation

// Pure end-of-shift roll-up. Combines the DAR auto-populate block (calls /
// incidents / citations / patrols) with fleet fuel + inspection logs and the
// ALPR read count into one shift summary + a DAR-ready narrative. Foundation-
// only → unit-tested. The view (ShiftSummaryView) fetches the inputs and renders
// what this produces.

struct ShiftStats: Equatable {
    var calls = 0
    var incidents = 0
    var citations = 0
    var patrols = 0
    var alprReads = 0
    var fuelGallons = 0.0
    var fuelCost = 0.0
    var milesDriven = 0
    var inspectionsLogged = 0
    var inspectionDefects = 0
}

enum ShiftSummary {
    /// Compile from the DAR auto-populate response (`{data:{...}}` or a bare
    /// data block) plus supplementary fleet/ALPR inputs (already scoped to the
    /// shift by the caller).
    static func compile(autoPopulate: [String: Any],
                        fuelLogs: [[String: Any]],
                        inspections: [[String: Any]],
                        alprReads: Int) -> ShiftStats {
        var s = ShiftStats()
        let data = (autoPopulate["data"] as? [String: Any]) ?? autoPopulate
        s.calls = count(data["calls"])
        s.incidents = count(data["incidents"])
        s.citations = count(data["citations"])
        s.patrols = count(data["patrols"])
        s.alprReads = max(0, alprReads)
        for f in fuelLogs {
            s.fuelGallons += dbl(f["gallons"])
            s.fuelCost += dbl(f["total_cost"] ?? f["cost"])
        }
        s.inspectionsLogged = inspections.count
        s.inspectionDefects = inspections.reduce(0) { $0 + defectCount($1) }
        s.milesDriven = milesFromInspections(inspections)
        return s
    }

    /// Miles = (latest post-trip odometer) − (earliest pre-trip odometer).
    static func milesFromInspections(_ inspections: [[String: Any]]) -> Int {
        var pre: Int?
        var post: Int?
        for i in inspections {
            let type = (str(i["inspection_type"]) ?? "").lowercased()
            guard let mi = intVal(i["mileage_at_inspection"] ?? i["mileage"]) else { continue }
            if type.contains("pre") { pre = pre.map { min($0, mi) } ?? mi }
            if type.contains("post") { post = post.map { max($0, mi) } ?? mi }
        }
        if let pre, let post, post >= pre { return post - pre }
        return 0
    }

    /// Count defect/fail items in an inspection's `checklist` JSON (falls back to
    /// the overall_result when the checklist isn't parseable).
    static func defectCount(_ i: [String: Any]) -> Int {
        if let raw = i["checklist"] as? String, let data = raw.data(using: .utf8),
           let arr = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] {
            return arr.filter { ["defect", "fail"].contains(((($0["status"] as? String) ?? "").lowercased())) }.count
        }
        return (str(i["overall_result"]) ?? "").lowercased() == "fail" ? 1 : 0
    }

    /// DAR-ready multi-line narrative.
    static func narrative(_ s: ShiftStats) -> String {
        var lines = [
            "SHIFT SUMMARY",
            "Calls handled: \(s.calls)",
            "Incidents: \(s.incidents)  ·  Citations: \(s.citations)",
            "Patrol scans: \(s.patrols)  ·  ALPR reads: \(s.alprReads)",
        ]
        if s.milesDriven > 0 { lines.append("Miles driven: \(s.milesDriven)") }
        if s.fuelGallons > 0 { lines.append(String(format: "Fuel: %.1f gal · $%.2f", s.fuelGallons, s.fuelCost)) }
        lines.append("Vehicle inspections: \(s.inspectionsLogged)"
                     + (s.inspectionDefects > 0 ? " (\(s.inspectionDefects) defect\(s.inspectionDefects > 1 ? "s" : ""))" : " · clean"))
        return lines.joined(separator: "\n")
    }

    // ── helpers ──
    static func count(_ any: Any?) -> Int {
        if let a = any as? [Any] { return a.count }
        if let n = any as? Int { return n }
        return 0
    }
    static func dbl(_ any: Any?) -> Double {
        if let d = any as? Double { return d }
        if let n = any as? Int { return Double(n) }
        if let s = any as? String { return Double(s) ?? 0 }
        return 0
    }
    static func intVal(_ any: Any?) -> Int? {
        if let n = any as? Int { return n }
        if let d = any as? Double { return Int(d) }
        if let s = any as? String { return Int(s) }
        return nil
    }
    static func str(_ any: Any?) -> String? {
        guard let s = any as? String, !s.isEmpty else { return nil }
        return s
    }
}
