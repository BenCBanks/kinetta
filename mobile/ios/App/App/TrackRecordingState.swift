import Foundation
#if canImport(Darwin)
import Darwin
#endif

// Sleep-inclusive monotonic time, independent of wall-clock corrections. The transform
// is injectable in Foundation tests; wall time remains only the activity's absolute origin.
enum TrackNativeClock {
    static var seconds: Double {
        #if canImport(Darwin)
        var scale=mach_timebase_info_data_t();mach_timebase_info(&scale)
        return Double(mach_continuous_time())*Double(scale.numer)/Double(scale.denom)/1_000_000_000
        #else
        return ProcessInfo.processInfo.systemUptime
        #endif
    }
}
struct TrackMonotonicClock {
    var wallMilliseconds: Double
    var monotonicSeconds: Double
    func at(_ now: Double) -> Double { wallMilliseconds+max(0,now-monotonicSeconds)*1000 }
    func locationTime(timestamp: Double,wallNow: Double,monotonicNow: Double) -> Double { at(monotonicNow)+(timestamp-wallNow) }
}

struct TrackFix: Codable {
    var lat: Double
    var lon: Double
    var t: Double
    var accuracy: Double
    var segment: Int
    var alt: Double? = nil         // metres above sea level (#234 item 5); missing in older journals
    var valt: Double? = nil        // its vertical accuracy
}

// A previously authorized route is pinned with the recording, including its offline line and credits.
// Invalid route metadata can be dropped during recovery without discarding the measured workout journal.
struct TrackRoutePlan: Codable {
    var schema=0
    var kind=""
    var id:Int64=0
    var version=0
    var name=""
    var sport=""
    var distance_m:Double=0
    var line=""
    var snapshot_key:String?
    var warnings:[String]=[]
    var attribution:[String]=[]
    var breaks:[Int]=[]
    var downloadedAt:Double=0
    enum CodingKeys:String,CodingKey { case schema,kind,id,version,name,sport,distance_m,line,snapshot_key,warnings,attribution,breaks,downloadedAt }
    init(from decoder:Decoder) throws {
        guard let c=try? decoder.container(keyedBy:CodingKeys.self) else{return}
        schema=(try? c.decode(Int.self,forKey:.schema)) ?? 0
        kind=(try? c.decode(String.self,forKey:.kind)) ?? ""
        id=(try? c.decode(Int64.self,forKey:.id)) ?? 0
        version=(try? c.decode(Int.self,forKey:.version)) ?? 0
        name=(try? c.decode(String.self,forKey:.name)) ?? ""
        sport=(try? c.decode(String.self,forKey:.sport)) ?? ""
        distance_m=(try? c.decode(Double.self,forKey:.distance_m)) ?? 0
        line=(try? c.decode(String.self,forKey:.line)) ?? ""
        snapshot_key=try? c.decode(String.self,forKey:.snapshot_key)
        warnings=(try? c.decode([String].self,forKey:.warnings)) ?? []
        attribution=(try? c.decode([String].self,forKey:.attribution)) ?? []
        breaks=(try? c.decode([Int].self,forKey:.breaks)) ?? []
        downloadedAt=(try? c.decode(Double.self,forKey:.downloadedAt)) ?? 0
    }
    var valid:Bool {
        guard schema==1,["owned","shared"].contains(kind),id>0,id<=9_007_199_254_740_991,version>0,version<=2_147_483_647,
              !name.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty,name.count<=120,
              ["run","walk","hike","ride"].contains(sport),distance_m.isFinite,distance_m>0,distance_m<=500000,
              line.utf8.count<=400000,warnings.count<=20,warnings.allSatisfy({$0.count<=300}),
              attribution.count<=10,attribution.allSatisfy({$0.count<=300}),downloadedAt.isFinite else{return false}
        if kind=="shared" {guard let k=snapshot_key,k.count==64,k.allSatisfy({"0123456789abcdef".contains($0)}) else{return false}}
        guard let count=pointCount(),breaks.allSatisfy({$0>0 && $0<count}) else{return false}
        return true
    }
    private func pointCount()->Int? {
        let bytes=Array(line.utf8);var i=0,lat=0,lon=0,count=0
        while i<bytes.count {
            var values:[Int]=[]
            for _ in 0..<2 {
                var value=0,shift=0,done=false
                while i<bytes.count && shift<=30 {
                    let b=Int(bytes[i])-63;i+=1
                    guard b>=0 && b<=63 else{return nil}
                    value |= (b & 31)<<shift;shift+=5
                    if b<32 {done=true;break}
                }
                guard done else{return nil}
                values.append((value & 1)==1 ? ~(value>>1) : value>>1)
            }
            lat+=values[0];lon+=values[1];count+=1
            guard abs(lat)<=9_000_000,abs(lon)<=18_000_000,count<=50000 else{return nil}
        }
        return count>=2 ? count:nil
    }
}

