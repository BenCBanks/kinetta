import Capacitor
import ImageIO
import Photos
import UIKit
import WebKit

// Instagram Stories accepts a transparent image as a movable sticker through its
// documented pasteboard handoff. The activity is absent unless this app build has
// a registered Meta App ID and Instagram is installed.
private enum InstagramStoriesHandoff {
    private static let stickerType = "com.instagram.sharedSticker.stickerImage"
    private static var metaAppID: String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "KinettaMetaAppID") as? String else { return nil }
        let id = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty, id.rangeOfCharacter(from: CharacterSet.decimalDigits.inverted) == nil else { return nil }
        return id
    }

    static var isAvailable: Bool {
        guard metaAppID != nil,
              let instagram = URL(string: "instagram://app"),
              let stories = URL(string: "instagram-stories://share") else { return false }
        return UIApplication.shared.canOpenURL(instagram) && UIApplication.shared.canOpenURL(stories)
    }

    static func open(_ image: UIImage, completion: @escaping (Bool) -> Void) {
        guard let appID = metaAppID, isAvailable,
              let png = image.pngData(), !png.isEmpty, png.count <= 8 * 1024 * 1024,
              var components = URLComponents(string: "instagram-stories://share") else {
            completion(false); return
        }
        components.queryItems = [URLQueryItem(name: "source_application", value: appID)]
        guard let destination = components.url else { completion(false); return }

        let pasteboard = UIPasteboard.general
        let previousItems = pasteboard.items
        pasteboard.setItems(
            [[stickerType: png]],
            options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(5 * 60)]
        )
        UIApplication.shared.open(destination, options: [:]) { opened in
            if !opened, pasteboard.items.first?[stickerType] as? Data == png {
                pasteboard.items = previousItems
            }
            completion(opened)
        }
    }
}

private final class InstagramStoriesActivity: UIActivity {
    private var sticker: UIImage?

    override class var activityCategory: UIActivity.Category { .share }
    override var activityType: UIActivity.ActivityType? { UIActivity.ActivityType("com.kinetta.activity-share.instagram-stories") }
    override var activityTitle: String? { "Instagram Stories" }
    override var activityImage: UIImage? { UIImage(systemName: "camera") }

    override func canPerform(withActivityItems activityItems: [Any]) -> Bool {
        InstagramStoriesHandoff.isAvailable && activityItems.contains { $0 is UIImage }
    }

    override func prepare(withActivityItems activityItems: [Any]) {
        sticker = activityItems.compactMap { $0 as? UIImage }.first
    }

    override func perform() {
        guard let image = sticker else { activityDidFinish(false); return }
        InstagramStoriesHandoff.open(image) { self.activityDidFinish($0) }
    }
}

