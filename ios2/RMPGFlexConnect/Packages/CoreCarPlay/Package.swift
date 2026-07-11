// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CoreCarPlay",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "CoreCarPlay", targets: ["CoreCarPlay"]),
    ],
    dependencies: [],
    targets: [
        .target(name: "CoreCarPlay", dependencies: [], exclude: ["CarPlaySceneDelegate.swift"]),
        .testTarget(name: "CoreCarPlayTests", dependencies: ["CoreCarPlay"]),
    ]
)
