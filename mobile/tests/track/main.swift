import Foundation
func check(_ yes: Bool, _ why: String) { if !yes { fatalError(why) } }
var s=TrackRecordingState(owner:"fictional-account",id:UUID().uuidString,sport:"run",label:"Run",gps:true,start:1000000,activeAt:1000000,checkpoint:1000000)
check(s.accept(lat:0,lon:10,accuracy:5,timestamp:1001000,now:1001000) != nil,"first fix")
check(s.accept(lat:0.0001,lon:10,accuracy:5,timestamp:1006000,now:1006000) != nil,"second fix")
check(s.distance>11 && s.distance<12,"GPS distance")
check(s.accept(lat:20,lon:10,accuracy:5,timestamp:1007000,now:1007000)==nil,"jump rejected")
let distance=s.distance
s.pause(at:1010000);check(s.seconds(at:5000000)==10,"pause excludes background wall time")
s.resume(at:1020000)
check(s.accept(lat:1,lon:10,accuracy:5,timestamp:1021000,now:1021000) != nil,"resume fix")
check(s.distance==distance,"no distance across pause")
check(s.accept(lat:1.0001,lon:10,accuracy:5,timestamp:1060000,now:1060000) != nil,"signal gap")
check(s.distance==distance && s.segment==2,"no distance across signal loss")
let folder=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
let files=try TrackRecordingFiles(folder:folder)
try files.save(s,resetPoints:true)
for point in s.points { try files.append(point) }
var restored=try files.load(owner:"fictional-account")!
check(restored.points.count==4,"journal restore")
restored.recover(at:1100000)
check(restored.state=="paused" && restored.seconds(at:1100000)==50,"recovery ends at durable checkpoint")
let h=try FileHandle(forWritingTo:files.journal);try h.seekToEnd();try h.write(contentsOf:Data("{torn".utf8));try h.close()
check(try files.load(owner:"fictional-account")!.points.count==4,"torn tail preserves valid points")
try files.append(TrackFix(lat:1.0002,lon:10,t:65,accuracy:5,segment:2))
check(try files.load(owner:"fictional-account")!.points.count==5,"resume repairs torn journal tail before append")
do { _ = try files.load(owner:"other-account");fatalError("cross-account read") } catch {}
try files.clear();check(try files.load(owner:"fictional-account")==nil,"clear")
try FileManager.default.removeItem(at:folder)
// The shared distance filter (#234 item 2): the same fictional fixes the server and web tests use.
struct Fixture: Decodable { struct Case: Decodable { let sport: String; let expect: [Double]; let points: [TrackFix] }; let cases: [String: Case] }
let fixture=try JSONDecoder().decode(Fixture.self,from:Data(contentsOf:URL(fileURLWithPath:"../dev/tests/fixtures/gps_filter.json")))
for (name,c) in fixture.cases {
    var r=TrackRecordingState(owner:"fictional-account",id:UUID().uuidString,sport:c.sport,label:name,gps:true,start:0,activeAt:0,checkpoint:0)
    for f in c.points { check(r.accept(lat:f.lat,lon:f.lon,accuracy:f.accuracy,timestamp:f.t*1000,now:f.t*1000) != nil,"\(name) fix accepted") }
    check(r.distance>=c.expect[0] && r.distance<=c.expect[1],"\(name): \(r.distance) m outside \(c.expect)")
    check(TrackRecordingState.distance(of:r.points).0==r.distance,"\(name): restored distance matches live")
}
print("PASS native tracking state: GPS quality, pause/gaps, durable journal, interrupted recovery and account isolation")
