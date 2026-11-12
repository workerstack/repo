/** Size limits count code only: blank lines and comments are free. */
const CODE_LINES = { skipBlankLines: true, skipComments: true };

/** A rule's setting: its severity alone, or the severity followed by the rule's options. */
export type RuleSetting = string | [string, ...unknown[]];

/**
 * Every rule the base turns on; each is an error, none a warning. The `repo/` rules are `@workerstack/repo/lint`'s.
 * The written config lists them in this order, so a blank line starts each run of keys that is already sorted.
 */
export const RULES: Record<string, RuleSetting> = {
  "repo/as-needs-reason": "error",
  "repo/boundaries": "error",
  "repo/class-file": "error",
  "repo/config-file": "error",
  "repo/deprecated-replacement": "error",
  "repo/entry-file": "error",
  "repo/env-in-config": "error",
  "repo/filename-matches-export": "error",
  "repo/index-file": "error",
  "repo/max-line-width": "error",
  "repo/member-ordering": "error",
  "repo/naming-convention": "error",
  "repo/native-path-separator": "error",
  "repo/no-block-comment": "error",
  "repo/no-boolean-param": "error",
  "repo/no-chained-type-assertions": "error",
  "repo/no-commented-out-code": "error",
  "repo/no-module-mocking": "error",
  "repo/no-module-side-effects": "error",
  "repo/no-module-state": "error",
  "repo/no-object-parameters": "error",
  "repo/no-reflect-apply": "error",
  "repo/no-reflect-get": "error",
  "repo/no-shape-in-symbol-names": "error",
  "repo/no-side-effect-import": "error",
  "repo/no-unsafe-dictionary-type": "error",
  "repo/no-v8-ignore": "error",
  "repo/no-widen-then-assert": "error",
  "repo/public-jsdoc": "error",
  "repo/require-readable-spacing": "error",
  "repo/skip-on-platform": "error",
  "repo/todo-needs-id": "error",
  "repo/types-file": "error",
  "unicorn/prefer-node-protocol": "error",

  "oxc/no-accumulating-spread": "error",

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

  "typescript/strict-boolean-expressions": [
    "error",
    { allowNullableObject: false, allowNumber: false, allowString: false },
  ],

  "typescript/prefer-nullish-coalescing": "error",

  "eslint/eqeqeq": ["error", "always", { null: "ignore" }],
  // Keys sort by code point, as `repo fmt` sorts JSON keys; a blank line starts a group, so an object whose key order
  // is read as order keeps it through groups, each with a comment saying why.
  "eslint/sort-keys": ["error", "asc", { allowLineSeparatedGroups: true, caseSensitive: true, natural: false }],
  "typescript/consistent-type-definitions": ["error", "type"],
  "typescript/consistent-type-imports": "error",

  "eslint/func-style": ["error", "declaration", { allowArrowFunctions: false }],

  // One form per shape: a one-line body takes no braces, a body that spans lines or nests takes them,
  // and every branch of an if matches.
  "eslint/curly": ["error", "multi-or-nest", "consistent"],
  "eslint/prefer-template": "error",

  "eslint/no-lonely-if": "error",

  "eslint/max-nested-callbacks": ["error", { max: 3 }],
  "unicorn/switch-case-braces": "error",

  "unicorn/no-negated-condition": "error",

  "unicorn/no-lonely-if": "error",

  "unicorn/no-array-reduce": "error",

  "unicorn/no-array-for-each": "error",
  "unicorn/no-await-expression-member": "error",
  "unicorn/prefer-string-replace-all": "error",

  // an argument of `undefined` fills a required `T | undefined` parameter so dropping it fails tsc
  "unicorn/no-useless-undefined": ["error", { checkArguments: false }],
  "vitest/valid-expect": ["error", { maxArgs: 2 }],
};

/** Rules the catalog lists that the base turns off, each with why. */
export const OFF_RULES: Readonly<Record<string, string>> = {
  "eslint/id-length": "It fails `i` and `a` in short callbacks, where a longer name adds nothing.",
  "eslint/no-magic-numbers": "repo/magic-number owns magic numbers.",
  "eslint/no-negated-condition": "unicorn/no-negated-condition owns it and also covers ternaries.",
  "eslint/no-ternary": "eslint/no-nested-ternary already bounds ternaries, and a single one reads well.",
  "eslint/one-var": "One declaration per statement reads better than a chained declaration.",
  "typescript/explicit-function-return-type":
    "Inference of the return type is exact, so writing it out only repeats it.",
  "typescript/no-unsafe-type-assertion":
    "repo/as-needs-reason owns `as` (a narrowing assertion takes a reason comment), " +
    "and disable comments are refused, so this rule would leave no way to write one",
  "typescript/prefer-optional-chain": "It is a nursery rule whose autofix is dangerous.",
  "typescript/prefer-readonly-parameter-types": "It fails parameters of library types the repo cannot make readonly.",
  "unicorn/no-null": "JSON and the tsgo APIs return null, so the code has to handle it.",
  "vitest/prefer-expect-assertions": "vitest/expect-expect already checks that an assertion ran in each test.",
  "vitest/require-test-timeout": "The vitest config sets the timeout for every test.",
};

/** Test rules, only in test files, where module-scope setup and printing are allowed. */
export const TEST_RULES: Record<string, "off" | "error"> = {
  "eslint/no-console": "off",
  "repo/no-module-state": "off",
  "vitest/expect-expect": "error",
  "vitest/no-conditional-tests": "error",
  "vitest/no-disabled-tests": "error",
  "vitest/no-focused-tests": "error",
  "vitest/prefer-called-with": "error",
  "vitest/prefer-strict-equal": "error",
  "vitest/warn-todo": "error",
};
