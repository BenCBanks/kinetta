import AuthenticationServices
import Capacitor
import UIKit

// Signing in to another service (Garmin Connect) without leaving the app (2026-10-23, Ben: it ended in Safari, in the web
// version of Kinetta). Apple's sign-in sheet shows the service's page; when Kinetta's callback page sends it on to a
// kinetta:// address, the sheet closes by itself and the app gets that address. The sheet keeps no cookies, so nothing
// is left signed in anywhere else.
@objc(KinettaWebSignInPlugin)
class KinettaWebSignInPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    let identifier = "KinettaWebSignInPlugin"
    let jsName = "KinettaWebSignIn"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise)
    ]
    private var session: ASWebAuthenticationSession?

    @objc func open(_ call: CAPPluginCall) {
        guard let text = call.getString("url"), let url = URL(string: text), url.scheme == "https" else {
            call.reject("That sign-in address isn't valid"); return
        }
        DispatchQueue.main.async {
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "kinetta") { [weak self] result, error in
                self?.session = nil
                if let result = result {
                    call.resolve(["url": result.absoluteString])
                } else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    call.resolve(["cancelled": true])
                } else {
                    call.reject(error?.localizedDescription ?? "Sign-in didn't finish")
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = true
            self.session = session
            if !session.start() {
                self.session = nil
                call.reject("Couldn't open the sign-in sheet")
            }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        bridge?.webView?.window ?? ASPresentationAnchor()
    }
}
