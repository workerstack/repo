import { afterEach, expect, it, vi } from "vitest";
import { main } from "./ci.ts";
import { cleanTemps, consumer, read, SLOW, srcConfig, tempDir, TSCONFIG, write } from "./fixtures/turn-repo.ts";

afterEach(() => {
  cleanTemps();
  vi.restoreAllMocks();
});

const PIN = `bun@${Bun.version}`;
const MANIFEST = `${JSON.stringify(
  {
    name: "app",
    type: "module",
    private: true,
    sideEffects: false,
    packageManager: PIN,
    devDependencies: { vitest: "*", "@vitest/coverage-istanbul": "*" },
  },
  null,
  2,
)}\n`;
/** The two lint findings a test that skips itself at runtime has, which the baseline allows. */
const BASELINE = `${JSON.stringify({ "src/answer.test.ts": { "repo(skip-on-platform)": 1, "vitest(expect-expect)": 1 } }, null, 2)}\n`;
const ANSWER = "export const answer = 42;\n";
const ANSWER_TEST =
  'import { expect, it } from "vitest";\nimport { answer } from "./answer.ts";\n\nit("answers", () => {\n  expect(answer).toBe(42);\n});\n';
const VITEST_CONFIG = 'export default { test: { coverage: { provider: "istanbul", include: ["src/**"] } } };\n';

/** Runs `repo ci` in `root` with the process's own writers and real tools, collecting what it wrote. */
function realCi(root: string, argv: string[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => out.push(String(chunk)) > 0);
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => err.push(String(chunk)) > 0);
  const cwd = process.cwd();
  process.chdir(root);
  try {
    const code = main(argv);
    return { code, out: out.join(""), err: err.join("") };
  } finally {
    process.chdir(cwd);
  }
}

it("runs the real gates on a planted repo and passes", { timeout: SLOW }, () => {
  const root = consumer({
    "package.json": MANIFEST,
    "tsconfig.json": TSCONFIG,
    ...srcConfig(),
    "vitest.config.ts": VITEST_CONFIG,
    "src/answer.ts": ANSWER,
    "src/answer.test.ts": ANSWER_TEST,
  });
  const run = realCi(root);
  const lines = run.out.split("\n");
  expect(lines.slice(0, 4).map((line) => line.replace(/ \(\d+\.\ds\)$/, ""))).toEqual([
    "ci: check ok",
    "ci: fmt ok",
    "ci: typecheck 2 configs",
    "ci: 1 test passed",
  ]);
  expect(lines[4]).toBe("ci: check ok · fmt ok · typecheck 2 configs · 1 test passed");
  expect(run).toMatchObject({ code: 0, err: "" });
});

it("a failing test fails the run and shows vitest's output", { timeout: SLOW }, () => {
  const root = consumer(
    {
      "package.json": MANIFEST,
      "vitest.config.ts": VITEST_CONFIG,
      "src/answer.ts": "export const answer = 41;\n",
      "src/answer.test.ts": ANSWER_TEST,
    },
    { deps: true },
  );
  const run = realCi(root);
  expect(run.code).toBe(1);
  expect(run.out).toMatch(/ci: tests failed \(1 failed, 0 passed\) \(\d+\.\ds\)\n[\s\S]*AssertionError/);
});

it("--report writes the skipped ids of one real vitest run", { timeout: SLOW }, () => {
  const root = consumer({
    "package.json": MANIFEST,
    "tsconfig.json": TSCONFIG,
    ...srcConfig(),
    "vitest.config.ts": VITEST_CONFIG,
    "src/answer.ts": ANSWER,
    "src/answer.test.ts": ANSWER_TEST.replace("});\n", '});\n\nit("sleeps", (ctx) => {\n  ctx.skip();\n});\n'),
    ".repo/lint-baseline.json": BASELINE,
  });
  const run = realCi(root, ["--report", "r.json"]);
  expect(run).toMatchObject({ code: 0, err: "" });
  expect(run.out.split("\n")).toHaveLength(6);
  expect(JSON.parse(read(root, "r.json"))).toEqual({
    os: process.platform,
    skipped: ["src/answer.test.ts > sleeps"],
  });
});

it("an argument is refused on the real stderr", () => {
  const run = realCi(process.cwd(), ["x.test.ts"]);
  expect(run).toEqual({
    code: 1,
    out: "",
    err: "repo ci: use repo ci [--report <file>], repo ci skips <dir> or repo ci wait\n",
  });
});

it("skips <dir> prints on the real stdout", () => {
  const root = tempDir("workerstack-ci-skips-");
  write(root, {
    "reports/ci-report-a.json": '{"os":"a","skipped":["x > t"]}',
    "reports/ci-report-b.json": '{"os":"b","skipped":[]}',
  });
  expect(realCi(root, ["skips", "reports"])).toEqual({
    code: 0,
    out: "ci skips: 2 reports (a, b), no test skipped on all of them\n",
    err: "",
  });
});

it("wait in a checkout whose HEAD is on no remote says so on the real stderr", async () => {
  const root = consumer({ "package.json": MANIFEST });
  const err: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => err.push(String(chunk)) > 0);
  const cwd = process.cwd();
  process.chdir(root);
  try {
    expect(await main(["wait"])).toBe(1);
  } finally {
    process.chdir(cwd);
  }
  expect(err.join("")).toMatch(/^repo ci wait: [0-9a-f]{7} is not on any remote branch; push it first\n$/);
});
