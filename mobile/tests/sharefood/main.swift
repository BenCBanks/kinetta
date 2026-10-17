import Foundation

// A made-up credential fixture lives outside the tested Group directory. These
// tests never read or write the system Keychain, use a server, or access Health.
final class FictionalCredentials: ShareFoodCredentials {
    let file: URL
    init(_ file: URL) { self.file = file }
    func read() throws -> ShareFoodCredential? {
        guard FileManager.default.fileExists(atPath:file.path) else { return nil }
        return try JSONDecoder().decode(ShareFoodCredential.self,from:Data(contentsOf:file))
    }
    func write(_ value: ShareFoodCredential) throws { try JSONEncoder().encode(value).write(to:file,options:.atomic) }
    func remove() throws { if FileManager.default.fileExists(atPath:file.path) { try FileManager.default.removeItem(at:file) } }
}
func check(_ condition: @autoclosure () throws -> Bool,_ message: String = "Share contract failed") rethrows {
    let value = try condition();assert(value,message)
}
func requireFailure(_ action: () throws -> Void) {
    do { try action();assertionFailure("Expected the guarded operation to fail") } catch { }
}
let args = CommandLine.arguments
if args.count > 1 && args[1] == "--worker" {
    let root = URL(fileURLWithPath:args[2]),fake = FictionalCredentials(URL(fileURLWithPath:args[3]))
    let store = ShareFoodStore(root:root,credentials:fake),credential = try fake.read()!
    for i in 0..<4 {
        let job = ShareFoodJob(id:UUID(),ownerDigest:credential.ownerDigest,created:Date(),kind:.text,text:"Fictional worker food \(i)",recipeURL:nil,image:nil)
        do { try store.enqueue(job,using:credential) } catch ShareFoodFailure.full { } catch { fatalError("Worker failed its owner/lock contract") }
    }
} else {
    let temp = FileManager.default.temporaryDirectory.appendingPathComponent("FictionalShareFood-"+UUID().uuidString,isDirectory:true)
    try FileManager.default.createDirectory(at:temp,withIntermediateDirectories:true)
    defer { try? FileManager.default.removeItem(at:temp) }
    let root = temp.appendingPathComponent("Group",isDirectory:true),fake = FictionalCredentials(temp.appendingPathComponent("fictional-credentials.json"))
    let store = ShareFoodStore(root:root,credentials:fake),token = String(repeating:"x",count:43)
    let original = try ShareFoodCredential(server:"https://FICTIONAL.invalid:443/",userID:1,token:token,name:" Alex Example ")
    assert(original.server == "https://fictional.invalid" && original.name == "Alex Example" && original.ownerDigest.count == 64)
    for server in ["http://fictional.invalid","https://user:pw@fictional.invalid","https://fictional.invalid?token=fictional","https://fictional.invalid/#fragment"] {
        requireFailure { _ = try ShareFoodCredential(server:server,userID:1,token:token,name:"Fictional") }
    }
    requireFailure { _ = try ShareFoodCredential(server:original.server,userID:0,token:token,name:"") }
    requireFailure { _ = try ShareFoodCredential(server:original.server,userID:1,token:"unsafe\nheader",name:"") }
    let a = try store.bind(original),again = try store.bind(original)
    assert(a.generation == again.generation)
    let now = Date(timeIntervalSince1970:floor(Date().timeIntervalSince1970*1000)/1000)
    let first = ShareFoodJob(id:UUID(),ownerDigest:a.ownerDigest,created:now,kind:.text,text:"Fictional sandwich",recipeURL:nil,image:nil)
    try store.enqueue(first,using:a);try store.enqueue(first,using:a)
    try check(try store.pending(using:a).count == 1)
    let relaunched = ShareFoodStore(root:root,credentials:fake)
    try check(try relaunched.job(first.id,using:a) == first)
    requireFailure { try store.enqueue(ShareFoodJob(id:first.id,ownerDigest:a.ownerDigest,created:now,kind:.text,text:"Changed food",recipeURL:nil,image:nil),using:a) }
    let jpeg = Data([0xff,0xd8,0xff,0xd9]) // structural byte fixture, not a real meal/photo or model input
    let photo = ShareFoodJob(id:UUID(),ownerDigest:a.ownerDigest,created:now,kind:.photo,text:"Fictional plate",recipeURL:nil,image:jpeg)
    try store.enqueue(photo,using:a);try check(try store.job(photo.id,using:a) == photo)
    let folder = root.appendingPathComponent(a.ownerDigest),record = folder.appendingPathComponent(photo.id.uuidString.lowercased()+".json")
    let metadata = try Data(contentsOf:record),object = try JSONSerialization.jsonObject(with:metadata) as! [String:Any]
    assert(object["token"] == nil && object["image"] == nil && !String(decoding:metadata,as:UTF8.self).contains(token))
    let imagePath = folder.appendingPathComponent(photo.id.uuidString.lowercased()+".jpg")
    try Data([1,2,3,4]).write(to:imagePath)
    requireFailure { _ = try store.job(photo.id,using:a) }
    assert(FileManager.default.fileExists(atPath:record.path));try jpeg.write(to:imagePath)
    let old = ShareFoodJob(id:UUID(),ownerDigest:a.ownerDigest,created:now.addingTimeInterval(-3*86400),kind:.text,text:"Fictional offline food",recipeURL:nil,image:nil)
    try store.enqueue(old,using:a);try check(try store.pending(using:a).count == 3,"Explicitly sent jobs do not expire overnight")
    requireFailure { try store.enqueue(ShareFoodJob(id:UUID(),ownerDigest:a.ownerDigest,created:now.addingTimeInterval(600),kind:.text,text:"Future clock",recipeURL:nil,image:nil),using:a) }
    requireFailure { try store.enqueue(ShareFoodJob(id:UUID(),ownerDigest:a.ownerDigest,created:now,kind:.photo,text:"",recipeURL:nil,image:Data(repeating:0,count:ShareFoodJob.maxImageBytes+1)),using:a) }
    let b = try store.bind(ShareFoodCredential(server:a.server,userID:2,token:token,name:"Fictional Other"))
    requireFailure { _ = try store.pending(using:a) };try check(try !store.revoke(a));try check(try store.active()?.ownerDigest == b.ownerDigest)
    let other = ShareFoodJob(id:first.id,ownerDigest:b.ownerDigest,created:now,kind:.text,text:"Other fictional food",recipeURL:nil,image:nil)
    try store.enqueue(other,using:b);try check(try store.pending(using:b).count == 1)
    try check(try store.revoke(b));requireFailure { _ = try store.job(other.id,using:b) }
    let fresh = try store.bind(original);assert(fresh.generation != a.generation)
    try check(try store.pending(using:fresh).count == 3);requireFailure { try store.acknowledge(first.id,using:a) }
    for id in try store.pending(using:fresh) { try store.acknowledge(id,using:fresh) }
    let orphan = folder.appendingPathComponent(UUID().uuidString.lowercased()+".jpg");try jpeg.write(to:orphan)
    try check(try store.pending(using:fresh).isEmpty);assert(!FileManager.default.fileExists(atPath:orphan.path))
    // Independent processes must share the same capacity and atomic commit lock.
    var workers: [Process] = []
    for _ in 0..<8 {
        let process = Process();process.executableURL = URL(fileURLWithPath:args[0]);process.arguments = ["--worker",root.path,fake.file.path]
        try process.run();workers.append(process)
    }
    for process in workers { process.waitUntilExit();assert(process.terminationStatus == 0) }
    let pending = try store.pending(using:fresh);assert(pending.count == ShareFoodJob.maxPending)
    for id in pending { _ = try store.job(id,using:fresh) }
    try store.eraseOwner(fresh.ownerDigest);try check(try store.active() == nil)
    let restoredB = try store.bind(b);try check(try store.pending(using:restoredB).count == 1)
    try check(try store.job(other.id,using:restoredB).text == other.text)
    try store.eraseOwner(restoredB.ownerDigest)
    print("Share food foundation: HTTPS/owner/session guards, replay immutability, protected file layout/no credentials in jobs, photo hash/size, no overnight loss, account switch/revoke/late ack, orphan cleanup, cross-process capacity/atomic writes and owner-only deletion PASS; no Keychain/server/Health/device calls")
}
