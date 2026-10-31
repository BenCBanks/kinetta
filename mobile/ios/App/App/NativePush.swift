import Foundation

// Keep old app builds on the ordinary detail URL; only a matching optional URL
// can opt an updated app into the existing owner-only editor.
enum NativeNotificationPath {
    static func resolve(url: String?, editURL: String?) -> String? {
        guard let url = url else { return nil }
        guard url.range(of: "\\A/activity/[1-9][0-9]*\\z", options: .regularExpression) != nil,
              editURL == url + "?edit=1" else { return url }
        return editURL
    }
}

#if canImport(UIKit)
import UIKit
import UserNotifications
import Capacitor

// Installed at launch so a notification tap survives a cold start until the logged-in web app is ready.
final class NativePushCenter: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NativePushCenter()
    weak var plugin: KinettaPushPlugin?
    var pendingURL: String?
    var pendingServer: String?
    private(set) var externalEntry = false
    private var pendingExternalEntry = false

    func markExternalEntry() {
        externalEntry = true
        pendingExternalEntry = UIApplication.shared.applicationState != .active
        plugin?.notifyListeners("externalEntryOpened", data: [:])
    }
    func beginForegroundEntry() {
        externalEntry = pendingExternalEntry
        pendingExternalEntry = false
    }
    func becameActive() { pendingExternalEntry = false }

    private(set) var tokenRevision = 0
    private var lastToken: Data?
    private var pendingToken: Data?
    private let buildKey = "kinetta.push.registeredBuild"
    private var build: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "" }
    private var environment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }
    private func publish(_ token: Data) {
        guard let plugin = plugin else { pendingToken = token; return }
        pendingToken = nil
        plugin.notifyListeners("tokenChanged", data: ["token": token.map { String(format: "%02x", $0) }.joined(),
                                                    "environment": environment, "revision": tokenRevision], retainUntilConsumed: true)
    }
    func attach(_ plugin: KinettaPushPlugin) {
        self.plugin = plugin
        if let token = pendingToken { publish(token) }
    }

    var registration: ((Result<Data, Error>) -> Void)?

    func start() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        // An update may rotate the token before the web app opens its first page. Never prompt at launch.
        guard UserDefaults.standard.string(forKey: buildKey) != build else { return }
        center.getNotificationSettings { settings in
            guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
        }
    }
    func registered(_ token: Data) {
        let callback = registration; registration = nil
        let changed = lastToken != token
        if changed { tokenRevision += 1 }
        lastToken = token
        UserDefaults.standard.set(build, forKey: buildKey)
        if let callback = callback { pendingToken = nil; callback(.success(token)) }
        else if changed { publish(token) }
    }
    func failed(_ error: Error) {
        let callback = registration; registration = nil
        callback?(.failure(error))
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound, .badge])
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        DispatchQueue.main.async {
            self.markExternalEntry()
            let data = response.notification.request.content.userInfo
            if let path = NativeNotificationPath.resolve(url: data["url"] as? String, editURL: data["edit_url"] as? String),
               path.hasPrefix("/"), !path.hasPrefix("//"), !path.contains(":") {
                self.pendingURL = path
                self.pendingServer = nil
                self.plugin?.notifyListeners("notificationOpened", data: [:])
            }
        }
        completionHandler()
    }
}

@objc(KinettaPushPlugin)
class KinettaPushPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "KinettaPushPlugin"
    let jsName = "KinettaPush"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "register", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unregister", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takePending", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBadge", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise)
    ]
    override func load() { NativePushCenter.shared.attach(self) }
    @objc func status(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let allowed = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
            DispatchQueue.main.async {
                call.resolve(["allowed": allowed, "denied": settings.authorizationStatus == .denied,
                              "externalEntry": NativePushCenter.shared.externalEntry])
            }
        }
    }
    @objc func register(_ call: CAPPluginCall) {
        let request = call.getBool("request") ?? false
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let allowed = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
            if allowed { self.registerDevice(call); return }
            guard request, settings.authorizationStatus == .notDetermined else {
                call.reject("Allow Kinetta notifications in iPhone Settings."); return
            }
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
                if let error = error { call.reject(error.localizedDescription); return }
                guard granted else { call.reject("Notifications were not allowed."); return }
                self.registerDevice(call)
            }
        }
    }
    private func registerDevice(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard NativePushCenter.shared.registration == nil else {
                call.reject("Notification registration is already running."); return
            }
            let timeout = DispatchWorkItem {
                NativePushCenter.shared.registration = nil
                call.reject("Apple notification registration timed out. Try again.")
            }
            NativePushCenter.shared.registration = { result in
                timeout.cancel()
                switch result {
                case .success(let token):
                    #if DEBUG
                    let environment = "sandbox"
                    #else
                    let environment = "production"
                    #endif
                    call.resolve(["token": token.map { String(format: "%02x", $0) }.joined(), "environment": environment, "revision": NativePushCenter.shared.tokenRevision])
                case .failure(let error): call.reject(error.localizedDescription)
                }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: timeout)
            UIApplication.shared.registerForRemoteNotifications()
        }
    }
    @objc func unregister(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            UIApplication.shared.unregisterForRemoteNotifications()
            NativePushCenter.shared.pendingURL = nil
            NativePushCenter.shared.pendingServer = nil
            UNUserNotificationCenter.current().removeAllDeliveredNotifications()
            call.resolve()
        }
    }
    // The app icon's number follows the unread count; 0 clears it once notifications are read.
    @objc func setBadge(_ call: CAPPluginCall) {
        let count = max(0, call.getInt("count") ?? 0)
        DispatchQueue.main.async {
            if #available(iOS 16.0, *) {
                UNUserNotificationCenter.current().setBadgeCount(count) { _ in call.resolve() }
            } else {
                UIApplication.shared.applicationIconBadgeNumber = count
                call.resolve()
            }
        }
    }
    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else { call.reject("Open iPhone Settings, then Kinetta."); return }
            UIApplication.shared.open(url) { opened in
                if opened { call.resolve() } else { call.reject("Open iPhone Settings, then Kinetta.") }
            }
        }
    }
    @objc func takePending(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let path = NativePushCenter.shared.pendingURL
            let server = NativePushCenter.shared.pendingServer
            NativePushCenter.shared.pendingURL = nil
            NativePushCenter.shared.pendingServer = nil
            call.resolve(["url": path ?? "", "server": server ?? "", "externalEntry": NativePushCenter.shared.externalEntry])
        }
    }
}
#endif
