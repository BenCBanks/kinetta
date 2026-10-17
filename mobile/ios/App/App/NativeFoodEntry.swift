import Foundation
import UIKit
import CryptoKit
import Capacitor

// Private app container only: no shared credentials, network or automatic food writes.
final class NativeFoodEntryCenter {
    static let shared = NativeFoodEntryCenter()
    private let serial = DispatchQueue(label:"app.kinetta.food-entry")
    private var boundDigest: String?
    weak var plugin: KinettaFoodEntryPlugin?
    static let quickAction = "com.kinetta.log-food"
    private var file: URL {
        FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("FoodEntry/inbox.json")
    }
    private func digest(_ owner: String) -> String { SHA256.hash(data:Data(owner.utf8)).map { String(format:"%02x",$0) }.joined() }
    private func read() throws -> FoodEntryState {
        guard FileManager.default.fileExists(atPath:file.path) else { throw FoodEntryFailure.signedOut }
        return try JSONDecoder().decode(FoodEntryState.self,from:Data(contentsOf:file))
    }
    private func save(_ state: FoodEntryState) throws {
        let folder = file.deletingLastPathComponent()
        try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true,attributes:[.protectionKey:FileProtectionType.complete])
        var url = folder;var resource = URLResourceValues();resource.isExcludedFromBackup = true;try url.setResourceValues(resource)
        try JSONEncoder().encode(state).write(to:file,options:[.atomic,.completeFileProtection])
    }
    func bind(owner: String) throws {
        try serial.sync {
            guard !owner.isEmpty,owner.count <= 2048 else { throw FoodEntryFailure.signedOut }
            let who = digest(owner)
            var state: FoodEntryState
            if FileManager.default.fileExists(atPath:file.path) {
                let old = try read();state = old.ownerDigest == who ? old : FoodEntryState(ownerDigest:who)
            } else { state = FoodEntryState(ownerDigest:who) }
            state.purge(now:Date());try save(state);boundDigest = who
            DispatchQueue.main.async {
                UIApplication.shared.shortcutItems = [UIApplicationShortcutItem(type:Self.quickAction,localizedTitle:"Log food",localizedSubtitle:nil,icon:UIApplicationShortcutIcon(systemImageName:"fork.knife"),userInfo:nil)]
            }
        }
    }
    func add(text: String?,source: FoodEntryRequest.Source) throws {
        try serial.sync {
            // Intents/cold quick actions may run before the WebView starts. The
            // last signed-in scope can stage locally; fresh server auth is required
            // by the app before it ever delivers a draft to the composer.
            var state = try read();try state.add(text:text,source:source,now:Date());try save(state)
            DispatchQueue.main.async { self.plugin?.notifyListeners("foodEntryReady",data:[:]) }
        }
    }
    func pending(owner: String) throws -> [[String:Any]] {
        try serial.sync {
            let who = digest(owner);guard !owner.isEmpty,boundDigest == who else { throw FoodEntryFailure.signedOut }
            var state = try read();guard state.ownerDigest == who else { throw FoodEntryFailure.signedOut }
            state.purge(now:Date());try save(state)
            return state.requests.map { row in
                var result: [String:Any] = ["id":row.id.uuidString.lowercased(),"source":row.source.rawValue]
                if let text = row.text { result["text"] = text };return result
            }
        }
    }
    func acknowledge(owner: String,id: UUID) throws {
        try serial.sync {
            let who = digest(owner);guard !owner.isEmpty,boundDigest == who else { throw FoodEntryFailure.signedOut }
            var state = try read();guard state.ownerDigest == who else { throw FoodEntryFailure.signedOut }
            state.acknowledge(id);try save(state)
        }
    }
    func stop() throws {
        try serial.sync {
            boundDigest = nil
            if FileManager.default.fileExists(atPath:file.path) { try FileManager.default.removeItem(at:file) }
            DispatchQueue.main.async { UIApplication.shared.shortcutItems = [] }
        }
    }
}

@objc(KinettaFoodEntryPlugin)
class KinettaFoodEntryPlugin: CAPPlugin,CAPBridgedPlugin {
    let identifier = "KinettaFoodEntryPlugin"
    let jsName = "KinettaFoodEntry"
    let pluginMethods: [CAPPluginMethod] = ["bind","pending","acknowledge","stop"].map { CAPPluginMethod(name:$0,returnType:CAPPluginReturnPromise) }
    override func load() { NativeFoodEntryCenter.shared.plugin = self }
    @objc func bind(_ call: CAPPluginCall) {
        do { try NativeFoodEntryCenter.shared.bind(owner:call.getString("owner") ?? "");call.resolve() } catch { call.reject(error.localizedDescription) }
    }
    @objc func pending(_ call: CAPPluginCall) {
        do { call.resolve(["entries":try NativeFoodEntryCenter.shared.pending(owner:call.getString("owner") ?? "")]) } catch { call.reject(error.localizedDescription) }
    }
    @objc func acknowledge(_ call: CAPPluginCall) {
        do {
            guard let id = UUID(uuidString:call.getString("id") ?? "") else { throw FoodEntryFailure.invalid }
            try NativeFoodEntryCenter.shared.acknowledge(owner:call.getString("owner") ?? "",id:id);call.resolve()
        } catch { call.reject(error.localizedDescription) }
    }
    @objc func stop(_ call: CAPPluginCall) {
        do { try NativeFoodEntryCenter.shared.stop();call.resolve() } catch { call.reject(error.localizedDescription) }
    }
}
