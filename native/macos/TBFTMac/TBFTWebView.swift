import AppKit
import SwiftUI
import WebKit

struct TBFTWebView: NSViewRepresentable {
    private static let homeURL = URL(string: "https://tbft.marzan.info")!
    private static let homeHost = "tbft.marzan.info"

    let onSessionCaptured: (String) -> Void

    init(onSessionCaptured: @escaping (String) -> Void) {
        self.onSessionCaptured = onSessionCaptured
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onSessionCaptured: onSessionCaptured)
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.userContentController.add(context.coordinator, name: "tbftSession")

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        context.coordinator.webView = webView
        webView.load(URLRequest(url: Self.homeURL))
        return webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {}

    static func dismantleNSView(_ nsView: WKWebView, coordinator: Coordinator) {
        nsView.configuration.userContentController.removeScriptMessageHandler(forName: "tbftSession")
        nsView.navigationDelegate = nil
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        weak var webView: WKWebView?
        let onSessionCaptured: (String) -> Void

        init(onSessionCaptured: @escaping (String) -> Void) {
            self.onSessionCaptured = onSessionCaptured
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard webView.url?.host?.lowercased() == TBFTWebView.homeHost else { return }
            captureSession(in: webView)
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }

            if url.scheme == "https" && url.host?.lowercased() == TBFTWebView.homeHost {
                decisionHandler(.allow)
                return
            }

            if url.scheme == "about" {
                decisionHandler(.allow)
                return
            }

            if navigationAction.navigationType == .linkActivated {
                NSWorkspace.shared.open(url)
                decisionHandler(.cancel)
                return
            }

            decisionHandler(.allow)
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "tbftSession",
                  let token = message.body as? String,
                  !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                return
            }
            onSessionCaptured(token)
        }

        private func captureSession(in webView: WKWebView) {
            let script = #"""
            (function(){
              try {
                for (var i = 0; i < localStorage.length; i++) {
                  var key = localStorage.key(i);
                  if (!key) continue;
                  if (key.indexOf('sb-') === 0 && key.indexOf('-auth-token') > 0) {
                    var raw = localStorage.getItem(key);
                    if (!raw) continue;
                    var obj = JSON.parse(raw);
                    var token = obj && obj.refresh_token;
                    if (token) {
                      window.webkit.messageHandlers.tbftSession.postMessage(token);
                      return 'ok';
                    }
                  }
                }
              } catch (e) {}
              return 'none';
            })();
            """#
            webView.evaluateJavaScript(script, completionHandler: nil)
        }
    }
}
