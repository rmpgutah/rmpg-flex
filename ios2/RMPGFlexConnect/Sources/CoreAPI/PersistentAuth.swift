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

    public init(accessGroup: String? = "group.com.rmpg.flex") {
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
        query[kSecAttrSynchronizable as String] = kCFBooleanTrue

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func write(_ value: String, key: String) {
        let data = value.data(using: .utf8)!
        var query = self.query(for: key)
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        query[kSecAttrSynchronizable as String] = kCFBooleanTrue

        SecItemDelete(query as CFDictionary)
        let status = SecItemAdd(query as CFDictionary, nil)
        if status == errSecDuplicateItem {
            var attrs: [String: Any] = [kSecValueData as String: data]
            SecItemUpdate(query as CFDictionary, attrs as CFDictionary)
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
