import Foundation
import CryptoKit
func fails(_ block: () throws -> Void) { do { try block();fatalError("Expected refusal") } catch {} }
let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
try FileManager.default.createDirectory(at:temporary,withIntermediateDirectories:true)
defer { try? FileManager.default.removeItem(at:temporary) }
let source = temporary.appendingPathComponent("fictional-strava-export.zip"),owner = String(repeating:"a",count:64)
let bytes = Data([0x50,0x4b,0x03,0x04])+Data(repeating:7,count:StravaImportRecord.pieceBytes+119)
try bytes.write(to:source)
let store = StravaImportStore(root:temporary.appendingPathComponent("private"))
var row = try store.stage(source,owner:owner)
assert(!row.confirmed && row.received == 0)
assert(row.sha256 == SHA256.hash(data:bytes).map { String(format:"%02x",$0) }.joined())
fails { _ = try store.makePiece(row) }
try row.confirm(owner:owner);try store.save(row)
let restored = try store.read()!;assert(restored == row)
let (piece,hash) = try store.makePiece(row),first = try Data(contentsOf:piece)
assert(first == bytes.prefix(StravaImportRecord.pieceBytes))
assert(hash == SHA256.hash(data:first).map { String(format:"%02x",$0) }.joined())
let metadata = try String(contentsOf:store.journal,encoding:.utf8)
assert(!metadata.contains(source.lastPathComponent) && !metadata.contains("token"))
try store.clear();assert(!FileManager.default.fileExists(atPath:store.root.path))
assert(FileManager.default.fileExists(atPath:source.path),"Cleanup must preserve the original Files document")
let bad = temporary.appendingPathComponent("bad.zip");try Data("not a zip".utf8).write(to:bad)
fails { _ = try store.stage(bad,owner:owner) }
let session = try StravaImportSession(server:"https://EXAMPLE.TEST:443/",userID:12,token:String(repeating:"z",count:32))
assert(session.server == "https://example.test")
fails { _ = try StravaImportSession(server:"http://example.test",userID:12,token:String(repeating:"z",count:32)) }
fails { _ = try StravaImportSession(server:"https://user@example.test",userID:12,token:String(repeating:"z",count:32)) }
print("Strava storage: streaming copy/hash, durable confirmed journal, bounded piece, original preserved, cleanup and secure session PASS")

// Mid-copy cancellation leaves no published journal/archive and releases the
// security scope; the state engine removes the partial directory on stop.
try store.clear()
let cancellation = StravaImportCancellation();var chunks = 0
fails { _ = try store.stage(source,owner:owner,cancellation:cancellation,afterChunk:{ chunks += 1;cancellation.cancel() }) }
let absent = try store.read();assert(chunks == 1 && absent == nil)
assert(!FileManager.default.fileExists(atPath:store.archive.path))
try store.clear()
let documents = temporary.appendingPathComponent("Documents"),inboxRoot = documents.appendingPathComponent("Inbox")
try FileManager.default.createDirectory(at:inboxRoot,withIntermediateDirectories:true)
let inbox = StravaImportInbox(root:inboxRoot),incoming = inboxRoot.appendingPathComponent("incoming.zip")
let orphan = inboxRoot.appendingPathComponent("crashed.zip"),nonZip = inboxRoot.appendingPathComponent("other.txt")
for url in [incoming,orphan,nonZip] { try Data([1,2,3]).write(to:url) }
try inbox.sweep(keeping:incoming)
assert(FileManager.default.fileExists(atPath:incoming.path))
assert(!FileManager.default.fileExists(atPath:orphan.path) && !FileManager.default.fileExists(atPath:nonZip.path))
let inboxValues = try inboxRoot.resourceValues(forKeys:[.isExcludedFromBackupKey]);assert(inboxValues.isExcludedFromBackup == true)
inbox.discard(source);assert(FileManager.default.fileExists(atPath:source.path))
inbox.discard(incoming);assert(!FileManager.default.fileExists(atPath:incoming.path))
try Data([1]).write(to:orphan);try inbox.sweep();let leftovers = try FileManager.default.contentsOfDirectory(atPath:inboxRoot.path);assert(leftovers.isEmpty)
print("Storage review: chunk cancellation, no publish, cold/warm Inbox sweep, protected backup exclusion, originals preserved PASS")
