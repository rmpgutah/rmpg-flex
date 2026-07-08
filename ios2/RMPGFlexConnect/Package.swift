// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "RMPGFlexConnect",
    platforms: [.iOS(.v18)],
    products: [
        .library(name: "CoreAPI", targets: ["CoreAPI"]),
        .library(name: "CoreAuth", targets: ["CoreAuth"]),
        .library(name: "FeatureDispatch", targets: ["FeatureDispatch"]),
        .library(name: "FeatureRecords", targets: ["FeatureRecords"]),
        .library(name: "FeatureIncidents", targets: ["FeatureIncidents"]),
        .library(name: "FeatureCases", targets: ["FeatureCases"]),
        .library(name: "FeaturePatrol", targets: ["FeaturePatrol"]),
        .library(name: "FeatureFleet", targets: ["FeatureFleet"]),
        .library(name: "FeatureServe", targets: ["FeatureServe"]),
        .library(name: "FeatureWarrants", targets: ["FeatureWarrants"]),
        .library(name: "FeatureShell", targets: ["FeatureShell"]),
        .library(name: "DesignSystem", targets: ["DesignSystem"]),
        .library(name: "CoreOffline", targets: ["CoreOffline"]),
        .library(name: "CorePush", targets: ["CorePush"]),
        .library(name: "CoreLocationService", targets: ["CoreLocationService"]),
        .library(name: "CoreAudioService", targets: ["CoreAudioService"]),
        .library(name: "CoreIDScan", targets: ["CoreIDScan"]),
        .library(name: "FeatureQuickActions", targets: ["FeatureQuickActions"]),
        .library(name: "FeatureCFS", targets: ["FeatureCFS"]),
        .library(name: "FeatureDuty", targets: ["FeatureDuty"]),
        .library(name: "FeatureRunID", targets: ["FeatureRunID"]),
        .library(name: "FeatureRunPlate", targets: ["FeatureRunPlate"]),
        .library(name: "FeatureReports", targets: ["FeatureReports"]),
        .library(name: "FeatureMap", targets: ["FeatureMap"]),
    ],
    dependencies: [],
    targets: [
        .target(name: "CoreAPI", dependencies: []),
        .target(name: "CoreAuth", dependencies: ["CoreAPI", "DesignSystem"]),
        .target(name: "FeatureDispatch", dependencies: ["CoreAPI", "CoreAuth", "DesignSystem", "CoreLocationService", "CorePush"]),
        .target(name: "FeatureRecords", dependencies: ["CoreAPI", "CoreAuth", "DesignSystem"]),
        .target(name: "FeatureIncidents", dependencies: ["CoreAPI", "CoreAuth", "DesignSystem"]),
        .target(name: "FeatureCases", dependencies: ["CoreAPI", "CoreAuth", "DesignSystem"]),
        .target(name: "FeaturePatrol", dependencies: ["CoreAPI", "CoreAuth", "DesignSystem", "CoreLocationService"]),
        .target(name: "FeatureFleet", dependencies: ["CoreAPI", "CoreAuth", "DesignSystem"]),
        .target(name: "FeatureServe", dependencies: ["CoreAPI", "CoreAuth", "DesignSystem"]),
        .target(name: "FeatureWarrants", dependencies: ["CoreAPI", "CoreAuth", "DesignSystem"]),
        .target(name: "FeatureShell", dependencies: ["CoreAPI", "CoreAuth", "DesignSystem", "CorePush", "FeatureDispatch", "FeatureRecords", "FeatureIncidents", "FeatureCases", "FeaturePatrol", "FeatureFleet", "FeatureServe", "FeatureWarrants", "FeatureQuickActions", "FeatureCFS", "FeatureDuty", "FeatureRunID", "FeatureRunPlate", "FeatureReports", "FeatureMap"]),
        .target(name: "DesignSystem", dependencies: []),
        .target(name: "CoreOffline", dependencies: ["CoreAPI"]),
        .target(name: "CorePush", dependencies: ["CoreAPI"]),
        .target(name: "CoreLocationService", dependencies: ["CoreAPI"]),
        .target(name: "CoreAudioService", dependencies: []),
        .target(name: "CoreIDScan", dependencies: ["DesignSystem"]),
        .target(name: "FeatureQuickActions", dependencies: ["CoreAPI", "CoreIDScan", "DesignSystem", "FeatureRunPlate", "FeatureReports", "FeatureRunID"]),

        // Ported in from Packages/ — these had no naming collision with the
        // targets above, so unlike CoreAPI/DesignSystem/FeatureShell/etc.
        // (which have divergent Packages/ AND Sources/ implementations
        // needing a real reconciliation pass) these could be wired in
        // directly. Sources stay in place under Packages/<name>/ rather
        // than being copied, so existing history/tests aren't duplicated.
        .target(name: "FeatureCFS", dependencies: ["CoreAPI", "DesignSystem"], path: "Packages/FeatureCFS/Sources/FeatureCFS"),
        .testTarget(name: "FeatureCFSTests", dependencies: ["FeatureCFS"], path: "Packages/FeatureCFS/Tests/FeatureCFSTests"),
        .target(name: "FeatureDuty", dependencies: ["CoreAPI", "CoreAuth", "DesignSystem"], path: "Packages/FeatureDuty/Sources/FeatureDuty"),
        .testTarget(name: "FeatureDutyTests", dependencies: ["FeatureDuty"], path: "Packages/FeatureDuty/Tests/FeatureDutyTests"),
        .target(name: "FeatureRunID", dependencies: ["CoreAPI", "DesignSystem"], path: "Packages/FeatureRunID/Sources/FeatureRunID"),
        .testTarget(name: "FeatureRunIDTests", dependencies: ["FeatureRunID"], path: "Packages/FeatureRunID/Tests/FeatureRunIDTests"),
        .target(name: "FeatureRunPlate", dependencies: ["CoreAPI", "DesignSystem"], path: "Packages/FeatureRunPlate/Sources/FeatureRunPlate"),
        .testTarget(name: "FeatureRunPlateTests", dependencies: ["FeatureRunPlate"], path: "Packages/FeatureRunPlate/Tests/FeatureRunPlateTests"),
        .target(name: "FeatureReports", dependencies: ["CoreAPI", "CoreOffline", "DesignSystem"], path: "Packages/FeatureReports/Sources/FeatureReports"),
        .testTarget(name: "FeatureReportsTests", dependencies: ["FeatureReports"], path: "Packages/FeatureReports/Tests/FeatureReportsTests"),
        .target(name: "FeatureMap", dependencies: ["CoreAPI", "CoreLocationService", "DesignSystem", "FeatureCFS"], path: "Packages/FeatureMap/Sources/FeatureMap"),
        .testTarget(name: "FeatureMapTests", dependencies: ["FeatureMap"], path: "Packages/FeatureMap/Tests/FeatureMapTests"),
    ]
)
