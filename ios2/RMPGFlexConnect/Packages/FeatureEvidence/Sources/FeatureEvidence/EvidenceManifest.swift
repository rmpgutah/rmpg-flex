import Foundation
#if canImport(CryptoKit)
import CryptoKit
#endif

// Pure chain-of-custody helpers, mirroring `src/utils/evidence.ts` on the
// Worker so client and server agree on shape/format without sharing code.
// Kept dependency-free (besides CryptoKit) so it unit-tests without a
// network stack or D1 binding.

public enum EvidenceClassification: String, CaseIterable, Sendable, Equatable {
    case lawEnforcementSensitive = "LAW ENFORCEMENT SENSITIVE"
    case evidence = "EVIDENCE"
    case confidential = "CONFIDENTIAL"
    case unrestricted = "UNRESTRICTED"

    /// Map any free-form input to a known classification (default `.evidence`),
    /// matching the server's `normalizeClassification`.
    public static func normalize(_ raw: String?) -> EvidenceClassification {
        let v = (raw ?? "").uppercased().trimmingCharacters(in: .whitespacesAndNewlines)
        return EvidenceClassification(rawValue: v) ?? .evidence
    }
}

/// Human evidence number, e.g. `evidenceNumber(year: 2026, sequence: 42)` -> "26-EVD-00042".
public func evidenceNumber(year: Int, sequence: Int) -> String {
    let yy = String(String(year).suffix(2))
    let seq = String(format: "%05d", max(0, sequence))
    return "\(yy)-EVD-\(seq)"
}

/// Short fingerprint shown in lists / burned into the pixels.
public func shortHash(_ hex: String) -> String {
    String(hex.uppercased().prefix(16))
}

/// A hex digest must look like a real SHA-256 (or similar) hash before we
/// bother filing a manifest — mirrors the server's `validateManifest` gate.
public func isValidHexDigest(_ s: String) -> Bool {
    guard s.count >= 16 && s.count <= 128 else { return false }
    return s.allSatisfy { $0.isHexDigit }
}

#if canImport(CryptoKit)
/// SHA-256 of the ORIGINAL captured frame, computed on-device at capture time
/// — this is the value that gets burned into the photo's pixels, filed as the
/// manifest's `sha256`, and later recomputed to verify the stored image
/// hasn't been altered.
public func sha256Hex(of data: Data) -> String {
    let digest = SHA256.hash(data: data)
    return digest.map { String(format: "%02x", $0) }.joined()
}
#endif

/// Chain-of-custody manifest for one secure capture. Filed to
/// `POST /api/evidence`; the photo bytes themselves are uploaded separately
/// (e.g. via `/api/field-photos`) and linked by this same hash.
public struct EvidenceManifest: Codable, Sendable, Equatable {
    public var sha256: String
    public var classification: String
    public var sequence: Int
    public var officerName: String?
    public var badge: String?
    public var unit: String?
    public var caseRef: String?
    public var gpsLat: Double?
    public var gpsLng: Double?
    public var deviceId: String?
    public var mime: String
    public var capturedAt: String

    public init(
        sha256: String,
        classification: EvidenceClassification,
        sequence: Int,
        officerName: String? = nil,
        badge: String? = nil,
        unit: String? = nil,
        caseRef: String? = nil,
        gpsLat: Double? = nil,
        gpsLng: Double? = nil,
        deviceId: String? = nil,
        mime: String = "image/jpeg",
        capturedAt: Date = Date()
    ) {
        self.sha256 = sha256
        self.classification = classification.rawValue
        self.sequence = sequence
        self.officerName = officerName
        self.badge = badge
        self.unit = unit
        self.caseRef = caseRef
        self.gpsLat = gpsLat
        self.gpsLng = gpsLng
        self.deviceId = deviceId
        self.mime = mime
        self.capturedAt = ISO8601DateFormatter().string(from: capturedAt)
    }

    enum CodingKeys: String, CodingKey {
        case sha256, classification, sequence
        case officerName = "officer_name"
        case badge, unit
        case caseRef = "case_ref"
        case gpsLat = "gps_lat"
        case gpsLng = "gps_lng"
        case deviceId = "device_id"
        case mime
        case capturedAt = "captured_at"
    }
}

/// Response shape from `POST /api/evidence`.
public struct EvidenceManifestResponse: Decodable, Sendable {
    public struct Data: Decodable, Sendable {
        public let id: Int?
        public let evidence_number: String?
        public let sha256: String?
        public let short_hash: String?
    }
    public let data: Data
}

/// Response shape from `GET /api/evidence`.
public struct EvidenceManifestListResponse: Decodable, Sendable {
    public let data: [EvidenceManifestRecord]
}

/// One row as returned by the Worker's chain-of-custody log.
public struct EvidenceManifestRecord: Decodable, Sendable, Identifiable, Equatable {
    public let id: Int
    public let evidence_number: String?
    public let sha256: String
    public let classification: String
    public let sequence: Int?
    public let officer_name: String?
    public let badge: String?
    public let unit: String?
    public let case_ref: String?
    public let captured_at: String?
    public let created_at: String?
}
