// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CoreLocationService",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "CoreLocationService", targets: ["CoreLocationService"])],
    dependencies: [],
    targets: [
        .target(name: "CoreLocationService"),
        .testTarget(name: "CoreLocationTests", dependencies: ["CoreLocationService"]),
    ]
)
