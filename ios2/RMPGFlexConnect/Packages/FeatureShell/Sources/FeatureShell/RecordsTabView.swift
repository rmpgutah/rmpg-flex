import SwiftUI
import DesignSystem
import CoreAPI

// MARK: - Models

public struct PersonRecord: Decodable, Identifiable, Sendable {
    public let id: Int
    public let first_name: String?
    public let last_name: String?
    public let middle_name: String?
    public let dob: String?
    public let sex: String?
    public let race: String?
    public let height: String?
    public let dl_number: String?
    public let dl_state: String?
    public let address: String?
    public let city: String?
    public let state: String?

    public var fullName: String {
        [first_name, middle_name, last_name]
            .compactMap { $0.flatMap { $0.isEmpty ? nil : $0 } }
            .joined(separator: " ")
    }
    public var initials: String {
        (first_name?.first.map(String.init) ?? "") + (last_name?.first.map(String.init) ?? "")
    }
}

public struct VehicleRecord: Decodable, Identifiable, Sendable {
    public let id: Int
    public let plate: String?
    public let state: String?
    public let make: String?
    public let model: String?
    public let color: String?
    public let year: Int?
    public let registered_owner: String?
    public let is_stolen: Bool?

    public var displayPlate: String { [plate, state].compactMap { $0 }.joined(separator: " ") }
    public var displayVehicle: String {
        [year.map(String.init), color, make, model].compactMap { $0 }.joined(separator: " ")
    }
}

public struct WarrantRecord: Decodable, Identifiable, Sendable {
    public let id: Int
    public let warrant_number: String?
    public let subject_name: String?
    public let offense: String?
    public let status: String?
    public let issuing_court: String?
    public let issued_date: String?
    public let extraditable: Bool?
    public var isActive: Bool { status?.lowercased() == "active" }
}

private struct PersonsEnvelope: Decodable {
    let persons: [PersonRecord]?
    let results: [PersonRecord]?
    var items: [PersonRecord] { persons ?? results ?? [] }
}
private struct VehiclesEnvelope: Decodable {
    let vehicles: [VehicleRecord]?
    let results: [VehicleRecord]?
    var items: [VehicleRecord] { vehicles ?? results ?? [] }
}
private struct WarrantsEnvelope: Decodable {
    let warrants: [WarrantRecord]?
    let results: [WarrantRecord]?
    var items: [WarrantRecord] { warrants ?? results ?? [] }
}

// MARK: - Segment

enum RecordsSegment: String, CaseIterable {
    case persons  = "Persons"
    case vehicles = "Vehicles"
    case warrants = "Warrants"

    var icon: String {
        switch self {
        case .persons:  return "person.fill"
        case .vehicles: return "car.fill"
        case .warrants: return "exclamationmark.shield.fill"
        }
    }
}

// MARK: - ViewModel

@Observable @MainActor
final class RecordsViewModel {
    var query = ""
    var segment: RecordsSegment = .persons
    var persons:  [PersonRecord]  = []
    var vehicles: [VehicleRecord] = []
    var warrants: [WarrantRecord] = []
    var isLoading = false
    var error: String?

    private let client: APIClient
    private var debounceTask: Task<Void, Never>?

    init(client: APIClient) { self.client = client }

    func queryChanged() {
        debounceTask?.cancel()
        guard query.count >= 2 else {
            persons = []; vehicles = []; warrants = []; error = nil
            return
        }
        debounceTask = Task {
            try? await Task.sleep(nanoseconds: 400_000_000)
            guard !Task.isCancelled else { return }
            await fetch()
        }
    }

    func segmentChanged() {
        guard query.count >= 2 else { return }
        Task { await fetch() }
    }

    func fetch() async {
        guard query.count >= 2 else { return }
        isLoading = true; error = nil
        defer { isLoading = false }
        do {
            switch segment {
            case .persons:
                let ep = Endpoint(method: .get, path: "api/records/persons",
                    queryItems: [URLQueryItem(name: "search", value: query),
                                 URLQueryItem(name: "limit", value: "30")])
                persons = try await client.request(ep, as: PersonsEnvelope.self).items
            case .vehicles:
                let ep = Endpoint(method: .get, path: "api/records/vehicles",
                    queryItems: [URLQueryItem(name: "search", value: query),
                                 URLQueryItem(name: "limit", value: "30")])
                vehicles = try await client.request(ep, as: VehiclesEnvelope.self).items
            case .warrants:
                let ep = Endpoint(method: .get, path: "api/warrants",
                    queryItems: [URLQueryItem(name: "search", value: query),
                                 URLQueryItem(name: "limit", value: "30")])
                warrants = try await client.request(ep, as: WarrantsEnvelope.self).items
            }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - Tab View

@MainActor
public struct RecordsTabView: View {
    @Environment(\.theme) private var theme
    @State private var vm: RecordsViewModel

    public init(client: APIClient) {
        _vm = State(initialValue: RecordsViewModel(client: client))
    }

    public var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                searchBar
                segmentBar
                Divider().background(theme.colors.surfaceMuted)
                content
            }
            .background(theme.colors.surfaceBase.ignoresSafeArea())
            .navigationTitle("RECORDS")
            .rmpgNavBar(background: theme.colors.surfaceRaised)
        }
    }

