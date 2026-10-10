# VINote App

[简体中文](README.md) · [Build and deployment](docs/build-and-deployment.en.md) · [Android test evidence (Chinese)](docs/android-device-check-20260923.md)

A native React Native Community CLI app using shared native components and a neutral theme, without Expo. Both Android and iOS include native recording, importing, and audio chunking; background behavior still needs device validation across OS versions.

## Architecture and features

- v0.1.1 refreshes the icon and interface. Home provides recording, direct audio import, the latest recording and the latest note; login focuses on account actions.
- Authentication connects directly to the configured Supabase project shared with desktop: password login, email OTP registration and email OTP password reset. Access and refresh tokens are stored in Keychain. Sign-out clears this device's credentials; desktop and phone may remain signed in simultaneously. The app does not require the desktop FastAPI process.
- Model requests go directly to VILab using `/v1/models`, `/v1/default-models`, `/v1/asr/transcriptions` and `/openai/v1/chat/completions`. Choices are stored per account on the phone and snapshotted when processing starts.
- Recording-only is the default and does not call AI. A draft is saved before recording; stopping saves original audio before optional processing. Rename, playback, system export/share, confirmed deletion and audio import through the system picker are available.
- Default titles use the local start time plus a recording label. Generated minutes can provide an AI topic title; manual titles are preserved. Imports use import time, not an inferred meeting time. Recording and note titles are independent.
- Audio is prepared as 16 kHz mono PCM16 WAV. Standard WAV input is copied to an independent cache; recordings up to 60 seconds upload directly. Longer recordings use chunks of at most 60 seconds with at most two ASR requests in parallel. Results retain source order; checkpoints support out-of-order completion and legacy contiguous progress. Retry reuses completed chunks and validated prepared audio; evicted cache files rebuild automatically. Changing ASR model restarts transcription.
- Each run retains its ASR/LLM selection. Transcripts up to 8,000 characters draft directly and audit against the original text. Longer text extracts facts in blocks up to 6,000 characters with at most two concurrent calls, merging when needed before drafting and auditing. Minutes follow the actual topics and discussion: paragraphs, bullets and headings are chosen as needed, without fixed sections, order or word targets. Necessary context, reasoning, key numbers, conditions, differing opinions and explicit actions remain; the full transcript is saved separately. Transient network/429/502/503/504 failures retry at most twice. Reopening the app resumes pending tasks; failed tasks allow manual retry. Background generation is not guaranteed.
- Model lists use an account-scoped 60-second cache and deduplicate concurrent requests; explicit refresh reloads from the service. Recording metadata stores `processingTimings` for preparation, slicing, ASR requests (upload plus response), summary calls and total waiting time, without credentials or media content. Parallel request durations must not be added together as total waiting time.
- Notes support search, Markdown rendering, rename and deletion. Deleting a note preserves its original recording. App notes identify their mobile origin; the desktop backend has its own generation-origin field. These labels do not synchronize data.
- One recording can produce multiple independent numbered note versions. Open each version from the recording library and share the selected version as a Markdown file through the system share sheet. Deleting a version keeps the original audio and other versions.
- **Recordings, notes and checkpoints are local to the phone and isolated by account. There is no cross-device sync. Uninstalling or clearing app data removes them; export important audio first.**

## Network and platform limits

Public Android account requests honor the system network proxy. Some networks reset direct Supabase TLS connections; sign-in and token refresh then require a reachable network or a system proxy. This release does not include a public authentication gateway.

Explicit Aliyun or Volcengine empty-transcript ASR errors are saved as empty chunks so later chunks can continue. All-empty recordings still fail, and other service errors retain their retry/failure behavior.
Test packages use VILab `http://192.168.1.143:9876`; production packages use `https://api.orulink.ai`. Both use the same HTTPS Supabase account project. Android test builds route account requests through `192.168.1.101:7890`; production has no LAN account proxy. Build commands select the deployment profile, so users need no configuration form.

The public VILab HTTPS origin is configured. Static configuration validation does not prove DNS, TLS, upstream authentication or large-upload connectivity. Test packages still require LAN access.

Android uses a microphone foreground service for recording and a dataSync foreground service with a notification while processing; system quotas and battery policies still apply. iOS declares background audio for recording and requests limited background execution time for processing. A long meeting can pause when iOS suspends the app; reopening it resumes from checkpoints. Calls, microphone contention, process termination, and low disk space can interrupt recording. An interrupted file is not guaranteed to be decodable. Speaker diarization is deferred and unavailable.

Client-source headers are backend hints, not authorization claims or user-facing login labels. Direct Supabase app logins **do not populate the desktop `auth_login_events` table**; centralized login auditing remains incomplete. Old desktop JWTs are not reused; sign in again after upgrading. Legacy recordings without an account owner are not reassigned automatically.

## Quick start

Use Node >=22.11, npm, the Android SDK/NDK, JDK and native tooling. iOS additionally requires macOS, Xcode and CocoaPods. See [build instructions](docs/build-and-deployment.en.md).

```sh
npm ci
npm run config:check
npm run android:test:debug      # LAN VINote Test with Metro
npm run android:test:apk        # Standalone LAN APK
npm run android:vinote:debug    # Public VINote Dev with Metro
npm run android:vinote:apk      # Signed public APK
```

Debug modes use Metro. If the phone cannot reach the development machine, run `adb reverse tcp:8081 tcp:8081`. Public Debug uses a separate package ID so its debug signature cannot overwrite production. Both APK modes embed JS; see the [build instructions](docs/build-and-deployment.en.md).

## Validation status

A public 39m10s Android speech sample completed 20 transcription chunks, failure recovery, hierarchical summarization, and local note saving; see the device evidence document. This does not certify all meeting quality, background generation, or long-duration recording integrity. Background capture showed service survival and file growth, but ending and replaying the complete recording still needs acceptance testing. A wired iPhone has run a debug build, authenticated, and processed the supplied meeting audio in the foreground; the new background behavior still needs lock-screen, app-switch, and termination testing.

```sh
npm test -- --runInBand
npm run typecheck
npm run test:scripts
```

The parent repository pins this repository at `VINote-app/` as a Git submodule. Push app commits before updating the parent gitlink. Do not commit APKs, generated files, private audio, sessions or signing credentials. Icon sources are in `assets/branding`; `python scripts/generate-icons.py` requires Pillow.

### Streaming meeting summaries

Summary stages use the public OpenAI-compatible SSE API and native XMLHttpRequest incremental text, showing received character counts. Checkpoints require a complete terminal marker and a successful finish; interrupted or truncated output cannot become a note. Existing complete transcripts and successful fact checkpoints remain reusable. Each streaming request has a finite 15-minute total bound; service availability and background limits still apply. Timings include transcription wall time and time to first summary content (network and service waiting included). Streaming prevents prolonged response silence; it does not guarantee faster ASR or model generation.
