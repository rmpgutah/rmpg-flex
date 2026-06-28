// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FeatureRunID",
    platforms: [.iOS(.v17)],
    products: [.library(name: "FeatureRunID", targets: ["FeatureRunID"])],
    dependencies: [
        .package(path: "../CoreAPI"),
        .package(path: "../DesignSystem"),
    ],
    targets: [
        .target(name: "FeatureRunID", dependencies: ["CoreAPI", "DesignSystem"]),
        .testTarget(name: "FeatureRunIDTests", dependencies: ["FeatureRunID"]),
    ]
)
