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
