// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FeatureShell",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "FeatureShell", targets: ["FeatureShell"]),
    ],
    dependencies: [
        .package(path: "../CoreAPI"),
        .package(path: "../CoreAuth"),
        .package(path: "../CoreAudio"),
        .package(path: "../CoreLocation"),
        .package(path: "../DesignSystem"),
        .package(path: "../FeatureDuty"),
        .package(path: "../FeatureCFS"),
        .package(path: "../FeatureQuickActions"),
        .package(path: "../FeatureReports"),
        .package(path: "../FeatureRunPlate"),
        .package(path: "../FeatureRunID"),
        .package(path: "../FeatureLiveActivity"),
    ],
    targets: [
        .target(
            name: "FeatureShell",
            dependencies: [
                "CoreAPI", "CoreAuth", "CoreAudio", "CoreLocation",
                "DesignSystem", "FeatureDuty", "FeatureCFS", "FeatureQuickActions",
                "FeatureReports", "FeatureRunPlate", "FeatureRunID", "FeatureLiveActivity",
            ]
        ),
        .testTarget(
            name: "FeatureShellTests",
            dependencies: ["FeatureShell"]
        ),
    ]
)
