import Foundation

func check(_ value: @autoclosure () -> Bool, _ message: String) {
    guard value() else { fatalError(message) }
}
var state = HealthFoodState(owner: "fictional-account-a")
state.prepareWeight(epoch: "weight-one"); state.weightAnchor = Data([1, 2])
state.prepareWeight(epoch: "weight-one"); check(state.weightAnchor == Data([1,2]), "same epoch retains anchor")
state.prepareWeight(epoch: "weight-two"); check(state.weightAnchor == nil, "new epoch re-reads samples")
state.prepareNutrition(epoch: "nutrition-one", permissions: "energy,protein")
try state.acknowledgeNutrition(epoch: "nutrition-one", cursor: 12)
state.prepareNutrition(epoch: "nutrition-one", permissions: "energy,protein"); check(state.nutritionCursor == 12, "retry cursor")
state.prepareNutrition(epoch: "nutrition-one", permissions: "all-five"); check(state.nutritionCursor == 0, "permission changes reconcile old days")
try state.acknowledgeNutrition(epoch: "nutrition-one", cursor: 20)
do { try state.acknowledgeNutrition(epoch: "old", cursor: 30); fatalError("stale epoch accepted") } catch {}
do { try state.acknowledgeNutrition(epoch: "nutrition-one", cursor: 19); fatalError("cursor regressed") } catch {}
state.prepareNutrition(epoch: "nutrition-two", permissions: "all-five"); check(state.nutritionCursor == 0, "settings change resets cursor")
let decoded = try JSONDecoder().decode(HealthFoodState.self, from: JSONEncoder().encode(state))
check(decoded.owner == state.owner && decoded.weightEpoch == "weight-two", "protected file roundtrip")
let json = """
{"day":"2026-03-08","revision":22,"start":"2026-03-08T00:00:00-05:00","end":"2026-03-09T00:00:00-04:00","deleted":false,"values":{"kcal":300,"protein_g":20,"carbs_g":null,"fat_g":0,"fiber_g":null}}
"""
let row = try JSONDecoder().decode(HealthFoodDay.self, from: Data(json.utf8))
let dates = try row.interval(timeZone: "America/New_York")
check(dates.1.timeIntervalSince(dates.0) == 23 * 3600, "local DST day")
check(row.quantity("fat_g") == 0 && row.quantity("carbs_g") == nil, "zero vs unknown")
check(HealthFoodDay.unitSymbols["kcal"] == "kcal" && HealthFoodDay.fields.dropFirst().allSatisfy { HealthFoodDay.unitSymbols[$0] == "g" }, "energy kcal and nutrient grams")
let digest = String(repeating: "a", count: 64)
let identity = try row.identifier(ownerDigest: digest, field: "kcal")
check(identity == "kinetta.food.\(digest).2026-03-08.kcal", "stable account/day/type identity")
let otherIdentity = try row.identifier(ownerDigest: String(repeating: "b", count:64), field:"kcal")
check(otherIdentity != identity, "other account differs")
do { _ = try row.interval(timeZone: "UTC"); fatalError("wrong local day accepted") } catch {}
let deleted = try JSONDecoder().decode(HealthFoodDay.self, from: Data(json.replacingOccurrences(of:"\"deleted\":false",with:"\"deleted\":true").utf8))
check(deleted.quantity("kcal") == nil, "deleted day removes old own samples")
print("Health food native state/mapping: owner-bound persistence, settings/permission reset, monotonic cursor, local DST, units/unknown-zero/deletion identity PASS")
