import Foundation
import Network
import Combine

// Network reachability. NWPathMonitor publishes online/offline so the UI can
// show a status pill and OfflineSync can auto-replay the queue when signal
// returns.
@MainActor
final class Connectivity: ObservableObject {
    static let shared = Connectivity()
    @Published private(set) var isOnline = true

    private let monitor = NWPathMonitor()

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in self?.isOnline = (path.status == .satisfied) }
        }
        monitor.start(queue: DispatchQueue(label: "rmpg.connectivity"))
    }
}
