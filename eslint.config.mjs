import { defineConfig, globalIgnores } from "eslint/config";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default defineConfig([globalIgnores([
  "**/node_modules/",
  "**/dist/",
  "src/utils/youtube-notifier/**/*",
  "**/build.js",
  "**/*.spec.ts",
  "jest.config.js",
  "eslint.config.mjs",
  "**/SDK/"
]), {
  files: ["**/*.ts"],

  plugins: {
    "@typescript-eslint": typescriptEslint,
  },

  languageOptions: {
    parser: tsParser,
    ecmaVersion: "latest",
    sourceType: "module",

    parserOptions: {
      project: ["./tsconfig.json"],
    },
  },

  rules: {
    ...typescriptEslint.configs.recommended.rules,
    indent: ["error", 2, {
      SwitchCase: 1,
    }],
    semi: ["error", "always"],
    "no-async-promise-executor": "off",
    "@typescript-eslint/no-var-requires": "off",
    "no-constant-condition": "off",
    "@typescript-eslint/no-unused-vars": "error",
    "@typescript-eslint/no-unnecessary-template-expression": "error",
    eqeqeq: ["error", "always"],
    "no-trailing-spaces": ["error"],
    "spaced-comment": [
      "error",
      "always",
      {
        "markers": ["!"]
      }
    ],
    "object-curly-spacing": ["error", "always"],
    "@typescript-eslint/consistent-type-imports": "error",
    "lines-between-class-members": [
      'error',
      'always',
      { 'exceptAfterSingleLine': true }
    ]
  },
}]);