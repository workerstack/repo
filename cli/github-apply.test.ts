import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { KEYWORDS, MANIFEST, githubRepo } from "./fixtures/github-repo.ts";
import { DENIED, DENIED_LINE, cleanGithubTemps, run, settledSettings } from "./fixtures/github-run.ts";
import { EMPTY_SETTINGS, fakeGh, type Settings } from "./fixtures/github-store.ts";
import { must } from "./fixtures/github-wanted.ts";
import { main } from "./github-apply.ts";
import type { GhFailure } from "./github-gh.ts";
import { wantedAt } from "./github-wanted-at.ts";

afterEach(() => {
  cleanGithubTemps();
  vi.restoreAllMocks();
});

const CREATED =
  "repo github: workerstack/repo · ruleset main created · ruleset release tags created · " +
  "private vulnerability reporting on";

it("creates both rulesets, turns on reporting and alerts, sets the metadata, leaving the store as wanted", async () => {
  const cwd = githubRepo();
  const fake = fakeGh({ ...EMPTY_SETTINGS(), alerts: false });
  const first = await run(cwd, fake);
  expect(first).toStrictEqual({
    code: 0,
    err: "",
    out: `${CREATED} · Dependabot alerts on · description, homepage and 5 topics set\n`,
  });
  const wanted = await wantedAt(cwd);
  const stored = fake.settings.rulesets.map(({ id: _id, ...ruleset }) => ruleset);
  expect(wanted.ok && wanted.wanted.rulesets).toStrictEqual(stored);
  const { description, homepage } = MANIFEST;
  expect(fake.settings).toMatchObject({ alerts: true, description, homepage, reporting: true, topics: KEYWORDS });
});

it("requires every job the generated ci.yml reports, from GitHub Actions", async () => {
  const fake = fakeGh();
  await run(githubRepo(), fake);
  const rule = must(fake.settings.rulesets[0]).rules.find((r) => r.type === "required_status_checks");
  expect(rule?.parameters?.required_status_checks?.map((check) => check.context)).toStrictEqual([
    "test (ubuntu-latest 1/2)",
    "test (ubuntu-latest 2/2)",
    "test (windows-latest 1/6)",
    "test (windows-latest 2/6)",
    "test (windows-latest 3/6)",
    "test (windows-latest 4/6)",
    "test (windows-latest 5/6)",
    "test (windows-latest 6/6)",
    "test (macos-latest 1/3)",
    "test (macos-latest 2/3)",
    "test (macos-latest 3/3)",
    "commits",
    "skips",
    "coverage",
    "consumer",
  ]);
});

it("changes nothing on a second run: it says up to date and makes no write call", async () => {
  const cwd = githubRepo();
  const fake = fakeGh();
  await run(cwd, fake);
  fake.calls.length = 0;
  expect(await run(cwd, fake)).toStrictEqual({ code: 0, err: "", out: "repo github: workerstack/repo · up to date\n" });
  expect(fake.writes()).toStrictEqual([]);
});

it("updates an edited ruleset by id and touches nothing else", async () => {
  const cwd = githubRepo();
  const fake = fakeGh(await settledSettings(cwd));
  const edited = must(fake.settings.rulesets[0]);
  edited.rules = edited.rules.filter((rule) => rule.type !== "deletion");
  fake.calls.length = 0;
  const updated = await run(cwd, fake);
  expect(updated.out).toBe("repo github: workerstack/repo · ruleset main updated\n");
  expect(fake.writes().map((call) => [call.method, call.path])).toStrictEqual([
    ["PUT", `repos/workerstack/repo/rulesets/${edited.id}`],
  ]);
  expect(must(fake.settings.rulesets[0]).rules.some((rule) => rule.type === "deletion")).toBe(true);
});

const METADATA: [string, Partial<Settings>, string][] = [
  ["the description", { description: "old" }, "description set"],
  ["the homepage", { homepage: null }, "homepage set"],
  ["the topics", { topics: ["lint"] }, "5 topics set"],
  ["the description and topics", { description: "", topics: [] }, "description and 5 topics set"],
  ["alerts", { alerts: false }, "Dependabot alerts on"],
];

it.each(METADATA)("sets only %s when only that differs", async (_, change, part) => {
  const cwd = githubRepo();
  const { out } = await run(cwd, fakeGh(await settledSettings(cwd, change)));
  expect(out).toBe(`repo github: workerstack/repo · ${part}\n`);
});

it("says 1 topic for a single keyword", async () => {
  const one = githubRepo({ files: { "package.json": JSON.stringify({ ...MANIFEST, keywords: ["lint"] }) } });
  const { out } = await run(one, fakeGh(await settledSettings(one, { topics: [] })));
  expect(out).toBe("repo github: workerstack/repo · 1 topic set\n");
});

it("exits 1 with the admin hint when GitHub denies the read, writing nothing", async () => {
  const fake = fakeGh(EMPTY_SETTINGS(), () => DENIED);
  expect(await run(githubRepo(), fake)).toStrictEqual({ code: 1, err: DENIED_LINE, out: "" });
  expect(fake.writes()).toStrictEqual([]);
});

