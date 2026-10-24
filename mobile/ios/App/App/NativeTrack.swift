import Foundation
import CoreLocation
import CryptoKit
import UIKit
import Capacitor
import AVFoundation

// Core Location owns the recorder, not a JavaScript timer. It continues with the screen locked or another app open.
final class NativeTrackRecorder: NSObject, CLLocationManagerDelegate {
    static let shared=NativeTrackRecorder()
    private let manager=CLLocationManager()
    private var owner: String?
    private var files: TrackRecordingFiles?
    private var session: TrackRecordingState?
    private var permissionAction: (() -> Void)?
    private var permissionFailure: ((String) -> Void)?
    private var permissionTimeout: DispatchWorkItem?
    private(set) var message=""
    static var now: Double { Date().timeIntervalSince1970*1000 }
    override private init() { super.init();manager.delegate=self }
    private func fail(_ text: String) -> NSError { NSError(domain:"KinettaTrack",code:1,userInfo:[NSLocalizedDescriptionKey:text]) }
    func attach(_ account: String) throws {
        guard !account.isEmpty,account.count<=2000 else { throw fail("Log in before recording.") }
        guard account != owner else { return }
        try detach()
        let base=try FileManager.default.url(for:.applicationSupportDirectory,in:.userDomainMask,appropriateFor:nil,create:true)
        let hash=SHA256.hash(data:Data(account.utf8)).map { String(format:"%02x",$0) }.joined()
        let nextFiles=try TrackRecordingFiles(folder:base.appendingPathComponent("Track/"+hash,isDirectory:true))
        var restored=try nextFiles.load(owner:account)
        if restored?.state=="recording",restored?.gps==true {
            restored?.recover(at:Self.now)
            if let restored=restored { try nextFiles.save(restored) }
            message="Recording was interrupted. Your saved route is kept; resume when ready."
        } else { message="" }
        files=nextFiles;session=restored;owner=account
    }
    func detach() throws {
        permissionTimeout?.cancel();permissionAction=nil
        let reject=permissionFailure;permissionFailure=nil;reject?("Recording stopped because the account changed.")
        manager.stopUpdatingLocation()
        if var current=session {
            current.pause(at:Self.now);session=current
            try files?.save(current)
        }
        session=nil;files=nil;owner=nil
    }
    func detach(account: String) throws {
        guard owner != nil else { return }
        try check(account);try detach()
    }
    func check(_ account: String, id: String? = nil) throws {
        guard account==owner else { throw fail("The recording account changed. Reopen Track.") }
        if let id=id,session?.id != id { throw fail("The recording changed. Reopen Track before continuing.") }
    }
    func begin(account: String, id: String, sport: String, label: String, kind: String?, gps: Bool,
               voice: Bool = false, autoPause: Bool = false, splitMetres: Double = 1000,
               completion: @escaping (Error?) -> Void) {
        do {
            try check(account)
            guard session==nil else { throw fail("Finish or discard the existing recording first.") }
            guard UUID(uuidString:id) != nil,["run","ride","walk","hike","swim","row","ski","workout","other"].contains(sport),
                  !label.isEmpty,label.count<=60,(kind?.count ?? 0)<=60 else { throw fail("Choose a valid activity.") }
            let action={
                do {
                    try self.check(account)
                    guard self.session==nil else { throw self.fail("Another recording has already started.") }
                    let now=Self.now
                    var next=TrackRecordingState(owner:account,id:id,sport:sport,label:label,sportLabel:kind,gps:gps,start:now,activeAt:now,checkpoint:now)
                    if gps {
                        next.voice=voice;next.autoPause=autoPause;next.splits=[];next.autoMs=0;next.lastMove=now
                        next.splitMetres=splitMetres==1609.344 ? 1609.344 : 1000
                    }
                    try self.files?.save(next,resetPoints:true);self.session=next
                    self.startGPS();completion(nil)
                } catch { completion(error) }
            }
            authorize(gps:gps,action:action,completion:completion)
        } catch { completion(error) }
    }
    private func authorize(gps: Bool, action: @escaping () -> Void, completion: @escaping (Error?) -> Void) {
        if !gps { action();return }
        guard CLLocationManager.locationServicesEnabled() else { completion(fail("Location Services are off. Enable them in iPhone Settings."));return }
        switch manager.authorizationStatus {
        case .authorizedAlways,.authorizedWhenInUse: action()
        case .notDetermined:
            guard permissionAction==nil else { completion(fail("A location request is already open."));return }
            permissionAction=action;permissionFailure={ completion(self.fail($0)) }
            let timeout=DispatchWorkItem { self.permissionAction=nil;self.permissionFailure=nil;completion(self.fail("Location permission timed out. Try again.")) }
            permissionTimeout=timeout;DispatchQueue.main.asyncAfter(deadline:.now()+90,execute:timeout)
            manager.requestWhenInUseAuthorization()
        default: completion(fail("Allow precise location for Kinetta in iPhone Settings, or choose an indoor timer."))
        }
    }
    private func startGPS() {
        guard session?.state=="recording" else { return }
        guard session?.gps==true else { message="Timer running · continues with the screen locked";return }
        manager.desiredAccuracy=kCLLocationAccuracyBest;manager.distanceFilter=5
        manager.activityType = .fitness
        manager.pausesLocationUpdatesAutomatically=false
        manager.allowsBackgroundLocationUpdates=true
        manager.showsBackgroundLocationIndicator=true
        manager.startUpdatingLocation()
        message="Finding GPS · background recording on"
    }
    func pause(account: String, id: String) throws {
        try check(account,id:id);manager.stopUpdatingLocation()
        guard var next=session else { return };next.pause(at:Self.now);session=next;message="Paused";try files?.save(next)
    }
    func resume(account: String, id: String, completion: @escaping (Error?) -> Void) {
        do {
            try check(account,id:id)
            guard let current=session else { throw fail("No recording to resume.") }
            authorize(gps:current.gps,action:{
                do {
                    try self.check(account,id:id)
                    guard var next=self.session else { throw self.fail("No recording to resume.") }
                    next.resume(at:Self.now);try self.files?.save(next);self.session=next;self.startGPS();completion(nil)
                } catch { completion(error) }
            },completion:completion)
        } catch { completion(error) }
    }
    func finish(account: String, id: String) throws {
        try pause(account:account,id:id)
        guard var next=session,next.seconds(at:Self.now)>=1 else { throw fail("Record at least one second before finishing.") }
        next.state="review";next.finishedAt=Self.now;try files?.save(next);session=next;message="Ready to save"
    }
    func clear(account: String, id: String) throws {
        try check(account,id:id);manager.stopUpdatingLocation();try files?.clear();session=nil;message=""
    }
    func snapshot(account: String, id: String?, since: Int) throws -> [String:Any] {
        try check(account)
        guard let session=session else { return ["session":NSNull(),"message":message] }
        let offset=id==session.id ? min(session.points.count,max(0,since)) : 0
        var partial=session;partial.points=Array(session.points.dropFirst(offset))
        var result=try JSONSerialization.jsonObject(with:JSONEncoder().encode(partial)) as! [String:Any]
        result["pointOffset"]=offset
        return ["session":result,"message":message]
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status=manager.authorizationStatus
        if status == .authorizedAlways || status == .authorizedWhenInUse {
            permissionTimeout?.cancel();let action=permissionAction;permissionAction=nil;permissionFailure=nil;action?()
        } else if status == .denied || status == .restricted {
            permissionTimeout?.cancel();permissionAction=nil;let reject=permissionFailure;permissionFailure=nil
            reject?("Location permission denied. Allow precise location in iPhone Settings or use a timer.")
            if let account=owner,let id=session?.id,session?.gps==true { try? pause(account:account,id:id);message="Location permission stopped. Your draft is kept." }
        }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard var next=session,next.state=="recording",next.gps else { return }
        do {
            for location in locations.sorted(by: { $0.timestamp<$1.timestamp }) {
                if next.points.count>=24000 {
                    next.pause(at:Self.now);manager.stopUpdatingLocation();message="GPS limit reached. Finish and save this recording.";break
                }
                var candidate=next;let before=next.splits?.count ?? 0
                if let point=candidate.accept(lat:location.coordinate.latitude,lon:location.coordinate.longitude,accuracy:location.horizontalAccuracy,
                                               timestamp:location.timestamp.timeIntervalSince1970*1000,now:Self.now) {
                    try files?.append(point);next=candidate
                    if next.voice==true,let splits=next.splits,splits.count>before { NativeTrackVoice.shared.announce(next) }
                    message="GPS ±\(Int(location.horizontalAccuracy)) m · background recording on"
                } else if location.horizontalAccuracy>100 { message="Weak GPS signal · waiting for better accuracy" }
            }
            // Point journal is already durable. Manifest commits capture only small state, never rewrite the route.
            try files?.save(next);session=next
        } catch {
            manager.stopUpdatingLocation();next.pause(at:Self.now);session=next
            message="Recording paused: device storage could not save the route. Free some space before resuming."
            try? files?.save(next)
        }
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if (error as? CLError)?.code == .locationUnknown { message="GPS temporarily unavailable · retrying";return }
        if let account=owner,let id=session?.id { try? pause(account:account,id:id) }
        message="GPS stopped. Your draft is kept. Check location settings and resume."
    }
}

