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

// The production record's lock/unlock transition never advances the anchored query or drops UUIDs.
var locked = HealthSyncState(owner: "https://example.test/account-locked", since: Date(timeIntervalSince1970: 0))
locked.enqueue(["workout-one"], anchor: Data([7]))
let lockedAnchor = locked.anchor, lockedQueue = locked.pending
locked.error = "Old attempt failed"
locked.pauseForProtectedData()
check(locked.anchor == lockedAnchor && locked.pending == lockedQueue, "locked error preserves queue and anchor exactly")
check(locked.protectedDataPause == true && locked.error == nil, "a lock pause is not a Connections failure")
locked.completeProtectedDataRetry(succeeded: false)
check(locked.protectedDataPause == true && locked.pending == lockedQueue, "failed unlocked retry retains pause and pending workout")

// Stand-in upload acknowledges the same UUID; replay creates only one fictional server activity.
var activities = Set<String>()
func unlockAndUpload(_ saved: inout HealthSyncState) {
    saved.enqueue(["workout-one", "workout-one"], anchor: Data([8]))
    for id in saved.pending {
        let first = activities.insert(id).inserted
        check(saved.acknowledge(id:id,results:[["id":id,"result":first ? "added" : "duplicate"]]), "unlock upload has matching acknowledgement")
    }
    saved.completeProtectedDataRetry(succeeded:true)
}
unlockAndUpload(&locked)
check(activities.count == 1 && locked.pending.isEmpty && locked.protectedDataPause == nil && locked.error == nil, "locked then unlock uploads once and clears the temporary pause")
unlockAndUpload(&locked)
check(activities.count == 1, "repeated anchored deliveries create one server activity")

// Killed while locked: durable pause, cursor and references survive; the next wake/activation retries.
locked.enqueue(["workout-one"], anchor: Data([9]))
locked.pauseForProtectedData()
try JSONEncoder().encode(locked).write(to:file,options:.atomic)
var afterKill = try JSONDecoder().decode(HealthSyncState.self,from:Data(contentsOf:file))
check(afterKill.protectedDataPause == true && afterKill.anchor == Data([9]) && afterKill.pending == ["workout-one"], "killed locked process preserves recovery state")
unlockAndUpload(&afterKill)
check(afterKill.pending.isEmpty && afterKill.protectedDataPause == nil && activities.count == 1, "next wake or activation uploads idempotently after a killed locked process")

// Existing installations can decode an older record with no pause field.
let encoded = try JSONEncoder().encode(afterKill)
var oldRecord = try JSONSerialization.jsonObject(with:encoded) as! [String:Any]
oldRecord.removeValue(forKey:"protectedDataPause")
let legacy = try JSONDecoder().decode(HealthSyncState.self,from:JSONSerialization.data(withJSONObject:oldRecord))
check(legacy.protectedDataPause == nil && legacy.owner == afterKill.owner, "pre-recovery durable records remain compatible")
print("Swift protected-data recovery: unchanged cursor/queue, temporary pause, unlock upload once, killed/relaunched retry and legacy records passed (Health/network stand-ins)")
