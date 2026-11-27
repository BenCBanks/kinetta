import Foundation

final class Credentials: StravaImportCredentials {
    private let lock = NSLock()
    private var value: StravaImportSession?
    var onClear: (() -> Void)?
    init(_ value: StravaImportSession? = nil) { self.value = value }
    func read() throws -> StravaImportSession? { lock.lock();defer { lock.unlock() };return value }
    func write(_ next: StravaImportSession) throws { lock.lock();value = next;lock.unlock() }
    func clear() throws { lock.lock();value = nil;lock.unlock();onClear?() }
}
func wait(_ semaphore: DispatchSemaphore) { precondition(semaphore.wait(timeout:.now()+15) == .success,"native test deadline") }
func stopped(_ transfer: NativeStravaTransfer) {
    let done = DispatchSemaphore(value:0);transfer.stop { error in precondition(error == nil);done.signal() };wait(done)
}
func bound(_ transfer: NativeStravaTransfer,_ who: StravaImportSession) {
    let done = DispatchSemaphore(value:0);transfer.bind(who) { error in precondition(error == nil);done.signal() };wait(done)
}
let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
defer { try? FileManager.default.removeItem(at:root) }
let who = try StravaImportSession(server:"https://fictional.example.test",userID:12,token:String(repeating:"a",count:32))
let other = try StravaImportSession(server:who.server,userID:13,token:String(repeating:"b",count:32))
// Exact production bind path, holding only the asynchronous stop continuation.
// A sign-out happens after bind has revoked the old keychain but before its retry.
let lock = NSLock(),held = DispatchSemaphore(value:0)
var continuations: [() -> Void] = []
let key = Credentials(),store = StravaImportStore(root:root.appendingPathComponent("race"))
let transfer = NativeStravaTransfer(store:store,keychain:key,legacyConfiguration:.ephemeral,beforeCleanup:{ continuation in
    lock.lock();continuations.append(continuation);lock.unlock();held.signal()
})
let bindDone = DispatchSemaphore(value:0),stopDone = DispatchSemaphore(value:0)
transfer.bind(who) { error in precondition(error != nil,"stale bind must fail");bindDone.signal() }
wait(held)
transfer.stop { error in precondition(error == nil);stopDone.signal() };wait(held)
lock.lock();let old = continuations[0],latest = continuations[1];lock.unlock()
latest();wait(stopDone);old();wait(bindDone)
precondition((try? key.read()) == nil,"old bind must never resurrect credentials")
// The same supersession fence protects a later account selection.
let newerDone = DispatchSemaphore(value:0)
transfer.bind(who) { error in precondition(error == nil);newerDone.signal() };wait(newerDone)
transfer.bind(other) { error in precondition(error != nil);bindDone.signal() };wait(held)
transfer.stop { error in precondition(error == nil);stopDone.signal() };wait(held)
lock.lock();let cancelled = continuations[2],signout = continuations[3];lock.unlock()
signout();wait(stopDone);cancelled();wait(bindDone);precondition((try? key.read()) == nil)

// A later account bind also wins if its stop completes first; the old callback
// cannot overwrite the replacement credential or delete its staged journal.
let accountHeld = DispatchSemaphore(value:0),accountLock = NSLock()
var accountCallbacks: [() -> Void] = []
let accountKey = Credentials(),accountStore = StravaImportStore(root:root.appendingPathComponent("account"))
let accountEngine = NativeStravaTransfer(store:accountStore,keychain:accountKey,legacyConfiguration:.ephemeral,beforeCleanup:{ callback in
    accountLock.lock();accountCallbacks.append(callback);accountLock.unlock();accountHeld.signal()
})
accountEngine.bind(who) { error in precondition(error != nil);bindDone.signal() };wait(accountHeld)
accountEngine.bind(other) { error in precondition(error == nil);newerDone.signal() };wait(accountHeld)
accountLock.lock();let staleAccount = accountCallbacks[0],newAccount = accountCallbacks[1];accountLock.unlock()
newAccount();wait(newerDone)
let retained = try StravaImportRecord(owner:other.owner,size:4,sha256:String(repeating:"c",count:64));try accountStore.save(retained)
staleAccount();wait(bindDone)
precondition((try? accountKey.read()) == other)
let currentRecord = try accountStore.read();precondition(currentRecord == retained)
// A held real copy/hash chunk cannot block state-queue credential revocation.
let copied = DispatchSemaphore(value:0),release = DispatchSemaphore(value:0),cleared = DispatchSemaphore(value:0)
let copyKey = Credentials(who),copyStore = StravaImportStore(root:root.appendingPathComponent("copy"))
let copying = NativeStravaTransfer(store:copyStore,keychain:copyKey,legacyConfiguration:.ephemeral,afterCopyChunk:{ copied.signal();wait(release) })
bound(copying,who)
let source = root.appendingPathComponent("source.zip")
try (Data([0x50,0x4b,0x03,0x04])+Data(repeating:7,count:2*1024*1024)).write(to:source)
let stageDone = DispatchSemaphore(value:0)
copying.stage(source) { result in if case .success = result { preconditionFailure("cancelled stage published") };stageDone.signal() }
wait(copied);copyKey.onClear = { cleared.signal() }
copying.stop { error in precondition(error == nil);stopDone.signal() }
wait(cleared);precondition((try? copyKey.read()) == nil,"stop must run while copy is held")
release.signal();wait(stageDone);wait(stopDone)
precondition(!FileManager.default.fileExists(atPath:copyStore.root.path))
precondition(FileManager.default.fileExists(atPath:source.path))

