import SwiftUI
import AudioToolbox

// CallsQueueView — live CAD queue + self-dispatch. Polls the active calls board
// and the officer's own duty state; an officer can self-assign their unit to a
// call (POST /dispatch/calls/:id/assign-unit) and drive their status
// (en route / on scene / clear via PUT /dispatch/units/:id/status). Their own
// assigned call is pinned + highlighted at the top.
struct CallsQueueView: View {
    @State private var calls: [[String: Any]] = []
    @State private var myUnitId: Int?
    @State private var myCallId: Int?
    @State private var myUnitStatus = ""
    @State private var loading = true
    @State private var working = false
    @State private var status: String?
    @State private var actionTarget: ActionTarget?

    private struct ActionTarget: Identifiable { let id: Int; let number: String }

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                if let myUnitId {
                    Text("Your unit #\(myUnitId) · \(FieldFormat.value("status", myUnitStatus))")
                        .font(.system(size: 10)).foregroundStyle(Theme.neutral)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else if !loading {
                    Text("Start a shift in Field Ops to self-assign to calls.")
                        .font(.system(size: 11)).foregroundStyle(Theme.orange)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                if loading {
                    ProgressView().tint(Theme.gold).padding(.top, 30)
                } else if calls.isEmpty {
                    Text("No active calls.").font(.system(size: 12)).foregroundStyle(Theme.neutral).padding(.top, 24)
                } else {
                    ForEach(sortedCalls.indices, id: \.self) { i in callRow(sortedCalls[i]) }
                }
                if let status { StatusLine(text: status) }
            }
            .padding(12)
        }
        .background(Theme.base)
        .navigationTitle("CALLS QUEUE")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $actionTarget) { CfsActionsView(callId: $0.id, callNumber: $0.number) }
        .refreshable { await refresh() }
        .task {
            await load()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                await refresh()
            }
        }
    }

    // My call first, then by priority (1 highest), then newest id.
    private var sortedCalls: [[String: Any]] {
        calls.sorted { a, b in
            let am = (a["id"] as? Int) == myCallId, bm = (b["id"] as? Int) == myCallId
            if am != bm { return am }
            let ap = a["priority"] as? Int ?? 9, bp = b["priority"] as? Int ?? 9
            if ap != bp { return ap < bp }
            return (a["id"] as? Int ?? 0) > (b["id"] as? Int ?? 0)
        }
    }

    @ViewBuilder
    private func callRow(_ call: [String: Any]) -> some View {
        let id = call["id"] as? Int ?? 0
        let mine = id == myCallId
        let priority = call["priority"] as? Int ?? 0
        let type = (call["incident_type"] as? String) ?? (call["call_type"] as? String) ?? "CALL"
        let addr = (call["address"] as? String) ?? (call["location"] as? String) ?? ""
        let callNo = call["call_number"] as? String ?? "#\(id)"
        let st = call["status"] as? String ?? ""

        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text("P\(priority > 0 ? String(priority) : "—")")
                    .font(.system(size: 10, weight: .bold))
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(priorityColor(priority).opacity(0.22))
                    .foregroundStyle(priorityColor(priority))
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                Text(callNo).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white)
                Spacer()
                Text(FieldFormat.value("status", st)).font(.system(size: 10)).foregroundStyle(Theme.neutral)
            }
            Text(type).font(.system(size: 13, weight: .semibold)).foregroundStyle(mine ? Theme.gold : .white)
            if !addr.isEmpty { Text(addr).font(.system(size: 11)).foregroundStyle(Color(hex: 0xbbbbbb)) }

            HStack(spacing: 6) {
                if mine {
                    actionButton("En Route", "enroute")
                    actionButton("On Scene", "on_scene")
                    actionButton("Clear", "available")
                } else if myUnitId != nil {
                    Button { Task { await assign(id) } } label: {
                        Text("Assign to me").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(GoldButtonStyle())
                    .disabled(working)
                }
                Button { actionTarget = ActionTarget(id: id, number: callNo) } label: {
                    Image(systemName: "ellipsis.circle.fill")
                        .font(.system(size: 22)).foregroundStyle(Theme.gold)
                }
                .accessibilityLabel("Call actions")
            }
            .padding(.top, 2)
        }
        .themeCard()
        .overlay(
            RoundedRectangle(cornerRadius: Theme.radius)
                .stroke(mine ? Theme.gold : Color.clear, lineWidth: mine ? 1 : 0)
        )
    }

    private func actionButton(_ title: String, _ value: String) -> some View {
        Button { Task { await setUnitStatus(value) } } label: {
            Text(title).frame(maxWidth: .infinity)
        }
        .buttonStyle(RaisedButtonStyle())
        .disabled(working || myUnitStatus == value)
    }

    private func priorityColor(_ p: Int) -> Color {
        switch p { case 1: return Theme.red; case 2: return Theme.orange; default: return Theme.gold }
    }

    // ── Networking ──────────────────────────────────────────
    private func client() async -> RMPGAPIClient? {
        var c = AppConfig.apiClient()
        if c.jwt == nil,
           let u = KeychainStore.load(key: "rmpgUser"), let p = KeychainStore.load(key: "rmpgPass"),
           !u.isEmpty, let t = try? await c.login(username: u, password: p) {
            KeychainStore.save(t, key: "rmpgJWT"); c.jwt = t
        }
        return c.jwt == nil ? nil : c
    }

    private func authed(_ work: (RMPGAPIClient) async throws -> Void) async {
        guard let c = await client() else { status = "✗ Set RMPG credentials in Settings"; return }
        do { try await work(c) } catch { status = "✗ \(error.localizedDescription)" }
    }

    private func asRows(_ any: Any?) -> [[String: Any]] {
        if let arr = any as? [[String: Any]] { return arr }
        if let obj = any as? [String: Any] {
            for k in ["results", "calls", "data", "rows"] {
                if let arr = obj[k] as? [[String: Any]] { return arr }
            }
        }
        return []
    }

    @MainActor private func load() async { await refresh(); loading = false }

    @MainActor
    private func refresh() async {
        await authed { c in
            if let duty = try await c.requestJSON("GET", "api/dispatch/duty/me") as? [String: Any],
               let unit = duty["unit"] as? [String: Any] {
                myUnitId = unit["id"] as? Int
                myCallId = unit["current_call_id"] as? Int
                myUnitStatus = unit["status"] as? String ?? ""
            }
            calls = asRows(try await c.requestJSON("GET", "api/dispatch/calls?status=active"))
        }
    }

    @MainActor
    private func assign(_ callId: Int) async {
        guard let unitId = myUnitId else { status = "✗ No unit — start a shift first"; return }
        working = true; defer { working = false }
        AudioServicesPlaySystemSound(SystemSoundID(kSystemSoundID_Vibrate))
        await authed { c in
            try await c.requestJSON("POST", "api/dispatch/calls/\(callId)/assign-unit", body: ["unit_id": unitId])
            // Auto-advance to En Route on self-assign (Spillman convention).
            _ = try? await c.requestJSON("PUT", "api/dispatch/units/\(unitId)/status", body: ["status": "enroute"])
            status = "✓ Assigned — en route"
        }
        await refresh()
    }

    @MainActor
    private func setUnitStatus(_ value: String) async {
        guard let unitId = myUnitId else { return }
        working = true; defer { working = false }
        await authed { c in
            try await c.requestJSON("PUT", "api/dispatch/units/\(unitId)/status", body: ["status": value])
            status = "✓ \(FieldFormat.value("status", value))"
        }
        await refresh()
    }
}
