// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FeatureCFS",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "FeatureCFS", targets: ["FeatureCFS"]),
    ],
    dependencies: [
        .package(path: "../CoreAPI"),
        .package(path: "../DesignSystem"),
    ],
    targets: [
        .target(name: "FeatureCFS", dependencies: ["CoreAPI", "DesignSystem"]),
        .testTarget(name: "FeatureCFSTests", dependencies: ["FeatureCFS"]),
    ]
)