// Spoken split times (#234 item 4), even with the phone locked in a pocket: music dips while it speaks, then comes back.
final class NativeTrackVoice: NSObject, AVSpeechSynthesizerDelegate {
    static let shared=NativeTrackVoice()
    private let synth=AVSpeechSynthesizer()
    override private init() { super.init();synth.delegate=self }
    func announce(_ state: TrackRecordingState) {
        guard let text=NativeTrackVoiceText.text(state) else { return }
        let audio=AVAudioSession.sharedInstance()
        try? audio.setCategory(.playback,mode:.voicePrompt,options:[.duckOthers,.interruptSpokenAudioAndMixWithOthers])
        try? audio.setActive(true)
        synth.speak(AVSpeechUtterance(string:text))
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        if !synthesizer.isSpeaking { try? AVAudioSession.sharedInstance().setActive(false,options:.notifyOthersOnDeactivation) }
    }
}

// One position for the map before Start. A separate manager, so it can never disturb a recording. iOS asks for
// permission once (unless the person picks "Allow Once"); the WebView's own location API would ask again every launch.
final class NativeTrackLocator: NSObject, CLLocationManagerDelegate {
    static let shared=NativeTrackLocator()
    private let manager=CLLocationManager()
    private var waiting: [(Result<CLLocation,Error>) -> Void]=[]
    private var timeout: DispatchWorkItem?
    override private init() { super.init();manager.delegate=self;manager.desiredAccuracy=kCLLocationAccuracyNearestTenMeters }
    private func fail(_ text: String) -> NSError { NSError(domain:"KinettaTrack",code:2,userInfo:[NSLocalizedDescriptionKey:text]) }
    func locate(_ done: @escaping (Result<CLLocation,Error>) -> Void) {
        guard CLLocationManager.locationServicesEnabled() else { done(.failure(fail("Location Services are off. Enable them in iPhone Settings.")));return }
        // A fix from the last minute is good enough to centre the map, and shows at once.
        if let last=manager.location,last.timestamp.timeIntervalSinceNow > -60,last.horizontalAccuracy>=0,last.horizontalAccuracy<=100 { done(.success(last));return }
        waiting.append(done)
        guard waiting.count==1 else { return }
        let work=DispatchWorkItem { self.finish(.failure(self.fail("GPS did not answer. Move into the open and tap Locate me."))) }
        timeout=work;DispatchQueue.main.asyncAfter(deadline:.now()+20,execute:work)
        ask()
    }
    private func ask() {
        switch manager.authorizationStatus {
        case .authorizedAlways,.authorizedWhenInUse: manager.requestLocation()
        case .notDetermined: manager.requestWhenInUseAuthorization()   // answered in locationManagerDidChangeAuthorization
        default: finish(.failure(fail("Allow location for Kinetta in iPhone Settings to see where you are.")))
        }
    }
    private func finish(_ result: Result<CLLocation,Error>) {
        timeout?.cancel();timeout=nil
        let callbacks=waiting;waiting=[];callbacks.forEach { $0(result) }
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard !waiting.isEmpty,manager.authorizationStatus != .notDetermined else { return }
        ask()
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        if let best=locations.last { finish(.success(best)) }
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if (error as? CLError)?.code == .locationUnknown { return }   // still trying; the timeout ends the wait
        finish(.failure(fail("Location unavailable. Check location settings and tap Locate me.")))
    }
}

