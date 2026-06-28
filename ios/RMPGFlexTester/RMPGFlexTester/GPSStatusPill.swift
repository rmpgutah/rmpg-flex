import SwiftUI
import CoreLocation

// Compact GPS-fix indicator: green when accuracy is tight, gold when coarse,
// neutral when there's no fix yet. Observes the shared LocationManager.
struct GPSStatusPill: View {
    @ObservedObject private var location = LocationManager.shared

    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(color).frame(width: 7, height: 7)
            Image(systemName: "location.fill")
                .font(.system(size: 10)).foregroundStyle(color)
            Text(label).font(.system(size: 10, weight: .semibold)).foregroundStyle(color)
        }
        .padding(.horizontal, 8).padding(.vertical, 4)
        .background(Theme.raised)
        .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.border, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
    }

    private var accuracy: CLLocationAccuracy? {
        guard let acc = location.last?.horizontalAccuracy, acc >= 0 else { return nil }
        return acc
    }
    private var color: Color {
        guard let acc = accuracy else { return Theme.neutral }
        return acc <= 15 ? Theme.green : Theme.gold
    }
    private var label: String {
        guard let acc = accuracy else { return "NO GPS" }
        return "GPS ±\(Int(acc))m"
    }
}
