# Pictures of Wispra screens without a phone

`notes.shots.tsx` draws the real Notes screens (the list, a note with its three views, the status menu) with
react-native-web, with sample notes and stand-ins for the store, the recording and the phone's files. It writes
one HTML page per picture. Open a page at a phone size (390 x 844) in any browser to take the picture.

```
npx jest --config scripts/screens-web/jest.config.js
```

The pages go to `WISPRA_SHOTS_DIR`, or `./.screens-web` when it is not set.

These are **not** screenshots from an iPhone: fonts and spacing differ a little from the phone. They show the
real components and the real words, so the owner can judge layout and wording before a TestFlight build.

It is not part of `npm test` or the pull request check: the file name ends in `.shots.tsx`, which the default
Jest run does not pick up.
