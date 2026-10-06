// app.json holds the configuration; this only adds what a build provides:
// - APPLE_TEAM_ID: needed to sign the Wispra keyboard target (@bacons/apple-targets). The Codemagic
//   TestFlight workflow reads it from the installed App Store profile. Not a secret, just the
//   team's public identifier.
// - IOS_BUILD_NUMBER: set before `expo prebuild`, so the app and the keyboard extension get the
//   same build number (App Store Connect requires them to match).
module.exports = ({ config }) => ({
  ...config,
  ios: {
    ...config.ios,
    ...(process.env.APPLE_TEAM_ID ? { appleTeamId: process.env.APPLE_TEAM_ID } : {}),
    ...(process.env.IOS_BUILD_NUMBER ? { buildNumber: process.env.IOS_BUILD_NUMBER } : {}),
  },
});
