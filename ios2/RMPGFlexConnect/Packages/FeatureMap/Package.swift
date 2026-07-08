// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FeatureMap",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "FeatureMap", targets: ["FeatureMap"])],
    dependencies: [
        .package(path: "../CoreAPI"),
        .package(path: "../CoreLocationService"),
        .package(path: "../DesignSystem"),
        .package(path: "../FeatureCFS"),
    ],
    targets: [
        .target(name: "FeatureMap", dependencies: ["CoreAPI", "CoreLocationService", "DesignSystem", "FeatureCFS"]),
        .testTarget(name: "FeatureMapTests", dependencies: ["FeatureMap"]),
    ]
)
