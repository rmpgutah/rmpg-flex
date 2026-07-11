import Foundation

@MainActor
public final class AuthManager: ObservableObject {
    @Published public private(set) var isAuthenticated = false
    @Published public private(set) var currentUser: UserProfile?
    @Published public private(set) var authError: String?

    private let apiClient: APIClient
    private let keychain: PersistentAuthProtocol
    private var refreshTask: Task<Void, Error>?

    public init(apiClient: APIClient, keychain: PersistentAuthProtocol = PersistentAuth()) {
        self.apiClient = apiClient
        self.keychain = keychain
        keychain.migrateIfNeeded()
    }

    /// True when a prior login left a session in the Keychain — i.e. this
    /// launch would silently restore a signed-in state via `restoreSession()`.
    /// Callers use this to decide whether to gate the restore behind biometrics.
    public var hasPersistedSession: Bool {
        keychain.storedToken() != nil && keychain.storedRefreshToken() != nil
    }

    public func restoreSession() async {
        guard let token = keychain.storedToken(),
              let refreshToken = keychain.storedRefreshToken() else {
            return
        }
        await apiClient.setAuthToken(token)

        do {
            let response: MeResponse = try await apiClient.request(Endpoint(
                path: "/api/auth/me",
                method: .get
            ))
            currentUser = response.user
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
        keychain.storeToken(response.token)
        keychain.storeRefreshToken(response.refreshToken)
        keychain.storeSessionId(response.sessionId)

        currentUser = response.user
        isAuthenticated = true
        authError = nil
    }

    public func logout() async {
        do {
            try await apiClient.requestVoid(Endpoint(path: "/api/auth/logout", method: .post))
        } catch {}

        await apiClient.setAuthToken(nil)
        keychain.clearAll()
        currentUser = nil
        isAuthenticated = false
    }

    /// POST /api/auth/change-password — verified against src/routes/auth.ts.
    /// This used to call `PUT /api/auth/password` with plain camelCase JSON
    /// keys (`currentPassword`/`newPassword`), but that route destructures
    /// `current_password`/`new_password` (snake_case) with no fallback —
    /// every call would have failed with a 400 "required" error regardless
    /// of what was actually typed. `/change-password` is a dedicated alias
    /// the server documents as existing specifically to accept camelCase
    /// bodies from a client like this one.
    public func changePassword(current: String, new: String) async throws {
        let body = try JSONEncoder().encode(ChangePasswordRequest(
            currentPassword: current,
            newPassword: new
        ))
        try await apiClient.requestVoid(Endpoint(
            path: "/api/auth/change-password",
            method: .post,
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
            keychain.storeToken(response.token)
            keychain.storeRefreshToken(response.refreshToken)

            let meResponse: MeResponse = try await apiClient.request(Endpoint(
                path: "/api/auth/me",
                method: .get
            ))
            currentUser = meResponse.user
            isAuthenticated = true
        } catch {
            await apiClient.setAuthToken(nil)
            keychain.clearAll()
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

public struct MeResponse: Codable, Sendable {
    public let user: UserProfile
}

public struct LoginResponse: Codable, Sendable {
    public let token: String
    public let refreshToken: String
    public let sessionId: String
    public let user: UserProfile
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
