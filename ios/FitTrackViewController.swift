import UIKit
import WebKit

/// Minimal signed iOS shell for the hosted FitTrack PWA. Set FitTrackBaseURL
/// in Info.plist to the HTTPS production URL before building.
final class FitTrackViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private var webView: WKWebView!
    private var healthBridge: FitTrackHealthBridge!
    private var notificationBridge: FitTrackNotificationBridge!
    private var baseURL: URL!

    override func viewDidLoad() {
        super.viewDidLoad()
        guard
            let value = Bundle.main.object(forInfoDictionaryKey: "FitTrackBaseURL") as? String,
            let url = URL(string: value),
            url.scheme == "https",
            let host = url.host
        else {
            fatalError("FitTrackBaseURL must be an HTTPS URL")
        }
        baseURL = url
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        webView = WKWebView(frame: .zero, configuration: configuration)
        healthBridge = FitTrackHealthBridge(webView: webView, allowedHost: host)
        notificationBridge = FitTrackNotificationBridge(webView: webView, allowedHost: host)
        webView.configuration.userContentController.add(healthBridge, name: "fittrackHealth")
        webView.configuration.userContentController.add(notificationBridge, name: "fittrackNotifications")
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        webView.load(URLRequest(url: baseURL))
    }

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard navigationAction.request.url?.host == baseURL.host else {
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    @available(iOS 15.0, *)
    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        guard origin.host == baseURL.host, type == .camera else {
            decisionHandler(.deny)
            return
        }
        decisionHandler(.prompt)
    }

    deinit {
        webView?.configuration.userContentController.removeScriptMessageHandler(
            forName: "fittrackHealth"
        )
        webView?.configuration.userContentController.removeScriptMessageHandler(
            forName: "fittrackNotifications"
        )
    }
}
