import SwiftUI
import MapKit
import CoreLocation
import FeatureCFS
import CoreLocation as RMPGCoreLocation

public struct UnitMapView: View {
    @State private var viewModel: UnitMapViewModel
    @State private var position: MapCameraPosition = .automatic

    public init(apiClient: UnitMapAPIClient, gpsProvider: RMPGCoreLocation.GPSProvider) {
        _viewModel = State(initialValue: UnitMapViewModel(apiClient: apiClient, gpsProvider: gpsProvider))
    }

    public var body: some View {
        ZStack {
            Map(position: $position) {
                if let myLoc = viewModel.myLocation {
                    Annotation("Me", coordinate: myLoc.coordinate, anchor: .center) {
                        Circle()
                            .fill(Color.blue)
                            .frame(width: 20, height: 20)
                            .overlay(Circle().stroke(Color.white, lineWidth: 2))
                    }
                }
                ForEach(viewModel.units) { unit in
                    if let loc = unit.location {
                        Annotation(unit.callSign, coordinate: loc, anchor: .center) {
                            UnitAnnotationView(unit: unit)
                        }
                    }
                }
                ForEach(viewModel.activeCalls) { call in
                    if let loc = call.locationCoordinate {
                        Annotation(call.displayCallNumber, coordinate: loc, anchor: .center) {
                            CallAnnotationView(call: call)
                        }
                    }
                }
            }

            VStack {
                HStack {
                    Spacer()
                    VStack(spacing: 4) {
                        Text("\(viewModel.units.count) UNITS")
                            .font(.caption2).bold()
                            .padding(6)
                            .background(.ultraThinMaterial)
                            .cornerRadius(2)
                        Text("\(viewModel.activeCalls.count) CALLS")
                            .font(.caption2).bold()
                            .padding(6)
                            .background(.ultraThinMaterial)
                            .cornerRadius(2)
                    }
                    .padding(8)
                }
                Spacer()
            }
        }
        .task { await viewModel.startPolling() }
    }
}

struct UnitAnnotationView: View {
    let unit: UnitAnnotation

    var body: some View {
        VStack(spacing: 2) {
            Circle()
                .fill(unit.statusColor)
                .frame(width: 16, height: 16)
                .overlay(Circle().stroke(Color.white, lineWidth: 1))
            Text(unit.callSign)
                .font(.system(size: 8, weight: .bold))
                .foregroundColor(.white)
                .padding(2)
                .background(Color.black.opacity(0.6))
                .cornerRadius(2)
        }
    }
}

struct CallAnnotationView: View {
    let call: ActiveCall

    var body: some View {
        Image(systemName: "exclamationmark.triangle.fill")
            .foregroundColor(call.displayPriority >= 1 ? .red : .orange)
            .font(.caption)
            .background(Circle().fill(Color.white).frame(width: 20, height: 20))
    }
}

@Observable
public final class UnitMapViewModel {
    private let apiClient: UnitMapAPIClient
    private let gpsProvider: RMPGCoreLocation.GPSProvider

    public var units: [UnitAnnotation] = []
    public var activeCalls: [ActiveCall] = []
    public var myLocation: CLLocation?

    init(apiClient: UnitMapAPIClient, gpsProvider: RMPGCoreLocation.GPSProvider) {
        self.apiClient = apiClient
        self.gpsProvider = gpsProvider
    }

    public func startPolling() async {
        while !Task.isCancelled {
            myLocation = gpsProvider.currentLocation
            do {
                activeCalls = try await apiClient.fetchActiveCalls()
                units = try await apiClient.fetchUnits()
            } catch {}
            try? await Task.sleep(nanoseconds: 10_000_000_000)
        }
    }

    deinit { Task { await startPolling() } }
}

public struct UnitAnnotation: Identifiable, Sendable {
    public let id: String
    public let callSign: String
    public let status: String
    public let location: CLLocationCoordinate2D?

    public var statusColor: Color {
        switch status {
        case "10-8", "on_duty": return .green
        case "10-97", "enroute": return .orange
        case "10-98", "onscene": return .red
        case "10-7", "off_duty": return .gray
        default: return .yellow
        }
    }
}

public struct UnitMapAPIClient: Sendable {
    public let baseURL: URL
    public let tokenProvider: @Sendable () -> String?

    public init(baseURL: URL, tokenProvider: @escaping @Sendable () -> String?) {
        self.baseURL = baseURL
        self.tokenProvider = tokenProvider
    }

    public func fetchUnits() async throws -> [UnitAnnotation] {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/dispatch/units"))
        if let token = tokenProvider() { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw URLError(.badServerResponse) }
        return try JSONDecoder.api.decode([UnitAnnotation].self, from: data)
    }

    public func fetchActiveCalls() async throws -> [ActiveCall] {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/dispatch/calls/active?limit=100"))
        if let token = tokenProvider() { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw URLError(.badServerResponse) }
        return try JSONDecoder.api.decode([ActiveCall].self, from: data)
    }
}

private extension JSONDecoder {
    static let api: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()
}

private extension ActiveCall {
    var locationCoordinate: CLLocationCoordinate2D? {
        guard let lat = latitude, let lon = longitude else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }
}

private extension ActiveCall {
    var latitude: Double? { nil }
    var longitude: Double? { nil }
}
