// The Wispra keyboard on iPhone (iOS keyboard extension), added to the Xcode project by
// @bacons/apple-targets at `expo prebuild`. Bundle id: com.sinhgiang.wispramobile.keyboard.
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'keyboard',
  name: 'WispraKeyboard',
  displayName: 'Wispra',
  bundleIdentifier: '.keyboard',
  deploymentTarget: '16.4',
  // The keychain group shared with the app: the session status and the words come through it, since
  // iOS refuses the pasteboard to Wispra while it runs in the background (T-0163, SharedChannel.swift).
  // The App Store profiles allow <team>.* already, so nothing is registered with Apple.
  entitlements: {
    'keychain-access-groups': ['$(AppIdentifierPrefix)com.sinhgiang.wispramobile.shared'],
  },
};
