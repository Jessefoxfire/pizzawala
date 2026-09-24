# PizzaWala iOS Mac handoff

This branch prepares the single iOS app for the shared PizzaWala 2.6 source. There is intentionally no separately installable iOS debug app. Xcode's Debug and Release configurations both use:

- App name: `PizzaWala`
- Bundle identifier: `com.pizzawala.app`
- Marketing version: `2.6`
- Build number: `17`
- Apple team currently recorded by the project: `3P23GA8YKC`

Running a Debug build from Xcode can replace the existing PizzaWala installation because it uses the same bundle identifier.

## 1. Update the source

In Terminal:

```sh
git clone https://github.com/Jessefoxfire/pizzawala.git
cd pizzawala
git fetch origin
git switch feature/ios-release-refresh
git pull --ff-only
```

If the repository already exists, start at `cd pizzawala`. Do not merge another branch into this handoff branch before the first successful build.

## 2. Install the locked toolchain

The repository expects Node `24.19.0`, Ruby `4.0.1`, Bundler `4.0.3`, CocoaPods `1.15.2`, and Xcode 26.x.

Using `nvm` and `rbenv`:

```sh
nvm install
nvm use
rbenv install -s 4.0.1
rbenv local 4.0.1
gem install bundler -v 4.0.3
bundle _4.0.3_ install
npm ci
```

If `nvm` or `rbenv` is unavailable, install it with Homebrew first. After installing Xcode, open it once, accept the license, and let it install additional components.

## 3. Supply the local Firebase iOS configuration

The Firebase file is intentionally ignored by Git and is not in the repository.

In Firebase Console:

1. Open the PizzaWala Firebase project.
2. Open **Project settings → General → Your apps**.
3. Select the iOS app whose bundle ID is exactly `com.pizzawala.app`. If it does not exist, register it first.
4. Download `GoogleService-Info.plist`.
5. Put it at exactly:

   `ios/PizzaWala/GoogleService-Info.plist`

Do not rename it and do not commit it. Confirm with:

```sh
/usr/libexec/PlistBuddy -c 'Print :BUNDLE_ID' ios/PizzaWala/GoogleService-Info.plist
```

The result must be `com.pizzawala.app`.

## 4. Install CocoaPods and run the preflight

From the repository root:

```sh
bundle _4.0.3_ exec pod install --project-directory=ios
chmod +x scripts/verify-ios-mac-setup.sh
./scripts/verify-ios-mac-setup.sh
```

Use the workspace from this point onward. Do not open the `.xcodeproj` directly:

```sh
open ios/PizzaWala.xcworkspace
```

## 5. Configure signing and capabilities in Xcode

In Xcode:

1. Select the blue **PizzaWala** project, then the **PizzaWala** target.
2. Open **Signing & Capabilities**.
3. Enable **Automatically manage signing**.
4. Select the Apple Developer team that owns `com.pizzawala.app`. The project currently records team `3P23GA8YKC`; use the owning team if Apple shows a different one.
5. Confirm the bundle identifier remains exactly `com.pizzawala.app`.
6. Add the **Push Notifications** capability if it is not present.
7. Add **Background Modes** and enable:
   - Location updates
   - Background fetch
   - Remote notifications

Xcode may create or update an entitlements file. Commit that file and the corresponding project-file change, but never commit signing certificates, provisioning profiles, `.p8` keys, or `GoogleService-Info.plist`.

For Firebase Cloud Messaging, open **Firebase Console → Project settings → Cloud Messaging** and verify that an APNs authentication key or certificate is configured for the iOS app. If one is already valid, do not replace it. If none exists, the Apple team Account Holder/Admin must create or provide the APNs key and upload it securely.

## 6. Install on the iPhone

1. Connect the iPhone by cable and tap **Trust** if asked.
2. On the iPhone, enable **Settings → Privacy & Security → Developer Mode** if Xcode requests it; the phone will restart.
3. In Xcode, choose the connected iPhone as the run destination.
4. Keep the **PizzaWala** scheme selected.
5. Press **Run** (`⌘R`).
6. If prompted on the phone, trust the developer profile under **Settings → General → VPN & Device Management**.

For the initial device build, Metro can be started from a second Terminal window:

```sh
npm start
```

Metro is configured for port `8082`. The Mac and iPhone must be able to reach each other on the same network. If the app reports that it cannot load the JavaScript bundle, first confirm macOS Firewall permits Node and that port 8082 is reachable.

## 7. Required smoke test

Do not archive until all of these pass on the physical iPhone:

1. App opens without requesting location.
2. Denying location does not block manual clock-in, manual worksite selection, hours, documents, or receipts.
3. Enabling Auto-Tracking or Worksite Alerts shows the feature-specific `Location required` notice before iOS permission prompts.
4. Password fields preserve capitalization and do not autocorrect.
5. Sign-in reaches the existing Firebase account and Firestore data loads.
6. Documents and member-edit modals move above the keyboard and retain Save taps.
7. The updated Documents requirement layout appears correctly.
8. Push-notification permission and a test Firebase notification work.
9. Camera/photo/document upload flows work.
10. Start, pause, resume, and end a manual shift; verify the resulting hours.

Known intentional gap: Android's compact shift-status chip is Android-native. The iOS ActivityKit/Live Activity equivalent is not included in this baseline build and should be a separate follow-up after this build is stable.

## 8. Create the release archive/TestFlight build

After the device smoke test:

1. Stop Metro and choose **Any iOS Device (arm64)** as the destination.
2. Select **Product → Archive**.
3. In Organizer, choose **Distribute App → App Store Connect → Upload** (or **TestFlight Internal Only**, if offered).
4. Keep automatic signing enabled and upload symbols.
5. In App Store Connect, wait for processing and add the build to an internal TestFlight group.

If App Store Connect says build `17` was already used, increment **Current Project Version** to the next unused integer for both Debug and Release configurations, commit that change, then archive again. Do not change the `2.6` marketing version unless the intended App Store version is different.

## 9. Return the Mac-side results

Send Dylan:

- Whether the physical-device Debug build passed.
- The first failing Xcode error in full, if any.
- Whether Firebase login/data and a push notification worked.
- Whether the TestFlight upload was accepted.
- Output of `git status --short` and `git diff -- ios` before committing Xcode-generated project changes.

Do not use Xcode's automatic **Perform Changes** migration on the first pass unless a build error specifically requires it; it can create a large unrelated project diff.
