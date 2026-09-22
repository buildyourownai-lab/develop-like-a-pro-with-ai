// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "StockBriefingCore",
    platforms: [.macOS(.v13), .iOS(.v17)],
    products: [.library(name: "StockBriefingCore", targets: ["StockBriefingCore"])],
    targets: [
        .target(
            name: "StockBriefingCore",
            path: "StockBriefing/Sources/Core"
        ),
        .testTarget(
            name: "StockBriefingCoreTests",
            dependencies: ["StockBriefingCore"],
            path: "StockBriefingCoreTests"
        ),
    ]
)
