// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CoreAudioService",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "CoreAudioService", targets: ["CoreAudioService"])],
    dependencies: [],
    targets: [
        .target(name: "CoreAudioService"),
        .testTarget(name: "CoreAudioTests", dependencies: ["CoreAudioService"]),
    ]
)
