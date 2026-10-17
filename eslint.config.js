// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // The five rules the code broke 21 times when CI began (T-0555) were fixed in T-0563: they fail the check.
    rules: {
      "react-hooks/globals": "error",
      "react-hooks/purity": "error",
      "react-hooks/refs": "error",
      "react-hooks/set-state-in-effect": "error",
      "react/no-unescaped-entities": "error",
    },
  },
]);
