// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FeatureRunPlate",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "FeatureRunPlate", targets: ["FeatureRunPlate"])],
    dependencies: [
        .package(path: "../CoreAPI"),
        .package(path: "../DesignSystem"),
    ],
    targets: [
        .target(name: "FeatureRunPlate", dependencies: ["CoreAPI", "DesignSystem"]),
        .testTarget(name: "FeatureRunPlateTests", dependencies: ["FeatureRunPlate"]),
    ]
)
