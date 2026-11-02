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
        NotificationCenter.default.addObserver(self, selector: #selector(preferencesChanged),
            name: UIContentSizeCategory.didChangeNotification, object: nil)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @MainActor private var state: JSObject {
        let traits = bridge?.webView?.traitCollection ?? UITraitCollection.current
        return ["reduceTransparency": UIAccessibility.isReduceTransparencyEnabled,
         "increaseContrast": UIAccessibility.isDarkerSystemColorsEnabled,
         "contentSizeCategory": traits.preferredContentSizeCategory.rawValue,
         "preferredBodyPointSize": Double(UIFont.preferredFont(forTextStyle: .body, compatibleWith: traits).pointSize)]
    }

    @objc func getState(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(self.state) }
    }

    @objc private func preferencesChanged() {
        DispatchQueue.main.async { self.notifyListeners("changed", data: self.state) }
    }
}
