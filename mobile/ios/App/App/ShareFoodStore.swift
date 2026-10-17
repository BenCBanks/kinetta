import Foundation
import CryptoKit
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

// Only short local I/O runs under the process-shared lock: no network or image decoding.
final class ShareFoodStore: @unchecked Sendable {
    private let root: URL
    private let credentials: ShareFoodCredentials
    init(root: URL,credentials: ShareFoodCredentials) { self.root = root;self.credentials = credentials }
    convenience init(groupID: String,credentials: ShareFoodCredentials) throws {
        #if os(iOS) || os(macOS)
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier:groupID) else { throw ShareFoodFailure.unavailable }
        self.init(root:container.appendingPathComponent("FoodShare",isDirectory:true),credentials:credentials)
        #else
        throw ShareFoodFailure.unavailable
        #endif
    }
    private func folder(_ url: URL) throws {
        #if os(iOS)
        try FileManager.default.createDirectory(at:url,withIntermediateDirectories:true,attributes:[.protectionKey:FileProtectionType.complete])
        #else
        try FileManager.default.createDirectory(at:url,withIntermediateDirectories:true)
        #endif
        var value = url;var attrs = URLResourceValues();attrs.isExcludedFromBackup = true;try value.setResourceValues(attrs)
    }
    private func locked<T>(_ action: () throws -> T) throws -> T {
        try folder(root)
        let fd = root.appendingPathComponent(".lock").path.withCString { open($0,O_CREAT | O_RDWR,0o600) }
        guard fd >= 0 else { throw ShareFoodFailure.unavailable }
        defer { close(fd) }
        guard flock(fd,LOCK_EX) == 0 else { throw ShareFoodFailure.unavailable }
        defer { flock(fd,LOCK_UN) }
        return try action()
    }
    private func check(_ expected: ShareFoodCredential) throws {
        guard let active = try credentials.read(),active.sameSession(as:expected) else { throw ShareFoodFailure.changed }
    }
    func bind(_ candidate: ShareFoodCredential) throws -> ShareFoodCredential {
        try locked {
            let safe = try candidate.checked()
            let old: ShareFoodCredential?
            do { old = try credentials.read() } catch { old = nil }
            let active = try ShareFoodCredential(server:safe.server,userID:safe.userID,token:safe.token,name:safe.name,
                generation:old?.ownerDigest == safe.ownerDigest && old?.token == safe.token ? old!.generation : UUID())
            try credentials.write(active);return active
        }
    }
    func active() throws -> ShareFoodCredential? { try locked { try credentials.read() } }
    @discardableResult func revoke(_ expected: ShareFoodCredential) throws -> Bool {
        try locked {
            guard let current = try credentials.read(),current.sameSession(as:expected) else { return false }
            try credentials.remove();return true
        }
    }
    private func directory(_ digest: String) throws -> URL {
        guard digest.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil else { throw ShareFoodFailure.invalid }
        return root.appendingPathComponent(digest,isDirectory:true)
    }
    private func path(_ id: UUID,_ digest: String,_ ext: String) throws -> URL {
        try directory(digest).appendingPathComponent(id.uuidString.lowercased()+"."+ext)
    }
    private func write(_ data: Data,to url: URL) throws {
        #if os(iOS)
        try data.write(to:url,options:[.atomic,.completeFileProtection])
        #else
        try data.write(to:url,options:.atomic)
        #endif
        let handle = try FileHandle(forWritingTo:url);defer { try? handle.close() };try handle.synchronize()
    }
    private struct Header: Codable {
        let id: UUID,ownerDigest: String,created: Date,kind: ShareFoodJob.Kind,text: String,recipeURL: String?
        let imageHash: String?,imageBytes: Int
        init(_ job: ShareFoodJob) {
            id = job.id;ownerDigest = job.ownerDigest;created = job.created;kind = job.kind;text = job.text;recipeURL = job.recipeURL
            imageHash = job.image.map { SHA256.hash(data:$0).map { String(format:"%02x",$0) }.joined() };imageBytes = job.image?.count ?? 0
        }
    }
    private func header(_ url: URL) throws -> Header {
        let size = try url.resourceValues(forKeys:[.fileSizeKey]).fileSize ?? Int.max
        guard size <= 32768 else { throw ShareFoodFailure.unreadable }
        do { let decoder = JSONDecoder();decoder.dateDecodingStrategy = .millisecondsSince1970;return try decoder.decode(Header.self,from:Data(contentsOf:url)) }
        catch { throw ShareFoodFailure.unreadable }
    }
    private func headers(_ digest: String) throws -> [Header] {
        let dir = try directory(digest)
        if !FileManager.default.fileExists(atPath:dir.path) { return [] }
        let contents = try FileManager.default.contentsOfDirectory(at:dir,includingPropertiesForKeys:nil)
        // A killed writer/acknowledger may leave a thumbnail without its commit marker.
        for file in contents where file.pathExtension == "jpg" && !FileManager.default.fileExists(atPath:file.deletingPathExtension().appendingPathExtension("json").path) {
            try FileManager.default.removeItem(at:file)
        }
        let files = contents.filter { $0.pathExtension == "json" }
        guard files.count <= ShareFoodJob.maxPending else { throw ShareFoodFailure.unreadable }
        return try files.map { url in
            let value = try header(url)
            guard value.ownerDigest == digest,url.lastPathComponent == value.id.uuidString.lowercased()+".json" else { throw ShareFoodFailure.unreadable }
            return value
        }.sorted { $0.created == $1.created ? $0.id.uuidString < $1.id.uuidString : $0.created < $1.created }
    }
    private func read(_ id: UUID,_ digest: String) throws -> ShareFoodJob {
        let h = try header(path(id,digest,"json"))
        guard h.id == id,h.ownerDigest == digest,h.imageBytes >= 0,h.imageBytes <= ShareFoodJob.maxImageBytes else { throw ShareFoodFailure.unreadable }
        var image: Data?
        if h.imageHash != nil {
            let url = try path(id,digest,"jpg"),size = try url.resourceValues(forKeys:[.fileSizeKey]).fileSize ?? -1
            guard size == h.imageBytes else { throw ShareFoodFailure.unreadable }
            let data = try Data(contentsOf:url)
            guard SHA256.hash(data:data).map({String(format:"%02x",$0)}).joined() == h.imageHash else { throw ShareFoodFailure.unreadable }
            image = data
        } else if h.imageBytes != 0 { throw ShareFoodFailure.unreadable }
        let job = ShareFoodJob(id:h.id,ownerDigest:h.ownerDigest,created:h.created,kind:h.kind,text:h.text,recipeURL:h.recipeURL,image:image)
        try job.validate();return job
    }
    func pending(using credential: ShareFoodCredential) throws -> [UUID] {
        try locked { try check(credential);return try headers(credential.ownerDigest).map(\.id) }
    }
    func job(_ id: UUID,using credential: ShareFoodCredential) throws -> ShareFoodJob {
        try locked { try check(credential);return try read(id,credential.ownerDigest) }
    }
    func enqueue(_ job: ShareFoodJob,using credential: ShareFoodCredential) throws {
        try locked {
            try check(credential);try job.validate()
            guard job.ownerDigest == credential.ownerDigest else { throw ShareFoodFailure.changed }
            let destination = try path(job.id,job.ownerDigest,"json")
            if FileManager.default.fileExists(atPath:destination.path) {
                guard try read(job.id,job.ownerDigest) == job else { throw ShareFoodFailure.changed };return
            }
            let existing = try headers(job.ownerDigest)
            guard existing.count < ShareFoodJob.maxPending else { throw ShareFoodFailure.full }
            let dir = try directory(job.ownerDigest);try folder(dir)
            let encoder = JSONEncoder();encoder.dateEncodingStrategy = .millisecondsSince1970
            let metadata = try encoder.encode(Header(job));guard metadata.count <= 32768 else { throw ShareFoodFailure.invalid }
            // Images go first. The small, atomic header is the commit marker; a
            // crash cannot report a queued job whose photo has not been saved.
            if let data = job.image { try write(data,to:path(job.id,job.ownerDigest,"jpg")) }
            try write(metadata,to:destination)
        }
    }
    func acknowledge(_ id: UUID,using credential: ShareFoodCredential) throws {
        try locked {
            try check(credential)
            for ext in ["json","jpg"] { let url = try path(id,credential.ownerDigest,ext);if FileManager.default.fileExists(atPath:url.path) { try FileManager.default.removeItem(at:url) } }
        }
    }
    func eraseOwner(_ digest: String) throws {
        try locked {
            let dir = try directory(digest)
            if FileManager.default.fileExists(atPath:dir.path) { try FileManager.default.removeItem(at:dir) }
            if try credentials.read()?.ownerDigest == digest { try credentials.remove() }
        }
    }
}
