import Foundation

// Central place views use to build the API client from Keychain-stored creds.
enum AppConfig {
    static func apiClient() -> RMPGAPIClient {
        RMPGAPIClient(jwt: KeychainStore.load(key: "rmpgJWT"))
    }
}
