#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DERIVED_DATA="${DERIVED_DATA:-$ROOT/.derived-release}"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT/dist}"
CONFIGURATION="${CONFIGURATION:-Release}"
VERSION="${TBFT_RELEASE_VERSION:-1.0.0}"

required=(
  APPLE_TEAM_ID
  MACOS_CERTIFICATE_P12_BASE64
  MACOS_CERTIFICATE_PASSWORD
  MACOS_APP_PROFILE_BASE64
  MACOS_WIDGET_PROFILE_BASE64
  APP_STORE_CONNECT_KEY_ID
  APP_STORE_CONNECT_ISSUER_ID
  APP_STORE_CONNECT_PRIVATE_KEY
)

for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: $name" >&2
    exit 2
  fi
done

WORK_DIR="$(mktemp -d)"
KEYCHAIN_PATH="$WORK_DIR/tbft-signing.keychain-db"
KEYCHAIN_PASSWORD="$(uuidgen)$(uuidgen)"
CERTIFICATE_PATH="$WORK_DIR/developer-id.p12"
APP_PROFILE="$WORK_DIR/app.provisionprofile"
WIDGET_PROFILE="$WORK_DIR/widget.provisionprofile"
ASC_KEY_PATH="$WORK_DIR/AuthKey_${APP_STORE_CONNECT_KEY_ID}.p8"
APP_ENTITLEMENTS="$WORK_DIR/app-entitlements.plist"
WIDGET_ENTITLEMENTS="$WORK_DIR/widget-entitlements.plist"

