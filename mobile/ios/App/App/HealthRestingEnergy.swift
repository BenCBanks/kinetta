import Foundation
import HealthKit

// Read-only daily Resting Energy. No active-energy totals or workout changes.
enum HealthRestingEnergy {
    private static let permissionStore=HKHealthStore()
    static func request(done: @escaping (Error?) -> Void) {
        guard HKHealthStore.isHealthDataAvailable(),let type=HKObjectType.quantityType(forIdentifier:.basalEnergyBurned) else {
            done(NSError(domain:"KinettaHealth",code:1,userInfo:[NSLocalizedDescriptionKey:"Apple Health is unavailable."]));return
        }
        DispatchQueue.main.async {
            permissionStore.requestAuthorization(toShare:[],read:[type]) { _,error in done(error) }
        }
    }
    static func read(timeZone: String, done: @escaping (Result<[String:Any],Error>) -> Void) {
        guard HKHealthStore.isHealthDataAvailable(),let zone=TimeZone(identifier:timeZone),
              let type=HKObjectType.quantityType(forIdentifier:.basalEnergyBurned) else {
            done(.failure(NSError(domain:"KinettaHealth",code:1,userInfo:[NSLocalizedDescriptionKey:"Choose a valid Health time zone."])));return
        }
        let store=HKHealthStore(),end=Date()
        var calendar=Calendar(identifier:.gregorian);calendar.timeZone=zone
        let anchor=calendar.startOfDay(for:end)
        guard let start=calendar.date(byAdding:.day,value:-30,to:anchor) else { return }
        let predicate=HKQuery.predicateForSamples(withStart:start,end:end,options:[])
        var interval=DateComponents();interval.day=1;interval.calendar=calendar;interval.timeZone=zone
        let query=HKStatisticsCollectionQuery(quantityType:type,quantitySamplePredicate:predicate,options:.cumulativeSum,
                                              anchorDate:anchor,intervalComponents:interval)
        let lock=NSLock();var completed=false
        func finish(_ result: Result<[String:Any],Error>) {
            lock.lock();if completed { lock.unlock();return };completed=true;lock.unlock();done(result)
        }
        let timeout=DispatchWorkItem {
            store.stop(query);query.initialResultsHandler=nil
            finish(.failure(NSError(domain:"KinettaHealth",code:1,userInfo:[NSLocalizedDescriptionKey:"Resting energy could not be read. Unlock your phone and try syncing again."])))
        }
        query.initialResultsHandler = { _,collection,error in
            timeout.cancel();store.stop(query);query.initialResultsHandler=nil
            if let error=error { finish(.failure(error));return }
            guard let collection=collection else {
                finish(.failure(NSError(domain:"KinettaHealth",code:1,userInfo:[NSLocalizedDescriptionKey:"Apple Health returned no resting-energy result."])));return
            }
            let formatter=DateFormatter();formatter.locale=Locale(identifier:"en_US_POSIX");formatter.calendar=calendar
            formatter.timeZone=zone;formatter.dateFormat="yyyy-MM-dd"
            var rows:[[String:Any]]=[]
            collection.enumerateStatistics(from:start,to:end) { statistics,_ in
                if let value=statistics.sumQuantity()?.doubleValue(for:.kilocalorie()),value.isFinite,value>0,statistics.startDate<=end {
                    rows.append(["day":formatter.string(from:statistics.startDate),"resting_kcal":value])
                }
            }
            // Empty/denied/unreadable is never converted to zero. HealthKit does not expose read-denial status.
            let observed=ISO8601DateFormatter();observed.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
            finish(.success(["tz":timeZone,"observed_at":observed.string(from:end),"days":rows]))
        }
        DispatchQueue.global().asyncAfter(deadline:.now()+25,execute:timeout)
        store.execute(query)
    }
}
