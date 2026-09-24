# VINote App

[简体中文](README.md) · [Build and deployment](docs/build-and-deployment.en.md) · [Android test evidence (Chinese)](docs/android-device-check-20260923.md)

A native React Native Community CLI app using Tamagui 2.7.7, without Expo. Both Android and iOS include native recording, importing, and audio chunking; background behavior still needs device validation across OS versions.

## Architecture and features

- Authentication connects directly to the configured Supabase project shared with desktop: password login, email OTP registration and email OTP password reset. Access and refresh tokens are stored in Keychain. Sign-out clears this device's credentials; desktop and phone may remain signed in simultaneously. The app does not require the desktop FastAPI process.
- Model requests go directly to VILab using `/v1/models`, `/v1/default-models`, `/v1/asr/transcriptions` and `/openai/v1/chat/completions`. Choices are stored per account on the phone and snapshotted when processing starts.
- Recording-only is the default and does not call AI. A draft is saved before recording; stopping saves original audio before optional processing. Rename, playback, system export/share, confirmed deletion and audio import through the system picker are available.
- Default titles use the local start time plus a recording label. Generated minutes can provide an AI topic title; manual titles are preserved. Imports use import time, not an inferred meeting time. Recording and note titles are independent.
- Long audio is decoded to 16 kHz mono PCM16 WAV and uploaded in chunks of at most 120 seconds. Successful chunks are checkpointed. Retrying with the same ASR model reuses them; changing ASR model restarts transcription. Each run retains its selected ASR and LLM models, extracts timestamped facts by section, drafts detailed minutes, then audits omissions, numbers, and actions. Each stage is checkpointed. Transient network/502/503/504 failures retry at most twice. After an interruption, reopening the app resumes pending tasks; failed tasks can be retried manually. There is no persistent server task or guaranteed background generation.
- Notes support search, Markdown rendering, rename and deletion. Deleting a note preserves its original recording. App notes identify their mobile origin; the desktop backend has its own generation-origin field. These labels do not synchronize data.
- One recording can produce multiple independent numbered note versions. Open each version from the recording library and share the selected version as a Markdown file through the system share sheet. Deleting a version keeps the original audio and other versions.
- **Recordings, notes and checkpoints are local to the phone and isolated by account. There is no cross-device sync. Uninstalling or clearing app data removes them; export important audio first.**

## Network and platform limits

`config/deployment.json` is the build-time deployment configuration; users have no configuration form. The current `lan` channel uses `http://192.168.1.143:9876` for VILab and HTTPS for Supabase. Android routes only account-domain requests through the CONNECT endpoint `192.168.1.101:7890`, which must remain reachable. iOS does not implement that proxy. A standalone APK works without USB/Metro, but cloud features still require access to these endpoints.

**No public tunnel has been deployed.** A public build requires the operator to provision stable HTTPS domain endpoints for both services and remove the account proxy. Static configuration validation does not prove DNS, TLS, upstream authentication or large-upload connectivity.

Android uses a microphone foreground service for recording and a dataSync foreground service with a notification while processing; system quotas and battery policies still apply. iOS declares background audio for recording and requests limited background execution time for processing. A long meeting can pause when iOS suspends the app; reopening it resumes from checkpoints. Calls, microphone contention, process termination, and low disk space can interrupt recording. An interrupted file is not guaranteed to be decodable. Speaker diarization is deferred and unavailable.

Client-source headers are backend hints, not authorization claims or user-facing login labels. Direct Supabase app logins **do not populate the desktop `auth_login_events` table**; centralized login auditing remains incomplete. Old desktop JWTs are not reused; sign in again after upgrading. Legacy recordings without an account owner are not reassigned automatically.

## Quick start

Use Node >=22.11, npm, the Android SDK/NDK, JDK and native tooling. iOS additionally requires macOS, Xcode and CocoaPods. See [build instructions](docs/build-and-deployment.en.md).

```sh
npm ci
npm run config:check
npm start
# In another terminal, after authorizing USB debugging:
npm run android
```

Source development uses Metro. If the phone cannot reach the development machine, run `adb reverse tcp:8081 tcp:8081`. `npm run android:standalone` builds a debug-signed APK with embedded JS and no Metro dependency. Production packages use a separate signing flow.

## Validation status

A public 39m10s Android speech sample completed 20 transcription chunks, failure recovery, hierarchical summarization, and local note saving; see the device evidence document. This does not certify all meeting quality, background generation, or long-duration recording integrity. Background capture showed service survival and file growth, but ending and replaying the complete recording still needs acceptance testing. A wired iPhone has run a debug build, authenticated, and processed the supplied meeting audio in the foreground; the new background behavior still needs lock-screen, app-switch, and termination testing.

```sh
npm test -- --runInBand
npm run typecheck
npm run test:scripts
```

The parent repository pins this repository at `VINote-app/` as a Git submodule. Push app commits before updating the parent gitlink. Do not commit APKs, generated files, private audio, sessions or signing credentials. Icon sources are in `assets/branding`; `python scripts/generate-icons.py` requires Pillow.
