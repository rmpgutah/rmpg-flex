// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FeatureDuty",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "FeatureDuty", targets: ["FeatureDuty"]),
    ],
    dependencies: [
        .package(path: "../CoreAPI"),
        .package(path: "../CoreAuth"),
        .package(path: "../DesignSystem"),
    ],
    targets: [
        .target(name: "FeatureDuty", dependencies: ["CoreAPI", "CoreAuth", "DesignSystem"]),
        .testTarget(name: "FeatureDutyTests", dependencies: ["FeatureDuty"]),
    ]
)
