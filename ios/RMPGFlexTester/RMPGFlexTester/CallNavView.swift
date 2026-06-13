import SwiftUI
import MapKit
import CoreLocation
import UIKit

// In-app route preview to a call (native MapKit — no third-party SDK, so it
// builds with swiftc + refresh-device.sh) plus a one-tap handoff to Apple Maps
// for full spoken turn-by-turn.
struct CallNavView: View {
    let dest: CLLocationCoordinate2D
    let label: String

    @State private var route: MKRoute?
    @State private var summary = "Calculating route…"

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "location.north.line.fill").foregroundStyle(Theme.gold)
                VStack(alignment: .leading, spacing: 1) {
                    Text(label.isEmpty ? "Destination" : label)
                        .font(.system(size: 13, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                    Text(summary).font(.system(size: 11, design: .monospaced)).foregroundStyle(Theme.gold)
                }
                Spacer()
            }
            .padding(10).background(Theme.raised)

            RouteMapView(dest: dest, route: route).frame(maxHeight: .infinity)

            VStack(spacing: 6) {
                Button { open(walking: false) } label: {
                    Label("START DRIVING — APPLE MAPS", systemImage: "car.fill")
                        .frame(maxWidth: .infinity).font(.system(size: 13, weight: .bold))
                }.buttonStyle(GoldButtonStyle())
                Button { open(walking: true) } label: {
                    Label("WALK", systemImage: "figure.walk")
                        .frame(maxWidth: .infinity).font(.system(size: 12, weight: .semibold))
                }.buttonStyle(RaisedButtonStyle())
            }
            .padding(10).background(Theme.base)
        }
        .background(Theme.base)
        .navigationTitle("NAVIGATE")
        .navigationBarTitleDisplayMode(.inline)
        .task { await computeRoute() }
    }

    private func computeRoute() async {
        guard let origin = LocationManager.shared.last?.coordinate else { summary = "Waiting for GPS fix…"; return }
        let req = MKDirections.Request()
        req.source = MKMapItem(placemark: MKPlacemark(coordinate: origin))
        req.destination = MKMapItem(placemark: MKPlacemark(coordinate: dest))
        req.transportType = .automobile
        do {
            let resp = try await MKDirections(request: req).calculate()
            if let r = resp.routes.first {
                route = r
                let miles = r.distance / 1609.34
                let mins = max(1, Int(r.expectedTravelTime / 60))
                summary = String(format: "%.1f mi · ETA %d min", miles, mins)
            } else { summary = "No route found" }
        } catch {
            summary = "Route unavailable — use Apple Maps"
        }
    }

    private func open(walking: Bool) {
        let item = MKMapItem(placemark: MKPlacemark(coordinate: dest))
        item.name = label.isEmpty ? "Call location" : label
        item.openInMaps(launchOptions: [
            MKLaunchOptionsDirectionsModeKey: walking ? MKLaunchOptionsDirectionsModeWalking
                                                       : MKLaunchOptionsDirectionsModeDriving,
        ])
    }
}

// MKMapView with the officer's location, the destination pin, and the gold route line.
struct RouteMapView: UIViewRepresentable {
    let dest: CLLocationCoordinate2D
    let route: MKRoute?

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.delegate = context.coordinator
        map.showsUserLocation = true
        let pin = MKPointAnnotation()
        pin.coordinate = dest
        pin.title = "Call"
        map.addAnnotation(pin)
        map.setRegion(MKCoordinateRegion(center: dest, latitudinalMeters: 2500, longitudinalMeters: 2500), animated: false)
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        map.removeOverlays(map.overlays)
        if let route {
            map.addOverlay(route.polyline)
            map.setVisibleMapRect(route.polyline.boundingMapRect,
                                  edgePadding: UIEdgeInsets(top: 50, left: 40, bottom: 50, right: 40),
                                  animated: true)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, MKMapViewDelegate {
        func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            let r = MKPolylineRenderer(overlay: overlay)
            r.strokeColor = UIColor(red: 0xd4 / 255, green: 0xa0 / 255, blue: 0x17 / 255, alpha: 1)
            r.lineWidth = 5
            return r
        }
    }
}
