import Foundation
import CryptoKit

// A session is stored in Keychain only. It must never be encoded into a food-job file.
struct ShareFoodCredential: Codable, Equatable {
    let server: String
    let userID: Int
    let token: String
    let name: String
    let generation: UUID
    var ownerDigest: String {
        SHA256.hash(data:Data("\(server)\n\(userID)".utf8)).map { String(format:"%02x",$0) }.joined()
    }
    init(server: String,userID: Int,token: String,name: String,generation: UUID = UUID()) throws {
        guard var parts = URLComponents(string:server),parts.scheme?.lowercased() == "https",
              let host = parts.host,!host.isEmpty,parts.user == nil,parts.password == nil,
              parts.query == nil,parts.fragment == nil,server.utf16.count <= 2048,userID > 0,
              name.utf16.count <= 200,token.range(of:"^[A-Za-z0-9_.-]{20,512}$",options:.regularExpression) != nil else { throw ShareFoodFailure.invalid }
        parts.scheme = "https";parts.host = host.lowercased()
        if parts.port == 443 { parts.port = nil }
        while parts.path.hasSuffix("/") { parts.path.removeLast() }
        guard let normalized = parts.url?.absoluteString,normalized.utf8.count <= 3072 else { throw ShareFoodFailure.invalid }
        self.server = normalized;self.userID = userID;self.token = token
        self.name = String(name.trimmingCharacters(in:.whitespacesAndNewlines).prefix(80));self.generation = generation
    }
    func sameSession(as other: Self) -> Bool {
        ownerDigest == other.ownerDigest && generation == other.generation && token == other.token
    }
    func checked() throws -> Self { try Self(server:server,userID:userID,token:token,name:name,generation:generation) }
}

struct ShareFoodJob: Equatable {
    enum Kind: String,Codable { case text, photo, recipeLink = "recipe-link" }
    let id: UUID
    let ownerDigest: String
    let created: Date
    let kind: Kind
    let text: String
    let recipeURL: String?
    let image: Data?
    init(id: UUID,ownerDigest: String,created: Date,kind: Kind,text: String,recipeURL: String?,image: Data?) {
        self.id = id;self.ownerDigest = ownerDigest
        self.created = Date(timeIntervalSince1970:floor(created.timeIntervalSince1970*1000)/1000)
        self.kind = kind;self.text = text;self.recipeURL = recipeURL;self.image = image
    }
    static let maxImageBytes = 3 * 1024 * 1024
    static let maxPending = 20
    var capturedAt: String {
        let f = ISO8601DateFormatter();f.formatOptions = [.withInternetDateTime,.withFractionalSeconds]
        return f.string(from:created)
    }
    var messageText: String { text.isEmpty ? (kind == .photo ? "Food photo" : recipeURL ?? "") : text }
    func validate(now: Date = Date()) throws {
        guard ownerDigest.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil,
              text.utf16.count <= 4000,created.timeIntervalSince1970.isFinite,
              created >= Date(timeIntervalSince1970:946684800),created <= now.addingTimeInterval(300) else { throw ShareFoodFailure.invalid }
        switch kind {
        case .text:
            guard !text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty,image == nil,recipeURL == nil else { throw ShareFoodFailure.invalid }
        case .photo:
            guard recipeURL == nil,let bytes = image,bytes.count >= 4,bytes.count <= Self.maxImageBytes,
                  bytes.prefix(2) == Data([0xff,0xd8]),bytes.suffix(2) == Data([0xff,0xd9]) else { throw ShareFoodFailure.invalid }
        case .recipeLink:
            guard image == nil,let link = recipeURL,link.utf16.count <= 2048,
                  let p = URLComponents(string:link),p.scheme?.lowercased() == "https",
                  p.host?.isEmpty == false,p.user == nil,p.password == nil else { throw ShareFoodFailure.invalid }
        }
    }
}

enum ShareFoodFailure: LocalizedError {
    case unavailable,signedOut,changed,full,invalid,unreadable
    var errorDescription: String? {
        switch self {
        case .unavailable:return "Sharing is not configured in this build. Open Kinetta to log food."
        case .signedOut:return "Open Kinetta and sign in before sharing food."
        case .changed:return "The account or shared message changed. Open Kinetta and share again."
        case .full:return "Open Kinetta to finish sending your waiting food shares first."
        case .invalid:return "Use a food description, one photo, or a secure recipe link."
        case .unreadable:return "This food share could not be read. Keep it on this phone and try again."
        }
    }
}
