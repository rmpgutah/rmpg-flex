import Foundation
import Observation

@Observable
@MainActor
public final class CallsViewModel {
    public private(set) var calls: [ActiveCall] = []
    public private(set) var isLoading = false
    public private(set) var error: String?

    private let api: CFSAPI

    public init(api: CFSAPI) {
        self.api = api
    }

    public var activeCalls: [ActiveCall] { calls.filter { $0.status != "closed" && $0.status != "archived" } }

    public func refresh() async {
        isLoading = true
        error = nil
        do {
            calls = try await api.fetchActiveCalls()
        } catch {
            self.error = "Could not load calls: \(error.localizedDescription)"
        }
        isLoading = false
    }
}
