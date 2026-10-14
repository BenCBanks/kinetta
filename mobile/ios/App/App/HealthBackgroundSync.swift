import Foundation
import HealthKit
import Security
import UIKit
import Capacitor

private struct HealthSyncCredentials: Codable {
    let owner: String
    let server: URL
    let token: String
}

// Runs without the WebView. All state and callbacks pass through one serial queue.
final class HealthBackgroundSync: NSObject, URLSessionTaskDelegate {
    static let shared = HealthBackgroundSync()
    private let serial = DispatchQueue(label: "app.kinetta.health-sync")
    private let store = HKHealthStore()
    private var credentials: HealthSyncCredentials?
    private var state: HealthSyncState?
    private var observer: HKObserverQuery?
    private var queries: [HKQuery] = []
    private var task: URLSessionDataTask?
    private var busy = false
    private var rerun = false
    private var refreshRange: (Date, Date)?
    private var attempted = Set<String>()
    private var version = 0
    private var completions: [() -> Void] = []
    private var activeCompletions: [() -> Void] = []
    private var backgroundTask = UIBackgroundTaskIdentifier.invalid
    private let keyAccount = "apple-health-sync"
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 45
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    private var file: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("HealthSync/state.json")
    }

    private func keyQuery() -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: Bundle.main.bundleIdentifier ?? "app.kinetta",
         kSecAttrAccount as String: keyAccount]
    }

    private func saveCredentials(_ value: HealthSyncCredentials?) throws {
        let query = keyQuery()
        if let value = value {
            let data = try JSONEncoder().encode(value)
            let update = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
            if update == errSecItemNotFound {
                var insert = query
                insert[kSecValueData as String] = data
                insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
                guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else { throw failure("Could not securely save the Health connection.") }
            } else if update != errSecSuccess { throw failure("Could not securely save the Health connection.") }
        } else {
            let result = SecItemDelete(query as CFDictionary)
            guard result == errSecSuccess || result == errSecItemNotFound else { throw failure("Could not clear the Health connection. Unlock your phone and try again.") }
        }
    }

    private func restore() throws {
        var query = keyQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var value: CFTypeRef?
        let result = SecItemCopyMatching(query as CFDictionary, &value)
        guard result != errSecItemNotFound else { return }
        guard result == errSecSuccess, let data = value as? Data else { throw failure("Unlock your phone to resume Apple Health sync.") }
        let restored = try JSONDecoder().decode(HealthSyncCredentials.self, from: data)
        let saved = try JSONDecoder().decode(HealthSyncState.self, from: Data(contentsOf: file))
        guard restored.owner == saved.owner else { throw failure("Reconnect Apple Health to this account.") }
        credentials = restored
        state = saved
    }

    private func persist(_ next: HealthSyncState) throws {
        let directory = file.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var excluded = directory
        var resource = URLResourceValues()
        resource.isExcludedFromBackup = true
        try excluded.setResourceValues(resource)
        try JSONEncoder().encode(next).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        state = next
    }

    private func failure(_ message: String) -> NSError {
        NSError(domain: "KinettaHealth", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }

    private func detailTypes() -> Set<HKObjectType> {
        var ids: [HKQuantityTypeIdentifier] = [.stepCount]
        if #available(iOS 16.0, *) { ids += [.runningPower, .runningSpeed, .runningStrideLength, .runningVerticalOscillation, .runningGroundContactTime] }
        if #available(iOS 17.0, *) { ids += [.cyclingPower, .cyclingSpeed, .cyclingCadence] }
        return Set(ids.compactMap { HKObjectType.quantityType(forIdentifier: $0) })
    }

    // Called only from the user's explicit Connect/permissions action, never in the background.
    func requestPermissions(done: @escaping (Error?) -> Void) {
        store.requestAuthorization(toShare: [], read: detailTypes()) { success, error in
            done(error ?? (success ? nil : self.failure("Health permissions could not be requested.")))
        }
    }

    func refresh(owner: String, start: Date, end: Date, done: @escaping (Error?) -> Void) {
        serial.async {
            guard self.credentials?.owner == owner, start < end,
                  end <= Date().addingTimeInterval(3600) else {
                done(self.failure("Reconnect Apple Health before refreshing workout details.")); return
            }
            // Schedule after the current read/upload, retaining the anchored new-workout cursor.
            if let range = self.refreshRange { self.refreshRange = (min(range.0, start), max(range.1, end)) }
            else { self.refreshRange = (start, end) }
            self.kick(); done(nil)
        }
    }

    func start() {
        serial.async {
            guard HKHealthStore.isHealthDataAvailable() else { return }
            do {
                if self.credentials == nil { try self.restore() }
                if self.credentials != nil { self.observe(); self.kick() }
            } catch { /* Protected files/Keychain can be unavailable before the first unlock. Retry on activation. */ }
        }
    }

    func connect(server: String, owner: String, token: String, done: @escaping (Error?) -> Void) {
        serial.async {
            guard let url = URL(string: server), url.scheme == "https", url.host != nil,
                  url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
                  !owner.isEmpty, !token.isEmpty else { done(self.failure("A secure server and logged-in account are required.")); return }
            do {
                let next = HealthSyncCredentials(owner: owner, server: url, token: token)
                if self.credentials?.owner != owner {
                    try self.saveCredentials(nil)
                    self.cancel()
                    self.credentials = nil
                    try self.persist(HealthSyncState(owner: owner, since: Date().addingTimeInterval(-30 * 86400)))
                }
                try self.saveCredentials(next)
                self.credentials = next
                if var saved = self.state { saved.needsLogin = false; try self.persist(saved) }
                self.observe()
                let connectionVersion = self.version
                self.store.enableBackgroundDelivery(for: .workoutType(), frequency: .immediate) { success, error in
                    self.serial.async {
                        guard connectionVersion == self.version, self.credentials?.owner == owner else {
                            done(self.failure("Health connection changed while enabling background delivery.")); return
                        }
                        if var saved = self.state {
                            saved.backgroundDeliveryEnabled = success && error == nil
                            do { try self.persist(saved) }
                            catch { done(self.failure("Could not save background sync status.")); return }
                        }
                        if !success || error != nil { self.recordError("Background delivery could not be enabled. Foreground sync still works.") }
                        self.kick()
                        done(error ?? (success ? nil : self.failure("Background delivery could not be enabled.")))
                    }
                }
            } catch { done(error) }
        }
    }

    func disconnect(done: @escaping (Error?) -> Void) {
        serial.async {
            do {
                // Delete credentials first. Late HealthKit/network callbacks cannot resurrect the connection.
                try self.saveCredentials(nil)
                self.cancel()
                self.credentials = nil
                self.state = nil
                if FileManager.default.fileExists(atPath: self.file.path) { try FileManager.default.removeItem(at: self.file) }
                self.store.disableBackgroundDelivery(for: .workoutType()) { _, _ in }
                done(nil)
            } catch { done(error) }
        }
    }

    func status(owner: String, done: @escaping ([String: Any]) -> Void) {
        serial.async {
            guard let state = self.state, state.owner == owner, self.credentials?.owner == owner else { done(["enabled": false]); return }
            var result: [String: Any] = ["enabled": state.backgroundDeliveryEnabled, "pending": state.pending.count, "needsLogin": state.needsLogin]
            if let error = state.error { result["error"] = error }
            if let date = state.lastSuccess { result["lastSuccess"] = ISO8601DateFormatter().string(from: date) }
            done(result)
        }
    }

    private func observe() {
        guard observer == nil else { return }
        let query = HKObserverQuery(sampleType: .workoutType(), predicate: nil) { _, completion, error in
            self.serial.async {
                guard self.credentials != nil else { completion(); return }
                if error != nil { self.recordError("Apple Health could not read workouts. Unlock your phone and try again."); completion(); return }
                self.completions.append(completion)
                self.kick()
            }
        }
        observer = query
        store.execute(query)
    }

    private func cancel() {
        version += 1
        if let observer = observer { store.stop(observer) }
        observer = nil
        queries.forEach { store.stop($0) }
        queries.removeAll()
        task?.cancel(); task = nil
        (activeCompletions + completions).forEach { $0() }
        activeCompletions.removeAll(); completions.removeAll()
        busy = false; rerun = false
        refreshRange = nil
        endBackgroundTask()
    }

    private func kick() {
        guard credentials != nil, state != nil, state?.needsLogin == false else {
            completions.forEach { $0() }; completions.removeAll(); return
        }
        if busy { rerun = true; return }
        busy = true
        attempted.removeAll()
        activeCompletions = completions; completions.removeAll()
        let run = version
        DispatchQueue.main.async {
            let identifier = UIApplication.shared.beginBackgroundTask(withName: "Apple Health sync") {
                self.serial.async {
                    guard run == self.version else { return }
                    self.recordError("Sync paused; pending workouts will be retried when iOS gives Kinetta time.")
                    self.cancel()
                    if self.credentials != nil { self.observe() }
                }
            }
            self.serial.async {
                guard run == self.version else {
                    if identifier != .invalid { DispatchQueue.main.async { UIApplication.shared.endBackgroundTask(identifier) } }
                    return
                }
                self.backgroundTask = identifier
                self.capture(run: run)
            }
        }
    }

    private func capture(run: Int) {
        if let range = refreshRange {
            refreshRange = nil
            let predicate = HKQuery.predicateForSamples(withStart: range.0, end: range.1, options: .strictStartDate)
            let query = HKSampleQuery(sampleType: .workoutType(), predicate: predicate, limit: 2001, sortDescriptors: nil) { _, samples, error in
                self.serial.async {
                    guard run == self.version else { return }
                    self.queries.removeAll()
                    do {
                        guard error == nil, var next = self.state, (samples?.count ?? 0) <= 2000 else {
                            throw self.failure("Could not refresh this Health history. Try a shorter range.")
                        }
                        next.enqueue((samples as? [HKWorkout] ?? []).map { $0.uuid.uuidString }, anchor: next.anchor)
                        try self.persist(next)
                        self.capture(run: run)
                    } catch { self.recordError(error.localizedDescription); self.finish() }
                }
            }
            queries = [query]; store.execute(query); return
        }
        guard let saved = state else { finish(); return }
        do {
            let anchor: HKQueryAnchor?
            if let data = saved.anchor {
                guard let decoded = try NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data) else {
                    throw failure("Could not restore the Health sync cursor.")
                }
                anchor = decoded
            } else { anchor = nil }
            let predicate = HKQuery.predicateForSamples(withStart: saved.since, end: nil, options: .strictStartDate)
            let query = HKAnchoredObjectQuery(type: .workoutType(), predicate: predicate, anchor: anchor, limit: 50) { _, samples, _, nextAnchor, error in
                self.serial.async {
                    guard run == self.version else { return }
                    self.queries.removeAll()
                    do {
                        guard error == nil, let nextAnchor = nextAnchor, var next = self.state else { throw self.failure("Apple Health could not read workouts. Unlock your phone and retry.") }
                        let ids = (samples as? [HKWorkout] ?? []).map { $0.uuid.uuidString }
                        next.enqueue(ids, anchor: try NSKeyedArchiver.archivedData(withRootObject: nextAnchor, requiringSecureCoding: true))
                        try self.persist(next)
                        if (samples?.count ?? 0) == 50 { self.capture(run: run); return }
                        // HealthKit is acknowledged after durable enqueue, independently of network success.
                        self.activeCompletions.forEach { $0() }; self.activeCompletions.removeAll()
                        self.drain(run: run)
                    } catch { self.recordError(error.localizedDescription); self.finish() }
                }
            }
            queries = [query]
            store.execute(query)
        } catch { recordError("Could not restore the Health sync cursor. Reconnect Apple Health."); finish() }
    }

    private func drain(run: Int) {
        guard let id = state?.pending.first(where: { !attempted.contains($0) }), let uuid = UUID(uuidString: id) else { finish(); return }
        attempted.insert(id)
        let query = HKSampleQuery(sampleType: .workoutType(), predicate: HKQuery.predicateForObject(with: uuid), limit: 1, sortDescriptors: nil) { _, samples, error in
            self.serial.async {
                guard run == self.version else { return }
                self.queries.removeAll()
                guard error == nil, let workout = samples?.first as? HKWorkout else {
                    // An empty read may mean denied access or a locked phone. It is never a server acknowledgement.
                    self.recordError("A pending workout could not be read. Unlock your phone and check Health permissions.")
                    self.drain(run: run); return
                }
                self.details(workout, run: run) { result in
                    switch result {
                    case .success(let payload): self.upload(payload, id: id, run: run)
                    case .failure: self.recordError("Apple Health could not read all workout details. Unlock your phone and retry."); self.drain(run: run)
                    }
                }
            }
        }
        queries = [query]; store.execute(query)
    }

    private func details(_ workout: HKWorkout, run: Int, done: @escaping (Result<[String: Any], Error>) -> Void) {
        let formatter = ISO8601DateFormatter()
        var payload: [String: Any] = ["id": workout.uuid.uuidString, "type": sport(workout.workoutActivityType),
            "start": formatter.string(from: workout.startDate), "end": formatter.string(from: workout.endDate),
            "duration_s": workout.duration, "source": String(workout.sourceRevision.source.name.prefix(100)),
            "distance_m": workout.totalDistance?.doubleValue(for: .meter()) ?? 0,
            "calories": workout.totalEnergyBurned?.doubleValue(for: .kilocalorie()) ?? 0]
        if #available(iOS 16.0, *) {
            func metric(_ id: HKQuantityTypeIdentifier, _ key: String, _ unit: HKUnit, maximum: Bool = false, sum: Bool = false) {
                guard let type = HKObjectType.quantityType(forIdentifier: id), let stats = workout.statistics(for: type) else { return }
                let quantity = sum ? stats.sumQuantity() : maximum ? stats.maximumQuantity() : stats.averageQuantity()
                if let value = quantity?.doubleValue(for: unit), value.isFinite { payload[key] = value }
            }
            metric(.stepCount, "steps", .count(), sum: true)
            metric(.activeEnergyBurned, "calories", .kilocalorie(), sum: true)
            if workout.totalDistance == nil {
                switch workout.workoutActivityType {
                case .running, .walking, .hiking: metric(.distanceWalkingRunning, "distance_m", .meter(), sum: true)
                case .cycling: metric(.distanceCycling, "distance_m", .meter(), sum: true)
                case .swimming: metric(.distanceSwimming, "distance_m", .meter(), sum: true)
                default: break
                }
            }
            let speed = HKUnit.meter().unitDivided(by: .second())
            if workout.workoutActivityType == .running {
                metric(.runningPower, "avg_power", .watt())
                metric(.runningPower, "max_power", .watt(), maximum: true)
                metric(.runningSpeed, "max_speed", speed, maximum: true)
                metric(.runningStrideLength, "avg_stride", .meterUnit(with: .milli))
                metric(.runningVerticalOscillation, "avg_vo", .meterUnit(with: .milli))
                metric(.runningGroundContactTime, "avg_gct", .secondUnit(with: .milli))
            }
            if #available(iOS 17.0, *), workout.workoutActivityType == .cycling {
                metric(.cyclingPower, "avg_power", .watt())
                metric(.cyclingPower, "max_power", .watt(), maximum: true)
                metric(.cyclingSpeed, "max_speed", speed, maximum: true)
                metric(.cyclingCadence, "avg_cad", HKUnit.count().unitDivided(by: .minute()))
            }
        }
        if let elevation = workout.metadata?[HKMetadataKeyElevationAscended] as? HKQuantity {
            payload["ascent_m"] = elevation.doubleValue(for: .meter())
        }
        if let elevation = workout.metadata?[HKMetadataKeyElevationDescended] as? HKQuantity {
            payload["descent_m"] = elevation.doubleValue(for: .meter())
        }
        let heart = HKSampleQuery(sampleType: HKObjectType.quantityType(forIdentifier: .heartRate)!,
            predicate: HKQuery.predicateForSamples(withStart: workout.startDate, end: workout.endDate, options: .strictStartDate),
            limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, error in
            self.serial.async {
                guard run == self.version else { return }
                self.queries.removeAll()
                if let error = error { done(.failure(error)); return }
                let unit = HKUnit.count().unitDivided(by: .minute())
                payload["heart_rate"] = (samples as? [HKQuantitySample] ?? []).compactMap { sample -> [String: Any]? in
                    let bpm = sample.quantity.doubleValue(for: unit)
                    return bpm > 20 && bpm < 260 ? ["t": formatter.string(from: sample.startDate), "bpm": bpm] : nil
                }
                self.routes(workout, run: run) { result in
                    switch result {
                    case .success(let points): payload["route"] = points; done(.success(payload))
                    case .failure(let error): done(.failure(error))
                    }
                }
            }
        }
        queries = [heart]; store.execute(heart)
    }

    private func routes(_ workout: HKWorkout, run: Int, done: @escaping (Result<[[String: Any]], Error>) -> Void) {
        let query = HKSampleQuery(sampleType: HKSeriesType.workoutRoute(), predicate: HKQuery.predicateForObjects(from: workout),
            limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, error in
            self.serial.async {
                guard run == self.version else { return }
                self.queries.removeAll()
                if let error = error { done(.failure(error)); return }
                self.routePoints(Array(samples as? [HKWorkoutRoute] ?? []), points: [], run: run, done: done)
            }
        }
        queries = [query]; store.execute(query)
    }

    private func routePoints(_ routes: [HKWorkoutRoute], points: [[String: Any]], run: Int,
                             done: @escaping (Result<[[String: Any]], Error>) -> Void) {
        guard let first = routes.first else { done(.success(points)); return }
        var collected = points
        var ended = false
        let query = HKWorkoutRouteQuery(route: first) { _, locations, complete, error in
            self.serial.async {
                guard run == self.version, !ended else { return }
                if let error = error { ended = true; self.queries.removeAll(); done(.failure(error)); return }
                let formatter = ISO8601DateFormatter()
                collected += (locations ?? []).filter { $0.horizontalAccuracy >= 0 }.map {
                    ["t": formatter.string(from: $0.timestamp), "lat": $0.coordinate.latitude,
                     "lng": $0.coordinate.longitude, "alt": max(-500, min(9000, $0.altitude))] as [String: Any]
                }
                if complete {
                    ended = true; self.queries.removeAll()
                    self.routePoints(Array(routes.dropFirst()), points: collected, run: run, done: done)
                }
            }
        }
        queries = [query]; store.execute(query)
    }

    private func upload(_ payload: [String: Any], id: String, run: Int) {
        guard let credentials = credentials else { finish(); return }
        do {
            var request = URLRequest(url: credentials.server.appendingPathComponent("api/health/workouts"))
            request.httpMethod = "POST"
            request.setValue("Bearer " + credentials.token, forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: ["workouts": [payload]])
            task = session.dataTask(with: request) { data, response, error in
                self.serial.async {
                    guard run == self.version else { return }
                    self.task = nil
                    do {
                        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
                        if code == 401 || code == 403 {
                            if var saved = self.state { saved.needsLogin = true; try self.persist(saved) }
                            throw self.failure("Log in again to resume Apple Health sync. Pending workouts are kept.")
                        }
                        if code == 422 {
                            self.recordError("A workout could not be imported. It stays queued; other workouts can still sync.")
                            self.drain(run: run); return
                        }
                        guard error == nil, (200..<300).contains(code), let data = data,
                              let body = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                              let rawResults = body["results"] as? [[String: Any]], var saved = self.state else {
                            throw self.failure("Workouts are waiting to upload. Kinetta will retry when connected.")
                        }
                        let results = rawResults.map { item in item.compactMapValues { $0 as? String } }
                        guard saved.acknowledge(id: id, results: results) else {
                            self.recordError("Kinetta did not confirm this workout. It stays queued for retry.")
                            self.drain(run: run); return
                        }
                        saved.lastSuccess = Date()
                        if saved.pending.isEmpty { saved.error = nil }
                        try self.persist(saved)
                        self.drain(run: run)
                    } catch { self.recordError(error.localizedDescription); self.finish() }
                }
            }
            task?.resume()
        } catch { recordError("Could not prepare a workout upload. It stays queued."); finish() }
    }

    // Never carry the bearer credential across an HTTP redirect, including redirects to a different host.
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }

    private func recordError(_ message: String) {
        guard var saved = state else { return }
        saved.error = message
        try? persist(saved)
    }

    private func endBackgroundTask() {
        let identifier = backgroundTask; backgroundTask = .invalid
        if identifier != .invalid { DispatchQueue.main.async { UIApplication.shared.endBackgroundTask(identifier) } }
    }

    private func finish() {
        activeCompletions.forEach { $0() }; activeCompletions.removeAll()
        busy = false
        endBackgroundTask()
        if rerun { rerun = false; kick() }
    }

    private func sport(_ type: HKWorkoutActivityType) -> String {
        // Same HealthKit activity names as the foreground Health plugin.
        let names: [UInt: String] = [
            1: "americanFootball",
            2: "archery",
            3: "australianFootball",
            4: "badminton",
            5: "baseball",
            6: "basketball",
            7: "bowling",
            8: "boxing",
            9: "climbing",
            10: "cricket",
            11: "crossTraining",
            12: "curling",
            13: "cycling",
            14: "dance",
            15: "danceInspiredTraining",
            16: "elliptical",
            17: "equestrianSports",
            18: "fencing",
            19: "fishing",
            20: "functionalStrengthTraining",
            21: "golf",
            22: "gymnastics",
            23: "handball",
            24: "hiking",
            25: "hockey",
            26: "hunting",
            27: "lacrosse",
            28: "martialArts",
            29: "mindAndBody",
            30: "mixedMetabolicCardioTraining",
            31: "paddleSports",
            32: "play",
            33: "preparationAndRecovery",
            34: "racquetball",
            35: "rowing",
            36: "rugby",
            37: "running",
            38: "sailing",
            39: "skatingSports",
            40: "snowSports",
            41: "soccer",
            42: "softball",
            43: "squash",
            44: "stairClimbing",
            45: "surfingSports",
            46: "swimming",
            47: "tableTennis",
            48: "tennis",
            49: "trackAndField",
            50: "traditionalStrengthTraining",
            51: "volleyball",
            52: "walking",
            53: "waterFitness",
            54: "waterPolo",
            55: "waterSports",
            56: "wrestling",
            57: "yoga",
            58: "barre",
            59: "coreTraining",
            60: "crossCountrySkiing",
            61: "downhillSkiing",
            62: "flexibility",
            63: "highIntensityIntervalTraining",
            64: "jumpRope",
            65: "kickboxing",
            66: "pilates",
            67: "snowboarding",
            68: "stairs",
            69: "stepTraining",
            70: "wheelchairWalkPace",
            71: "wheelchairRunPace",
            72: "taiChi",
            73: "mixedCardio",
            74: "handCycling",
            75: "discSports",
            76: "fitnessGaming",
            77: "cardioDance",
            78: "socialDance",
            79: "pickleball",
            80: "cooldown",
            82: "swimBikeRun",
            83: "transition",
            84: "underwaterDiving",
            3000: "other"
        ]
        return names[type.rawValue] ?? "other"
    }
}