    // MARK: Search bar

    private var searchBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(vm.isLoading ? theme.colors.brandGold : theme.colors.textMuted)
                .font(.body)
                .symbolEffect(.pulse, isActive: vm.isLoading)
            TextField("Name · Plate · DL# · Warrant#", text: $vm.query)
                .foregroundStyle(theme.colors.textPrimary)
                .tint(theme.colors.brandGold)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .onChange(of: vm.query) { _, _ in vm.queryChanged() }
            if !vm.query.isEmpty {
                Button { vm.query = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(theme.colors.textMuted)
                }
            }
        }
        .padding(11)
        .background(theme.colors.surfaceRaised)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(theme.colors.surfaceBase)
    }

    // MARK: Segment picker

    private var segmentBar: some View {
        HStack(spacing: 0) {
            ForEach(RecordsSegment.allCases, id: \.self) { seg in
                Button {
                    vm.segment = seg
                    vm.segmentChanged()
                } label: {
                    VStack(spacing: 4) {
                        HStack(spacing: 4) {
                            Image(systemName: seg.icon).font(.caption2)
                            Text(seg.rawValue).font(.caption2.weight(.semibold))
                        }
                        .foregroundStyle(vm.segment == seg ? theme.colors.brandGold : theme.colors.textMuted)
                        .padding(.top, 8)
                        Rectangle()
                            .fill(vm.segment == seg ? theme.colors.brandGold : Color.clear)
                            .frame(height: 2)
                    }
                }
                .frame(maxWidth: .infinity)
            }
        }
        .background(theme.colors.surfaceBase)
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        if vm.query.count < 2 {
            promptView
        } else if vm.isLoading {
            VStack { Spacer(); ProgressView().tint(theme.colors.brandGold); Spacer() }
        } else if let err = vm.error {
            errorView(err)
        } else {
            resultsList
        }
    }

    private var promptView: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "doc.text.magnifyingglass")
                .font(.system(size: 52)).foregroundStyle(theme.colors.surfaceMuted)
            VStack(spacing: 6) {
                Text("Search Records").font(.headline).foregroundStyle(theme.colors.textPrimary)
                Text("Persons · Vehicles · Warrants")
                    .font(.caption).foregroundStyle(theme.colors.textMuted)
            }
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private var resultsList: some View {
        let empty: Bool = {
            switch vm.segment {
            case .persons:  return vm.persons.isEmpty
            case .vehicles: return vm.vehicles.isEmpty
            case .warrants: return vm.warrants.isEmpty
            }
        }()

        if empty {
            VStack(spacing: 12) {
                Spacer()
                Image(systemName: "magnifyingglass").font(.system(size: 44))
                    .foregroundStyle(theme.colors.textMuted)
                Text("No results for \"\(vm.query)\"")
                    .font(.headline).foregroundStyle(theme.colors.textPrimary)
                Spacer()
            }
        } else {
            List {
                switch vm.segment {
                case .persons:
                    ForEach(vm.persons) { p in
                        PersonRowView(person: p).listRowBackground(theme.colors.surfaceBase)
                            .listRowSeparatorTint(theme.colors.surfaceMuted)
                    }
                case .vehicles:
                    ForEach(vm.vehicles) { v in
                        VehicleRowView(vehicle: v).listRowBackground(theme.colors.surfaceBase)
                            .listRowSeparatorTint(theme.colors.surfaceMuted)
                    }
                case .warrants:
                    ForEach(vm.warrants) { w in
                        WarrantRowView(warrant: w)
                            .listRowBackground(w.isActive ? theme.colors.critical.opacity(0.06) : theme.colors.surfaceBase)
                            .listRowSeparatorTint(theme.colors.surfaceMuted)
                    }
                }
            }
            .listStyle(.plain)
            .background(theme.colors.surfaceBase)
            .scrollContentBackground(.hidden)
        }
    }

    private func errorView(_ msg: String) -> some View {
        VStack(spacing: 12) {
            Spacer()
            Image(systemName: "exclamationmark.triangle").font(.system(size: 44))
                .foregroundStyle(theme.colors.warning)
            Text("Search failed").font(.headline).foregroundStyle(theme.colors.textPrimary)
            Text(msg).font(.caption).foregroundStyle(theme.colors.textMuted)
                .multilineTextAlignment(.center).padding(.horizontal, 32)
            Button("Try again") { Task { await vm.fetch() } }
                .font(.caption.weight(.semibold)).foregroundStyle(theme.colors.brandGold)
            Spacer()
        }
    }
}

