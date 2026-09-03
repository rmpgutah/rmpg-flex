import SwiftUI
import MapKit


/// Live CAD map — plots active calls and units geographically. Reuses
/// `DispatchViewModel`'s already-fetched `calls`/`units` (both now carry
/// real lat/lng: calls via the `location_address`/lat/lng fix, units always
/// had it) rather than issuing a second fetch, so switching List ↔ Map is
/// instant and never double-polls the Worker.
struct DispatchMapView: View {
    @ObservedObject var viewModel: DispatchViewModel
    @State private var cameraPosition: MapCameraPosition = .automatic
    @State private var selectedCall: CallForService?
    @State private var selectedUnit: Unit?

    private var mappableCalls: [CallForService] {
        viewModel.calls.filter { $0.latitude != nil && $0.longitude != nil }
    }

    private var mappableUnits: [Unit] {
        viewModel.units.filter { $0.lat != nil && $0.lng != nil }
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            Map(position: $cameraPosition, selection: .constant(nil)) {
                ForEach(mappableCalls) { call in
                    Annotation(call.callNumber ?? "Call", coordinate: CLLocationCoordinate2D(latitude: call.latitude!, longitude: call.longitude!)) {
                        Button { selectedCall = call; selectedUnit = nil } label: {
                            callPin(call)
                        }
                    }
                }
                ForEach(mappableUnits) { unit in
                    Annotation(unit.callSign ?? "Unit", coordinate: CLLocationCoordinate2D(latitude: unit.lat!, longitude: unit.lng!)) {
                        Button { selectedUnit = unit; selectedCall = nil } label: {
                            unitPin(unit)
                        }
                    }
                }
            }
            .mapStyle(.standard(elevation: .flat))
            .ignoresSafeArea(edges: .bottom)

            if let call = selectedCall {
                calloutCard {
                    HStack {
                        if let p = call.priority { StatusBadge.priority(p) }
                        if let s = call.status { StatusBadge(text: s.replacingOccurrences(of: "_", with: " ").capitalized, color: RMPGTheme.textSecondary) }
                        Spacer()
                        Button { selectedCall = nil } label: { Image(systemName: "xmark.circle.fill").foregroundColor(RMPGTheme.textMuted) }
                    }
                    Text(call.incidentType ?? "Unknown").font(.system(size: 13, weight: .semibold)).foregroundColor(RMPGTheme.textPrimary)
                    if let loc = call.locationAddress { Text(loc).font(.system(size: 11)).foregroundColor(RMPGTheme.textSecondary) }
                }
            } else if let unit = selectedUnit {
                calloutCard {
                    HStack {
                        Text(unit.callSign ?? "Unit \(unit.id)").font(.system(size: 13, weight: .semibold)).foregroundColor(RMPGTheme.textPrimary)
                        Spacer()
                        Button { selectedUnit = nil } label: { Image(systemName: "xmark.circle.fill").foregroundColor(RMPGTheme.textMuted) }
                    }
                    Text((unit.status ?? "unknown").replacingOccurrences(of: "_", with: " ").capitalized)
                        .font(.system(size: 11)).foregroundColor(unitColor(unit.status))
                }
            }
        }
        .onAppear {
            if let first = mappableCalls.first {
                cameraPosition = .region(MKCoordinateRegion(
                    center: CLLocationCoordinate2D(latitude: first.latitude!, longitude: first.longitude!),
                    span: MKCoordinateSpan(latitudeDelta: 0.15, longitudeDelta: 0.15)
                ))
            } else if let first = mappableUnits.first {
                cameraPosition = .region(MKCoordinateRegion(
                    center: CLLocationCoordinate2D(latitude: first.lat!, longitude: first.lng!),
                    span: MKCoordinateSpan(latitudeDelta: 0.15, longitudeDelta: 0.15)
                ))
            }
        }
    }

    private func calloutCard<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6, content: content)
            .padding(12)
            .background(RMPGTheme.raisedSurface)
            .cornerRadius(6)
            .shadow(radius: 6)
            .padding(12)
    }

    private func callPin(_ call: CallForService) -> some View {
        let color = priorityColor(call.priority)
        return ZStack {
            Circle().fill(color).frame(width: 22, height: 22)
            Image(systemName: "exclamationmark").font(.system(size: 10, weight: .bold)).foregroundColor(.white)
        }
        .overlay(Circle().stroke(Color.white, lineWidth: 1.5))
    }

    private func unitPin(_ unit: Unit) -> some View {
        let color = unitColor(unit.status)
        return ZStack {
            RoundedRectangle(cornerRadius: 4).fill(color).frame(width: 22, height: 22)
            Image(systemName: "car.fill").font(.system(size: 10)).foregroundColor(.white)
        }
        .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color.white, lineWidth: 1.5))
    }

    private func priorityColor(_ priority: String?) -> Color {
        switch priority {
        case "P1": return RMPGTheme.statusRed
        case "P2": return RMPGTheme.statusOrange
        case "P3": return RMPGTheme.statusYellow
        default: return RMPGTheme.textMuted
        }
    }

    /// Same real `units.status` CHECK values as UnitBoardView's statusColor
    /// (available, dispatched, enroute, onscene, busy, off_duty, out_of_service).
    private func unitColor(_ status: String?) -> Color {
        switch status {
        case "available": return RMPGTheme.statusGreen
        case "dispatched", "busy", "enroute": return RMPGTheme.statusOrange
        case "onscene": return RMPGTheme.statusBlue
        case "out_of_service": return RMPGTheme.statusRed
        default: return RMPGTheme.textMuted
        }
    }
}
