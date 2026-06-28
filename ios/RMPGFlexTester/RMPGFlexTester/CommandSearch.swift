import Foundation

// Pure-logic core for the Universal Command Search (v1.2 "Command Center").
// Foundation-only so it builds + unit-tests on the macOS host via
// run-workflow-tests.sh — no SwiftUI/UIKit here. The UI lives in
// CommandSearchView.swift; this file owns parsing, ranking, query sniffing, and
// the quick-command palette so all of that is headlessly verifiable.

/// The entity classes the federated intel index (`GET /api/intel/search`) returns.
enum IntelKind: String, CaseIterable {
    case person, vehicle, call, incident, citation, warrant, bolo, address, business, other

    /// Tolerant of casing and unknown server types (→ `.other`).
    init(raw: String) { self = IntelKind(rawValue: raw.lowercased()) ?? .other }

    var display: String {
        switch self {
        case .person: return "Person"
        case .vehicle: return "Vehicle"
        case .call: return "Call"
        case .incident: return "Incident"
        case .citation: return "Citation"
        case .warrant: return "Warrant"
        case .bolo: return "BOLO"
        case .address: return "Address"
        case .business: return "Business"
        case .other: return "Record"
        }
    }

    /// SF Symbol for the result row leading icon.
    var icon: String {
        switch self {
        case .person: return "person.fill"
        case .vehicle: return "car.fill"
        case .call: return "phone.fill"
        case .incident: return "doc.text.fill"
        case .citation: return "ticket.fill"
        case .warrant: return "exclamationmark.triangle.fill"
        case .bolo: return "eye.fill"
        case .address: return "mappin.circle.fill"
        case .business: return "building.2.fill"
        case .other: return "rectangle.stack.fill"
        }
    }

    /// Lower sorts first. Officer-safety records (warrants, BOLOs) outrank routine
    /// records so the most consequential hit is always on top.
    var priority: Int {
        switch self {
        case .warrant: return 0
        case .bolo: return 1
        case .person: return 2
        case .vehicle: return 3
        case .call: return 4
        case .incident: return 5
        case .citation: return 6
        case .address: return 7
        case .business: return 8
        case .other: return 9
        }
    }
}

/// One federated search hit. `entityID` is the per-table row id (collides across
/// kinds), so SwiftUI identity uses the kind-qualified `id` string.
struct IntelHit: Identifiable, Equatable {
    let kind: IntelKind
    let entityID: Int
    let label: String
    let snippet: String
    let flags: [String]

    var id: String { "\(kind.rawValue):\(entityID)" }
    var hasFlags: Bool { !flags.isEmpty }
}

/// Best-effort classification of the raw query — advisory only (the federated
/// index handles every query type regardless). Drives a small hint chip so the
/// officer sees the app understood what they typed.
enum QueryHint: Equatable {
    case plate, dob, caseNumber, phone, name, generic

    var label: String? {
        switch self {
        case .plate: return "Looks like a plate"
        case .dob: return "Looks like a date of birth"
        case .caseNumber: return "Looks like a case / report number"
        case .phone: return "Looks like a phone number"
        case .name: return "Searching names"
        case .generic: return nil
        }
    }
}

/// A launcher action shown when the search box is empty — the command palette.
struct QuickCommand: Identifiable, Equatable {
    let id: String
    let title: String
    let icon: String
}

enum CommandSearch {
    // ── Parsing ──────────────────────────────────────────────
    /// Map raw `/api/intel/search` result dicts → typed hits. Tolerant of missing
    /// fields, unknown kinds, and string/number id variance. Preserves input
    /// order (server already ranked by relevance); call `rank` to re-order.
    static func hits(from results: [[String: Any]]) -> [IntelHit] {
        results.compactMap { row in
            guard let id = intValue(row["id"] ?? row["entity_id"]) else { return nil }
            let kind = IntelKind(raw: (row["type"] as? String) ?? (row["entity_type"] as? String) ?? "other")
            let label = firstString(row, ["label", "name", "title", "display_name"]) ?? "\(kind.display) #\(id)"
            let snippet = firstString(row, ["snippet", "snip", "subtitle", "summary"]) ?? ""
            return IntelHit(kind: kind, entityID: id, label: label, snippet: snippet, flags: stringList(row["flags"]))
        }
    }

    // ── Ranking ──────────────────────────────────────────────
    /// Officer-safety ordering: any flagged hit first, then by kind priority, then
    /// label (case-insensitive), then stable by original index.
    static func rank(_ hits: [IntelHit]) -> [IntelHit] {
        hits.enumerated().sorted { a, b in
            let (i, x) = a; let (j, y) = b
            if x.hasFlags != y.hasFlags { return x.hasFlags }
            if x.kind.priority != y.kind.priority { return x.kind.priority < y.kind.priority }
            let cmp = x.label.localizedCaseInsensitiveCompare(y.label)
            if cmp != .orderedSame { return cmp == .orderedAscending }
            return i < j
        }.map(\.element)
    }

    // ── Query sniffing ───────────────────────────────────────
    static func sniff(_ raw: String) -> QueryHint {
        let q = raw.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return .generic }
        let digits = q.filter(\.isNumber)
        if matches(q, #"^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$"#) || matches(q, #"^\d{4}-\d{2}-\d{2}$"#) { return .dob }
        if matches(q, #"^\d{2,4}-\d{3,}$"#) { return .caseNumber }
        if digits.count == 10 && matches(q, #"^[\d().+\-\s]+$"#) { return .phone }
        let alnum = CharacterSet.alphanumerics
        if (5...8).contains(q.count),
           q.unicodeScalars.allSatisfy({ alnum.contains($0) }),
           q.contains(where: \.isNumber), q.contains(where: \.isLetter) { return .plate }
        if matches(q, #"^[A-Za-z][A-Za-z .'\-]*$"#) { return .name }
        return .generic
    }

    // ── Command palette ──────────────────────────────────────
    /// Empty-state launcher. Each id is wired to an existing surface in
    /// CommandSearchView (no half-built destinations).
    static let palette: [QuickCommand] = [
        QuickCommand(id: "panic", title: "Panic", icon: "exclamationmark.octagon.fill"),
        QuickCommand(id: "report", title: "New Report", icon: "square.and.pencil"),
        QuickCommand(id: "bolo", title: "New BOLO", icon: "eye.fill"),
        QuickCommand(id: "scan", title: "Scan ID", icon: "qrcode.viewfinder"),
        QuickCommand(id: "lookup", title: "Lookup", icon: "magnifyingglass"),
        QuickCommand(id: "dar", title: "Daily Activity", icon: "doc.text.below.ecg.fill"),
        QuickCommand(id: "photo", title: "Field Photo", icon: "camera.fill"),
    ]

    // ── Helpers ──────────────────────────────────────────────
    static func intValue(_ any: Any?) -> Int? {
        if let n = any as? Int { return n }
        if let d = any as? Double { return Int(d) }
        if let s = any as? String { return Int(s) }
        return nil
    }
    static func firstString(_ row: [String: Any], _ keys: [String]) -> String? {
        for k in keys { if let s = row[k] as? String, !s.isEmpty { return s } }
        return nil
    }
    static func stringList(_ any: Any?) -> [String] {
        if let arr = any as? [String] { return arr }
        if let arr = any as? [[String: Any]] {
            return arr.compactMap { $0["label"] as? String ?? $0["flag"] as? String ?? $0["type"] as? String }
        }
        if let s = any as? String, !s.isEmpty { return [s] }
        return []
    }
    private static func matches(_ s: String, _ pattern: String) -> Bool {
        s.range(of: pattern, options: .regularExpression) != nil
    }
}
