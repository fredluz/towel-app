// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "TowelVoice",
    platforms: [
        .macOS(.v26),
    ],
    products: [
        .executable(name: "towel-voice", targets: ["TowelVoice"]),
        .library(name: "TowelVoiceCore", targets: ["TowelVoiceCore"]),
    ],
    dependencies: [
        .package(
            url: "https://github.com/openclaw/Swabble.git",
            revision: "66117ce8c0ed910277c9895ee1d9ac33e8217ce6"
        ),
    ],
    targets: [
        .target(name: "TowelVoiceCore"),
        .executableTarget(
            name: "TowelVoice",
            dependencies: [
                "TowelVoiceCore",
                .product(name: "Swabble", package: "swabble"),
            ]
        ),
        .testTarget(
            name: "TowelVoiceCoreTests",
            dependencies: ["TowelVoiceCore"]
        ),
    ],
    swiftLanguageModes: [.v6]
)
