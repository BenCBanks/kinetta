import Foundation

struct TrackFix: Codable {
    var lat: Double
    var lon: Double
    var t: Double
    var accuracy: Double
    var segment: Int
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
    var anchor: TrackFix?          // the last fix that counted toward distance (missing in older saved recordings: fine)
    // Spoken splits and auto-pause (#234 item 4). Optional so recordings saved by older builds still open.
    var voice: Bool?
    var autoPause: Bool?
    var splitMetres: Double?       // 1609.344 (mile) or 1000 (km), from the account's units
    var splits: [Double]?          // active seconds when each full mile or km was reached
    var autoMs: Double?            // time left out by auto-pause
    var lastMove: Double?          // when you last moved (ms)
    static let autoAfter: Double = 15000

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
    mutating func accept(lat: Double, lon: Double, accuracy: Double, timestamp: Double, now: Double) -> TrackFix? {
        guard state == "recording", gps, points.count < 24000,
              [lat,lon,accuracy,timestamp,now].allSatisfy({ $0.isFinite }), abs(lat)<=90, abs(lon)<=180,
              accuracy>=0, accuracy<=100, timestamp>=activeAt, timestamp<=now+1000, now-timestamp<=300000 else { return nil }
        var point = TrackFix(lat:lat,lon:lon,t:(timestamp-start)/1000,accuracy:accuracy,segment:segment)
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
    init(folder: URL) throws {
        self.folder=folder
        try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
        #if os(iOS)
        try FileManager.default.setAttributes([.protectionKey:FileProtectionType.completeUntilFirstUserAuthentication],ofItemAtPath:folder.path)
        #endif
        var url=folder;var values=URLResourceValues();values.isExcludedFromBackup=true;try? url.setResourceValues(values)
    }
    var manifest: URL { folder.appendingPathComponent("session.json") }
    var journal: URL { folder.appendingPathComponent("points.jsonl") }
    private func write(_ data: Data, to url: URL) throws {
        #if os(iOS)
        try data.write(to:url,options:[.atomic,.completeFileProtectionUntilFirstUserAuthentication])
        #else
        try data.write(to:url,options:.atomic)
        #endif
    }
    func save(_ state: TrackRecordingState, resetPoints: Bool = false) throws {
        if resetPoints { try write(Data(),to:journal) }
        var metadata=state;metadata.points=[]
        try write(JSONEncoder().encode(metadata),to:manifest)
        #if os(iOS)
        for url in [manifest,journal] where FileManager.default.fileExists(atPath:url.path) {
            try FileManager.default.setAttributes([.protectionKey:FileProtectionType.completeUntilFirstUserAuthentication],ofItemAtPath:url.path)
        }
        #endif
    }
    func append(_ point: TrackFix) throws {
        var data=try JSONEncoder().encode(point);data.append(10)
        let file=try FileHandle(forWritingTo:journal);defer { try? file.close() }
        try file.seekToEnd();try file.write(contentsOf:data);try file.synchronize()
    }
    func load(owner: String) throws -> TrackRecordingState? {
        guard FileManager.default.fileExists(atPath:manifest.path) else { return nil }
        var state=try JSONDecoder().decode(TrackRecordingState.self,from:Data(contentsOf:manifest))
        guard state.owner==owner else { throw NSError(domain:"KinettaTrack",code:1,userInfo:[NSLocalizedDescriptionKey:"Recording belongs to another account."]) }
        if let data=try? Data(contentsOf:journal) {
            // Only complete records count. Partial final bytes cannot erase previous durable fixes.
            if !data.isEmpty && data.last != 10 {
                let validLength=data.lastIndex(of:10).map { $0+1 } ?? 0
                let handle=try FileHandle(forWritingTo:journal);defer { try? handle.close() }
                try handle.truncate(atOffset:UInt64(validLength));try handle.synchronize()
            }
            let rows=data.split(separator:10,omittingEmptySubsequences:false)
            for line in rows.dropLast() where !line.isEmpty {
                guard let fix=try? JSONDecoder().decode(TrackFix.self,from:Data(line)),state.points.count<24000 else { break }
                state.points.append(fix)
            }
        }
        // Journal commits can be newer than the manifest; rebuild distance and segment counters from durable fixes.
        (state.distance, state.anchor) = TrackRecordingState.distance(of: state.points)
        if let last=state.points.last { state.segment=max(state.segment,last.segment) }
        return state
    }
    func clear() throws {
        for url in [manifest,journal] where FileManager.default.fileExists(atPath:url.path) { try FileManager.default.removeItem(at:url) }
    }
}
