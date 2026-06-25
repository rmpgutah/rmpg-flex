// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CoreLocation",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "CoreLocation", targets: ["CoreLocation"])],
    dependencies: [],
    targets: [
        .target(name: "CoreLocation"),
        .testTarget(name: "CoreLocationTests", dependencies: ["CoreLocation"]),
    ]
)
