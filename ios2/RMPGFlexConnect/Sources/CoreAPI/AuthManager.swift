import Foundation

@MainActor
public final class AuthManager: ObservableObject {
    @Published public private(set) var isAuthenticated = false
    @Published public private(set) var currentUser: UserProfile?
    @Published public private(set) var authError: String?

    private let apiClient: APIClient
    private let keychain: KeychainProtocol
    private var refreshTask: Task<Void, Error>?

    private let tokenKey = "rmpg_flex_access_token"
    private let refreshTokenKey = "rmpg_flex_refresh_token"
    private let sessionIdKey = "rmpg_flex_session_id"

    public init(apiClient: APIClient, keychain: KeychainProtocol = Keychain()) {
        self.apiClient = apiClient
        self.keychain = keychain
    }

    public func restoreSession() async {
        guard let token = keychain.get(tokenKey),
              let refreshToken = keychain.get(refreshTokenKey) else {
            return
        }
        await apiClient.setAuthToken(token)

        do {
            let user: UserProfile = try await apiClient.request(Endpoint(
                path: "/api/auth/me",
                method: .get
            ))
            currentUser = user
            isAuthenticated = true
        } catch {
            await attemptTokenRefresh(refreshToken: refreshToken)
        }
    }

    public func login(username: String, password: String) async throws {
        let body = try JSONEncoder().encode(LoginRequest(username: username, password: password))
        let response: LoginResponse = try await apiClient.request(Endpoint(
            path: "/api/auth/login",
            method: .post,
            body: body,
            requiresAuth: false
        ))

        await apiClient.setAuthToken(response.token)
        keychain.set(response.token, forKey: tokenKey)
        keychain.set(response.refreshToken, forKey: refreshTokenKey)
        keychain.set(response.sessionId, forKey: sessionIdKey)

        currentUser = UserProfile(
            id: response.userId,
            username: response.username,
            role: response.role,
            fullName: response.fullName,
            badgeNumber: response.badgeNumber,
            email: response.email,
            phone: response.phone,
            status: "active"
        )
        isAuthenticated = true
        authError = nil
    }

    public func logout() async {
        do {
            try await apiClient.requestVoid(Endpoint(path: "/api/auth/logout", method: .post))
        } catch {}

        await apiClient.setAuthToken(nil)
        keychain.delete(tokenKey)
        keychain.delete(refreshTokenKey)
        keychain.delete(sessionIdKey)
        currentUser = nil
        isAuthenticated = false
    }

    public func changePassword(current: String, new: String) async throws {
        let body = try JSONEncoder().encode(ChangePasswordRequest(
            currentPassword: current,
            newPassword: new
        ))
        try await apiClient.requestVoid(Endpoint(
            path: "/api/auth/password",
            method: .put,
            body: body
        ))
    }

    private func attemptTokenRefresh(refreshToken: String) async {
        do {
            let body = try JSONEncoder().encode(RefreshRequest(refreshToken: refreshToken))
            let response: RefreshResponse = try await apiClient.request(Endpoint(
                path: "/api/auth/refresh",
                method: .post,
                body: body,
                requiresAuth: false
            ))

            await apiClient.setAuthToken(response.token)
            keychain.set(response.token, forKey: tokenKey)
            keychain.set(response.refreshToken, forKey: refreshTokenKey)

            let user: UserProfile = try await apiClient.request(Endpoint(
                path: "/api/auth/me",
                method: .get
            ))
            currentUser = user
            isAuthenticated = true
        } catch {
            await apiClient.setAuthToken(nil)
            keychain.delete(tokenKey)
            keychain.delete(refreshTokenKey)
            keychain.delete(sessionIdKey)
            isAuthenticated = false
            authError = "Session expired. Please log in again."
        }
    }
}

// MARK: - Models

public struct UserProfile: Codable, Identifiable, Sendable {
    public let id: Int
    public let username: String
    public let role: String
    public let fullName: String
    public let badgeNumber: String?
    public let email: String?
    public let phone: String?
    public let status: String

    public var isAdmin: Bool { role == "admin" }
    public var isSupervisor: Bool { role == "supervisor" || role == "manager" || isAdmin }
    public var isOfficer: Bool { role == "officer" }
    public var isDispatcher: Bool { role == "dispatcher" }
}

struct LoginRequest: Codable {
    let username: String
    let password: String
}

public struct LoginResponse: Codable, Sendable {
    public let token: String
    public let refreshToken: String
    public let sessionId: String
    public let userId: Int
    public let username: String
    public let role: String
    public let fullName: String
    public let badgeNumber: String?
    public let email: String?
    public let phone: String?
}

struct RefreshRequest: Codable {
    let refreshToken: String
}

public struct RefreshResponse: Codable, Sendable {
    public let token: String
    public let refreshToken: String
}

struct ChangePasswordRequest: Codable {
    let currentPassword: String
    let newPassword: String
}

// MARK: - Keychain

public protocol KeychainProtocol {
    func get(_ key: String) -> String?
    func set(_ value: String, forKey key: String)
    func delete(_ key: String)
}

public struct Keychain: KeychainProtocol {
    public init() {}

    public func get(_ key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public func set(_ value: String, forKey key: String) {
        let data = value.data(using: .utf8)!
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecValueData as String: data
        ]
        SecItemDelete(query as CFDictionary)
        SecItemAdd(query as CFDictionary, nil)
    }

    public func delete(_ key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key
        ]
        SecItemDelete(query as CFDictionary)
    }
}
