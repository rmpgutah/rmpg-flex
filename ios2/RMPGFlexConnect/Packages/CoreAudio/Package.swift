// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CoreAudio",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "CoreAudio", targets: ["CoreAudio"])],
    dependencies: [],
    targets: [
        .target(name: "CoreAudio"),
        .testTarget(name: "CoreAudioTests", dependencies: ["CoreAudio"]),
    ]
)
