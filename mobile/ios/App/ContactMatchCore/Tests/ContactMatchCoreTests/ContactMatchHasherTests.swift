import Foundation
import XCTest
@testable import ContactMatchCore

final class ContactMatchHasherTests: XCTestCase {
    private let salt = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef"

    func testEmailNormalizationAndServerCompatibleDigest() throws {
        XCTAssertEqual(ContactMatchHasher.normalizeEmail("  Alice@Example.Test\n"), "alice@example.test")
        XCTAssertNil(ContactMatchHasher.normalizeEmail("not an email"))

        let batch = try ContactMatchHasher.build(salt: salt, region: "US", contacts: [
            ContactMatchSource(id: "local-a", name: "Fictional Contact", emails: [" Alice@Example.Test "], phones: [])
        ])
        XCTAssertEqual(batch.hashes, [ContactMatchDigest(kind: .email,
            digest: "a171e54e6dfc51c23f3044a38f69bb954d0e5dd7f294665719f10342605a32ca")])
    }

    func testPhoneUsesDeviceRegionAndE164BeforeHashing() throws {
        XCTAssertEqual(ContactMatchHasher.normalizePhone("650-253-0000", region: "US"), "+16502530000")
        XCTAssertEqual(ContactMatchHasher.normalizePhone("+1 (650) 253-0000", region: "GB"), "+16502530000")
        let batch = try ContactMatchHasher.build(salt: salt, region: "US", contacts: [
            ContactMatchSource(id: "local-a", name: "Fictional Contact", emails: [], phones: ["650-253-0000"])
        ])
        XCTAssertEqual(batch.hashes, [ContactMatchDigest(kind: .phone,
            digest: "c21fc79c9da3d21b978bc44ed18eb3cfa57a36f05ec47b55532fca5c1ff04ce7")])
    }

    func testDuplicateIdentifiersAreDeduplicatedAndKeptOnlyInLocalMapping() throws {
        let batch = try ContactMatchHasher.build(salt: salt, region: "US", contacts: [
            ContactMatchSource(id: "local-a", name: "Fictional A", emails: ["shared@example.test"], phones: ["650-253-0000"]),
            ContactMatchSource(id: "local-b", name: "Fictional B", emails: ["SHARED@example.test"], phones: ["+1 650 253 0000"])
        ])
        XCTAssertEqual(batch.hashes.count, 2)
        XCTAssertEqual(batch.contacts.count, 2)
        XCTAssertEqual(batch.contacts.map(\.hashes.count), [2, 2])
        let json = String(decoding: try JSONEncoder().encode(batch), as: UTF8.self)
        XCTAssertFalse(json.contains("shared@example.test"))
        XCTAssertFalse(json.contains("650-253-0000"))
        XCTAssertTrue(json.contains("local-a"))
    }

    func testRejectsInvalidSaltAndCapsTheRequestAtTwoThousandHashes() throws {
        XCTAssertThrowsError(try ContactMatchHasher.build(salt: "short", region: "US", contacts: []))
        let source = ContactMatchSource(id: "local-many", name: "Fictional Contact",
            emails: (0...ContactMatchHasher.maxHashes).map { "person\($0)@example.test" }, phones: [])
        let batch = try ContactMatchHasher.build(salt: salt, region: "US", contacts: [source])
        XCTAssertEqual(batch.hashes.count, ContactMatchHasher.maxHashes)
        XCTAssertTrue(batch.truncated)
    }
}
