import SwiftUI
import DesignSystem
import CoreAPI
import CoreAuth
import CoreLocationService
import FeatureDuty
import FeatureQuickActions
import FeatureCFS
import FeatureRunPlate
import FeatureRunID

public struct OfficerShell: View {
    public static let tabs: [TabSpec] = [
        TabSpec(id: "home",    title: "Home",    systemImage: "house.fill",            milestone: "M1"),
        TabSpec(id: "cfs",     title: "CFS",     systemImage: "list.bullet.rectangle", milestone: "M1"),
        TabSpec(id: "scan",    title: "Scan ID", systemImage: "camera.viewfinder",     milestone: "M1"),
        TabSpec(id: "records", title: "Records", systemImage: "doc.text.magnifyingglass", milestone: "M1"),
        TabSpec(id: "more",    title: "More",    systemImage: "ellipsis.circle",       milestone: "M1"),
    ]

    @Bindable var session: AuthSession
    @State private var dutyState = DutyState()
    @State private var gpsProvider = GPSProvider()
    @State private var showTranslation = false

    private var apiClient: APIClient {
        APIClient(
            baseURL: URL(string: "https://api.rmpgutah.us")!,
            tokenProvider: { KeychainStore.get(AuthSession.tokenKey) }
        )
    }

    public init(session: AuthSession) {
        self.session = session
    }

    public var body: some View {
        TabView {
            HomeView(dutyState: dutyState, apiClient: apiClient)
                .tabItem { Label("Home", systemImage: "house.fill") }

            CFSTabView(vm: CallsViewModel(api: CFSAPI(client: apiClient)))
                .tabItem { Label("CFS", systemImage: "list.bullet.rectangle") }

            ScanHubView(apiClient: apiClient)
                .tabItem { Label("Scan ID", systemImage: "camera.viewfinder") }

            RecordsTabView(client: apiClient)
                .tabItem { Label("Records", systemImage: "doc.text.magnifyingglass") }

            MoreTabView(session: session)
                .tabItem { Label("More", systemImage: "ellipsis.circle") }
        }
        .tint(ThemeColors.night.brandGold)
        .onAppear { gpsProvider.requestAuthorization(); gpsProvider.startUpdatingLocation() }
    }
}

// MARK: - Scan Hub (DL + MRZ + Plate + Apple ID)

@MainActor
struct ScanHubView: View {
    @Environment(\.theme) private var theme
    let apiClient: APIClient
    @State private var scanMode: ScanMode = .driverLicense
    @State private var showScanner = false

    enum ScanMode: String, CaseIterable {
        case driverLicense = "DL"
        case passport = "PASSPORT"
        case plate = "PLATE"
        case appleID = "WIRELESS"
    }

    var body: some View {
        NavigationStack {
            ZStack {
                theme.colors.surfaceBase.ignoresSafeArea()
                VStack(spacing: 16) {
                    Picker("Mode", selection: $scanMode) {
                        ForEach(ScanMode.allCases, id: \.self) { mode in
                            Text(mode.rawValue).tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal)

                    Spacer()

                    Image(systemName: scanIcon).font(.system(size: 72)).foregroundColor(theme.colors.brandGold)
                    Text(scanTitle).font(.title2).bold()
                    Text(scanDescription).font(.subheadline).foregroundColor(theme.colors.textSecondary)
                        .multilineTextAlignment(.center).padding(.horizontal, 40)

                    Button("SCAN") { showScanner = true }
                        .buttonStyle(.borderedProminent)
                        .tint(theme.colors.brandGold)
                        .font(.title3)

                    if scanMode == .appleID {
                        Text("Subject taps their device to verify").font(.caption).foregroundColor(.secondary)
                    }
                    if scanMode == .plate {
                        NavigationLink("Enter Plate Manually") {
                            PlateEntryView(apiClient: RunPlateAPIClient(baseURL: URL(string: "https://api.rmpgutah.us")!, tokenProvider: { KeychainStore.get(AuthSession.tokenKey) }))
                        }
                        .font(.subheadline)
                    }

                    Spacer()
                }
            }
            .navigationTitle("SCAN")
            .rmpgNavBar(background: theme.colors.surfaceRaised)
            .sheet(isPresented: $showScanner) {
                scannerSheet
            }
        }
    }

    @ViewBuilder
    private var scannerSheet: some View {
        switch scanMode {
        case .driverLicense:
            ScanTabView(apiClient: apiClient)
        case .passport:
            MrzScannerView(onScan: { result in }, onError: { _ in })
        case .plate:
            ALPRCameraView(onCapture: { text in }, onError: { _ in })
        case .appleID:
            AppleIDVerifierView()
        }
    }

    private var scanIcon: String {
        switch scanMode {
        case .driverLicense: return "creditcard.viewfinder"
        case .passport: return "book.pages"
        case .plate: return "camera.viewfinder"
        case .appleID: return "wallet.pass"
        }
    }

    private var scanTitle: String {
        switch scanMode {
        case .driverLicense: return "DRIVER LICENSE"
        case .passport: return "PASSPORT / MRZ"
        case .plate: return "LICENSE PLATE"
        case .appleID: return "APPLE ID VERIFIER"
        }
    }

    private var scanDescription: String {
        switch scanMode {
        case .driverLicense: return "Scan the PDF417 barcode on the back of a US driver license"
        case .passport: return "Scan the MRZ lines on a passport or national ID card"
        case .plate: return "Point camera at a license plate for ALPR"
        case .appleID: return "Wireless identity verification via ProximityReader"
        }
    }
}

public struct TabSpec: Identifiable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let systemImage: String
    public let milestone: String

    public init(id: String, title: String, systemImage: String, milestone: String) {
        self.id = id; self.title = title
        self.systemImage = systemImage; self.milestone = milestone
    }
}
