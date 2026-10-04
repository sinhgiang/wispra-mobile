// The Wispra keyboard on iPhone (iOS keyboard extension), added to the Xcode project by
// @bacons/apple-targets at `expo prebuild`. Bundle id: com.sinhgiang.wispramobile.keyboard.
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'keyboard',
  name: 'WispraKeyboard',
  displayName: 'Wispra',
  bundleIdentifier: '.keyboard',
  // The keyboard and the app share words through a named pasteboard (same team), not an App
  // Group, so no extra capability has to be set up in the Apple Developer account
  deploymentTarget: '16.4',
};
