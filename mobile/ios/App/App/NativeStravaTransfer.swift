import Foundation
#if os(iOS)
import UIKit
#endif

// All state changes and URLSession delegate callbacks run on one queue. Only the
// explicitly confirmed journal can create a network task; restart rechecks it.
final class NativeStravaTransfer: StravaRedirectGuard, URLSessionDataDelegate, @unchecked Sendable {
    static let shared = NativeStravaTransfer()
    static let identifier = "com.kinetta.strava-import.upload"
    private let queue = DispatchQueue(label:"app.kinetta.strava-import")
    private let store: StravaImportStore,keychain: StravaImportCredentials
    private let copyQueue = DispatchQueue(label:"app.kinetta.strava-import.copy")
    private let copying = DispatchGroup()
    private var copyCancellation: StravaImportCancellation?
    private var transitions = StravaImportTransitions()
    private let legacyConfiguration: URLSessionConfiguration?
    private let controlConfiguration: URLSessionConfiguration?
    // Test seam holds cancellation callbacks, never changes production networking.
    private let beforeCleanup: (@escaping () -> Void) -> Void
    private let afterCopyChunk: () -> Void
    init(store: StravaImportStore = StravaImportStore(),keychain: StravaImportCredentials = StravaImportKeychain(),legacyConfiguration: URLSessionConfiguration? = nil,controlConfiguration: URLSessionConfiguration? = nil,beforeCleanup: @escaping (@escaping () -> Void) -> Void = { $0() },afterCopyChunk: @escaping () -> Void = {}) {
        self.store = store;self.keychain = keychain;self.legacyConfiguration = legacyConfiguration;self.controlConfiguration = controlConfiguration;self.beforeCleanup = beforeCleanup;self.afterCopyChunk = afterCopyChunk;super.init()
    }
    #if os(iOS)
    private var execution: UIBackgroundTaskIdentifier = .invalid
    private var executionCancellation: StravaImportCancellation?
    #endif
    private var credential: StravaImportSession?
    private var generation = UUID(),busy = false,stopping = false
    private var cancellationFenced = false
    private var controlPhase = false
    private var backgroundCompletion: (() -> Void)?
    private struct ControlRead {
        let stamp: UUID,who: StravaImportSession
        let done: (Result<[String:Any],Error>) -> Void
        var bytes = Data()
    }
    private var controlReads: [Int:ControlRead] = [:]
    private var responses: [Int:Data] = [:]
    private var responseOverflow = Set<Int>()
    private var uploadGenerations: [Int:UUID] = [:]
    private lazy var delegateQueue: OperationQueue = { let q = OperationQueue();q.maxConcurrentOperationCount = 1;q.underlyingQueue = queue;return q }()
    // Legacy OS-owned tasks are cancellation-only. Never schedule/resume on this session.
    private lazy var legacy: URLSession = {
        let config = legacyConfiguration ?? URLSessionConfiguration.background(withIdentifier:Self.identifier)
        config.sessionSendsLaunchEvents = true;config.isDiscretionary = false;config.httpMaximumConnectionsPerHost = 1
        config.httpShouldSetCookies = false;config.httpCookieStorage = nil;config.urlCredentialStorage = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData;config.urlCache = nil
        config.timeoutIntervalForResource = 24*3600;config.waitsForConnectivity = true
        return URLSession(configuration:config,delegate:self,delegateQueue:delegateQueue)
    }()
    private lazy var uploads: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false;config.httpCookieStorage = nil;config.urlCredentialStorage = nil;config.urlCache = nil
        config.timeoutIntervalForRequest = 30;config.timeoutIntervalForResource = 120;config.httpMaximumConnectionsPerHost = 1
        return URLSession(configuration:config,delegate:self,delegateQueue:delegateQueue)
    }()
    private lazy var control: URLSession = {
        let config = controlConfiguration ?? URLSessionConfiguration.ephemeral;config.httpCookieStorage = nil;config.urlCredentialStorage = nil;config.urlCache = nil
        config.httpShouldSetCookies = false;config.timeoutIntervalForRequest = 30
        return URLSession(configuration:config,delegate:self,delegateQueue:delegateQueue)
    }()
    func start() {
        queue.async {
            do {
                guard let who = try self.keychain.read(),let row = try self.store.read() else { self.clearLocked();return }
                try row.check(owner:who.owner)
                let stamp = self.transitions.begin();self.bindLocked(who,stamp:stamp,done:{ _ in })
            } catch StravaImportFailure.expired { self.clearLocked() }
            catch StravaImportFailure.account { self.clearLocked() }
            catch StravaImportFailure.invalid { self.clearLocked() }
            catch { self.credential = nil }
        }
    }
    func handleEvents(identifier: String,completion: @escaping () -> Void) -> Bool {
        guard identifier == Self.identifier else { return false }
        queue.async { self.backgroundCompletion = completion;self.legacy.getAllTasks { tasks in
            tasks.forEach { $0.cancel() };self.queue.async { self.completeEvents() }
        }};return true
    }
    func bind(_ next: StravaImportSession,done: @escaping (Error?) -> Void) {
        queue.async { let stamp = self.transitions.begin();self.bindLocked(next,stamp:stamp,done:done) }
    }
    private func bindLocked(_ next: StravaImportSession,stamp: UUID,done: @escaping (Error?) -> Void) {
        guard transitions.accepts(stamp) else { done(StravaImportFailure.account);return }
        do {
            let saved = try credential ?? keychain.read()
            if stopping || !cancellationFenced || (saved != nil && saved != next) {
                stopLocked(stamp:stamp,clearStore:saved?.owner != next.owner) { error in
                    guard self.transitions.accepts(stamp) else { done(StravaImportFailure.account);return }
                    if let error = error { done(error) } else { self.bindLocked(next,stamp:stamp,done:done) }
                };return
            }
            if let row = try store.read() {
                do { try row.check(owner:next.owner) } catch { try store.clear() }
            }
            if saved != next {
                generation = UUID();busy = false;controlPhase = false
                control.getAllTasks { tasks in tasks.forEach { $0.cancel() } }
            }
            try keychain.write(next);credential = next;done(nil);resumeLocked()
        } catch { done(StravaImportFailure.auth) }
    }
    func status(done: @escaping (Result<StravaImportRecord?,Error>) -> Void) {
        queue.async { done(Result {
            guard let who = self.credential else { throw StravaImportFailure.account }
            guard let row = try self.store.read() else { return nil };try row.check(owner:who.owner);return row
        }) }
    }
    func stage(_ url: URL,done: @escaping (Result<StravaImportRecord,Error>) -> Void) {
        queue.async {
            do {
                guard !self.stopping,let who = self.credential else { throw StravaImportFailure.account }
                guard !self.busy,self.copyCancellation == nil else { throw StravaImportFailure.confirm }
                // Retire completed/rejected attempts; never strand the next archive.
                if let previous = try self.store.read() {
                    guard previous.terminal else { throw StravaImportFailure.confirm };try self.store.clear()
                } else { try self.store.clear() }
                let stamp = self.generation,cancellation = StravaImportCancellation()
                self.copyCancellation = cancellation;self.copying.enter()
                self.copyQueue.async {
                    let result = Result { try self.store.stage(url,owner:who.owner,cancellation:cancellation,afterChunk:self.afterCopyChunk) }
                    self.queue.async {
                        self.copyCancellation = nil
                        let current = !self.stopping && self.generation == stamp && self.credential == who
                        if !current { done(.failure(StravaImportFailure.account)) }
                        else {
                            if case .failure = result { try? self.store.clear() }
                            done(result)
                        }
                        self.copying.leave()
                    }
                }
            } catch { done(.failure(error)) }
        }
    }
    func confirm(id: UUID,done: @escaping (Error?) -> Void) {
        queue.async {
            do {
                guard !self.stopping,let who = self.credential,var row = try self.store.read(),row.id == id else { throw StravaImportFailure.account }
                try row.confirm(owner:who.owner);try self.store.save(row);done(nil);self.resumeLocked()
            } catch { done(error) }
        }
    }
    func stop(done: @escaping (Error?) -> Void) {
        queue.async { let stamp = self.transitions.begin();self.stopLocked(stamp:stamp,clearStore:true,done:done) }
    }
    private func stopLocked(stamp: UUID,clearStore: Bool,done: @escaping (Error?) -> Void) {
        guard transitions.accepts(stamp) else { done(StravaImportFailure.account);return }
        stopping = true;generation = UUID();credential = nil;busy = false;copyCancellation?.cancel();endExecution()
        do { try keychain.clear() } catch { done(error);return }
        // Invalidate before asynchronous cancellation. A superseded completion
        // cannot write credentials or clear the replacement account's stage.
        beforeCleanup { self.queue.async {
            self.finishStopping(stamp:stamp,clearStore:clearStore,deadline:Date().addingTimeInterval(30),done:done)
        }}
    }
    private func finishStopping(stamp: UUID,clearStore: Bool,deadline: Date,done: @escaping (Error?) -> Void) {
        guard transitions.accepts(stamp) else { done(StravaImportFailure.account);return }
        let group = DispatchGroup(),lock = NSLock();var remaining = false
        for session in [legacy,uploads,control] {
            group.enter();session.getAllTasks { tasks in
                lock.lock();remaining = remaining || !tasks.isEmpty;lock.unlock()
                tasks.forEach { $0.cancel() };group.leave()
            }
        }
        group.notify(queue:queue) {
            guard self.transitions.accepts(stamp) else { done(StravaImportFailure.account);return }
            if remaining || self.copyCancellation != nil {
                guard Date() < deadline else { done(StravaImportFailure.network);return }
                self.queue.asyncAfter(deadline:.now()+0.1) { self.finishStopping(stamp:stamp,clearStore:clearStore,deadline:deadline,done:done) };return
            }
            self.copying.notify(queue:self.queue) {
                guard self.transitions.accepts(stamp) else { done(StravaImportFailure.account);return }
                do {
                    if clearStore { try self.store.clear() }
                    self.controlReads.removeAll();self.responses.removeAll();self.responseOverflow.removeAll();self.uploadGenerations.removeAll();self.stopping = false
                    self.cancellationFenced = true;self.controlPhase = false;self.completeEvents();done(nil)
                } catch { done(error) }
            }
        }
    }
    private func clearLocked() {
        let stamp = transitions.begin();stopLocked(stamp:stamp,clearStore:true,done:{ _ in })
    }
    private func beginExecution() {
        #if os(iOS)
        // A bounded best-effort grace period; no OS background upload can redirect
        // bytes outside the account server. Suspension simply requires resume.
        let stamp = generation,token = StravaImportCancellation();executionCancellation = token
        DispatchQueue.main.async {
            guard (try? token.check()) != nil else { return }
            if self.execution == .invalid {
                self.execution = UIApplication.shared.beginBackgroundTask(withName:"Strava archive piece") {
                    self.queue.async {
                        guard self.generation == stamp else { return }
                        self.generation = UUID();self.uploads.getAllTasks { $0.forEach { $0.cancel() } }
                        self.control.getAllTasks { $0.forEach { $0.cancel() } };self.finishCycle()
                    }
                }
            }
        }
        #endif
    }
    private func endExecution() {
        #if os(iOS)
        executionCancellation?.cancel();executionCancellation = nil
        DispatchQueue.main.async { if self.execution != .invalid { UIApplication.shared.endBackgroundTask(self.execution);self.execution = .invalid } }
        #endif
    }
    private func request(_ who: StravaImportSession,path: String,method: String = "GET") throws -> URLRequest {
        guard let url = URL(string:who.server+"/api/strava-import"+path) else { throw StravaImportFailure.account }
        var request = URLRequest(url:url);request.httpMethod = method
        request.setValue("Bearer "+who.token,forHTTPHeaderField:"Authorization");request.setValue(String(who.userID),forHTTPHeaderField:"X-Kinetta-Account")
        request.setValue("application/json",forHTTPHeaderField:"Accept");return request
    }
    // Control calls never include file content and never call /confirm (workout import).
    private func json(_ who: StravaImportSession,path: String,method: String = "GET",body: [String:Any]? = nil,done: @escaping (Result<[String:Any],Error>) -> Void) {
        let stamp = generation
        do {
            var req = try request(who,path:path,method:method)
            if let body = body { req.httpBody = try JSONSerialization.data(withJSONObject:body);req.setValue("application/json",forHTTPHeaderField:"Content-Type") }
            // Delegate delivery bounds every chunk; a completion-handler data
            // task would buffer the entire response before our size check.
            let task = control.dataTask(with:req)
            controlReads[task.taskIdentifier] = ControlRead(stamp:stamp,who:who,done:done)
            task.resume()
        } catch { done(.failure(error)) }
    }
    private func resumeLocked() {
        guard !stopping,!busy,let who = credential,let row = try? store.read(),row.confirmed else { return }
        do { try row.check(owner:who.owner) } catch { clearLocked();return }
        guard !row.terminal else { return }
        busy = true;controlPhase = true;beginExecution()
        resumeAfterDrain(who,row:row,stamp:generation,deadline:Date().addingTimeInterval(30))
    }
    private func resumeAfterDrain(_ who: StravaImportSession,row: StravaImportRecord,stamp: UUID,deadline: Date) {
        uploads.getAllTasks { tasks in self.queue.async {
            guard !self.stopping,self.generation == stamp,self.credential == who else { return }
            // Never rewrite piece.bin while a cancelled upload can still read it.
            if !tasks.isEmpty {
                tasks.forEach { $0.cancel() }
                guard Date() < deadline else { self.finishCycle();return }
                self.queue.asyncAfter(deadline:.now()+0.1) { self.resumeAfterDrain(who,row:row,stamp:stamp,deadline:deadline) };return
            }
            self.reconcile(who,row:row)
        }}
    }
    private func reconcile(_ who: StravaImportSession,row: StravaImportRecord) {
        let path = "/uploads/"+row.id.uuidString.lowercased()
        // Idempotent reservation handles a lost POST response without a second ID.
        json(who,path:"/uploads",method:"POST",body:["id":row.id.uuidString.lowercased(),"size":row.size,"sha256":row.sha256]) { result in
            switch result {
            case .failure:self.finishCycle()
            case .success:
                self.json(who,path:path) { result in
                    do {
                        let response = try result.get();var current = row
                        guard let id = response["id"] as? String,let uuid = UUID(uuidString:id),let size = response["size"] as? NSNumber,
                              let hash = response["sha256"] as? String,let received = response["received"] as? NSNumber,let state = response["state"] as? String else { throw StravaImportFailure.invalid }
                        try current.reconcile(id:uuid,size:size.int64Value,sha256:hash,received:received.int64Value,state:state);try self.store.save(current)
                        if state != "uploading" {
                            // The preview/server job remains available; local archive bytes are no longer needed.
                            if ["preview_queued","review","importing","done","cancelled","failed"].contains(state) { try? FileManager.default.removeItem(at:self.store.archive);try? FileManager.default.removeItem(at:self.store.piece) }
                            self.finishCycle();return
                        }
                        if current.received == current.size {
                            self.json(who,path:path+"/finalize",method:"POST") { _ in self.finishCycle() };return
                        }
                        let (file,pieceHash) = try self.store.makePiece(current)
                        var request = try self.request(who,path:path+"/pieces/"+String(current.received),method:"PUT")
                        request.setValue("application/octet-stream",forHTTPHeaderField:"Content-Type");request.setValue(pieceHash,forHTTPHeaderField:"X-Content-Sha256")
                        let task = self.uploads.uploadTask(with:request,fromFile:file);task.taskDescription = current.id.uuidString.lowercased();self.uploadGenerations[task.taskIdentifier] = self.generation;task.resume();self.controlPhase = false;self.completeEvents()
                    } catch { self.finishCycle() }
                }
            }
        }
    }
    private func current(_ read: ControlRead) -> Bool { !stopping && generation == read.stamp && credential == read.who }
    private func refuseControl(_ task: URLSessionTask) {
        let read = controlReads.removeValue(forKey:task.taskIdentifier);task.cancel()
        if let read = read,current(read) { read.done(.failure(StravaImportFailure.network)) }
    }
    func urlSession(_ session: URLSession,dataTask: URLSessionDataTask,didReceive response: URLResponse,completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        if session === control {
            guard let read = controlReads[dataTask.taskIdentifier],current(read),response.expectedContentLength < 64*1024 else {
                // Explicitly cancel while the task is still receiving headers.
                // Returning .cancel first can complete a custom protocol task
                // before its transport cancellation callback is delivered.
                refuseControl(dataTask);completionHandler(.cancel);return
            }
        }
        completionHandler(.allow)
    }
    func urlSession(_ session: URLSession,dataTask: URLSessionDataTask,didReceive data: Data) {
        if session === control {
            guard var read = controlReads[dataTask.taskIdentifier],current(read),read.bytes.count+data.count < 64*1024 else { refuseControl(dataTask);return }
            read.bytes.append(data);controlReads[dataTask.taskIdentifier] = read;return
        }
        guard session === uploads,uploadGenerations[dataTask.taskIdentifier] == generation else { return }
        let count = (responses[dataTask.taskIdentifier]?.count ?? 0)+data.count
        guard count <= 64*1024 else { responseOverflow.insert(dataTask.taskIdentifier);dataTask.cancel();return }
        responses[dataTask.taskIdentifier,default:Data()].append(data)
    }
    func urlSession(_ session: URLSession,task: URLSessionTask,didCompleteWithError error: Error?) {
        if session === control {
            guard let read = controlReads.removeValue(forKey:task.taskIdentifier),current(read) else { return }
            guard error == nil,let http = task.response as? HTTPURLResponse,(200..<300).contains(http.statusCode),
                  let object = try? JSONSerialization.jsonObject(with:read.bytes) as? [String:Any] else {
                read.done(.failure((task.response as? HTTPURLResponse)?.statusCode == 401 ? StravaImportFailure.auth : StravaImportFailure.network));return
            }
            read.done(.success(object));return
        }
        guard session === uploads else { return }
        let data = responses.removeValue(forKey:task.taskIdentifier);let overflow = responseOverflow.remove(task.taskIdentifier) != nil
        let stamp = session === uploads ? uploadGenerations.removeValue(forKey:task.taskIdentifier) : nil
        guard session === uploads,stamp == generation,!stopping,let who = credential,let row = try? store.read(),row.confirmed,
              task.taskDescription == row.id.uuidString.lowercased(),row.owner == who.owner else { return }
        busy = false
        // On failure leave the durable offset unchanged. Foreground resume GETs
        // status first, so a committed piece with a lost response is never duplicated.
        guard error == nil,!overflow,let http = task.response as? HTTPURLResponse,(200..<300).contains(http.statusCode),data != nil else { finishCycle();return }
        resumeLocked()
    }
    private func finishCycle() { busy = false;controlPhase = false;endExecution();completeEvents() }
    private func completeEvents() {
        guard !controlPhase,let done = backgroundCompletion else { return };backgroundCompletion = nil
        DispatchQueue.main.async(execute:done)
    }
    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) { completeEvents() }
}
