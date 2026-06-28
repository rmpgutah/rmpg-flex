import Foundation

/// Minimal `header.payload.signature` decoder. We never verify the signature
/// locally — that's the server's job. We only need the payload claims to drive
/// role detection.
public enum JWT {
    public struct Payload: Equatable, Sendable {
        public let role: String?
        public let sub: String?
        public let exp: Date?
        public let raw: [String: AnyJSON]
    }

    public enum DecodeError: Error, Equatable {
        case malformed
        case invalidBase64
        case invalidJSON
    }

    public static func decode(_ token: String) throws -> Payload {
        let parts = token.split(separator: ".")
        guard parts.count == 3 else { throw DecodeError.malformed }
        guard let data = Self.base64URLDecode(String(parts[1])) else {
            throw DecodeError.invalidBase64
        }
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw DecodeError.invalidJSON
        }
        let role = object["role"] as? String
        let sub = object["sub"] as? String
        let exp: Date? = {
            if let v = object["exp"] as? Double { return Date(timeIntervalSince1970: v) }
            if let v = object["exp"] as? Int { return Date(timeIntervalSince1970: TimeInterval(v)) }
            return nil
        }()
        return Payload(role: role, sub: sub, exp: exp, raw: object.mapValues(AnyJSON.from))
    }

    private static func base64URLDecode(_ s: String) -> Data? {
        var t = s
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let pad = t.count % 4
        if pad > 0 { t += String(repeating: "=", count: 4 - pad) }
        return Data(base64Encoded: t)
    }
}

/// Type-erased JSON value, exposed so callers can inspect claims we don't model.
public enum AnyJSON: Equatable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null
    case array([AnyJSON])
    case object([String: AnyJSON])

    static func from(_ value: Any) -> AnyJSON {
        if let s = value as? String { return .string(s) }
        if let b = value as? Bool { return .bool(b) }
        if let n = value as? Double { return .number(n) }
        if let n = value as? Int { return .number(Double(n)) }
        if value is NSNull { return .null }
        if let arr = value as? [Any] { return .array(arr.map(from)) }
        if let obj = value as? [String: Any] { return .object(obj.mapValues(from)) }
        return .null
    }
}
