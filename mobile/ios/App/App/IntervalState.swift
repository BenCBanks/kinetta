import Foundation

// The same finite contract as app/intervals.py. Targets use authored decimal strings;
// expansion has no pace assumptions, nested repeats or dependencies on a route.
struct IntervalTarget: Codable { var kind: String; var amount: String; var unit: String }
struct IntervalStep: Codable { var id: String; var action: String; var role: String; var title: String; var target: IntervalTarget }
struct IntervalBlock: Codable { var id: String; var `repeat`: Int; var steps: [IntervalStep]; var omit_final_recovery: String? }
struct IntervalDefinition: Codable { var schema: Int; var name: String; var description: String; var blocks: [IntervalBlock] }
struct IntervalPhase: Codable {
    var key: String; var block: String; var execution: Int; var executions: Int
    var action: String; var role: String; var title: String; var kind: String; var target: Double
}
struct IntervalPin: Codable {
    var id: String; var version: Int; var content_hash: String; var definition: IntervalDefinition
    func expanded() throws -> [IntervalPhase] {
        func bad(_ text: String) -> NSError { NSError(domain:"KinettaIntervals",code:1,userInfo:[NSLocalizedDescriptionKey:text]) }
        guard UUID(uuidString:id) != nil,version>0,content_hash.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil,
              definition.schema==1,!definition.name.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty,
              definition.name.count<=120,definition.description.count<=500,(1...50).contains(definition.blocks.count) else { throw bad("Review a supported, complete saved interval preset.") }
        var ids=Set<String>(), phases:[IntervalPhase]=[],authored=0,seconds=0.0,metres=0.0
        func unique(_ id: String) -> Bool {
            guard id.range(of:"^[A-Za-z0-9_-]{1,64}$",options:.regularExpression) != nil,!ids.contains(id) else { return false }
            ids.insert(id);return true
        }
        for block in definition.blocks {
            guard unique(block.id),(1...100).contains(block.repeat),(1...50).contains(block.steps.count) else { throw bad("Invalid interval block or execution count.") }
            var values:[Double]=[]
            for step in block.steps {
                authored+=1
                guard authored<=50,unique(step.id),["run","walk"].contains(step.action),["effort","recovery","warmup","cooldown"].contains(step.role),step.title.count<=80,
                      step.target.amount.range(of:"^[0-9]{1,12}(?:\\.[0-9]{1,6})?$",options:.regularExpression) != nil,
                      let amount=Double(step.target.amount),amount.isFinite else { throw bad("Invalid interval action, target or step ID.") }
                let factors=step.target.kind=="time" ? ["s":1.0,"min":60.0] : step.target.kind=="distance" ? ["m":1.0,"km":1000.0,"yd":0.9144,"mi":1609.344] : [:]
                guard let factor=factors[step.target.unit] else { throw bad("Choose a supported time or distance unit.") }
                let value=amount*factor,lo=step.target.kind=="time" ? 5.0 : 10.0,hi=step.target.kind=="time" ? 21600.0 : 100000.0
                guard value.isFinite,value>=lo-0.0000001,value<=hi+0.0000001 else { throw bad("Interval target is outside the supported limits.") };values.append(value)
            }
            if let omit=block.omit_final_recovery {
                guard let last=block.steps.last,last.id==omit,last.action=="walk",last.role=="recovery" else { throw bad("Only an explicitly marked final Walk recovery may be omitted.") }
            }
            for execution in 1...block.repeat {
                for (i,step) in block.steps.enumerated() {
                    if execution==block.repeat && step.id==block.omit_final_recovery { continue }
                    let value=values[i]
                    phases.append(IntervalPhase(key:"\(block.id):\(step.id):\(execution)",block:block.id,execution:execution,executions:block.repeat,action:step.action,role:step.role,title:step.title,kind:step.target.kind,target:value))
                    if step.target.kind=="time" { seconds+=value } else { metres+=value }
                    guard phases.count<=1000,seconds<=86400.0000001,metres<=500000.0000001 else { throw bad("Interval preset exceeds the expanded target limits.") }
                }
            }
        }
        guard !phases.isEmpty else { throw bad("Keep at least one interval step.") };return phases
    }
}