// Each terminal journal is retired before a second archive, without reserving or
// uploading anything. An ordinary unconfirmed stage still blocks replacement.
for phase in ["done","cancelled","failed"] {
    let local = StravaImportStore(root:root.appendingPathComponent(phase)),credentials = Credentials(who)
    var previous = try StravaImportRecord(owner:who.owner,size:4,sha256:String(repeating:"c",count:64))
    previous.phase = phase;previous.confirmed = true;try local.save(previous)
    let engine = NativeStravaTransfer(store:local,keychain:credentials,legacyConfiguration:.ephemeral)
    bound(engine,who)
    engine.stage(source) { result in
        guard case .success(let row) = result else { preconditionFailure("terminal journal blocked next archive") }
        precondition(row.id != previous.id && !row.confirmed);stageDone.signal()
    };wait(stageDone)
    engine.stage(source) { result in if case .success = result { preconditionFailure("pending stage replaced") };stageDone.signal() };wait(stageDone)
    stopped(engine)
}
print("Native transfer: delayed bind vs later sign-out/account, nonblocking copy cancellation/session fence, terminal reuse PASS")

// The actual control URLSession receives an unknown-length body in chunks and
// never finishes it. It must cancel AT the bound, without waiting for completion.
final class OversizedControl: URLProtocol {
    static let cancelled = DispatchSemaphore(value:0)
    static let entered = DispatchSemaphore(value:0)
    static var declared = false
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let headers = Self.declared ? ["Content-Length":String(64*1024)] : [:]
        client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:200,httpVersion:"HTTP/1.1",headerFields:headers)!,cacheStoragePolicy:.notAllowed)
        if !Self.declared {
            for _ in 0..<4 { client?.urlProtocol(self,didLoad:Data(repeating:32,count:16*1024)) }
        }
        Self.entered.signal()
        // Intentionally no didFinishLoading: the engine must cancel early.
    }
    override func stopLoading() { Self.cancelled.signal() }
}
for declared in [false,true] {
    OversizedControl.declared = declared
    let configuration = URLSessionConfiguration.ephemeral;configuration.protocolClasses = [OversizedControl.self]
    let local = StravaImportStore(root:root.appendingPathComponent("bounded-\(declared)"))
    let engine = NativeStravaTransfer(store:local,keychain:Credentials(who),legacyConfiguration:.ephemeral,controlConfiguration:configuration)
    bound(engine,who)
    let staged = DispatchSemaphore(value:0)
    engine.stage(source) { result in
        guard case .success(let row) = result else { preconditionFailure("stage failed") }
        engine.confirm(id:row.id) { error in precondition(error == nil);staged.signal() }
    }
    wait(staged);wait(OversizedControl.entered);wait(OversizedControl.cancelled)
    let current = try local.read();precondition(current?.received == 0,"oversized control cannot advance upload")
    stopped(engine)
}
print("Native control: declared and unknown-length 64KiB response cancelled before completion, no offset advance PASS")

final class SmallControl: URLProtocol {
    static var metadata: [String:Any] = [:]
    static var paths: [String] = []
    static let finalized = DispatchSemaphore(value:0)
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let path = request.url!.path;Self.paths.append(path)
        let object = request.httpMethod == "GET" ? Self.metadata : ["ok":true]
        let data = try! JSONSerialization.data(withJSONObject:object)
        client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:200,httpVersion:"HTTP/1.1",headerFields:[:])!,cacheStoragePolicy:.notAllowed)
        for start in stride(from:0,to:data.count,by:16) { client?.urlProtocol(self,didLoad:data.subdata(in:start..<min(start+16,data.count))) }
        client?.urlProtocolDidFinishLoading(self)
        if path.hasSuffix("/finalize") { Self.finalized.signal() }
    }
    override func stopLoading() {}
}
let smallConfiguration = URLSessionConfiguration.ephemeral;smallConfiguration.protocolClasses = [SmallControl.self]
let smallStore = StravaImportStore(root:root.appendingPathComponent("small-control"))
let smallEngine = NativeStravaTransfer(store:smallStore,keychain:Credentials(who),legacyConfiguration:.ephemeral,controlConfiguration:smallConfiguration)
bound(smallEngine,who)
let smallStaged = DispatchSemaphore(value:0)
smallEngine.stage(source) { result in
    guard case .success(let row) = result else { preconditionFailure("stage failed") }
    SmallControl.metadata = ["id":row.id.uuidString,"size":row.size,"sha256":row.sha256,"received":row.size,"state":"uploading"]
    smallEngine.confirm(id:row.id) { error in precondition(error == nil);smallStaged.signal() }
}
wait(smallStaged);wait(SmallControl.finalized)
precondition(SmallControl.paths.count == 3 && SmallControl.paths.last!.hasSuffix("/finalize"))
let reconciled = try smallStore.read();precondition(reconciled?.received == reconciled?.size)
stopped(smallEngine)
print("Native control: small chunked reservation/status/finalization still completes through actual delegate PASS")
