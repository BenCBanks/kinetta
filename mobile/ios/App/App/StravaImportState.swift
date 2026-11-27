import Foundation

// No credentials, original filename or outside URL is persisted with an archive.
struct StravaImportRecord: Codable, Equatable {
    static let maximum: Int64 = 2 * 1024 * 1024 * 1024
    static let pieceBytes = 8 * 1024 * 1024
    let id: UUID
    let owner: String
    let size: Int64
    let sha256: String
    let created: Date
    var confirmed = false
    var received: Int64 = 0
    var phase = "staged"
    var expires: Bool { Date().timeIntervalSince(created) >= 7 * 86400 }
    init(owner: String, size: Int64, sha256: String, now: Date = Date()) throws {
        guard Self.digest(owner), Self.digest(sha256), size > 0, size <= Self.maximum else { throw StravaImportFailure.invalid }
        self.id = UUID();self.owner = owner;self.size = size;self.sha256 = sha256;self.created = now
    }
    static func digest(_ value: String) -> Bool { value.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil }
    func check(owner: String, now: Date = Date()) throws {
        guard self.owner == owner else { throw StravaImportFailure.account }
        guard now.timeIntervalSince(created) < 7 * 86400, created <= now.addingTimeInterval(300) else { throw StravaImportFailure.expired }
        guard Self.digest(self.owner),Self.digest(sha256),size > 0,size <= Self.maximum,received >= 0,received <= size else { throw StravaImportFailure.invalid }
    }
    mutating func confirm(owner: String) throws { try check(owner:owner);confirmed = true;phase = "uploading" }
    // Always use the server's durable offset, including after a lost response.
    mutating func reconcile(id: UUID, size: Int64, sha256: String, received: Int64, state: String) throws {
        guard confirmed,self.id == id,self.size == size,self.sha256 == sha256,received >= 0,received <= size,
              ["uploading","preview_queued","review","importing","done","failed","cancelled"].contains(state) else { throw StravaImportFailure.invalid }
        self.received = received;self.phase = state
    }
    func nextPiece(owner: String) throws -> (offset: Int64, count: Int) {
        try check(owner:owner)
        guard confirmed,phase == "uploading",received < size else { throw StravaImportFailure.confirm }
        return (received,Int(min(Int64(Self.pieceBytes),size-received)))
    }
}

enum StravaImportFailure: LocalizedError {
    case invalid,account,expired,confirm,storage,network,auth
    var errorDescription: String? {
        switch self {
        case .invalid:return "Choose a ZIP archive from your Strava export."
        case .account:return "Sign in to the same account, then choose the archive again."
        case .expired:return "This staged archive expired. Choose the archive again."
        case .confirm:return "Review and confirm the upload first."
        case .storage:return "There is not enough protected storage. Free some space and try again."
        case .network:return "Upload paused. Open Kinetta to resume when connected."
        case .auth:return "Sign in again to resume your archive upload."
        }
    }
}
