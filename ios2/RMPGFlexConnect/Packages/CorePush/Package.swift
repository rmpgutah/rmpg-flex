// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CorePush",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "CorePush", targets: ["CorePush"])],
    dependencies: [],
    targets: [
        .target(name: "CorePush"),
        .testTarget(name: "CorePushTests", dependencies: ["CorePush"]),
    ]
)
