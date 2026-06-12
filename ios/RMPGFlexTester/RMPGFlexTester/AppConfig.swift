import Foundation

// Central place views use to build clients from Keychain-stored credentials.
enum AppConfig {
    static let liveDatabaseId = "785de7ae-3e7a-4e01-93bb-d24ddd813f6b"

    static func d1Client() -> D1Client? {
        guard let account = KeychainStore.load(key: "cfAccountId"), !account.isEmpty,
              let token = KeychainStore.load(key: "cfToken"), !token.isEmpty else {
            return nil
        }
        let db = KeychainStore.load(key: "cfDatabaseId").flatMap { $0.isEmpty ? nil : $0 }
        return D1Client(accountId: account, databaseId: db ?? liveDatabaseId, apiToken: token)
    }

    static func apiClient() -> RMPGAPIClient {
        RMPGAPIClient(jwt: KeychainStore.load(key: "rmpgJWT"))
    }
}
