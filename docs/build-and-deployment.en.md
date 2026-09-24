# App development, packaging and deployment

[简体中文](build-and-deployment.md) · [Features and limits](../README.en.md)

## Environment and source development

Use Node >=22.11 and `npm ci`. Android requires SDK/Build Tools 36.0.0, NDK 27.1.12297006 and supports API 24+. JDK 21 from Android Studio JBR is suitable. Set `ANDROID_HOME` or the ignored `android/local.properties` for the SDK and `JAVA_HOME` for Java. Reuse existing installations; do not hardcode a developer's paths.

The current Windows machine uses `D:/tool/sdk/android`. Only if Java reports `Unable to establish loopback connection`, create `D:/tmp` and set `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=D:/tmp -Djava.io.tmpdir=D:/tmp`. This is a machine-specific workaround, not a general prerequisite.

Run `npm start`, then `npm run android` in another terminal. Authorize USB debugging and check `adb devices`. Use `adb reverse tcp:8081 tcp:8081` when forwarding Metro over USB. Source development is not a standalone demonstration package.

## Android packages

The npm entry points validate `config/deployment.json`. Direct Gradle builds also validate during configuration. Babel validates too, but native checks do not rely on Babel cache invalidation.

| Command | Output | Purpose |
| --- | --- | --- |
| `npm run android:standalone` | `android/app/build/outputs/apk/debug/app-debug.apk` | Embedded JS, developer support disabled, debug-signed acceptance APK |
| `npm run android:release` | `android/app/build/outputs/apk/release/app-release.apk` | Release APK signed with your own key |
| `npm run android:bundle` | `android/app/build/outputs/bundle/release/app-release.aab` | Signed store submission candidate; not directly installable with adb |

Scripts use the repository Gradle wrapper: `cmd.exe /d /c gradlew.bat` on Windows and `./gradlew` elsewhere. Architectures follow `android/gradle.properties`; do not restrict the whole project to one test phone.

Release builds require all four environment variables and fail without them; there is no debug-key fallback:

- `VINOTE_ANDROID_KEYSTORE`: absolute path to your signing keystore.
- `VINOTE_ANDROID_STORE_PASSWORD`: keystore password.
- `VINOTE_ANDROID_KEY_ALIAS`: signing alias.
- `VINOTE_ANDROID_KEY_PASSWORD`: signing key password.

Inject credentials through a secure local environment or CI secrets, never Git, command logs or deployment JSON. Updates require a compatible signing identity and an increasing versionCode. A production signature cannot overwrite a debug-signed installation. Export important recordings before any uninstall. A successful Release build does not imply store approval.

Install the acceptance APK using `adb -s <serial> install -r android/app/build/outputs/apk/debug/app-debug.apk`, then launch `adb -s <serial> shell am start -n com.vinoteapp/.MainActivity`. Standalone packages do not need USB or Metro, but retain their deployment network dependencies.

## iOS

On macOS run `npm ci`, `bundle install`, and `cd ios && bundle exec pod install`. Open `ios/VINoteApp.xcworkspace`. Development uses `npm run ios` from the repository root plus Metro. Physical devices require an Xcode development team and signing configuration.

Before archiving, run `npm run config:check`. In Xcode select a device/generic iOS destination and Release, then Product → Archive; export/distribute through Organizer using your provisioning configuration. No Windows script produces an installable IPA, and no iOS Release artifact has been verified. Audio conversion, import, background recording, local-network permission, ATS and direct authentication require Mac/iPhone validation. Android evidence does not verify iOS.

## Deployment configuration and public access

- `channel`: `lan` or `public`.
- `apiBaseUrl`: VILab Origin without path, query or credentials; the client appends API paths.
- `authBaseUrl`: HTTPS account Origin preserving `/auth/v1`, the Supabase project and auth semantics. The public publishable key lives in `src/config/env.ts`; never use a service_role key.
- `accountProxyHost` / `accountProxyPort`: Android account CONNECT endpoint. Port must be an integer from 1 to 65535. Public builds require an empty host, while the port remains a valid integer.

`lan` permits Android cleartext networking for the current HTTP service; `public` disables it. Public validation requires HTTPS DNS names and rejects IP literals, single-label hosts and known reserved suffixes. **It does not resolve DNS, detect private DNS answers or replace external end-to-end tests.**

Public distribution requires the operator to provision HTTPS ingress/a tunnel, DNS, certificates, upload limits and long-request timeouts. Then change JSON, rebuild and validate login, model listing, long audio, timeouts and retries over cellular data. No tunnel is currently deployed. Users are not expected to configure proxies themselves, but the current LAN build cannot claim to work on every network.

## Checks and data protection

Use `npm run config:check`, `npm run test:scripts`, `npm test -- --runInBand` and `npm run typecheck` for configuration, script regressions, app tests and types. Native builds and device acceptance are separate checks. Background capture does not imply background generation. Do not commit APKs, audio, transcripts, tokens, private keys or private screenshots.

The Gradle plugin also requires a discoverable JDK 17 toolchain. If installed but not detected, set org.gradle.java.installations.paths in the user-level ~/.gradle/gradle.properties to that installation; do not download a duplicate JDK. Review validated the standalone Gradle task graph and rejection of unsigned Release requests, not a newly produced APK or a production-signed package.
