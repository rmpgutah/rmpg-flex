import Foundation

// Pure chain-of-custody model for a secure evidence capture. The SHA-256 is
// computed over the ORIGINAL frame bytes (in EvidenceCameraView via CryptoKit),
// then a short fingerprint is burned into the pixels AND the full hash is filed
// to /api/evidence — so the stored exhibit is self-verifying and tamper-evident.
// Foundation-only → unit-tested on the host.

enum EvidenceClassification: String, CaseIterable {
    case leSensitive = "LAW ENFORCEMENT SENSITIVE"
    case evidence = "EVIDENCE"
    case confidential = "CONFIDENTIAL"
    case unrestricted = "UNRESTRICTED"

    /// Compact label for the in-app picker.
    var short: String {
        switch self {
        case .leSensitive: return "LE Sensitive"
        case .evidence: return "Evidence"
        case .confidential: return "Confidential"
        case .unrestricted: return "Unrestricted"
        }
    }
}

struct EvidenceManifest {
    var sha256: String
    var classification: EvidenceClassification
    var sequence: Int
    var officer: String = ""
    var badge: String = ""
    var unit: String = ""
    var caseRef: String = ""
    var lat: Double?
    var lng: Double?
    var capturedAt: String          // ISO8601
    var deviceId: String = ""
    var mime: String = "image/jpeg"

    /// Short fingerprint burned into the pixels (the full hash goes to the manifest).
    static func shortHash(_ hex: String) -> String { String(hex.uppercased().prefix(16)) }
    /// Zero-padded exhibit/capture sequence label.
    static func sequenceLabel(_ n: Int) -> String { String(format: "%03d", max(0, n)) }

    var burnShortHash: String { EvidenceManifest.shortHash(sha256) }
    var sequenceLabel: String { EvidenceManifest.sequenceLabel(sequence) }

    /// JSON body for POST /api/evidence.
    func body() -> [String: Any] {
        var b: [String: Any] = [
            "sha256": sha256,
            "classification": classification.rawValue,
            "sequence": sequence,
            "officer_name": officer,
            "badge": badge,
            "unit": unit,
            "case_ref": caseRef,
            "captured_at": capturedAt,
            "device_id": deviceId,
            "mime": mime,
        ]
        if let lat { b["gps_lat"] = lat }
        if let lng { b["gps_lng"] = lng }
        return b
    }

    /// One-line summary for the MDT push payload and log rows.
    var summary: String { "[\(classification.rawValue)] EXH \(sequenceLabel) · SHA256 \(burnShortHash)" }
}
