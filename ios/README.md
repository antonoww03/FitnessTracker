# FitTrack Apple Health bridge

HealthKit cannot be called by Safari or a Home Screen PWA. This directory
contains the native bridge used when the production React build is embedded in
a signed iOS `WKWebView` application.

1. Install XcodeGen on a Mac (`brew install xcodegen`) and run `xcodegen` from
   this directory. The checked-in `project.yml` creates the complete app target.
2. Replace `https://fittrack.example.com` in `FitTrack/Info.plist` with the
   deployed HTTPS URL and change the placeholder bundle identifier in
   `project.yml` to one owned by your Apple Developer team.
3. Open `FitTrack.xcodeproj`, select the signing team and confirm that the
   HealthKit capability is present. The entitlement and privacy descriptions
   are already included.
4. Build to a physical iPhone and approve Health access when prompted.
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
The native notification bridge requests alert permission from an explicit UI
action and schedules water, workout and weigh-in reminders with iOS, so they can
fire while the wrapper is closed. The camera prompt is restricted to the
configured FitTrack host.
The 30-day sync reports HealthKit totals to the Settings screen; it does not
silently overwrite manual FitTrack records.

An Apple Developer team, bundle identifier, provisioning profile, signed build
and final app icon/App Store privacy metadata are still required for release.
