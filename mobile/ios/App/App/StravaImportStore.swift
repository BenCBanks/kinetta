import Foundation
import CryptoKit
import Security

struct StravaImportSession: Codable, Equatable {
    let server: String
    let userID: Int
    let token: String
    var owner: String { SHA256.hash(data:Data("\(server)\n\(userID)".utf8)).map { String(format:"%02x",$0) }.joined() }
    init(server: String,userID: Int,token: String) throws {
        guard var p = URLComponents(string:server),p.scheme == "https",p.host?.isEmpty == false,p.user == nil,p.password == nil,
              p.query == nil,p.fragment == nil,p.path.isEmpty || p.path == "/",userID > 0,
              token.range(of:"^[A-Za-z0-9_.-]{20,512}$",options:.regularExpression) != nil else { throw StravaImportFailure.account }
        p.path = "";p.host = p.host?.lowercased();if p.port == 443 { p.port = nil }
        guard let normalized = p.url?.absoluteString else { throw StravaImportFailure.account }
        self.server = normalized.hasSuffix("/") ? String(normalized.dropLast()) : normalized;self.userID = userID;self.token = token
    }
}

struct StravaImportStore {
    let root: URL
    init(root: URL = FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("StravaImport",isDirectory:true)) { self.root = root }
    var archive: URL { root.appendingPathComponent("archive.zip") }
    var piece: URL { root.appendingPathComponent("piece.bin") }
    var journal: URL { root.appendingPathComponent("state.json") }
    func prepare() throws {
        #if os(iOS)
        try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true,attributes:[.protectionKey:FileProtectionType.completeUntilFirstUserAuthentication])
        #else
        try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
        #endif
        var url = root,values = URLResourceValues();values.isExcludedFromBackup = true;try url.setResourceValues(values)
    }
    func save(_ row: StravaImportRecord) throws {
        try prepare();try write(JSONEncoder().encode(row),to:journal)
    }
    private func write(_ data: Data,to url: URL) throws {
        #if os(iOS)
        try data.write(to:url,options:[.atomic,.completeFileProtectionUntilFirstUserAuthentication])
        #else
        try data.write(to:url,options:.atomic)
        #endif
    }
    func read() throws -> StravaImportRecord? {
        guard FileManager.default.fileExists(atPath:journal.path) else { return nil }
        let data = try Data(contentsOf:journal);guard data.count < 8192 else { throw StravaImportFailure.invalid }
        return try JSONDecoder().decode(StravaImportRecord.self,from:data)
    }
    func clear() throws { if FileManager.default.fileExists(atPath:root.path) { try FileManager.default.removeItem(at:root) } }
    // Security scope is released even for failed/oversized/iCloud copies. No extraction occurs on the device.
    func stage(_ source: URL,owner: String,cancellation: StravaImportCancellation = StravaImportCancellation(),afterChunk: () -> Void = {}) throws -> StravaImportRecord {
        try cancellation.check()
        guard source.isFileURL,source.pathExtension.lowercased() == "zip" else { throw StravaImportFailure.invalid }
        let access = source.startAccessingSecurityScopedResource();defer { if access { source.stopAccessingSecurityScopedResource() } }
        var coordinationError: NSError?,outcome: Result<StravaImportRecord,Error>?
        NSFileCoordinator().coordinate(readingItemAt:source,options:[],error:&coordinationError) { url in
            outcome = Result {
                let values = try url.resourceValues(forKeys:[.isRegularFileKey,.isSymbolicLinkKey,.fileSizeKey])
                guard values.isRegularFile == true,values.isSymbolicLink != true,let length = values.fileSize,length > 0,Int64(length) <= StravaImportRecord.maximum else { throw StravaImportFailure.invalid }
                try cancellation.check();try prepare()
                let available = try root.resourceValues(forKeys:[.volumeAvailableCapacityForImportantUsageKey,.volumeTotalCapacityKey])
                guard let free = available.volumeAvailableCapacityForImportantUsage,let total = available.volumeTotalCapacity,
                      free-Int64(length)-Int64(StravaImportRecord.pieceBytes) >= max(Int64(total)/4,1024*1024*1024) else { throw StravaImportFailure.storage }
                let temporary = root.appendingPathComponent("copy.tmp")
                try write(Data(),to:temporary)
                defer { try? FileManager.default.removeItem(at:temporary) }
                let input = try FileHandle(forReadingFrom:url),output = try FileHandle(forWritingTo:temporary)
                defer { try? input.close();try? output.close() }
                var hash = SHA256(),copied: Int64 = 0
                while let bytes = try input.read(upToCount:1024*1024),!bytes.isEmpty {
                    try cancellation.check()
                    if copied == 0 { guard bytes.starts(with:[0x50,0x4b,0x03,0x04]) || bytes.starts(with:[0x50,0x4b,0x05,0x06]) else { throw StravaImportFailure.invalid } }
                    copied += Int64(bytes.count);guard copied <= Int64(length) else { throw StravaImportFailure.invalid }
                    hash.update(data:bytes);try output.write(contentsOf:bytes);afterChunk();try cancellation.check()
                }
                guard copied == Int64(length) else { throw StravaImportFailure.invalid }
                try cancellation.check();try output.synchronize()
                let row = try StravaImportRecord(owner:owner,size:copied,sha256:hash.finalize().map { String(format:"%02x",$0) }.joined())
                try cancellation.check()
                try FileManager.default.moveItem(at:temporary,to:archive);try save(row);return row
            }
        }
        if let error = coordinationError { throw error }
        guard let result = outcome else { throw StravaImportFailure.storage };return try result.get()
    }
    func makePiece(_ row: StravaImportRecord) throws -> (URL,String) {
        let next = try row.nextPiece(owner:row.owner),input = try FileHandle(forReadingFrom:archive);defer { try? input.close() }
        try input.seek(toOffset:UInt64(next.offset));guard let bytes = try input.read(upToCount:next.count),bytes.count == next.count else { throw StravaImportFailure.invalid }
        try write(bytes,to:piece)
        return (piece,SHA256.hash(data:bytes).map { String(format:"%02x",$0) }.joined())
    }
}

