# TBFT for macOS + Today widget

Native macOS companion for TBFT with a WidgetKit Today widget. The visual hierarchy deliberately mirrors the approved Android widget: translucent dark card, `TBFT · TODAY`, remaining-task count, hollow-circle task rows, and a quiet sync footer.

## What it uses

- The existing TBFT web app at `https://tbft.marzan.info` for sign-in/full workspace access.
- The existing `POST /api/widget/tasks` endpoint used by Android.
- A shared Keychain access group for the Supabase refresh token.
- An App Group for the last successful widget snapshot.
- WidgetKit timelines requesting a refresh roughly every 30 minutes. macOS ultimately decides the exact refresh time.

No Android code is changed by this project.

## Requirements

- macOS 14 or later
- Xcode 16 or later
- XcodeGen (`brew install xcodegen`)
- An Apple signing team with App Groups + Keychain Sharing enabled for the app and widget extension

## Generate the Xcode project

```bash
cd native/macos
xcodegen generate
open TBFTMac.xcodeproj
```

In Xcode, select your signing Team for both **TBFTMac** and **TBFTWidget**. Confirm these capabilities exist on both targets:

- App Groups: `group.info.marzan.tbft`
- Keychain Sharing: `info.marzan.tbft.shared`

The app target also needs the App Sandbox with outgoing network connections.

## First run

1. Run **TBFTMac**.
2. Click **Full app →**.
3. Sign into TBFT normally in the embedded web app.
4. Return to **Today**. The native screen should populate from the same widget API Android uses.
5. On the Mac desktop, open **Edit Widgets**, find **TBFT Today**, and add the size you want.

Clicking the widget opens the TBFT Mac companion back on its Today screen.

## Design mapping from Android

- Android 14dp widget padding → macOS 14pt widget padding
- Android `#26000000` rounded background → WidgetKit translucent black container background
- Android 13sp bold header → macOS 13pt bold header
- Android 11sp count → macOS 11pt count
- Android 14sp task rows → macOS 14pt task rows
- Android six visible tasks → macOS medium/large show up to six; small shows up to three
- Android hollow-circle task marker and carried/deadline text are preserved

## Security

The refresh token captured from the authenticated TBFT WebView is stored in the shared macOS Keychain access group. The cached task snapshot is stored in the App Group container. The widget never receives the user's password.

## CI

The repository workflow generates the Xcode project with XcodeGen and performs an unsigned macOS build so Swift/Xcode project breakages are caught without requiring distribution certificates.
