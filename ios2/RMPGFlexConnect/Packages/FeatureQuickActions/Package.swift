// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FeatureQuickActions",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "FeatureQuickActions", targets: ["FeatureQuickActions"]),
    ],
    dependencies: [
        .package(path: "../DesignSystem"),
    ],
    targets: [
        .target(name: "FeatureQuickActions", dependencies: ["DesignSystem"]),
        .testTarget(name: "FeatureQuickActionsTests", dependencies: ["FeatureQuickActions"]),
    ]
)
