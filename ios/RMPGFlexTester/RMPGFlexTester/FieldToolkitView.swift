import SwiftUI
import AVFoundation
import CoreLocation
import UIKit

// Searchable MDT-style function grid. Every tool in FieldToolRegistry runs
// from here; results render in a sheet (JSON rows, reference card, or timer).
struct FieldToolkitView: View {
    @State private var search = ""
    @State private var activeTool: FieldTool?
    @State private var inputText = ""
    @State private var askingInput: FieldTool?
    @State private var resultTitle = ""
    @State private var resultText: String?
    @State private var resultRows: [[String: Any]] = []
    @State private var showResult = false
    @State private var timerTool: FieldTool?
    @State private var toast: String?
    @State private var showFiSheet = false
    @State private var showPhotoSheet = false
    @State private var showBoloSheet = false
    @State private var showFuelSheet = false
    @State private var queueCount = OfflineQueue.count

    private var filtered: [FieldTool] {
        guard !search.isEmpty else { return FieldToolRegistry.tools }
        return FieldToolRegistry.tools.filter {
            $0.title.localizedCaseInsensitiveContains(search) ||
            $0.category.localizedCaseInsensitiveContains(search)
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 6) {
                TextField("Search \(FieldToolRegistry.tools.count) field functions…", text: $search)
                    .font(.system(size: 13, design: .monospaced))
                    .padding(8).background(Theme.raised)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                    .autocorrectionDisabled()

                if queueCount > 0 {
                    Text("⏳ \(queueCount) action(s) queued offline — tap Sync Offline Queue when back in coverage")
                        .font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.orange)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                if let toast {
                    Text(toast).font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(toast.hasPrefix("✓") ? Theme.gold : Theme.orange)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                ScrollView {
                    ForEach(FieldToolRegistry.categories, id: \.self) { cat in
                        let tools = filtered.filter { $0.category == cat }
                        if !tools.isEmpty {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(cat).font(.system(size: 9, weight: .semibold))
                                    .foregroundStyle(Theme.gold)
                                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 5) {
                                    ForEach(tools) { tool in
                                        Button { run(tool) } label: {
                                            Text(tool.title)
                                                .font(.system(size: 11, weight: .medium))
                                                .frame(maxWidth: .infinity, minHeight: 34)
                                                .padding(.horizontal, 4)
                                                .background(Theme.raised)
                                                .foregroundStyle(.white)
                                                .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                                        }
                                    }
                                }
                            }
                            .padding(.bottom, 8)
                        }
                    }
                }
            }
            .padding(12)
            .background(Theme.base)
            .navigationTitle("FIELD TOOLKIT")
            .navigationBarTitleDisplayMode(.inline)
            .alert(askingInput?.title ?? "", isPresented: Binding(
                get: { askingInput != nil }, set: { if !$0 { askingInput = nil } })) {
                TextField(promptFor(askingInput), text: $inputText)
                Button("Run") {
                    if let tool = askingInput { Task { await execute(tool, input: inputText) } }
                    askingInput = nil
                }
                Button("Cancel", role: .cancel) { askingInput = nil }
            }
            .sheet(isPresented: $showResult) { resultSheet }
            .sheet(isPresented: $showFiSheet) {
                FieldInterviewForm { body, label in
                    Task { await submit("POST", "api/field-interviews", body: body, label: label) }
                }
                .presentationBackground(Theme.base)
            }
            .sheet(isPresented: $showPhotoSheet) { FieldPhotoSheet() }
            .sheet(isPresented: $showBoloSheet) { BoloComposer() }
            .sheet(isPresented: $showFuelSheet) { FuelPurchaseSheet().presentationBackground(Theme.base) }
            .sheet(item: $timerTool) { tool in
                if case .timer(let label, let seconds) = tool.action {
                    FieldTimerView(label: label, totalSeconds: seconds)
                        .presentationBackground(Theme.base)
                }
            }
        }
    }

    private func promptFor(_ tool: FieldTool?) -> String {
        if case .lookup(_, _, let prompt) = tool?.action { return prompt ?? "" }
        if case .addCallNote = tool?.action { return "Note text" }
        return ""
    }

    @ViewBuilder
    private var resultSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    if let resultText {
                        Text(resultText)
                            .font(.system(size: 13, design: .monospaced))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .textSelection(.enabled)
                    }
                    ForEach(Array(resultRows.enumerated()), id: \.offset) { _, row in
                        VStack(alignment: .leading, spacing: 2) {
                            ForEach(row.keys.sorted(), id: \.self) { key in
                                let value = "\(row[key] ?? "")"
                                if !value.isEmpty && value != "<null>" {
                                    HStack(alignment: .top) {
                                        Text(key).font(.system(size: 9, weight: .semibold))
                                            .foregroundStyle(Theme.gold)
                                            .frame(width: 110, alignment: .leading)
                                        Text(value).font(.system(size: 11, design: .monospaced))
                                            .foregroundStyle(.white)
                                            .textSelection(.enabled)
                                    }
                                }
                            }
                        }
                        .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.raised)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                    }
                }
                .padding(12)
            }
            .background(Theme.base)
            .navigationTitle(resultTitle)
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationBackground(Theme.base)
    }

    // ── Dispatch a tool ─────────────────────────────────────

    private func run(_ tool: FieldTool) {
        switch tool.action {
        case .lookup(_, let key, _) where key != nil:
            inputText = ""
            askingInput = tool
        case .addCallNote:
            inputText = ""
            askingInput = tool
        case .timer:
            timerTool = tool
        case .reference(let text):
            resultTitle = tool.title; resultText = text; resultRows = []; showResult = true
        case .torch(let on):
            setTorch(on); toast = on ? "✓ Flashlight on" : "✓ Flashlight off"
        case .torchStrobe:
            strobe(); toast = "✓ Strobing 5×"
        case .fieldInterview:
            showFiSheet = true
        case .fieldPhoto:
            showPhotoSheet = true
        case .newBolo:
            showBoloSheet = true
        case .fuelPurchase:
            showFuelSheet = true
        case .syncQueue:
            Task { await syncQueue() }
        case .coordinates:
            if let loc = LocationManager.shared.last {
                let text = String(format: "%.6f, %.6f  (±%.0fm)",
                                  loc.coordinate.latitude, loc.coordinate.longitude, loc.horizontalAccuracy)
                UIPasteboard.general.string = text
                resultTitle = "MY COORDINATES"
                resultText = text + "\n\nCopied to clipboard.\nElevation: \(Int(loc.altitude)) m"
                resultRows = []; showResult = true
            } else {
                LocationManager.shared.start(); toast = "✗ No GPS fix yet — try again"
            }
        default:
            Task { await execute(tool, input: nil) }
        }
    }

    @MainActor
    private func execute(_ tool: FieldTool, input: String?) async {
        toast = nil
        var client = AppConfig.apiClient()
        if client.jwt == nil,
           let user = KeychainStore.load(key: "rmpgUser"),
           let pass = KeychainStore.load(key: "rmpgPass"), !user.isEmpty,
           let token = try? await client.login(username: user, password: pass) {
            KeychainStore.save(token, key: "rmpgJWT"); client.jwt = token
        }
        guard client.jwt != nil else { toast = "✗ Set RMPG credentials in Settings"; return }

        do {
            switch tool.action {
            case .lookup(let path, let key, _):
                var full = path
                if let key, let input, !input.isEmpty {
                    let q = input.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? input
                    full += (path.contains("?") ? "&" : "?") + "\(key)=\(q)"
                }
                let json = try await client.requestJSON("GET", full)
                show(tool.title, json: json)
            case .createCall(let type, let priority, let desc):
                var body: [String: Any] = [
                    "incident_type": type, "priority": priority,
                    "description": desc, "source": "ios-field-app",
                ]
                if let loc = LocationManager.shared.last {
                    body["latitude"] = loc.coordinate.latitude
                    body["longitude"] = loc.coordinate.longitude
                    body["location_address"] = String(format: "GPS %.5f, %.5f",
                                                      loc.coordinate.latitude, loc.coordinate.longitude)
                } else {
                    body["location_address"] = "Officer location (no GPS fix)"
                }
                let res = try await client.requestJSON("POST", "api/dispatch/calls", body: body)
                let num = ((res as? [String: Any])?["call_number"] as? String)
                    ?? ((res as? [String: Any])?["call"] as? [String: Any])?["call_number"] as? String ?? ""
                toast = "✓ \(tool.title) call opened \(num) — on the dispatch board"
            case .unitStatus(let status):
                guard let unitId = await myUnitId(client) else { toast = "✗ No unit assigned"; return }
                try await client.requestJSON("PUT", "api/dispatch/units/\(unitId)/status",
                                             body: ["status": status])
                toast = "✓ Status → \(tool.title)"
            case .clearCall(let dispo):
                guard let callId = await myCallId(client) else { toast = "✗ No active call on your unit"; return }
                try await client.requestJSON("PUT", "api/dispatch/calls/\(callId)/status",
                                             body: ["status": "closed", "disposition": dispo])
                toast = "✓ Call cleared: \(dispo)"
            case .addCallNote:
                guard let callId = await myCallId(client) else { toast = "✗ No active call on your unit"; return }
                guard let input, !input.isEmpty else { return }
                try await client.requestJSON("PUT", "api/dispatch/calls/\(callId)",
                                             body: ["notes": input])
                toast = "✓ Note added to call"
            case .pingLocation:
                guard let loc = LocationManager.shared.last else { toast = "✗ No GPS fix"; return }
                try await client.requestJSON("POST", "api/dispatch/gps", body: [
                    "latitude": loc.coordinate.latitude, "longitude": loc.coordinate.longitude,
                    "accuracy": loc.horizontalAccuracy, "source": "ios-field-app-ping",
                ])
                toast = "✓ Location pinged to dispatch map"
            case .shiftTimer:
                let state = try await client.requestJSON("GET", "api/dispatch/duty/me")
                let entry = (state as? [String: Any])?["time_entry"] as? [String: Any]
                resultTitle = "SHIFT TIMER"
                if let start = entry?["clock_in"] as? String ?? entry?["start_time"] as? String {
                    resultText = "On duty since \(start) UTC"
                } else {
                    resultText = "Not currently on shift."
                }
                resultRows = []; showResult = true
            default: break
            }
        } catch where OfflineQueue.isTransport(error) {
            // Dead zone: writes are queued for store-and-forward; reads just fail.
            switch tool.action {
            case .createCall, .unitStatus, .clearCall, .addCallNote, .pingLocation:
                queueWrite(tool)
            default:
                toast = "✗ No signal — try again in coverage"
            }
        } catch {
            toast = "✗ \(error.localizedDescription)"
        }
    }

    /// Re-derive the request a write-tool would have made and queue it.
    private func queueWrite(_ tool: FieldTool) {
        switch tool.action {
        case .createCall(let type, let priority, let desc):
            var body: [String: Any] = ["incident_type": type, "priority": priority,
                                       "description": desc, "source": "ios-field-app-offline"]
            if let loc = LocationManager.shared.last {
                body["latitude"] = loc.coordinate.latitude
                body["longitude"] = loc.coordinate.longitude
                body["location_address"] = String(format: "GPS %.5f, %.5f",
                                                  loc.coordinate.latitude, loc.coordinate.longitude)
            } else { body["location_address"] = "Officer location (offline)" }
            OfflineQueue.enqueue(method: "POST", path: "api/dispatch/calls", body: body, label: tool.title)
        default:
            // Status/clear/note need live unit/call ids — too stale to replay blind.
            toast = "✗ No signal — \(tool.title) needs a live connection"
            return
        }
        queueCount = OfflineQueue.count
        toast = "⏳ \(tool.title) queued — will send when back in coverage"
    }

    @MainActor
    private func submit(_ method: String, _ path: String, body: [String: Any], label: String) async {
        var client = AppConfig.apiClient()
        if client.jwt == nil,
           let user = KeychainStore.load(key: "rmpgUser"),
           let pass = KeychainStore.load(key: "rmpgPass"),
           let token = try? await client.login(username: user, password: pass) {
            KeychainStore.save(token, key: "rmpgJWT"); client.jwt = token
        }
        do {
            try await client.requestJSON(method, path, body: body)
            toast = "✓ \(label) submitted"
        } catch where OfflineQueue.isTransport(error) {
            OfflineQueue.enqueue(method: method, path: path, body: body, label: label)
            queueCount = OfflineQueue.count
            toast = "⏳ \(label) queued offline"
        } catch {
            toast = "✗ \(label): \(error.localizedDescription)"
        }
    }

    @MainActor
    private func syncQueue() async {
        guard OfflineQueue.count > 0 else { toast = "✓ Queue empty"; return }
        var client = AppConfig.apiClient()
        if client.jwt == nil,
           let user = KeychainStore.load(key: "rmpgUser"),
           let pass = KeychainStore.load(key: "rmpgPass"),
           let token = try? await client.login(username: user, password: pass) {
            KeychainStore.save(token, key: "rmpgJWT"); client.jwt = token
        }
        let (sent, rejected) = await OfflineQueue.flush(using: client)
        queueCount = OfflineQueue.count
        var parts: [String] = []
        if !sent.isEmpty { parts.append("✓ Sent: \(sent.joined(separator: ", "))") }
        if !rejected.isEmpty { parts.append("✗ Rejected: \(rejected.joined(separator: "; "))") }
        if queueCount > 0 { parts.append("⏳ \(queueCount) still queued (offline)") }
        toast = parts.isEmpty ? "✓ Queue empty" : parts.joined(separator: "  ")
    }

    private func show(_ title: String, json: Any) {
        resultTitle = title
        resultText = nil
        if let arr = json as? [[String: Any]] {
            resultRows = Array(arr.prefix(25))
        } else if let obj = json as? [String: Any] {
            // Unwrap common list envelopes: {data:[…]} {results:[…]} {calls:[…]}…
            if let arr = (obj["data"] ?? obj["results"] ?? obj["calls"] ?? obj["items"]) as? [[String: Any]] {
                resultRows = Array(arr.prefix(25))
            } else {
                resultRows = [obj]
            }
        } else {
            resultRows = []; resultText = "\(json)"
        }
        if resultRows.isEmpty && resultText == nil { resultText = "No results." }
        showResult = true
    }

    private func myUnitId(_ client: RMPGAPIClient) async -> Int? {
        let state = try? await client.requestJSON("GET", "api/dispatch/duty/me")
        return ((state as? [String: Any])?["unit"] as? [String: Any])?["id"] as? Int
    }

    private func myCallId(_ client: RMPGAPIClient) async -> Int? {
        let state = try? await client.requestJSON("GET", "api/dispatch/duty/me")
        return ((state as? [String: Any])?["unit"] as? [String: Any])?["current_call_id"] as? Int
    }

    // ── Torch ───────────────────────────────────────────────

    private func setTorch(_ on: Bool) {
        guard let device = AVCaptureDevice.default(for: .video), device.hasTorch else { return }
        try? device.lockForConfiguration()
        device.torchMode = on ? .on : .off
        device.unlockForConfiguration()
    }

    private func strobe() {
        Task {
            for _ in 0..<5 {
                setTorch(true); try? await Task.sleep(for: .milliseconds(150))
                setTorch(false); try? await Task.sleep(for: .milliseconds(150))
            }
        }
    }
}

