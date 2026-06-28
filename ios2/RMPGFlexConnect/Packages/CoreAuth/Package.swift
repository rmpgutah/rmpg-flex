// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CoreAuth",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "CoreAuth", targets: ["CoreAuth"]),
    ],
    dependencies: [
        .package(path: "../CoreAPI"),
    ],
    targets: [
        .target(name: "CoreAuth", dependencies: ["CoreAPI"]),
        .testTarget(name: "CoreAuthTests", dependencies: ["CoreAuth"]),
    ]
)
