import SwiftUI
import MapKit

// UnitsMapView — live fleet situational awareness. Plots the latest position per
// unit (GET /api/dispatch/gps/current, last 5 min) on a map, refreshed every 10s,
// plus the officer's own device location. Units with no fix in the last ~2 min
// render dimmed (stale). Complements the GPS this app already pushes — now you
// can SEE the fleet, not just feed it.
struct UnitsMapView: View {
    private struct UnitPin: Identifiable {
        let id: Int
        let coord: CLLocationCoordinate2D
        let stale: Bool
    }

    @State private var pins: [UnitPin] = []
    @State private var camera: MapCameraPosition = .automatic
    @State private var loading = true
    @State private var status: String?

    var body: some View {
        ZStack(alignment: .top) {
            Map(position: $camera) {
                UserAnnotation()
                ForEach(pins) { p in
                    Annotation("Unit \(p.id)", coordinate: p.coord) {
                        ZStack {
                            Circle().fill(p.stale ? Theme.neutral : Theme.gold)
                                .frame(width: 28, height: 28)
                                .overlay(Circle().stroke(.black, lineWidth: 1.5))
                            Text("\(p.id)").font(.system(size: 10, weight: .bold)).foregroundStyle(.black)
                        }
                    }
                }
            }
            .mapStyle(.standard(elevation: .flat, pointsOfInterest: .excludingAll))
            .ignoresSafeArea(edges: .bottom)

            HStack {
                Text(loading ? "LOADING…" : "\(pins.count) UNIT\(pins.count == 1 ? "" : "S") LIVE")
                    .font(Theme.Typography.label).foregroundStyle(Theme.gold)
                Spacer()
                if let status { Text(status).font(.system(size: 10)).foregroundStyle(Theme.red) }
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(Theme.raised.opacity(0.92))
            .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
            .padding(10)
        }
        .navigationTitle("UNITS MAP")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await refresh(); loading = false
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                await refresh()
            }
        }
    }

    private func dbl(_ v: Any?) -> Double? {
        if let d = v as? Double { return d }
        if let i = v as? Int { return Double(i) }
        if let s = v as? String { return Double(s) }
        return nil
    }

    @MainActor
    private func refresh() async {
        guard let c = await ShiftNet.client(), c.jwt != nil else {
            status = "✗ Set RMPG credentials in Settings"; return
        }
        do {
            let any = try await c.requestJSON("GET", "api/dispatch/gps/current")
            let rows = (any as? [[String: Any]]) ?? ((any as? [String: Any])?["data"] as? [[String: Any]]) ?? []
            let now = Date()
            let iso = ISO8601DateFormatter()
            pins = rows.compactMap { r in
                guard let uid = (r["unit_id"] as? Int) ?? Int("\(r["unit_id"] ?? "")"),
                      let lat = dbl(r["latitude"]), let lon = dbl(r["longitude"]),
                      lat != 0 || lon != 0 else { return nil }
                var stale = false
                if let ts = r["recorded_at"] as? String {
                    let norm = ts.contains("T") ? ts : ts.replacingOccurrences(of: " ", with: "T") + "Z"
                    if let d = iso.date(from: norm) { stale = now.timeIntervalSince(d) > 120 }
                }
                return UnitPin(id: uid, coord: CLLocationCoordinate2D(latitude: lat, longitude: lon), stale: stale)
            }
            status = nil
        } catch {
            status = "✗ \(error.localizedDescription)"
        }
    }
}
