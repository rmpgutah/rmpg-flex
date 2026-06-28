// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FeatureWidgets",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "FeatureWidgets", targets: ["FeatureWidgets"])],
    dependencies: [],
    targets: [
        .target(name: "FeatureWidgets"),
        .testTarget(name: "FeatureWidgetsTests", dependencies: ["FeatureWidgets"]),
    ]
)
