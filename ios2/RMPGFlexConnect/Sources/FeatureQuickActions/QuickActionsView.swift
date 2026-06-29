import SwiftUI
import CoreAPI
import CoreIDScan
import DesignSystem

public struct QuickActionsView: View {
    @StateObject private var vm = QuickActionsViewModel()
    @State private var showScanner = false
    @State private var showPopulationResult = false
    @State private var populationSuccess = false
    @State private var populationMessage = ""

    public init() {}

    public var body: some View {
        NavigationStack {
            ZStack {
                Color(hex: "0a0a0a").ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 16) {
                        scanSection
                        quickActionsSection
                        recentScansSection
                    }
                    .padding(16)
                }
            }
            .navigationTitle("Quick Actions")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color(hex: "0a0a0a"), for: .navigationBar)
        }
        .sheet(isPresented: $showScanner) {
            DocumentScannerView { id in
                vm.scannedID = id
                showScanner = false
                Task { await vm.pushToCAD(id) }
            }
        }
        .alert(populationSuccess ? "Success" : "Error", isPresented: $showPopulationResult) {
            Button("OK") { showPopulationResult = false }
        } message: {
            Text(populationMessage)
        }
    }

    private var scanSection: some View {
        VStack(spacing: 12) {
            Text("ID SCAN & POPULATE".uppercased())
                .font(.system(size: 9, weight: .semibold)).foregroundColor(Color(hex: "666666"))
                .tracking(2).frame(maxWidth: .infinity, alignment: .leading)

            Button { showScanner = true } label: {
                VStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 4)
                            .stroke(Color(hex: "d4a017"), style: StrokeStyle(lineWidth: 2, dash: [6, 3]))
                            .frame(height: 140)
                        VStack(spacing: 8) {
                            Image(systemName: "person.text.rectangle.fill")
                                .font(.system(size: 36)).foregroundColor(Color(hex: "d4a017").opacity(0.5))
                            Text("TAP TO SCAN ID").font(.system(size: 13, weight: .semibold)).foregroundColor(Color(hex: "d4a017"))
                            Text("DL · State ID · Passport · Military ID")
                                .font(.system(size: 10)).foregroundColor(Color(hex: "666666"))
                        }
                    }

                    if vm.isPushing {
                        HStack(spacing: 8) {
                            ProgressView().tint(Color(hex: "d4a017"))
                            Text("Pushing to CAD...").font(.system(size: 11)).foregroundColor(Color(hex: "888888"))
                        }
                    }

                    if let id = vm.lastScanned {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Image(systemName: "checkmark.circle.fill").font(.system(size: 12)).foregroundColor(Color(hex: "22c55e"))
                                Text("Last scan: \(id.displayName)").font(.system(size: 11)).foregroundColor(.white)
                            }
                            if let addr = id.address {
                                Text(addr).font(.system(size: 10)).foregroundColor(Color(hex: "888888"))
                            }
                        }
                        .padding(12).background(Color(hex: "141414")).cornerRadius(2)
                    }
                }
            }
        }
        .padding(16).background(Color(hex: "141414")).cornerRadius(2)
    }

    private var quickActionsSection: some View {
        VStack(spacing: 0) {
            Text("DISPATCH ACTIONS".uppercased())
                .font(.system(size: 9, weight: .semibold)).foregroundColor(Color(hex: "666666"))
                .tracking(2).frame(maxWidth: .infinity, alignment: .leading).padding(.bottom, 8)

            VStack(spacing: 0) {
                actionRow("Add Subject to Active Call", "person.badge.plus", Color(hex: "d4a017")) {
                    if let id = vm.lastScanned { Task { await vm.addSubjectToCall(id) } }
                }
                Divider().background(Color(hex: "1a1a1a"))
                actionRow("Create Person Record", "person.crop.circle.badge.plus", Color(hex: "22c55e")) {
                    if let id = vm.lastScanned { Task { await vm.createPerson(id) } }
                }
                Divider().background(Color(hex: "1a1a1a"))
                actionRow("Search Existing Records", "magnifyingglass", Color(hex: "3b82f6")) {
                    if let id = vm.lastScanned {
                        vm.searchText = [id.firstName, id.lastName].compactMap { $0 }.joined(separator: " ")
                        vm.searchRecords()
                    }
                }
                Divider().background(Color(hex: "1a1a1a"))
                actionRow("Run Warrant Check", "doc.text.magnifyingglass", Color(hex: "ef4444")) {
                    if let id = vm.lastScanned { Task { await vm.runWarrantCheck(id) } }
                }
                Divider().background(Color(hex: "1a1a1a"))
                actionRow("Push to MDT", "desktopcomputer", Color(hex: "888888")) {
                    if let id = vm.lastScanned { Task { await vm.pushToMDT(id) } }
                }
            }
            .background(Color(hex: "141414")).cornerRadius(2)
        }
    }

    private var recentScansSection: some View {
        VStack(spacing: 8) {
            Text("RECENT SCANS".uppercased())
                .font(.system(size: 9, weight: .semibold)).foregroundColor(Color(hex: "666666"))
                .tracking(2).frame(maxWidth: .infinity, alignment: .leading)

            if vm.recentScans.isEmpty {
                Text("No recent scans").font(.system(size: 11)).foregroundColor(Color(hex: "555555")).padding(.vertical, 24)
            } else {
                ForEach(vm.recentScans.prefix(5), id: \.scannedAt) { id in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(id.displayName).font(.system(size: 12, weight: .medium)).foregroundColor(.white)
                            if let addr = id.address { Text(addr).font(.system(size: 10)).foregroundColor(Color(hex: "888888")) }
                        }
                        Spacer()
                        Text(id.scannedAt, style: .time).font(.system(size: 10)).foregroundColor(Color(hex: "555555"))
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }

    private func actionRow(_ title: String, _ icon: String, _ color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon).font(.system(size: 14)).foregroundColor(color).frame(width: 24)
                Text(title).font(.system(size: 12)).foregroundColor(.white)
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 10)).foregroundColor(Color(hex: "555555"))
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
        }
    }
}

