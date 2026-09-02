import SwiftUI

import CoreLocation


public struct PatrolView: View {
    @StateObject private var viewModel: PatrolViewModel
    @State private var isTracking = false
    @State private var showCheckpointPicker = false
    @State private var showReportIncident = false
    @State private var resultMessage: String?
    @State private var resultSuccess = false
    @State private var showResult = false

    public init(apiClient: APIClient = APIClient(baseURL: Endpoint.productionBaseURL)) {
        _viewModel = StateObject(wrappedValue: PatrolViewModel(apiClient: apiClient))
    }

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
        .sheet(isPresented: $showCheckpointPicker) {
            CheckpointPickerSheet(viewModel: viewModel) { message, success in
                resultMessage = message; resultSuccess = success; showResult = true
            }
        }
        .sheet(isPresented: $showReportIncident) {
            ReportIncidentSheet(viewModel: viewModel) { message, success in
                resultMessage = message; resultSuccess = success; showResult = true
            }
        }
        .alert(resultSuccess ? "Success" : "Error", isPresented: $showResult) {
            Button("OK") { showResult = false }
        } message: {
            Text(resultMessage ?? "")
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
                patrolButton(title: "Scan Checkpoint", icon: "qrcode.viewfinder") {
                    showCheckpointPicker = true
                }
                RMPGDivider()
                patrolButton(title: "Start Break", icon: "cup.and.saucer.fill") {
                    Task {
                        let result = await viewModel.startBreak()
                        resultMessage = result.message; resultSuccess = result.success; showResult = true
                    }
                }
                RMPGDivider()
                patrolButton(title: "Request Backup", icon: "person.2.badge.gearshape.fill") {
                    Task {
                        let result = await viewModel.requestBackup()
                        resultMessage = result.message; resultSuccess = result.success; showResult = true
                    }
                }
                RMPGDivider()
                patrolButton(title: "Report Incident", icon: "exclamationmark.triangle.fill") {
                    showReportIncident = true
                }
            }
            .background(RMPGTheme.raisedSurface)
            .cornerRadius(2)
        }
    }

    private func patrolButton(title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
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

struct PatrolActionResult {
    let message: String
    let success: Bool
}

struct PatrolCheckpoint: Codable, Identifiable, Sendable {
    let id: Int
    let name: String
    let description: String?
    let propertyId: Int?
}

/// Lets the officer pick which checkpoint they're at, then logs the scan —
/// POST /api/patrol/scan requires a `checkpoint_id`, there's no way to scan
/// "generically." A real QR-code camera scan (decoding `patrol_checkpoints.qr_code`)
/// would remove this manual pick, but this list-based flow uses the same
/// real endpoint and is a reasonable v1 without adding a second camera pipeline.
struct CheckpointPickerSheet: View {
    @ObservedObject var viewModel: PatrolViewModel
    let onComplete: (String, Bool) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var checkpoints: [PatrolCheckpoint] = []
    @State private var isLoading = true
    @State private var submittingId: Int?

    var body: some View {
        NavigationStack {
            ZStack {
                RMPGTheme.baseBlack.ignoresSafeArea()
                if isLoading {
                    ProgressView().tint(RMPGTheme.brandGold)
                } else if checkpoints.isEmpty {
                    Text("No checkpoints configured").font(.system(size: 12)).foregroundColor(RMPGTheme.textMuted)
                } else {
                    List(checkpoints) { cp in
                        Button {
                            submittingId = cp.id
                            Task {
                                let result = await viewModel.scanCheckpoint(id: cp.id)
                                submittingId = nil
                                onComplete(result.message, result.success)
                                if result.success { dismiss() }
                            }
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(cp.name).font(.system(size: 13, weight: .semibold)).foregroundColor(RMPGTheme.textPrimary)
                                    if let d = cp.description { Text(d).font(.system(size: 11)).foregroundColor(RMPGTheme.textMuted) }
                                }
                                Spacer()
                                if submittingId == cp.id { ProgressView().tint(RMPGTheme.brandGold) }
                            }
                        }
                        .listRowBackground(RMPGTheme.raisedSurface)
                        .disabled(submittingId != nil)
                    }
                    .listStyle(.plain).scrollContentBackground(.hidden)
                }
            }
            .navigationTitle("Scan Checkpoint")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .task {
                checkpoints = await viewModel.loadCheckpoints()
                isLoading = false
            }
        }
    }
}

/// Minimal incident-filing form — POST /api/incidents requires
/// `incident_type` + `location_address` (verified against src/routes/incidents.ts).
struct ReportIncidentSheet: View {
    @ObservedObject var viewModel: PatrolViewModel
    let onComplete: (String, Bool) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var incidentType = ""
    @State private var location = ""
    @State private var narrative = ""
    @State private var isSubmitting = false

