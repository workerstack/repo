import fs from "node:fs";
import path from "node:path";
import { git, tempDir, write } from "./planted-repo.ts";
import type { RedProofResult, VitestRun } from "../red-proof.ts";

/** This checkout's installed modules, which a planted repo links so its vitest resolves. */
export const CHECKOUT_MODULES = path.resolve(import.meta.dirname, "..", "..", "node_modules");

/** A test file body that passes (`ok`) or fails (`red`), importing `./x.ts` when `useX` is set. */
export const PASS = `import { expect, it } from "vitest";\nit("p", () => expect(1).toBe(1));\n`;
export const FAIL = `import { expect, it } from "vitest";\nit("f", () => expect(1).toBe(2));\n`;
export const NEEDS_X = `import { expect, it } from "vitest";\nimport { x } from "./x.ts";\nit("x", () => expect(x()).toBe(1));\n`;

/** Links the checkout's modules into `dir` so vitest resolves from there. */
export function linkModules(dir: string): void {
  fs.symlinkSync(CHECKOUT_MODULES, path.join(dir, "node_modules"));
}

/** A planted repo with one commit holding `files` (plus a package.json and a .gitignore), modules linked in. */
export function plant(files: Record<string, unknown>, rootManifest = true): string {
  const dir = tempDir();
  git(dir, "init", "-q", "-b", "main");
  write(dir, { ".gitignore": "node_modules\n.tmp\n", ...(rootManifest ? { "package.json": { name: "p" } } : {}) });
  write(dir, files);
  linkModules(dir);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  return dir;
}

/** A planted repo with no commit yet. */
export function plantUnborn(files: Record<string, unknown>): string {
  const dir = tempDir();
  git(dir, "init", "-q", "-b", "main");
  write(dir, files);
  git(dir, "add", "-A");
  return dir;
}

/** Writes `files` and stages everything. */
export function stage(dir: string, files: Record<string, unknown>): void {
  write(dir, files);
  git(dir, "add", "-A");
}

/** The name-status of the staged change, as `status\tpath` lines. */
export const staged = (dir: string): string => git(dir, "diff", "--cached", "--name-status", "--no-renames");

/** The vitest runner stand-in: calls `onRun` with the cwd and args, writes a report failing the files `fails` names. */
export function fakeVitest(
  fails: (file: string, cwd: string) => boolean,
  onRun: (cwd: string, args: string[]) => void = () => undefined,
): VitestRun {
  return (args, cwd) => {
    onRun(cwd, args);
    const output = outputOf(args);
    const files = args.filter((arg) => arg !== "run" && !arg.startsWith("-"));
    const testResults = files.map((file) => ({
      name: path.join(cwd, file),
      status: fails(file, cwd) ? "failed" : "passed",
    }));
    fs.writeFileSync(output, JSON.stringify({ testResults }));
    return { code: testResults.some((r) => r.status === "failed") ? 1 : 0, stderr: "" };
  };
}

/** The problem a refusal carries, or an empty string for a pass. */
export const problemOf = (result: RedProofResult): string => ("problem" in result ? result.problem : "");

/** The `--outputFile=` path vitest was asked to write. */
export const outputOf = (args: string[]): string =>
  args.filter((arg) => arg.startsWith("--outputFile=")).join("").slice("--outputFile=".length);
