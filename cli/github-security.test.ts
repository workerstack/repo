import { afterEach, expect, it, vi } from "vitest";

import { githubRepo } from "./__fixtures__/github-repo.ts";
import { cleanGithubTemps, run, settledSettings } from "./__fixtures__/github-run.ts";
import { fakeGh, type Settings } from "./__fixtures__/github-store.ts";

afterEach(() => {
  cleanGithubTemps();
  vi.restoreAllMocks();
});

const SCANNING = "secret scanning and push protection on";

const ROWS: [string, Partial<Settings>, string][] = [
  ["secret scanning", { scanning: false }, SCANNING],
  ["push protection", { pushProtection: false }, SCANNING],
  ["security updates", { securityUpdates: false }, "Dependabot security updates on"],
];

it.each(ROWS)("reports %s turned on when only that differs", async (_, change, part) => {
  const cwd = githubRepo();
  const result = await run(cwd, fakeGh(await settledSettings(cwd, change)));
  expect(result).toStrictEqual({ code: 0, err: "", out: `repo github: workerstack/repo · ${part}\n` });
});

it("turns on both scanning flags in one PATCH and security updates with a PUT", async () => {
  const cwd = githubRepo();
  const off = await settledSettings(cwd, { pushProtection: false, scanning: false, securityUpdates: false });
  const fake = fakeGh(off);
  const result = await run(cwd, fake);
  expect(result.out).toBe(
    "repo github: workerstack/repo · secret scanning and push protection on · Dependabot security updates on\n",
  );
  expect(fake.writes()).toStrictEqual([
    {
      body: {
        security_and_analysis: {
          secret_scanning: { status: "enabled" },
          secret_scanning_push_protection: { status: "enabled" },
        },
      },
      method: "PATCH",
      path: "repos/workerstack/repo",
    },
    { method: "PUT", path: "repos/workerstack/repo/automated-security-fixes" },
  ]);
  expect(fake.settings).toMatchObject({ pushProtection: true, scanning: true, securityUpdates: true });
});
