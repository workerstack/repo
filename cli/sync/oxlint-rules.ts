/** Size limits count code only: blank lines and comments are free. */
const CODE_LINES = { skipBlankLines: true, skipComments: true };

/** Every rule the base turns on; each is an error, none a warning. The `repo/` rules are `@workerstack/repo/lint`'s. */
export const RULES: Record<string, string | [string, Record<string, unknown>]> = {
  "repo/as-needs-reason": "error",
  "repo/boundaries": "error",
  "repo/class-file": "error",
  "repo/config-file": "error",
  "repo/deprecated-replacement": "error",
  "repo/entry-file": "error",
  "repo/env-in-config": "error",
  "repo/filename-matches-export": "error",
  "repo/index-file": "error",
  "repo/native-path-separator": "error",
  "repo/no-block-comment": "error",
  "repo/no-commented-out-code": "error",
  "repo/no-mock-of-subject": "error",
  "repo/no-module-side-effects": "error",
  "repo/no-module-state": "error",
  "repo/no-side-effect-import": "error",
  "repo/no-v8-ignore": "error",
  "repo/public-jsdoc": "error",
  "repo/skip-on-platform": "error",
  "repo/todo-needs-id": "error",
  "repo/types-file": "error",
  "unicorn/prefer-node-protocol": "error",
  "eslint/max-lines": ["error", { max: 200, ...CODE_LINES }],
  "eslint/max-lines-per-function": ["error", { max: 30, ...CODE_LINES }],
  "eslint/max-params": ["error", { max: 3 }],
  "eslint/complexity": ["error", { max: 10 }],
  "eslint/max-depth": ["error", { max: 4 }],
  "eslint/no-shadow": "error",
  "eslint/no-else-return": "error",
  "eslint/no-nested-ternary": "error",
  "eslint/no-param-reassign": "error",
  "eslint/no-await-in-loop": "error",
  "eslint/require-await": "error",
  "eslint/no-console": "error",
  "import/no-cycle": "error",
  "import/no-default-export": "error",
  // `repo/as-needs-reason` checks `x as T`; this refuses `<T>x`, which takes no reason comment. Object literals stay
  // free so `{} as T` reaches the reason check too.
  "typescript/consistent-type-assertions": ["error", { assertionStyle: "as", objectLiteralTypeAssertions: "allow" }],
  "typescript/no-explicit-any": "error",
  "typescript/no-non-null-assertion": "error",
  "typescript/no-floating-promises": "error",
  "typescript/no-unnecessary-condition": "error",
  "typescript/no-unsafe-argument": "error",
  "typescript/no-unsafe-assignment": "error",
  "typescript/no-unsafe-member-access": "error",
  "typescript/no-unsafe-return": "error",
  "typescript/no-unsafe-call": "error",
  "typescript/switch-exhaustiveness-check": "error",
  "vitest/valid-expect": ["error", { maxArgs: 2 }],
};

/** Rules the catalog lists that the base turns off, each with why. */
export const OFF_RULES: Readonly<Record<string, string>> = {
  "typescript/no-unsafe-type-assertion":
    "repo/as-needs-reason owns `as` (a narrowing assertion takes a reason comment), and disable comments are refused, so this rule would leave no way to write one",
};

/** Test rules, only in test files, where module-scope setup and printing are allowed. */
export const TEST_RULES: Record<string, string> = {
  "repo/no-module-state": "off",
  "vitest/expect-expect": "error",
  "vitest/no-conditional-tests": "error",
  "vitest/no-focused-tests": "error",
  "vitest/no-disabled-tests": "error",
  "vitest/warn-todo": "error",
  "eslint/no-console": "off",
};
