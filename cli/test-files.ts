const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** True when the path is a test: a `*.test.*` or `*.spec.*` file, or a file under an `e2e/` folder. */
export function isTestFile(file: string): boolean {
  return /\.(test|spec)\.[^/]+$/.test(file) || /(^|\/)e2e\//.test(file);
}

/** True when the path is a code file (`.ts .tsx .mts .cts .js .jsx .mjs .cjs`). */
export const isCodeFile = (file: string): boolean => CODE.test(file);

/** A code file a change counts as source: not a test, a fixture, a snapshot, a mock or a config. */
export const isSource = (file: string): boolean =>
  CODE.test(file) &&
  !isTestFile(file) &&
  !/(^|\/)(fixtures|__snapshots__|__mocks__)\//.test(file) &&
  !/\.config\.[^/]+$/.test(file);
