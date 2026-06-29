import SwiftUI
import CoreAPI

@MainActor
public final class DispatchViewModel: ObservableObject {
    @Published public var calls: [CallForService] = []
    @Published public var units: [Unit] = []
    @Published public var stats: DispatchStats?
    @Published public var isLoading = false
    @Published public var errorMessage: String?
    @Published public var selectedStatus: String?

    private let api: DispatchAPI
    private var refreshTask: Task<Void, Never>?

    public init(api: DispatchAPI) {
        self.api = api
    }

    public func refresh() {
        refreshTask?.cancel()
        refreshTask = Task { [weak self] in
            guard let self else { return }
            isLoading = true
            do {
                async let callsResult = api.listCalls(status: selectedStatus)
                async let unitsResult = api.listUnits()
                async let statsResult = api.getDispatchStats()

                let (c, u, s) = try await (callsResult, unitsResult, statsResult)
                calls = c
                units = u
                stats = s
                errorMessage = nil
            } catch {
                if !Task.isCancelled {
                    errorMessage = error.localizedDescription
                }
            }
            isLoading = false
        }
    }

    public func createCall(_ req: CreateCallRequest) async throws -> CallForService {
        let call = try await api.createCall(req)
        calls.insert(call, at: 0)
        return call
    }

    public func updateCallStatus(id: Int, status: String) async throws {
        let updated = try await api.updateCall(id: id, body: ["status": status])
        if let idx = calls.firstIndex(where: { $0.id == id }) {
            calls[idx] = updated
        }
    }

    public func triggerPanic() async {
        do {
            _ = try await api.triggerPanic()
            errorMessage = nil
        } catch {
            errorMessage = "Panic failed: \(error.localizedDescription)"
        }
    }
}
