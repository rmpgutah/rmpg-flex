import Foundation

public struct GPSPoint: Codable, Sendable {
    public let latitude: Double
    public let longitude: Double
    public let accuracy: Double?
    public let heading: Double?
    public let speed: Double?

    public init(latitude: Double, longitude: Double, accuracy: Double? = nil, heading: Double? = nil, speed: Double? = nil) {
        self.latitude = latitude
        self.longitude = longitude
        self.accuracy = accuracy
        self.heading = heading
        self.speed = speed
    }
}

public struct GPSBulkUpload: Codable, Sendable {
    public let points: [GPSPoint]
    public init(points: [GPSPoint]) { self.points = points }
}