// Native time and GPS survive a suspended WebView. Units are milliseconds here, metres for distance.
struct TrackRecordingState: Codable {
    var owner: String
    var id: String
    var sport: String
    var label: String
    var sportLabel: String?
    var gps: Bool
    var start: Double
    var activeAt: Double
    var activeMs: Double = 0
    var checkpoint: Double
    var state = "recording"
    var segment = 0
    var distance: Double = 0
    var points: [TrackFix] = []
    var finishedAt: Double?
    var native = true
    var routePlan:TrackRoutePlan?
    var intervals: IntervalState?
    var anchor: TrackFix?          // the last fix that counted toward distance (missing in older saved recordings: fine)
    // Spoken splits and auto-pause (#234 item 4). Optional so recordings saved by older builds still open.
    var voice: Bool?
    var autoPause: Bool?
    var splitMetres: Double?       // 1609.344 (mile) or 1000 (km), from the account's units
    var splits: [Double]?          // active seconds when each full mile or km was reached
    var autoMs: Double?            // time left out by auto-pause
    var lastMove: Double?          // when you last moved (ms)
    static let autoAfter: Double = 15000

    mutating func advanceIntervals(at now: Double, accepted: IntervalSample? = nil, cues: Bool = true) {
        let elapsed=seconds(at:now),previous=intervals?.time ?? 0
        intervals?.advance(to:max(elapsed,previous),accepted:accepted,cues:cues)
    }
    var maxSpeed: Double { ["run":12.0,"walk":4,"hike":4,"ride":30,"swim":4,"row":8,"ski":40][sport] ?? 30 }
    // Same rule as track.js TrackMath: 15 s without moving stops the clock until you move again, without a jump in the time
    // shown; only the time beyond those 15 s is left out.
    func idle(at now: Double) -> Double {
        guard autoPause == true, state == "recording", let lastMove else { return 0 }
        return max(0, now - lastMove - Self.autoAfter)
    }
    func autoPaused(at now: Double) -> Bool { idle(at: now) > 0 }
    func seconds(at now: Double) -> Double {
        max(0, activeMs + (state == "recording" ? max(0, now - activeAt) : 0) - (autoMs ?? 0) - idle(at: now)) / 1000
    }
    mutating func moved(at time: Double) { autoMs = (autoMs ?? 0) + idle(at: time); lastMove = time }
    mutating func pause(at now: Double) {
        guard state == "recording" else { return }
        autoMs = (autoMs ?? 0) + idle(at: now); lastMove = nil
        activeMs += max(0, now - activeAt); state = "paused"; segment += 1; checkpoint = now
    }
    mutating func resume(at now: Double) {
        guard state != "recording" else { return }
        state = "recording"; activeAt = now; checkpoint = now; finishedAt = nil; lastMove = now
    }
    // Relaunch after termination cannot invent GPS time or connect an unobserved trip.
    mutating func recover(at now: Double) {
        if gps && state == "recording" {
            let last = points.last.map { start + $0.t * 1000 } ?? checkpoint
            pause(at: min(now, max(checkpoint, last)))
        }
    }
    static func metres(_ a: TrackFix, _ b: TrackFix) -> Double {
        let r = Double.pi / 180
        let x = pow(sin((b.lat-a.lat)*r/2),2) + cos(a.lat*r)*cos(b.lat*r)*pow(sin((b.lon-a.lon)*r/2),2)
        return 6371008.8 * 2 * atan2(sqrt(max(0,min(1,x))),sqrt(max(0,1-x)))
    }
    // Same distance rule as the server (analysis.track_step) and the web recorder (#234 item 2): fixes worse than ±25 m
    // draw the map but add nothing, and distance counts only once you've moved further than the GPS error.
    static func step(from anchor: TrackFix?, to point: TrackFix) -> Double? {
        guard point.accuracy <= 25 else { return nil }
        guard let anchor else { return 0 }
        let m = metres(anchor, point)
        return m >= max(5, anchor.accuracy, point.accuracy) ? m : nil
    }
    static func distance(of points: [TrackFix]) -> (Double, TrackFix?) {
        var total = 0.0, anchor: TrackFix? = nil
        for point in points {
            if anchor?.segment != point.segment { anchor = nil }
            if let m = step(from: anchor, to: point) { total += m; anchor = point }
        }
        return (total, anchor)
    }
    static let maxPoints = 72000   // ~360 km at the 5 m distance filter (#234 item 8)
    mutating func accept(lat: Double, lon: Double, accuracy: Double, timestamp: Double, now: Double,
                         alt: Double? = nil, valt: Double? = nil) -> TrackFix? {
        guard state == "recording", gps, points.count < Self.maxPoints,
              [lat,lon,accuracy,timestamp,now].allSatisfy({ $0.isFinite }), abs(lat)<=90, abs(lon)<=180,
              accuracy>=0, accuracy<=100, timestamp>=activeAt, timestamp<=now+1000, now-timestamp<=300000 else { return nil }
        var point = TrackFix(lat:lat,lon:lon,t:(timestamp-start)/1000,accuracy:accuracy,segment:segment)
        if let alt, let valt, alt.isFinite, valt.isFinite, valt > 0, valt <= 1000, alt >= -500, alt <= 9000 { point.alt = alt; point.valt = valt }
        guard point.t>=0, point.t<=172800 else { return nil }
        if let last = points.last {
            guard point.t>last.t else { return nil }
            if last.segment==segment {
                let dt=point.t-last.t, metres=Self.metres(last,point)
                if dt>30 { segment+=1;point.segment=segment }
                else if metres/dt>maxSpeed { return nil }
            }
        }
        if anchor?.segment != point.segment { anchor = nil }     // a new section never adds distance across the gap
        // moving again after a stop: a counted step, or the first fix of a new section (no GPS arrives while you stand still)
        if let m = Self.step(from: anchor, to: point) { distance += m; if m > 0 || !points.isEmpty { moved(at: timestamp) }; anchor = point }
        if let unit = splitMetres, unit > 0 {
            var done = splits ?? []
            while distance >= Double(done.count + 1) * unit { done.append(seconds(at: timestamp)) }
            splits = done
        }
        points.append(point); checkpoint = max(checkpoint,timestamp); return point
    }
}

