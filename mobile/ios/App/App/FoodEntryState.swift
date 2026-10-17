import Foundation

struct FoodEntryRequest: Codable {
    enum Source: String,Codable { case quickAction = "quick-action", shortcut }
    let id: UUID
    let created: Date
    let source: Source
    let text: String?
}
struct FoodEntryState: Codable {
    let ownerDigest: String
    var requests: [FoodEntryRequest] = []
    static func restored(_ data: Data, owner: String) -> Self {
        if let old = try? JSONDecoder().decode(Self.self,from:data),old.ownerDigest == owner { return old }
        return Self(ownerDigest:owner)
    }
    @discardableResult mutating func purge(now: Date) -> Bool {
        let before = requests.count
        requests.removeAll { $0.created < now.addingTimeInterval(-86400) || $0.created > now.addingTimeInterval(300) }
        return requests.count != before
    }
    mutating func add(text: String?,source: FoodEntryRequest.Source,now: Date) throws {
        purge(now:now)
        guard requests.count < 5 else { throw FoodEntryFailure.full }
        let value = text?.trimmingCharacters(in:.whitespacesAndNewlines)
        guard (source == .quickAction || value != nil), value == nil || (!value!.isEmpty && value!.utf16.count <= 4000) else { throw FoodEntryFailure.invalid }
        requests.append(FoodEntryRequest(id:UUID(),created:now,source:source,text:value))
    }
    mutating func acknowledge(_ id: UUID) { requests.removeAll { $0.id == id } }
}
enum FoodEntryFailure: LocalizedError {
    case signedOut,full,invalid
    var errorDescription: String? {
        switch self {
        case .signedOut:return "Open Kinetta and sign in before using Log food."
        case .full:return "Open Kinetta to review your waiting food drafts first."
        case .invalid:return "Use a food description between 1 and 4,000 characters."
        }
    }
}
