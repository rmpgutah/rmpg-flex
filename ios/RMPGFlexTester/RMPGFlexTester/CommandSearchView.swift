import SwiftUI
import UIKit

// Universal Command Search — the v1.2 "Command Center" front door. One field
// federates the live intel index (GET /api/intel/search) across persons,
// vehicles, calls, warrants, BOLOs; ranks officer-safety hits first; deep-links
// person hits into the caution dossier; hands any hit to the in-car MDT; and,
// when empty, becomes a quick-command launcher into existing field surfaces.
// All parsing/ranking/sniffing lives in CommandSearch.swift (unit-tested).
struct CommandSearchView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var hits: [IntelHit] = []
    @State private var recents: [String] = []
    @State private var searching = false
    @State private var status: String?
    @State private var searchTask: Task<Void, Never>?
    @State private var confirmPanic = false
    @State private var sheet: Sheet?
    @FocusState private var focused: Bool

    private let recentsKey = "rmpgCommandRecents"
    private enum Route: Hashable { case person(Int, String) }
    private enum Sheet: Identifiable {
        case hub, scan, lookup, dar, bolo, photo
        var id: Int { hashValue }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    searchBar
                    if !query.isEmpty, let hint = CommandSearch.sniff(query).label {
                        Label(hint, systemImage: "sparkles")
                            .font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.gold)
                    }
                    if query.trimmingCharacters(in: .whitespaces).count >= 2 {
                        resultsSection
                    } else {
                        paletteSection
                        recentsSection
                    }
                    if let status { StatusLine(text: status) }
                }
                .padding(12)
            }
            .background(Theme.base)
            .navigationTitle("COMMAND")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
            .navigationDestination(for: Route.self) { r in
                switch r { case .person(let id, let name): SubjectRecordsView(personId: id, displayName: name) }
            }
            .sheet(item: $sheet) { s in
                switch s {
                case .hub: NavigationStack { WorkflowHubView() }
                case .scan: NavigationStack { IDScanView() }
                case .lookup: NavigationStack { PersonSearchView() }
                case .dar: NavigationStack { DailyActivityReportView() }
                case .bolo: BoloComposer()
                case .photo: FieldPhotoSheet()
                }
            }
            .alert("SEND PANIC ALARM?", isPresented: $confirmPanic) {
                Button("SEND PANIC", role: .destructive) { Task { await panic() } }
                Button("Cancel", role: .cancel) {}
            } message: { Text("Creates a Priority-1 OFFICER ASSIST call on the dispatch board.") }
            .task { focused = true; recents = UserDefaults.standard.stringArray(forKey: recentsKey) ?? [] }
        }
    }

    // ── Search bar ───────────────────────────────────────────
    private var searchBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(Theme.neutral)
            TextField("Search anyone · plate · call · warrant…", text: $query)
                .focused($focused)
                .submitLabel(.search)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .onSubmit { runSearch(query) }
                .onChange(of: query) { _, q in debounce(q) }
            if searching { ProgressView().scaleEffect(0.7) }
            else if !query.isEmpty {
                Button { query = ""; hits = []; status = nil } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.neutral)
                }
            }
        }
        .padding(10).background(Theme.raised).clipShape(RoundedRectangle(cornerRadius: Theme.radius))
    }

    // ── Results ──────────────────────────────────────────────
    private var resultsSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(hits) { hit in resultRow(hit) }
        }
    }

    @ViewBuilder
    private func resultRow(_ hit: IntelHit) -> some View {
        if hit.kind == .person {
            NavigationLink(value: Route.person(hit.entityID, hit.label)) { rowLabel(hit) }
                .buttonStyle(.plain)
        } else {
            Menu {
                Button { Task { await sendToMDT(hit) } } label: { Label("Send to in-car MDT", systemImage: "car.fill") }
                Button { UIPasteboard.general.string = hit.label; Haptics.tap() } label: { Label("Copy", systemImage: "doc.on.doc") }
            } label: { rowLabel(hit) }
        }
    }

    private func rowLabel(_ hit: IntelHit) -> some View {
        HStack(spacing: 10) {
            Image(systemName: hit.kind.icon).font(.system(size: 15))
                .foregroundStyle(hit.hasFlags ? Theme.red : Theme.gold).frame(width: 26)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(hit.label).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                    if let flag = hit.flags.first {
                        Text(flag.uppercased()).font(.system(size: 8, weight: .bold)).foregroundStyle(.white)
                            .padding(.horizontal, 5).padding(.vertical, 1).background(Theme.red).clipShape(Capsule())
                    }
                }
                Text(hit.snippet.isEmpty ? hit.kind.display : hit.snippet)
                    .font(.system(size: 10)).foregroundStyle(Theme.neutral).lineLimit(1)
            }
            Spacer()
            Image(systemName: hit.kind == .person ? "chevron.right" : "ellipsis.circle")
                .font(.system(size: 11)).foregroundStyle(Theme.neutral)
        }
        .themeCard()
    }

    // ── Empty state: command palette + recents ───────────────
    private var paletteSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Quick Commands")
            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: 8) {
                ForEach(CommandSearch.palette) { cmd in
                    Button { run(cmd) } label: {
                        VStack(spacing: 6) {
                            Image(systemName: cmd.icon).font(.system(size: 20))
                                .foregroundStyle(cmd.id == "panic" ? Theme.red : Theme.gold)
                            Text(cmd.title).font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(.white).multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity).padding(.vertical, 14).themeCard()
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    @ViewBuilder
    private var recentsSection: some View {
        if !recents.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    SectionHeader(title: "Recent Searches")
                    Spacer()
                    Button("Clear") { UserDefaults.standard.removeObject(forKey: recentsKey); recents = [] }
                        .font(.system(size: 10)).foregroundStyle(Theme.neutral)
                }
                ForEach(recents, id: \.self) { r in
                    Button { query = r; runSearch(r) } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "clock.arrow.circlepath").font(.system(size: 12)).foregroundStyle(Theme.neutral)
                            Text(r).font(.system(size: 12)).foregroundStyle(.white)
                            Spacer()
                            Image(systemName: "arrow.up.left").font(.system(size: 10)).foregroundStyle(Theme.neutral)
                        }.themeCard()
                    }.buttonStyle(.plain)
                }
            }
        }
    }

    // ── Actions ──────────────────────────────────────────────
    private func run(_ cmd: QuickCommand) {
        Haptics.tap()
        switch cmd.id {
        case "panic": confirmPanic = true
        case "report": sheet = .hub
        case "bolo": sheet = .bolo
        case "scan": sheet = .scan
        case "lookup": sheet = .lookup
        case "dar": sheet = .dar
        case "photo": sheet = .photo
        default: break
        }
    }

    private func debounce(_ q: String) {
        searchTask?.cancel()
        let trimmed = q.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 2 else { hits = []; status = nil; return }
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(280))
            if Task.isCancelled { return }
            await performSearch(trimmed)
        }
    }

    private func runSearch(_ q: String) {
        searchTask?.cancel()
        let trimmed = q.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 2 else { return }
        Task { await performSearch(trimmed) }
    }

    @MainActor
    private func performSearch(_ q: String) async {
        guard let encoded = q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) else { return }
        searching = true; defer { searching = false }
        var parsed: [IntelHit] = []
        let err = await authedRetrying { c in
            let json = try await c.requestJSON("GET", "api/intel/search?q=\(encoded)&limit=40")
            let rows = (json as? [String: Any])?["results"] as? [[String: Any]] ?? []
            parsed = CommandSearch.rank(CommandSearch.hits(from: rows))
        }
        if let err {
            status = "✗ \(err.localizedDescription)"
        } else {
            hits = parsed
            status = parsed.isEmpty ? "No matches for “\(q)”" : nil
            if !parsed.isEmpty { remember(q) }
        }
    }

    private func remember(_ q: String) {
        var r = UserDefaults.standard.stringArray(forKey: recentsKey) ?? []
        r.removeAll { $0.caseInsensitiveCompare(q) == .orderedSame }
        r.insert(q, at: 0)
        r = Array(r.prefix(8))
        UserDefaults.standard.set(r, forKey: recentsKey)
        recents = r
    }

    @MainActor
    private func sendToMDT(_ hit: IntelHit) async {
        let ok = await MDTLink.shared.send(
            type: hit.kind.rawValue,
            payload: ["label": hit.label, "entity_id": hit.entityID, "kind": hit.kind.rawValue])
        status = ok ? "✓ Sent “\(hit.label)” to in-car MDT" : "✗ MDT send failed"
        Haptics.tap()
    }

    @MainActor
    private func panic() async {
        Haptics.error()
        let err = await authedRetrying { c in
            try await c.requestJSON("POST", "api/dispatch/panic", body: ["trigger_method": "ios_command_search"])
        }
        status = err == nil ? "✓ PANIC SENT — P1 officer assist on the board" : "✗ \(err!.localizedDescription)"
    }
}
