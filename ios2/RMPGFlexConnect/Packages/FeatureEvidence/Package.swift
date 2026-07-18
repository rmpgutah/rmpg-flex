// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FeatureEvidence",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "FeatureEvidence", targets: ["FeatureEvidence"]),
    ],
    dependencies: [
        .package(path: "../CoreAPI"),
        .package(path: "../CoreAuth"),
        .package(path: "../CoreLocationService"),
        .package(path: "../DesignSystem"),
    ],
    targets: [
        .target(
            name: "FeatureEvidence",
            dependencies: ["CoreAPI", "CoreAuth", "CoreLocationService", "DesignSystem"]
        ),
        .testTarget(
            name: "FeatureEvidenceTests",
            dependencies: ["FeatureEvidence"]
        ),
    ]
)
