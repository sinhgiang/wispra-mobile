@AGENTS.md

# Rules from the owner

## One design for iPhone and Android (2026-10-05)

The owner's words: "bạn cứ thiết kế cái này đồng bộ luôn cả Android. Khi iOS nó hoàn thiện, coi như
Android nó cũng hoàn thiện luôn." (Design it in sync for Android too. When iOS is finished, Android
counts as finished too.)

- The owner tries the app and gives feedback **on iPhone only**.
- Every UI change, bug fix or feature the owner asks for on iPhone is also done for **Android, in the
  same pull request, with tests**, in the way that suits Android. For example, the Wispra keyboard:
  - on iPhone, a full keyboard with Telex, plus a listening session (keyboards there cannot use the
    microphone);
  - on Android, the same keyboard records directly, and the floating mic button over text fields
    is styled like the owner's design.
- Shared logic lives in TypeScript (`src/lib`). Native logic is mirrored, with the same test cases:
  - Swift: `targets/keyboard/`, tested by `targets-tests/keyboard/KeyboardTests.swift` in the iOS
    workflow;
  - Kotlin: `modules/wispra-dictation/android/`, with JUnit tests in the Android workflow.
- Do not add Android test items to the owner's waiting list (`helme wait add`) until the owner says
  the Google Play account is approved or that they want to do Android. Android must still build
  green on GitHub Actions.

## Building and testing

- **Nothing runs on the owner's computer except tests and type checks** (`npx jest`,
  `npx tsc --noEmit`). No Android emulator, no local Gradle build, no `expo start` / Metro, no React
  Native DevTools, no background process left running.
- **Typed routes:** add new routes by hand to `.expo/types/router.d.ts`, instead of running
  `expo start`.
- **Builds run in the cloud:**
  - `.github/workflows/android.yml`: tests, Kotlin tests, and a test APK on GitHub Releases;
  - `.github/workflows/ios.yml`: the keyboard's Swift tests and an unsigned iOS compile;
  - Codemagic (`codemagic.yaml`): the signed TestFlight build, started by a tag (below).

## A new iPhone build for the owner (T-0156)

The owner never opens Codemagic. When there is new code for the owner to try on iPhone:

1. The commit is pushed on its `helme/...` branch, and the iOS and Android workflows are green.
2. Tag that commit `build-<YYYYMMDD>-<HHMM>` (local time) and push only the tag:
   `git tag build-20261005-1300 <commit>` then `git push origin build-20261005-1300`.
   The tagged commit must contain the `triggering:` block of `codemagic.yaml`.
   Codemagic gets the tag through its GitHub App (no webhook or key to set up) and runs
   "iOS TestFlight".
3. Follow it from GitHub: the Codemagic app posts a check run named "iOS TestFlight" on the
   commit (`gh api repos/sinhgiang/wispra-mobile/commits/<sha>/check-runs`). Wait in bounded
   loops. A green build reaches the owner's internal TestFlight group "Internal" by itself,
   5 to 15 minutes later.
4. Then add one waiting item (`helme wait add --kind approve`), saying which build to try in
   TestFlight and how it differs from the build the owner has. Add a build item only when there is
   new code to try.

Branch pushes never start Codemagic, so tag only commits the owner should try. Builds use Codemagic
minutes.
