import Foundation

// Pure parsing of a POST /api/alpr/capture response. Foundation-only so it
// runs in the swift-test package (run-workflow-tests.sh) — no SwiftUI/UIKit.
// The view layer (AlprScanView.swift) renders the summary this produces.

/// One vehicle extracted from an ALPR capture, plus what happened to its record.
struct AlprScanVehicle: Equatable {
    var plate: String?
    var make: String?
    var model: String?
    var color: String?
    var year: Int?
    var vehicleType: String?
    var confidence: Double?
    var vehicleRecordId: Int?
    var recordCreated: Bool
    var criticalHits: [String]

    /// "silver 2019 Toyota Camry"-style line, falling back to the body type.
    var descriptor: String {
        let parts = [color, year.map(String.init), make, model]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
        if !parts.isEmpty { return parts.joined(separator: " ") }
        return vehicleType ?? "—"
    }
}

/// Parsed summary of a /api/alpr/capture response.
struct AlprScanSummary: Equatable {
    var vehicleCount: Int
    var vehicles: [AlprScanVehicle]
    var criticalHits: [String]   // capture-level, de-duplicated
    var createdCount: Int        // vehicles that produced a NEW record
    var hasCritical: Bool { !criticalHits.isEmpty }
}

enum AlprResultParse {
    static func summary(from json: Any?) -> AlprScanSummary {
        let dict = json as? [String: Any] ?? [:]
        let rawVehicles = dict["vehicles"] as? [[String: Any]] ?? []

        var vehicles: [AlprScanVehicle] = []
        var created = 0
        for v in rawVehicles {
            let recordCreated = (v["vehicle_record_created"] as? Bool) ?? false
            if recordCreated { created += 1 }
            vehicles.append(AlprScanVehicle(
                plate: str(v["plate"]),
                make: str(v["make"]),
                model: str(v["model"]),
                color: str(v["color"]),
                year: intVal(v["year"]),
                vehicleType: str(v["vehicle_type"]),
                confidence: doubleVal(v["confidence"]),
                vehicleRecordId: intVal(v["vehicle_record_id"]),
                recordCreated: recordCreated,
                criticalHits: criticalDetails(v["hits"])))
        }

        let count = intVal(dict["vehicle_count"]) ?? vehicles.count
        return AlprScanSummary(
            vehicleCount: count,
            vehicles: vehicles,
            criticalHits: criticalDetails(dict["hits"]),
            createdCount: created)
    }

    /// Pull the `detail` of every critical hit from a `hits` array.
    private static func criticalDetails(_ raw: Any?) -> [String] {
        (raw as? [[String: Any]] ?? [])
            .filter { ($0["severity"] as? String) == "critical" }
            .compactMap { $0["detail"] as? String }
    }

    private static func str(_ v: Any?) -> String? {
        guard let s = v as? String, !s.isEmpty else { return nil }
        return s
    }
    private static func intVal(_ v: Any?) -> Int? {
        if let i = v as? Int { return i }
        if let d = v as? Double { return Int(d) }
        if let s = v as? String { return Int(s) }
        return nil
    }
    private static func doubleVal(_ v: Any?) -> Double? {
        if let d = v as? Double { return d }
        if let i = v as? Int { return Double(i) }
        if let s = v as? String { return Double(s) }
        return nil
    }
}
