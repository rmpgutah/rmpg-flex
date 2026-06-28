import SwiftUI

// Fleet Readiness dashboard — at-a-glance fleet health from GET /api/fleet:
// out-of-service (the DVIR OOS payoff), in-maintenance, inspection-overdue, and
// ready counts, with the not-ready vehicles surfaced on top. A supervisor can
// return a repaired OOS vehicle to service inline. Logic lives in
// FleetReadiness.swift (unit-tested).
struct FleetReadinessView: View {
    @State private var vehicles: [FleetVehicle] = []
    @State private var loading = true
    @State private var status: String?
    @State private var working = false
    @State private var now = Date().timeIntervalSince1970

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 10) {
                    if loading && vehicles.isEmpty {
                        ProgressView().tint(Theme.gold).padding(.top, 30)
                    } else if vehicles.isEmpty {
                        EmptyState(icon: "car.2", title: "No fleet vehicles").padding(.top, 24)
                    } else {
                        summaryGrid
                        SectionHeader(title: "Vehicles · \(vehicles.count)")
                        ForEach(FleetReadiness.sorted(vehicles, now: now)) { row($0) }
                    }
                    if let status { StatusLine(text: status) }
                }
                .padding(12)
            }
            .background(Theme.base)
            .navigationTitle("FLEET READINESS")
            .navigationBarTitleDisplayMode(.inline)
            .refreshable { await load() }
            .task { await load() }
        }
    }

    private var summaryGrid: some View {
        let s = FleetReadiness.summary(vehicles, now: now)
        return LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: 8) {
            tile(.oos, s[.oos] ?? 0)
            tile(.maintenance, s[.maintenance] ?? 0)
            tile(.overdue, s[.overdue] ?? 0)
            tile(.defects, s[.defects] ?? 0)
            tile(.ready, s[.ready] ?? 0)
            countTile("TOTAL", vehicles.count, Theme.neutral)
        }
    }

    private func tile(_ r: VehicleReadiness, _ n: Int) -> some View {
        countTile(r.label.uppercased(), n, color(r.tone))
    }

    private func countTile(_ label: String, _ n: Int, _ c: Color) -> some View {
        VStack(spacing: 2) {
            Text("\(n)").font(Theme.Typography.title).fontWeight(.bold).foregroundStyle(n > 0 ? c : Theme.neutral)
            Text(label).font(.system(size: 8, weight: .semibold)).foregroundStyle(Theme.neutral)
                .multilineTextAlignment(.center).lineLimit(2)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 10).themeCard()
    }

    private func row(_ v: FleetVehicle) -> some View {
        let r = FleetReadiness.readiness(v, now: now)
        let c = color(r.tone)
        return HStack(spacing: 0) {
            Rectangle().fill(c).frame(width: 3)
            HStack(spacing: 10) {
                Image(systemName: r.icon).font(.system(size: 15)).foregroundStyle(c).frame(width: 24)
                VStack(alignment: .leading, spacing: 2) {
                    Text(v.number).font(Theme.Typography.body).fontWeight(.semibold).foregroundStyle(.white)
                    Text([v.name.isEmpty ? nil : v.name, v.mileage.map { "\($0) mi" }]
                            .compactMap { $0 }.joined(separator: " · "))
                        .font(.system(size: 10)).foregroundStyle(Theme.neutral).lineLimit(1)
                }
                Spacer()
                Text(r.label).font(.system(size: 9, weight: .bold)).foregroundStyle(c)
                if r == .oos {
                    Button { Task { await returnToService(v) } } label: {
                        Text("RTS").font(.system(size: 10, weight: .bold))
                            .padding(.horizontal, 7).padding(.vertical, 4)
                            .background(Theme.green).foregroundStyle(.black)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                    }.disabled(working)
                }
            }
            .padding(10)
        }
        .background(Theme.raised).clipShape(RoundedRectangle(cornerRadius: Theme.radius))
    }

    private func color(_ tone: String) -> Color {
        switch tone {
        case "red": return Theme.red
        case "orange": return Theme.orange
        case "gold": return Theme.gold
        case "green": return Theme.green
        default: return Theme.neutral
        }
    }

    @MainActor private func load() async {
        now = Date().timeIntervalSince1970
        let err = await authedRetrying { c in
            let json = try await c.requestJSON("GET", "api/fleet?per_page=200")
            let rows = ((json as? [String: Any])?["data"] as? [[String: Any]]) ?? (json as? [[String: Any]]) ?? []
            vehicles = FleetReadiness.parse(rows)
        }
        status = err.map { "✗ \($0.localizedDescription)" }
        loading = false
    }

    @MainActor private func returnToService(_ v: FleetVehicle) async {
        working = true; defer { working = false }
        let err = await authedRetrying { c in
            _ = try await c.requestJSON("PUT", "api/fleet/\(v.id)", body: ["status": "in_service"])
        }
        if let err { status = "✗ \(err.localizedDescription)" }
        else { status = "✓ \(v.number) returned to service"; Haptics.success(); await load() }
    }
}
