import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { fwd } from "../../dev/test-paths";
import { processFatTools } from "./gate-fat-tools.ts";
import { isWorkspaceJobScript, jobCommand, repoBin, resolveRepoBin } from "./gate-job.ts";
import { useTmp } from "./fixtures/gate-workspace.ts";
import { camelCall, commandOf } from "./fixtures/hook-payload.ts";

const tmp = useTmp();
const JOB = ["--job", "test", "--query", "x"].join(" ");
const binOf = (dir: string, name = "repo") => path.join(dir, "node_modules", ".bin", name);

/** A main checkout and its linked worktree `out/fix-x`, each with the bin file it is given (null: no install). */
function worktree(bins: { main: string | null; own?: string | null }) {
  const base = tmp.dir("gate-wt-");
  const main = path.join(base, "main");
  const wt = path.join(base, "out", "fix-x");
  fs.mkdirSync(main, { recursive: true });
  const git = (cwd: string, ...a: string[]) =>
    spawnSync("git", ["-c", "user.email=a@b", "-c", "user.name=a", ...a], { cwd, encoding: "utf8" });
  git(main, "init", "-q");
  git(main, "commit", "-q", "--allow-empty", "-m", "i");
  git(main, "worktree", "add", "-q", wt);
  for (const [dir, bin] of [
    [main, bins.main],
    [wt, bins.own ?? null],
  ] as const) {
    if (!bin) continue;
    fs.mkdirSync(path.join(dir, "node_modules", ".bin"), { recursive: true });
    fs.writeFileSync(path.join(dir, "node_modules", ".bin", bin), "");
  }
  return { main, wt };
}

it("in a linked worktree: uses the main checkout's bin when the worktree has no install, and says so", () => {
  const { main, wt } = worktree({ main: "repo" });
  expect(resolveRepoBin(wt)).toEqual({ bin: binOf(main), fallback: true });
  expect(repoBin(wt)).toBe(binOf(main));
  expect(jobCommand(wt, "--job exec --query true")).toBe(`${fwd(binOf(main))} job --job exec --query true`);
  expect(isWorkspaceJobScript(`${fwd(binOf(main))} job ${JOB}`, { root: wt, checkout: wt, cwd: wt })).toBe(true);
});

it("in a linked worktree: probes repo.exe at the main checkout", () => {
  const { main, wt } = worktree({ main: "repo.exe" });
  expect(resolveRepoBin(wt)).toEqual({ bin: binOf(main, "repo.exe"), fallback: true });
});

it("in a linked worktree: starts from the toplevel when given a folder inside the worktree", () => {
  const { wt } = worktree({ main: null, own: "repo" });
  const pkg = path.join(wt, "packages", "a");
  fs.mkdirSync(pkg, { recursive: true });
  expect(resolveRepoBin(pkg)).toEqual({ bin: binOf(wt), fallback: false });
});

it.each(["repo", "repo.exe"])("in a linked worktree: prefers the worktree's own %s", (own) => {
  const { wt } = worktree({ main: "repo", own });
  expect(resolveRepoBin(wt)).toEqual({ bin: binOf(wt, own), fallback: false });
});

it("in a linked worktree: names the worktree's own path when no checkout has an install", () => {
  const { wt } = worktree({ main: null });
  expect(resolveRepoBin(wt)).toEqual({ bin: binOf(wt), fallback: false });
});

it("in a linked worktree: gives a plain folder outside git its own path", () => {
  const dir = tmp.dir("gate-nogit-");
  expect(resolveRepoBin(dir)).toEqual({ bin: binOf(dir), fallback: false });
});

it("in a linked worktree: rewrites a gated read through the main checkout's bin", () => {
  const { main, wt } = worktree({ main: "repo" });
  const out = processFatTools(camelCall("Bash", { command: "cat src/a.ts" }, { workspaceRoot: wt }));
  expect(out?.type).toBe("rewrite");
  expect(commandOf(out)).toContain(`${fwd(binOf(main))} job --job exec --query `);
});
