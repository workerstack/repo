import { afterEach, expect, it } from "vitest";
import { DENIED, cleanGithubTemps, settledSettings } from "./fixtures/github-run.ts";
import { MANIFEST, githubRepo } from "./fixtures/github-repo.ts";
import { EMPTY_SETTINGS, fakeGh, type FakeGh } from "./fixtures/github-store.ts";
import { RUN } from "./fixtures/github-wanted.ts";
import { checkGithubAt } from "./github-apply.ts";
import type { GhFailure } from "./github-gh.ts";

afterEach(cleanGithubTemps);

const SKIP = "github: skipped, ";
const check = (cwd: string, fake: FakeGh, ci = false) => checkGithubAt(cwd, { gh: fake.gh, ci });

it("passes a settled repo", async () => {
  const cwd = githubRepo();
  expect(await check(cwd, fakeGh(await settledSettings(cwd)))).toEqual({ problems: [], report: [] });
});

it("reports each drift as a problem", async () => {
  const cwd = githubRepo();
  const settled = await settledSettings(cwd, { reporting: false });
  expect(await check(cwd, fakeGh(settled))).toEqual({
    problems: [`github: private vulnerability reporting is off: ${RUN}`],
    report: [],
  });
});

it("skips under GITHUB_ACTIONS before any call", async () => {
  const fake = fakeGh();
  const skipped = { problems: [], report: [`${SKIP}CI's token cannot read admin settings`] };
  expect(await check(githubRepo(), fake, true)).toEqual(skipped);
  expect(fake.calls).toEqual([]);
});

const CASES: [string, GhFailure, string][] = [
  [
    "gh is not logged in",
    { ok: false, kind: "auth", message: "gh is not logged in (gh auth status)" },
    "gh is not logged in (gh auth status)",
  ],
  ["gh is denied", DENIED, "CI's token cannot read admin settings"],
  [
    "gh never answers",
    { ok: false, kind: "timeout", message: "gh did not answer within 5s" },
    "gh did not answer within 5s",
  ],
  ["gh is missing", { ok: false, kind: "missing", message: "gh is not installed" }, "gh is not installed"],
];

it.each(CASES)("skips with the reason when %s", async (_, failure, reason) => {
  const result = await check(
    githubRepo(),
    fakeGh(EMPTY_SETTINGS(), () => failure),
  );
  expect(result).toEqual({ problems: [], report: [SKIP + reason] });
});

it("skips with no GitHub origin, calling nothing", async () => {
  const fake = fakeGh();
  expect(await check(githubRepo({ origin: null }), fake)).toEqual({
    problems: [],
    report: [`${SKIP}no GitHub origin`],
  });
  expect(fake.calls).toEqual([]);
});

it("reports a refused keyword as a problem", async () => {
  const manifest = JSON.stringify({ ...MANIFEST, keywords: ["lint", "agents"] });
  const cwd = githubRepo({ files: { "package.json": manifest } });
  expect(await check(cwd, fakeGh())).toEqual({
    problems: ['github: package.json: "keywords" are not sorted; write ["agents","lint"]'],
    report: [],
  });
});

it("leaves a config or a package.json it cannot read to sync", async () => {
  const config = githubRepo({ files: { "workerstack.config.ts": "export default 3;\n" } });
  const manifest = githubRepo({ files: { "package.json": "{" } });
  const results = await Promise.all([check(config, fakeGh()), check(manifest, fakeGh())]);
  expect(results).toEqual([
    { problems: [], report: [] },
    { problems: [], report: [] },
  ]);
});

it("builds its own io when none is given", async () => {
  expect(await checkGithubAt(githubRepo({ origin: null }))).toMatchObject({ problems: [] });
});

it("makes no gh call and prints nothing without the release pack", async () => {
  const fake = fakeGh();
  const cwd = githubRepo({ files: { "workerstack.config.ts": 'export default { packs: ["standards"] };\n' } });
  expect(await check(cwd, fake)).toEqual({ problems: [], report: [] });
  expect(await check(cwd, fake, true)).toEqual({ problems: [], report: [] });
  expect(fake.calls).toEqual([]);
});