it("exits 1 with the admin hint when GitHub denies a write, and a rerun finishes the job", async () => {
  const cwd = githubRepo();
  const fake = fakeGh(EMPTY_SETTINGS(), (call) => (call.method === "PUT" ? DENIED : undefined));
  expect(await run(cwd, fake)).toStrictEqual({ code: 1, err: DENIED_LINE, out: "" });
  expect(fake.settings.rulesets.map((ruleset) => ruleset.name)).toStrictEqual(["main", "release tags"]);
  const again = await run(cwd, fakeGh(fake.settings));
  expect(again.out).toBe(
    "repo github: workerstack/repo · private vulnerability reporting on · description, homepage and 5 topics set\n",
  );
});

const FAILURES: [GhFailure, string][] = [
  [{ kind: "auth", message: "gh is not logged in", ok: false }, "not logged in): log in as an admin"],
  [{ kind: "timeout", message: "gh did not answer within 5s", ok: false }, "gh did not answer within 5s): try again"],
  [{ kind: "missing", message: "gh is not installed", ok: false }, "gh is not installed): install it from"],
];

it.each(FAILURES)("names a %j failure and what to do", async (failure, text) => {
  const result = await run(
    githubRepo(),
    fakeGh(EMPTY_SETTINGS(), () => failure),
  );
  expect(result.code).toBe(1);
  expect(result.err).toContain(text);
});

it.each([null, "https://gitlab.com/a/b.git"])("exits 1 without calling gh when origin is %j", async (origin) => {
  const fake = fakeGh();
  const line = "repo github: no GitHub origin; `git remote get-url origin` is not a github.com URL\n";
  expect(await run(githubRepo({ origin }), fake)).toStrictEqual({ code: 1, err: line, out: "" });
  expect(fake.calls).toStrictEqual([]);
});

it.each([["--nope"], ["--check", "--nope"], ["extra"]])("refuses the arguments %j with the usage", async (...argv) => {
  const fake = fakeGh();
  const usage = "repo github: usage: repo github [--check]\n";
  expect(await run(githubRepo(), fake, argv)).toStrictEqual({ code: 1, err: usage, out: "" });
  expect(fake.calls).toStrictEqual([]);
});

it("refuses keywords that are not valid topics, with or without --check", async () => {
  const manifest = JSON.stringify({ ...MANIFEST, keywords: ["lint", "agents"] });
  const cwd = githubRepo({ files: { "package.json": manifest } });
  const refused = 'repo github: package.json: "keywords" are not sorted; write ["agents","lint"]\n';
  const [apply, check] = await Promise.all([run(cwd, fakeGh()), run(cwd, fakeGh(), ["--check"])]);
  expect([apply, check]).toStrictEqual([
    { code: 1, err: refused, out: "" },
    { code: 1, err: refused, out: "" },
  ]);
});

it("refuses a keyword list holding a non-string instead of dropping it", async () => {
  const manifest = JSON.stringify({ ...MANIFEST, keywords: ["agents", 7] });
  const fake = fakeGh();
  const out = await run(githubRepo({ files: { "package.json": manifest } }), fake);
  expect(out).toStrictEqual({
    code: 1,
    err: "repo github: package.json: keyword 2 is 7, not a string; write it as a GitHub topic\n",
    out: "",
  });
  expect(fake.calls).toStrictEqual([]);
});

it("refuses a config or a package.json it cannot read, with the reason", async () => {
  const config = githubRepo({ files: { "workerstack.config.ts": "export default 3;\n" } });
  const manifest = githubRepo({ files: { "package.json": "{" } });
  const [bad, broken] = await Promise.all([run(config, fakeGh()), run(manifest, fakeGh())]);
  expect([bad.code, bad.err.startsWith("repo github: workerstack.config.ts:")]).toStrictEqual([1, true]);
  expect([broken.code, broken.err.startsWith("repo github: package.json")]).toStrictEqual([1, true]);
});

it("reads a description or homepage of the wrong type, or no package.json at all, as unset", async () => {
  const odd = JSON.stringify({ description: 3, homepage: [], name: "pkg" });
  const bare = githubRepo({ files: { "package.json": odd } });
  const bareRun = await run(bare, fakeGh());
  expect(bareRun.out).toBe(`${CREATED}\n`);
  const none = githubRepo();
  fs.rmSync(path.join(none, "package.json"));
  const noneRun = await run(none, fakeGh());
  expect(noneRun.out).toContain("ruleset main created");
});

it("main runs with the real io: a flag it refuses and a checkout with no origin", async () => {
  const written: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((text) => (written.push(String(text)), true));
  expect(await main(["--nope"])).toBe(1);
  vi.spyOn(process, "cwd").mockReturnValue(githubRepo({ origin: null }));
  expect(await main([])).toBe(1);
  expect(written.filter((text) => text !== "")).toStrictEqual([
    "repo github: usage: repo github [--check]\n",
    "repo github: no GitHub origin; `git remote get-url origin` is not a github.com URL\n",
  ]);
});
