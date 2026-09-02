import SwiftUI



/// Mirrors `fleet_vehicles` (GET /api/fleet) — verified against
/// migrations/0052_fleet_tables.sql. A prior version of this model invented
/// `callSign`/`mileage`/`assignedOfficerId`/`lastInspectionAt`, none of which
/// exist as columns (the real names are `vehicle_number`, `current_mileage`,
/// `assigned_unit_id`, `last_service_date`) — every one of those decoded to
/// silent `nil` instead of failing, so the Fleet tab rendered "Unit <id>"
/// placeholders and blank mileage for every vehicle.
public struct FleetVehicle: Codable, Identifiable, Sendable {
    public let id: Int
    public let vehicleNumber: String?
    public let make: String?
    public let model: String?
    public let year: Int?
    public let plateNumber: String?
    public let status: String?
    public let currentMileage: Int?
    public let assignedUnitId: Int?
    public let lastServiceDate: String?
}

/// GET /api/fleet/:id (src/routes/fleet.ts) — bundles the vehicle row plus
/// its assignment/maintenance/fuel history in one response, so the detail
/// screen needs exactly one fetch, not four.
public struct FleetVehicleDetail: Codable, Identifiable, Sendable {
    public let id: Int
    public let vehicleNumber: String?
    public let make: String?
    public let model: String?
    public let year: Int?
    public let color: String?
    public let vin: String?
    public let plateNumber: String?
    public let plateState: String?
    public let status: String?
    public let currentMileage: Int?
    public let assignedUnitId: Int?
    public let assignedUnitCallSign: String?
    public let lastServiceDate: String?
    public let nextServiceDue: String?
    public let nextServiceMileage: Int?
    public let insuranceExpiry: String?
    public let registrationExpiry: String?
    public let notes: String?
    public let assignments: [FleetAssignment]?
    public let recentMaintenance: [FleetMaintenanceRecord]?
    public let recentFuel: [FleetFuelRecord]?
}

public struct FleetAssignment: Codable, Identifiable, Sendable {
    public let id: Int
    public let unitCallSign: String?
    public let officerName: String?
    public let assignedAt: String?
    public let unassignedAt: String?
    public let notes: String?
}

public struct FleetMaintenanceRecord: Codable, Identifiable, Sendable {
    public let id: Int
    public let type: String?
    public let description: String?
    public let mileageAtService: Int?
    public let cost: Double?
    public let vendor: String?
    public let performedAt: String?
    public let nextDueDate: String?
}

public struct FleetFuelRecord: Codable, Identifiable, Sendable {
    public let id: Int
    public let fuelDate: String?
    public let gallons: Double?
    public let totalCost: Double?
    public let odometer: Int?
}

public struct FleetView: View {
    @StateObject private var vm: FleetViewModel
    @State private var filter = "all"
    private let apiClient: APIClient

    public init(apiClient: APIClient = APIClient(baseURL: Endpoint.productionBaseURL)) {
        self.apiClient = apiClient
        _vm = StateObject(wrappedValue: FleetViewModel(client: apiClient))
    }

