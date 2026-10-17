# App development, packaging and deployment

[简体中文](build-and-deployment.md) · [Features and limits](../README.en.md)

## Environment and source development

Use Node >=22.11 and `npm ci`. Android requires SDK/Build Tools 36.0.0, NDK 27.1.12297006 and supports API 24+. JDK 21 from Android Studio JBR is suitable. Set `ANDROID_HOME` or the ignored `android/local.properties` for the SDK and `JAVA_HOME` for Java. Reuse existing installations; do not hardcode a developer's paths.

The current Windows machine uses `D:/tool/sdk/android`. Only if Java reports `Unable to establish loopback connection`, create `D:/tmp` and set `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=D:/tmp -Djava.io.tmpdir=D:/tmp`. This is a machine-specific workaround, not a general prerequisite.

Use one of the four Android commands below. Debug commands start Metro and install on a connected device. Check USB or wireless debugging with `adb devices`; use `adb reverse tcp:8081 tcp:8081` when forwarding Metro. If starting Metro separately, select the channel first with `npm run config:test` or `npm run config:public`.

## Android packages

VINote Test uses the LAN VILab at http://192.168.1.143:9876; VINote uses the public VILab at https://api.orulink.ai. Scripts select the matching profile. Both use the same Supabase account project; public builds have no LAN account proxy.

For direct Gradle builds select a channel first and pass `-PvinoteChannel=test` or `-PvinoteChannel=public`; public Debug requires the explicit public property. Build different channels sequentially because they share the generated deployment file and Metro state.

| Command | Output | Purpose |
| --- | --- | --- |
| `npm run android:test:debug` | VINote Test, `com.vinoteapp.test` | LAN source debug with Metro |
| `npm run android:test:apk` | `artifacts/android/vinote-test.apk` | Standalone LAN APK with embedded JS and debug signature |
| `npm run android:vinote:debug` | VINote Dev, `com.vinoteapp.dev` | Public source debug with Metro and a separate package ID |
| `npm run android:vinote:apk` | `artifacts/android/vinote.apk` | Public Release APK with production signing |
| `npm run android:bundle` | `android/app/build/outputs/bundle/release/app-release.aab` | Signed store submission candidate; not directly installable with adb |

`android:standalone` and `android:release` remain aliases. Debug commands accept `-- --device <serial>`. Both Debug channels use the same `app-debug.apk` output path, so the later build replaces that file. Public Debug cannot overwrite or share local recordings with the signed production app.

Scripts use the repository Gradle wrapper: `cmd.exe /d /c gradlew.bat` on Windows and `./gradlew` elsewhere. Architectures follow `android/gradle.properties`; do not restrict the whole project to one test phone.

Release builds require all four environment variables and fail without them; there is no debug-key fallback:

- `VINOTE_ANDROID_KEYSTORE`: absolute path to your signing keystore.
- `VINOTE_ANDROID_STORE_PASSWORD`: keystore password.
- `VINOTE_ANDROID_KEY_ALIAS`: signing alias.
- `VINOTE_ANDROID_KEY_PASSWORD`: signing key password.

Inject credentials through a secure local environment or CI secrets, never Git, command logs or deployment JSON. Updates require a compatible signing identity and an increasing versionCode. A production signature cannot overwrite a debug-signed installation. Export important recordings before any uninstall. A successful Release build does not imply store approval.

Install the acceptance APK using `adb -s <serial> install -r artifacts/android/vinote-test.apk`, then launch `adb -s <serial> shell am start -n com.vinoteapp.test/com.vinoteapp.MainActivity`. Standalone packages do not need USB or Metro, but retain their deployment network dependencies.

## iOS

On macOS run `npm ci`, `bundle install`, and `cd ios && bundle exec pod install`. Open `ios/VINoteApp.xcworkspace`. Development uses `npm run ios` from the repository root plus Metro. Physical devices require an Xcode development team and signing configuration.

