# Time Sensitive dose reminders (iOS) — pending Apple Developer Program

Dose reminders already ask for the Time Sensitive interruption level
(`interruptionLevel: "timeSensitive"` in `src/lib/reminders.ts`, supported by our
patch in `patches/@capacitor+local-notifications+7.0.7.patch`). iOS ignores the
request until the app is signed with the matching capability, so today the
alerts are delivered as ordinary notifications — nothing breaks.

With a paid Apple Developer Program account, two steps switch it on:

1. Create `ios/App/App/App.entitlements`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.developer.usernotifications.time-sensitive</key>
	<true/>
</dict>
</plist>
```

2. Point the target at it — add this line to **both** build configurations in
   `ios/App/App.xcodeproj/project.pbxproj`, next to `PRODUCT_BUNDLE_IDENTIFIER`:

```
				CODE_SIGN_ENTITLEMENTS = App/App.entitlements;
```

   (Or in Xcode: select the App target → Signing & Capabilities → + Capability →
   Time Sensitive Notifications, which writes both for you.)

Verified 2026-09-09 on the free personal team (3JAS9T7YLM): the app compiles,
but signing fails with

```
Provisioning profile "iOS Team Provisioning Profile: com.pillseek.app" doesn't
include the Time Sensitive Notifications capability.
```

Free personal teams cannot provision this entitlement, so the change was
reverted on the Mac. Re-apply after enrolment.

What it buys: the alert breaks through Focus and Do Not Disturb, shows the
larger banner with a TIME SENSITIVE label, and stays on screen longer — the
behaviour Apple intends for medication reminders.
