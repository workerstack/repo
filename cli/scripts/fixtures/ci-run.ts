import fs from "node:fs";
import { main, type CiDeps } from "../ci.ts";
import type { Captured } from "../lint.ts";
import type { Bins } from "../turn-steps.ts";
import { tempDir, write } from "./turn-repo.ts";

export const OK: Captured = { code: 0, stdout: "", stderr: "" };
export const bad = (stdout: string): Captured => ({ code: 1, stdout, stderr: "" });
export const PASSED: Captured = { ...OK, stdout: " Tests  4 passed (4)\n" };

export type Calls = { repo: string[]; tsc: string[]; vitest: string[] };

/** A tiny repo with a root tsconfig and one package; `files` add to it. */
export function plant(files: Record<string, string> = {}): string {
  const root = tempDir("workerstack-ci-");
  write(root, {
    "workerstack.config.ts": "export default {};\n",
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
  const out: string[] = [];
  const err: string[] = [];
  const calls: Calls = { repo: [], tsc: [], vitest: [] };
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
    bins,
    repo: (args) => {
      calls.repo.push(args.join(" "));
      const [name = ""] = args;
      return fail[name] ?? OK;
    },
  };
  return { code: main(argv, deps), out: out.join(""), err: err.join(""), calls };
}


/** Stands in for vitest's json reporter: writes `json` where the `--outputFile.json=` flag says. */
function writeJson(args: string[], json: Captured | null | undefined): void {
  const flag = args.find((arg) => arg.startsWith("--outputFile.json="));
  if (flag !== undefined && json) fs.writeFileSync(flag.slice("--outputFile.json=".length), json.stdout);
}
