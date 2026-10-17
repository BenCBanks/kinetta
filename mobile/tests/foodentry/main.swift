import Foundation
let now = Date(timeIntervalSince1970:1_792_238_400)
var state = FoodEntryState(ownerDigest:String(repeating:"a",count:64))
try state.add(text:nil,source:.quickAction,now:now)
try state.add(text:"  Fictional eggs and toast  ",source:.shortcut,now:now)
guard state.requests.count == 2,state.requests[1].text == "Fictional eggs and toast" else { fatalError("entry text/source") }
let first = state.requests[0].id;state.acknowledge(first);state.acknowledge(first)
guard state.requests.count == 1 else { fatalError("ack replay") }
do { try state.add(text:nil,source:.shortcut,now:now);fatalError("missing shortcut text") } catch {}
do { try state.add(text:String(repeating:"🥣",count:2001),source:.shortcut,now:now);fatalError("UTF16 bound") } catch {}
do { try state.add(text:" ",source:.shortcut,now:now);fatalError("empty text") } catch {}
do { try state.add(text:String(repeating:"x",count:4001),source:.shortcut,now:now);fatalError("long text") } catch {}
for _ in 0..<4 { try state.add(text:nil,source:.quickAction,now:now) }
do { try state.add(text:nil,source:.quickAction,now:now);fatalError("unbounded inbox") } catch {}
let restored = try JSONDecoder().decode(FoodEntryState.self,from:JSONEncoder().encode(state))
guard restored.ownerDigest == state.ownerDigest,restored.requests.count == 5 else { fatalError("owner state roundtrip") }
state.purge(now:now.addingTimeInterval(86401));guard state.requests.isEmpty else { fatalError("expiry") }
print("Food entry native state: private owner digest, quick/text sources, bounded input/inbox, idempotent acknowledgement, persistence and24h expiry PASS")
