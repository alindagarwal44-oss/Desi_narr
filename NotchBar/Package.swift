// swift-tools-version: 5.7
import PackageDescription

let package = Package(
    name: "NotchBar",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "NotchBar", path: "Sources/NotchBar")
    ]
)
