import UIKit
import UniformTypeIdentifiers
import Capacitor

// Standard UIKit picker/confirmation only. A document handoff never authorizes upload.
final class NativeStravaImportCenter: NSObject,UIDocumentPickerDelegate {
    static let shared = NativeStravaImportCenter()
    weak var plugin: KinettaStravaImportPlugin?
    private var bound: StravaImportSession?
    private var label = ""
    private var pending: URL?
    private var version = UUID()
    private var showing = false
    private weak var importController: UIViewController?
    private var presenter: UIViewController? { plugin?.bridge?.viewController }
    func bind(_ session: StravaImportSession,label: String,done: @escaping (Error?) -> Void) {
        let stamp = version
        NativeStravaTransfer.shared.bind(session) { error in DispatchQueue.main.async {
            guard self.version == stamp else { done(StravaImportFailure.account);return }
            if error == nil { self.bound = session;self.label = String(label.prefix(80));self.deliver() };done(error)
        }}
    }
    func stop(done: @escaping (Error?) -> Void) {
        DispatchQueue.main.async {
            self.version = UUID();self.bound = nil;if let url = self.pending { self.discardInbox(url) };self.pending = nil
            if self.showing { self.importController?.dismiss(animated:false);self.showing = false }
            NativeStravaTransfer.shared.stop(done:done)
        }
    }
    func receive(_ url: URL) {
        guard url.isFileURL,url.pathExtension.lowercased() == "zip" else { return }
        if isInbox(url) {
            try? FileManager.default.setAttributes([.protectionKey:FileProtectionType.completeUntilFirstUserAuthentication],ofItemAtPath:url.path)
            var local = url,values = URLResourceValues();values.isExcludedFromBackup = true;try? local.setResourceValues(values)
        }
        if let old = pending { discardInbox(old) };pending = url
        if bound != nil { deliver();return }
        // Cold-open waits briefly for the WebView's verified active account. No
        // unowned archive bytes are copied or saved while waiting for sign-in.
        let stamp = version
        DispatchQueue.main.asyncAfter(deadline:.now()+3) {
            guard self.version == stamp,self.bound == nil,self.pending != nil else { return }
            if let url = self.pending { self.discardInbox(url) };self.pending = nil;self.message("Sign in to Kinetta, then open this ZIP again.")
        }
    }
    private func isInbox(_ url: URL) -> Bool {
        guard let documents = FileManager.default.urls(for:.documentDirectory,in:.userDomainMask).first else { return false }
        return url.isFileURL && url.standardizedFileURL.path.hasPrefix(documents.appendingPathComponent("Inbox",isDirectory:true).standardizedFileURL.path+"/")
    }
    private func discardInbox(_ url: URL) { if isInbox(url) { try? FileManager.default.removeItem(at:url) } }
    func resume() { if let who = bound { NativeStravaTransfer.shared.bind(who) { _ in } };deliver() }
    func pick() throws {
        guard bound != nil,!showing,let presenter = presenter,presenter.presentedViewController == nil else { throw StravaImportFailure.account }
        let picker = UIDocumentPickerViewController(forOpeningContentTypes:[.zip],asCopy:false)
        picker.allowsMultipleSelection = false;picker.delegate = self;showing = true;importController = picker;presenter.present(picker,animated:true)
    }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { showing = false }
    func documentPicker(_ controller: UIDocumentPickerViewController,didPickDocumentsAt urls: [URL]) {
        showing = false;guard urls.count == 1,let url = urls.first else { return }
        // Allow UIKit to finish dismissal before presenting the confirmation.
        DispatchQueue.main.async { self.receive(url) }
    }
    private func deliver() {
        guard !showing,let url = pending,let who = bound,let presenter = presenter,presenter.presentedViewController == nil else { return }
        pending = nil;showing = true;let stamp = version
        NativeStravaTransfer.shared.stage(url) { result in DispatchQueue.main.async {
            self.discardInbox(url)
            guard self.version == stamp,self.bound == who else { return }
            self.showing = false
            switch result {
            case .failure(let error):self.message(error is StravaImportFailure ? error.localizedDescription : "This archive could not be copied. Unlock your iPhone and try again.")
            case .success(let row):
                guard presenter.presentedViewController == nil else { return } // Stays staged/unconfirmed; never starts silently.
                self.ask(row,session:who)
            }
        }}
    }
    func reviewStaged() {
        let stamp = version
        NativeStravaTransfer.shared.status { result in DispatchQueue.main.async {
            guard self.version == stamp,let who = self.bound else { return }
            if case .success(let row?) = result,!row.confirmed { self.ask(row,session:who) }
        }}
    }
    private func ask(_ row: StravaImportRecord,session: StravaImportSession) {
        guard !showing,bound == session,let presenter = presenter,presenter.presentedViewController == nil else { return }
        let stamp = version;showing = true
        let size = ByteCountFormatter.string(fromByteCount:row.size,countStyle:.file)
        let alert = UIAlertController(title:"Upload Strava archive?",message:"Upload \(size) to @\(label) on \(session.server)? You can review the results before importing any workouts.",preferredStyle:.alert)
        alert.addAction(UIAlertAction(title:"Cancel",style:.cancel) { _ in
            self.showing = false;guard self.version == stamp,self.bound == session else { return }
            self.stop { _ in self.plugin?.notifyListeners("sessionNeeded",data:[:]) }
        })
        alert.addAction(UIAlertAction(title:"Upload",style:.default) { _ in
            self.showing = false;guard self.version == stamp,self.bound == session else { return }
            NativeStravaTransfer.shared.confirm(id:row.id) { error in
                if let error = error { DispatchQueue.main.async { self.message(error.localizedDescription) } }
            }
        })
        importController = alert;presenter.present(alert,animated:true)
    }
    private func message(_ text: String) {
        guard let presenter = presenter,presenter.presentedViewController == nil else { return }
        let alert = UIAlertController(title:"Strava archive",message:text,preferredStyle:.alert);alert.addAction(UIAlertAction(title:"OK",style:.default));presenter.present(alert,animated:true)
    }
}

