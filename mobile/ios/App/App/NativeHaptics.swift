import Capacitor
import UIKit

// A light tap under the finger for small confirmations such as sending Cheers (2026-10-16).
// iOS skips it by itself when the person has turned System Haptics off.
@objc(KinettaHapticsPlugin)
class KinettaHapticsPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "KinettaHapticsPlugin"
    let jsName = "KinettaHaptics"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "tap", returnType: CAPPluginReturnPromise)
    ]

    @objc func tap(_ call: CAPPluginCall) {
        let kind = call.getString("kind") ?? "light"
        DispatchQueue.main.async {
            switch kind {
            case "success":
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            case "selection":
                UISelectionFeedbackGenerator().selectionChanged()
            case "medium":
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            default:
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
            }
            call.resolve()
        }
    }
}
