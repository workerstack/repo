import fs from "node:fs";
import path from "node:path";
import { main, type CiDeps } from "../ci.ts";
import type { TurboRun } from "../ci-turbo.ts";
import type { Captured } from "../lint.ts";
import type { Bins } from "../turn-steps.ts";
import { tempDir, write } from "./turn-repo.ts";

export const OK: Captured = { code: 0, stdout: "", stderr: "" };
export const bad = (stdout: string): Captured => ({ code: 1, stdout, stderr: "" });
export const PASSED: Captured = { ...OK, stdout: " Tests  4 passed (4)\n" };

export type Calls = { repo: string[]; tsc: string[]; vitest: string[]; turbo: { args: string[]; env: Record<string, string> }[] };

/** A tiny repo with a root tsconfig and one package; `files` add to it. */
export function plant(files: Record<string, string> = {}): string {
  const root = tempDir("workerstack-ci-");
  write(root, {
    "repo.config.ts": "export default {};\n",
    "package.json": '{ "name": "app", "workspaces": ["packages/*"] }\n',
    "tsconfig.json": "{}\n",
    "packages/a/package.json": '{ "name": "a" }\n',
    "packages/a/tsconfig.json": "{}\n",
    ...files,
  });
  return root;
}

/** Runs `repo ci` in `root` against fakes whose results `fail` overrides by name; each gate takes half a second. */
export function ci(root: string, argv: string[] = [], fail: Partial<Record<string, Captured | null>> = {}) {
  return runCi(root, argv, fail, { packs: [] });
}

/** Runs `repo ci` under the workspace pack with `turbo` as the injected runner, and records what it was given. */
export function ciPacked(
  root: string,
  argv: string[],
  turbo: TurboRun,
  fail: Partial<Record<string, Captured | null>> = {},
) {
  const calls: Calls["turbo"] = [];
  const run = runCi(root, argv, fail, { packs: ["workspace"], turbo: recording(turbo, calls) });
  run.calls.turbo = calls;
  return run;
}

/** Runs `repo ci` with the packs read from the repo's own config, and `turbo` injected and recorded. */
export async function ciConfigured(root: string, turbo: TurboRun) {
  const calls: Calls["turbo"] = [];
  const run = runCi(root, [], {}, { turbo: recording(turbo, calls) });
  run.calls.turbo = calls;
  const code = await run.code;
  return { ...run, code };
}

function recording(turbo: TurboRun, calls: Calls["turbo"]): TurboRun {
  return (args, cwd, env) => {
    calls.push({ args, env });
    return turbo(args, cwd, env);
  };
}

function runCi(root: string, argv: string[], fail: Partial<Record<string, Captured | null>>, extra: Partial<CiDeps>) {
  const out: string[] = [];
  const err: string[] = [];
  const calls: Calls = { repo: [], tsc: [], vitest: [], turbo: [] };
  let clock = 0;
  const bins: Bins = {
    tsc: (args) => {
      calls.tsc.push(args.join(" "));
      return fail[args.at(-1) ?? ""] ?? OK;
    },
    vitest: (args) => {
      calls.vitest.push(args.join(" "));
      writeJson(args, fail.json);
      return fail.tests === undefined ? PASSED : fail.tests;
    },
  };
  const deps: CiDeps = {
    cwd: root,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    now: () => (clock += 500),
    ...extra,
    bins,
    repo: (args) => {
      calls.repo.push(args.join(" "));
      const [name = ""] = args;
      return fail[name] ?? OK;
    },
  };
  const code = main(argv, deps);
  // Read when asked, so an async run shows what it wrote after it finished.
  return {
    code,
    get out() {
      return out.join("");
    },
    get err() {
      return err.join("");
    },
    calls,
  };
}


/** Stands in for vitest's json reporter: writes `json` where the `--outputFile.json=` flag says. */
function writeJson(args: string[], json: Captured | null | undefined): void {
  const flag = args.find((arg) => arg.startsWith("--outputFile.json="));
  if (flag !== undefined && json) fs.writeFileSync(flag.slice("--outputFile.json=".length), json.stdout);
}

/** The `--report r.json` file in `root`. */
export const reportAt = (root: string): unknown => JSON.parse(fs.readFileSync(path.join(root, "r.json"), "utf8"));

/** A report with no skips and no durations. */
export const NO_SKIPS = { durations: {}, os: process.platform, skipped: [] };
