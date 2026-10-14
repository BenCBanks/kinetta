import Foundation

func check(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() { fatalError(message) }
}

var state = HealthSyncState(owner: "https://example.test/account-1", since: Date(timeIntervalSince1970: 0))
state.enqueue(["one", "two", "one"], anchor: Data([1]))
check(state.pending == ["one", "two"], "replayed UUIDs enqueue once")
check(state.anchor == Data([1]), "anchor travels with durable references")

// Exercise the actual record's crash/relaunch round trip.
let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: root) }
let file = root.appendingPathComponent("state.json")
try JSONEncoder().encode(state).write(to: file, options: .atomic)
var restored = try JSONDecoder().decode(HealthSyncState.self, from: Data(contentsOf: file))
check(restored.pending == ["one", "two"] && restored.anchor == Data([1]), "queue and anchor survive relaunch together")
check(restored.owner == state.owner, "account/server scope survives relaunch")
for results in [[], [["id": "other", "result": "added"]], [["id": "one", "result": "failed"]],
                [["id": "one", "result": "unknown"]], [["id": "one", "result": "added"], ["id": "one", "result": "failed"]]] {
    check(!restored.acknowledge(id: "one", results: results), "missing/failed/ambiguous acknowledgements stay queued")
    check(restored.pending == ["one", "two"], "failed ack preserves remaining queue")
}
check(restored.acknowledge(id: "two", results: [["id": "two", "result": "added"]]), "a different item can succeed after one failed")
check(restored.pending == ["one"], "partial success removes only confirmed UUID")
restored.needsLogin = true
try JSONEncoder().encode(restored).write(to: file, options: .atomic)
restored = try JSONDecoder().decode(HealthSyncState.self, from: Data(contentsOf: file))
check(restored.needsLogin && restored.pending == ["one"], "expired auth preserves queue across launches")
check(restored.acknowledge(id: "one", results: [["id": "one", "result": "duplicate"]]), "server duplicate confirms a retried delivery")
check(restored.pending.isEmpty, "all successful acknowledgements empty queue")
let previousAnchor = restored.anchor
restored.enqueue(["one", "one"], anchor: previousAnchor)
check(restored.pending == ["one"] && restored.anchor == previousAnchor, "detail refresh requeues an acknowledged UUID without moving the new-workout anchor")
print("Swift Health queue: persistence, replay, partial/invalid acknowledgements and expired auth passed")