Before archiving production, run `npm run config:public` and `npm run config:check`; for test archives use `npm run config:test` and `npm run config:check`. In Xcode select a device/generic iOS destination and Release, then Product → Archive; export/distribute through Organizer using your provisioning configuration. No Windows script produces an installable IPA, and no iOS Release artifact has been verified. Audio conversion, import, background recording, local-network permission, ATS and direct authentication require Mac/iPhone validation. Android evidence does not verify iOS.

## Deployment configuration and public access

- `channel`: `lan` or `public`.
- `apiBaseUrl`: VILab Origin without path, query or credentials; the client appends API paths.
- `authBaseUrl`: HTTPS account Origin preserving `/auth/v1`, the Supabase project and auth semantics. The public publishable key lives in `src/config/env.ts`; never use a service_role key.
- `accountProxyHost` / `accountProxyPort`: Android account CONNECT endpoint. Port must be an integer from 1 to 65535. Public builds require an empty host, while the port remains a valid integer.

Public Android Supabase account requests honor the system `ProxySelector`; business APIs and Metro retain direct connections. Networks that reset Supabase TLS connections require a reachable network or a system proxy. This release does not provide a public authentication gateway. For a standalone public Debug acceptance APK, select the public configuration and run `gradlew assembleDebug -PvinoteStandalone=true -PvinoteChannel=public`; it embeds JavaScript and uses the separate debug-signed `com.vinoteapp.dev` identity.

`lan` permits Android cleartext networking for the current HTTP service; `public` disables it. Public validation requires HTTPS DNS names and rejects IP literals, single-label hosts and known reserved suffixes. **It does not resolve DNS, detect private DNS answers or replace external end-to-end tests.**

The public VILab HTTPS origin is configured. The operator must still verify DNS, certificates, upload limits and long-request timeouts, then validate login, model listing, long audio, timeouts and retries over cellular data. Users do not configure proxies; test packages require LAN access.

## Checks and data protection

Use `npm run config:check`, `npm run test:scripts`, `npm test -- --runInBand` and `npm run typecheck` for configuration, script regressions, app tests and types. Native builds and device acceptance are separate checks. Background capture does not imply background generation. Do not commit APKs, audio, transcripts, tokens, private keys or private screenshots.

The Gradle plugin also requires a discoverable JDK 17 toolchain. If installed but not detected, set org.gradle.java.installations.paths in the user-level ~/.gradle/gradle.properties to that installation; do not download a duplicate JDK. Review validated the standalone Gradle task graph and rejection of unsigned Release requests, not a newly produced APK or a production-signed package.


## 0.1.4 standalone configuration / 独立包配置

Android versionName / npm / iOS MARKETING_VERSION: **0.1.4**; Android versionCode: **9**; iOS CURRENT_PROJECT_VERSION: **5** (independent build sequence).

内网独立 APK 为混合配置：模型直连接口为 `http://192.168.1.143:9876`，账号为公网 Supabase，`integrationBaseUrl` 与 `generationBaseUrl` 均为 `https://supabase-vinote.orulink.ai/vinote-api`。链接/上传笔记由公网内容后端执行，其模型服务地址由服务器配置；不会因 App 的 LAN 模型地址而转走 LAN。两侧所选模型 ID 必须兼容，失败不自动换模型。

The LAN standalone APK combines direct LAN model access with public authentication, content processing and Feishu. Link/upload notes execute on the public content backend, whose model origin is configured server-side; this is not an all-LAN package. Public APKs use the public model origin too.

All embedded APK/AAB entry points require explicit content and integration URLs before invoking native build commands, including direct Gradle `-PvinoteStandalone=true`. Release additionally requires the public channel and release signing. `npm run config:check:release` checks the public channel and both service URLs without building; signing credentials are checked by Gradle. Metro development retains its loopback content service. See [0.1.4](releases/0.1.4.md). 本次仅离线测试，未重新构建、安装或验收两包。
