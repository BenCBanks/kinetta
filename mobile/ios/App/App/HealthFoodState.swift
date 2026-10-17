import Foundation

// Foundation-only contracts run without a device or HealthKit.
struct HealthFoodState: Codable {
    var owner: String
    var weightEpoch: String = ""
    var weightAnchor: Data?
    var nutritionEpoch: String = ""
    var nutritionPermissions: String = ""
    var nutritionCursor: Int64 = 0

    mutating func prepareWeight(epoch: String) {
        if weightEpoch != epoch { weightEpoch = epoch; weightAnchor = nil }
    }
    mutating func prepareNutrition(epoch: String, permissions: String) {
        if nutritionEpoch != epoch || nutritionPermissions != permissions {
            nutritionEpoch = epoch; nutritionPermissions = permissions; nutritionCursor = 0
        }
    }
    mutating func acknowledgeNutrition(epoch: String, cursor: Int64) throws {
        guard epoch == nutritionEpoch, cursor >= nutritionCursor else { throw HealthFoodError.changed }
        nutritionCursor = cursor
    }
}

enum HealthFoodError: LocalizedError {
    case changed, invalid
    var errorDescription: String? {
        switch self {
        case .changed: return "Apple Health sharing changed. Refresh and try again."
        case .invalid: return "The nutrition sync result was incomplete. Try syncing again."
        }
    }
}

struct HealthFoodDay: Decodable {
    let day: String
    let revision: Int64
    let start: String
    let end: String
    let deleted: Bool
    let values: [String: Double?]

    static let fields = ["kcal", "protein_g", "carbs_g", "fat_g", "fiber_g"]
    static let unitSymbols = ["kcal":"kcal", "protein_g":"g", "carbs_g":"g", "fat_g":"g", "fiber_g":"g"]
    func interval(timeZone: String) throws -> (Date, Date) {
        let formatter = ISO8601DateFormatter()
        guard let zone = TimeZone(identifier: timeZone),
              let from = formatter.date(from: start), let until = formatter.date(from: end),
              revision > 0, revision <= 9_007_199_254_740_991,
              Set(values.keys) == Set(Self.fields),
              values.values.allSatisfy({ $0 == nil || ($0!.isFinite && $0! >= 0) }) else { throw HealthFoodError.invalid }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = zone
        let label = DateFormatter(); label.locale = Locale(identifier: "en_US_POSIX")
        label.calendar = calendar; label.timeZone = zone; label.dateFormat = "yyyy-MM-dd"
        guard calendar.startOfDay(for: from) == from, label.string(from: from) == day,
              calendar.date(byAdding: .day, value: 1, to: from) == until else { throw HealthFoodError.invalid }
        return (from, until)
    }
    func identifier(ownerDigest: String, field: String) throws -> String {
        guard Self.fields.contains(field), ownerDigest.count == 64,
              ownerDigest.allSatisfy({ $0.isHexDigit }) else { throw HealthFoodError.invalid }
        return "kinetta.food.\(ownerDigest).\(day).\(field)"
    }
    func quantity(_ field: String) -> Double? { deleted ? nil : (values[field] ?? nil) }
}
