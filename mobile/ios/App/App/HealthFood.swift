import Foundation
import HealthKit
import CryptoKit
import Capacitor

// No credentials or networking. The signed-in WebView supplies authenticated server
// pages and acknowledges a weight anchor only after the server accepts that batch.
final class HealthFood {
    static let shared = HealthFood()
    private let serial = DispatchQueue(label: "app.kinetta.health-food")
    private let store = HKHealthStore()
    private var owner: String?
    private var state: HealthFoodState?
    private var generation = 0
    private var query: HKQuery?
    private var weightDone: ((Result<[String:Any],Error>) -> Void)?
    private var pendingAnchor: (String, Data)?
    private var writing = false
    private var stopWaiters: [() -> Void] = []
    private var permissionBusy = false // main-thread only
    private var file: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("HealthFood/state.json")
    }
    private let types: [(String, HKQuantityTypeIdentifier)] = [
        ("kcal", .dietaryEnergyConsumed), ("protein_g", .dietaryProtein),
        ("carbs_g", .dietaryCarbohydrates), ("fat_g", .dietaryFatTotal), ("fiber_g", .dietaryFiber)]
    private func failure(_ text: String) -> NSError {
        NSError(domain: "KinettaHealthFood", code: 1, userInfo: [NSLocalizedDescriptionKey:text])
    }
    private func check(_ expected: String, _ version: Int? = nil) throws {
        guard !expected.isEmpty, owner == expected, state?.owner == expected,
              version == nil || version == generation else { throw HealthFoodError.changed }
    }
    private func persist() throws {
        guard let state = state else { return }
        let folder = file.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories:true,
            attributes:[.protectionKey:FileProtectionType.completeUntilFirstUserAuthentication])
        var url = folder; var resource = URLResourceValues(); resource.isExcludedFromBackup = true
        try url.setResourceValues(resource)
        try JSONEncoder().encode(state).write(to:file,options:[.atomic,.completeFileProtectionUntilFirstUserAuthentication])
    }
    func bind(_ expected: String, done: @escaping (Error?) -> Void) {
        serial.async {
            do {
                guard !expected.isEmpty, expected.count <= 2048 else { throw HealthFoodError.invalid }
                guard self.owner == nil || self.owner == expected else { throw self.failure("Stop Health sharing before changing accounts.") }
                if self.owner == nil {
                    var saved = HealthFoodState(owner:expected)
                    if FileManager.default.fileExists(atPath:self.file.path) {
                        let previous = try JSONDecoder().decode(HealthFoodState.self,from:Data(contentsOf:self.file))
                        if previous.owner == expected { saved = previous }
                    }
                    self.state = saved; self.owner = expected; try self.persist()
                }
                done(nil)
            } catch { done(error) }
        }
    }
    func stop(clear: Bool, done: @escaping () -> Void) {
        serial.async {
            self.generation += 1; self.owner = nil; self.pendingAnchor = nil
            if let query = self.query { self.store.stop(query) }; self.query = nil
            let finish = self.weightDone; self.weightDone = nil; finish?(.failure(HealthFoodError.changed))
            self.state = nil
            if clear { try? FileManager.default.removeItem(at:self.file) }
            // HealthKit mutations already submitted cannot be cancelled. Wait for
            // that one callback before allowing logout/account replacement to finish.
            if self.writing { self.stopWaiters.append(done) } else { done() }
        }
    }
    func request(owner expected: String, nutrition: Bool, done: @escaping (Error?) -> Void) {
        serial.async {
            do { try self.check(expected) } catch { done(error); return }
            let version = self.generation
            DispatchQueue.main.async {
                guard !self.permissionBusy else { done(self.failure("Finish the open Health permission screen first.")); return }
                guard HKHealthStore.isHealthDataAvailable(), let weight = HKObjectType.quantityType(forIdentifier:.bodyMass) else {
                    done(self.failure("Apple Health is unavailable on this device.")); return
                }
                self.permissionBusy = true
                let write = Set(self.types.compactMap { HKObjectType.quantityType(forIdentifier:$0.1) })
                self.store.requestAuthorization(toShare:nutrition ? write : [], read:nutrition ? [] : [weight]) { success,error in
                    DispatchQueue.main.async { self.permissionBusy = false }
                    self.serial.async {
                        do { try self.check(expected,version) } catch { done(error); return }
                        done(error ?? (success ? nil : self.failure("Health permissions could not be requested.")))
                    }
                }
            }
        }
    }
    private func allowed() -> [String] {
        types.compactMap { key,id in
            guard let type = HKObjectType.quantityType(forIdentifier:id), store.authorizationStatus(for:type) == .sharingAuthorized else { return nil }
            return key
        }
    }
    func status(owner expected: String, epoch: String, done: @escaping (Result<[String:Any],Error>) -> Void) {
        serial.async {
            do {
                try self.check(expected)
                guard UUID(uuidString:epoch) != nil else { throw HealthFoodError.invalid }
                let allowed = self.allowed()
                self.state?.prepareNutrition(epoch:epoch,permissions:allowed.joined(separator:","));try self.persist()
                done(.success(["cursor":self.state?.nutritionCursor ?? 0,"allowed":allowed,
                    "blocked":HealthFoodDay.fields.filter { !allowed.contains($0) }]))
            } catch { done(.failure(error)) }
        }
    }
    func readWeight(owner expected: String, epoch: String, done: @escaping (Result<[String:Any],Error>) -> Void) {
        serial.async {
            do {
                try self.check(expected)
                guard self.weightDone == nil, UUID(uuidString:epoch) != nil,
                      let type = HKObjectType.quantityType(forIdentifier:.bodyMass) else { throw HealthFoodError.invalid }
                self.state?.prepareWeight(epoch:epoch);try self.persist()
                var anchor: HKQueryAnchor?
                if let data = self.state?.weightAnchor { anchor = try NSKeyedUnarchiver.unarchivedObject(ofClass:HKQueryAnchor.self,from:data) }
                let version = self.generation
                self.weightDone = done; self.pendingAnchor = nil
                let query = HKAnchoredObjectQuery(type:type,predicate:nil,anchor:anchor,limit:500) { running,samples,deleted,next,error in
                    self.serial.async {
                        guard let callback = self.weightDone, self.query === running else { return }
                        self.weightDone = nil;self.query = nil;self.store.stop(running)
                        do {
                            try self.check(expected,version)
                            if let error = error { throw error }
                            guard let next = next else { throw self.failure("Apple Health returned no weight cursor. Unlock and try again.") }
                            let batch = UUID().uuidString
                            let encoded = try NSKeyedArchiver.archivedData(withRootObject:next,requiringSecureCoding:true)
                            let formatter = ISO8601DateFormatter();formatter.formatOptions = [.withInternetDateTime,.withFractionalSeconds]
                            let rows: [[String:Any]] = (samples ?? []).compactMap { value in
                                guard let sample = value as? HKQuantitySample else { return nil }
                                let kg = sample.quantity.doubleValue(for:.gramUnit(with:.kilo))
                                guard kg.isFinite, kg >= 20, kg <= 400 else { return nil }
                                return ["sample_id":sample.uuid.uuidString,"sampled_at":formatter.string(from:sample.startDate),"kg":kg,
                                    "source_name":sample.sourceRevision.source.name,"source_bundle":sample.sourceRevision.source.bundleIdentifier]
                            }
                            self.pendingAnchor = (batch,encoded)
                            callback(.success(["batch":batch,"observed_at":formatter.string(from:Date()),"samples":rows,
                                "deleted":(deleted ?? []).map { $0.uuid.uuidString },"more":(samples?.count ?? 0)+(deleted?.count ?? 0) >= 500]))
                        } catch { callback(.failure(error)) }
                    }
                }
                self.query = query;self.store.execute(query)
                self.serial.asyncAfter(deadline:.now()+25) {
                    guard self.query === query, let callback = self.weightDone else { return }
                    self.store.stop(query);self.query = nil;self.weightDone = nil
                    callback(.failure(self.failure("Unlock your phone and try reading Health weight again.")))
                }
            } catch { done(.failure(error)) }
        }
    }
    func acknowledgeWeight(owner expected: String, batch: String, done: @escaping (Error?) -> Void) {
        serial.async {
            do {
                try self.check(expected)
                guard let pending = self.pendingAnchor,pending.0 == batch else { throw HealthFoodError.changed }
                self.state?.weightAnchor = pending.1;try self.persist();self.pendingAnchor = nil;done(nil)
            } catch { done(error) }
        }
    }
    func write(owner expected: String, epoch: String, zone: String, next: Int64, rows: [HealthFoodDay], done: @escaping (Error?) -> Void) {
        serial.async {
            do {
                try self.check(expected)
                guard !self.writing, self.state?.nutritionEpoch == epoch, rows.count <= 100,
                      let cursor = self.state?.nutritionCursor, next >= cursor,
                      self.state?.nutritionPermissions == self.allowed().joined(separator:",") else { throw HealthFoodError.changed }
                var previous = cursor
                for row in rows { _ = try row.interval(timeZone:zone);guard row.revision > previous else { throw HealthFoodError.invalid };previous = row.revision }
                guard next == previous else { throw HealthFoodError.invalid }
                let version = self.generation
                let digest = SHA256.hash(data:Data(expected.utf8)).map { String(format:"%02x",$0) }.joined()
                self.writing = true
                func finish(_ error: Error?) {
                    self.writing = false
                    let waiting = self.stopWaiters;self.stopWaiters.removeAll()
                    done(error);for callback in waiting { callback() }
                }
                func operation(_ index: Int) {
                    do {
                        try self.check(expected,version)
                        guard self.state?.nutritionEpoch == epoch,
                              self.state?.nutritionPermissions == self.allowed().joined(separator:",") else { throw HealthFoodError.changed }
                        if index >= rows.count*self.types.count {
                            try self.state?.acknowledgeNutrition(epoch:epoch,cursor:next);try self.persist();finish(nil);return
                        }
                        let row = rows[index/self.types.count], item = self.types[index%self.types.count]
                        guard let type = HKObjectType.quantityType(forIdentifier:item.1) else { throw HealthFoodError.invalid }
                        // A user can grant only some types. Permission changes reset
                        // the cursor on the next status call, replaying old dates.
                        guard self.store.authorizationStatus(for:type) == .sharingAuthorized else { operation(index+1);return }
                        let identity = try row.identifier(ownerDigest:digest,field:item.0)
                        let interval = try row.interval(timeZone:zone)
                        let completion: (Bool,Error?) -> Void = { success,error in
                            self.serial.async {
                                if let error = error { finish(error) }
                                else if !success { finish(self.failure("Nutrition could not be saved to Health. Unlock your phone and sync again.")) }
                                else { operation(index+1) }
                            }
                        }
                        if let value = row.quantity(item.0) {
                            let unit = HKUnit(from:HealthFoodDay.unitSymbols[item.0]!)
                            let sample = HKQuantitySample(type:type,quantity:HKQuantity(unit:unit,doubleValue:value),start:interval.0,end:interval.1,
                                metadata:[HKMetadataKeySyncIdentifier:identity,HKMetadataKeySyncVersion:NSNumber(value:row.revision)])
                            self.store.save(sample,withCompletion:completion)
                        } else {
                            let predicate = NSCompoundPredicate(andPredicateWithSubpredicates:[
                                HKQuery.predicateForObjects(from:HKSource.default()),
                                HKQuery.predicateForObjects(withMetadataKey:HKMetadataKeySyncIdentifier,allowedValues:[identity]),
                                HKQuery.predicateForObjects(withMetadataKey:HKMetadataKeySyncVersion,operatorType:.lessThanOrEqualTo,value:NSNumber(value:row.revision))])
                            self.store.deleteObjects(of:type,predicate:predicate) { success,_,error in completion(success,error) }
                        }
                    } catch { finish(error) }
                }
                operation(0)
            } catch { done(error) }
        }
    }
}