    public var body: some View {
        NavigationStack {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()
            VStack(spacing: 0) {
                PanelTitleBar(title: "Fleet", icon: "car.fill")
                RMPGDivider()
                HStack(spacing: 4) {
                    // Real fleet_vehicles.status CHECK values (migrations/0052_fleet_tables.sql):
                    // in_service, out_of_service, maintenance, retired, archived.
                    // "Active" previously compared against a nonexistent "in_service"
                    // value it never actually sent — see filtered() below.
                    filterChip("All", "all"); filterChip("In Service", "in_service")
                    filterChip("Maintenance", "maintenance"); filterChip("Out", "out_of_service")
                    Spacer()
                }
                .padding(.horizontal, 12).padding(.vertical, 6).background(RMPGTheme.raisedSurface)
                RMPGDivider()

                if let error = vm.errorMessage {
                    Text(error).font(.system(size: 11)).foregroundColor(RMPGTheme.statusRed).padding(8)
                }

                if vm.isLoading { Spacer(); ProgressView().tint(RMPGTheme.brandGold); Spacer() }
                else {
                    List(vm.filtered(filter: filter)) { v in
                        NavigationLink(destination: FleetVehicleDetailView(vehicleId: v.id, apiClient: apiClient)) {
                            FleetRow(vehicle: v)
                        }
                        .listRowBackground(RMPGTheme.baseBlack)
                        .listRowSeparatorTint(RMPGTheme.borderSubtle)
                    }
                    .listStyle(.plain).scrollContentBackground(.hidden)
                    .refreshable { await vm.refresh() }
                }
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
    @Published var errorMessage: String?
    private let client: APIClient

    init(client: APIClient) {
        self.client = client
    }

    func refresh() async {
        isLoading = true
        errorMessage = nil
        do {
            // Real response is {data:[...], pagination:{...}} (src/routes/fleet.ts) —
            // a prior version of this decoded {results:[...]}, which doesn't exist
            // on the response, so every refresh silently failed to decode and the
            // Fleet tab never showed a single vehicle.
            let r: FleetList = try await client.request(Endpoint(path: "/api/fleet"))
            vehicles = r.data
        } catch {
            errorMessage = "Could not load fleet: \(error.localizedDescription)"
        }
        isLoading = false
    }

    func filtered(filter: String) -> [FleetVehicle] {
        guard filter != "all" else { return vehicles }
        return vehicles.filter { $0.status == filter }
    }

    struct FleetList: Codable, Sendable { let data: [FleetVehicle] }
}

struct FleetRow: View {
    let vehicle: FleetVehicle
    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(vehicle.vehicleNumber ?? "Unit \(vehicle.id)")
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
                StatusBadge(text: (vehicle.status ?? "in_service").replacingOccurrences(of: "_", with: " ").capitalized, color: RMPGTheme.statusGreen)
                if let m = vehicle.currentMileage {
                    Text("\(m) mi").font(.system(size: 10)).foregroundColor(RMPGTheme.textMuted)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

struct FleetVehicleDetailView: View {
    let vehicleId: Int
    let apiClient: APIClient

    @State private var detail: FleetVehicleDetail?
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()
            if isLoading {
                ProgressView().tint(RMPGTheme.brandGold)
            } else if let error = errorMessage {
                Text(error).font(.system(size: 12)).foregroundColor(RMPGTheme.statusRed).padding()
            } else if let detail {
                content(detail)
            }
        }
        .navigationTitle(detail?.vehicleNumber ?? "Vehicle")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func content(_ v: FleetVehicleDetail) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    StatusBadge(text: (v.status ?? "in_service").replacingOccurrences(of: "_", with: " ").capitalized, color: RMPGTheme.statusGreen)
                    Spacer()
                }
                Text(v.vehicleNumber ?? "Vehicle \(v.id)")
                    .font(.system(size: 18, weight: .bold)).foregroundColor(RMPGTheme.textPrimary)
                Text("\(v.year.map(String.init) ?? "—") \(v.make ?? "") \(v.model ?? "") \(v.color ?? "")")
                    .font(.system(size: 12)).foregroundColor(RMPGTheme.textSecondary)

                section("Vehicle Info") {
                    fieldRow("VIN", v.vin)
                    fieldRow("Plate", [v.plateNumber, v.plateState].compactMap { $0 }.joined(separator: " "))
                    fieldRow("Mileage", v.currentMileage.map { "\($0) mi" })
                    fieldRow("Assigned Unit", v.assignedUnitCallSign)
                }
                section("Service") {
                    fieldRow("Last Service", v.lastServiceDate.map { String($0.prefix(10)) })
                    fieldRow("Next Service Due", v.nextServiceDue.map { String($0.prefix(10)) })
                    fieldRow("Next Service Mileage", v.nextServiceMileage.map { "\($0) mi" })
                    fieldRow("Insurance Expiry", v.insuranceExpiry.map { String($0.prefix(10)) })
                    fieldRow("Registration Expiry", v.registrationExpiry.map { String($0.prefix(10)) })
                }
                if let notes = v.notes, !notes.isEmpty {
                    section("Notes") { fieldRow("Notes", notes) }
                }

                if let maintenance = v.recentMaintenance, !maintenance.isEmpty {
                    Text("RECENT MAINTENANCE".uppercased())
                        .font(.system(size: 10, weight: .semibold)).foregroundColor(RMPGTheme.brandGold).tracking(1)
                    VStack(spacing: 0) {
                        ForEach(maintenance) { m in
                            VStack(alignment: .leading, spacing: 2) {
                                HStack {
                                    Text(m.type?.capitalized ?? "Service").font(.system(size: 12, weight: .semibold)).foregroundColor(RMPGTheme.textPrimary)
                                    Spacer()
                                    if let date = m.performedAt { Text(String(date.prefix(10))).font(.system(size: 10)).foregroundColor(RMPGTheme.textMuted) }
                                }
                                if let desc = m.description { Text(desc).font(.system(size: 11)).foregroundColor(RMPGTheme.textSecondary) }
                                if let cost = m.cost { Text("$\(String(format: "%.2f", cost))").font(.system(size: 10)).foregroundColor(RMPGTheme.textMuted) }
                            }
                            .padding(12)
                            if m.id != maintenance.last?.id { Divider().background(RMPGTheme.borderSubtle) }
                        }
                    }
                    .background(RMPGTheme.raisedSurface).cornerRadius(2)
                }

                if let fuel = v.recentFuel, !fuel.isEmpty {
                    Text("RECENT FUEL".uppercased())
                        .font(.system(size: 10, weight: .semibold)).foregroundColor(RMPGTheme.brandGold).tracking(1)
                    VStack(spacing: 0) {
                        ForEach(fuel) { f in
                            HStack {
                                Text(f.fuelDate.map { String($0.prefix(10)) } ?? "—").font(.system(size: 11)).foregroundColor(RMPGTheme.textPrimary)
                                Spacer()
                                if let g = f.gallons { Text("\(String(format: "%.1f", g)) gal").font(.system(size: 10)).foregroundColor(RMPGTheme.textSecondary) }
                                if let c = f.totalCost { Text("$\(String(format: "%.2f", c))").font(.system(size: 10)).foregroundColor(RMPGTheme.textMuted) }
                            }
                            .padding(12)
                            if f.id != fuel.last?.id { Divider().background(RMPGTheme.borderSubtle) }
                        }
                    }
                    .background(RMPGTheme.raisedSurface).cornerRadius(2)
                }
            }
            .padding(16)
        }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased()).font(.system(size: 10, weight: .semibold)).foregroundColor(RMPGTheme.brandGold).tracking(1)
            VStack(spacing: 0) { content() }.background(RMPGTheme.raisedSurface).cornerRadius(2)
        }
    }

    @ViewBuilder
    private func fieldRow(_ label: String, _ value: String?) -> some View {
        if let value, !value.isEmpty {
            HStack {
                Text(label).font(.system(size: 10)).foregroundColor(RMPGTheme.textMuted).frame(width: 130, alignment: .leading)
                Text(value).font(.system(size: 12)).foregroundColor(RMPGTheme.textPrimary)
                Spacer()
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
        }
    }

    private func load() async {
        do {
            detail = try await apiClient.request(Endpoint(path: "/api/fleet/\(vehicleId)"))
        } catch {
            errorMessage = "Could not load vehicle: \(error.localizedDescription)"
        }
        isLoading = false
    }
}
