#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FIREBASE_PLIST="$ROOT_DIR/ios/PizzaWala/GoogleService-Info.plist"
EXPECTED_BUNDLE_ID="com.pizzawala.app"

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

[[ "$(uname -s)" == "Darwin" ]] || fail "This check must run on macOS."

for command_name in node npm ruby bundle xcodebuild; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is not installed or not on PATH."
done

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAJOR" -ge 20 ]] || fail "Node 20 or newer is required; found $(node --version)."

XCODE_MAJOR="$(xcodebuild -version | awk 'NR == 1 { split($2, version, "."); print version[1] }')"
[[ "$XCODE_MAJOR" -ge 26 ]] || fail "Xcode 26 or newer is required; found $(xcodebuild -version | head -n 1)."

[[ -f "$FIREBASE_PLIST" ]] || fail "Missing $FIREBASE_PLIST. Download it from the Firebase iOS app for $EXPECTED_BUNDLE_ID."

FIREBASE_BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :BUNDLE_ID' "$FIREBASE_PLIST" 2>/dev/null || true)"
[[ "$FIREBASE_BUNDLE_ID" == "$EXPECTED_BUNDLE_ID" ]] || fail "Firebase plist bundle ID is '$FIREBASE_BUNDLE_ID'; expected '$EXPECTED_BUNDLE_ID'."

[[ -d "$ROOT_DIR/ios/PizzaWala.xcworkspace" ]] || fail "PizzaWala.xcworkspace is missing."

grep -q 'buildConfiguration = "Release"' "$ROOT_DIR/ios/PizzaWala.xcodeproj/xcshareddata/xcschemes/PizzaWala.xcscheme" || fail "The shared PizzaWala scheme is not configured for Release."
grep -q 'main", withExtension: "jsbundle"' "$ROOT_DIR/ios/PizzaWala/AppDelegate.swift" || fail "AppDelegate is not configured for the embedded JavaScript bundle."
if grep -q 'RCTBundleURLProvider' "$ROOT_DIR/ios/PizzaWala/AppDelegate.swift"; then
  fail "AppDelegate still contains a Metro bundle provider."
fi

cd "$ROOT_DIR"
bundle check >/dev/null || fail "Ruby gems are missing. Run: bundle _4.0.3_ install"

echo "PizzaWala iOS Mac preflight passed."
echo "Node: $(node --version)"
echo "Ruby: $(ruby --version)"
echo "Bundler: $(bundle --version)"
echo "Xcode: $(xcodebuild -version | tr '\n' ' ')"
echo "Firebase bundle ID: $FIREBASE_BUNDLE_ID"
