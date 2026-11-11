import { FIXTURES_DIR } from "./fixtures.constants.ts";

const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TEST_NAME = /\.(test|spec)\.[^/]+$/;
const E2E_DIR = /(^|\/)e2e\//;
const NON_SOURCE_DIR: Readonly<RegExp> = /* @__PURE__ */ new RegExp(`(^|/)(${FIXTURES_DIR}|__snapshots__|__mocks__)/`);
const CONFIG_NAME = /\.config\.[^/]+$/;

/** True when the path is a test: a `*.test.*` or `*.spec.*` file, or a file under an `e2e/` folder. */
export function isTestFile(file: string): boolean {
  return TEST_NAME.test(file) || E2E_DIR.test(file);
}

/** True when the path is a code file (`.ts .tsx .mts .cts .js .jsx .mjs .cjs`). */
export function isCodeFile(file: string): boolean {
  return CODE.test(file);
}

/** A code file a change counts as source: not a test, a fixture, a snapshot, a mock or a config. */
export function isSource(file: string): boolean {
  return CODE.test(file) && !isTestFile(file) && !NON_SOURCE_DIR.test(file) && !CONFIG_NAME.test(file);
}
