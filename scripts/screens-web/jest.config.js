// Draws real Wispra screens with react-native-web, for pictures (see README.md in this folder).
// Run:  npx jest --config scripts/screens-web/jest.config.js
const preset = require('jest-expo/web/jest-preset');

// The project has no babel.config.js, and the web preset of jest-expo passes none of its own: say which
// Babel preset to use, as the project's other tests get it from jest-expo
const transform = {};
for (const [pattern, value] of Object.entries(preset.transform)) {
  transform[pattern] =
    Array.isArray(value) && value[0] === 'babel-jest' ? ['babel-jest', { presets: ['babel-preset-expo'], ...value[1] }] : value;
}

module.exports = {
  ...preset,
  transform,
  rootDir: '../..',
  testMatch: ['<rootDir>/scripts/screens-web/*.shots.tsx'],
  // Order matters (the first match wins): the project's own paths, then the preset's
  moduleNameMapper: {
    // Before the preset's catch-all for react-native/*, or the phone's own React Native is loaded
    '^react-native$': 'react-native-web',
    '^@/modules/(.*)$': '<rootDir>/modules/$1',
    '^@/assets/(.*)$': '<rootDir>/assets/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    ...preset.moduleNameMapper,
  },
};
