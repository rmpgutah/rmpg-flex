// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FeatureReports",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "FeatureReports", targets: ["FeatureReports"])],
    dependencies: [
        .package(path: "../CoreAPI"),
        .package(path: "../CoreOffline"),
        .package(path: "../CoreAuth"),
        .package(path: "../DesignSystem"),
    ],
    targets: [
        .target(name: "FeatureReports", dependencies: ["CoreAPI", "CoreOffline", "CoreAuth", "DesignSystem"]),
        .testTarget(name: "FeatureReportsTests", dependencies: ["FeatureReports"]),
    ]
)
