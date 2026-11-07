// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ContactMatchCore",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [
        .library(name: "ContactMatchCore", targets: ["ContactMatchCore"])
    ],
    dependencies: [
        .package(url: "https://github.com/marmelroy/PhoneNumberKit.git", exact: "4.3.0")
    ],
    targets: [
        .target(name: "ContactMatchCore", dependencies: [
            .product(name: "PhoneNumberKit", package: "PhoneNumberKit")
        ]),
        .testTarget(name: "ContactMatchCoreTests", dependencies: ["ContactMatchCore"])
    ]
)
