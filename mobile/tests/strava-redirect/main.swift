import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
defer { try? FileManager.default.removeItem(at:root) }
let file = root.appendingPathComponent("fictional-piece.bin")
try Data(repeating:42,count:4096).write(to:file)
let delegate = StravaRedirectGuard(),config = URLSessionConfiguration.ephemeral
config.httpShouldSetCookies = false;config.httpCookieStorage = nil;config.urlCredentialStorage = nil;config.urlCache = nil
let session = URLSession(configuration:config,delegate:delegate,delegateQueue:nil)
defer { session.invalidateAndCancel() }
for status in [301,302,303,307,308] {
    for destination in ["same","other"] {
        var req = URLRequest(url:URL(string:CommandLine.arguments[1]+"/redirect/\(status)/\(destination)")!)
        req.httpMethod = "PUT";req.setValue("Bearer fictional",forHTTPHeaderField:"Authorization")
        let done = DispatchSemaphore(value:0)
        session.uploadTask(with:req,fromFile:file) { _,response,error in
            precondition(error == nil)
            precondition((response as? HTTPURLResponse)?.statusCode == status,"archive redirect was followed")
            done.signal()
        }.resume()
        precondition(done.wait(timeout:.now()+10) == .success)
    }
}
print("Ephemeral file uploads: 301/302/303/307/308 same/cross-origin redirects refused PASS")
