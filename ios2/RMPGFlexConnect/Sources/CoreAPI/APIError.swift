import Foundation

public enum APIError: LocalizedError {
    case invalidURL(String)
    case httpError(status: Int, body: String)
    case decodingError(Error)
    case encodingError(Error)
    case networkError(Error)
    case unauthorized
    case forbidden
    case notFound
    case serverError(String)
    case offline
    case sessionExpired
    case unknown(String)

    public var errorDescription: String? {
        switch self {
        case .invalidURL(let url): return "Invalid URL: \(url)"
        case .httpError(let status, let body): return "HTTP \(status): \(body)"
        case .decodingError(let e): return "Decoding error: \(e.localizedDescription)"
        case .encodingError(let e): return "Encoding error: \(e.localizedDescription)"
        case .networkError(let e): return "Network error: \(e.localizedDescription)"
        case .unauthorized: return "Unauthorized — please log in again"
        case .forbidden: return "Forbidden — insufficient permissions"
        case .notFound: return "Resource not found"
        case .serverError(let msg): return "Server error: \(msg)"
        case .offline: return "Device is offline"
        case .sessionExpired: return "Session expired — please log in again"
        case .unknown(let msg): return msg
        }
    }
}