// What the iPhone says at each split (#234 item 4); NativeTrackVoice in NativeTrack.swift speaks it. Plain Foundation so the
// recorder tests can check the wording.
enum NativeTrackVoiceText {
    static func said(_ seconds: Double) -> String {
        let s=Int(seconds.rounded()),h=s/3600,m=s/60%60,r=s%60
        let parts=[h>0 ? "\(h) hour\(h>1 ? "s":"")" : "",m>0 ? "\(m) minute\(m>1 ? "s":"")" : "",r>0 ? "\(r) second\(r>1 ? "s":"")" : ""].filter { !$0.isEmpty }
        return parts.isEmpty ? "0 seconds" : parts.joined(separator:" ")
    }
    static func text(_ state: TrackRecordingState) -> String? {
        guard let splits=state.splits,let total=splits.last,let unit=state.splitMetres else { return nil }
        let n=splits.count,last=total-(n>1 ? splits[n-2] : 0),name=unit>1500 ? "mile" : "kilometre"
        let lastText=["ride","ski"].contains(state.sport) ? "at \(Int((3600/max(last,1)).rounded())) \(name)s per hour" : said(last)
        return "\(n) \(name)\(n>1 ? "s":""). Time \(said(total)). Last \(name) \(lastText)."
    }
}

// One small atomic manifest plus an append-only point journal. A torn final journal line is ignored on recovery.
final class TrackRecordingFiles {
    let folder: URL
    private var pinnedRecording:String?
    private struct PinnedRoute:Codable {var owner:String;var id:String;var plan:TrackRoutePlan}
    init(folder: URL) throws {
        self.folder=folder
        try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
        #if os(iOS)
        try FileManager.default.setAttributes([.protectionKey:FileProtectionType.completeUntilFirstUserAuthentication],ofItemAtPath:folder.path)
        #endif
        var url=folder;var values=URLResourceValues();values.isExcludedFromBackup=true;try? url.setResourceValues(values)
    }
    private(set) var recoveredPrevious=false
    var manifest: URL { folder.appendingPathComponent("session.json") }
    var previous: URL { folder.appendingPathComponent("previous-session.json") }
    var journal: URL { folder.appendingPathComponent("points.jsonl") }
    var routeFile: URL { folder.appendingPathComponent("route.json") }
    private func write(_ data: Data, to url: URL) throws {
        #if os(iOS)
        try data.write(to:url,options:[.atomic,.completeFileProtectionUntilFirstUserAuthentication])
        #else
        try data.write(to:url,options:.atomic)
        #endif
    }
    func save(_ state: TrackRecordingState, resetPoints: Bool = false) throws {
        if resetPoints { try write(Data(),to:journal) }
        // The large pinned line is written once, rather than at every GPS checkpoint.
        if let plan=state.routePlan {
            if resetPoints || pinnedRecording != state.id {
                try state.intervals?.validateStored()
        // Atomic writes prevent torn JSON; one prior valid interval manifest also survives later corruption.
        if state.intervals != nil,let data=try? Data(contentsOf:manifest),let prior=try? decode(data) {
            if prior.owner==state.owner { try write(data,to:previous) }
        }
        try write(JSONEncoder().encode(metadata),to:manifest)
        #if os(iOS)
        for url in [manifest,journal,previous,routeFile] where FileManager.default.fileExists(atPath:url.path) {
            try FileManager.default.setAttributes([.protectionKey:FileProtectionType.completeUntilFirstUserAuthentication],ofItemAtPath:url.path)
        }
        #endif
    }
    func append(_ point: TrackFix) throws {
        var data=try JSONEncoder().encode(point);data.append(10)
        let file=try FileHandle(forWritingTo:journal);defer { try? file.close() }
        try file.seekToEnd();try file.write(contentsOf:data);try file.synchronize()
    }
    private func decode(_ data: Data) throws -> TrackRecordingState {
        let state=try JSONDecoder().decode(TrackRecordingState.self,from:data)
        try state.intervals?.validateStored();return state
    }
    func load(owner: String) throws -> TrackRecordingState? {
        guard FileManager.default.fileExists(atPath:manifest.path) else { return nil }
        recoveredPrevious=false
        var state:TrackRecordingState
        do { state=try decode(Data(contentsOf:manifest)) }
        catch { state=try decode(Data(contentsOf:previous));recoveredPrevious=true }
        if state.routePlan?.valid==false {state.routePlan=nil}
        guard state.owner==owner else { throw NSError(domain:"KinettaTrack",code:1,userInfo:[NSLocalizedDescriptionKey:"Recording belongs to another account."]) }
        if FileManager.default.fileExists(atPath:routeFile.path) {
            if let data=try? Data(contentsOf:routeFile),let saved=try? JSONDecoder().decode(PinnedRoute.self,from:data),
               saved.owner==owner,saved.id==state.id,saved.plan.valid {
                state.routePlan=saved.plan;pinnedRecording=state.id
            } else {state.routePlan=nil;pinnedRecording=nil}
        }
        if let data=try? Data(contentsOf:journal) {
            // Only complete records count. Partial final bytes cannot erase previous durable fixes.
            if !data.isEmpty && data.last != 10 {
                let validLength=data.lastIndex(of:10).map { $0+1 } ?? 0
                let handle=try FileHandle(forWritingTo:journal);defer { try? handle.close() }
                try handle.truncate(atOffset:UInt64(validLength));try handle.synchronize()
            }
            let rows=data.split(separator:10,omittingEmptySubsequences:false)
            for line in rows.dropLast() where !line.isEmpty {
                guard let fix=try? JSONDecoder().decode(TrackFix.self,from:Data(line)),state.points.count<TrackRecordingState.maxPoints else { break }
                state.points.append(fix)
            }
        }
        // Journal commits can be newer than the manifest; rebuild distance and segment counters from durable fixes.
        (state.distance, state.anchor) = TrackRecordingState.distance(of: state.points)
        if let last=state.points.last { state.segment=max(state.segment,last.segment) }
        return state
    }
    func clear() throws {
        for url in [manifest,journal,previous,routeFile] where FileManager.default.fileExists(atPath:url.path) { try FileManager.default.removeItem(at:url) }
        pinnedRecording=nil
    }
}
