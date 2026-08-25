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
- An Apple Developer Program membership for signed/notarized distribution
- Registered bundle IDs for:
  - `info.marzan.tbft.macos`
  - `info.marzan.tbft.macos.widget`
- App Group `group.info.marzan.tbft` enabled for both bundle IDs
- Keychain Sharing enabled for both bundle IDs

## Automated GitHub release — no Xcode work required

The workflow `.github/workflows/macos-release.yml` builds, signs, notarizes, staples, verifies, and uploads an installable TBFT `.zip` from a GitHub-hosted macOS runner.

Add these repository secrets in **GitHub → thebestfuckingteam → Settings → Secrets and variables → Actions**:

- `APPLE_TEAM_ID` — Apple Developer Team ID
- `MACOS_CERTIFICATE_P12_BASE64` — base64 of a **Developer ID Application** `.p12`
- `MACOS_CERTIFICATE_PASSWORD` — password used when exporting the `.p12`
- `MACOS_APP_PROFILE_BASE64` — base64 of the Developer ID provisioning profile for `info.marzan.tbft.macos`
- `MACOS_WIDGET_PROFILE_BASE64` — base64 of the Developer ID provisioning profile for `info.marzan.tbft.macos.widget`
- `APP_STORE_CONNECT_KEY_ID` — App Store Connect API key ID
- `APP_STORE_CONNECT_ISSUER_ID` — App Store Connect API issuer ID
- `APP_STORE_CONNECT_PRIVATE_KEY` — full contents of the `AuthKey_*.p8` private key

The two provisioning profiles must authorize the App Group `group.info.marzan.tbft` and the shared Keychain capability used by the app and widget.

To encode a certificate or provisioning profile on macOS without line wrapping:

```bash
base64 -i DeveloperID.p12 | pbcopy
base64 -i TBFTMac.provisionprofile | pbcopy
base64 -i TBFTWidget.provisionprofile | pbcopy
```

After the secrets exist:

1. Open **GitHub → Actions → macOS signed release**.
2. Choose **Run workflow**.
3. Enter a version such as `1.0.0`.
4. Wait for the release job to complete.
5. Download the `TBFT-macOS-<version>` artifact.
6. Unzip it and move the TBFT app into `/Applications`.
7. Open TBFT once, sign in, then add **TBFT Today** from macOS **Edit Widgets**.

The release script imports the Developer ID certificate only into a temporary runner keychain, signs the WidgetKit extension before the containing app, submits the package to Apple's notary service, staples the notarization ticket, runs Gatekeeper verification, and uploads the final archive plus a SHA-256 checksum.

## Local development with Xcode — optional

For local development only:

```bash
cd native/macos
brew install xcodegen
xcodegen generate
open TBFTMac.xcodeproj
```

Select your signing Team for both **TBFTMac** and **TBFTWidget**. Confirm these capabilities exist on both targets:

- App Groups: `group.info.marzan.tbft`
- Keychain Sharing: `info.marzan.tbft.shared`

The app target also needs the App Sandbox with outgoing network connections.

## First run

1. Open **TBFT**.
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

Apple signing credentials are stored only as encrypted GitHub Actions secrets. The workflow writes them to temporary files/keychains on the GitHub-hosted runner and removes the signing keychain at the end of the job.

## CI

`macOS widget build` runs on changes to the native project and performs an unsigned macOS build so Swift/Xcode project breakages are caught without distribution credentials.

`macOS signed release` is manual and only runs when explicitly started. It requires the Apple secrets above and produces the installable signed/notarized artifact.
