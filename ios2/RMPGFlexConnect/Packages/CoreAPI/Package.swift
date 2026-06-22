// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CoreAPI",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "CoreAPI", targets: ["CoreAPI"]),
    ],
    targets: [
        .target(name: "CoreAPI"),
        .testTarget(name: "CoreAPITests", dependencies: ["CoreAPI"]),
    ]
)
