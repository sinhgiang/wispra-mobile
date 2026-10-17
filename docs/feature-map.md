# Feature map

## Features

- Dictate (record, transcribe, recent entries): `src/app/(tabs)`, `src/lib/use-recording.ts`, `src/lib/transcriber.ts`, `src/lib/transcribe-queue.ts`; the first tab of the app.
- Meetings (record, transcript, notes, mind map, posts): `src/app/meeting`, `src/lib/meeting*.ts`, `src/components/wispra`; the Meetings tab.
- History and sync with Wispra Cloud: `src/lib/history-sync.ts`, `src/lib/entries-store.tsx`, `src/lib/cloud-*.ts`; the Account tab signs in.
- Vocabulary and learned words: `src/app/vocabulary.tsx`, `src/app/learned.tsx`, `src/lib/lexicon*.ts`, `src/lib/learned`.
- Wispra keyboard (iPhone, Swift): `targets/keyboard`, `modules/wispra-keyboard-bridge`; set up from Account, "Wispra keyboard".
- Mic button and keyboard (Android, Kotlin): `modules/wispra-dictation/android`; set up from Account.
- Builds: `.github/workflows/android.yml` and `ios.yml` (test builds), `codemagic.yaml` (TestFlight, started by a `build-*` tag), `.github/workflows/ci.yml` (lint, type check and Jest on every pull request).

## Run and check

- Open it: nothing runs on the owner's computer except tests and type checks (see `CLAUDE.md`). Builds run in the cloud.
- Test account: none needed for the checks below.
- Main flow to go through: `npm run lint`, `npm run typecheck`, `npm test` (the same three steps as `ci.yml`).
- Screenshot: no screenshot tool on this machine for the app; the Jest screen tests (`src/__tests__/screens.test.tsx`) cover the screens.
