import Foundation

// Anchor and pending UUIDs are one atomic record: a crash cannot advance one without the other.
// The queue contains references, not routes or heart-rate data. Read details only when sending.
struct HealthSyncState: Codable {
    var owner: String
    var since: Date
    var anchor: Data?
    var pending: [String] = []
    var lastSuccess: Date?
    var error: String?
    var needsLogin = false
    var backgroundDeliveryEnabled = false
    // Optional for compatibility with records saved before unlock recovery existed.
    var protectedDataPause: Bool?

    mutating func pauseForProtectedData() {
        protectedDataPause = true
        error = nil
    }

    mutating func completeProtectedDataRetry(succeeded: Bool) {
        if succeeded && pending.isEmpty {
            protectedDataPause = nil
            error = nil
        }
    }

    mutating func enqueue(_ ids: [String], anchor: Data?) {
        var known = Set(pending)
        for id in ids where known.insert(id).inserted { pending.append(id) }
        self.anchor = anchor
    }

    // A missing, failed or unknown acknowledgement leaves the item pending.
    mutating func acknowledge(id: String, results: [[String: String]]) -> Bool {
        let matching = results.filter { $0["id"] == id }
        guard matching.count == 1, ["added", "duplicate"].contains(matching[0]["result"] ?? "") else { return false }
        pending.removeAll { $0 == id }
        return true
    }
}
