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
        .package(path: "../CoreAuth"),
        .package(path: "../DesignSystem"),
        .package(path: "../FeatureDuty"),
        .package(path: "../FeatureCFS"),
        .package(path: "../FeatureReports"),
        .package(path: "../FeatureEvidence"),
    ],
    targets: [
        .target(
            name: "FeatureQuickActions",
            dependencies: ["CoreAPI", "CoreAuth", "DesignSystem", "FeatureDuty", "FeatureCFS", "FeatureReports", "FeatureEvidence"]
        ),
        .testTarget(
            name: "FeatureQuickActionsTests",
            dependencies: ["FeatureQuickActions"]
        ),
    ]
)