@objc(KinettaHealthSyncPlugin)
class KinettaHealthSyncPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "KinettaHealthSyncPlugin"
    let jsName = "KinettaHealthSync"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "refresh", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "retry", returnType: CAPPluginReturnPromise)
    ]
    @objc func connect(_ call: CAPPluginCall) {
        HealthBackgroundSync.shared.connect(server: call.getString("server") ?? "", owner: call.getString("owner") ?? "", token: call.getString("token") ?? "") { error in
            if let error = error { call.reject(error.localizedDescription) } else { call.resolve() }
        }
    }
    @objc func disconnect(_ call: CAPPluginCall) {
        HealthBackgroundSync.shared.disconnect { error in
            if let error = error { call.reject(error.localizedDescription) } else { call.resolve() }
        }
    }
    @objc func status(_ call: CAPPluginCall) {
        HealthBackgroundSync.shared.status(owner: call.getString("owner") ?? "") { call.resolve($0) }
    }
    @objc func retry(_ call: CAPPluginCall) { HealthBackgroundSync.shared.start(); call.resolve() }
    @objc override func requestPermissions(_ call: CAPPluginCall) {
        HealthBackgroundSync.shared.requestPermissions { error in
            if let error = error { call.reject(error.localizedDescription) } else { call.resolve() }
        }
    }
    @objc func refresh(_ call: CAPPluginCall) {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let start = formatter.date(from: call.getString("start") ?? ""), let end = formatter.date(from: call.getString("end") ?? "") else {
            call.reject("A valid Health refresh range is required."); return
        }
        HealthBackgroundSync.shared.refresh(owner: call.getString("owner") ?? "", start: start, end: end) { error in
            if let error = error { call.reject(error.localizedDescription) } else { call.resolve() }
        }
    }
}

class KinettaBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() { bridge?.registerPluginInstance(KinettaHealthSyncPlugin()) }
}
