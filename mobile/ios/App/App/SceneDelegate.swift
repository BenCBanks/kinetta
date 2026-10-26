import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        if !connectionOptions.urlContexts.isEmpty || !connectionOptions.userActivities.isEmpty || connectionOptions.notificationResponse != nil || connectionOptions.shortcutItem != nil {
            NativePushCenter.shared.markExternalEntry()
        }
        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = KinettaBridgeViewController()
        window?.makeKeyAndVisible()
        if connectionOptions.shortcutItem?.type == NativeFoodEntryCenter.quickAction {
            try? NativeFoodEntryCenter.shared.add(text:nil,source:.quickAction)
        }

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
        connectionOptions.userActivities.forEach(openLink)
    }

    // A friend's invite link (https://login.kinetta.app/add/<code>, 2026-10-26) opens here instead of Safari. It goes
    // through the same pending path a notification tap uses, so the app shows it once it's ready and signed in.
    private func openLink(_ activity: NSUserActivity) {
        guard activity.activityType == NSUserActivityTypeBrowsingWeb, let url = activity.webpageURL,
              url.path.range(of: "^/add/[A-Za-z0-9_-]{1,40}$", options: .regularExpression) != nil else { return }
        NativePushCenter.shared.pendingURL = url.path
        NativePushCenter.shared.plugin?.notifyListeners("notificationOpened", data: [:])
    }

    func windowScene(_ windowScene: UIWindowScene,performActionFor shortcutItem: UIApplicationShortcutItem,completionHandler: @escaping (Bool) -> Void) {
        NativePushCenter.shared.markExternalEntry()
        guard shortcutItem.type == NativeFoodEntryCenter.quickAction else { completionHandler(false);return }
        do { try NativeFoodEntryCenter.shared.add(text:nil,source:.quickAction);completionHandler(true) }
        catch { completionHandler(false) }
    }

    func sceneWillEnterForeground(_ scene: UIScene) { NativePushCenter.shared.beginForegroundEntry() }
    func sceneDidBecomeActive(_ scene: UIScene) {
        NativePushCenter.shared.becameActive()
        HealthBackgroundSync.shared.start()
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        NativePushCenter.shared.markExternalEntry()
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        NativePushCenter.shared.markExternalEntry()
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
        openLink(userActivity)
    }
}