@objc(KinettaTrackPlugin)
class KinettaTrackPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier="KinettaTrackPlugin"
    let jsName="KinettaTrack"
    let pluginMethods: [CAPPluginMethod] = ["attach","start","status","pause","resume","finish","clear","detach","locate"].map { CAPPluginMethod(name:$0,returnType:CAPPluginReturnPromise) }
    // Only a position for the preview map: nothing is stored or sent to the server.
    @objc func locate(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            NativeTrackLocator.shared.locate { result in
                switch result {
                case .success(let l): call.resolve(["lat":l.coordinate.latitude,"lon":l.coordinate.longitude,"accuracy":l.horizontalAccuracy])
                case .failure(let error): call.reject(error.localizedDescription)
                }
            }
        }
    }
    private func reply(_ call: CAPPluginCall, _ operation: @escaping (NativeTrackRecorder,String) throws -> Void) {
        DispatchQueue.main.async {
            do {
                let recorder=NativeTrackRecorder.shared,owner=call.getString("owner") ?? ""
                try operation(recorder,owner)
                call.resolve(try recorder.snapshot(account:owner,id:call.getString("id"),since:call.getInt("since") ?? 0))
            } catch { call.reject(error.localizedDescription) }
        }
    }
    @objc func attach(_ call: CAPPluginCall) { reply(call) { r,owner in try r.attach(owner) } }
    @objc func status(_ call: CAPPluginCall) { reply(call) { r,owner in try r.check(owner) } }
    @objc func pause(_ call: CAPPluginCall) { reply(call) { r,owner in try r.pause(account:owner,id:call.getString("id") ?? "") } }
    @objc func finish(_ call: CAPPluginCall) { reply(call) { r,owner in try r.finish(account:owner,id:call.getString("id") ?? "") } }
    @objc func clear(_ call: CAPPluginCall) { reply(call) { r,owner in try r.clear(account:owner,id:call.getString("id") ?? "") } }
    @objc func detach(_ call: CAPPluginCall) {
        DispatchQueue.main.async { do { try NativeTrackRecorder.shared.detach(account:call.getString("owner") ?? "");call.resolve() } catch { call.reject(error.localizedDescription) } }
    }
    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let r=NativeTrackRecorder.shared,owner=call.getString("owner") ?? ""
            r.begin(account:owner,id:call.getString("id") ?? "",sport:call.getString("sport") ?? "",label:call.getString("label") ?? "",kind:call.getString("sportLabel"),gps:call.getBool("gps") ?? false,
                    voice:call.getBool("voice") ?? false,autoPause:call.getBool("autoPause") ?? false,splitMetres:call.getDouble("splitMetres") ?? 1000) { error in
                if let error=error { call.reject(error.localizedDescription);return }
                do { call.resolve(try r.snapshot(account:owner,id:nil,since:0)) } catch { call.reject(error.localizedDescription) }
            }
        }
    }
    @objc func resume(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let r=NativeTrackRecorder.shared,owner=call.getString("owner") ?? ""
            r.resume(account:owner,id:call.getString("id") ?? "") { error in
                if let error=error { call.reject(error.localizedDescription);return }
                do { call.resolve(try r.snapshot(account:owner,id:call.getString("id"),since:call.getInt("since") ?? 0)) } catch { call.reject(error.localizedDescription) }
            }
        }
    }
}