// Exports only the picture the person previewed. No server access, account tokens or photo-library writes.
@objc(KinettaActivitySharePlugin)
class KinettaActivitySharePlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "KinettaActivitySharePlugin"
    let jsName = "KinettaActivityShare"
    let pluginMethods: [CAPPluginMethod] = {
        var methods: [CAPPluginMethod] = [
            CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise),
            CAPPluginMethod(name: "saveToPhotos", returnType: CAPPluginReturnPromise),
            CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
            CAPPluginMethod(name: "keepAwake", returnType: CAPPluginReturnPromise)
        ]
        #if DEBUG
        methods.append(CAPPluginMethod(name: "uiTestMetrics", returnType: CAPPluginReturnPromise))
        #endif
        return methods
    }()
    #if DEBUG
    // The Simulator test copy writes only bounded fictional measurements to its own temporary directory.
    // This method and its registration are absent from production Release builds.
    @objc func uiTestMetrics(_ call: CAPPluginCall) {
        guard let value = call.getString("value"), value.utf8.count <= 65536,
              let data = value.data(using: .utf8),
              var object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              object["fixture"] as? Bool == true else { call.reject("Invalid UI fixture measurements"); return }
        DispatchQueue.main.async { [weak self] in
            guard let web = self?.bridge?.webView, let window = web.window else {
                call.reject("UI fixture window is not ready"); return
            }
            func rect(_ value: CGRect) -> [String: Double] {
                ["x": Double(value.minX), "y": Double(value.minY), "width": Double(value.width), "height": Double(value.height)]
            }
            object["uikit"] = [
                "contentSizeCategory": web.traitCollection.preferredContentSizeCategory.rawValue,
                "preferredBodyPointSize": Double(UIFont.preferredFont(forTextStyle: .body, compatibleWith: web.traitCollection).pointSize),
                "window": rect(window.bounds), "webView": rect(web.convert(web.bounds, to: window)),
                "statusBar": rect(window.windowScene?.statusBarManager?.statusBarFrame ?? .zero),
                "safeTop": Double(window.safeAreaInsets.top),
                "scrollAdjustedTop": Double(web.scrollView.adjustedContentInset.top),
                "scrollContentTop": Double(web.scrollView.contentInset.top),
                "scrollOffsetY": Double(web.scrollView.contentOffset.y)
            ]
            func save() {
                do {
                    let output = try JSONSerialization.data(withJSONObject: object)
                    try output.write(to: FileManager.default.temporaryDirectory.appendingPathComponent("kinetta-ui-metrics.json"), options: .atomic)
                    call.resolve()
                } catch { call.reject("UI fixture measurements could not be saved") }
            }
            #if targetEnvironment(simulator)
            if object["stage"] as? String == "header-me", object["theme"] as? String == "light", object["store"] as? Bool != true {
                // Exercise the real registered bridge in the unsigned Simulator, never a physical phone.
                // The fixture can load the bundled hook before its parallel UI consumer has landed.
                let script = """
                let timer;
                const check = async () => {
                    const c = globalThis.Capacitor;
                    if (!c?.isNativePlatform() || !c.isPluginAvailable('KinettaHaptics'))
                        throw Error('Native haptics unavailable');
                    let hookLoadedBy = 'app';
                    if (!globalThis.Haptics) {
                        hookLoadedBy = 'fixture';
                        await new Promise((resolve, reject) => {
                            const script = document.createElement('script');
                            // Fresh Simulator fixture only; the production loader uses its own asset hash.
                            script.src = '/static/haptics.js';
                            script.onload = resolve;
                            script.onerror = () => reject(Error('Bundled haptics hook missing'));
                            document.head.append(script);
                        });
                    }
                    if (typeof Haptics.react !== 'function' || typeof Haptics.tick !== 'function')
                        throw Error('Reaction haptics hooks missing');
                    await c.Plugins.KinettaHaptics.tap({kind:'light'});
                    await c.Plugins.KinettaHaptics.tap({kind:'selection'});
                    return {available:true, lightResolved:true, selectionResolved:true, hookLoadedBy};
                };
                try {
                    return await Promise.race([check(), new Promise((_, reject) => {
                        timer = setTimeout(() => reject(Error('Haptics bridge timeout')), 2000);
                    })]);
                } finally { clearTimeout(timer); }
                """
                web.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
                    switch result {
                    case .success(let value):
                        if let haptics = value as? [String: Any], haptics["available"] as? Bool == true,
                           haptics["lightResolved"] as? Bool == true, haptics["selectionResolved"] as? Bool == true {
                            object["haptics"] = haptics
                        } else { object["error"] = "Native reaction haptics measurements were incomplete" }
                    case .failure:
                        object["error"] = "Bundled reaction haptics bridge smoke failed"
                    }
                    save()
                }
                return
            }
            #endif
            save()
        }
    }
    #endif

    private var awakeBefore: Bool?
    private var pending: CAPPluginCall?
    private var activity: UIActivityViewController?
    private var timeout: DispatchWorkItem?
    private static let maxBytes = 8 * 1024 * 1024
    private static let maxCaptionCharacters = 1000

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

    @objc func share(_ call: CAPPluginCall) {
        if let caption = call.getString("caption"), caption.count > Self.maxCaptionCharacters {
            call.reject("The sharing caption is too long"); return
        }
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
                if InstagramStoriesHandoff.isAvailable {
                    self.shareToInstagramStories(image, call: call, controller: controller)
                } else {
                    self.shareWithSystem(image, call: call, controller: controller)
                }
            } else {
                self.shareWithSystem(image, call: call, controller: controller)
            }
        }
    }

    @objc func saveToPhotos(_ call: CAPPluginCall) {
        guard let text = call.getString("image"), text.count <= 12 * 1024 * 1024,
              text.hasPrefix("data:image/png;base64,"),
              let data = Data(base64Encoded: String(text.dropFirst("data:image/png;base64,".count))),
              !data.isEmpty, data.count <= Self.maxBytes,
              let source = CGImageSourceCreateWithData(data as CFData, nil),
              CGImageSourceGetCount(source) == 1,
              CGImageSourceGetType(source) as String? == "public.png",
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int,
              width > 0, height > 0, width <= 4096, height <= 4096, width * height <= 16_777_216 else {
            call.reject("That activity picture couldn’t be opened"); return
        }
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized else {
                call.reject("Allow Kinetta to add pictures to Photos to save this image"); return
            }
            PHPhotoLibrary.shared().performChanges({
                let request = PHAssetCreationRequest.forAsset()
                let options = PHAssetResourceCreationOptions()
                options.originalFilename = "Kinetta-activity.png"
                request.addResource(with: .photo, data: data, options: options)
            }) { saved, error in
                if saved { call.resolve(["saved": true]) }
                else { call.reject("Couldn’t save this picture to Photos", nil, error) }
            }
        }
    }

    private func begin(_ call: CAPPluginCall) {
        pending = call
        timeout?.cancel()
        let work = DispatchWorkItem { [weak self, weak call] in
            guard let self = self, let call = call, self.pending === call else { return }
            self.finish(["cancelled": true], dismiss: true)
        }
        timeout = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 300, execute: work)
    }

    private func shareWithSystem(_ image: UIImage, call: CAPPluginCall, controller: UIViewController) {
        if pending !== call { begin(call) }
        var items: [Any] = [image]
        if let caption = call.getString("caption"), !caption.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            items.append(caption)
        } else if let value = call.getString("url"), value.count <= 500,
           let link = URL(string: value), link.scheme == "https", link.host != nil,
           link.user == nil, link.password == nil { items.append(link) }
        let sheet = UIActivityViewController(activityItems: items, applicationActivities: [InstagramStoriesActivity()])
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

    private func shareToInstagramStories(_ image: UIImage, call: CAPPluginCall, controller: UIViewController) {
        begin(call)
        InstagramStoriesHandoff.open(image) { [weak self, weak call, weak controller] opened in
            guard let self, let call, self.pending === call else { return }
            if opened { self.finish(["handedOff": true]) }
            else if let controller { self.shareWithSystem(image, call: call, controller: controller) }
            else { self.finish(["cancelled": true]) }
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
        if dismiss { activity?.dismiss(animated: false) }
        activity = nil
        if let error = error { call?.reject(error) } else { call?.resolve(result) }
    }
}
