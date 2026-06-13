import SwiftUI

// NotificationsView — the officer's alert inbox: dispatcher alerts, intel hits,
// system messages. Polls GET /api/notifications, renders unread distinctly, taps
// mark one read (PUT /:id/read), and a toolbar action marks all read
// (POST /mark-all-read). Pushed from Field Ops.
struct NotificationsView: View {
    @State private var items: [[String: Any]] = []
    @State private var loading = true
    @State private var working = false
    @State private var status: String?

    private var unreadCount: Int { items.filter { !isRead($0) }.count }

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                if loading {
                    ProgressView().tint(Theme.gold).padding(.top, 30)
                } else if items.isEmpty {
                    Text("No notifications.").font(.system(size: 12)).foregroundStyle(Theme.neutral).padding(.top, 24)
                } else {
                    ForEach(items.indices, id: \.self) { i in row(items[i]) }
                }
                if let status { StatusLine(text: status) }
            }
            .padding(12)
        }
        .background(Theme.base)
        .navigationTitle(unreadCount > 0 ? "NOTIFICATIONS (\(unreadCount))" : "NOTIFICATIONS")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Read all") { Task { await markAllRead() } }
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.gold)
                    .disabled(working || unreadCount == 0)
            }
        }
        .task {
            await load()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(15))
                await refresh()
            }
        }
    }

    @ViewBuilder
    private func row(_ n: [String: Any]) -> some View {
        let read = isRead(n)
        let title = (n["title"] as? String) ?? (n["subject"] as? String)
            ?? FieldFormat.label((n["type"] as? String) ?? "Notification")
        let message = (n["message"] as? String) ?? (n["body"] as? String) ?? (n["content"] as? String) ?? ""
        let priority = "\(n["priority"] ?? "")".lowercased()
        let when = FieldFormat.prettyDate("\(n["created_at"] ?? "")") ?? ""

        Button { Task { await markRead(n) } } label: {
            HStack(alignment: .top, spacing: 8) {
                Circle()
                    .fill(read ? Theme.border : priorityColor(priority))
                    .frame(width: 8, height: 8)
                    .padding(.top, 4)
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Text(title)
                            .font(.system(size: 13, weight: read ? .regular : .semibold))
                            .foregroundStyle(read ? Color(hex: 0xbbbbbb) : .white)
                        Spacer()
                        if !priority.isEmpty && priority != "normal" && priority != "low" {
                            Text(priority.uppercased())
                                .font(.system(size: 8, weight: .bold))
                                .padding(.horizontal, 5).padding(.vertical, 1)
                                .background(priorityColor(priority).opacity(0.22))
                                .foregroundStyle(priorityColor(priority))
                                .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                        }
                    }
                    if !message.isEmpty {
                        Text(message).font(.system(size: 11)).foregroundStyle(Theme.neutral)
                            .multilineTextAlignment(.leading)
                    }
                    if !when.isEmpty {
                        Text(when).font(.system(size: 9, design: .monospaced)).foregroundStyle(Theme.neutral)
                    }
                }
            }
            .themeCard()
        }
        .buttonStyle(.plain)
    }

    private func isRead(_ n: [String: Any]) -> Bool {
        if let b = n["is_read"] as? Bool { return b }
        if let i = n["is_read"] as? Int { return i != 0 }
        return false
    }

    private func priorityColor(_ p: String) -> Color {
        switch p {
        case "critical", "urgent", "high", "1": return Theme.red
        case "medium", "warning", "2": return Theme.orange
        default: return Theme.gold
        }
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
        if let obj = any as? [String: Any], let arr = obj["data"] as? [[String: Any]] { return arr }
        if let arr = any as? [[String: Any]] { return arr }
        return []
    }

    @MainActor private func load() async { await refresh(); loading = false }

    @MainActor
    private func refresh() async {
        await authed { c in
            items = asRows(try await c.requestJSON("GET", "api/notifications?per_page=50"))
        }
    }

    @MainActor
    private func markRead(_ n: [String: Any]) async {
        guard let id = n["id"] as? Int, !isRead(n) else { return }
        await authed { c in
            _ = try? await c.requestJSON("PUT", "api/notifications/\(id)/read")
        }
        await refresh()
    }

    @MainActor
    private func markAllRead() async {
        working = true; defer { working = false }
        await authed { c in
            try await c.requestJSON("POST", "api/notifications/mark-all-read")
            status = "✓ All marked read"
        }
        await refresh()
    }
}
