// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FeatureQuickActions",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "FeatureQuickActions", targets: ["FeatureQuickActions"]),
    ],
    dependencies: [
        .package(path: "../CoreAPI"),
        .package(path: "../DesignSystem"),
        .package(path: "../FeatureDuty"),
        .package(path: "../FeatureCFS"),
        .package(path: "../FeatureReports"),
    ],
    targets: [
        .target(
            name: "FeatureQuickActions",
            dependencies: ["CoreAPI", "DesignSystem", "FeatureDuty", "FeatureCFS", "FeatureReports"]
        ),
        .testTarget(
            name: "FeatureQuickActionsTests",
            dependencies: ["FeatureQuickActions"]
        ),
    ]
)
