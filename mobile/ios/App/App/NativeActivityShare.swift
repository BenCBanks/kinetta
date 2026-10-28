import Capacitor
import ImageIO
import UIKit

// Exports only the picture the person previewed. No server access, account tokens or photo-library writes.
@objc(KinettaActivitySharePlugin)
class KinettaActivitySharePlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentInteractionControllerDelegate {
    let identifier = "KinettaActivitySharePlugin"
    let jsName = "KinettaActivityShare"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keepAwake", returnType: CAPPluginReturnPromise)
    ]
    private var awakeBefore: Bool?
    private var pending: CAPPluginCall?
    private var document: UIDocumentInteractionController?
    private var activity: UIActivityViewController?
    private var imageURL: URL?
    private var sending = false
    private var timeout: DispatchWorkItem?
    private static let maxBytes = 8 * 1024 * 1024

    override func load() {
        // A crashed/interrupted share must not retain activity pictures indefinitely.
        if let files = try? FileManager.default.contentsOfDirectory(at: shareDirectory, includingPropertiesForKeys: nil) {
            for file in files { try? FileManager.default.removeItem(at: file) }
        }
    }

    @objc func keepAwake(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { call.resolve(); return }
            if call.getBool("enabled") == true {
                if self.awakeBefore == nil { self.awakeBefore = UIApplication.shared.isIdleTimerDisabled }
                UIApplication.shared.isIdleTimerDisabled = true
            } else if let before = self.awakeBefore {
                UIApplication.shared.isIdleTimerDisabled = before
                self.awakeBefore = nil
            }
            call.resolve()
        }
    }

    private var shareDirectory: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("kinetta-activity-share", isDirectory: true)
    }

    @objc func share(_ call: CAPPluginCall) {
        guard let destination = call.getString("destination"), ["instagram", "system"].contains(destination),
              let text = call.getString("image"), text.count <= 12 * 1024 * 1024,
              text.hasPrefix("data:image/png;base64,"),
              let data = Data(base64Encoded: String(text.dropFirst("data:image/png;base64,".count))),
              !data.isEmpty, data.count <= Self.maxBytes,
              let source = CGImageSourceCreateWithData(data as CFData, nil),
              CGImageSourceGetCount(source) == 1,
              CGImageSourceGetType(source) as String? == "public.png",
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int,
              width > 0, height > 0, width <= 4096, height <= 4096, width * height <= 16_777_216,
              let image = UIImage(data: data) else {
            call.reject("That activity picture couldn’t be opened"); return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let controller = self.bridge?.viewController,
                  controller.viewIfLoaded?.window != nil else {
                call.reject("Open the activity again to share its picture"); return
            }
            guard self.pending == nil, controller.presentedViewController == nil else {
                call.reject("Finish the open share sheet first"); return
            }
            if destination == "instagram" {
                guard let url = URL(string: "instagram://app"), UIApplication.shared.canOpenURL(url) else {
                    call.reject("Install Instagram to share there, or use Share for another app"); return
                }
                self.shareToInstagram(image, call: call, controller: controller)
            } else {
                self.shareWithSystem(image, call: call, controller: controller)
            }
        }
    }

    private func begin(_ call: CAPPluginCall) {
        pending = call
        let work = DispatchWorkItem { [weak self, weak call] in
            guard let self = self, let call = call, self.pending === call else { return }
            self.finish(["cancelled": true], dismiss: true)
        }
        timeout = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 300, execute: work)
    }

    private func shareWithSystem(_ image: UIImage, call: CAPPluginCall, controller: UIViewController) {
        begin(call)
        var items: [Any] = [image]
        if let value = call.getString("url"), value.count <= 500,
           let link = URL(string: value), link.scheme == "https", link.host != nil,
           link.user == nil, link.password == nil { items.append(link) }
        let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
        sheet.completionWithItemsHandler = { [weak self, weak call] _, completed, _, _ in
            guard let self = self, let call = call, self.pending === call else { return }
            // A completed share is a handoff, never proof that another app published a post.
            self.finish(["handedOff": completed, "cancelled": !completed])
        }
        if let popover = sheet.popoverPresentationController {
            popover.sourceView = controller.view
            popover.sourceRect = CGRect(x: controller.view.bounds.midX, y: controller.view.bounds.midY, width: 1, height: 1)
            popover.permittedArrowDirections = []
        }
        activity = sheet
        controller.present(sheet, animated: true)
    }

    private func shareToInstagram(_ image: UIImage, call: CAPPluginCall, controller: UIViewController) {
        guard let jpeg = image.jpegData(compressionQuality: 0.95), jpeg.count <= Self.maxBytes else {
            call.reject("That activity picture is too large to share"); return
        }
        let file = shareDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension("igo")
        do {
            try FileManager.default.createDirectory(at: shareDirectory, withIntermediateDirectories: true)
            try jpeg.write(to: file, options: [.atomic, .completeFileProtection])
            var protectedFile = file
            var values = URLResourceValues(); values.isExcludedFromBackup = true
            try protectedFile.setResourceValues(values)
        } catch {
            try? FileManager.default.removeItem(at: file)
            call.reject("Couldn’t prepare this picture for Instagram"); return
        }
        begin(call)
        imageURL = file
        let picker = UIDocumentInteractionController(url: file)
        picker.uti = "com.instagram.exclusivegram"
        picker.name = "Activity picture"
        picker.delegate = self
        document = picker
        let rect = CGRect(x: controller.view.bounds.midX, y: controller.view.bounds.midY, width: 1, height: 1)
        if !picker.presentOpenInMenu(from: rect, in: controller.view, animated: true) {
            finish([:], error: "Instagram couldn’t open this picture. Use Share to choose another destination.")
        }
    }

    func documentInteractionController(_ controller: UIDocumentInteractionController, willBeginSendingToApplication application: String?) {
        guard controller === document else { return }
        sending = true
    }

    func documentInteractionController(_ controller: UIDocumentInteractionController, didEndSendingToApplication application: String?) {
        guard controller === document else { return }
        finish(["handedOff": true])
    }

    func documentInteractionControllerDidDismissOpenInMenu(_ controller: UIDocumentInteractionController) {
        // UIKit may dismiss the menu immediately before its handoff delegate notification.
        DispatchQueue.main.async { [weak self] in
            guard let self = self, controller === self.document, !self.sending else { return }
            self.finish(["cancelled": true])
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.finish(["cancelled": true], dismiss: true)
            call.resolve()
        }
    }

    private func finish(_ result: [String: Any], dismiss: Bool = false, error: String? = nil) {
        let call = pending; pending = nil
        timeout?.cancel(); timeout = nil
        if dismiss { document?.dismissMenu(animated: false); activity?.dismiss(animated: false) }
        document?.delegate = nil; document = nil; activity = nil; sending = false
        if let file = imageURL { try? FileManager.default.removeItem(at: file) }
        imageURL = nil
        if let error = error { call?.reject(error) } else { call?.resolve(result) }
    }
}
