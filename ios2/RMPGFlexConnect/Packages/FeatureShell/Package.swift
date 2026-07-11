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
        .package(path: "../CoreAudioService"),
        .package(path: "../CoreLocationService"),
        .package(path: "../DesignSystem"),
        .package(path: "../FeatureDuty"),
        .package(path: "../FeatureCFS"),
        .package(path: "../FeatureQuickActions"),
        .package(path: "../FeatureReports"),
        .package(path: "../FeatureRunPlate"),
        .package(path: "../FeatureRunID"),
        .package(path: "../FeatureLiveActivity"),
        .package(path: "../FeatureMap"),
    ],
    targets: [
        .target(
            name: "FeatureShell",
            dependencies: [
                "CoreAPI", "CoreAuth", "CoreAudioService", "CoreLocationService",
                "DesignSystem", "FeatureDuty", "FeatureCFS", "FeatureQuickActions",
                "FeatureReports", "FeatureRunPlate", "FeatureRunID", "FeatureLiveActivity",
                "FeatureMap",
            ],
            resources: [.process("Resources")]
        ),
        .testTarget(
            name: "FeatureShellTests",
            dependencies: ["FeatureShell"]
        ),
    ]
)
