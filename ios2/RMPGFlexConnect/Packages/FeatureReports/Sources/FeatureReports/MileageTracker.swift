import Foundation

public actor MileageTracker {
    private var startOdometer: Double?
    private var tripSegments: [TripSegment] = []

    public var totalMileage: Double {
        tripSegments.reduce(0) { $0 + $1.distance }
    }

    public func startTrip(odometer: Double?) {
        startOdometer = odometer
    }

    public func recordSegment(from: LocationPoint, to: LocationPoint) {
        let distance = haversine(lat1: from.latitude, lon1: from.longitude, lat2: to.latitude, lon2: to.longitude)
        tripSegments.append(TripSegment(start: from, end: to, distance: distance))
    }

    public func endTrip(endOdometer: Double?) -> TripSummary {
        let total = totalMileage
        let summary = TripSummary(
            totalMiles: total,
            segmentCount: tripSegments.count,
            startOdometer: startOdometer,
            endOdometer: endOdometer
        )
        tripSegments.removeAll()
        startOdometer = nil
        return summary
    }

    private func haversine(lat1: Double, lon1: Double, lat2: Double, lon2: Double) -> Double {
        let r = 3959.0
        let dLat = (lat2 - lat1) * .pi / 180
        let dLon = (lon2 - lon1) * .pi / 180
        let a = sin(dLat / 2) * sin(dLat / 2) +
                cos(lat1 * .pi / 180) * cos(lat2 * .pi / 180) *
                sin(dLon / 2) * sin(dLon / 2)
        return r * 2 * atan2(sqrt(a), sqrt(1 - a))
    }
}

public struct LocationPoint: Codable, Sendable {
    public let latitude: Double
    public let longitude: Double
    public let timestamp: Date
}

struct TripSegment {
    let start: LocationPoint
    let end: LocationPoint
    let distance: Double
}

public struct TripSummary: Sendable {
    public let totalMiles: Double
    public let segmentCount: Int
    public let startOdometer: Double?
    public let endOdometer: Double?
}
