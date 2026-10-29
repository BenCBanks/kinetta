import Capacitor
import UIKit

// WebView glass follows the same accessibility choices as native iOS controls.
@objc(KinettaDisplayPreferencesPlugin)
class KinettaDisplayPreferencesPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "KinettaDisplayPreferencesPlugin"
    let jsName = "KinettaDisplayPreferences"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise)
    ]

    override func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(preferencesChanged),
            name: UIAccessibility.reduceTransparencyStatusDidChangeNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(preferencesChanged),
            name: UIAccessibility.darkerSystemColorsStatusDidChangeNotification, object: nil)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @MainActor private var state: JSObject {
        ["reduceTransparency": UIAccessibility.isReduceTransparencyEnabled,
         "increaseContrast": UIAccessibility.isDarkerSystemColorsEnabled]
    }

    @objc func getState(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(self.state) }
    }

    @objc private func preferencesChanged() {
        DispatchQueue.main.async { self.notifyListeners("changed", data: self.state) }
    }
}
