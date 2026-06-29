import SwiftUI
import CoreAPI
import DesignSystem

public struct FleetVehicle: Codable, Identifiable, Sendable {
    public let id: Int
    public let callSign: String?
    public let make: String?
    public let model: String?
    public let year: Int?
    public let plateNumber: String?
    public let status: String?
    public let mileage: Int?
    public let assignedOfficerId: Int?
    public let lastInspectionAt: String?
}

public struct FleetView: View {
    @StateObject private var vm = FleetViewModel()
    @State private var filter = "all"

    public init() {}

    public var body: some View {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()
            VStack(spacing: 0) {
                PanelTitleBar(title: "Fleet", icon: "car.fill")
                RMPGDivider()
                HStack(spacing: 4) {
                    filterChip("All", "all"); filterChip("Active", "active")
                    filterChip("Maintenance", "maintenance"); filterChip("Out", "out_of_service")
                    Spacer()
                }
                .padding(.horizontal, 12).padding(.vertical, 6).background(RMPGTheme.raisedSurface)
                RMPGDivider()

                if vm.isLoading { Spacer(); ProgressView().tint(RMPGTheme.brandGold); Spacer() }
                else {
                    List(vm.filtered(filter: filter)) { v in
                        FleetRow(vehicle: v)
                            .listRowBackground(RMPGTheme.baseBlack)
                            .listRowSeparatorTint(RMPGTheme.borderSubtle)
                    }
                    .listStyle(.plain).scrollContentBackground(.hidden)
                    .refreshable { await vm.refresh() }
                }
            }
        }
        .onAppear { Task { await vm.refresh() } }
    }

    func filterChip(_ label: String, _ value: String) -> some View {
        Button { filter = value } label: {
            Text(label.uppercased())
                .font(.system(size: 9, weight: .medium))
                .foregroundColor(filter == value ? RMPGTheme.brandGold : RMPGTheme.textMuted)
                .padding(.horizontal, 8).padding(.vertical, 4)
                .background(filter == value ? RMPGTheme.brandGold.opacity(0.1) : Color.clear)
                .cornerRadius(2)
        }
    }
}

@MainActor
final class FleetViewModel: ObservableObject {
    @Published var vehicles: [FleetVehicle] = []
    @Published var isLoading = false
    private let client = APIClient(baseURL: Endpoint.productionBaseURL)

    func refresh() async {
        isLoading = true
        do {
            let r: FleetList = try await client.request(Endpoint(path: "/api/fleet"))
            vehicles = r.results
        } catch { print(error) }
        isLoading = false
    }

    func filtered(filter: String) -> [FleetVehicle] {
        guard filter != "all" else { return vehicles }
        return vehicles.filter { ($0.status ?? "").lowercased() == filter.replacingOccurrences(of: "_", with: " ") }
    }

    struct FleetList: Codable, Sendable { let results: [FleetVehicle] }
}

struct FleetRow: View {
    let vehicle: FleetVehicle
    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(vehicle.callSign ?? "Unit \(vehicle.id)")
                    .font(.system(size: 13, weight: .semibold)).foregroundColor(RMPGTheme.textPrimary)
                Text("\(vehicle.year.map(String.init) ?? "—") \(vehicle.make ?? "") \(vehicle.model ?? "")")
                    .font(.system(size: 11)).foregroundColor(RMPGTheme.textSecondary)
                if let plate = vehicle.plateNumber {
                    HStack(spacing: 4) {
                        Image(systemName: "licenseplate.fill").font(.system(size: 9))
                        Text(plate).font(.system(size: 10))
                    }.foregroundColor(RMPGTheme.textMuted)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                StatusBadge(text: (vehicle.status ?? "active").replacingOccurrences(of: "_", with: " "), color: RMPGTheme.statusGreen)
                if let m = vehicle.mileage {
                    Text("\(m) mi").font(.system(size: 10)).foregroundColor(RMPGTheme.textMuted)
                }
            }
        }
        .padding(.vertical, 4)
    }
}
