// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FeatureLiveActivity",
    platforms: [.iOS(.v17)],
    products: [.library(name: "FeatureLiveActivity", targets: ["FeatureLiveActivity"])],
    dependencies: [],
    targets: [
        .target(name: "FeatureLiveActivity"),
        .testTarget(name: "FeatureLiveActivityTests", dependencies: ["FeatureLiveActivity"]),
    ]
)
