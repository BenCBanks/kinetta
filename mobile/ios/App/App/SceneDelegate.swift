import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = KinettaBridgeViewController()
        window?.makeKeyAndVisible()
        if connectionOptions.shortcutItem?.type == NativeFoodEntryCenter.quickAction {
            try? NativeFoodEntryCenter.shared.add(text:nil,source:.quickAction)
        }

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func windowScene(_ windowScene: UIWindowScene,performActionFor shortcutItem: UIApplicationShortcutItem,completionHandler: @escaping (Bool) -> Void) {
        guard shortcutItem.type == NativeFoodEntryCenter.quickAction else { completionHandler(false);return }
        do { try NativeFoodEntryCenter.shared.add(text:nil,source:.quickAction);completionHandler(true) }
        catch { completionHandler(false) }
    }

    func sceneDidBecomeActive(_ scene: UIScene) { HealthBackgroundSync.shared.start() }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