@objc(KinettaHealthFoodPlugin)
class KinettaHealthFoodPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "KinettaHealthFoodPlugin"
    let jsName = "KinettaHealthFood"
    let pluginMethods: [CAPPluginMethod] = ["bind","stop","requestWeightPermission","requestNutritionPermission","status","readWeight","acknowledgeWeight","writeNutrition"].map {
        CAPPluginMethod(name:$0,returnType:CAPPluginReturnPromise)
    }
    private func error(_ call: CAPPluginCall) -> (Error?) -> Void { { e in if let e = e { call.reject(e.localizedDescription) } else { call.resolve() } } }
    private func result(_ call: CAPPluginCall) -> (Result<[String:Any],Error>) -> Void { { r in
        switch r { case .success(let data):call.resolve(data);case .failure(let e):call.reject(e.localizedDescription) }
    } }
    @objc func bind(_ call: CAPPluginCall) { HealthFood.shared.bind(call.getString("owner") ?? "",done:error(call)) }
    @objc func stop(_ call: CAPPluginCall) { HealthFood.shared.stop(clear:call.getBool("clear") ?? false) { call.resolve() } }
    @objc func requestWeightPermission(_ call: CAPPluginCall) { HealthFood.shared.request(owner:call.getString("owner") ?? "",nutrition:false,done:error(call)) }
    @objc func requestNutritionPermission(_ call: CAPPluginCall) { HealthFood.shared.request(owner:call.getString("owner") ?? "",nutrition:true,done:error(call)) }
    @objc func status(_ call: CAPPluginCall) { HealthFood.shared.status(owner:call.getString("owner") ?? "",epoch:call.getString("epoch") ?? "",done:result(call)) }
    @objc func readWeight(_ call: CAPPluginCall) { HealthFood.shared.readWeight(owner:call.getString("owner") ?? "",epoch:call.getString("epoch") ?? "",done:result(call)) }
    @objc func acknowledgeWeight(_ call: CAPPluginCall) { HealthFood.shared.acknowledgeWeight(owner:call.getString("owner") ?? "",batch:call.getString("batch") ?? "",done:error(call)) }
    @objc func writeNutrition(_ call: CAPPluginCall) {
        do {
            guard let values = call.getArray("days",JSObject.self), let next = call.getDouble("next"),next.isFinite,next >= 0,next <= 9_007_199_254_740_991,next.rounded() == next else { throw HealthFoodError.invalid }
            let rows = try JSONDecoder().decode([HealthFoodDay].self,from:JSONSerialization.data(withJSONObject:values))
            HealthFood.shared.write(owner:call.getString("owner") ?? "",epoch:call.getString("epoch") ?? "",zone:call.getString("tz") ?? "",next:Int64(next),rows:rows,done:error(call))
        } catch { call.reject(error.localizedDescription) }
    }
}
