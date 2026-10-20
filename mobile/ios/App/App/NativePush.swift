import UIKit
import UserNotifications
import Capacitor

// Installed at launch so a notification tap survives a cold start until the logged-in web app is ready.
final class NativePushCenter: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NativePushCenter()
    weak var plugin: KinettaPushPlugin?
    var pendingURL: String?
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

    var registration: ((Result<Data, Error>) -> Void)?

    func start() { UNUserNotificationCenter.current().delegate = self }
    func registered(_ token: Data) {
        let callback = registration; registration = nil
        callback?(.success(token))
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
            if let path = response.notification.request.content.userInfo["url"] as? String,
               path.hasPrefix("/"), !path.hasPrefix("//"), !path.contains(":") {
                self.pendingURL = path
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
    override func load() { NativePushCenter.shared.plugin = self }
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
                    call.resolve(["token": token.map { String(format: "%02x", $0) }.joined(), "environment": environment])
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
            NativePushCenter.shared.pendingURL = nil
            call.resolve(["url": path ?? "", "externalEntry": NativePushCenter.shared.externalEntry])
        }
    }
}
