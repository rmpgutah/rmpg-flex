import Foundation
import UIKit

public actor PushTokenService {
    private let apiClient: PushAPIClient

    public init(apiClient: PushAPIClient) {
        self.apiClient = apiClient
    }

    public func registerForRemoteNotifications() {
        DispatchQueue.main.async {
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    public func didRegisterForRemoteNotifications(deviceToken: Data) {
        let tokenString = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        Task { try? await apiClient.registerToken(tokenString) }
    }

    public func didFailToRegister(error: Error) {
        Task { try? await apiClient.unregisterToken(reason: error.localizedDescription) }
    }
}

public struct PushAPIClient: Sendable {
    public let baseURL: URL
    public let session: URLSession
    public let tokenProvider: @Sendable () -> String?

    public init(baseURL: URL, session: URLSession = .shared, tokenProvider: @escaping @Sendable () -> String?) {
        self.baseURL = baseURL
        self.session = session
        self.tokenProvider = tokenProvider
    }

    public func registerToken(_ token: String) async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/devices/push-token"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let auth = tokenProvider() {
            request.setValue("Bearer \(auth)", forHTTPHeaderField: "Authorization")
        }
        let body = ["device_token": token, "app_version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1"]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw PushError.registrationFailed
        }
    }

    public func unregisterToken(reason: String) async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/devices/push-token"))
        request.httpMethod = "DELETE"
        if let auth = tokenProvider() {
            request.setValue("Bearer \(auth)", forHTTPHeaderField: "Authorization")
        }
        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw PushError.unregistrationFailed
        }
    }
}

public enum PushError: Error, LocalizedError {
    case registrationFailed
    case unregistrationFailed

    public var errorDescription: String? {
        switch self {
        case .registrationFailed: return "Failed to register push token"
        case .unregistrationFailed: return "Failed to unregister push token"
        }
    }
}
