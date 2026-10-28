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
    private var clock=TrackMonotonicClock(wallMilliseconds:Date().timeIntervalSince1970*1000,monotonicSeconds:TrackNativeClock.seconds)
    private var instant: Double { clock.at(TrackNativeClock.seconds) }
    private var intervalTimer: DispatchSourceTimer?
    private var lastIntervalWrite=0.0
    private var audioObserver: NSObjectProtocol?

    override private init() {
        super.init();manager.delegate=self
        audioObserver=NotificationCenter.default.addObserver(forName:AVAudioSession.interruptionNotification,object:nil,queue:.main) { [weak self] note in
            guard let self else { return }
            let raw=note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            if raw==AVAudioSession.InterruptionType.began.rawValue {
                NativeTrackVoice.shared.cancel()
                if var next=self.session { next.intervals?.suppress();try? self.files?.save(next);self.session=next }
            } else if let options=note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt,AVAudioSession.InterruptionOptions(rawValue:options).contains(.shouldResume),var next=self.session,next.state=="recording" {
                next.advanceIntervals(at:self.instant,cues:false);next.intervals?.resumed()
                do { try self.files?.save(next);self.session=next;self.deliverIntervals() } catch { self.storageFailed() }
            }
        }
    }
    private func fail(_ text: String) -> NSError { NSError(domain:"KinettaTrack",code:1,userInfo:[NSLocalizedDescriptionKey:text]) }
    private func storage(_ account:String) throws -> TrackRecordingFiles {
        guard !account.isEmpty,account.count<=2000 else {throw fail("Log in before recording.")}
        let base=try FileManager.default.url(for:.applicationSupportDirectory,in:.userDomainMask,appropriateFor:nil,create:true)
        let hash=SHA256.hash(data:Data(account.utf8)).map {String(format:"%02x",$0)}.joined()
        return try TrackRecordingFiles(folder:base.appendingPathComponent("Track/"+hash,isDirectory:true))
    }
    func attach(_ account: String) throws {
        guard !account.isEmpty,account.count<=2000 else { throw fail("Log in before recording.") }
        guard account != owner else { return }
        try detach()
        let nextFiles=try storage(account)
        var restored=try nextFiles.load(owner:account)
        if restored?.state=="recording",restored?.gps==true {
            restored?.recover(at:self.instant)
            if let restored=restored { try nextFiles.save(restored) }
            message="Recording was interrupted. Your recording is kept; resume when ready."
        } else { message="" }
        restored?.intervals?.recovered()
        if nextFiles.recoveredPrevious { message="Recovered the previous valid recording checkpoint. Review the paused workout before resuming." }
        files=nextFiles;session=restored;owner=account
    }
    func detach() throws {
        stopIntervalTimer();NativeTrackVoice.shared.cancel()
        permissionTimeout?.cancel();permissionAction=nil
        let reject=permissionFailure;permissionFailure=nil;reject?("Recording stopped because the account changed.")
        manager.stopUpdatingLocation()
        if var current=session {
            current.advanceIntervals(at:self.instant,cues:false);current.intervals?.suppress()
            current.pause(at:self.instant);session=current
            try files?.save(current)
        }
        session=nil;files=nil;owner=nil
    }
    func detach(account: String) throws {
        guard owner != nil else { return }
        try check(account);try detach()
    }
    func erase(account:String) throws {
        guard owner==nil || owner==account else {throw fail("The recording account changed. Its draft was kept.")}
        permissionTimeout?.cancel();permissionAction=nil
        let reject=permissionFailure;permissionFailure=nil;reject?("The account was deleted.")
        manager.stopUpdatingLocation()
        defer {session=nil;files=nil;owner=nil;message=""}
        // Erasure must not need to decode a damaged journal, or recreate it on a later detach.
        let target:TrackRecordingFiles
        if let files {target=files} else {target=try storage(account)}
        try target.clear()
    }
    func check(_ account: String, id: String? = nil) throws {
        guard account==owner else { throw fail("The recording account changed. Reopen Track.") }
        if let id=id,session?.id != id { throw fail("The recording changed. Reopen Track before continuing.") }
    }
    func begin(account: String, id: String, sport: String, label: String, kind: String?, gps: Bool,
               voice: Bool = false, autoPause: Bool = false, splitMetres: Double = 1000, routePlan:TrackRoutePlan? = nil,
               intervals: IntervalPin? = nil, intervalVoice: Bool = true, intervalVibration: Bool = false,
               completion: @escaping (Error?) -> Void) {
        do {
            try check(account)
            guard session==nil else { throw fail("Finish or discard the existing recording first.") }
            guard UUID(uuidString:id) != nil,["run","ride","walk","hike","swim","row","ski","workout","other"].contains(sport),
                  !label.isEmpty,label.count<=60,(kind?.count ?? 0)<=60 else { throw fail("Choose a valid activity.") }
            if let routePlan,(!routePlan.valid || !gps) {throw fail("Open and review a valid outdoor route before starting.")}
            if let intervals {
                _=try intervals.expanded()
                guard gps,["run","walk"].contains(sport) else { throw fail("Intervals need an outdoor Run or Walk.") }
            }
            let action={
                do {
                    try self.check(account)
                    guard self.session==nil else { throw self.fail("Another recording has already started.") }
                    self.clock=TrackMonotonicClock(wallMilliseconds:Date().timeIntervalSince1970*1000,monotonicSeconds:TrackNativeClock.seconds)
                    let now=self.instant
                    var next=TrackRecordingState(owner:account,id:id,sport:sport,label:label,sportLabel:kind,gps:gps,start:now,activeAt:now,checkpoint:now)
                    next.routePlan=routePlan
                    if gps {
                        next.voice=voice;next.autoPause=autoPause;next.splits=[];next.autoMs=0;next.lastMove=now
                        next.splitMetres=splitMetres==1609.344 ? 1609.344 : 1000
                    }
                    if let intervals { next.intervals=try IntervalState(pin:intervals,voice:intervalVoice,vibration:intervalVibration && NativeIntervalAlerts.vibrationAvailable) }
                    guard let files=self.files else { throw self.fail("Recording storage is unavailable.") }
                    try files.save(next,resetPoints:true);self.session=next
                    self.startGPS()
                    if intervals != nil && intervalVibration && !NativeIntervalAlerts.vibrationAvailable {self.message += " · Vibration unavailable; spoken and on-screen guidance continue according to your settings."}
                    self.startIntervalTimer();self.deliverIntervals();completion(nil)
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
        try check(account,id:id);manager.stopUpdatingLocation();stopIntervalTimer();NativeTrackVoice.shared.cancel()
        guard var next=session else { return }
        next.advanceIntervals(at:self.instant,cues:false);next.intervals?.suppress()
        next.pause(at:self.instant);session=next;message="Paused";try files?.save(next)
    }
    func resume(account: String, id: String, completion: @escaping (Error?) -> Void) {
        do {
            try check(account,id:id)
            guard let current=session else { throw fail("No recording to resume.") }
            authorize(gps:current.gps,action:{
                do {
                    try self.check(account,id:id)
                    guard var next=self.session else { throw self.fail("No recording to resume.") }
                    next.advanceIntervals(at:self.instant,cues:false)
                    next.resume(at:self.instant);next.intervals?.resumed()
                    try self.files?.save(next);self.session=next;self.startGPS();self.startIntervalTimer();self.deliverIntervals();completion(nil)
                } catch { completion(error) }
            },completion:completion)
        } catch { completion(error) }
    }
    func finish(account: String, id: String) throws {
        try pause(account:account,id:id)
        guard var next=session,next.seconds(at:self.instant)>=1 else { throw fail("Record at least one second before finishing.") }
        let elapsed=next.seconds(at:self.instant)
        next.intervals?.end(at:elapsed,reason:"finished")
        next.state="review";next.finishedAt=self.instant;try files?.save(next);session=next;message="Ready to save"
    }
    func clear(account: String, id: String, intervalResultSaved: Bool = false, discardIntervals: Bool = false) throws {
        try check(account,id:id)
        guard session?.intervals==nil || intervalResultSaved || discardIntervals else {throw fail("Update the app before clearing private interval results. Your recording draft is kept.")}
        manager.stopUpdatingLocation();stopIntervalTimer();NativeTrackVoice.shared.cancel();try files?.clear();session=nil;message=""
    }
    func snapshot(account: String, id: String?, since: Int) throws -> [String:Any] {
        try check(account)
        guard let session=session else { return ["session":NSNull(),"message":message,"routePlanSupport":1] }
        let offset=id==session.id && since<=session.points.count ? max(0,since) : 0
        var partial=session;partial.points=Array(session.points.dropFirst(offset))
        var result=try JSONSerialization.jsonObject(with:JSONEncoder().encode(partial)) as! [String:Any]
        if offset>0 {result.removeValue(forKey:"routePlan")} else if session.routePlan==nil {result["routePlan"]=NSNull()}
        result["pointOffset"]=offset
        result["activeSeconds"]=session.seconds(at:self.instant)
        result["elapsedSeconds"]=max(session.seconds(at:self.instant),((session.finishedAt ?? self.instant)-session.start)/1000)
        result["autoPausedNow"]=session.autoPaused(at:self.instant)
        return ["session":result,"message":message,"routePlanSupport":1]
    }
    private func startIntervalTimer() {
        stopIntervalTimer()
        guard session?.state=="recording",session?.intervals?.status=="running" else { return }
        let timer=DispatchSource.makeTimerSource(queue:.main)
        timer.schedule(deadline:.now()+0.1,repeating:.milliseconds(100),leeway:.milliseconds(20))
        timer.setEventHandler { [weak self] in self?.intervalTick() };intervalTimer=timer;timer.resume()
    }
    private func stopIntervalTimer() { intervalTimer?.cancel();intervalTimer=nil }
    private func intervalTick() {
        guard var next=session,next.state=="recording",next.intervals?.status=="running" else { stopIntervalTimer();return }
        let sequence=next.intervals?.revision
        next.advanceIntervals(at:instant)
        let changed=sequence != next.intervals?.revision
        do {
            if changed || instant-lastIntervalWrite>=15000 {
                next.checkpoint=instant;try files?.save(next);lastIntervalWrite=instant
            }
            session=next
            if changed { deliverIntervals() }
            if next.intervals?.status != "running" { stopIntervalTimer() }
        } catch { storageFailed() }
    }
    private func storageFailed() {
        manager.stopUpdatingLocation();stopIntervalTimer();NativeTrackVoice.shared.cancel()
        if var next=session { next.intervals?.suppress();next.pause(at:instant);session=next;try? files?.save(next) }
        message="Recording paused: device storage could not save interval progress. Your last durable draft is kept."
    }
    private func acknowledgeInterval(_ sequence: Int, owner account: String, id: String, channel: String, outcome: String) {
        guard owner==account,var next=session,next.id==id,next.state=="recording",var intervals=next.intervals,
              intervals.revision==sequence,let i=intervals.effects.indices.last else { return }
        if channel=="voice" && intervals.effects[i].voice=="attempted" { intervals.effects[i].voice=outcome;intervals.effects[i].voice_ack_time=next.seconds(at:instant) }
        else if channel=="vibration" && intervals.effects[i].vibration=="attempted" { intervals.effects[i].vibration=outcome;intervals.effects[i].vibration_ack_time=next.seconds(at:instant) }
        else { return }
        next.intervals=intervals
        do { try files?.save(next);session=next } catch { storageFailed() }
    }
    private func deliverIntervals() {
        guard let account=owner,var next=session,next.state=="recording",var intervals=next.intervals,
              let i=intervals.effects.indices.last else { return }
        let sequence=intervals.effects[i].sequence,id=next.id
        let voice=intervals.effects[i].voice=="pending",vibration=intervals.effects[i].vibration=="pending"
        if !voice && !vibration { return }
        let attemptedAt=next.seconds(at:instant)
        if voice { intervals.effects[i].voice="attempted";intervals.effects[i].voice_attempt_time=attemptedAt }
        if vibration { intervals.effects[i].vibration=NativeIntervalAlerts.vibrationAvailable ? "attempted":"unsupported";if NativeIntervalAlerts.vibrationAvailable { intervals.effects[i].vibration_attempt_time=attemptedAt } }
        next.intervals=intervals
        do { try files?.save(next);session=next } catch { storageFailed();return }
        if voice {
            let ok=NativeTrackVoice.shared.say(intervals.instruction()) { [weak self] in
                self?.acknowledgeInterval(sequence,owner:account,id:id,channel:"voice",outcome:"completed")
            }
            if !ok { acknowledgeInterval(sequence,owner:account,id:id,channel:"voice",outcome:"failed") }
        }
        if vibration && NativeIntervalAlerts.vibrationAvailable {
            _=NativeIntervalAlerts.vibrate { [weak self] in self?.acknowledgeInterval(sequence,owner:account,id:id,channel:"vibration",outcome:"completed") }
        }
    }
    func intervalControl(account: String,id: String,method: String,phase: String?,voice: Bool?,vibration: Bool?) throws {
        try check(account,id:id)
        guard var next=session,next.state != "review",next.intervals != nil else { throw fail("No active interval session.") }
        let elapsed=next.seconds(at:instant)
        switch method {
        case "skip":
            guard phase==next.intervals?.current?.key else { throw fail("The step changed. Review the current step before skipping.") }
            NativeTrackVoice.shared.cancel();next.intervals?.skip(at:elapsed)
        case "end":NativeTrackVoice.shared.cancel();next.intervals?.end(at:elapsed,reason:"ended")
        case "alerts":
            guard let voice,let vibration else { throw fail("Choose both alert settings.") }
            NativeTrackVoice.shared.cancel();next.intervals?.suppress();next.intervals?.voice=voice;next.intervals?.vibration=vibration && NativeIntervalAlerts.vibrationAvailable
            if vibration && !NativeIntervalAlerts.vibrationAvailable {message="Vibration unavailable; spoken and on-screen guidance continue according to your settings."}
            if next.state=="recording" { next.intervals?.resumed() }
        default:throw fail("Unknown interval control.")
        }
        if next.state != "recording" { next.intervals?.suppress() }
        try files?.save(next);session=next;deliverIntervals()
        if next.intervals?.status != "running" { stopIntervalTimer() }
    }
    func testIntervals(account: String,voice: Bool,vibration: Bool) throws -> String {
        try check(account)
        guard session==nil,UIApplication.shared.applicationState == .active else { throw fail("Test alerts in the foreground before starting a recording.") }
        guard voice || vibration else { throw fail("Choose Voice or Vibration before testing alerts.") }
        if !voice && vibration && !NativeIntervalAlerts.vibrationAvailable { throw fail("Vibration is unavailable here. Turn Voice on to test spoken prompts.") }
        if voice && !NativeTrackVoice.shared.say("Interval test. Run, then walk.",completion:{}) { throw fail("Voice is unavailable or interrupted.") }
        if vibration && NativeIntervalAlerts.vibrationAvailable {_=NativeIntervalAlerts.vibrate({})}
        if vibration && !NativeIntervalAlerts.vibrationAvailable {return "Voice test requested. Optional vibration is unavailable here. Confirm what you heard; this does not verify a locked phone."}
        return "Foreground requests sent. Confirm what you heard or felt; this does not verify a locked phone."
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
        let hadIntervals=next.intervals?.status=="running"
        do {
            for location in locations.sorted(by: { $0.timestamp<$1.timestamp }) {
                if next.points.count>=TrackRecordingState.maxPoints {
                    next.advanceIntervals(at:self.instant,cues:false);next.intervals?.suppress()
                    stopIntervalTimer();NativeTrackVoice.shared.cancel()
                    next.pause(at:self.instant);manager.stopUpdatingLocation();message="GPS limit reached. Finish and save this recording.";break
                }
                var candidate=next;let before=next.splits?.count ?? 0
                if let point=candidate.accept(lat:location.coordinate.latitude,lon:location.coordinate.longitude,accuracy:location.horizontalAccuracy,
                                               timestamp:clock.locationTime(timestamp:location.timestamp.timeIntervalSince1970*1000,wallNow:Date().timeIntervalSince1970*1000,monotonicNow:TrackNativeClock.seconds),now:self.instant,
                                               alt:location.altitude,valt:location.verticalAccuracy) {
                    if candidate.intervals?.status=="running",candidate.anchor?.t==point.t {
                        let sample=IntervalSample(time:candidate.seconds(at:candidate.start+point.t*1000),distance:candidate.distance,segment:point.segment)
                        candidate.advanceIntervals(at:self.instant,accepted:sample)
                    }
                    try files?.append(point);next=candidate
                    if !hadIntervals,next.voice==true,let splits=next.splits,splits.count>before { NativeTrackVoice.shared.announce(next) }
                    message="GPS ±\(Int(location.horizontalAccuracy)) m · background recording on"
                } else if location.horizontalAccuracy>100 { message="Weak GPS signal · waiting for better accuracy" }
            }
            // Point journal is already durable. Manifest commits capture only small state, never rewrite the route.
            try files?.save(next);session=next;deliverIntervals()
        } catch {
            manager.stopUpdatingLocation();stopIntervalTimer();NativeTrackVoice.shared.cancel();next.intervals?.suppress();next.pause(at:self.instant);session=next
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
    private var callbacks:[ObjectIdentifier:() -> Void]=[:]
    override private init() { super.init();synth.delegate=self;synth.usesApplicationAudioSession=true }
    func cancel() {
        callbacks.removeAll();synth.stopSpeaking(at:.immediate)
        try? AVAudioSession.sharedInstance().setActive(false,options:.notifyOthersOnDeactivation)
    }
    @discardableResult func say(_ text: String,completion: @escaping () -> Void) -> Bool {
        cancel()
        let audio=AVAudioSession.sharedInstance()
        do { try audio.setCategory(.playback,mode:.voicePrompt,options:[.duckOthers,.interruptSpokenAudioAndMixWithOthers]);try audio.setActive(true) }
        catch { return false }
        let utterance=AVSpeechUtterance(string:text);callbacks[ObjectIdentifier(utterance)]=completion;synth.speak(utterance);return true
    }
    func announce(_ state: TrackRecordingState) { if let text=NativeTrackVoiceText.text(state) { say(text,completion:{}) } }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer,didFinish utterance: AVSpeechUtterance) {
        let callback=callbacks.removeValue(forKey:ObjectIdentifier(utterance));callback?()
        if !synthesizer.isSpeaking { try? AVAudioSession.sharedInstance().setActive(false,options:.notifyOthersOnDeactivation) }
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer,didCancel utterance: AVSpeechUtterance) { callbacks.removeValue(forKey:ObjectIdentifier(utterance)) }
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
    func locate(quiet:Bool=false,_ done: @escaping (Result<CLLocation,Error>) -> Void) {
        guard CLLocationManager.locationServicesEnabled() else { done(.failure(fail("Location Services are off. Enable them in iPhone Settings.")));return }
        if quiet && ![CLAuthorizationStatus.authorizedAlways,.authorizedWhenInUse].contains(manager.authorizationStatus) {done(.failure(fail("Location has not been allowed yet.")));return}
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
    let pluginMethods: [CAPPluginMethod] = ["attach","start","status","pause","resume","finish","clear","detach","erase","locate","intervalCapabilities","intervalTest","intervalSkip","intervalEnd","intervalAlerts"].map { CAPPluginMethod(name:$0,returnType:CAPPluginReturnPromise) }
    // Only a position for the preview map: nothing is stored or sent to the server.
    @objc func locate(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            NativeTrackLocator.shared.locate(quiet:call.getBool("quiet") ?? false) { result in
                switch result {
                case .success(let l): call.resolve(["lat":l.coordinate.latitude,"lon":l.coordinate.longitude,"accuracy":l.horizontalAccuracy,"timestamp":l.timestamp.timeIntervalSince1970*1000])
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
    @objc func intervalCapabilities(_ call: CAPPluginCall) {
        DispatchQueue.main.async { do { try NativeTrackRecorder.shared.check(call.getString("owner") ?? "");call.resolve(["intervalCapabilities":NativeIntervalAlerts.capabilities]) } catch { call.reject(error.localizedDescription) } }
    }
    @objc func intervalTest(_ call: CAPPluginCall) {
        DispatchQueue.main.async { do { let text=try NativeTrackRecorder.shared.testIntervals(account:call.getString("owner") ?? "",voice:call.getBool("voice") ?? false,vibration:call.getBool("vibration") ?? false);call.resolve(["intervalTest":text]) } catch { call.reject(error.localizedDescription) } }
    }
    private func interval(_ call: CAPPluginCall,method: String) { reply(call) { r,owner in try r.intervalControl(account:owner,id:call.getString("id") ?? "",method:method,phase:call.getString("phase_key"),voice:call.getBool("voice"),vibration:call.getBool("vibration")) } }
    @objc func intervalSkip(_ call: CAPPluginCall) { interval(call,method:"skip") }
    @objc func intervalEnd(_ call: CAPPluginCall) { interval(call,method:"end") }
    @objc func intervalAlerts(_ call: CAPPluginCall) { interval(call,method:"alerts") }
    @objc func attach(_ call: CAPPluginCall) { reply(call) { r,owner in try r.attach(owner) } }
    @objc func status(_ call: CAPPluginCall) { reply(call) { r,owner in try r.check(owner) } }
    @objc func pause(_ call: CAPPluginCall) { reply(call) { r,owner in try r.pause(account:owner,id:call.getString("id") ?? "") } }
    @objc func finish(_ call: CAPPluginCall) { reply(call) { r,owner in try r.finish(account:owner,id:call.getString("id") ?? "") } }
    @objc func clear(_ call: CAPPluginCall) { reply(call) { r,owner in try r.clear(account:owner,id:call.getString("id") ?? "",intervalResultSaved:call.getBool("intervalResultSaved") ?? false,discardIntervals:call.getBool("discardIntervals") ?? false) } }
    @objc func erase(_ call: CAPPluginCall) {
        DispatchQueue.main.async {do {try NativeTrackRecorder.shared.erase(account:call.getString("owner") ?? "");call.resolve()} catch {call.reject(error.localizedDescription)}}
    }
    @objc func detach(_ call: CAPPluginCall) {
        DispatchQueue.main.async { do { try NativeTrackRecorder.shared.detach(account:call.getString("owner") ?? "");call.resolve() } catch { call.reject(error.localizedDescription) } }
    }
    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let r=NativeTrackRecorder.shared,owner=call.getString("owner") ?? ""
            let plan:TrackRoutePlan?
            do {
                if let value=call.getObject("routePlan") {
                    let data=try JSONSerialization.data(withJSONObject:value)
                    guard data.count<=600000 else {call.reject("The recording metadata is too large.");return}
                    let decoded=try JSONDecoder().decode(TrackRoutePlan.self,from:data)
                    guard decoded.valid else {call.reject("Review this route again before starting.");return}
                    plan=decoded
                } else {plan=nil}
            } catch {call.reject("Review this route again before starting.");return}
            var pin:IntervalPin?
            if let raw=call.getObject("intervals") {
                do { pin=try JSONDecoder().decode(IntervalPin.self,from:JSONSerialization.data(withJSONObject:raw)) }
                catch { call.reject("Review a complete supported interval preset before Start.");return }
            }
            r.begin(account:owner,id:call.getString("id") ?? "",sport:call.getString("sport") ?? "",label:call.getString("label") ?? "",kind:call.getString("sportLabel"),gps:call.getBool("gps") ?? false,
                    voice:call.getBool("voice") ?? false,autoPause:call.getBool("autoPause") ?? false,splitMetres:call.getDouble("splitMetres") ?? 1000,routePlan:plan,intervals:pin,intervalVoice:call.getBool("intervalVoice") ?? true,intervalVibration:call.getBool("intervalVibration") ?? false) { error in
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
