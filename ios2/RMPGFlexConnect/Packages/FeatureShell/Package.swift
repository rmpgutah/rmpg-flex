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
        .package(path: "../DesignSystem"),
        .package(path: "../FeatureCFS"),
        .package(path: "../FeatureDuty"),
        .package(path: "../FeatureQuickActions"),
    ],
    targets: [
        .target(
            name: "FeatureShell",
            dependencies: ["CoreAPI", "CoreAuth", "DesignSystem", "FeatureCFS", "FeatureDuty", "FeatureQuickActions"]
        ),
        .testTarget(
            name: "FeatureShellTests",
            dependencies: ["FeatureShell"]
        ),
    ]
)
