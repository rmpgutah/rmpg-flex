import Foundation
import Security

/// Thin wrapper around the iOS Keychain Generic Password class.
/// Stores secrets accessible only after first device unlock and bound to this device.
public enum KeychainStore {
    /// Service identifier used to scope all RMPG Flex Connect entries.
    public static let service = "us.rmpgutah.flexconnect"

    public enum KeychainError: Error, Equatable {
        case osStatus(OSStatus)
        case encodingFailed
        case decodingFailed
    }

    @discardableResult
    public static func set(_ value: String, forKey key: String) throws -> Bool {
        guard let data = value.data(using: .utf8) else { throw KeychainError.encodingFailed }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        let attrs: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let updateStatus = SecItemUpdate(query as CFDictionary, attrs as CFDictionary)
        if updateStatus == errSecSuccess { return true }
        if updateStatus == errSecItemNotFound {
            let addStatus = SecItemAdd(query.merging(attrs, uniquingKeysWith: { $1 }) as CFDictionary, nil)
            if addStatus == errSecSuccess { return true }
            throw KeychainError.osStatus(addStatus)
        }
        throw KeychainError.osStatus(updateStatus)
    }

    public static func get(_ key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    public static func delete(_ key: String) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        return SecItemDelete(query as CFDictionary) == errSecSuccess
    }
}
