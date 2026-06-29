import SwiftUI
import CoreAPI
import DesignSystem

public struct PatrolView: View {
    @StateObject private var viewModel = PatrolViewModel()
    @State private var isTracking = false
    private let apiClient = APIClient(baseURL: Endpoint.productionBaseURL)

    public init() {}

    public var body: some View {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()

            VStack(spacing: 0) {
                PanelTitleBar(title: "Patrol", icon: "map.fill")
                RMPGDivider()

                VStack(spacing: 12) {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("GPS Tracking")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundColor(RMPGTheme.textPrimary)
                            Text(isTracking ? "Active" : "Inactive")
                                .font(.system(size: 11))
                                .foregroundColor(isTracking ? RMPGTheme.statusGreen : RMPGTheme.textMuted)
                        }
                        Spacer()
                        Toggle("", isOn: $isTracking)
                            .tint(RMPGTheme.brandGold)
                            .onChange(of: isTracking) { _, newValue in
                                viewModel.toggleTracking(newValue)
                            }
                    }
                    .padding(12)
                    .background(RMPGTheme.raisedSurface)
                    .cornerRadius(2)

                    if let location = viewModel.currentLocation {
                        VStack(spacing: 0) {
                            RMPGDataRow(label: "Latitude", value: String(format: "%.6f", location.coordinate.latitude))
                            RMPGDivider()
                            RMPGDataRow(label: "Longitude", value: String(format: "%.6f", location.coordinate.longitude))
                            RMPGDivider()
                            RMPGDataRow(label: "Speed", value: location.speed >= 0 ? String(format: "%.1f mph", location.speed * 2.237) : "—")
                            RMPGDivider()
                            RMPGDataRow(label: "Heading", value: location.course >= 0 ? String(format: "%.0f°", location.course) : "—")
                            RMPGDivider()
                            RMPGDataRow(label: "Accuracy", value: String(format: "%.1f m", location.horizontalAccuracy))
                        }
                        .background(RMPGTheme.raisedSurface)
                        .cornerRadius(2)
                    }

                    patrolActions
                }
                .padding(12)

                Spacer()
            }
        }
    }

    private var patrolActions: some View {
        VStack(spacing: 6) {
            Text("Patrol Actions")
                .font(.system(size: 9, weight: .semibold))
                .foregroundColor(RMPGTheme.textMuted)
                .tracking(1)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 4)

            VStack(spacing: 0) {
                patrolButton(title: "Scan Checkpoint", icon: "qrcode.viewfinder")
                RMPGDivider()
                patrolButton(title: "Start Break", icon: "cup.and.saucer.fill")
                RMPGDivider()
                patrolButton(title: "Request Backup", icon: "person.2.badge.gearshape.fill")
                RMPGDivider()
                patrolButton(title: "Report Incident", icon: "exclamationmark.triangle.fill")
            }
            .background(RMPGTheme.raisedSurface)
            .cornerRadius(2)
        }
    }

    private func patrolButton(title: String, icon: String) -> some View {
        Button {} label: {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 14))
                    .foregroundColor(RMPGTheme.brandGold)
                    .frame(width: 24)
                Text(title)
                    .font(.system(size: 13))
                    .foregroundColor(RMPGTheme.textPrimary)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 10))
                    .foregroundColor(RMPGTheme.textMuted)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
        }
    }
}

@MainActor
final class PatrolViewModel: ObservableObject {
    @Published var currentLocation: CLLocation?
    @Published var isTracking = false

    private let locationManager = CLLocationManager()
    private let apiClient = APIClient(baseURL: Endpoint.productionBaseURL)
    private var uploadTimer: Timer?
    private var pendingPoints: [GPSPoint] = []

    init() {
        locationManager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        locationManager.distanceFilter = 5
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.pausesLocationUpdatesAutomatically = false
        locationManager.activityType = .automotiveNavigation
        locationManager.delegate = self
    }

    func toggleTracking(_ on: Bool) {
        isTracking = on
        if on {
            locationManager.requestAlwaysAuthorization()
            locationManager.startUpdatingLocation()
            uploadTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
                Task { await self?.flushPoints() }
            }
        } else {
            locationManager.stopUpdatingLocation()
            uploadTimer?.invalidate()
            Task { await flushPoints() }
        }
    }

    private func flushPoints() async {
        let pts = pendingPoints
        pendingPoints.removeAll()
        guard !pts.isEmpty else { return }
        do {
            let body = try JSONEncoder().encode(GPSBulkUpload(points: pts))
            try await apiClient.requestVoid(Endpoint(path: "/api/dispatch/gps", method: .post, body: body))
        } catch {
            pendingPoints.insert(contentsOf: pts, at: 0)
        }
    }
}

extension PatrolViewModel: @preconcurrency CLLocationManagerDelegate {
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last, loc.horizontalAccuracy >= 0 else { return }
        currentLocation = loc
        pendingPoints.append(GPSPoint(
            latitude: loc.coordinate.latitude,
            longitude: loc.coordinate.longitude,
            accuracy: loc.horizontalAccuracy,
            heading: loc.course >= 0 ? loc.course : nil,
            speed: loc.speed >= 0 ? loc.speed : nil
        ))
    }
}