    var body: some View {
        NavigationStack {
            ZStack {
                RMPGTheme.baseBlack.ignoresSafeArea()
                Form {
                    Section {
                        RMPGTextField(placeholder: "Incident Type", text: $incidentType)
                        RMPGTextField(placeholder: "Location", text: $location)
                        RMPGTextField(placeholder: "Narrative (optional)", text: $narrative)
                    }
                    .listRowBackground(RMPGTheme.raisedSurface)

                    Section {
                        RMPGPrimaryButton(title: "FILE INCIDENT", isLoading: isSubmitting) {
                            Task {
                                isSubmitting = true
                                let result = await viewModel.reportIncident(
                                    type: incidentType, location: location,
                                    narrative: narrative.isEmpty ? nil : narrative
                                )
                                isSubmitting = false
                                onComplete(result.message, result.success)
                                if result.success { dismiss() }
                            }
                        }
                    }
                    .listRowBackground(RMPGTheme.baseBlack)
                }
                .scrollContentBackground(.hidden)
                .formStyle(.grouped)
            }
            .navigationTitle("Report Incident")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .onAppear {
                if let loc = viewModel.currentLocation {
                    location = String(format: "%.6f, %.6f", loc.coordinate.latitude, loc.coordinate.longitude)
                }
            }
        }
    }
}

@MainActor
final class PatrolViewModel: NSObject, ObservableObject, @preconcurrency CLLocationManagerDelegate {
    @Published var currentLocation: CLLocation?
    @Published var isTracking = false

    private let locationManager = CLLocationManager()
    private let apiClient: APIClient
    private var uploadTimer: Timer?
    private var pendingPoints: [GPSPoint] = []

    init(apiClient: APIClient) {
        self.apiClient = apiClient
        super.init()
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        locationManager.distanceFilter = 5
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.pausesLocationUpdatesAutomatically = false
        locationManager.activityType = .automotiveNavigation
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

    /// GET /api/patrol/checkpoints (src/routes/patrol.ts) — bare array.
    func loadCheckpoints() async -> [PatrolCheckpoint] {
        do {
            return try await apiClient.request(Endpoint(path: "/api/patrol/checkpoints"))
        } catch {
            return []
        }
    }

    /// POST /api/patrol/scan — a prior version of this button had no
    /// implementation at all (`Button {}`). Real contract: `checkpoint_id`
    /// required, `latitude`/`longitude` optional but tagged here from the
    /// live GPS fix so late/on-time classification and the compliance
    /// report have real coordinates, not just a checkpoint id.
    func scanCheckpoint(id: Int) async -> PatrolActionResult {
        var body: [String: Any] = ["checkpoint_id": id]
        if let loc = currentLocation {
            body["latitude"] = loc.coordinate.latitude
            body["longitude"] = loc.coordinate.longitude
        }
        do {
            let data = try JSONSerialization.data(withJSONObject: body)
            try await apiClient.requestVoid(Endpoint(path: "/api/patrol/scan", method: .post, body: data))
            return PatrolActionResult(message: "Checkpoint scan logged.", success: true)
        } catch {
            return PatrolActionResult(message: "Scan failed: \(error.localizedDescription)", success: false)
        }
    }

    /// POST /api/patrol/breaks/start — real `break_type` values are
    /// `break`/`meal`/`rest` (BREAK_TYPES in src/routes/patrol.ts); anything
    /// else is silently coerced server-side to `break`, so this just sends
    /// that directly rather than guessing a different enum.
    func startBreak() async -> PatrolActionResult {
        do {
            let body = try JSONSerialization.data(withJSONObject: ["break_type": "break"])
            try await apiClient.requestVoid(Endpoint(path: "/api/patrol/breaks/start", method: .post, body: body))
            return PatrolActionResult(message: "Break started.", success: true)
        } catch {
            return PatrolActionResult(message: "Could not start break: \(error.localizedDescription)", success: false)
        }
    }

    /// POST /api/dispatch/panic — the real officer-panic endpoint (verified
    /// against src/routes/dispatch/panic.ts). A prior version of this button
    /// had no implementation at all.
    func requestBackup() async -> PatrolActionResult {
        var body: [String: Any] = ["source": "patrol_backup_request"]
        if let loc = currentLocation {
            body["latitude"] = loc.coordinate.latitude
            body["longitude"] = loc.coordinate.longitude
        }
        do {
            let data = try JSONSerialization.data(withJSONObject: body)
            try await apiClient.requestVoid(Endpoint(path: "/api/dispatch/panic", method: .post, body: data))
            return PatrolActionResult(message: "Backup requested — dispatch notified.", success: true)
        } catch {
            return PatrolActionResult(message: "Could not request backup: \(error.localizedDescription)", success: false)
        }
    }

    /// POST /api/incidents — CodingKeys must be `incident_type`/`location_address`
    /// (verified against src/routes/incidents.ts; a plain JSONEncoder without
    /// snake_case conversion sending `type`/`location` was the exact bug fixed
    /// in FeatureIncidents earlier this session).
    func reportIncident(type: String, location: String, narrative: String?) async -> PatrolActionResult {
        guard !type.isEmpty, !location.isEmpty else {
            return PatrolActionResult(message: "Incident type and location are required.", success: false)
        }
        var body: [String: Any] = ["incident_type": type, "location_address": location, "priority": "P3"]
        if let narrative { body["narrative"] = narrative }
        do {
            let data = try JSONSerialization.data(withJSONObject: body)
            try await apiClient.requestVoid(Endpoint(path: "/api/incidents", method: .post, body: data))
            return PatrolActionResult(message: "Incident filed.", success: true)
        } catch {
            return PatrolActionResult(message: "Could not file incident: \(error.localizedDescription)", success: false)
        }
    }
}

extension PatrolViewModel {
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
