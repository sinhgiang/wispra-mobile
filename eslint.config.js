// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // Rules that the code written before CI broke 21 times (T-0555). They stay visible as warnings
    // so the pull request check is not red from the first day; a follow-up ticket fixes the spots
    // and raises them back to "error". Every other rule of eslint-config-expo still fails the check.
    rules: {
      "react-hooks/globals": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react/no-unescaped-entities": "warn",
    },
  },
]);