// Count-up or countdown timer with start time logged for reports.
struct FieldTimerView: View {
    let label: String
    let totalSeconds: Int
    @State private var elapsed = 0
    @State private var startedAt = Date()
    @State private var running = true

    private var remaining: Int { max(totalSeconds - elapsed, 0) }
    private var display: Int { totalSeconds > 0 ? remaining : elapsed }
    private var done: Bool { totalSeconds > 0 && remaining == 0 }

    var body: some View {
        VStack(spacing: 14) {
            Text(label).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.gold)
            Text(String(format: "%02d:%02d", display / 60, display % 60))
                .font(.system(size: 64, weight: .bold, design: .monospaced))
                .foregroundStyle(done ? Theme.gold : .white)
            Text("Started \(startedAt.formatted(date: .omitted, time: .standard))")
                .font(.system(size: 11, design: .monospaced)).foregroundStyle(Theme.neutral)
            if done {
                Text("✓ TIME SATISFIED").font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.gold)
            }
            Button(running ? "PAUSE" : "RESUME") { running.toggle() }
                .font(.system(size: 12, weight: .semibold))
                .padding(.horizontal, 24).padding(.vertical, 8)
                .background(Theme.raised).foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
        }
        .padding(30)
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                if running { elapsed += 1 }
            }
        }
    }
}
