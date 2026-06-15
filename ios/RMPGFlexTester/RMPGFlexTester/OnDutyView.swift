import SwiftUI

// Read-only "who's on now" for line officers (situational awareness). Reuses
// RosterOfficer; fetches the officer-accessible /dispatch/duty/onduty.
struct OnDutyView: View {
    @State private var officers: [RosterOfficer] = []
    @State private var loading = true
    @State private var status = ""

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                if loading {
                    ProgressView().tint(Theme.gold).padding(.top, 30)
                } else if officers.isEmpty {
                    Text("No officers on duty.").font(.system(size: 12)).foregroundStyle(Theme.neutral).padding(.top, 24)
                } else {
                    ForEach(officers) { o in row(o) }
                }
                if !status.isEmpty { StatusLine(text: status) }
            }
            .padding(12)
        }
        .background(Theme.base)
        .refreshable { await load() }
        .task {
            await load(); loading = false
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(15))
                await load()
            }
        }
    }

    private func row(_ o: RosterOfficer) -> some View {
        HStack(spacing: 10) {
            Circle().fill(o.onCall ? Theme.orange : Theme.green).frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 1) {
                Text(o.name).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                Text([o.callSign, o.unitStatus.map { FieldFormat.value("status", $0) }, o.vehicleNumber]
                        .compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 10)).foregroundStyle(Theme.neutral).lineLimit(1)
            }
            Spacer()
            if o.onCall {
                Text("ON CALL").font(.system(size: 9, weight: .heavy)).foregroundStyle(.black)
                    .padding(.horizontal, 5).padding(.vertical, 1).background(Theme.orange).clipShape(Capsule())
            }
        }
        .themeCard()
    }

    @MainActor
    private func load() async {
        guard let c = await ShiftNet.client() else { status = "✗ Set credentials in Settings"; return }
        if let res = try? await c.requestJSON("GET", "api/dispatch/duty/onduty") as? [String: Any],
           let rows = res["officers"] as? [[String: Any]] {
            officers = rows.compactMap(RosterOfficer.init)
            status = ""
        }
    }
}
