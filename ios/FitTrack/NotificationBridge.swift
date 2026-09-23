import Foundation
import UserNotifications
import WebKit

final class FitTrackNotificationBridge: NSObject, WKScriptMessageHandler {
    private weak var webView: WKWebView?
    private let allowedHost: String
    private let center = UNUserNotificationCenter.current()

    init(webView: WKWebView, allowedHost: String) {
        self.webView = webView
        self.allowedHost = allowedHost
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.frameInfo.securityOrigin.host == allowedHost,
              let body = message.body as? [String: Any],
              let action = body["action"] as? String,
              let requestId = body["requestId"] as? String else { return }
        let payload = body["payload"] as? [String: Any] ?? [:]
        switch action {
        case "status": status(requestId)
        case "requestAuthorization": authorize(requestId)
        case "schedule": schedule(requestId, payload)
        case "test": test(requestId, payload)
        case "cancel": cancel(requestId)
        default: reply(requestId, error: "Unsupported notification action")
        }
    }

    private func status(_ requestId: String) {
        center.getNotificationSettings { [weak self] settings in
            let permission: String
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral: permission = "granted"
            case .denied: permission = "denied"
            default: permission = "default"
            }
            self?.reply(requestId, data: ["permission": permission])
        }
    }

    private func authorize(_ requestId: String) {
        center.requestAuthorization(options: [.alert, .badge, .sound]) { [weak self] granted, error in
            if let error { self?.reply(requestId, error: error.localizedDescription) }
            else { self?.reply(requestId, data: ["permission": granted ? "granted" : "denied"]) }
        }
    }

    private func schedule(_ requestId: String, _ payload: [String: Any]) {
        guard let settings = payload["reminders"] as? [String: Any] else {
            reply(requestId, error: "Invalid reminder settings")
            return
        }
        let language = payload["language"] as? String ?? "en"
        center.getPendingNotificationRequests { [weak self] requests in
            guard let self else { return }
            let old = requests.map(\.identifier).filter { $0.hasPrefix("fittrack-") }
            self.center.removePendingNotificationRequests(withIdentifiers: old)
            var reminders: [(String, Int, Int, String, String)] = []
            if let water = settings["water"] as? [String: Any], water["enabled"] as? Bool == true,
               let every = water["everyMinutes"] as? Int,
               let start = self.minute(water["start"] as? String),
               let end = self.minute(water["end"] as? String), every >= 30 {
                for value in stride(from: start, through: end, by: every) {
                    reminders.append(("water-\(value)", value / 60, value % 60,
                        language == "bg" ? "Време е за вода" : "Time for water",
                        language == "bg" ? "Запиши чаша вода и продължи към дневната си цел." : "Log a glass and keep your daily target moving."))
                }
            }
            for (kind, titleEN, bodyEN, titleBG, bodyBG) in [
                ("workout", "Workout reminder", "Your planned training is ready.", "Напомняне за тренировка", "Планираната ти тренировка е готова."),
                ("weighIn", "Weigh-in reminder", "Record your weight for a consistent trend.", "Напомняне за тегло", "Запиши теглото си за последователно проследяване."),
            ] {
                if let item = settings[kind] as? [String: Any], item["enabled"] as? Bool == true,
                   let value = self.minute(item["time"] as? String) {
                    reminders.append((kind, value / 60, value % 60,
                        language == "bg" ? titleBG : titleEN,
                        language == "bg" ? bodyBG : bodyEN))
                }
            }
            let group = DispatchGroup()
            var failure: Error?
            for (identifier, hour, minute, title, body) in reminders.prefix(60) {
                let content = UNMutableNotificationContent()
                content.title = title
                content.body = body
                content.sound = .default
                let trigger = UNCalendarNotificationTrigger(
                    dateMatching: DateComponents(hour: hour, minute: minute), repeats: true)
                group.enter()
                self.center.add(UNNotificationRequest(identifier: "fittrack-\(identifier)", content: content, trigger: trigger)) { error in
                    if failure == nil { failure = error }
                    group.leave()
                }
            }
            group.notify(queue: .main) {
                if let failure { self.reply(requestId, error: failure.localizedDescription) }
                else { self.reply(requestId, data: ["scheduled": reminders.count]) }
            }
        }
    }

    private func test(_ requestId: String, _ payload: [String: Any]) {
        let content = UNMutableNotificationContent()
        content.title = payload["title"] as? String ?? "FitTrack"
        content.body = payload["body"] as? String ?? ""
        content.sound = .default
        center.add(UNNotificationRequest(
            identifier: "fittrack-test", content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
        )) { [weak self] error in
            if let error { self?.reply(requestId, error: error.localizedDescription) }
            else { self?.reply(requestId, data: ["scheduled": true]) }
        }
    }

    private func cancel(_ requestId: String) {
        center.getPendingNotificationRequests { [weak self] requests in
            let identifiers = requests.map(\.identifier).filter { $0.hasPrefix("fittrack-") }
            self?.center.removePendingNotificationRequests(withIdentifiers: identifiers)
            self?.reply(requestId, data: ["cancelled": identifiers.count])
        }
    }

    private func minute(_ value: String?) -> Int? {
        let parts = value?.split(separator: ":").compactMap { Int($0) } ?? []
        guard parts.count == 2, (0...23).contains(parts[0]), (0...59).contains(parts[1]) else { return nil }
        return parts[0] * 60 + parts[1]
    }

    private func reply(_ requestId: String, data: [String: Any]? = nil, error: String? = nil) {
        var detail: [String: Any] = ["requestId": requestId, "ok": error == nil]
        if let data { detail["data"] = data }
        if let error { detail["error"] = error }
        guard let bytes = try? JSONSerialization.data(withJSONObject: detail),
              let json = String(data: bytes, encoding: .utf8) else { return }
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(
                "window.dispatchEvent(new CustomEvent('fittrack-notification-result',{detail:\(json)}))")
        }
    }
}
