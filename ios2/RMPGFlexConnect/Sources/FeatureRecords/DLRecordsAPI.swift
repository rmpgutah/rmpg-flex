import Foundation


/// Mirrors a `dl_records` row (src/routes/dlRecords.ts) — the same local DL
/// data store DlSearchPage.tsx uses on web (RECORD_FIELDS list there is the
/// source of truth this mirrors). Distinct from the generic
/// `/api/records/persons` table: this one carries DL-specific fields (class,
/// status, expiration, restrictions) that matter on a traffic stop and that
/// the generic person search can't surface.
public struct DLRecord: Codable, Identifiable, Sendable {
    public let id: Int
    public let firstName: String?
    public let middleName: String?
    public let lastName: String?
    public let suffix: String?
    public let fullName: String?
    public let dateOfBirth: String?
    public let gender: String?
    public let height: String?
    public let weight: String?
    public let eyeColor: String?
    public let hairColor: String?
    public let race: String?
    public let dlNumber: String?
    public let dlState: String?
    public let dlClass: String?
    public let dlStatus: String?
    public let dlExpiration: String?
    public let dlIssueDate: String?
    public let dlRestrictions: String?
    public let dlEndorsements: String?
    public let addresses: [DLAddress]?

    public var displayName: String {
        fullName ?? [firstName, lastName].compactMap { $0 }.joined(separator: " ")
    }

    /// True when dl_status text reads as a live hazard — mirrors the same
    /// regex the web client's history view uses (src/routes/dlRecords.ts:954,
    /// `/suspend|revok|cancel|denied/i`), so a scanned/searched record flags
    /// the same way here as it would on the desktop MDT.
    public var isFlagged: Bool {
        guard let status = dlStatus else { return false }
        return status.range(of: "suspend|revok|cancel|denied", options: [.regularExpression, .caseInsensitive]) != nil
    }
}

public struct DLAddress: Codable, Sendable {
    public let address: String?
    public let address2: String?
    public let city: String?
    public let state: String?
    public let postalCode: String?
    public let country: String?
}

public struct DLRecordsAPI: Sendable {
    let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /// GET /api/dl-records?search=... — real response is
    /// {data:[...], total, page, per_page} (flat pagination fields, NOT a
    /// nested `pagination` object like most other list endpoints on this
    /// Worker — verified directly against src/routes/dlRecords.ts).
    public func search(_ query: String) async throws -> [DLRecord] {
        guard !query.trimmingCharacters(in: .whitespaces).isEmpty else { return [] }
        let response: DLRecordListResponse = try await client.request(Endpoint(
            path: "/api/dl-records", queryItems: [URLQueryItem(name: "search", value: query)]
        ))
        return response.data
    }

    public func get(id: Int) async throws -> DLRecord {
        try await client.request(Endpoint(path: "/api/dl-records/\(id)"))
    }

    struct DLRecordListResponse: Codable, Sendable {
        let data: [DLRecord]
        let total: Int
        let page: Int
    }
}
