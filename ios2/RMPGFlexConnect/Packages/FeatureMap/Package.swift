// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FeatureMap",
    platforms: [.iOS(.v17)],
    products: [.library(name: "FeatureMap", targets: ["FeatureMap"])],
    dependencies: [
        .package(path: "../CoreAPI"),
        .package(path: "../CoreLocation"),
        .package(path: "../DesignSystem"),
        .package(path: "../FeatureCFS"),
    ],
    targets: [
        .target(name: "FeatureMap", dependencies: ["CoreAPI", "CoreLocation", "DesignSystem", "FeatureCFS"]),
        .testTarget(name: "FeatureMapTests", dependencies: ["FeatureMap"]),
    ]
)
