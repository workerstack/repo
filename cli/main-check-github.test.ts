import { expect, it } from "vitest";

import { addOrigin, usePacks, writeConfigs } from "./__fixtures__/check-repo.ts";
import { EMPTY_SETTINGS, fakeGh } from "./__fixtures__/github-store.ts";
import { useMainCheckRepo } from "./__fixtures__/main-check-repo.ts";
import { start } from "./main.ts";

const { fakes, repo, written } = useMainCheckRepo();
const ORIGIN = "https://github.com/workerstack/repo.git";

/** Runs check with a fake gh over empty settings in place of the logged-out one; the fake, to read its calls. */
async function startWithFakeGh(): Promise<ReturnType<typeof fakeGh>> {
  const fake = fakeGh(EMPTY_SETTINGS());
  const { gh } = fakes.checkIo;
  fakes.checkIo.gh = fake.gh;

  try {
    await start(fakes);
  } finally {
    fakes.checkIo.gh = gh;
  }

  return fake;
}

it(`checks GitHub only under the release pack: standards \
alone makes no gh call and prints no github line`, async () => {
  writeConfigs(repo);
  usePacks(repo, "standards");
  addOrigin(repo, ORIGIN);
  const fake = await startWithFakeGh();
  expect(written.out.join("")).not.toContain("github:");
  expect(fake.calls).toStrictEqual([]);
  expect(written.err.join("")).not.toContain("repo check: github:");
});

it("reports a skipped GitHub check on stdout when there is no GitHub origin", async () => {
  writeConfigs(repo);
  usePacks(repo, "release");
  await start(fakes);
  expect(written.out.join("")).toContain("repo check: github: skipped, no GitHub origin\n");
  expect(written.err.join("")).not.toContain("github");
});

it("reports a skipped GitHub check on stdout, without failing, when gh is not logged in", async () => {
  writeConfigs(repo);
  usePacks(repo, "release");
  addOrigin(repo, ORIGIN);
  await start(fakes);
  expect(written.out.join("")).toContain("repo check: github: skipped, gh is not logged in (gh auth status)\n");
  // The release pack's other problems fail this run; the skipped GitHub check is none of them.
  expect(written.err.join("")).not.toContain("github");
});

it("prints each GitHub setting that drifted, from the injected gh, and exits 1", async () => {
  writeConfigs(repo);
  usePacks(repo, "release");
  addOrigin(repo, ORIGIN);
  const fake = await startWithFakeGh();
  const err = written.err.join("");
  expect(err).toContain("repo check: github: ruleset main is missing: run `bun repo github`\n");
  expect(err).toContain("repo check: github: private vulnerability reporting is off: run `bun repo github`\n");
  expect(fake.writes()).toStrictEqual([]);
  expect(process.exitCode).toBe(1);
});
