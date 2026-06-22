import Foundation
import CoreAPI
import Observation

/// App-wide auth state. Driven from the Keychain on launch.
///
/// `@Observable` makes this directly SwiftUI-bindable without `@Published`.
@Observable
@MainActor
public final class AuthSession {
    public private(set) var token: String?
    public private(set) var role: AppRole?

    public static let tokenKey = "rmpg_flex_connect_jwt"

    public init() {
        if let stored = KeychainStore.get(Self.tokenKey) {
            self.token = stored
            if let payload = try? JWT.decode(stored) {
                self.role = RoleResolver.resolve(jwtRole: payload.role)
            }
        }
    }

    public var isSignedIn: Bool { token != nil }

    public func signIn(token: String) throws {
        try KeychainStore.set(token, forKey: Self.tokenKey)
        self.token = token
        if let payload = try? JWT.decode(token) {
            self.role = RoleResolver.resolve(jwtRole: payload.role)
        }
    }

    public func signOut() {
        KeychainStore.delete(Self.tokenKey)
        self.token = nil
        self.role = nil
    }
}