@MainActor
final class QuickActionsViewModel: ObservableObject {
    @Published var scannedID: ScannedID?
    @Published var lastScanned: ScannedID?
    @Published var recentScans: [ScannedID] = []
    @Published var isPushing = false
    @Published var searchText = ""

    private let client = APIClient(baseURL: Endpoint.productionBaseURL)

    func pushToCAD(_ id: ScannedID) async {
        isPushing = true
        do {
            let payload = id.toPersonPayload()
            let body = try JSONSerialization.data(withJSONObject: payload)
            try await client.requestVoid(Endpoint(path: "/api/records/persons", method: .post, body: body))
            lastScanned = id
            recentScans.insert(id, at: 0)
            if recentScans.count > 20 { recentScans = Array(recentScans.prefix(20)) }
            isPushing = false
        } catch {
            isPushing = false
            print("Push failed: \(error.localizedDescription)")
        }
    }

    func addSubjectToCall(_ id: ScannedID) async {
        isPushing = true
        do {
            let payload = id.toCallSubjectPayload(role: "subject")
            let body = try JSONSerialization.data(withJSONObject: payload)
            try await client.requestVoid(Endpoint(path: "/api/dispatch/calls/subject", method: .post, body: body))
            isPushing = false
        } catch {
            isPushing = false
            print("Add subject failed: \(error)")
        }
    }

    func createPerson(_ id: ScannedID) async {
        await pushToCAD(id)
    }

    func searchRecords() {
        guard !searchText.isEmpty else { return }
        Task {
            do {
                let _: SubjectSearchResponse = try await client.request(Endpoint(
                    path: "/api/records/subjects/search",
                    queryItems: [URLQueryItem(name: "q", value: searchText)]
                ))
            } catch { print("Search failed: \(error)") }
        }
    }

    func runWarrantCheck(_ id: ScannedID) async {
        guard let name = [id.firstName, id.lastName].compactMap({ $0 }).joined(separator: " ").addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) else { return }
        do {
            try await client.requestVoid(Endpoint(
                path: "/api/warrants/search", queryItems: [URLQueryItem(name: "name", value: name)], method: .post
            ))
        } catch { print("Warrant check failed: \(error)") }
    }

    func pushToMDT(_ id: ScannedID) async {
        do {
            let payload = id.toPersonPayload()
            let body = try JSONSerialization.data(withJSONObject: payload)
            try await client.requestVoid(Endpoint(path: "/api/dispatch/mdt/push", method: .post, body: body))
        } catch { print("MDT push failed: \(error)") }
    }

    struct SubjectSearchResponse: Codable, Sendable { let results: [SubjectResult] }
    struct SubjectResult: Codable, Identifiable, Sendable {
        let id: Int; let type: String; let name: String?; let detail: String?
    }
}