// Own only this app's Inbox copies, never original Files/provider documents.
struct StravaImportInbox {
    let root: URL
    init(root: URL = FileManager.default.urls(for:.documentDirectory,in:.userDomainMask)[0].appendingPathComponent("Inbox",isDirectory:true)) { self.root = root }
    func contains(_ url: URL) -> Bool { url.isFileURL && url.standardizedFileURL.path.hasPrefix(root.standardizedFileURL.path+"/") }
    func protect() throws {
        #if os(iOS)
        try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true,attributes:[.protectionKey:FileProtectionType.completeUntilFirstUserAuthentication])
        #else
        try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
        #endif
        guard try root.resourceValues(forKeys:[.isSymbolicLinkKey]).isSymbolicLink != true else { throw StravaImportFailure.invalid }
        let urls = [root]+(try FileManager.default.contentsOfDirectory(at:root,includingPropertiesForKeys:nil))
        for var url in urls {
            if try url.resourceValues(forKeys:[.isSymbolicLinkKey]).isSymbolicLink == true { continue }
            #if os(iOS)
            try FileManager.default.setAttributes([.protectionKey:FileProtectionType.completeUntilFirstUserAuthentication],ofItemAtPath:url.path)
            #endif
            var values = URLResourceValues();values.isExcludedFromBackup = true;try url.setResourceValues(values)
        }
    }
    func discard(_ url: URL) { if contains(url) { try? FileManager.default.removeItem(at:url) } }
    func sweep(keeping: URL? = nil) throws {
        try protect()
        for url in try FileManager.default.contentsOfDirectory(at:root,includingPropertiesForKeys:nil) {
            if url.standardizedFileURL != keeping?.standardizedFileURL { try FileManager.default.removeItem(at:url) }
        }
    }
}

protocol StravaImportCredentials {
    func read() throws -> StravaImportSession?
    func write(_ value: StravaImportSession) throws
    func clear() throws
}

// App-only Keychain item: no App Group/access group/signing capability required.
struct StravaImportKeychain: StravaImportCredentials {
    private let query: [String:Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:"com.kinetta.strava-import",kSecAttrAccount as String:"active",kSecAttrSynchronizable as String:false]
    func read() throws -> StravaImportSession? {
        var q = query;q[kSecReturnData as String] = true;q[kSecMatchLimit as String] = kSecMatchLimitOne
        var value: CFTypeRef?;let status = SecItemCopyMatching(q as CFDictionary,&value)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess,let data = value as? Data,data.count < 8192 else { throw StravaImportFailure.auth }
        let decoded = try JSONDecoder().decode(StravaImportSession.self,from:data)
        return try StravaImportSession(server:decoded.server,userID:decoded.userID,token:decoded.token)
    }
    func write(_ value: StravaImportSession) throws {
        let bytes = try JSONEncoder().encode(value)
        let attrs: [String:Any] = [kSecValueData as String:bytes,kSecAttrAccessible as String:kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(query as CFDictionary,attrs as CFDictionary)
        if status == errSecItemNotFound { var q = query;attrs.forEach { q[$0.key] = $0.value };guard SecItemAdd(q as CFDictionary,nil) == errSecSuccess else { throw StravaImportFailure.auth } }
        else if status != errSecSuccess { throw StravaImportFailure.auth }
    }
    func clear() throws { let status = SecItemDelete(query as CFDictionary);guard status == errSecSuccess || status == errSecItemNotFound else { throw StravaImportFailure.auth } }
}
