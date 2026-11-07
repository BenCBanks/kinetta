import CryptoKit
import Foundation
import PhoneNumberKit

public enum ContactHashKind: String, Codable, Hashable, Sendable {
    case email
    case phone
}

public struct ContactMatchDigest: Codable, Equatable, Hashable, Sendable {
    public let kind: ContactHashKind
    public let digest: String

    public init(kind: ContactHashKind, digest: String) {
        self.kind = kind
        self.digest = digest
    }
}

public struct ContactMatchSource: Equatable, Sendable {
    public let id: String
    public let name: String
    public let emails: [String]
    public let phones: [String]

    public init(id: String, name: String, emails: [String], phones: [String]) {
        self.id = id
        self.name = name
        self.emails = emails
        self.phones = phones
    }
}

public struct ContactMatchContact: Codable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let hashes: [ContactMatchDigest]
}

public struct ContactMatchBatch: Codable, Equatable, Sendable {
    public let contacts: [ContactMatchContact]
    public let hashes: [ContactMatchDigest]
    public let truncated: Bool
}

public enum ContactMatchError: Error, Equatable {
    case invalidSalt
}

public enum ContactMatchHasher {
    public static let maxHashes = 2_000
    private static let phoneNumbers = PhoneNumberUtility()
    private static let posix = Locale(identifier: "en_US_POSIX")

    public static func normalizeEmail(_ value: String) -> String? {
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(with: posix)
        guard !normalized.isEmpty, normalized.utf8.count <= 320,
              !normalized.unicodeScalars.contains(where: CharacterSet.whitespacesAndNewlines.contains) else { return nil }
        let parts = normalized.split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[0].isEmpty, !parts[1].isEmpty else { return nil }
        return normalized
    }

    public static func normalizePhone(_ value: String, region: String) -> String? {
        let candidate = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let country = region.uppercased(with: posix)
        guard !candidate.isEmpty, country.count == 2 else { return nil }
        guard let number = try? phoneNumbers.parse(candidate, withRegion: country, ignoreType: true) else { return nil }
        return phoneNumbers.format(number, toType: .e164)
    }

    public static func build(salt: String, region: String, contacts: [ContactMatchSource]) throws -> ContactMatchBatch {
        guard validSalt(salt) else { throw ContactMatchError.invalidSalt }

        var unique = Set<ContactMatchDigest>()
        var localContacts: [ContactMatchContact] = []
        var truncated = false

        for contact in contacts {
            var contactHashes = Set<ContactMatchDigest>()
            let identifiers = contact.emails.compactMap(normalizeEmail).map { (ContactHashKind.email, $0) }
                + contact.phones.compactMap { normalizePhone($0, region: region) }.map { (ContactHashKind.phone, $0) }
            for (kind, normalized) in identifiers {
                let item = ContactMatchDigest(kind: kind, digest: digest(salt: salt, kind: kind, value: normalized))
                if unique.contains(item) {
                    contactHashes.insert(item)
                } else if unique.count < maxHashes {
                    unique.insert(item)
                    contactHashes.insert(item)
                } else {
                    truncated = true
                }
            }
            if !contactHashes.isEmpty {
                localContacts.append(ContactMatchContact(id: contact.id, name: contact.name,
                    hashes: contactHashes.sorted(by: digestOrder)))
            }
        }

        return ContactMatchBatch(contacts: localContacts, hashes: unique.sorted(by: digestOrder), truncated: truncated)
    }

    private static func validSalt(_ salt: String) -> Bool {
        let bytes = Array(salt.utf8)
        guard (32...64).contains(bytes.count) else { return false }
        return bytes.allSatisfy { (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 95 }
    }

    private static func digest(salt: String, kind: ContactHashKind, value: String) -> String {
        let bytes = Data("\(salt):\(kind.rawValue):\(value)".utf8)
        return SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    }

    private static func digestOrder(_ lhs: ContactMatchDigest, _ rhs: ContactMatchDigest) -> Bool {
        if lhs.kind != rhs.kind { return lhs.kind.rawValue < rhs.kind.rawValue }
        return lhs.digest < rhs.digest
    }
}
