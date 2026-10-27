import Foundation
func check(_ value: @autoclosure () -> Bool,_ text: String) { if !value() { fatalError(text) } }
struct Fixture: Decodable { var name: String; var pin: IntervalPin; var expected_steps: [IntervalPhase] }
let fixtures=try JSONDecoder().decode([Fixture].self,from:Data(contentsOf:URL(fileURLWithPath:CommandLine.arguments[1])))
func state(_ name: String) throws -> IntervalState { try IntervalState(pin:fixtures.first { $0.name==name }!.pin,voice:true,vibration:true) }
for fixture in fixtures {
 let actual=try fixture.pin.expanded()
 check(actual.count==fixture.expected_steps.count,"Shared expansion count: \(fixture.name)")
 for (a,b) in zip(actual,fixture.expected_steps) { check(a.key==b.key && a.action==b.action && abs(a.target-b.target)<0.000001,"Shared phase contract") }
}
let clock=TrackMonotonicClock(wallMilliseconds:1_000_000,monotonicSeconds:100)
check(clock.at(110)==1_010_000,"Eligible clock advances by monotonic time")
check(clock.locationTime(timestamp:4_599_500,wallNow:4_600_000,monotonicNow:110)==1_009_500,"A forward wall-clock adjustment cannot change a fix's relative age")
check(clock.locationTime(timestamp:499_500,wallNow:500_000,monotonicNow:110)==1_009_500,"A backwards wall-clock adjustment cannot change a fix's relative age")
check(clock.at(3700)==4_600_000,"Sleep-inclusive injected time retains the eligible interval duration")
var timed=try state("time")
for (t,index) in [(0.0,0),(180,1),(240,2),(420,3),(480,4),(660,5),(720,6)] {
 timed.advance(to:t);check(timed.index==index,"Exact 3:1 x3 boundary \(t)")
}
check(timed.status=="complete" && timed.results.count==6,"Complete once, six results")
let count=timed.effects.count;timed.advance(to:800);check(timed.effects.count==count,"No post-completion restart")
var voiceOnly=try IntervalState(pin:fixtures.first { $0.name=="time" }!.pin,voice:true,vibration:false)
for boundary in [0.0,180,240,420,480,660,720] {
 voiceOnly.advance(to:boundary)
 check(voiceOnly.effects.last?.voice=="pending" && voiceOnly.effects.allSatisfy { $0.vibration=="disabled" },"Every transition/completion retains a voice request with vibration off")
}
check(voiceOnly.status=="complete" && voiceOnly.results.count==6,"Voice-only intervals finish the same exact workout")
try voiceOnly.validateStored()
var omit=try state("omit");omit.advance(to:660);check(omit.status=="complete" && omit.results.count==5,"Final recovery omitted once")
var mixed=try state("mixed")
for t in [0.0,20,40,60,80,98] { mixed.advance(to:t,accepted:IntervalSample(time:t,distance:4*t,segment:0)) }
mixed.advance(to:102,accepted:IntervalSample(time:102,distance:408,segment:0))
check(mixed.index==1 && abs(mixed.phase_time-100)<0.000001 && abs(mixed.remaining!-58)<0.000001,"Distance to time allocates overshoot")
var distancePin=fixtures.first { $0.name=="mixed" }!.pin
distancePin.definition.blocks[0].steps.reverse();distancePin.definition.blocks[0].repeat=1
// Walk 60 seconds, then Run400: a timer can cross before the next accepted fix.
var td=try IntervalState(pin:distancePin,voice:true,vibration:true)
td.advance(to:0,accepted:IntervalSample(time:0,distance:0,segment:0));td.advance(to:25,accepted:IntervalSample(time:25,distance:200,segment:0))
td.advance(to:55,accepted:IntervalSample(time:55,distance:350,segment:0));td.advance(to:60)
check(td.phase_distance==nil,"Provisional distance baseline")
td.advance(to:65,accepted:IntervalSample(time:65,distance:370,segment:0))
check(td.index==1 && abs(td.phase_distance!-360)<0.000001 && abs(td.remaining!-390)<0.000001,"Time to distance interpolates only the continuous pair")
var gap=try IntervalState(pin:distancePin,voice:true,vibration:false)
gap.advance(to:0,accepted:IntervalSample(time:0,distance:0,segment:0));gap.advance(to:25,accepted:IntervalSample(time:25,distance:200,segment:0))
gap.advance(to:55,accepted:IntervalSample(time:55,distance:350,segment:0));gap.advance(to:60)
gap.advance(to:65,accepted:IntervalSample(time:65,distance:370,segment:1));check(gap.phase_distance==370 && gap.remaining==400,"No distance credited across a continuity break")
var delayed=try state("time")
delayed.advance(to:0,accepted:IntervalSample(time:0,distance:0,segment:0))
delayed.advance(to:500,accepted:IntervalSample(time:500,distance:1500,segment:0))
check(delayed.results.count==4 && delayed.results.allSatisfy { $0.distance_baseline_time == nil || $0.distance_baseline_time! <= $0.end_time },"Delayed fixes never assign a future baseline to an ended phase")
try delayed.validateStored()
var equalSkip=try state("time");equalSkip.skip(at:180);check(equalSkip.index==1 && equalSkip.results.count==1 && equalSkip.results[0].outcome=="complete","Equal-boundary skip cannot drop the next step")
var quality=try state("mixed")
for (t,d) in [(0.0,0.0),(20,80),(40,160),(60,240),(80,320),(87.5,350)] { quality.advance(to:t,accepted:IntervalSample(time:t,distance:d,segment:0)) }
quality.advance(to:130,accepted:IntervalSample(time:130,distance:500,segment:0))
check(abs(quality.remaining!-50)<0.000001,"An unreliable increment cannot erase prior credited distance")
quality.advance(to:140,accepted:IntervalSample(time:140,distance:550,segment:0))
check(quality.index==1 && quality.results[0].unallocated_distance==150,"Unallocated distance remains explicit in results")
var controls=try state("time");controls.advance(to:180,cues:false)
check(controls.effects.last!.voice=="suppressed","Pause at boundary suppresses obsolete cue")
controls.resumed();check(controls.effects.last!.kind=="resume","Resume announces current phase")
controls.skip(at:190);check(controls.results.last!.outcome=="skipped" && controls.index==2,"Skip is partial and explicit")
controls.end(at:200,reason:"ended");check(controls.status=="ended","End does not invent completion")
var recovery=try state("time");recovery.effects[0].voice="attempted";recovery.recovered()
check(recovery.effects[0].voice=="unknown" && recovery.effects[0].vibration=="suppressed","Crash does not replay unknown cues")
try recovery.validateStored()
let restored=try JSONDecoder().decode(IntervalState.self,from:JSONEncoder().encode(recovery));check(restored.pin.content_hash==recovery.pin.content_hash,"Pinned state survives a journal roundtrip")
let folder=FileManager.default.temporaryDirectory.appendingPathComponent("kinetta-interval-contract-"+UUID().uuidString,isDirectory:true)
defer { try? FileManager.default.removeItem(at:folder) }
let files=try TrackRecordingFiles(folder:folder)
var recording=TrackRecordingState(owner:"fictional-interval-account",id:UUID().uuidString,sport:"run",label:"Run",gps:true,start:0,activeAt:0,checkpoint:0)
let routeJSON:[String:Any] = ["schema":1,"kind":"owned","id":23,"version":4,"name":"Fictional trail","sport":"run","distance_m":9999,"line":"_p~iF~ps|U_ulLnnqC_mqNvxq`@","warnings":[],"attribution":[],"breaks":[],"downloadedAt":1000]
recording.routePlan=try JSONDecoder().decode(TrackRoutePlan.self,from:JSONSerialization.data(withJSONObject:routeJSON))
recording.intervals=try state("time");try files.save(recording,resetPoints:true)
let combined=try files.load(owner:"fictional-interval-account")!
check(combined.routePlan?.version==4 && combined.intervals?.pin.content_hash==recording.intervals?.pin.content_hash && combined.distance==0,"Route and interval snapshots coexist without supplying measured distance")
recording.intervals?.advance(to:100);recording.checkpoint=100000;try files.save(recording)
try Data("{broken".utf8).write(to:files.manifest)
let prior=try files.load(owner:"fictional-interval-account")
check(files.recoveredPrevious && prior?.intervals?.time==0,"Corrupt latest manifest retains prior valid interval checkpoint")
try files.clear();check(!FileManager.default.fileExists(atPath:files.previous.path),"Discard clears protected previous interval state")
print("PASS interval shared-contract, exact time/distance/mixed allocation, gap, control and recovery fixtures; no physical delivery claim")
