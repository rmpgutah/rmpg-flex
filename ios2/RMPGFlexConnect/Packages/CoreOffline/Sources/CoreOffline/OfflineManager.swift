import Foundation
import SwiftData
import Network

public actor OfflineManager {
    private let drainer: OutboxDrainer
    private let monitor: NWPathMonitor
    private var isDraining = false

    public var onConnectivityChanged: (@Sendable (Bool) -> Void)?

    public var isOnline: Bool { monitor.currentPath.status == .satisfied }

    public init(modelContainer: ModelContainer, apiBaseURL: URL, tokenProvider: @escaping @Sendable () -> String?) {
        self.drainer = OutboxDrainer(modelContainer: modelContainer, apiBaseURL: apiBaseURL, tokenProvider: tokenProvider)
        self.monitor = NWPathMonitor()
    }

    public func startMonitoring() {
        monitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            Task { [weak self] in
                await self?.handleConnectivityChange(online: online)
            }
        }
        monitor.start(queue: DispatchQueue.global(qos: .background))
    }

    private func handleConnectivityChange(online: Bool) async {
        onConnectivityChanged?(online)
        if online { await drainIfNeeded() }
    }

    public func drainIfNeeded() async {
        guard !isDraining else { return }
        isDraining = true
        defer { isDraining = false }
        _ = try? await drainer.drainBatch()
    }

    public func enqueue(context: ModelContext, entry: OutboxEntry) {
        context.insert(entry)
        try? context.save()
    }

    deinit {
        monitor.cancel()
    }
}
