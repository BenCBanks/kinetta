import Foundation
func requireFailure(_ block: () throws -> Void) { do { try block();fatalError("Expected refusal") } catch {} }
let owner = String(repeating:"a",count:64),other = String(repeating:"b",count:64),hash = String(repeating:"c",count:64)
var record = try StravaImportRecord(owner:owner,size:Int64(StravaImportRecord.pieceBytes)+123,sha256:hash)
requireFailure { _ = try record.nextPiece(owner:owner) }
requireFailure { try record.confirm(owner:other) }
try record.confirm(owner:owner)
let first = try record.nextPiece(owner:owner);assert(first.count == StravaImportRecord.pieceBytes)
let saved = try JSONEncoder().encode(record)
let text = String(data:saved,encoding:.utf8)!
assert(!text.contains("token") && !text.contains("filename") && !text.contains("https"))
record = try JSONDecoder().decode(StravaImportRecord.self,from:saved)
// Lost response: restored journal still says zero; authoritative GET says first piece committed.
try record.reconcile(id:record.id,size:record.size,sha256:hash,received:Int64(StravaImportRecord.pieceBytes),state:"uploading")
let last = try record.nextPiece(owner:owner);assert(last.offset == Int64(StravaImportRecord.pieceBytes))
assert(last.count == 123)
requireFailure { try record.reconcile(id:UUID(),size:record.size,sha256:hash,received:0,state:"uploading") }
requireFailure { try record.reconcile(id:record.id,size:record.size,sha256:other,received:0,state:"uploading") }
requireFailure { try record.reconcile(id:record.id,size:record.size,sha256:hash,received:record.size+1,state:"uploading") }
try record.reconcile(id:record.id,size:record.size,sha256:hash,received:record.size,state:"review")
requireFailure { _ = try record.nextPiece(owner:owner) }
requireFailure { try record.check(owner:other) }
requireFailure { try record.check(owner:owner,now:record.created.addingTimeInterval(7*86400)) }
requireFailure { _ = try StravaImportRecord(owner:owner,size:StravaImportRecord.maximum+1,sha256:hash) }
print("Strava state: explicit confirmation, account isolation, durable offset replay, bounded pieces, identity/hash/expiry guards PASS")
