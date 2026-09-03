import SwiftUI



public struct UnitBoardView: View {
    @State private var units: [Unit] = []
    @State private var isLoading = true
    let api: DispatchAPI

    public init(api: DispatchAPI) { self.api = api }

    public var body: some View {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()
            VStack(spacing: 0) {
                PanelTitleBar(title: "Unit Status Board", icon: "person.3.fill")
                RMPGDivider()
                if isLoading { Spacer(); ProgressView().tint(RMPGTheme.brandGold); Spacer() }
                else {
                    ScrollView {
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 6) {
                            ForEach(units) { unit in unitCard(unit) }
                        }.padding(8)
                    }
                    .refreshable { await load() }
                }
            }
        }
        .task { await load() }
    }

    func unitCard(_ u: Unit) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(u.callSign ?? "U\(u.id)").font(.system(size: 13, weight: .bold)).foregroundColor(RMPGTheme.textPrimary)
                Spacer()
                Circle().fill(statusColor(u.status)).frame(width: 8, height: 8)
            }
            Text((u.status ?? "unknown").replacingOccurrences(of: "_", with: " ").capitalized).font(.system(size: 10)).foregroundColor(RMPGTheme.textMuted)
            if let lat = u.lat, let lng = u.lng {
                Text(String(format: "%.4f, %.4f", lat, lng)).font(.system(size: 8)).foregroundColor(RMPGTheme.textMuted)
            }
        }
        .padding(10).background(RMPGTheme.raisedSurface).cornerRadius(2)
    }

    // Real `units.status` CHECK values (migrations/0001_initial_schema.sql):
    // available, dispatched, enroute, onscene, busy, off_duty, out_of_service.
    // The prior "en_route"/"on_scene" cases (with underscores) never matched
    // real data, so every enroute/onscene unit silently fell through to gray.
    func statusColor(_ s: String?) -> Color {
        switch s {
        case "available": return RMPGTheme.statusGreen
        case "dispatched", "busy", "enroute": return RMPGTheme.statusOrange
        case "onscene": return RMPGTheme.statusBlue
        case "out_of_service": return RMPGTheme.statusRed
        case "off_duty": return RMPGTheme.textMuted
        default: return RMPGTheme.textMuted
        }
    }

    func load() async {
        isLoading = true
        do { units = try await api.listUnits() } catch {}
        isLoading = false
    }
}