struct IntervalSample: Codable { var time: Double; var distance: Double; var segment: Int }
struct IntervalResult: Codable {
    var key: String; var outcome: String; var start_time: Double; var end_time: Double
    var start_distance: Double?; var end_distance: Double?
    var unallocated_distance: Double?; var distance_baseline_time: Double?
}
struct IntervalEffect: Codable {
    var sequence: Int; var phase: Int; var logical_time: Double; var kind: String
    var voice: String; var vibration: String
    var voice_attempt_time: Double?; var voice_ack_time: Double?
    var vibration_attempt_time: Double?; var vibration_ack_time: Double?
}

// Advances from the recorder's eligible active seconds and accepted cumulative metres.
// Sensor evidence and wall-clock polling are separate: a timer never invents distance.
struct IntervalState: Codable {
    var pin: IntervalPin
    var phases: [IntervalPhase]
    var index=0
    var status="running"
    var time=0.0
    var distance=0.0
    var phase_time=0.0
    var phase_distance: Double?=0
    var phase_distance_time: Double?=0
    var phase_ignored_distance: Double?=0
    var sample: IntervalSample?
    var results: [IntervalResult]=[]
    var effects: [IntervalEffect]=[]
    var voice: Bool
    var vibration: Bool
    var revision=0
    var effects_omitted=0
    init(pin: IntervalPin, voice: Bool, vibration: Bool) throws {
        self.pin=pin;self.phases=try pin.expanded();self.voice=voice;self.vibration=vibration
        cue(kind:"step",at:0)
    }
    func validateStored() throws {
        let expected=try pin.expanded()
        func invalid() -> NSError { NSError(domain:"KinettaIntervals",code:2,userInfo:[NSLocalizedDescriptionKey:"Saved interval progress needs recovery. The original recording files are kept."]) }
        guard expected.count==phases.count,(0...phases.count).contains(index),["running","complete","ended","finished"].contains(status),
              time.isFinite,phase_time.isFinite,distance.isFinite,time>=0,time<=172800,phase_time>=0,phase_time<=time+0.000001,distance>=0,
              phase_distance==nil || (phase_distance!.isFinite && phase_distance!>=0 && phase_distance!<=distance+0.000001),
              phase_distance_time==nil || (phase_distance_time!.isFinite && phase_distance_time!>=phase_time && phase_distance_time!<=time),
              phase_ignored_distance==nil || (phase_ignored_distance!.isFinite && phase_ignored_distance!>=0 && phase_ignored_distance!<=distance),
              results.count<=phases.count,effects.count<=4096,effects_omitted>=0 else { throw invalid() }
        for (a,b) in zip(expected,phases) { if a.key != b.key || a.action != b.action || a.kind != b.kind || abs(a.target-b.target)>0.000001 { throw invalid() } }
        if status=="running" && (index>=phases.count || results.count != index) { throw invalid() }
        if status=="complete" && (index != phases.count || results.count != phases.count) { throw invalid() }
        var last=0.0
        for (i,result) in results.enumerated() {
            guard result.key==phases[i].key,["complete","skipped","ended","finished"].contains(result.outcome),result.start_time.isFinite,result.end_time.isFinite,
                  abs(result.start_time-last)<0.001,result.end_time>=result.start_time,result.end_time<=time+0.000001 else { throw invalid() }
            last=result.end_time
        }
        var sequence=0
        let delivery=["pending","attempted","completed","suppressed","failed","unknown","disabled","unsupported"]
        for event in effects {
            guard event.sequence>sequence,event.sequence<=revision,(0...phases.count).contains(event.phase),event.logical_time.isFinite,
                  event.logical_time>=0,event.logical_time<=time+0.000001,delivery.contains(event.voice),delivery.contains(event.vibration) else { throw invalid() }
            sequence=event.sequence
        }
    }
    var current: IntervalPhase? { index<phases.count ? phases[index] : nil }
    var remaining: Double? {
        guard status=="running",let phase=current else { return nil }
        return max(0,phase.target-(phase.kind=="time" ? time-phase_time : phase_distance.map { distance-$0-(phase_ignored_distance ?? 0) } ?? 0))
    }
    mutating func cue(kind: String, at time: Double) {
        // Obsolete instructions are never replayed when a delayed batch crosses many phases.
        for i in effects.indices {
            if effects[i].voice=="attempted" { effects[i].voice="unknown" }
            if effects[i].voice=="pending" { effects[i].voice="suppressed" }
            if effects[i].vibration=="attempted" { effects[i].vibration="unknown" }
            if effects[i].vibration=="pending" { effects[i].vibration="suppressed" }
        }
        if effects.count>=4096 { effects.removeFirst();effects_omitted+=1 }
        revision+=1
        effects.append(IntervalEffect(sequence:revision,phase:index,logical_time:time,kind:kind,voice:voice ? "pending":"disabled",vibration:vibration ? "pending":"disabled"))
    }
    mutating func suppress() {
        for i in effects.indices {
            if ["pending","attempted"].contains(effects[i].voice) { effects[i].voice="suppressed" }
            if ["pending","attempted"].contains(effects[i].vibration) { effects[i].vibration="suppressed" }
        }
    }
    private func at(_ t: Double, between previous: IntervalSample?, and next: IntervalSample?) -> Double? {
        guard let next else { return nil }
        if abs(t-next.time)<0.000001 { return next.distance }
        guard let previous,previous.segment==next.segment,next.time>previous.time,next.time-previous.time<=30.000001,
              t>=previous.time-0.000001,t<=next.time+0.000001 else { return nil }
        return previous.distance+(next.distance-previous.distance)*(t-previous.time)/(next.time-previous.time)
    }
    mutating func advance(to now: Double, accepted: IntervalSample? = nil, cues: Bool = true) {
        guard status=="running",now.isFinite,now>=0,now<=172800 else { return }
        let previous=sample
        var incoming=accepted
        if let s=incoming {
            if !s.time.isFinite || !s.distance.isFinite || s.time<0 || s.distance<distance-0.000001 || s.time>now+0.000001 || s.segment<0 || (previous != nil && s.time<=previous!.time) { incoming=nil }
        }
        time=max(time,now)
        if let s=incoming {
            distance=s.distance
            // A later continuous fix can establish a provisional time-boundary baseline.
            for i in results.indices {
                if results[i].start_distance==nil { results[i].start_distance=at(results[i].start_time,between:previous,and:s) }
                if results[i].end_distance==nil { results[i].end_distance=at(results[i].end_time,between:previous,and:s) }
            }
            if phase_distance==nil {
                phase_distance=at(phase_time,between:previous,and:s)
                phase_distance_time=phase_distance==nil ? nil:phase_time
                // No supported interpolation across a gap: anchor at the first later eligible fix.
                if phase_distance==nil && s.time>=phase_time && (current?.kind=="distance" || s.time<=phase_time+(current?.target ?? 0)) { phase_distance=s.distance;phase_distance_time=s.time }
            } else if current?.kind=="distance",let previous,(previous.segment != s.segment || s.time-previous.time>30.000001) {
                // Keep credited progress, excluding only a newly unallocated increment. Do not restart the target.
                phase_ignored_distance=(phase_ignored_distance ?? 0)+max(0,s.distance-previous.distance)
            }
        }
        var advanced=false
        while let phase=current {
            var endTime:Double?,endDistance:Double?
            if phase.kind=="time" {
                let boundary=phase_time+phase.target
                if time+0.0000001<boundary { break }
                endTime=boundary;endDistance=at(boundary,between:previous,and:incoming)
                if endDistance==nil,let s=sample,abs(s.time-boundary)<0.000001 { endDistance=s.distance }
            } else {
                guard let baseline=phase_distance,let s=incoming else { break }
                let boundary=baseline+(phase_ignored_distance ?? 0)+phase.target
                if s.distance+0.0000001<boundary { break }
                // Baseline/crossing must belong to a continuous accepted section.
                if let previous,previous.segment==s.segment,s.time-previous.time<=30.000001,s.distance>previous.distance,boundary>=previous.distance-0.000001 {
                    endTime=previous.time+(s.time-previous.time)*(boundary-previous.distance)/(s.distance-previous.distance)
                } else if abs(boundary-s.distance)<0.000001 { endTime=s.time }
                else { break }
                endTime=max(phase_time,endTime!);endDistance=boundary
            }
            guard let endTime else { break }
            results.append(IntervalResult(key:phase.key,outcome:"complete",start_time:phase_time,end_time:endTime,start_distance:phase_distance,end_distance:endDistance,unallocated_distance:phase_ignored_distance,distance_baseline_time:phase_distance_time))
            index+=1;phase_time=endTime;phase_distance=endDistance;phase_distance_time=endDistance==nil ? nil:endTime;phase_ignored_distance=0;advanced=true
            if phase_distance==nil,let phase=current,let incoming,incoming.time>=phase_time,(phase.kind=="distance" || incoming.time<=phase_time+phase.target) { phase_distance=incoming.distance;phase_distance_time=incoming.time }
            if index==phases.count { status="complete";cue(kind:"complete",at:endTime);break }
            cue(kind:"step",at:endTime)
        }
        if let s=incoming { sample=s }
        if !cues && advanced { suppress() }
    }
    mutating func skip(at now: Double) {
        guard status=="running" else { return }
        // Do not skip the *next* phase if the selected phase reaches its target at this control's timestamp.
        let expected=index
        advance(to:now,cues:false)
        if index != expected {
            if status=="running" { cue(kind:"resume",at:time) }
            else if status=="complete" { cue(kind:"complete",at:time) }
            return
        }
        guard status=="running",let phase=current else { return }
        suppress();results.append(IntervalResult(key:phase.key,outcome:"skipped",start_time:phase_time,end_time:time,start_distance:phase_distance,end_distance:sample.flatMap { abs($0.time-time)<0.000001 ? $0.distance:nil },unallocated_distance:phase_ignored_distance,distance_baseline_time:phase_distance_time))
        index+=1;phase_time=time;phase_distance=nil;phase_distance_time=nil;phase_ignored_distance=0
        if let s=sample,abs(s.time-time)<0.000001 { phase_distance=s.distance;phase_distance_time=s.time }
        if index==phases.count { status="complete";cue(kind:"complete",at:time) } else { cue(kind:"step",at:time) }
    }
    mutating func end(at now: Double, reason: String) {
        guard status=="running" else { suppress();return }
        advance(to:now,cues:false);suppress()
        if status=="running",let phase=current {
            results.append(IntervalResult(key:phase.key,outcome:reason,start_time:phase_time,end_time:time,start_distance:phase_distance,end_distance:sample.flatMap { abs($0.time-time)<0.000001 ? $0.distance:nil },unallocated_distance:phase_ignored_distance,distance_baseline_time:phase_distance_time))
            status=reason
        }
    }
    mutating func resumed() { if status=="running" { cue(kind:"resume",at:time) } }
    mutating func recovered() {
        for i in effects.indices {
            if effects[i].voice=="pending" { effects[i].voice="suppressed" }
            if effects[i].voice=="attempted" { effects[i].voice="unknown" }
            if effects[i].vibration=="pending" { effects[i].vibration="suppressed" }
            if effects[i].vibration=="attempted" { effects[i].vibration="unknown" }
        }
    }
    func instruction() -> String {
        if status=="complete" { return "Interval sequence complete. Keep recording, or pause and finish when ready." }
        guard let phase=current else { return "Intervals ended. Recording continues." }
        let action=phase.action=="run" ? "Run":"Walk"
        let value=remaining ?? phase.target
        let target=phase.kind=="time" ? NativeTrackVoiceText.said(value):"\(Int(value.rounded(.up))) metres"
        return "\(action). \(target) remaining."
    }
}
