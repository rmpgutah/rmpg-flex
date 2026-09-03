import SwiftUI



// Two-way phone <-> in-vehicle MDT link, using the same message-relay
// channel the web client's MDTBridge.tsx/MdtPage.tsx already rely on
// (src/routes/mdt.ts). Lets an officer see whether their vehicle's MDT is
// online and exchange messages with it from a remote position, not just
// push a one-way scan (QuickActionsViewModel.pushToMDT).
//
// design: docs/superpowers/specs/2026-07-07-ios-mdt-link-screen-design.md

public struct MDTInboxMessage: Decodable, Sendable, Identifiable {
    public let id: Int
    public let type: String
    public let payload: [String: MDTJSONValue]
    public let created_at: String

    /// The one field this screen actually displays. Non-text message types
    /// (person/plate/scan/etc, used by the scan-push flow) still show up in
    /// the list with a generic label rather than being silently dropped.
    public var displayText: String {
        if case .string(let s)? = payload["text"] { return s }
        switch type {
        case "person": return "Subject scan sent to MDT"
        case "plate": return "Plate scan sent to MDT"
        default: return "(\(type) message)"
        }
    }
}

/// Minimal permissive JSON value — MDT payloads are a free-form
/// `Record<string, unknown>` server-side, and this screen only ever reads
/// the `text` field back out, so no need for a full typed payload model.
public enum MDTJSONValue: Decodable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null
    case other

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) { self = .string(s); return }
        if let d = try? c.decode(Double.self) { self = .number(d); return }
        if let b = try? c.decode(Bool.self) { self = .bool(b); return }
        if c.decodeNil() { self = .null; return }
        self = .other
    }
}

struct MDTInboxResponse: Decodable, Sendable {
    let messages: [MDTInboxMessage]
    let counterpart_online: Bool
}

@MainActor
final class MDTLinkViewModel: ObservableObject {
    @Published var messages: [MDTInboxMessage] = []
    @Published var mdtOnline = false
    @Published var draft = ""
    @Published var sendError: String?
    @Published var isSending = false

    private let client: APIClient
    private var pollTask: Task<Void, Never>?

    init(client: APIClient) {
        self.client = client
    }

    func startPolling() {
        stopPolling()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.pollOnce()
                try? await Task.sleep(nanoseconds: 8_000_000_000)
            }
        }
    }

    func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }

    /// Failures here are silent (matches LocationTracker's flush loop
    /// philosophy) — a transient blip on a passive background poll
    /// shouldn't interrupt the officer with an error banner.
    private func pollOnce() async {
        do {
            let endpoint = Endpoint(path: "/api/mdt/inbox", queryItems: [URLQueryItem(name: "endpoint", value: "phone")])
            let response: MDTInboxResponse = try await client.request(endpoint)
            if !response.messages.isEmpty {
                messages.append(contentsOf: response.messages)
            }
            mdtOnline = response.counterpart_online
        } catch {
            // transient — next poll will retry
        }
    }

    func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isSending else { return }
        isSending = true
        sendError = nil
        do {
            let payload: [String: Any] = ["to": "mdt", "type": "text", "payload": ["text": text]]
            let body = try JSONSerialization.data(withJSONObject: payload)
            try await client.requestVoid(Endpoint(path: "/api/mdt/send", method: .post, body: body))
            draft = ""
        } catch {
            sendError = "Failed to send: \(error.localizedDescription)"
        }
        isSending = false
    }
}

public struct MDTLinkView: View {
    @StateObject private var vm: MDTLinkViewModel

    public init(apiClient: APIClient) {
        _vm = StateObject(wrappedValue: MDTLinkViewModel(client: apiClient))
    }

    public var body: some View {
        VStack(spacing: 0) {
            statusPill
            Divider().background(Color(hex: "1a1a1a"))
            messageList
            if let error = vm.sendError {
                Text(error).font(.system(size: 11)).foregroundColor(Color(hex: "ef4444")).padding(.horizontal, 12).padding(.top, 4)
            }
            composer
        }
        .background(Color(hex: "0a0a0a").ignoresSafeArea())
        .navigationTitle("Vehicle MDT")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { vm.startPolling() }
        .onDisappear { vm.stopPolling() }
    }

    private var statusPill: some View {
        HStack(spacing: 6) {
            Circle().fill(vm.mdtOnline ? Color(hex: "22c55e") : Color(hex: "555555")).frame(width: 8, height: 8)
            Text(vm.mdtOnline ? "MDT ONLINE" : "MDT OFFLINE")
                .font(.system(size: 11, weight: .semibold)).tracking(1)
                .foregroundColor(vm.mdtOnline ? Color(hex: "22c55e") : Color(hex: "888888"))
            Spacer()
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(Color(hex: "141414"))
    }

    private var messageList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 8) {
                if vm.messages.isEmpty {
                    Text("No messages from the vehicle MDT yet.")
                        .font(.system(size: 12)).foregroundColor(Color(hex: "555555"))
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.top, 40)
                } else {
                    ForEach(vm.messages) { msg in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(msg.displayText).font(.system(size: 13)).foregroundColor(.white)
                            Text(msg.created_at).font(.system(size: 9)).foregroundColor(Color(hex: "555555"))
                        }
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color(hex: "141414")).cornerRadius(2)
                        .padding(.horizontal, 12)
                    }
                }
            }
            .padding(.vertical, 12)
        }
    }

    private var composer: some View {
        HStack(spacing: 8) {
            TextField("Message the vehicle MDT…", text: $vm.draft)
                .font(.system(size: 13))
                .padding(.horizontal, 12).padding(.vertical, 10)
                .background(Color(hex: "141414")).cornerRadius(2)
                .foregroundColor(.white)

            Button {
                Task { await vm.send() }
            } label: {
                if vm.isSending {
                    ProgressView().tint(.black)
                } else {
                    Image(systemName: "arrow.up.circle.fill").font(.system(size: 28))
                }
            }
            .disabled(vm.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || vm.isSending)
            .foregroundColor(Color(hex: "d4a017"))
        }
        .padding(12)
        .background(Color(hex: "141414"))
    }
}
