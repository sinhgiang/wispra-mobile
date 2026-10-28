// The Live Activity shown while Wispra records (T-1073): a small wave in the Dynamic Island, and on the
// lock screen (the only place on iPhones without a Dynamic Island). A widget extension with no widgets
// of its own, added to the Xcode project by @bacons/apple-targets at `expo prebuild`.
// Bundle id: com.sinhgiang.wispramobile.recording.
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'widget',
  name: 'WispraRecording',
  displayName: 'Wispra recording',
  bundleIdentifier: '.recording',
  // Live Activities need iOS 16.2; the app itself is 16.4 or later
  deploymentTarget: '16.4',
};
