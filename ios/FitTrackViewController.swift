import UIKit
import WebKit

/// Minimal signed iOS shell for the hosted FitTrack PWA. Set FitTrackBaseURL
/// in Info.plist to the HTTPS production URL before building.
final class FitTrackViewController: UIViewController, WKNavigationDelegate {
    private var webView: WKWebView!
    private var healthBridge: FitTrackHealthBridge!
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
        webView = WKWebView(frame: .zero, configuration: configuration)
        healthBridge = FitTrackHealthBridge(webView: webView, allowedHost: host)
        configuration.userContentController.add(healthBridge, name: "fittrackHealth")
        webView.navigationDelegate = self
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

    deinit {
        webView?.configuration.userContentController.removeScriptMessageHandler(
            forName: "fittrackHealth"
        )
    }
}

