import SwiftUI


@MainActor
public final class DispatchViewModel: ObservableObject {
    @Published public var calls: [CallForService] = []
    @Published public var units: [Unit] = []
    @Published public var stats: DispatchStats?
    @Published public var welfareWatches: [WelfareCheck] = []
    @Published public var isLoading = false
    @Published public var errorMessage: String?
    @Published public var selectedStatus: String?

    let api: DispatchAPI
    private var refreshTask: Task<Void, Never>?

    public init(api: DispatchAPI) {
        self.api = api
    }

    public func refresh() {
        refreshTask?.cancel()
        refreshTask = Task { [weak self] in
            guard let self else { return }
            isLoading = true
            // The calls/units list is the load-bearing part of this screen —
            // fetched with `try await` so a real failure surfaces as an error.
            // stats and welfare watches are supplementary banners; a prior
            // version fetched all four in one `try await (a,b,c)` tuple,
            // which meant a single bad endpoint (the stats 404 fixed
            // alongside this) failed the ENTIRE refresh and blanked the call
            // list even though calls/units themselves loaded fine. Now they
            // degrade independently instead of taking the whole screen down.
            do {
                async let callsResult = api.listCalls(status: selectedStatus)
                async let unitsResult = api.listUnits()
                let (c, u) = try await (callsResult, unitsResult)
                calls = c
                units = u
                errorMessage = nil
            } catch {
                if !Task.isCancelled {
                    errorMessage = error.localizedDescription
                }
            }

            async let statsResult = try? api.getDispatchStats()
            async let welfareResult = try? api.listWelfareActive()
            stats = await statsResult
            welfareWatches = await welfareResult ?? []

            isLoading = false
        }
    }

    public func createCall(_ req: CreateCallRequest) async throws -> CallForService {
        let call = try await api.createCall(req)
        calls.insert(call, at: 0)
        return call
    }

    public func updateCallStatus(id: Int, status: String, disposition: String? = nil) async throws {
        let updated = try await api.updateCallStatus(id: id, status: status, disposition: disposition)
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
