import Foundation

// Pure accumulation for continuous ALPR patrol scanning: merge successive
// /api/alpr/capture summaries into a de-duplicated running plate log (latest
// read per plate wins; a plate that ever hit stays flagged), critical-first.
// Reuses AlprScanVehicle/AlprScanSummary from AlprResultParse. Foundation-only
// so it runs in the swift-test package.

struct AlprLogEntry: Identifiable, Equatable {
    let id: String            // normalized plate
    var vehicle: AlprScanVehicle
    var seenCount: Int
}

enum AlprScanLog {
    /// Uppercase + strip non-alphanumerics; nil if nothing readable.
    static func normalizePlate(_ plate: String?) -> String? {
        guard let raw = plate else { return nil }
        let p = String(raw.uppercased().unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) })
        return p.isEmpty ? nil : p
    }

    /// Merge a new capture summary into the running log. De-dup by normalized
    /// plate; plateless reads are dropped (a plate log only tracks plated reads).
    /// A vehicle that ever had critical hits keeps them across re-reads.
    static func merge(_ existing: [AlprLogEntry], _ summary: AlprScanSummary) -> [AlprLogEntry] {
        var out = existing
        for v in summary.vehicles {
            guard let key = normalizePlate(v.plate) else { continue }
            if let idx = out.firstIndex(where: { $0.id == key }) {
                var merged = v
                if merged.criticalHits.isEmpty { merged.criticalHits = out[idx].vehicle.criticalHits }
                out[idx].vehicle = merged
                out[idx].seenCount += 1
            } else {
                out.append(AlprLogEntry(id: key, vehicle: v, seenCount: 1))
            }
        }
        return out
    }

    /// Critical-first, then most-seen, stable.
    static func sorted(_ entries: [AlprLogEntry]) -> [AlprLogEntry] {
        entries.enumerated().sorted { a, b in
            let (i, x) = a; let (j, y) = b
            let xc = !x.vehicle.criticalHits.isEmpty, yc = !y.vehicle.criticalHits.isEmpty
            if xc != yc { return xc }
            if x.seenCount != y.seenCount { return x.seenCount > y.seenCount }
            return i < j
        }.map(\.element)
    }

    static func criticalCount(_ entries: [AlprLogEntry]) -> Int {
        entries.filter { !$0.vehicle.criticalHits.isEmpty }.count
    }
}