cleanup() {
  security delete-keychain "$KEYCHAIN_PATH" >/dev/null 2>&1 || true
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

mkdir -p "$OUTPUT_DIR"
rm -rf "$DERIVED_DATA"

printf '%s' "$MACOS_CERTIFICATE_P12_BASE64" | /usr/bin/base64 -D > "$CERTIFICATE_PATH"
printf '%s' "$MACOS_APP_PROFILE_BASE64" | /usr/bin/base64 -D > "$APP_PROFILE"
printf '%s' "$MACOS_WIDGET_PROFILE_BASE64" | /usr/bin/base64 -D > "$WIDGET_PROFILE"
printf '%s' "$APP_STORE_CONNECT_PRIVATE_KEY" > "$ASC_KEY_PATH"
chmod 600 "$ASC_KEY_PATH"

security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security import "$CERTIFICATE_PATH" \
  -k "$KEYCHAIN_PATH" \
  -P "$MACOS_CERTIFICATE_PASSWORD" \
  -T /usr/bin/codesign \
  -T /usr/bin/security
security set-key-partition-list \
  -S apple-tool:,apple:,codesign: \
  -s \
  -k "$KEYCHAIN_PASSWORD" \
  "$KEYCHAIN_PATH" >/dev/null
security list-keychains -d user -s "$KEYCHAIN_PATH" login.keychain-db

SIGNING_IDENTITY="$(security find-identity -v -p codesigning "$KEYCHAIN_PATH" | awk -F '"' '/Developer ID Application/ { print $2; exit }')"
if [[ -z "$SIGNING_IDENTITY" ]]; then
  echo "No Developer ID Application identity was found in the supplied certificate." >&2
  exit 3
fi

echo "Using signing identity: $SIGNING_IDENTITY"

cd "$ROOT"
xcodegen generate

xcodebuild \
  -project TBFTMac.xcodeproj \
  -scheme TBFTMac \
  -configuration "$CONFIGURATION" \
  -sdk macosx \
  -derivedDataPath "$DERIVED_DATA" \
  MARKETING_VERSION="$VERSION" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  build

APP_PATH="$(find "$DERIVED_DATA/Build/Products/$CONFIGURATION" -maxdepth 1 -type d -name '*.app' -print -quit)"
if [[ -z "$APP_PATH" || ! -d "$APP_PATH" ]]; then
  echo "Built app bundle not found." >&2
  exit 4
fi

WIDGET_PATH="$(find "$APP_PATH/Contents/PlugIns" -maxdepth 1 -type d -name '*.appex' -print -quit)"
if [[ -z "$WIDGET_PATH" || ! -d "$WIDGET_PATH" ]]; then
  echo "Embedded widget extension not found." >&2
  exit 5
fi

# Embed the Developer ID provisioning profiles that authorize the restricted
# App Group / keychain entitlements for the app and its WidgetKit extension.
cp "$APP_PROFILE" "$APP_PATH/Contents/embedded.provisionprofile"
cp "$WIDGET_PROFILE" "$WIDGET_PATH/Contents/embedded.provisionprofile"

cp "$ROOT/TBFTMac/TBFTMac.entitlements" "$APP_ENTITLEMENTS"
cp "$ROOT/TBFTWidget/TBFTWidget.entitlements" "$WIDGET_ENTITLEMENTS"

/usr/libexec/PlistBuddy -c "Set :keychain-access-groups:0 ${APPLE_TEAM_ID}.info.marzan.tbft.shared" "$APP_ENTITLEMENTS"
/usr/libexec/PlistBuddy -c "Add :com.apple.application-identifier string ${APPLE_TEAM_ID}.info.marzan.tbft.macos" "$APP_ENTITLEMENTS"
/usr/libexec/PlistBuddy -c "Add :com.apple.developer.team-identifier string ${APPLE_TEAM_ID}" "$APP_ENTITLEMENTS"

/usr/libexec/PlistBuddy -c "Set :keychain-access-groups:0 ${APPLE_TEAM_ID}.info.marzan.tbft.shared" "$WIDGET_ENTITLEMENTS"
/usr/libexec/PlistBuddy -c "Add :com.apple.application-identifier string ${APPLE_TEAM_ID}.info.marzan.tbft.macos.widget" "$WIDGET_ENTITLEMENTS"
/usr/libexec/PlistBuddy -c "Add :com.apple.developer.team-identifier string ${APPLE_TEAM_ID}" "$WIDGET_ENTITLEMENTS"

/usr/libexec/PlistBuddy -c "Set :TBFT_KEYCHAIN_ACCESS_GROUP ${APPLE_TEAM_ID}.info.marzan.tbft.shared" "$APP_PATH/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :TBFT_KEYCHAIN_ACCESS_GROUP ${APPLE_TEAM_ID}.info.marzan.tbft.shared" "$WIDGET_PATH/Contents/Info.plist"

# Nested code must be signed before the containing app.
codesign \
  --force \
  --sign "$SIGNING_IDENTITY" \
  --options runtime \
  --timestamp \
  --entitlements "$WIDGET_ENTITLEMENTS" \
  "$WIDGET_PATH"

codesign \
  --force \
  --sign "$SIGNING_IDENTITY" \
  --options runtime \
  --timestamp \
  --entitlements "$APP_ENTITLEMENTS" \
  "$APP_PATH"

codesign --verify --deep --strict --verbose=2 "$APP_PATH"

PRE_NOTARY_ZIP="$WORK_DIR/TBFT-macOS-pre-notary.zip"
ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$PRE_NOTARY_ZIP"

xcrun notarytool submit "$PRE_NOTARY_ZIP" \
  --key "$ASC_KEY_PATH" \
  --key-id "$APP_STORE_CONNECT_KEY_ID" \
  --issuer "$APP_STORE_CONNECT_ISSUER_ID" \
  --wait

xcrun stapler staple "$APP_PATH"
xcrun stapler validate "$APP_PATH"
spctl --assess --type execute --verbose=2 "$APP_PATH"

FINAL_ZIP="$OUTPUT_DIR/TBFT-macOS-${VERSION}.zip"
rm -f "$FINAL_ZIP"
ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$FINAL_ZIP"

shasum -a 256 "$FINAL_ZIP" | tee "$FINAL_ZIP.sha256"
echo "Created: $FINAL_ZIP"
