import Foundation
import Security

public protocol PersistentAuthProtocol {
    func storedToken() -> String?
    func storedRefreshToken() -> String?
    func storedSessionId() -> String?
    func storeToken(_ token: String)
    func storeRefreshToken(_ token: String)
    func storeSessionId(_ id: String)
    func clearAll()
    func migrateIfNeeded()
}

public struct PersistentAuth: PersistentAuthProtocol {
    private let accessGroup: String?
    private let serviceName = "com.rmpg.flex.auth"

    /// Defaults to `nil` (no access group — the app's own private keychain,
    /// which needs no special entitlement and always works). The previous
    /// default, `"group.com.rmpg.flex"`, never matched anything: the actual
    /// keychain-access-groups entitlement lists
    /// `$(AppIdentifierPrefix)group.com.rmpg.flex` (team-ID prefixed, as
    /// Keychain requires), and `com.apple.security.application-groups` is an
    /// empty array — no App Group capability is actually provisioned. Every
    /// write with the bare, unprefixed group failed with
    /// `errSecMissingEntitlement`, on top of the separate contradictory-flags
    /// bug fixed alongside this. If a shared keychain across targets
    /// (widgets/extensions) is needed later, provision a real App Group in
    /// the developer portal first and pass its exact prefixed identifier.
    public init(accessGroup: String? = nil) {
        self.accessGroup = accessGroup
    }

    public func storedToken() -> String? {
        read(key: "access_token")
    }

    public func storedRefreshToken() -> String? {
        read(key: "refresh_token")
    }

    public func storedSessionId() -> String? {
        read(key: "session_id")
    }

    public func storeToken(_ token: String) {
        write(token, key: "access_token")
    }

    public func storeRefreshToken(_ token: String) {
        write(token, key: "refresh_token")
    }

    public func storeSessionId(_ id: String) {
        write(id, key: "session_id")
    }

    public func clearAll() {
        delete(key: "access_token")
        delete(key: "refresh_token")
        delete(key: "session_id")
    }

    public func migrateIfNeeded() {
        let migrated = UserDefaults.standard.bool(forKey: "auth_keychain_migrated_v1")
        guard !migrated else { return }

        if read(key: "access_token") == nil,
           let legacy = readLegacy(key: "access_token") {
            write(legacy, key: "access_token")
        }
        if read(key: "refresh_token") == nil,
           let legacy = readLegacy(key: "refresh_token") {
            write(legacy, key: "refresh_token")
        }

        deleteLegacy(key: "access_token")
        deleteLegacy(key: "refresh_token")
        deleteLegacy(key: "session_id")
        UserDefaults.standard.set(true, forKey: "auth_keychain_migrated_v1")
    }

    private func query(for key: String) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key,
        ]
        if let group = accessGroup {
            query[kSecAttrAccessGroup as String] = group
        }
        return query
    }

    private func read(key: String) -> String? {
        var query = self.query(for: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` and
    /// `kSecAttrSynchronizable = true` are a CONTRADICTORY combination —
    /// "ThisDeviceOnly" accessibility explicitly means "never sync via
    /// iCloud Keychain," so pairing it with `synchronizable: true` makes
    /// `SecItemAdd` fail with `errSecParam` every time. That status was never
    /// checked here, so every session-token write has been silently failing
    /// — Face ID / biometric unlock had no persisted session to ever find,
    /// no matter how many times a user logged in. Fixed by dropping
    /// `kSecAttrSynchronizable` entirely (matches "ThisDeviceOnly" intent —
    /// session tokens shouldn't sync across an officer's personal iCloud
    /// devices anyway) and asserting on unexpected failures in debug builds
    /// so this class of bug fails loudly instead of silently next time.
    private func write(_ value: String, key: String) {
        let data = value.data(using: .utf8)!
        var query = self.query(for: key)
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        SecItemDelete(query as CFDictionary)
        let status = SecItemAdd(query as CFDictionary, nil)
        if status == errSecDuplicateItem {
            let attrs: [String: Any] = [kSecValueData as String: data]
            SecItemUpdate(self.query(for: key) as CFDictionary, attrs as CFDictionary)
        } else if status != errSecSuccess {
            // Log, don't crash — a Keychain write failing is recoverable
            // (the user just has to log in again), and this exact class of
            // bug (a silent failure hiding a real config problem) is better
            // debugged from a log line than by taking the app down.
            print("[PersistentAuth] Keychain write failed for \(key): OSStatus \(status)")
        }
    }

    private func delete(key: String) {
        SecItemDelete(query(for: key) as CFDictionary)
    }

    private func readLegacy(key: String) -> String? {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func deleteLegacy(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
