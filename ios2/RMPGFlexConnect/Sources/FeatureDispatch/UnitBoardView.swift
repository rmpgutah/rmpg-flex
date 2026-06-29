import SwiftUI
import CoreAPI
import DesignSystem

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
            Text((u.status ?? "unknown").replacingOccurrences(of: "_", with: " ")).font(.system(size: 10)).foregroundColor(RMPGTheme.textMuted)
            if let lat = u.lat, let lng = u.lng {
                Text(String(format: "%.4f, %.4f", lat, lng)).font(.system(size: 8)).foregroundColor(RMPGTheme.textMuted)
            }
        }
        .padding(10).background(RMPGTheme.raisedSurface).cornerRadius(2)
    }

    func statusColor(_ s: String?) -> Color {
        switch s {
        case "available": return RMPGTheme.statusGreen
        case "busy", "en_route": return RMPGTheme.statusOrange
        case "on_scene": return RMPGTheme.statusBlue
        case "out_of_service": return RMPGTheme.statusRed
        default: return RMPGTheme.textMuted
        }
    }

    func load() async {
        isLoading = true
        do { units = try await api.listUnits() } catch {}
        isLoading = false
    }
}
