import fs from "node:fs";

import { expect, it, vi } from "vitest";

const fakes = await vi.hoisted(() => import("./__fixtures__/main-mocks.ts").then((mocks) => mocks.mockedGithubFakes()));

import { usePacks, writeCleanManifest, writeConfigs, writeStandardsOutputs } from "./__fixtures__/check-repo.ts";
import { useMainCheckRepo } from "./__fixtures__/main-check-repo.ts";
import { start } from "./main.ts";

const { repo, written } = useMainCheckRepo(fakes);

vi.setConfig({ testTimeout: 60_000 });

/** A lint.skip entry turning `rule` off in `file`. */
function skip(file: string, rule: string, reason: string) {
  return { files: [file], reason, rules: [rule] };
}

it("with the standards pack on, prints each lint count over .repo/lint-baseline.json and exits 1", async () => {
  writeConfigs(repo);
  usePacks(repo, "standards");
  writeStandardsOutputs(repo);
  repo.put("src/a.ts", "export function a(xs: string[]): string {\n  return xs.find(Boolean)!;\n}\n");
  await start();
  expect(repo.besidesKnip()).toBe(
    "repo check: .repo/lint-baseline.json: src/a.ts has 1 typescript(no-non-null-assertion), the baseline allows 0\n",
  );
  expect(process.exitCode).toBe(1);
});

it("with the standards pack on, prints each manifest problem and exits 1", async () => {
  writeConfigs(repo);
  repo.write("package.json", { name: "app", sideEffects: ["*.css"] });
  usePacks(repo, "standards");
  await start();
  expect(repo.besidesKnip()).toBe(
    [
      'repo check: package.json: "private" is missing; set true, or false to publish it',
      'repo check: package.json: "sideEffects" is ["*.css"]; set it to false and import CSS from an app entry',
      `repo check: package.json: "packageManager" is missing; set it to "bun@${Bun.version}"`,
      "",
    ].join("\n"),
  );
  expect(process.exitCode).toBe(1);
});

it("with the standards pack on, prints each refused comment with its file and line and exits 1", async () => {
  writeConfigs(repo);
  usePacks(repo, "standards");
  repo.put("src/a.ts", "export const a = 1;\n// @ts-ignore\n");
  await start();
  expect(repo.besidesKnip()).toBe(
    'repo check: src/a.ts:2: "@ts-ignore" hides a type error; fix the type, or write @ts-expect-error with a reason\n',
  );
  expect(process.exitCode).toBe(1);
});

it("with the standards pack on, prints knip's problems to stderr and its ignores to stdout, and exits 1", async () => {
  writeConfigs(repo);
  writeCleanManifest(repo);
  const ignore = '{ file: "src/b.ts", reason: "loaded by name" }';
  repo.put("workerstack.config.ts", `export default { packs: ["standards"], knip: { ignore: [${ignore}] } };\n`);
  repo.put("src/a.ts", "export const a = 1;\n");
  repo.put("src/b.ts", "export const b = 1;\n");
  await start();
  expect(written.out).toContain("repo check: knip: 1 ignore: file src/b.ts (loaded by name)\n");
  expect(written.err).toContain("repo check: knip: src/a.ts: unused file; delete it\n");
  expect(written.err).not.toContain("repo check: knip: src/b.ts: unused file; delete it\n");
  expect(process.exitCode).toBe(1);
});

it("with the standards pack on, prints each live lint.skip and its count, and exits 1 on a stale entry", async () => {
  writeConfigs(repo);
  writeCleanManifest(repo);
  const reason = "the lookup result is always present";
  const rule = "typescript/no-non-null-assertion";

  const config = {
    lint: { skip: [skip("src/a.ts", rule, reason), skip("src/b.ts", rule, reason)] },
    packs: ["standards"],
  };

  repo.put("workerstack.config.ts", `export default ${JSON.stringify(config, null, 2)};\n`);
  repo.put("src/a.ts", "export const a = (xs: string[]): string => xs.find(Boolean)!;\n");
  repo.put("src/b.ts", "export const b = 1;\n");
  await start();
  expect(written.out).toStrictEqual([
    `repo check: skip typescript/no-non-null-assertion in src/a.ts: 1 hit (${reason})\n`,
    "repo check: skips: typescript/no-non-null-assertion 1\n",
  ]);
  expect(repo.besidesKnip()).toBe(
    'repo check: lint.skip[1]: typescript/no-non-null-assertion has no hit in "src/b.ts"; delete it from the entry\n',
  );
  expect(process.exitCode).toBe(1);
  expect(fs.readdirSync(repo.dir()).filter((name) => name.startsWith(".oxlintrc.unskipped-"))).toStrictEqual([]);
});

it(`with the standards pack on, reports a skipped magic \
rule's hits and counts the other over the baseline`, async () => {
  writeCleanManifest(repo);
  const reason = "retry tuning lives here for now";
  const config = { lint: { skip: [skip("src/retry.ts", "repo/magic-number", reason)] }, packs: ["standards"] };
  repo.put("workerstack.config.ts", `export default ${JSON.stringify(config, null, 2)};\n`);
  writeStandardsOutputs(repo);

  const retry = [
    "export function wait(): number {\n  return 5000 + 3;\n}\n",
    'export function is(m: string): boolean {\n  return m === "fast";\n}\n',
  ].join("\n");

  repo.put("src/retry.ts", retry);
  await start();
  expect(written.out).toStrictEqual([
    `repo check: skip repo/magic-number in src/retry.ts: 2 hits (${reason})\n`,
    "repo check: skips: repo/magic-number 2\n",
  ]);
  expect(repo.besidesKnip()).toBe(
    "repo check: .repo/lint-baseline.json: src/retry.ts has 1 repo(magic-string), the baseline allows 0\n",
  );
  expect(process.exitCode).toBe(1);
});

it(`with the standards pack on, prints each reject file \
problem and counts an untested guard over the baseline`, async () => {
  writeCleanManifest(repo);
  usePacks(repo, "standards");
  writeStandardsOutputs(repo);

  const guard = [
    "export function isUser(value: unknown): value is string[] {",
    "  return Array.isArray(value);",
    "}",
    "",
  ];

  repo.put("src/is-user.ts", guard.join("\n"));
  repo.put("src/user.reject.ts", 'lod("u2");\n');
  await start();
  expect(repo.besidesKnip()).toBe(
    [
      "repo check: rejections: src/user.reject.ts: line 1 fails unmarked: TS2304: Cannot find name 'lod'.",
      "repo check: .repo/lint-baseline.json: src/is-user.ts has 1 repo(guard-rejects), the baseline allows 0",
      "",
    ].join("\n"),
  );
  expect(process.exitCode).toBe(1);
});