// MARK: - Row Views

struct PersonRowView: View {
    @Environment(\.theme) private var theme
    let person: PersonRecord

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(theme.colors.surfaceMuted).frame(width: 40, height: 40)
                Text(person.initials.isEmpty ? "?" : person.initials)
                    .font(.caption.weight(.bold)).foregroundStyle(theme.colors.textSecondary)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(person.fullName.isEmpty ? "Unknown" : person.fullName)
                    .font(.caption.weight(.semibold)).foregroundStyle(theme.colors.textPrimary)
                HStack(spacing: 10) {
                    if let dob = person.dob, !dob.isEmpty {
                        Label(dob, systemImage: "calendar").font(.caption2).foregroundStyle(theme.colors.textMuted)
                    }
                    if let dl = person.dl_number, !dl.isEmpty {
                        Label(dl, systemImage: "creditcard").font(.caption2).foregroundStyle(theme.colors.textMuted)
                    }
                }
                if let city = person.city, !city.isEmpty {
                    Text(city + (person.state.map { ", \($0)" } ?? ""))
                        .font(.caption2).foregroundStyle(theme.colors.textMuted)
                }
            }
            Spacer()
            Image(systemName: "chevron.right").font(.caption2).foregroundStyle(theme.colors.surfaceMuted)
        }
        .padding(.vertical, 4)
    }
}

struct VehicleRowView: View {
    @Environment(\.theme) private var theme
    let vehicle: VehicleRecord

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 6)
                    .fill(vehicle.is_stolen == true ? theme.colors.critical.opacity(0.15) : theme.colors.surfaceMuted)
                    .frame(width: 40, height: 40)
                Image(systemName: vehicle.is_stolen == true ? "exclamationmark.car.fill" : "car.fill")
                    .foregroundStyle(vehicle.is_stolen == true ? theme.colors.critical : theme.colors.brandGold)
            }
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(vehicle.displayPlate.isEmpty ? "No plate" : vehicle.displayPlate)
                        .font(.caption.weight(.bold)).foregroundStyle(theme.colors.textPrimary)
                    if vehicle.is_stolen == true {
                        Text("STOLEN").font(.caption2.weight(.black)).foregroundStyle(theme.colors.critical)
                            .padding(.horizontal, 5).padding(.vertical, 1)
                            .background(theme.colors.critical.opacity(0.12))
                            .clipShape(RoundedRectangle(cornerRadius: 3))
                    }
                }
                if !vehicle.displayVehicle.isEmpty {
                    Text(vehicle.displayVehicle).font(.caption2).foregroundStyle(theme.colors.textSecondary)
                }
                if let owner = vehicle.registered_owner, !owner.isEmpty {
                    Text("Reg: \(owner)").font(.caption2).foregroundStyle(theme.colors.textMuted)
                }
            }
            Spacer()
            Image(systemName: "chevron.right").font(.caption2).foregroundStyle(theme.colors.surfaceMuted)
        }
        .padding(.vertical, 4)
    }
}

struct WarrantRowView: View {
    @Environment(\.theme) private var theme
    let warrant: WarrantRecord

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(warrant.isActive ? theme.colors.critical.opacity(0.15) : theme.colors.surfaceMuted)
                    .frame(width: 40, height: 40)
                Image(systemName: "exclamationmark.shield.fill")
                    .foregroundStyle(warrant.isActive ? theme.colors.critical : theme.colors.textMuted)
            }
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(warrant.subject_name ?? "Unknown Subject")
                        .font(.caption.weight(.semibold)).foregroundStyle(theme.colors.textPrimary)
                    if let status = warrant.status {
                        Text(status.uppercased()).font(.caption2.weight(.bold))
                            .foregroundStyle(warrant.isActive ? theme.colors.critical : theme.colors.textMuted)
                    }
                }
                if let offense = warrant.offense, !offense.isEmpty {
                    Text(offense).font(.caption2).foregroundStyle(theme.colors.textSecondary).lineLimit(1)
                }
                HStack(spacing: 8) {
                    if let num = warrant.warrant_number {
                        Text("#\(num)").font(.caption2).foregroundStyle(theme.colors.textMuted)
                    }
                    if let court = warrant.issuing_court, !court.isEmpty {
                        Text(court).font(.caption2).foregroundStyle(theme.colors.textMuted).lineLimit(1)
                    }
                    if warrant.extraditable == true {
                        Text("EXTRADITABLE").font(.caption2.weight(.bold)).foregroundStyle(theme.colors.warning)
                    }
                }
            }
            Spacer()
            Image(systemName: "chevron.right").font(.caption2).foregroundStyle(theme.colors.surfaceMuted)
        }
        .padding(.vertical, 4)
    }
}
