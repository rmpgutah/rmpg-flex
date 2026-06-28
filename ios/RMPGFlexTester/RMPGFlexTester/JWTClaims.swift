import Foundation

// ============================================================
// JWTClaims — decode the Worker-issued JWT payload for UI gating.
// The server re-checks the role on every admin write (ON_BEHALF_ROLES /
// TIME_WRITE_ROLES in the Worker); this exists only so the app knows which
// screens to show. Legacy tokens use `userId`; some flows also carry `id`.
// ============================================================
struct JWTClaims {
    let userId: Int?
    let role: String?
    let name: String?
    let exp: Date?

    /// Roles allowed to manage other officers' shifts — mirrors the Worker's
    /// ON_BEHALF_ROLES set in src/routes/dispatch/duty.ts.
    static let dispatchTierRoles: Set<String> = ["admin", "manager", "supervisor", "dispatcher"]

    var isDispatchTier: Bool {
        guard let role else { return false }
        return Self.dispatchTierRoles.contains(role.lowercased())
    }

    /// Decode the middle (payload) segment of a JWT. Returns nil on any
    /// malformed input — never throws, never crashes on garbage tokens.
    static func decode(_ jwt: String) -> JWTClaims? {
        let parts = jwt.split(separator: ".")
        guard parts.count == 3 else { return nil }
        // base64url → base64 (+ padding)
        var b64 = parts[1].replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        b64 += String(repeating: "=", count: (4 - b64.count % 4) % 4)
        guard let data = Data(base64Encoded: b64),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        let uid = (obj["userId"] as? Int) ?? (obj["id"] as? Int)
            ?? Int(obj["userId"] as? String ?? "")
        let expDate = (obj["exp"] as? Double).map { Date(timeIntervalSince1970: $0) }
        return JWTClaims(
            userId: uid,
            role: obj["role"] as? String,
            name: (obj["name"] as? String) ?? (obj["full_name"] as? String) ?? (obj["username"] as? String),
            exp: expDate
        )
    }

    /// Claims from the cached login token, if any.
    static func current() -> JWTClaims? {
        guard let jwt = KeychainStore.load(key: "rmpgJWT") else { return nil }
        return decode(jwt)
    }
}
