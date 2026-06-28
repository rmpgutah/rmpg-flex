// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CoreOffline",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "CoreOffline", targets: ["CoreOffline"])],
    dependencies: [],
    targets: [
        .target(name: "CoreOffline"),
        .testTarget(name: "CoreOfflineTests", dependencies: ["CoreOffline"]),
    ]
)
