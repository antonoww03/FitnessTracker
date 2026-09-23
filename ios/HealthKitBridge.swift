import Foundation
import HealthKit
import WebKit

/// Attach this handler as "fittrackHealth" to the WKWebView used by the signed
/// iOS shell. The web app never receives unrestricted HealthKit access; every
/// request passes through HealthKit authorization and this explicit bridge.
final class FitTrackHealthBridge: NSObject, WKScriptMessageHandler {
    private let store = HKHealthStore()
    private weak var webView: WKWebView?
    private let allowedHost: String
    private let day = ISO8601DateFormatter()

    init(webView: WKWebView, allowedHost: String) {
        self.webView = webView
        self.allowedHost = allowedHost
        super.init()
        day.formatOptions = [.withFullDate]
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.frameInfo.securityOrigin.host == allowedHost else { return }
        guard
            let body = message.body as? [String: Any],
            let action = body["action"] as? String,
            let requestId = body["requestId"] as? String
        else { return }
        let payload = body["payload"] as? [String: Any] ?? [:]
        switch action {
        case "requestAuthorization": authorize(requestId)
        case "sync": sync(requestId, payload)
        case "writeWeight": writeWeight(requestId, payload)
        case "writeWorkout": writeWorkout(requestId, payload)
        default: reply(requestId, error: "Unsupported HealthKit action")
        }
    }

    private var weight: HKQuantityType {
        HKObjectType.quantityType(forIdentifier: .bodyMass)!
    }
    private var steps: HKQuantityType {
        HKObjectType.quantityType(forIdentifier: .stepCount)!
    }
    private var energy: HKQuantityType {
        HKObjectType.quantityType(forIdentifier: .activeEnergyBurned)!
    }

    private func authorize(_ requestId: String) {
        guard HKHealthStore.isHealthDataAvailable() else {
            reply(requestId, error: "Health data is unavailable on this device")
            return
        }
        store.requestAuthorization(
            toShare: [weight, HKObjectType.workoutType()],
            read: [weight, steps, energy, HKObjectType.workoutType()]
        ) { [weak self] success, error in
            if success { self?.reply(requestId, data: ["authorized": true]) }
            else { self?.reply(requestId, error: error?.localizedDescription ?? "Authorization was not granted") }
        }
    }

    private func sync(_ requestId: String, _ payload: [String: Any]) {
        guard
            let fromText = payload["from"] as? String,
            let toText = payload["to"] as? String,
            let from = day.date(from: fromText),
            let toDay = day.date(from: toText),
            let to = Calendar.current.date(byAdding: .day, value: 1, to: toDay)
        else {
            reply(requestId, error: "Invalid synchronization dates")
            return
        }
        let predicate = HKQuery.predicateForSamples(withStart: from, end: to)
        let group = DispatchGroup()
        let lock = NSLock()
        var result: [String: Any] = ["weights": 0, "workouts": 0, "steps": 0.0, "activeEnergyKcal": 0.0]

        group.enter()
        store.execute(HKSampleQuery(sampleType: weight, predicate: predicate, limit: 0, sortDescriptors: nil) {
            _, samples, _ in
            lock.lock(); result["weights"] = samples?.count ?? 0; lock.unlock(); group.leave()
        })
        group.enter()
        store.execute(HKSampleQuery(sampleType: .workoutType(), predicate: predicate, limit: 0, sortDescriptors: nil) {
            _, samples, _ in
            lock.lock(); result["workouts"] = samples?.count ?? 0; lock.unlock(); group.leave()
        })
        for (type, key, unit) in [(steps, "steps", HKUnit.count()), (energy, "activeEnergyKcal", HKUnit.kilocalorie())] {
            group.enter()
            let query = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: predicate, options: .cumulativeSum) {
                _, stats, _ in
                let value = stats?.sumQuantity()?.doubleValue(for: unit) ?? 0
                lock.lock(); result[key] = value; lock.unlock(); group.leave()
            }
            store.execute(query)
        }
        group.notify(queue: .main) { [weak self] in
            let samples = (result["weights"] as? Int ?? 0) + (result["workouts"] as? Int ?? 0)
            result["sampleCount"] = samples
            self?.reply(requestId, data: result)
        }
    }

    private func writeWeight(_ requestId: String, _ payload: [String: Any]) {
        guard
            let value = payload["weight_kg"] as? Double,
            let dateText = payload["date"] as? String,
            let date = day.date(from: dateText)
        else {
            reply(requestId, error: "Invalid weight entry")
            return
        }
        let sample = HKQuantitySample(
            type: weight,
            quantity: HKQuantity(unit: .gramUnit(with: .kilo), doubleValue: value),
            start: date,
            end: date
        )
        store.save(sample) { [weak self] success, error in
            if success { self?.reply(requestId, data: ["saved": true]) }
            else { self?.reply(requestId, error: error?.localizedDescription ?? "Weight was not saved") }
        }
    }

    private func writeWorkout(_ requestId: String, _ payload: [String: Any]) {
        guard
            let minutes = payload["duration_minutes"] as? Double,
            let dateText = payload["date"] as? String,
            let start = day.date(from: dateText)
        else {
            reply(requestId, error: "Invalid workout entry")
            return
        }
        let kind = payload["training_type"] as? String ?? "Strength"
        let mapping: [String: HKWorkoutActivityType] = [
            "Strength": .traditionalStrengthTraining, "Cardio": .mixedCardio,
            "HIIT": .highIntensityIntervalTraining, "Yoga": .yoga,
            "Swimming": .swimming, "Cycling": .cycling, "Running": .running,
            "Walking": .walking
        ]
        let end = start.addingTimeInterval(minutes * 60)
        let workout = HKWorkout(
            activityType: mapping[kind] ?? .other,
            start: start,
            end: end,
            duration: minutes * 60,
            totalEnergyBurned: nil,
            totalDistance: nil,
            metadata: [HKMetadataKeyExternalUUID: UUID().uuidString]
        )
        store.save(workout) { [weak self] success, error in
            if success { self?.reply(requestId, data: ["saved": true]) }
            else { self?.reply(requestId, error: error?.localizedDescription ?? "Workout was not saved") }
        }
    }

    private func reply(_ requestId: String, data: [String: Any]? = nil, error: String? = nil) {
        var detail: [String: Any] = ["requestId": requestId, "ok": error == nil]
        if let data { detail["data"] = data }
        if let error { detail["error"] = error }
        guard
            let bytes = try? JSONSerialization.data(withJSONObject: detail),
            let json = String(data: bytes, encoding: .utf8)
        else { return }
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(
                "window.dispatchEvent(new CustomEvent('fittrack-health-result',{detail:\(json)}))"
            )
        }
    }
}
