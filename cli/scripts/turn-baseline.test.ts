import { afterEach, expect, it } from "vitest";
import { cleanTemps, SLOW, git, write, read, nonNull, consumer, turn, staged } from "./fixtures/turn-repo.ts";

afterEach(cleanTemps);

const NN = "typescript(no-non-null-assertion)";
const BASELINE = ".repo/lint-baseline.json";

it("a new lint problem over the baseline fails, naming it, and leaves the baseline", { timeout: SLOW }, async () => {
  const baseline = `${JSON.stringify({ "src/a.ts": { [NN]: 2 } }, null, 2)}\n`;
  const root = consumer({ "src/a.ts": nonNull(2), [BASELINE]: baseline });
  write(root, { "src/a.ts": nonNull(3) });
  const result = await turn(root, []);
  expect(result.err).toContain(`src/a.ts:3:`);
  expect(result.err).toContain(`: error ${NN}: Forbidden non-null assertion.\n`);
  expect(result.err).toContain(`repo turn: src/a.ts has 3 ${NN}, the baseline allows 2; fix the new one\n`);
  expect(result.out).toBe(
    "turn: 1 file · fmt ok · lint 1 over baseline · typecheck skipped (no tsconfig.json) · 0 related tests\n",
  );
  expect(result.code).toBe(1);
  expect(read(root, BASELINE)).toBe(baseline);
  write(root, { "src/a.ts": nonNull(4) });
  expect((await turn(root, [])).err).toContain(`src/a.ts has 4 ${NN}, the baseline allows 2; fix the 2 new ones\n`);
});

it(
  "a fixed problem and a deleted file lower the baseline, which --staged restages and which triggers no sync",
  { timeout: SLOW },
  async () => {
    const baseline = { "src/a.ts": { [NN]: 2 }, "src/b.ts": { [NN]: 1 } };
    const root = consumer({
      "src/a.ts": nonNull(2),
      "src/b.ts": nonNull(1),
      [BASELINE]: `${JSON.stringify(baseline, null, 2)}\n`,
    });
    write(root, { "src/a.ts": nonNull(1) });
    git(root, "rm", "-q", "src/b.ts");
    git(root, "add", "src/a.ts");
    const result = await turn(root, ["--staged"]);
    expect(result.out).toMatch(
      new RegExp(
        `^turn: 2 files · fmt ok · lint ok, baseline lowered \\(src/a.ts ${NN.replace(/[()]/g, "\\$&")} 2 → 1, src/b.ts ${NN.replace(/[()]/g, "\\$&")} 1 → 0\\) · typecheck`,
      ),
    );
    expect(result.out).not.toContain("sync");
    expect(result.code).toBe(0);
    expect(JSON.parse(git(root, "show", `:${BASELINE}`))).toEqual({ "src/a.ts": { [NN]: 1 } });
    expect(staged(root)).toEqual([BASELINE, "src/a.ts", "src/b.ts"]);
  },
);

it("the default mode lowers the baseline on disk and stages nothing", { timeout: SLOW }, async () => {
  const root = consumer({
    "src/a.ts": nonNull(2),
    [BASELINE]: `${JSON.stringify({ "src/a.ts": { [NN]: 2 } }, null, 2)}\n`,
  });
  write(root, { "src/a.ts": nonNull(1) });
  const result = await turn(root, []);
  expect(result.out).toContain(`lint ok, baseline lowered (src/a.ts ${NN} 2 → 1)`);
  expect(JSON.parse(read(root, BASELINE))).toEqual({ "src/a.ts": { [NN]: 1 } });
  expect(staged(root)).toEqual([]);
});

it("a broken baseline or tool config fails its step with the reason", { timeout: SLOW }, async () => {
  const root = consumer({ "src/a.ts": nonNull(1), [BASELINE]: '{ "src/a.ts": { "x": 0 } }\n' });
  write(root, { "src/a.ts": nonNull(2) });
  const broken = await turn(root, []);
  expect(broken.err).toBe(
    `repo turn: ${BASELINE}: src/a.ts: x: must be a whole number above 0; fix it, or delete it and run \`bun repo lint --baseline\`\n`,
  );
  expect(broken.out).toContain(" · lint failed · ");
  expect(broken.code).toBe(1);
  write(root, { [BASELINE]: "{}\n", ".oxlintrc.json": "{", ".oxfmtrc.jsonc": "{" });
  const tools = await turn(root, []);
  expect(tools.err).toContain("repo turn: oxlint exited 1: Failed to parse oxlint configuration file");
  expect(tools.out).toMatch(/^turn: 2 files · fmt failed · lint failed · /);
});
