import Foundation

/// Mirrors `calls_for_service` (verified against migrations/0001_initial_schema.sql).
/// A prior version used `location` as the property name — the real column is
/// `location_address`, which `.convertFromSnakeCase` maps to `locationAddress`;
/// there's no column that maps to `location`, so it always silently decoded
/// to nil and every call showed a blank address anywhere this was displayed.
public struct CallForService: Codable, Identifiable, Sendable {
    public let id: Int
    public let callNumber: String?
    public let incidentType: String?
    public let priority: String?
    public let status: String?
    public let locationAddress: String?
    public let latitude: Double?
    public let longitude: Double?
    public let callerName: String?
    public let callerPhone: String?
    public let narrative: String?
    public let createdAt: String?
    public let updatedAt: String?
    public let assignedUnitIds: String?
    public let dispatcherId: Int?
    public let district: String?
    public let beat: String?

    public var parsedUnitIds: [Int] {
        guard let ids = assignedUnitIds,
              let data = ids.data(using: .utf8),
              let arr = try? JSONDecoder().decode([Int].self, from: data) else { return [] }
        return arr
    }
}

public struct Unit: Codable, Identifiable, Sendable {
    public let id: Int
    public let callSign: String?
    public let officerId: Int?
    public let status: String?
    public let lat: Double?
    public let lng: Double?
    public let vehicleId: Int?
    public let currentCallId: Int?
    public let capabilities: String?

    private enum CodingKeys: String, CodingKey {
        case id, callSign, officerId, status, lat, lng, vehicleId, currentCallId, capabilities
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(Int.self, forKey: .id)
        callSign = try container.decodeIfPresent(String.self, forKey: .callSign)
        officerId = try container.decodeIfPresent(Int.self, forKey: .officerId)
        status = try container.decodeIfPresent(String.self, forKey: .status)
        lat = try container.decodeIfPresent(Double.self, forKey: .lat)
        lng = try container.decodeIfPresent(Double.self, forKey: .lng)
        // Production data sometimes stores a non-numeric vehicle call sign in
        // this column instead of the numeric FK — tolerate it rather than
        // failing the whole decode.
        vehicleId = try? container.decode(Int.self, forKey: .vehicleId)
        currentCallId = try container.decodeIfPresent(Int.self, forKey: .currentCallId)
        capabilities = try container.decodeIfPresent(String.self, forKey: .capabilities)
    }
}

public struct PanicAlert: Codable, Identifiable, Sendable {
    public let id: Int?
    public let source: String
    public let escalationLevel: String?
    public let lat: Double?
    public let lng: Double?
}

/// Mirrors GET /api/dispatch (src/routes/dispatch/aggregates.ts, mounted at
/// bare `/api/dispatch` with an internal `.get('/')`) — a NESTED
/// `{calls:{...}, units:{...}}` shape. A prior version modeled this as flat
/// top-level fields (`totalCalls`, `availableUnits`, etc.) fetched from a
/// `/api/dispatch/stats` path that doesn't exist anywhere on this Worker
/// (404) — and even ignoring the 404, the flat field names wouldn't have
/// matched the real nested response, so `stats` has always silently
/// deserialized to all-nil.
public struct DispatchStats: Codable, Sendable {
    public let calls: CallStats?
    public let units: UnitStats?

    public struct CallStats: Codable, Sendable {
        public let total: Int?
        public let active: Int?
        public let pending: Int?
        public let dispatched: Int?
        public let enroute: Int?
        public let onscene: Int?
        public let p1Count: Int?
        public let p2Count: Int?
        public let p3Count: Int?
        public let today: Int?
    }

    public struct UnitStats: Codable, Sendable {
        public let total: Int?
        public let available: Int?
        public let committed: Int?
        public let offDuty: Int?
    }
}

/// POST /api/dispatch/calls body. CodingKeys map to the real field names the
/// Worker destructures (`incident_type`, `location_address`, `caller_name`,
/// `caller_phone`; see src/routes/dispatch/calls.ts) — `DispatchAPI.createCall`
/// encodes this with a plain `JSONEncoder()` (no snake_case conversion), so
/// without these keys every field was sent under its bare camelCase Swift
/// name instead. The server's required-field check
/// (`incident_type, priority, location_address`) never actually received any
/// of them under those names, so creating a call from iOS has always 400'd
/// regardless of what the user typed — the exact same class of bug already
/// found and fixed on IncidentCreateRequest.
public struct CreateCallRequest: Codable, Sendable {
    public let incidentType: String
    public let priority: String
    public let locationAddress: String
    public let callerName: String?
    public let callerPhone: String?
    public let narrative: String?
    public let district: String?
    public let beat: String?

    private enum CodingKeys: String, CodingKey {
        case incidentType = "incident_type"
        case priority
        case locationAddress = "location_address"
        case callerName = "caller_name"
        case callerPhone = "caller_phone"
        case narrative
        case district
        case beat
    }

    public init(incidentType: String, priority: String, locationAddress: String,
                callerName: String? = nil, callerPhone: String? = nil,
                narrative: String? = nil, district: String? = nil, beat: String? = nil) {
        self.incidentType = incidentType
        self.priority = priority
        self.locationAddress = locationAddress
        self.callerName = callerName
        self.callerPhone = callerPhone
        self.narrative = narrative
        self.district = district
        self.beat = beat
    }
}

/// Mirrors one entry from GET /api/dispatch/welfare/active's real
/// `{count, watches:[...]}` response (src/routes/dispatch/extensions.ts) — a
/// prior version expected `{data:[...], pagination:{...}}` (via
/// `ApiListResponse`), which doesn't exist on this response at all, so this
/// call has always thrown a decode error rather than returning anything.
/// `watch` is the raw WelfareWatchDO state object — left as a loosely-typed
/// dictionary since its shape lives in Durable Object code, not a route
/// handler, and the dispatcher-facing summary only needs officer/call info.
public struct WelfareCheck: Codable, Identifiable, Sendable {
    public let userId: Int
    public let officerName: String?
    public let callSign: String?
    public let currentCallId: Int?

    public var id: Int { userId }
}

struct WelfareActiveResponse: Codable, Sendable {
    let count: Int
    let watches: [WelfareCheck]
}
