import SwiftUI

struct D1ConsoleView: View {
    @State private var sql = "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name LIMIT 30"
    @State private var result: D1QueryResult?
    @State private var errorText: String?
    @State private var running = false
    @State private var confirmDestructive = false
    @AppStorage("queryHistory") private var historyJSON = "[]"

    private var history: [String] {
        (try? JSONDecoder().decode([String].self, from: Data(historyJSON.utf8))) ?? []
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 8) {
                TextEditor(text: $sql)
                    .font(.system(size: 13, design: .monospaced))
                    .scrollContentBackground(.hidden)
                    .background(Theme.raised)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                    .frame(height: 120)

                HStack {
                    Menu("Presets") {
                        Button("All tables") { sql = "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name" }
                        Button("Table columns…") { sql = "SELECT name, type FROM pragma_table_info('calls_for_service')" }
                        Button("Key row counts") { sql = "SELECT (SELECT COUNT(*) FROM calls_for_service) AS calls, (SELECT COUNT(*) FROM persons) AS persons, (SELECT COUNT(*) FROM warrants) AS warrants, (SELECT COUNT(*) FROM units) AS units" }
                        Button("DB size") { sql = "SELECT page_count * page_size / 1048576.0 AS size_mb FROM pragma_page_count(), pragma_page_size()" }
                        Button("Recent calls") { sql = "SELECT id, call_number, call_type, status, created_at FROM calls_for_service ORDER BY id DESC LIMIT 10" }
                    }
                    .font(.system(size: 12))
                    Menu("History") {
                        ForEach(history, id: \.self) { q in
                            Button(String(q.prefix(60))) { sql = q }
                        }
                    }
                    .font(.system(size: 12))
                    Spacer()
                    Button(action: runTapped) {
                        Text(running ? "RUNNING…" : "RUN")
                            .font(.system(size: 12, weight: .semibold))
                            .padding(.horizontal, 16).padding(.vertical, 6)
                            .background(Theme.gold)
                            .foregroundStyle(.black)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                    }
                    .disabled(running)
                }

                if let errorText {
                    Text(errorText)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(Theme.red)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(6)
                        .background(Theme.raised)
                }
                if let result {
                    if let meta = result.meta {
                        Text(meta).font(.system(size: 10)).foregroundStyle(Theme.neutral)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    ResultsTable(result: result)
                }
                Spacer(minLength: 0)
            }
            .padding(12)
            .background(Theme.base)
            .navigationTitle("D1 CONSOLE")
            .navigationBarTitleDisplayMode(.inline)
            .alert("Destructive SQL", isPresented: $confirmDestructive) {
                Button("Run anyway", role: .destructive) { Task { await run() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This statement writes to the LIVE rmpg-flex database. Are you sure?")
            }
        }
    }

    private func runTapped() {
        if SQLSafety.isDestructive(sql) {
            confirmDestructive = true
        } else {
            Task { await run() }
        }
    }

    @MainActor
    private func run() async {
        guard let client = AppConfig.d1Client() else {
            errorText = "Set the Cloudflare account ID and API token in Settings first."
            return
        }
        running = true
        errorText = nil
        defer { running = false }
        do {
            result = try await client.query(sql)
            saveHistory(sql)
        } catch {
            result = nil
            errorText = error.localizedDescription
        }
    }

    private func saveHistory(_ q: String) {
        var h = history.filter { $0 != q }
        h.insert(q, at: 0)
        if h.count > 20 { h = Array(h.prefix(20)) }
        if let data = try? JSONEncoder().encode(h) {
            historyJSON = String(data: data, encoding: .utf8) ?? "[]"
        }
    }
}
