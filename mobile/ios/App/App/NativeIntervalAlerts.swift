import Foundation
import UIKit
import AudioToolbox
import AVFoundation

// These APIs request delivery; they do not prove a person heard or felt it.
// Core Haptics/UI tap generators do not certify locked-screen vibration.
enum NativeIntervalAlerts {
    static var vibrationAvailable: Bool {
        #if targetEnvironment(simulator)
        return false
        #else
        return UIDevice.current.userInterfaceIdiom == .phone
        #endif
    }
    static var capabilities: [String:Any] {
        ["outdoor":true,"minimumIOS":15,"timedBackground":"unverified","voice":"available; locked delivery unverified",
         "vibration":vibrationAvailable ? "device/settings dependent; locked delivery unverified":"unavailable",
         "lockedScreenVerified":false,"indoor":false,
         "limitation":"Physical locked, stationary, interrupted and pocket delivery needs acceptance. Background location is not an arbitrary timer guarantee."]
    }
    static func vibrate(_ completion: @escaping () -> Void) -> Bool {
        guard vibrationAvailable else { return false }
        AudioServicesPlayAlertSoundWithCompletion(kSystemSoundID_Vibrate) { DispatchQueue.main.async { completion() } }
        return true
    }
}
