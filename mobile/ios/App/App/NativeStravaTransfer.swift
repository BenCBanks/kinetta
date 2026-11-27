import Foundation

// All state changes and URLSession delegate callbacks run on one queue. Only the
// explicitly confirmed journal can create a network task; restart rechecks it.
final class NativeStravaTransfer: NSObject,URLSessionDataDelegate {
    static let shared = NativeStravaTransfer()
    static let identifier = "com.kinetta.strava-import.upload"
    private let queue = DispatchQueue(label:"app.kinetta.strava-import")
    private let store = StravaImportStore(),keychain = StravaImportKeychain()
    private var credential: StravaImportSession?
    private var generation = UUID(),busy = false,stopping = false
    private var cancellationFenced = false
    private var controlPhase = false
    private var backgroundCompletion: (() -> Void)?
    private var responses: [Int:Data] = [:]
    private var responseOverflow = Set<Int>()
    private lazy var delegateQueue: OperationQueue = { let q = OperationQueue();q.maxConcurrentOperationCount = 1;q.underlyingQueue = queue;return q }()
    private lazy var background: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier:Self.identifier)
        config.sessionSendsLaunchEvents = true;config.isDiscretionary = false;config.httpMaximumConnectionsPerHost = 1
        config.httpShouldSetCookies = false;config.httpCookieStorage = nil;config.urlCredentialStorage = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData;config.urlCache = nil
        config.timeoutIntervalForResource = 24*3600;config.waitsForConnectivity = true
        return URLSession(configuration:config,delegate:self,delegateQueue:delegateQueue)
    }()
    private lazy var control: URLSession = {
        let config = URLSessionConfiguration.ephemeral;config.httpCookieStorage = nil;config.urlCredentialStorage = nil;config.urlCache = nil
        config.httpShouldSetCookies = false;config.timeoutIntervalForRequest = 30
        return URLSession(configuration:config,delegate:self,delegateQueue:delegateQueue)
    }()
    func start() {
        queue.async {
            _ = self.background
            do {
                self.credential = try self.keychain.read()
                if let who = self.credential,let row = try self.store.read() { try row.check(owner:who.owner) }
                else { self.clearLocked();return }
                self.resumeLocked()
            } catch StravaImportFailure.expired { self.clearLocked() }
            catch StravaImportFailure.account { self.clearLocked() }
            catch StravaImportFailure.invalid { self.clearLocked() }
            catch { self.credential = nil } // Locked protected data remains retryable after unlock/activation.
        }
    }
    func handleEvents(identifier: String,completion: @escaping () -> Void) -> Bool {
        guard identifier == Self.identifier else { return false }
        queue.async { self.backgroundCompletion = completion;_ = self.background };return true
    }
    func bind(_ next: StravaImportSession,done: @escaping (Error?) -> Void) {
        queue.async {
            guard !self.stopping else { done(StravaImportFailure.account);return }
            do {
                let saved = try self.credential ?? self.keychain.read()
                if (saved == nil && !self.cancellationFenced) || (saved != nil && saved?.owner != next.owner) {
                    self.stop { error in if let error = error { done(error) } else { self.bind(next,done:done) } };return
                }
                if let row = try self.store.read() {
                    do { try row.check(owner:next.owner) } catch { try self.store.clear() }
                }
                if saved != next {
                    self.generation = UUID();self.busy = false;self.controlPhase = false
                    self.control.getAllTasks { tasks in tasks.forEach { $0.cancel() } }
                }
                self.credential = next;try self.keychain.write(next);done(nil);self.resumeLocked()
            } catch { done(StravaImportFailure.auth) }
        }
    }
    func status(done: @escaping (Result<StravaImportRecord?,Error>) -> Void) {
        queue.async { done(Result {
            guard let who = self.credential else { throw StravaImportFailure.account }
            guard let row = try self.store.read() else { return nil };try row.check(owner:who.owner);return row
        }) }
    }
    func stage(_ url: URL,done: @escaping (Result<StravaImportRecord,Error>) -> Void) {
        queue.async { done(Result {
            guard !self.stopping,let who = self.credential else { throw StravaImportFailure.account }
            guard try self.store.read() == nil,!self.busy else { throw StravaImportFailure.confirm }
            do { return try self.store.stage(url,owner:who.owner) }
            catch { try? self.store.clear();throw error }
        }) }
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
        queue.async {
            self.stopping = true;self.generation = UUID();self.credential = nil;self.busy = false
            do { try self.keychain.clear() } catch { done(error);return }
            // Revoke the credential before cancelling. Old delegate callbacks cannot
            // advance or schedule work under a replacement account.
            self.control.getAllTasks { tasks in tasks.forEach { $0.cancel() } }
            self.background.getAllTasks { tasks in
                tasks.forEach { $0.cancel() }
                self.queue.async { self.finishStopping(deadline:Date().addingTimeInterval(30),done:done) }
            }
        }
    }
    private func finishStopping(deadline: Date,done: @escaping (Error?) -> Void) {
        background.getAllTasks { tasks in self.queue.async {
            if !tasks.isEmpty {
                guard Date() < deadline else { done(StravaImportFailure.network);return }
                tasks.forEach { $0.cancel() };self.queue.asyncAfter(deadline:.now()+0.1) { self.finishStopping(deadline:deadline,done:done) };return
            }
            do { try self.store.clear();self.responses.removeAll();self.responseOverflow.removeAll();self.stopping = false;self.cancellationFenced = true;self.controlPhase = false;self.completeEvents();done(nil) } catch { done(error) }
        }}
    }
    private func clearLocked() { stop { _ in } }
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
            control.dataTask(with:req) { data,response,error in self.queue.async {
                guard !self.stopping,self.generation == stamp,self.credential == who else { return }
                guard error == nil,let http = response as? HTTPURLResponse,(200..<300).contains(http.statusCode),let data = data,data.count < 64*1024,
                      let object = try? JSONSerialization.jsonObject(with:data) as? [String:Any] else {
                    done(.failure((response as? HTTPURLResponse)?.statusCode == 401 ? StravaImportFailure.auth : StravaImportFailure.network));return
                }
                done(.success(object))
            }}.resume()
        } catch { done(.failure(error)) }
    }
    private func resumeLocked() {
        guard !stopping,!busy,let who = credential,let row = try? store.read(),row.confirmed else { return }
        do { try row.check(owner:who.owner) } catch { clearLocked();return }
        // iOS may still own an upload from the previous process. Reattach before
        // querying/rewriting piece.bin, which that task must retain unchanged.
        busy = true;controlPhase = true;let stamp = generation
        background.getAllTasks { tasks in self.queue.async {
            guard !self.stopping,self.generation == stamp,self.credential == who else { return }
            let valid = tasks.filter { $0.taskDescription == row.id.uuidString.lowercased() && $0.state != .completed && $0.state != .canceling }
            tasks.filter { $0.taskDescription != row.id.uuidString.lowercased() }.forEach { $0.cancel() }
            if !valid.isEmpty { valid.forEach { $0.resume() };self.controlPhase = false;self.completeEvents();return }
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
                        let task = self.background.uploadTask(with:request,fromFile:file);task.taskDescription = current.id.uuidString.lowercased();task.resume();self.controlPhase = false;self.completeEvents()
                    } catch { self.finishCycle() }
                }
            }
        }
    }
    func urlSession(_ session: URLSession,dataTask: URLSessionDataTask,didReceive data: Data) {
        guard session === background else { return }
        let count = (responses[dataTask.taskIdentifier]?.count ?? 0)+data.count
        guard count <= 64*1024 else { responseOverflow.insert(dataTask.taskIdentifier);dataTask.cancel();return }
        responses[dataTask.taskIdentifier,default:Data()].append(data)
    }
    func urlSession(_ session: URLSession,task: URLSessionTask,didCompleteWithError error: Error?) {
        let data = responses.removeValue(forKey:task.taskIdentifier);let overflow = responseOverflow.remove(task.taskIdentifier) != nil
        guard session === background,!stopping,let who = credential,let row = try? store.read(),row.confirmed,
              task.taskDescription == row.id.uuidString.lowercased(),row.owner == who.owner else { return }
        busy = false
        // On failure leave the durable offset unchanged. Foreground resume GETs
        // status first, so a committed piece with a lost response is never duplicated.
        guard error == nil,!overflow,let http = task.response as? HTTPURLResponse,(200..<300).contains(http.statusCode),data != nil else { finishCycle();return }
        resumeLocked()
    }
    func urlSession(_ session: URLSession,task: URLSessionTask,willPerformHTTPRedirection response: HTTPURLResponse,newRequest request: URLRequest,completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
    private func finishCycle() { busy = false;controlPhase = false;completeEvents() }
    private func completeEvents() {
        guard !controlPhase,let done = backgroundCompletion else { return };backgroundCompletion = nil
        DispatchQueue.main.async(execute:done)
    }
    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) { completeEvents() }
}
