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
    // Fields in the order oxfmt's sortPackageJson writes them, so the planted repo passes fmt.
    name: "app",
    private: true,
    type: "module",

    sideEffects: false,

    devDependencies: { "@vitest/coverage-istanbul": "*", vitest: "*" },
    packageManager: PIN,
  },
  null,
  2,
)}\n`;
/** The two lint findings a test that skips itself at runtime has, which the baseline allows. */
const BASELINE = `${JSON.stringify({ "src/answer.test.ts": { "repo(skip-on-platform)": 1, "vitest(expect-expect)": 1 } }, null, 2)}\n`;
const ANSWER = "export const answer = 42;\n";
const ANSWER_TEST =
  'import { expect, it } from "vitest";\n\nimport { answer } from "./answer.ts";\n\nit("answers", () => {\n  expect(answer).toBe(42);\n});\n';
const VITEST_CONFIG = 'export default { test: { coverage: { include: ["src/**"], provider: "istanbul" } } };\n';

/** Runs `repo ci` in `root` with the process's own writers and real tools, collecting what it wrote. */
async function realCi(root: string, argv: string[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => out.push(String(chunk)) > 0);
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => err.push(String(chunk)) > 0);
  const cwd = process.cwd();
  process.chdir(root);
  try {
    const code = await main(argv);
    return { code, err: err.join(""), out: out.join("") };
  } finally {
    process.chdir(cwd);
  }
}

it("runs the real gates on a planted repo and passes", { timeout: SLOW }, async () => {
  const root = consumer({
    "package.json": MANIFEST,
    "tsconfig.json": TSCONFIG,
    ...srcConfig(),
    "vitest.config.ts": VITEST_CONFIG,
    "src/answer.ts": ANSWER,
    "src/answer.test.ts": ANSWER_TEST,
  });
  const run = await realCi(root);
  const lines = run.out.split("\n");
  expect(lines.slice(0, 4).map((line) => line.replace(/ \(\d+\.\ds\)$/, ""))).toStrictEqual([
    "ci: check ok",
    "ci: fmt ok",
    "ci: typecheck 2 configs",
    "ci: 1 test passed",
  ]);
  expect(lines[4]).toBe("ci: check ok · fmt ok · typecheck 2 configs · 1 test passed");
  expect(run).toMatchObject({ code: 0, err: "" });
});

it("a failing test fails the run and shows vitest's output", { timeout: SLOW }, async () => {
  const root = consumer(
    {
      "package.json": MANIFEST,
      "src/answer.test.ts": ANSWER_TEST,
      "src/answer.ts": "export const answer = 41;\n",
      "vitest.config.ts": VITEST_CONFIG,
    },
    { deps: true },
  );
  const run = await realCi(root);
  expect(run.code).toBe(1);
  expect(run.out).toMatch(/ci: tests failed \(1 failed, 0 passed\) \(\d+\.\ds\)\n[\s\S]*AssertionError/);
});

it("--report writes the skipped ids of one real vitest run", { timeout: SLOW }, async () => {
  const root = consumer({
    "package.json": MANIFEST,
    "tsconfig.json": TSCONFIG,
    ...srcConfig(),
    "vitest.config.ts": VITEST_CONFIG,
    "src/answer.ts": ANSWER,
    "src/answer.test.ts": ANSWER_TEST.replace("});\n", '});\n\nit("sleeps", (ctx) => {\n  ctx.skip();\n});\n'),
    ".repo/lint-baseline.json": BASELINE,
  });
  const run = await realCi(root, ["--report", "r.json"]);
  expect(run).toMatchObject({ code: 0, err: "" });
  expect(run.out.split("\n")).toHaveLength(6);
  const written = JSON.parse(read(root, "r.json")) /* writeReport wrote the report */ as { durations: object };
  expect(written).toMatchObject({ os: process.platform, skipped: ["src/answer.test.ts > sleeps"] });
  expect(Object.keys(written.durations)).toStrictEqual(["src/answer.test.ts"]);
});

it("an argument is refused on the real stderr", async () => {
  const run = await realCi(process.cwd(), ["x.test.ts"]);
  expect(run).toStrictEqual({
    code: 1,
    err: "repo ci: use repo ci [--no-coverage] [--report <file>] [--shard <i>/<n>], repo ci skips <dir>, repo ci times <dir> or repo ci wait [<branch>] (exits 0 passed, 1 failed, 2 superseded, 3 nothing to wait on, 4 error)\n",
    out: "",
  });
});

it("skips <dir> prints on the real stdout", async () => {
  const root = tempDir("workerstack-ci-skips-");
  write(root, {
    "reports/ci-report-a.json": '{"os":"a","skipped":["x > t"]}',
    "reports/ci-report-b.json": '{"os":"b","skipped":[]}',
  });
  expect(await realCi(root, ["skips", "reports"])).toStrictEqual({
    code: 0,
    err: "",
    out: "ci skips: 2 reports (a, b), no test skipped on all of them\n",
  });
});

it("wait in a checkout whose HEAD is on no remote says so on the real stderr", async () => {
  const root = consumer({ "package.json": MANIFEST });
  const err: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => err.push(String(chunk)) > 0);
  const cwd = process.cwd();
  process.chdir(root);
  try {
    expect(await main(["wait"])).toBe(4);
  } finally {
    process.chdir(cwd);
  }
  expect(err.join("")).toMatch(/^repo ci wait: [0-9a-f]{7} is not on any remote branch; push it first\n$/);
});
