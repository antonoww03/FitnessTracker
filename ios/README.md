# FitTrack Apple Health bridge

HealthKit cannot be called by Safari or a Home Screen PWA. This directory
contains the native bridge used when the production React build is embedded in
a signed iOS `WKWebView` application.

1. Create an iOS app target in Xcode and enable the HealthKit capability.
2. Add `NSHealthShareUsageDescription` and
   `NSHealthUpdateUsageDescription` to `Info.plist`.
3. Add `HealthKitBridge.swift` and `FitTrackViewController.swift` to the target.
4. Set the root view controller to `FitTrackViewController` and add the
   production HTTPS address as `FitTrackBaseURL` in `Info.plist`.
5. If using a different WebView shell, create the bridge and register it:

```swift
let configuration = WKWebViewConfiguration()
let webView = WKWebView(frame: .zero, configuration: configuration)
let healthBridge = FitTrackHealthBridge(webView: webView, allowedHost: "fittrack.example.com")
configuration.userContentController.add(healthBridge, name: "fittrackHealth")
```

The bridge requests read access for body mass, steps, active energy and
workouts, and write access for body mass and workouts. FitTrack writes newly
logged weight and workouts after the user explicitly connects Apple Health.
The 30-day sync reports HealthKit totals to the Settings screen; it does not
silently overwrite manual FitTrack records.

An Apple Developer team, bundle identifier, provisioning profile, signed build
and App Store privacy declarations are still required before this can be
installed on an iPhone.