@objc(KinettaStravaImportPlugin)
class KinettaStravaImportPlugin: CAPPlugin,CAPBridgedPlugin {
    let identifier = "KinettaStravaImportPlugin",jsName = "KinettaStravaImport"
    let pluginMethods: [CAPPluginMethod] = ["bind","pick","status","stop","review","resume"].map { CAPPluginMethod(name:$0,returnType:CAPPluginReturnPromise) }
    override func load() { DispatchQueue.main.async { NativeStravaImportCenter.shared.plugin = self } }
    @objc func bind(_ call: CAPPluginCall) {
        do {
            let who = try StravaImportSession(server:call.getString("server") ?? "",userID:call.getInt("userID") ?? 0,token:call.getString("token") ?? "")
            NativeStravaImportCenter.shared.bind(who,label:call.getString("login") ?? "your account") { error in
                if let error = error { call.reject(error.localizedDescription) } else { call.resolve() }
            }
        } catch { call.reject(error.localizedDescription) }
    }
    @objc func resume(_ call: CAPPluginCall) { DispatchQueue.main.async { NativeStravaImportCenter.shared.resume();call.resolve() } }
    @objc func pick(_ call: CAPPluginCall) { DispatchQueue.main.async { do { try NativeStravaImportCenter.shared.pick();call.resolve() } catch { call.reject(error.localizedDescription) } } }
    @objc func review(_ call: CAPPluginCall) { DispatchQueue.main.async { NativeStravaImportCenter.shared.reviewStaged();call.resolve() } }
    @objc func status(_ call: CAPPluginCall) {
        NativeStravaTransfer.shared.status { result in
            switch result {
            case .success(let row):let value: [String:Any] = row.map { ["id":$0.id.uuidString.lowercased(),"size":$0.size,"received":$0.received,"state":$0.phase,"confirmed":$0.confirmed] } ?? ["state":"empty"];call.resolve(value)
            case .failure(let error):call.reject(error.localizedDescription)
            }
        }
    }
    @objc func stop(_ call: CAPPluginCall) { NativeStravaImportCenter.shared.stop { error in if let error = error { call.reject(error.localizedDescription) } else { call.resolve() } } }
}
